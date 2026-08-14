# @deepseek-ai/dsh-tool-fs-search

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

**面向模型的檔案系統發現工具**（`glob`、`grep`）由 **打包的 ripgrep 二進位**（`@vscode/ripgrep`）支持，而不是由 `ctx.fs` 提供方方法或系統 `rg` 安裝支持。註冊是無條件的：二進位隨 NPM 相依性一起交付，因此沒有載入期可用性探針。每次呼叫都透過 `ctx.subprocess` seam 以固定 argv 向量 spawn 該二進位（前綴 `--no-config`，使宿主的 `RIPGREP_CONFIG_PATH` 無法向不受約束的 spawn 注入 `--pre` 預處理器；模型控制的值是普通 argv 元素——不存在 shell 層，因此不涉及 shell 引號處理），解析原始 `rg` 輸出，並返回相對於工作目錄的規範值。本包注入 `tools`、`systemPrompt` 和 `subprocess`，有意**不**注入 `fs`；格式化結果 spill 為選填功能，因此機會性讀取 `ctx.spillStore`，呼叫方式為 `ctx.get()`。

```ts ignore-check
// A deployment chooses how over-cap glob pages are selected.
await ctx.plugin(LocalSubprocessRuntime)                     // @deepseek-ai/dsh-subprocess-local
await ctx.plugin(ToolFsSearch, { sampleOverCapGlobResults: false })
// Optional: a spill backend makes capped results fully recoverable.
await ctx.plugin(LocalSpillStore)                           // @deepseek-ai/dsh-spill-local
```

採用 spawn 支持的原因：本機工作區發現天然是由行程支持的 `rg` 工作流程；如果把搜尋放到 `ctx.fs` 上，就會迫使每個檔案系統後端擴充搜尋 API。subprocess seam 負責 spawn 執行、行程樹終止、環境清理和有界輸出捕獲；本包負責 schema、參數校驗、argv 構造、解析、保留、格式化結果 spill 和逾時聲明。工具絕不暴露背景工作——只有在 `rg` 退出、被協作式逾時終止、被中止或失敗後，呼叫才會返回。

## 部署要求：無需宿主 rg，但工作目錄與檔案系統需共置

二進位隨包交付，覆蓋所有受支持平臺（macOS/Linux/Windows，x64/arm64），因此無需宿主 `rg` 安裝，工具在每個部署上都註冊。返迴路徑會相對於解析後的工作目錄顯示（呼叫方 agent（代理）有工作階段 cwd 時使用該 cwd，否則使用 `process.cwd()`）；只有該工作目錄與檔案系統根目錄是同一工作區時，才能用 `read` 繼續讀取。這項共置要求不附帶執行時期跨服務校驗；遠端或虛擬檔案系統搜尋需等待共享工作區約定或特定提供方的搜尋後端。

## 設定

`sampleOverCapGlobResults` 是必填項且沒有回退值；部署必須顯式選擇超過上限時的排序約定。其餘設定鍵是選填的搜尋上限，預設值如下。

| 設定鍵 | 預設值 | 含義 |
|---|---|---|
| `sampleOverCapGlobResults` | 無（必填） | `true` 會在頂層條目之間對超過上限的 `glob` 頁面取樣；`false` 保留按修改時間排序的前部。格式化 spill 成功時，兩種模式都會在該產物中保留完整排序清單。 |
| `globMaxResults` | `100` | 一次 `glob` 呼叫內聯展示的最大路徑數（與 Claude Code 的 `GlobTool` 上限相同）。未超過上限的結果保持完整，並按修改時間排序。 |
| `grepMaxMatches` | `250` | 一次 `grep` 呼叫內聯保留的最大平鋪匹配數（與 Claude Code 的 `GrepTool` `head_limit` 相同）；後續匹配寫入格式化 spill 產物。 |
| `grepMaxLineBytes` | `2000` | 每條匹配行預覽的位元組上限；截斷會保留 UTF-8 邊界，並標記為 `(line truncated)`。 |
| `rawOutputMaxBytes` | `20000000` | 搜尋將解析的完整原始 `rg` stdout 上限（與 Claude Code 的 ripgrep 原始 buffer 相同）；更大的原始輸出以 `SEARCH_RAW_OUTPUT_OVERFLOW` 失敗。 |
| `timeoutMs` | `30000` | 附加到兩個工具定義上的協作式工具呼叫預算，由 `@deepseek-ai/dsh-tool-call-timeout-policy` 透過 `exec.signal` 強制執行；subprocess seam 的終止升級提供硬終止。 |
| `graceMs` | `3000` | subprocess seam 在 `timeoutMs` 之外授予的終止升級寬限期須為正值；超過後搜尋以 `SEARCH_ABORTED` 失敗；該寬限期不得大於 [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md)。 |
| `stderrMaxBytes` | `65536` | `rg` stderr 的診斷尾部預算，經 subprocess seam 的 collect 形態捕獲；lossy 讀取只保留尾部（標記 `[stderr truncated]`）。 |

