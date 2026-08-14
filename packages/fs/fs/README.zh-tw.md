# @deepseek-ai/dsh-fs

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

**`FileSystem`**（`ctx.fs`）定義同一個執行世界中的儲存原語，包括解析路徑、公開規範化行程路徑與文件 URI、檢查包含關係、完整或流式讀取文字、有界讀取原始位元組、檢查／列出中繼資料、原子寫入和應用字面量編輯，但不規定實作方式。兩個變更操作都**選填** 接收版本防護，因此 `ctx.fs` 本身就是完整且不受約束的儲存 seam。本包還擁有由工具分派、政策外掛程式監聽的 `fs/*` 政策事件詞彙。

本包擁有四層檔案系統棧中的 Service Definition 和提供方約定層；該拆分使每個關注點可以獨立演進和替換（見[能力 seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)、[檔案系統能力 seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-17-filesystem-capability-seam.md)、[拆分檔案系統 seam Agent Note](../../../.agents/notes/implemented/simplification/2026-06-26-fsspec-style-fs-seam.md)和[文件上下文事件閘門 Agent Note](../../../.agents/notes/implemented/architecture/2026-06-26-file-context-as-event-gate.md)）：

| 層 | 包 | 角色 |
|---|---|---|
| 工具/執行器 | `@deepseek-ai/dsh-tool-fs` | 面向模型的 `read`/`write`/`edit` schema、讀取視窗和文字算繪；透過 `ctx.fs` 讀取/寫入/編輯，並分派 `fs/*` 事件 |
| 政策 | `@deepseek-ai/dsh-fs-observation-policy` | 已觀察狀態、編輯前讀取和版本防護的寫入/編輯，透過 `fs/*` 事件閘門貢獻（無服務） |
| 提供方約定 | `@deepseek-ai/dsh-fs`（本包） | `ctx.fs`：執行世界路徑、文字 I/O 與原子變更原語（選填版本防護）；擁有 `fs/*` 事件詞彙 |
| 提供方 | `@deepseek-ai/dsh-fs-local` | 宿主檔案系統實作 |

`fs-sandbox` 與 `fs-e2b` 實作該介面，無需更改政策層和工具層。

## 服務 API（`ctx.fs`）

後端繼承 `FileSystem` 並實作十二個原語。

| 成員 | 語義 |
|---|---|
| `resolve(path, opts?)` | 把路徑解析為穩定的 `FsTarget`（不透明 `targetKey`、`displayPath`）。`opts.cwd` 是相對 `path` 解析所依據的基準（呼叫方提供其工作階段工作區；絕對路徑忽略該值；省略時使用後端預設值），`opts.signal` 則中止後端往返。該方法是非同步的，因為遠端後端可能需要 I/O。經不同路徑到達的同一文件必須產生相同 `targetKey`。 |
| `processPath(target)` | 返回該提供方執行世界中的子行程可以打開的規範化絕對路徑。該路徑有意與不透明的 `targetKey` 分離。 |
| `fileUrl(target)` | 返回採用執行世界平臺文法的規範化 `file:` URI。編碼由後端而非宿主行程負責。 |
| `contains(parent, child)` | 在不公開或解析目標 key 的情況下，檢查規範化身份相等或後代包含關係。兩個目標都來自該提供方。 |
| `stat(target, signal?)` | 返回 `FsInfo` 中繼資料（`version`、`type`、選填 `size`）；目標不存在時返回 `undefined`。絕不返回內容。 |
| `lstat(path, opts?, signal?)` | 當最後一個路徑元件是符號連結時，不跟隨該元件，返回 `FsPathInfo` 中繼資料。該方法採用路徑形態，使消費端能在 `resolve` 跟隨倉庫所有的符號連結進入目標前拒絕它。 |
| `readText(target, signal?)` | 把整個普通文字文件讀取為一個解碼後的字串。負責普通文件檢查、UTF-8 解碼和二進位/NUL 拒絕（`FS_NOT_TEXT`）。 |
| `streamText(target, signal?)` | 為大文件按解碼後的區塊流式讀取相同文字（跨區塊 UTF-8 解碼仍由此處負責）；需要位元組上限的消費端在消費流時執行該上限。 |
| `readBytes(target, signal, maxBytes)` | 把完整普通文件按原始位元組讀出，不做解碼或二進位拒絕。`maxBytes` 為必填，在該 seam 上限制完整內容：已知或讀取中發現的超限以 `FS_TOO_LARGE` 失敗，而不是截斷或無界緩衝。 |
| `listDir(target, signal?)` | 按穩定名稱順序列出直接子項。返回條目名稱、條目類型、解析後的子目標和低成本中繼資料（若可用則包括 `version`/文件 `size`）；絕不讀取文件內容。缺失目標拋出 `FS_NOT_FOUND`，非目錄拋出 `FS_NOT_DIRECTORY`，權限失敗拋出 `FS_PERMISSION_DENIED`，其他後端 I/O 失敗拋出 `FS_IO_ERROR`。損壞/消失的子項可以作為無中繼資料的 `other` 返回；子項權限/I/O 失敗會使用相同結構化程式碼使整個清單失敗。 |
| `writeText(target, content, expected?, signal?)` | 原子建立/替換。`expected` 是選填的：省略 ⇒ 無條件建立或覆蓋；提供 `FsWriteIntent`（`createIfAbsent`/`replaceIfVersion`）⇒ 新增防護。`createIfAbsent` 必須以不替換的方式發布，使初始探測後搶先建立的文件得到保留。 |
| `editText(target, edit, expected?, signal?)` | 字面量編輯。`expected` 是選填的：省略 ⇒ 無條件編輯當前內容；提供 `{ version }` ⇒ 新增防護，並在匹配之前校驗。無論哪種情況，目標缺失都報告 `FS_STALE_VERSION`。應用和寫入以原子方式完成，使用同一個變更臨界區。 |

