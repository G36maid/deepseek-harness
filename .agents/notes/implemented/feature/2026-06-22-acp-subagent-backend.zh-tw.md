# Agent Note: ACP subagent 後端（行程外委派）

Status: implemented

[English](2026-06-22-acp-subagent-backend.md) | [简体中文](2026-06-22-acp-subagent-backend.zh.md) | 繁體中文

## 問題

subagent seam（[seam Agent Note](2026-06-21-subagent-capability-seam.md)）的設計使多個後端可以按名稱共存於 `ctx.subagents`。行程內後端（`-spawn`/`-fork`）將子 agent（代理）作為第二個 `Agent` 執行在同一個 Cordis 上下文中：開銷低，但子 agent 與父 agent 共享行程、模型用戶端和工具。seam 的核心意義在於同時支持透過協議到達的行程外子 agent，以證明該抽象可跨行程邊界適用。本 Agent Note 新增第一個此類後端：一個 ACP（Agent Client Protocol）用戶端。

## 決策

`@deepseek-ai/dsh-subagent-acp` 註冊一個 `SubagentProvider`，將每個子 agent 執行在一個透過 spawn 啟動的子行程中，並以 ACP *用戶端*身份驅動程式它。它是現有伺服器端橋接 `@deepseek-ai/dsh-acp`（ACP *agent*）的方向反轉孿生體：橋接應答 `initialize`/`newSession`/`prompt`；本後端呼叫它們並實作 `Client` 回呼（`sessionUpdate`、`requestPermission`）。將設定的 spawn 命令指向 `acp-agent` 示例，即可讓 harness 與自身行程通訊。

### 每次執行啟動全新行程

每次 `start` 都 spawn 一個新的子行程，執行恰好一個 ACP 工作階段（`initialize` → `newSession` → `prompt`），`dispose` 殺死子行程並等待其退出。這是最簡單的生命週期，與行程內「每次執行一個子 agent」的形態一致。

### 最小化用戶端樁

用戶端不聲明任何選填能力（無 `fs`、無 `terminal`）：子 agent 在自己的行程中自行處理文件/終端機訪問。`session/update` 通知被消費：後端將 `agent_message_chunk` 文字累積為結果輸出，忽略其餘內容（思考、工具呼叫卡片），因此僅暴露子 agent 的最終回答。`session/request_permission` 由設定的策略自動應答（`reject` 拒絕所有提示，`allow` 透過第一個表示允許的選項批准）——不向人類暴露任何權限提示。將 `fs`/`terminal` 代理回父行程（共享工作區模式）仍為後續工作，如 seam Agent Note 所述。

### 無啟動時能力

提供方的 `capabilities` 全部為 `false`。行程外子 agent 無法遵守父 agent 的 `maxDepth`（它無權訪問 `parent.options.subagentDepth`）或 `toolFilter`（它擁有自己的工具登錄檔），本階段也未實作 `outputSchema`。如果請求需要其中任何一項，服務在 `start` 執行前即拒絕。後端僅注入 `subagents`（而非 `ctx.agents`）；它從 `request.parent` 讀取的唯一內容是工作階段 header 的 cwd（見下方工作區解析）——對話上下文、深度和工具狀態都不會跨越行程邊界。

### 工作區 cwd 解析

子行程工作目錄來自顯式解析，絕不使用 harness 行程的 cwd：若已設定部署 `cwd` 覆蓋，則相對於啟動目錄將其轉為絕對路徑並在載入時驗證；否則使用父工作階段 header 的 cwd 並在啟動時驗證；如果兩者都不存在，則在 spawn 任何行程前響亮拒絕。一個 ACP 伺服器端行程會服務來自多個工作區的工作階段，因此 `process.cwd()` 不能代替工作階段工作區——舊的隱式回退會讓子行程在伺服器端啟動目錄中執行。候選路徑必須是 harness 可以進入的絕對目錄（要求 `X_OK`；僅 `statSync().isDirectory()` 會接受 mode-600 的目錄，而 spawn 會因 EACCES 失敗）；解析出的同一路徑同時用作子行程 cwd 與 ACP `session/new` 工作區。

### StopReason 對映