## 工具

| 工具 | 參數 | 行為 |
|---|---|---|
| `glob` | `pattern`、`path?` | 執行 `rg --files --glob <pattern> --sort=modified --no-ignore --hidden`，並排除 VCS 元資料（`.git`、`.svn`、`.hg`、`.bzr`、`.jj`、`.sl`）。`path` 是選填的**目錄**搜尋根；省略時使用解析後的工作目錄。每行返回一個**文件**路徑；`rg --files` 從不輸出目錄條目。pattern 保留 ripgrep 語義：不含 `/` 時匹配任意深度的基名，因此 `*` 匹配整棵樹。完整結果保持按修改時間排序；超過上限時的呈現方式遵循 `sampleOverCapGlobResults`。 |
| `grep` | `pattern`、`path?`、`include?` | 按行解析 `rg --json`，避免按冒號拆分的歧義。`pattern` 是 ripgrep 正規表達式；`path` 是選填的**文件或目錄**目標；`include` 是一個正向 glob 過濾器，前置拒絕逗號分隔清單或否定值（`!…`），但允許 `*.{ts,tsx}` 等花括號交替。返回按文件分組、形如 `Line N: <preview>` 的匹配。 |

常規預算不進入面向模型的 schema（沒有 `head_limit`/`offset`/`case_insensitive`/輸出模式）：模型需要周邊上下文時，用 `read` 讀取匹配文件；需要後續結果時，遵循返回的 spill locator 檢索提示。

## 兩類預算、兩類產物

原始 `rg` stdout 與 stderr 是內部傳輸細節。每次搜尋從 subprocess seam 請求 collect 模式預算——`rawOutputMaxBytes` 內的完整 stdout 與 `stderrMaxBytes` 的診斷尾部——兩條流都不產生 spill 文件（工具從不讀取原始 spill 路徑）。如果 seam 仍報告 lossy stdout 讀取，搜尋會以 `SEARCH_RAW_OUTPUT_OVERFLOW` 失敗，並要求模型縮小查詢；lossy stderr 讀取只把診斷摘錄標記為 `[stderr truncated]`。成功的 `glob` 在 `{ root, paths }` 中保留所顯示的搜尋根及所有已取得路徑；啟用取樣時，藉助 `root`，Native 渲染器能以顯式的相對或絕對搜尋路徑為根，按該根下的條目分組，而不是按其工作目錄前綴分組。`grep` 保留所有已取得的 `{ path, lineNumber, line }`，並將其存入 `{ matches }`。內聯條目和每行預覽上限只應用於 Native 渲染器。直接介面呼叫的邏輯結果超過內聯上限時，後置策略會盡力透過 `ctx.spillStore.saveText()` 保存完整格式化預覽，並只把呈現替換為設定指定的頁面與 locator。巢狀 Code 分派會跳過 spill，因為其完整規範值不會進入模型上下文。spill 缺失/失敗時保留內聯頁面，並報告完整結果無法保存，絕不會成為 `isError`。

## 錯誤

搜尋失敗會攜帶由本包定義的 `SearchError`（`HarnessError` 子類），並以 `{ name, code }` 的形式呈現在 `isError` 結果上：`SEARCH_INVALID_PATTERN`（ripgrep 拒絕正則/glob）、`SEARCH_FAILED`（`rg` 啟動失敗、目標不可訪問、訊號終止、`--json` 輸出格式錯誤）、`SEARCH_RAW_OUTPUT_OVERFLOW`（原始輸出超過 `rawOutputMaxBytes`，或在請求 stdout 捕獲預算後仍 lossy）和 `SEARCH_ABORTED`（協作式工具逾時或呼叫方取消）。ripgrep 的退出語義由工具負責處理：退出 0 表示成功且有結果，退出 1 表示成功的空搜尋（`No files found` / `No matches found`），只有其他退出值表示失敗。模型參數錯誤（空白 pattern、清單值 `include`）仍是普通工具參數錯誤。

## 模型體驗

### 系統提示詞

#### 模型看到的內容

該外掛程式註冊作用域內的每個請求都包含下方獨立註冊的 glob 與 grep 指導。agent 作用域的工具限制可以隱藏任一 schema，而不移除其提示詞段。

