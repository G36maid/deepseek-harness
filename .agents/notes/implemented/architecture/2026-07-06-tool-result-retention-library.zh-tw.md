# Agent Note: 工具結果保留庫

Status: implemented

[English](2026-07-06-tool-result-retention-library.md) | [简体中文](2026-07-06-tool-result-retention-library.zh.md) | 繁體中文

## 問題

多個面向模型的工具已經限制其返回的上下文量，但每個工具都擁有不同的區域性機制和詞彙：bash 保留尾部並提供 spill 文件；web search 限制來源清單；web fetch 限制正文內容；`glob`／`grep` 發現工具需要在行內提供第一頁，同時為完整結果集保留精確的省略元資料。單一的 `truncate(text)` 輔助函式無法覆蓋這些情況：條目型工具需要條目計數，並在原語之外分組；文字型工具則需要位元組預算和 UTF-8 安全的首尾裁切。

這些工具需要共享的抽象是**保留**，而不是通用集合。呼叫方向一個有界對象輸入條目或文字區塊，稍後取得保留內容與精確的省略元資料。工具專用程式碼仍負責業務語義：文件分組、行號、退出碼、提供方錯誤狀態、spill 文件和麵向模型的說明。公共庫只負責一個機械問題：「保留了什麼，又省略了什麼？」

## 決策

`@deepseek-ai/dsh-output-retention` 位於 `packages/util/` 下，與 `dsh-brand` 和 `dsh-timeout` 同級，負責有界的模型可見輸出。它是一組純類與函式構成的庫，**不是** Cordis 服務或外掛程式：不接收 `ctx`、不註冊任何內容、不持有跨呼叫狀態，也不寄出事件。各工具包需要限制輸出時直接匯入它。

該庫包含兩個相互獨立的 retainer：

- `ItemRetainer<T>` 處理有序邏輯單元，例如路徑、grep 匹配項或搜尋來源。v1 只支持 `head` 保留，同時維持 retainer 形態，以便未來加入其他保留策略。
- `TextRetainer` 處理面向位元組的文字流，例如 bash stdout／stderr 或 web 回應正文。它支持 `head`、`tail` 和 `headTail` 保留，並在 `finish()` 時維持 UTF-8 邊界。

兩個 retainer 都會返回一個小型 `PushDecision`；每次呼叫 `push()` 後，呼叫方都能得知該單元／區塊是否完整保留，以及累積結果此時是否已被截斷。因為呼叫方會繼續輸入每一個已觀察到的條目／區塊，所以省略計數是精確的。

```ts ignore-check
/**
 * How much content the retainer omitted.
 *
 * `unknown` is reserved for callers that omit without a count; the retainers
 * themselves return `none` or `exact`.
 */
type Omitted =
  | { kind: 'none' }
  | { kind: 'exact'; count: number }
  | { kind: 'unknown' }

interface PushDecision {
  kept: boolean
  truncated: boolean
}

/**
 * Final result for ordered logical units.
 */
interface RetainedItems<T> {
  items: T[]
  truncated: boolean
  seen: number
  kept: number
  omitted: Omitted
}

/**
 * Final result for text streams.
 *
 * The returned `text` is safe to send to a formatter; the retainer does not add
 * tool-specific headers, exit markers, XML tags, or recovery instructions.
 */
interface RetainedText {
  text: string
  truncated: boolean
  omittedBytes: Omitted
}
```

### 策略

條目保留支持頭部視窗。文字保留支持頭部、尾部與首尾位元組視窗。

```ts ignore-check
type ItemRetentionStrategy =
  | {
      /** Keep the first `maxItems` units. Use for `glob`, `grep`, and web sources. */
      kind: 'head'
      maxItems: number
    }

type TextRetentionStrategy =
  | {
      /** Keep the first `maxBytes` bytes. */
      kind: 'head'
      maxBytes: number
    }
  | {
      /** Keep the final `maxBytes` bytes. Requires reading to the end. */
      kind: 'tail'
      maxBytes: number
    }
  | {
      /** Keep a stable prefix and suffix, omitting the middle. Requires reading to the end. */
      kind: 'headTail'
      headBytes: number
      tailBytes: number
    }
```

