# @deepseek-ai/dsh-tool-bash

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

模型側 `bash` 工具，註冊在 `ctx.shell` 執行器 seam 上。前臺執行始終位於該 seam 之後；後臺行程控制代碼會註冊到通用 `ctx.jobs` 執行時期，並透過 `job_output`、`job_list` 和 `job_kill` 控制；這些工具由 `@deepseek-ai/dsh-tool-jobs` 提供。

需要載入執行器 Service Provider（例如 `@deepseek-ai/dsh-bash-local`）與 [`@deepseek-ai/dsh-shell-env`](../shell-env/README.md) 登錄檔；在每個注入服務就緒之前，外掛程式會保持等待狀態（`inject: ['tools', 'bash', 'systemPrompt', 'bashEnv']`）。工具約定是 bash 方言——請掛載能解析 bash 的執行器。

包根只公開 Cordis 外掛程式約定（`name`、`inject`、`Config`、`apply`）；結果算繪和後臺行程適配仍保留在包內部。

外掛程式還會提供 `tool:bash` 提示詞段落（順序 105）：檢查每個結果中的 `[exit code: N]` 標記，發現失敗時先調查原因再繼續。

## 工具

### `bash`

| 參數 | 類型 | 說明 |
|---|---|---|
| `command` | string（必填） | 透過 `bash -c` 執行。呼叫之間不保留狀態；請使用 `workdir`，不要使用 `cd`。 |
| `description` | string（必填） | 用一行主動語態概述命令（5～10 個詞），僅用於 UI／日誌顯示，不影響執行。 |
| `timeoutMs` | number | 以毫秒為單位覆蓋逾時時間。執行器會應用其設定的預設值和上限。 |
| `workdir` | string | 本次呼叫的工作目錄。預設為呼叫方 agent（代理）工作階段 cwd 的檔案系統標識（`session.header.cwd`），使每個工作階段都在自己的工作區中執行；相對 `workdir` 也以同一標識為基準解析。 |
| `run_in_background` | boolean | 立即返回 job id；不應用逾時。 |
| `sandbox_permissions` | string enum | 僅當已掛載的執行器啟用沙盒時才會公開（`ctx.shell.sandboxMode` 報告一個具有限制作用的預設值）：被拒命令所需的更寬模式，取自封閉的目標詞彙 `workspace-write`/`danger-full-access`（絕不能縮減為執行器預設值；有效模式按工作階段確定，執行時會基於它檢查是否嚴格拓寬，未拓寬的請求直接失敗，不會向任何人發起提示）。 |
| `justification` | string | 必須與 `sandbox_permissions` 一同提供（缺少任一項都會產生驗證錯誤）：用一句話向使用者解釋此命令為何需要這項更寬權限。 |

執行前，`command`、`workdir` 和 `timeoutMs` 會透過 `ctx.shell.resolve()` 依據執行器設定預設值完成解析，因此 Service Definition（`ShellExecSpec`）收到顯式的 `workdir`/`timeoutMs` 值。工具層會根據呼叫方 agent 的 `session.header.cwd` 應用工作目錄預設值，然後才呼叫 `resolve()`：由於 N 個工作階段共享一個執行器，逐工作階段 cwd 必須來自 `exec.agent`；只有無法取得工作階段 cwd 時，執行器纔回退到自身設定／`process.cwd()`。存在沙盒策略時，工具會複用已經規範化的 `workspaceRoot` 作為工作目錄基準，防止限制邏輯與行程啟動過程對同一個工作階段路徑拼寫產生不同解析結果。

### 託管 shell 環境

每次模型發起的前臺或後臺 bash 呼叫都會透過共享的 [`dsh-shell-env`](../shell-env/README.md) 登錄檔收到新收集的一組可信 `DSH_*` 環境變數：`DSH_HOME`（Harness home 絕對路徑）、`DSH_SHELL=1`、agent 的 `DSH_SESSION_ID`，以及當活躍持久化後端能定位時的 `DSH_SESSION_JSONL`。登錄檔約定——貢獻方註冊、重複鍵／未聲明鍵的顯式報錯機制、內建項保留與貢獻方示例——載於該包的 README。快照透過專用的 `ShellExecRequest.dshEnv` 通道傳遞；本機執行器會先刪除繼承的所有 `DSH_*` 再合併，因此巢狀 harness 和並行的父／子 agent 不會洩漏過時身份，且絕不修改 `process.env`。工具說明只教授通用 `$DSH_*` 約定，不會點名持久化專用變數，也不會新增永久的系統提示詞段落。