##### 啟用 `sampleOverCapGlobResults: true` 時的 Glob 指導

```markdown
Use the glob tool — not shell find — to discover files by path pattern. A pattern with no "/" matches basenames at any depth, so "*" matches every file in the tree rather than its top level. Results are files only, never directories, and include hidden and ignored files: a result that fits comes back in modification-time order, while a larger one is sampled across top-level entries, so it spans the tree instead of one subtree.
```

##### 啟用 `sampleOverCapGlobResults: false` 時的 Glob 指導

```markdown
Use the glob tool — not shell find — to discover files by path pattern. A pattern with no "/" matches basenames at any depth, so "*" matches every file in the tree rather than its top level. Results are files only, never directories, and include hidden and ignored files: a result that fits comes back in modification-time order, while a larger one keeps the modification-time-ordered head.
```

##### Grep 指導

```markdown
Use the grep tool — not shell grep or rg — to search file contents. Use read on a matched file when you need surrounding context.
```

#### Token 影響

工具註冊期間每個請求有固定的指導成本；必填的取樣選擇決定採用哪一個 glob 變體。

#### KV Cache 影響

外掛程式作用域、取樣選擇與指導文字不變時前綴穩定。啟用、dispose（資源釋放）或改變選擇可能使該提示詞段的複用失效。

### 工具 schema

#### 模型看到的內容

glob 描述聲明瞭設定的超過上限排序方式。生成的 [`glob` 和 `grep` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-fs-search) 使用 `sampleOverCapGlobResults: true`；工具無條件註冊。

#### Token 影響

工具可見時每個請求有固定的 schema 成本。

#### KV Cache 影響

工具可見性與定義不變時前綴穩定。註冊生命週期或作用域限制可能從第一個改變的 schema token 起使複用失效。

### 結果與 spill 提示

#### 模型看到的內容

`glob` 每行返回一個路徑；`grep` 在每個路徑下分組展示 `Line <line>: <preview>` 匹配。空搜尋返回 `No files found` 或 `No matches found`。達到上限的結果以省略計數結尾，並附 spill locator 與後端檢索提示，或說明完整結果無法保存。啟用 `sampleOverCapGlobResults: true` 時，超過上限的 `glob` 頁面按實際搜尋根正下方的條目輪轉取路徑，頁腳說明取樣依據及其覆蓋的頂層條目數；無法覆蓋全部條目時，頁腳提示模型收窄 `path`。`false` 時頁面是按修改時間排序的前部，並保留普通的上限結果頁腳。未超過上限的結果原樣呈現；扁平取樣的結果也保留普通頁腳，因為其取樣等於按修改時間排序的前部。spill 產物始終持有按修改時間排序的完整清單。

#### Token 影響

內聯路徑與匹配受 `globMaxResults`、`grepMaxMatches` 與 `grepMaxLineBytes` 約束；呼叫及其保留結果在壓縮（compaction）前留在歷史中。

#### KV Cache 影響

僅附加；新可見內容跟在可複用請求前綴之後，不會使既有 KV Cache 條目失效。

### 工具錯誤

#### 模型看到的內容

失敗被規範化為 `Error: <message>`，並攜帶結構化 `SEARCH_INVALID_PATTERN`、`SEARCH_FAILED`、`SEARCH_RAW_OUTPUT_OVERFLOW` 或 `SEARCH_ABORTED` 元資料供呼叫方使用。

#### Token 影響

只有失敗的呼叫會增加這些保留 token。

#### KV Cache 影響

僅附加；新可見內容跟在可複用請求前綴之後，不會使既有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **搜尋與文件訪問沒有共享工作區證明**——只有當工作目錄與檔案系統根目錄指向同一工作區時，返迴路徑纔可繼續讀取；本包不執行執行時期跨服務校驗。
- **打包二進位固定在相依性版本上**——`@vscode/ripgrep` 覆蓋其隨附的平臺（macOS/Linux/Windows，x64/arm64）；不支持的平臺或損壞的安裝會以 `SEARCH_FAILED` 使呼叫失敗。遠端或虛擬檔案系統需要共置的工作區或另一個搜尋消費端。
- **schema 只暴露一個有界頁面**——偏移分頁、大小寫開關、替代輸出模式與提供方支撐的發現仍不在本包範圍內；達到上限的完整輸出需要 spill 後端。
- **啟用取樣時僅按搜尋根正下方的第一段路徑分組**——超過上限的 `glob` 頁面在這些頂層條目之間平衡，因此集中在更深處的結果（一棵均勻樹裡某個繁忙目錄）在該層級之下仍會呈現不均；遞迴平衡被延期。