無論是否有版本防護，變更都在後端的每目標鎖內執行，因此無條件寫入/編輯仍是原子的；「無條件」只移除*版本*前置條件，不移除原子性。

## `fs/*` 政策事件

本包聲明三個事件（見 [filesystem.md](../../../docs/subsystems/filesystem.md#cordis-surface) 的生成區塊），使寄出方（`@deepseek-ai/dsh-tool-fs`）和政策監聽器（`@deepseek-ai/dsh-fs-observation-policy`）共享詞彙，而無需讓寄出方相依性政策外掛程式。`fs/write-intent` 和 `fs/edit-intent` 是單槽決策 waterfall（瀑布式事件）（監聽器完整決策，絕不呼叫 `next()`）；`fs/observed` 是發後即忘的記錄事件，攜帶 `FsObservation` 可辨識聯合：存在並帶有版本，或確認缺失。它們只攜帶 `dsh-fs` 詞彙和一個不透明 `object` 參與者，不含面向模型的概念或 agent（代理）/工作階段所有者結構。

## 提供方約定，不是政策層

`ctx.fs` 有意接近 fsspec 風格的儲存原語，比位元組級 `cat`/`open` 高半層，因為它會解碼文字並拒絕二進位，使政策層絕不接觸原始位元組。它負責 UTF-8 解碼、二進位拒絕、原子寫入和字面量編輯臨界區。它**不** 負責行視窗、編號行、算繪 footer 或已觀察狀態。已觀察狀態、編輯前讀取和版本防護的寫入/編輯屬於外掛程式（`@deepseek-ai/dsh-fs-observation-policy`）透過提供選填防護而新增的政策，並非提供方行為，因此沙盒化/遠端後端不會繼承任何面向模型的觀察政策。

`editText` 留在該 seam 上，不由政策層透過讀取加寫入組合，因為版本防護、字面量匹配和原子重寫必須處於同一臨界區內，才能正確歸因錯誤並實作一方勝出/一方過時的並行；遠端後端也可以將其實作為原生比較並編輯操作。

## 詞彙

`FsTargetKey` / `FsVersion` 是帶品牌的不透明 id（見[品牌 id Agent Note](../../../.agents/notes/implemented/architecture/2026-06-20-branded-ids.md)）；消費端不得解析 `targetKey` 或解釋 `version`，只有 `displayPath` 用於模型/UI 輸出。`FsObservation` 區分 `{ kind: 'present', version }` 與 `{ kind: 'absent' }`，使策略無需執行 I/O 即可分辨未見目標和確認缺失。`FsWriteIntent` 是顯式的防護寫入意圖（`createIfAbsent` 建立缺失目標，並以 `FS_NOT_OBSERVED` 拒絕現有目標；`replaceIfVersion` 只在觀察版本上替換，否則為 `FS_STALE_VERSION`）；從 `writeText` 中省略該值就是第三種無條件狀態。`FsPathInfo` 是可報告 `symlink` 的不跟隨連結中繼資料形態，區別於目標級 `FsInfo`。失敗會拋出 `FsError`（繼承 `HarnessError`；見[結構化錯誤分類 Agent Note](../../../.agents/notes/implemented/architecture/2026-06-11-structured-error-taxonomy.md)），並攜帶穩定的 `FsErrorCode`（`FS_NOT_FOUND`、`FS_NOT_DIRECTORY`、`FS_NOT_TEXT`、`FS_NOT_REGULAR_FILE`、`FS_TOO_LARGE`、`FS_PERMISSION_DENIED`、`FS_IO_ERROR`、`FS_STALE_VERSION`、`FS_NOT_OBSERVED`、`FS_AMBIGUOUS_EDIT`、`FS_EDIT_NOT_FOUND`、`FS_ABORTED`）；工具登錄檔公開 `{ name, code }`，並將其附在 `isError` 結果上。完整約定見 `src/types.ts`。

## 模型體驗

透過 `dsh-tool-fs` 間接產生影響；該消費端把提供方文字和錯誤算繪為有界且保留的檔案系統工具結果。

#### KV Cache 影響

不會直接使快取失效；具名消費端負責請求前綴的任何變化。

## 已知限制與延期工作

- **變更操作約定只支援文字**：文字讀取和兩個變更操作都以 `FS_NOT_TEXT` 拒絕二進位/非 UTF-8 內容；`readBytes` 是唯一的原始位元組原語，二進位安全的變更操作仍是[工具 schema Agent Note](../../../.agents/notes/implemented/feature/2026-06-17-filesystem-tool-schemas.md)有意延期的工作。
- **只有十二個原語**：沒有刪除、重新命名/移動、複製或監視；`listDir` 只支援一層，遞迴、glob、分頁和搜尋不在範圍內，見[目錄列出 Agent Note](../../../.agents/notes/archived/architecture/2026-07-03-filesystem-directory-listing-seam.md)。
- **沒有 I/O deadline**：該 seam 不啟動逾時；取消只是每個原語上盡力而為的選填 `AbortSignal`（見有意採用的 [fs 能力族立場](../README.md)）。
- **先解析後操作使遠端後端每次工具呼叫需要兩次往返**：摺疊或快取解析由這種後端自行決定。