### 工具對映

`read` 被有意排除在 v1 保留庫之外。它的 `read-render` 輔助函式擁有文件專用的分頁約定：`offset`／`limit`、行號、`totalLines`、offset 越界錯誤、逐行預覽截斷，以及能夠在視窗中途停止掃描的所選輸出位元組上限。這是行視窗渲染器，不是通用保留原語。它未來可以共享中性的提示輔助函式，但不應把已經選定的視窗再傳入 `ItemRetainer`。

下文的 `FsGlobEntry` 與 `FlatGrepMatch` 是預期由發現工具使用的條目形態，不是現有保留庫的匯出。`FsGlobEntry` 是一個由後端派生的路徑；`FlatGrepMatch` 是後端將保留匹配項按文件分組之前的一條未分組 grep 匹配。

`glob` 收集完整的排序路徑清單後，使用 `ItemRetainer<FsGlobEntry>`，並將其設定為 `{ kind: 'head', maxItems: globMaxResults }`。工具在行內保留第一頁，並可以透過 spill seam 保存完整清單。路徑對映、跳過的候選項與 `incomplete` 均位於 retainer 之外。

`grep` 在分組前使用 `ItemRetainer<FlatGrepMatch>`，並將其設定為 `{ kind: 'head', maxItems: grepMaxMatches }`。執行器解析 ripgrep 輸出、對映路徑、應用逐行預覽截斷，並輸入扁平匹配項。呼叫 `finish()` 後，工具按文件對保留的匹配項分組；如果行內結果達到上限，還可以透過 spill seam 保存完整匹配清單。分組不屬於 retainer，因為上限針對匹配總數，而不是文件數；逐匹配項的預覽截斷和 `incomplete` 也與結果級保留相互獨立。

`bash` 可以使用 `TextRetainer`，設定為 `tail` 或 `headTail`，並讀取至行程結束。bash 執行器仍負責 spill 文件、退出狀態、訊號、逾時與背景工作行為；保留輔助函式只在需要該行為時替換臨時實作的記憶體首尾覈算。長時間執行任務的所有權與[通用長時間執行工具的執行時期](2026-06-20-generic-long-running-tool-runtime.md)相互獨立。

`web_fetch` 可以使用 `TextRetainer`，設定為 `head` 或 `headTail`；如果提供方必須在內部讀取和解碼，也可以保留由提供方負責的正文上限。無論採用哪種方式，fetch 結果中的 `truncated` 仍是提供方／工具事實，該庫只提供保留文字與省略元資料。

`web_search` 可以使用 `ItemRetainer<WebSearchSource>`，設定為 `head`。當前提供方通常返回陣列，所以這屬於事後處理，但仍能統一提示資訊。

### 提示

該庫公開一個中性的提示結構和一個小型格式化掛鉤，但面向使用者的措辭由工具提供。grep 頁腳會提示「縮小 pattern、path 或 include」；web fetch 頁腳會提示「取得更具體的 URL 或章節」；bash 則可以指向 spill 文件。retainer 無法得知這些復原操作。

```ts ignore-check
interface RetentionNotice {
  scope: string
  strategy: 'head' | 'tail' | 'headTail'
  unit: 'items' | 'bytes' | 'chars' | 'lines'
  limit: number | { head: number; tail: number }
  kept: number
  omitted: Omitted
}

const formatGrepNotice = (notice: RetentionNotice): string =>
  formatRetentionNotice(
    notice,
    ({ kept }) => `Results capped at ${kept}. Narrow the pattern, path, or include to see more.`,
  )
```

格式化掛鉤刻意保持精簡：工具把 `RetentionNotice` 轉換為自己的頁腳文字。輔助函式可以統一省略措辭，但不負責復原指引。

`truncated` 表示 retainer 因預算省略了原本可用的內容，不表示上游結果不完整。工具會為權限失敗、跳過的二進位檔案、提供方區域性失敗、不可讀候選項、無效 UTF-8，以及其他任何「無法檢查」狀況保留獨立欄位。