ACP `StopReason` → harness `SubagentStopReason`：`end_turn`→`completed`、`max_tokens`→`max-tokens`、`refusal`→`refusal`、`cancelled`→`aborted`、`max_turn_requests`→`error`（無對等語義，任務未完成）、未知→`error`。spawn/傳輸/RPC 失敗時，結果為 `error`（如果已請求取消則為 `aborted`）；按 seam 約定，`result` 在子 agent 等級失敗時從不 reject。

### 安全：清洗子行程環境

子 agent 是獨立行程，因此會繼承環境變數。形如憑證的環境變數（`/KEY|PASSWORD|SECRET|TOKEN/i`）默認不轉發——父 harness 自身的金鑰不得隱式洩露到 spawn 啟動的行程中（與 bash 執行器採用的策略相同）。子 agent 自己的憑證（它需要模型金鑰）透過 `config.env` 顯式提供，在清洗之後疊加，因此有意傳入的 `DEEPSEEK_API_KEY` 得以保留，而偶然存在的 `AWS_SECRET_ACCESS_KEY` 則不會。子行程的 stderr 繼承到父行程的 stderr（診斷資訊自然浮現）；spawn 等級的 `error` 事件（如命令不存在時的 ENOENT）被捕獲並與 ACP 驅動程式競速，因此錯誤命令的結果為 `error` 而非以未處理錯誤崩潰父行程。

## 測試

- **無需金鑰的單元/整合測試：** 一個指令碼化的 ACP 子行程透過真實 stdio 測試提示詞輸入／輸出流程、所有 stop-reason 對映、訊號與 dispose 取消（包括 pre-abort、工作階段前競態和管道斷裂場景）、兩種權限策略、被忽略的非訊息更新、命令缺失時的清理、提供方重載以及命名空間匯出。
- **無需金鑰的 Loader 組合測試：** 僅用於測試的 cordis.yml 透過真實 Loader 啟動 stdio 應用，並省略後端的 `cwd`；指令碼化模型委派一次，指令碼化子行程則證明它在父工作階段工作區中執行，且 ACP 也對外公佈了該工作區，從而端到端覆蓋 cwd 繼承分支。
- **需要金鑰的 e2e 測試：** 後端 spawn 真實的 ACP 示例；其模型回答 `PONG`，寫入 `proof.txt`，父行程驗證該文件。
- **快照缺口：** 每個 ACP 子 agent 是獨立行程，擁有自己的重播工作階段，不同於行程內的按工作階段重播。已有確定性 mock 伺服器覆蓋；`TODO(acp-subagent-replay)` 跟蹤父行程對重播中子 agent 的重播支持。

## 曾考慮的替代方案

### 為何繼續使用 SDK 0.25.1？

後端只需要 `ClientSideConnection`、`ndJsonStream`、`PROTOCOL_VERSION` 和用戶端協議類型，0.25.1 全部支持。0.28 的 fluent API 需要在 ACP 層同時遷移用戶端和伺服器端連線類，卻不會改善本後端，因此升級作為獨立變更保留。

### 為何不使用持久子行程？

持久行程池（跨執行複用熱子行程）是一項效能最佳化，推遲到後續工作。它增加了工作階段生命週期和當機復原的複雜度，本階段不需要；每次 `start` spawn 全新子行程與行程內「每次執行一個子 agent」的形態一致。

## 後果

每次執行都要付出一個全新子行程的代價（spawn + `initialize` + `newSession`）。父行程僅暴露子 agent 的最終回答：`session/update` 中的思考和工具呼叫卡片被消費後丟棄，權限提示從不到達人類——由設定的策略應答。子行程環境默認經過憑證清洗，因此其自身的模型金鑰需透過 `config.env` 顯式提供。

## 兄弟產品提供方

[Codex app-server 與 Claude Code Agent SDK 提供方](2026-08-04-claude-code-and-codex-subagent-backends.md)作為按名稱註冊的兄弟提供方，採用同樣的行程外啟動/提示詞/結帳/取消邊界。A2A 仍是未來的兄弟傳輸方式；ACP 後端證明瞭 subagent seam 能夠支持這項邊界，而無需負責產品私有協議。