結果文字依次包含 stdout、選填的 `[stderr]` 段落和適用的沙盒拒絕、逾時、訊號、結束程式碼及截斷標記。逾時與最終結束狀態分別報告；非零結束仍是由模型解釋的結果，不會成為 `isError`。截斷結果會連結安全的完整 spill 文件，或報告文件不可用。只有 spawn 錯誤和中止等基礎設施故障才會產生 `isError`。

已完成前臺行程的規範成功值為 `{ kind: 'foreground', ...ShellRunResult }`，已發布任務則為 `{ kind: 'background', jobId }`。Native renderer 保留上述文字，包括精確的 `started background job <id>`；程序化消費端使用帶類型欄位，無需解析這些字串。執行器的流上限仍是 `ShellRunResult` 的採集限制，並攜帶其 spill 路徑。

當 `run_in_background` 為 true 時，此外掛程式會在 spawn 前預檢 `ctx.jobs.start()`，把呼叫方 agent 註冊為持有者，並將返回的 `ShellProcess` 控制代碼適配為通用的取消／完成／增量輸出掛鉤。任務執行時期負責 job id、跨工作階段隔離、完成通知、等待和 dispose（資源釋放）清理；此外掛程式只把 bash 結束／沙盒事實對映為任務輸出和結果詳情。`enableRunInBackground: false` 會移除該參數，並在執行時拒絕強制後臺呼叫。

## UI 展示

工具持有自己的 `presentCall`/`presentResult` 算繪意圖。前臺呼叫是終端機卡片，包含命令、說明、cwd、輸出和解析後的結束狀態。由於卡片以獨立的 pill 展示結束狀態，解析所消耗的 `[exit code: N]` / `[killed by signal: …]` 標記會從輸出中移除；其他所有標記（截斷、逾時、沙盒）都保留在輸出中。後臺啟動只返回 job id，因此使用通用執行卡片；通用 `job_*` 工具持有各自的卡片。這些 presenter 是純函式，可安全重播。

## 工具僅使用具名參數建置請求

`ShellExecRequest` 攜帶選填的 `stdoutMaxBytes`、`stdin`、普通 `env` 和託管 `dshEnv`，供可信行程內外掛程式及此工具的環境登錄檔使用。模型側工具不公開 `stdoutMaxBytes`、`stdin` 或 `env`：它使用具名的命令／工作目錄／逾時／訊號／沙盒欄位，加上從登錄檔收集的 `dshEnv` 來建置請求。額外模型鍵會被忽略，無法替換託管值。Shell 文法可以提供等價的命令級行為，而本機執行器會清除環境中的憑據和過時 `DSH_*` 值。參見 [stdin/env Agent Note](../../../.agents/notes/implemented/architecture/2026-06-30-bash-stdin-env-trusted-plugin-api.md)。

## 權限與升權

除非啟用沙盒的執行器（[`dsh-bash-sandbox`](../bash-sandbox/)）限制命令，否則命令以執行器的完整權限執行。僅拒絕型沙盒會把拒絕作為結果事實報告，並在此算繪為拒絕標記；逐呼叫的允許／拒絕／詢問策略由 `tools/pre-execute` waterfall（瀑布式事件）負責（參見 docs/architecture.md）。

需要升權的 bash 呼叫會在執行前解析 `ctx.approval`。`allowed-once` 只對該次呼叫應用請求模式；審批被拒、取消、不可用或缺少審批上下文時，命令完全不會執行，並返回不同的錯誤。發生真實拒絕後，模型可以在同一輪次中使用滿足需要的最窄模式和理由重試同一命令一次；審批提示本身就是徵求同意的步驟。升權絕不能預先推測，停用或拒絕審批即為最終結果。其理由見 [沙盒 Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md)。

## 逐工作階段模式切換

對於啟用沙盒的執行器，每次呼叫依次按單次升權、工作階段覆蓋、執行器預設值解析模式。未啟用沙盒以及沒有 agent 的呼叫不攜帶工作階段覆蓋。策略歸屬方貢獻當前且不區分具體能力的常駐模式；拒絕結果仍負責特定於該操作的有效模式與重試引導。參見 [`dsh-shell` 摺疊計算](../shell/README.md)和[沙盒切換約定](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md)。

## 模型體驗

### 系統提示詞

#### 模型看到的內容

此外掛程式註冊作用域內的每個請求都包含下方 bash 指引。策略歸屬方透過自身的快取安全執行時期上下文貢獻當前沙盒狀態，而不改變此段落。作用域工具限制可以隱藏 schema，但不會移除這個獨立註冊的段落。