## 影響

**已交付內容。** `@deepseek-ai/dsh-output-retention` 匯出 `ItemRetainer`、`TextRetainer`、結果類型（`RetainedItems`、`RetainedText`）、策略類型（`ItemRetentionStrategy`、`TextRetentionStrategy`）、`Omitted`、`PushDecision`、`RetentionNotice`，以及中性的提示輔助函式 `describeOmitted`／`formatRetentionNotice`，且不相依性 Cordis 或任何工具包。單元測試覆蓋具有精確省略計數的條目頭部保留、文字頭部保留、文字尾部保留、首尾位元組保留、零預算、UTF-8 邊界處理（2、3、4 位元組碼位，以及每個裁切位置上的無效起始位元組）和未知省略量的措辭。

**已記錄但尚未遷移的內容。** `glob`、`grep`、`bash`、`web_fetch` 與 `web_search` 的對映已記錄在[包 README](../../../../packages/util/output-retention/README.md) 中，但本次改動並未把每個工具都遷移到該庫；遷移工作刻意留作獨立的後續任務。`read` 被明確記錄為不在範圍內：其 `read-render` 行視窗約定（`offset`／`limit`、`totalLines`、offset 範圍錯誤、逐行預覽截斷，以及針對所選視窗的位元組上限）不屬於通用保留，而一個 `Omitted` 計數也無法同時表達行視窗兩側。

**該庫維持的邊界。** `truncated` 表示 retainer 因預算省略了原本可用的內容，絕不表示上游不完整。工具專用狀態，包括 `incomplete`、權限失敗、提供方區域性失敗、跳過二進位檔案、bash spill 路徑復原和無效 UTF-8，均留在工具領域欄位中、位於 retainer 之外。未來改動遷移某項工具時，該包的 README 與測試必須證明，除了有意改變的提示措辭外，模型可見的結果文字沒有變化。

**接受的取捨。** v1 介面刻意只支持條目的 `head` 保留，以及文字的 `head`／`tail`／`headTail` 保留；視窗、分組預算、感知排序的上限和上游停止控制，要等第二個消費端證明需求後再引入。文字保留按位元組計數，以保障行程／正文安全；字元級和行級預覽預算繼續由具體工具負責。

## 考慮過的替代方案

**只進行事後 `truncate(text)`。** 不予採納：它適合 Codex 的歷史／工具輸出截斷場景，卻會丟失條目計數、分組邊界、UTF-8 安全的位元組視窗與精確省略元資料。

**使用一個帶可插拔回呼的通用 `Collector<T>`。** v1 不予採納，因為它會掩蓋兩種重要的資源模式。邏輯條目保留按條目計數；文字保留按位元組計數並維持 UTF-8 邊界。獨立的 `ItemRetainer` 與 `TextRetainer` 名稱明確表達這種差異，同時保持 API 精簡。

**把 `read` 視窗交給 `ItemRetainer`。** v1 不予採納：`read` 是當前唯一的視窗消費端，其語義屬於文件分頁，而不是通用保留。一個 `Omitted` 計數無法表示行視窗兩側，而且 `read` 還攜帶 `totalLines`、offset 範圍錯誤、逐行預覽截斷和針對所選輸出的位元組上限。讓 `read-render` 由工具所有，可以避免共享庫圍繞一項特例膨脹。

**讓截斷成為 `ToolExecutionResult` 的一部分。** 不予採納：工具登錄檔將不得不理解工具專用的復原指引、分組、行號、退出狀態和提供方語義。保留是由工具的 Native renderer（原生渲染器）使用的庫；模型可見投影繼續由工具所有，而[規範值](2026-07-20-canonical-tool-output-contract.md)可以保留完整的已採集結果。

**在每個面向模型的工具 schema 中公開上限。** 不作為默認方案：Claude Code 的 grep 公開 `head_limit`／`offset`，但本 harness 會把常規預算保留為部署設定，除非模型確實需要控制分頁。未來可以為具體工具增加類似 read 的續傳欄位；它不屬於共享保留原語。
