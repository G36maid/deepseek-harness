# @deepseek-ai/dsh-shell

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

**`ShellExecutor`**（`ctx.shell`）定義 bash 後端做什麼，即執行前臺命令與啟動後臺行程，但不規定如何實作。job id、所有權、收集、取消與通知屬於通用 `ctx.jobs` 執行時期。

本包承擔 bash 能力的 Service Definition 角色，各角色因此可以獨立演進（和替換）：

| 包 | 職責 |
|---|---|
| `@deepseek-ai/dsh-shell`（本包） | Service Definition：抽象服務 + 詞彙類型 |
| `@deepseek-ai/dsh-bash-local` | Service Provider：本機子行程 |
| `@deepseek-ai/dsh-bash-sandbox` | Service Provider：沿用 `dsh-bash-local` 的機制，但透過 [`ctx.sandbox`](../../sandbox/sandbox/) 限制每次 spawn，並將拒絕報告為結果事實 |
| `@deepseek-ai/dsh-tool-bash` | 基於 `ctx.shell`、面向模型的工具 schema |

該拆分是一個標準的能力 seam（[capability-seams Agent Note](../../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)）：`dsh-bash-sandbox` 是位於同一 Service Definition 之後的沙盒執行器——Consumer 偵測其 `sandboxMode` 能力並新增升權欄位，無需匯入提供方——容器化或遠端執行器也可以同樣接入。

## 服務 API（`ctx.shell`）

| 成員 | 語義 |
|---|---|
| `run(spec)` | 前臺執行。命令完成時 resolve。**只會因基礎設施失敗而 reject**（工作目錄不可用、shell 缺失、訊號已在呼叫前中止）；非零結束、逾時終止和中止導致的終止都會 resolve 為描述性 `ShellRunResult`。 |
| `start(spec)` | 後臺執行。立即返回不含任務語義的 `ShellProcess` 控制代碼；**不應用逾時**。呼叫方可以將其適配到 `ctx.jobs`。 |
| `sandboxMode` | 工具層的能力事實：沙盒執行器用於限制執行的預設模式（基類中為 `undefined`，即「此執行器不使用沙盒」）。`dsh-tool-bash` 會在註冊時讀取它，僅當組合確實支援升權欄位時才公佈這些欄位。 |
| `ShellProcess.readOutput()` | **增量** 讀取輸出：連續讀取絕不會重複交付。因緩衝區容量限制而丟失資料的讀取會標記 `lossy`，並指向完整流 spill 文件。 |
| `ShellProcess.kill()` | 終止行程組。如果行程已結束，返回 `false`。 |

實作會繼承 `ShellExecutor` 並實作抽象方法。dispose（資源釋放）必須終止每個執行中的行程並等待其結束。

`SHELL_SETTINGS_NAMESPACE`（`bash`）由此處匯出而非由某個提供方匯出，因為它命名的是能力而不是實作。一個宿主只組裝一個 `ctx.shell` 提供方——win32 層會把 POSIX 行換成 pwsh 行，同時掛載兩者會因服務重複註冊而在載入期失敗——所以每個提供方都能用自己的 schema 與組裝條目註冊這同一個命名空間，兩者永不相撞；在平臺間攜帶的 `settings.yaml` 也能在兩邊繼續解析。

## 詞彙

`ShellExecRequest`（command、workdir?、timeoutMs?、stdoutMaxBytes?、signal?、stdin?、env?、dshEnv?、sandboxPolicy?）在執行前解析為 `ShellExecSpec`（command、workdir、timeoutMs、stdoutMaxBytes、signal?、stdin?、env?、dshEnv?、sandboxPolicy）。`stdoutMaxBytes` 是受信任前景執行的捕獲預算，用於必須解析完整有界 stdout 的消費端；面向模型的 bash 工具不公開該欄位。`sandboxPolicy` 在請求上選填，在已解析 spec 上必填但可為 null：它攜帶完整的每次呼叫模式與工作區根目錄。沙盒工具路徑透過 `ctx.sandboxPolicy` 從呼叫工作階段解析它；沙盒執行器的直接呼叫方回退到部署策略，非沙盒執行器則攜帶該欄位但不作限制。

每工作階段沙盒模式覆蓋詞彙（`'sandbox/mode'` 事件、`effectiveSandboxMode(events)` fold 以及 `setSandboxMode(session, mode)` 寫入路徑）不位於此處。它是所有強制執行家族共享的策略狀態，屬於 [`@deepseek-ai/dsh-sandbox-policy`](../../sandbox/sandbox-policy/)。`run()` 返回 `ShellRunResult`；`start()` 返回 `ShellProcess`，其增量讀取與終止方法由 `dsh-tool-bash` 適配為通用任務註冊。沙盒執行器會在前臺結果與已結帳行程控制代碼上標記 `ShellSandboxInfo`。詳見 `src/types.ts` 與 [subsystems/shell.md](../../../docs/subsystems/shell.md)。

`stdin` 與普通 `env` 由同行程外掛程式（hooks 橋接、原生外掛程式）設定，用於向 hook 命令提供其 JSON payload 和 `CLAUDE_PROJECT_DIR`／`CLAUDE_PLUGIN_ROOT` 值。`dshEnv` 是受類型限制、僅允許受管 key 的獨立受信任 overlay；匯出的 `DSH_ENV_PREFIX` 是該 namespace、其 `DshEnvironmentKey` 樣板類型、執行器清理、登錄檔驗證、派生內建名稱與模型指引的統一來源。模型 bash 使用 `ctx.shellEnv` 收集的當前快照。實作會移除繼承的受管 key，再在普通 `env` 之後合併 `dshEnv`，因此省略的當前事實不會回退到過時環境狀態，`env` 條目也無法頂掉受管值。面向模型的工具不將這三者中的任何一個公開為參數。這三者在已解析 spec 上仍然選填；缺失表示沒有輸入／overlay。詳見 [bash-stdin-env Agent Note](../../../.agents/notes/implemented/architecture/2026-06-30-bash-stdin-env-trusted-plugin-api.md) 與 [工作階段環境 Agent Note](../../../.agents/notes/implemented/feature/2026-07-10-agent-session-identity-and-log-location.md)。

匯出的 `parseExitStatus`（連同 `ParsedExitStatus`）是 shell 工具共享算繪約定的另一半：`dsh-tool-bash` 的 `renderResult` 與 `dsh-tool-pwsh` 的 `renderPwshResult` 追加的 `[exit code: N]`／`[killed by signal: X]` marker 的逆解析。兩個工具的 `presentResult` 都用它把算繪文字拆成 terminal 卡的輸出正文與其結束狀態 pill；它放在 Service Definition 中，兩個工具便永遠不會在 marker 約定上漂移。

## 模型體驗

透過 `dsh-tool-bash` 間接影響；該工具會將執行器輸出與沙盒事實轉為指引和保留的工具結果 token。

#### KV Cache 影響

不會直接導致 KV Cache 失效；請求前綴變更由具名消費端負責。

## 已知限制與暫緩事項

- **沒有互動式輸入詞彙**：`stdin` 只會在 spawn 時寫入一次並關閉；seam 不提供向執行中任務繼續輸入的通道，也沒有 PTY 工作階段概念。
- **前臺逾時始終由執行器負責**：seam 上由呼叫方負責 deadline 的模式已由 [工具呼叫逾時策略 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-07-tool-call-timeout-policy.md) 明確暫緩。
