# @deepseek-ai/dsh-tool-pwsh

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

註冊在 `ctx.shell` 執行器 seam 之上的面向模型的 `pwsh` 工具。面向由 PowerShell 執行器（如 `@deepseek-ai/dsh-pwsh-local`）支撐 `ctx.shell` 的 Windows 組合；工具約定是 PowerShell 方言：原生 `C:\...` 路徑與 `$env:NAME` 變數。行為與 `dsh-tool-bash` 逐呼叫對齊——透過通用任務執行時期執行前臺與 `run_in_background`、透過共享 `shell-env` 登錄檔管理 `DSH_*` 環境、sandbox 拒絕渲染與同輪次 `sandbox_permissions` 升級面、以及 bash 的 marker/截斷渲染故事（乾淨退出不產生 marker）。

需要已載入的執行器實作與 `shell-env` 外掛程式；兩者都存在前工具保持 pending（`inject: ['tools', 'bash', 'systemPrompt', 'bashEnv']`）。

包根只匯出 Cordis 外掛程式約定（`name`、`inject`、`Config`、`apply`）；結果渲染（`src/render.ts`）與背景工作適配（`src/background.ts`）映像檔 bash 工具的結構，並可透過包的 `./src/*` 匯出訪問。

外掛程式還貢獻 `tool:pwsh` 提示詞段落（order 105）：非零退出以 `[exit code: N]` marker 報告，Windows 上的中斷以無 signal 的 exit 1 結帳。

## 工具

### `pwsh`

| Arg | Type | Notes |
|---|---|---|
| `command` | string (required) | 透過 `pwsh -Command` 執行。呼叫之間不保留狀態——用 `workdir`，不要用 `cd`。 |
| `description` | string (required) | 命令的一行主動語態摘要（5-10 詞），僅用於 UI/日誌展示——不影響執行。 |
| `timeoutMs` | number | 逾時覆蓋值（毫秒）。執行器應用其設定的預設值與上限。 |
| `workdir` | string | 本次呼叫的工作目錄。默認取呼叫 agent（代理）的工作階段 cwd（`session.header.cwd`），使每個工作階段在自己的工作區執行；相對 `workdir` 基於同一身份解析。 |
| `run_in_background` | boolean | 立即返回 job id；不適用逾時。 |
| `sandbox_permissions` | string enum | 僅當已掛載 sandbox 執行器時才會公開（`ctx.shell.sandboxMode` 已定義）。用於對剛被 sandbox 拒絕的命令做一次性重試的更寬 sandbox 模式——取剛好足夠的最窄更寬模式，要求 `justification` 並在執行**之前**經 `ctx.approval` 獲得使用者批准。未拓寬或無法獲批的請求 fail-closed，不執行任何內容。 |
| `justification` | string | 必須與 `sandbox_permissions` 一同提供：用一句話向使用者解釋為何正是這條命令需要更寬的訪問。 |

`command`、`workdir` 與 `timeoutMs` 在執行前經 `ctx.shell.resolve()` 按執行器設定預設值解析。workdir 預設值在工具層於 `resolve()` 之前從呼叫 agent 的 `session.header.cwd` 取得——每次工作階段的 cwd 必須來自 `exec.agent`，因為 N 個工作階段共享一個執行器；僅當沒有工作階段 cwd 時執行器纔回退到自己的設定 / `process.cwd()`。

### Managed shell environment

每次前臺與後臺模型 pwsh 呼叫都會透過共享的 [`dsh-shell-env`](../shell-env/) 登錄檔收到一份新收集的受信任 `DSH_*` 環境：`DSH_HOME`（Harness 主目錄絕對路徑）、`DSH_SHELL=1`、agent 的 `DSH_SESSION_ID`，以及活躍持久化後端定位到 JSONL 時的 `DSH_SESSION_JSONL`。向 `ctx.shellEnv` 貢獻 `DSH_*` 事實的外掛程式對 pwsh 呼叫與 bash 呼叫一視同仁。快照透過專用的 `ShellExecRequest.dshEnv` 通道傳遞；`process.env` 永不被修改。描述只教授通用的 `$env:DSH_*` 約定，而不是點名持久化相關的變數。