##### Bash 指引

```markdown
Check the [exit code: N] marker on every bash result; investigate failures before moving on.
```

#### Token 影響

外掛程式活躍期間，每個請求都會產生少量固定輸入開銷，不受沙盒模式或模式切換影響。

#### KV Cache 影響

只要註冊作用域和提示詞文字不變，前綴即可穩定複用。外掛程式啟用或 dispose 可能從此提示詞段落開始使複用失效；沙盒模式切換不會。

### 工具 schema

#### 模型看到的內容

模型會看到生成的 [`bash` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-bash)。僅當此生產方啟用 `run_in_background` 時，該欄位才會出現；僅當已掛載執行器聲明支援沙盒時，`sandbox_permissions` 和 `justification` 才會出現。Agent 作用域的工具限制可以移除該 agent 的定義。

#### Token 影響

工具可見的每個請求都會產生固定 schema 開銷；沙盒支援會增加升權欄位及其條件說明段落。

#### KV Cache 影響

只要可見性、後臺支援和執行器沙盒能力保持不變，前綴即可穩定複用。限制、設定或執行器發生變化時，可能從首個變化的工具定義開始使複用失效。

### 前臺結果

#### 模型看到的內容

renderer 先輸出依資料而定的 stdout 尾部，再輸出選填的 `[stderr]` 和 stderr 尾部。沒有輸出時，它會精確輸出 `(no output)`。條件行精確為 `[output truncated; full output: <path-or-(unavailable)>]`、`[sandbox: file access denied under <mode> mode]`、`[timed out after <timeoutMs>ms]`、`[killed by signal: <signal>]` 和 `[exit code: <exitCode>]`；沙盒升權與 runner 故障行原文列於 [`dsh-bash-sandbox`](../bash-sandbox/README.md)。

#### Token 影響

呼叫前結果 token 為零。每條流的輸出有界，每個已輸出行則會保留在歷史中，直至壓縮（compaction）。

#### KV Cache 影響

僅附加；新可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

### 背景工作上下文與結果

#### 模型看到的內容

啟動會精確返回 `started background job <jobId>`。此生產方會向通用任務執行時期提供增量行程輸出、選填的 `[some output was dropped from memory; full output: <paths-or-(unavailable)>]`、沙盒事實，以及 `exit code: <exitCode>` 或 `signal: <signal>` 等終止詳情。[`dsh-tool-jobs`](../../jobs/tool-jobs/README.md) 負責模型可見的狀態行、完成通知、清單和取消回應。

#### Token 影響

啟動確認很短並會保留；收集到的輸出依資料而定，並受執行器流緩衝區限制。消費式讀取不會重複先前輸出。

#### KV Cache 影響

僅附加；新可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

### 工具錯誤

#### 模型看到的內容

驗證和策略失敗統一為 `Error: <message>`。此包的穩定訊息包括 `invalid command: expected a non-empty string`、`invalid description: expected a non-empty string`、`invalid timeoutMs: expected a positive number, got <value>`、`invalid escalation: sandbox_permissions requires a justification`、`invalid escalation: justification is only valid together with sandbox_permissions`、`invalid justification: expected a non-empty sentence`、`background execution is disabled for this bash tool`、`background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs`、`sandbox_permissions is not available in this composition (no sandboxing executor to escalate)`、`sandbox escalation to "<mode>" is not strictly wider than this call's current "<mode>" mode`、審批不可用／拒絕／取消變體，以及 `tool call aborted`。

#### Token 影響

只有失敗呼叫會增加這些保留 token；升權被拒時命令不會執行，因此不會新增命令輸出。

#### KV Cache 影響

僅附加；新可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與延期工作

- **重播結束狀態 pill 從結果文字解析**：如果輸出最後一行恰好精確為 `[exit code: N]` / `[killed by signal: …]`，工作階段重播將顯示錯誤的 pill，並且該行會從卡片正文中丟失，因為解析會把它當作自己消耗的標記；這是僅影響展示的已知殘留問題。
- **`bash` 工具不採用 `timeout-policy` 預算**：根據[工具呼叫 timeout-policy Agent Note](../../../.agents/notes/implemented/architecture/2026-07-07-tool-call-timeout-policy.md)，它保留由執行器持有的 `BASH_TIMEOUT` 路徑。
- **後臺行程沒有執行器逾時**：工作不再需要時，呼叫方必須使用 `job_kill`，或相依性持有者／服務的 dispose。
