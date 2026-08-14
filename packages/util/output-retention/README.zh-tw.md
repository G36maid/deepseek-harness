# dsh-output-retention

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

一個輕相依性的**保留**庫：為必須限制返回上下文量的工具提供有界的面向模型輸出。呼叫方將項或文字區塊送入有界對象，然後取回保留的內容和精確的省略中繼資料。

該庫**只**負責這個機制問題：*「我們保留了什麼，又省略了什麼？」*。工具專用程式碼保留其業務語義：文件分組、行號、結束碼、提供方錯誤狀態、每行預覽截斷、spill 文件以及面向模型的文案。這就是 [Agent Note](../../../.agents/notes/implemented/architecture/2026-07-06-tool-result-retention-library.md) 劃定的邊界。

它是**庫，而非服務或外掛程式**：沒有 `ctx`，不註冊任何內容，不寄出任何事件。狀態只存在於每個 retainer（一次累積）中，絕不跨呼叫。工具包直接匯入它。

## 對外介面

```ts
import {
  ItemRetainer, TextRetainer,
  describeOmitted, formatRetentionNotice,
} from '@deepseek-ai/dsh-output-retention'
import type {
  Omitted, PushDecision, RetainedItems, RetainedText,
  ItemRetentionStrategy, TextRetentionStrategy, RetentionNotice,
} from '@deepseek-ai/dsh-output-retention'
```

| 匯出項 | 職責 |
|---|---|
| `ItemRetainer<T>` | 限制有序邏輯單元（路徑、grep 匹配項、來源）。只支援 `head`。`push()` → `PushDecision`；`finish()` → `RetainedItems<T>`。 |
| `TextRetainer` | 限制面向位元組的文字流。`head` / `tail` / `headTail`，並在 `finish()` 時保留 UTF-8 邊界。`push()` → `PushDecision`；`finish()` → `RetainedText`。 |
| `describeOmitted(omitted, unit)` | 標準化的省略子句（`exact` 輸出數量；`unknown` 不輸出）。 |
| `formatRetentionNotice(notice, recovery)` | 將標準化的省略子句與工具自有的復原指引連線起來。 |
| `Omitted` | `none` / `exact` / `unknown`：省略了多少內容。 |
| `PushDecision` | `{ kept, truncated }`：每次 push 的保留結果。 |

## 資源模式

兩個 retainer 使用獨立名稱，而不是同一個通用收集器，因為它們的**資源模型**不同。

- **`ItemRetainer` 限制有序邏輯單元**。搜尋工具可收集完整結果集用於 spill 文件復原，同時只為面向模型的預覽保留前 `maxItems` 項。因為呼叫方會繼續送入每個已觀察到的項，所以省略數量是精確的。
- **`TextRetainer` 限制面向位元組的文字**。`head`、`tail` 和 `headTail` 在 `finish()` 時保留 UTF-8 邊界；`headTail` 是 `dsh-spill-policy` 用於圍繞 spill 文件通知建置有界預覽的形態。

## `truncated` 是預算事實，絕不表示「不完整」

`truncated` 表示*因為預算限制，retainer 省略了本可獲得的內容*。它**不**表示上游不完整。權限失敗、跳過二進位檔案、提供方部分失敗、不可讀候選項和無效 UTF-8 保留在工具領域欄位中，絕不合併到 `truncated`。將兩者混為一談是該庫命名最容易誘發的缺陷；務必保持分離。

## 位元組，而非字元

文字上限和 `omittedBytes` 按**位元組**計數，以保證行程/正文安全（子行程管道和 HTTP 正文都是位元組流）。跨越碼點的區塊會被正確處理：`finish()` 會修剪每個切割位置的不完整碼點，使返迴文本絕不在邊界引入替換字元；首尾兩側會分開解碼，因此絕不會跨越被省略的中間部分重建碼點。按字元或行限制的預覽預算屬於獨立的工具職責。

## 工具對映

當前的保留機制消費端採用以下對映：

| 工具 | Retainer 與策略 | 說明 |
|---|---|---|
| `glob` | `ItemRetainer<FsGlobEntry>`，`head` | 收集完整的已排序路徑清單用於 spill 文件，同時在內聯位置保留第一頁。路徑對映、已跳過候選項和 `incomplete` 保留在外部。 |
| `grep` | `ItemRetainer<FlatGrepMatch>`，`head` | 收集匹配項用於 spill 文件，同時在內聯位置保留第一頁。每個匹配項的預覽截斷、分組、排序和 `incomplete` 保留在外部。 |
| `bash` | `TextRetainer`，`tail` 或 `headTail` | 執行器仍負責 spill 文件、結束狀態、訊號、逾時和背景工作。 |
| `web_fetch` | `TextRetainer`，`head` 或 `headTail` | 提供方/資源上限保留為提供方事實；retainer 只提供保留文字和省略中繼資料。 |
| `web_search` | `ItemRetainer<WebSearchSource>`，`head` | 當提供方返回的來源超過面向模型的結果應包含的數量時，標準化「來源已達上限」通知。 |

`read` 仍不屬於這個通用庫。其 `read-render` 輔助工具負責文件專用的分頁約定：`offset`/`limit`、行號、`totalLines`、偏移越界錯誤、每行預覽截斷，以及所選視窗的位元組上限。該輔助工具是一個行視窗算繪器。單個 `Omitted` 數量無法表示該視窗兩側。

## 使用形態

```ts ignore-check
// glob: keep the first page inline while still collecting the full list for spill.
const retainer = new ItemRetainer<FsGlobEntry>({ kind: 'head', maxItems: globMaxResults })
const allEntries: FsGlobEntry[] = []
for await (const entry of candidates) {
  allEntries.push(entry)
  retainer.push(entry)
}
const { items, truncated, omitted } = retainer.finish()

// bash: keep a head + tail, read to process exit.
const out = new TextRetainer({ kind: 'headTail', headBytes: headCap, tailBytes: tailCap })
child.stdout.on('data', (chunk: Buffer) => { out.push(chunk) })
const { text, omittedBytes } = out.finish()

// A footer: the library standardizes the omission clause; the tool owns recovery words.
const footer = formatRetentionNotice(
  { scope: 'grep', strategy: 'head', unit: 'items', limit: grepMaxMatches, kept: items.length, omitted },
  ({ kept }) => `Results capped at ${kept}. Narrow the pattern, path, or include to see more.`,
)
```

## 模型體驗

透過算繪保留內容和省略中繼資料的工具消費端間接影響模型。

#### KV Cache 影響

不會直接導致 KV Cache 失效；請求前綴變更由上述消費端負責。

## 已知限制與暫緩事項

- **項保留只支援 `head`**：tail、head/tail、分頁、分組和提供方完整性語義仍由工具負責。
- **文字保留面向位元組**：`read` 分頁等行視窗和字元視窗需要單獨的算繪器；切割可能會丟棄部分 UTF-8 邊界位元組，以保持返迴文本有效。