結果文字包含 stdout、選填的 `[stderr]` 段，然後是適用的截斷、sandbox 拒絕（組合公開升級能力時帶同輪次升級提示）、逾時、signal 與退出 marker。乾淨退出（0、無 signal）不產生 marker；空體渲染為 `(no output)`。截斷會連結一個安全的完整 spill 文件，或報告其不可用。逾時獨立於最終退出狀態報告；非零退出仍是模型解讀的結果而非 `isError`。Windows 上強制終止以無 signal 的 exit 1 結帳，因此 `[killed by signal: …]` 僅適用於 POSIX。只有基礎設施失敗——spawn 錯誤與中止（`tool call aborted`）——產生 `isError`。

規範成功形態是已完成前臺行程的 `{ kind: 'foreground', ...ShellRunResult }`（存在時投影執行器的 `sandbox` 事實——`mode`/`denied`、選填的 `enforcement`/`runnerFailed`）或已發布任務的 `{ kind: 'background', jobId }`。渲染器對後臺 ack 精確保留 `started background job <id>`；程式設計消費者使用類型化欄位而不解析渲染文字。

當 `run_in_background` 為 true 時，本外掛程式在 spawn 前預檢 `ctx.jobs.start()`，把呼叫 agent 註冊為 owner，並將返回的 `ShellProcess` 控制代碼適配為通用的 cancel/done/增量輸出掛鉤。任務執行時期負責 job id、跨工作階段隔離、完成通知、等待和 dispose（資源釋放）清理；本外掛程式只把 pwsh 退出事實對映進任務輸出與結果明細。`enableRunInBackground: false` 會移除參數並在執行時拒絕強制的後臺呼叫。

## UI presentation

工具擁有自己的 `presentCall`/`presentResult` 呈現意圖。前臺呼叫是攜帶命令、描述與選填 cwd 的 `terminal` 卡；`run_in_background` 呼叫是攜帶原始命令的 `generic` 卡，映像檔 bash 工具的後臺呈現。完成的前臺結果同樣是 `terminal` 卡：退出 marker 變成卡片的退出狀態 pill（`exitCode`/`signal`），去 marker 的正文成為卡片輸出——與 bash 工具的 terminal 卡故事完全一致，經由 `@deepseek-ai/dsh-shell` 的共享退出狀態解析。後臺 ack 與執行錯誤保持 `generic` 卡，以 `console` 圍欄包裹渲染輸出。這些 presenter 是純函式且可重放。

## 模型體驗

### 系統提示詞

#### 模型看到的內容

本外掛程式註冊作用域內的每個請求都包含下面的 pwsh 指引。作用域工具限制可以隱藏 schema，但不會移除這個獨立註冊的段落。

##### Pwsh guidance

```markdown
Non-zero exits are reported as `[exit code: N]` markers; investigate failures before moving on. On Windows a killed process settles as `[exit code: 1]` without a signal marker; treat a bare exit 1 after an interruption as a termination, not a command failure.
```

#### Token 影響

外掛程式激活期間每次請求的固定小額輸入成本。

#### KV Cache 影響

註冊作用域與 prompt 文字不變時前綴穩定。外掛程式啟用或釋放可能使該 prompt 段落的複用失效。

### 工具 schema

#### 模型看到的內容

模型看到生成的 [`pwsh` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-pwsh)。按 agent 作用域的工具限制可以移除該 agent 的定義。

#### Token 影響

工具可見的每個請求上的固定 schema 成本。

#### KV Cache 影響

可見性與工具定義不變時前綴穩定。限制或設定變更可能從首個變化 token 起使複用失效。

### 前臺結果

#### 模型看到的內容

渲染器輸出資料相關的 stdout 尾部，然後是選填的 `[stderr]` 與 stderr 尾部。條件行精確為 `[output truncated; full output: <path>]`、`[sandbox: file access denied under <mode> mode]` 加升級提示 `[sandbox: escalation available — …]`（僅當組合公開升級能力時）、`[timed out after <timeoutMs>ms]`、`[killed by signal: <signal>]` 與 `[exit code: <exitCode>]`（僅非零退出）；空體渲染為 `(no output)`。

#### Token 影響

呼叫前零結果 token。每個流的輸出有界，而每條已寄出的行保留在歷史中直到壓縮。

#### KV Cache 影響

僅附加；新出現的內容跟隨可複用的請求前綴，不會使既有 KV Cache 條目失效。

### 後臺結果

#### 模型看到的內容

後臺啟動精確渲染為 `started background job <id>`；隨後的讀取與狀態透過通用 `job_output`/`job_kill` 工具流轉，包括記憶體截斷丟棄未讀位元組時的 lossy 讀取 spill 通知。

#### Token 影響

ack 是固定短行；任務輸出按讀取有界。

#### KV Cache 影響

僅附加；新出現的內容跟隨可複用的請求前綴，不會使既有 KV Cache 條目失效。

### 工具錯誤

#### 模型看到的內容

校驗與基礎設施失敗規範化為 `Error: <message>`。本包的穩定訊息包括 `invalid command: expected a non-empty string`、`invalid description: expected a non-empty string`、`invalid timeoutMs: expected a positive number, got <value>`、`invalid escalation: sandbox_permissions requires a justification`、`invalid escalation: justification is only valid together with sandbox_permissions`、`invalid justification: expected a non-empty sentence`、`sandbox_permissions is not available in this composition (no sandboxing executor to escalate)`、共享的升級失敗（非嚴格更寬、無審批服務、無 agent 可路由、無審批通道、使用者拒絕、已取消）、`run_in_background is disabled for this deployment (enableRunInBackground: false)`、`background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs` 與 `tool call aborted`。

#### Token 影響

只有失敗的呼叫會新增這些保留 token；被中止的呼叫不產生命令輸出。

#### KV Cache 影響

僅附加；新出現的內容跟隨可複用的請求前綴，不會使既有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **Windows 沙盒下的語言模式與 named-pipe 捕獲** — 在 [Windows ACL 沙盒](../../sandbox/sandbox-windows-acl/README.md) 下，read-only pwsh 會以 ConstrainedLanguage 啟動，因為臨時目錄寫入被拒絕，導致 PowerShell 的 AppLocker 探針失敗並按 fail-closed 處理：`Add-Type`、非核心 .NET 靜態呼叫（`[System.IO.*]::`、`[math]::`）、COM 對象與反射都會以“only core types”錯誤失敗，且該模式無法從內部解除。workspace-write 的私有臨時目錄使探針得以完成，因此除非主機策略另有規定，否則它保持 FullLanguage。兩種受限模式都拒絕 named-pipe 打開，因此受限命令內的管道 stdio spawn 以 EPERM 失敗。工具描述把這兩個約定教給模型；後端 README 負責完整的限制說明。
- **無持久 shell 或 PTY** — 每次呼叫都啟動全新的 `pwsh -Command`；PTY 後端目前僅限 Linux/macOS，Windows ConPTY 持久 shell 屬於路線圖工作。
- **PowerShell 方言約定** — 模型必須寫 PowerShell（原生路徑、`$env:` 變數），而不是 bash；沒有方言翻譯。
- **工作階段 cwd 身份不做規範化** — workdir 基座直接取工作階段頭 cwd 原值，不同於 bash 工具經 sandbox-root 規範化的身份。在隔離執行器下，策略的工作區根**會**被規範化（由共享的策略服務完成），因此當原始工作階段 cwd 與其規範化形態不同時，workdir 與隔離根可能不一致——這一 parity 差距留待共享 shell 工具基座提取時解決。
