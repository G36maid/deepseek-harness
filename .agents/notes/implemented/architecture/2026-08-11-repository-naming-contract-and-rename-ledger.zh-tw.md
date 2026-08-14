# Agent Note: 倉庫命名約定與預發布重新命名清單

Status: implemented

[English](2026-08-11-repository-naming-contract-and-rename-ledger.md) | [简体中文](2026-08-11-repository-naming-contract-and-rename-ledger.zh.md) | 繁體中文

## 問題

倉庫的發展速度曾超過部分名稱的演進速度。一些包名描述的是最初的實作，而非所提供的能力。若干類即使實際承擔登錄檔、執行時期、引擎、控制器或解析器的職責，名稱仍使用 `Service`。部分 `ctx` 鍵以單數命名登錄檔，卻以複數命名單個引擎。還有一些提供方明明透過可替換的檔案系統或子行程服務工作，可以在另一執行環境中執行，名稱卻使用 `local`。

這些名稱並非無關緊要。名稱會告訴貢獻者一項職責從哪裡開始、到哪裡結束。`Store` 表示資料訪問。`Registry` 表示註冊與尋找。`Runtime` 表示即時執行和生命週期。如果同一個詞同時表示這三者，呼叫方就必須閱讀實作，才能判斷哪個對象擁有策略、工作或狀態。

倉庫還曾在兩種含義下使用 `SDK`。受支持的 Python 和 TypeScript 用戶端使用 JSON-RPC SDK 協議。項目整體是 DeepSeek Harness，而不是 SDK 項目。已移除的 SDK 項目工具鏈使寬泛的含義失去依據，但文案和名稱仍保留了部分舊用法。

首次發布帶標籤版本之前的最後一個視窗，使倉庫級重新命名仍可低成本完成。若繼續保留含義不清的名稱，偶然形成的詞彙就會變成相容性約定。

## 決策

倉庫使用本清單中的全部當前名稱。本決策只更改名稱；包職責、服務邊界、行為、預設值和資料模型保持不變。如果某個名稱暴露出不合理的邊界，需要另寫一份 proposed Agent Note，專門提議邊界變更。

每個已重新命名系列只有一套詞彙。清單點名某一介面時，其目錄、NPM 包名、匯入、Cordis 外掛程式名稱、`ctx` 鍵、公開類型、直接耦合的事件或工具識別符號、設定、測試、fixture（測試前置資料）、示例、生成的參考資料以及當前文件都使用當前名稱。倉庫不保留別名、相容包、重複的服務鍵、雙重事件名稱或回退解析器，並拒絕舊名稱。

同一系列不會公開兩套詞彙。

### `SDK` 只表示一件事

`SDK` 表示受支持的 Python 和 TypeScript SDK 所使用、基於 JSON-RPC 的用戶端／伺服器協議。倉庫保留 `@deepseek-ai/dsh-sdk-client`、`@deepseek-ai/dsh-sdk-protocol` 和協議身份 `deepseek-harness-sdk-runtime`；JSON-RPC 伺服器屬於同一系列。DeepSeek Harness 本身不是 SDK，已移除的項目生成器、啟動器、輔助工具和啟動器遙測包繼續保持不存在。

本決策部分取代三項現行決策。它替換[包重新分組決策](2026-07-29-package-regrouping.md)中保留的 `bash/`、`pty/` 和 `self-modification/` 組名，以及兩項暫定包名。它只替換[移除 SDK 項目工具鏈](../simplification/2026-08-11-remove-sdk-project-toolchain.md)中將整個倉庫稱為 SDK 的說法；後者仍負責說明刪除範圍和保留的執行時期 SDK。它只替換[工具呼叫逾時策略](2026-07-07-tool-call-timeout-policy.md)中的包名理由；逾時機制及其 `guard/timeout-policy/` 歸屬保持不變。

如果其他已實作說明中的包、路徑或類型被重新命名，而其邊界和理由保持不變，則本決策不會取代這些說明。這些說明使用已實作的事實名稱。三項被部分取代的決策都連結回本決策。

### 按實際職責命名

使用常見且具體的名詞。名稱應描述穩定職責，而不是最初的實作、當前目錄或未來可能出現的擴充。不得新增不傳遞任何資訊的詞。不得為了縮短名稱而刪除用於限定作用域的詞。

介面包以能力命名。實作包增加機制、協議、環境或供應商限定詞，以區分不同實作。只有同主機執行屬於約定時，才能使用 `local`。如果提供方只是透過可替換的 `ctx.fs` 讀取看似本機的路徑，或透過可替換的 `ctx.subprocess` 啟動工作，就不得使用該詞。

如果對象是單個引擎、執行時期、策略、控制器、解析器、儲存或當前設定，使用單數 `ctx` 鍵。如果對象是登錄檔，或服務擁有多個具名成員，使用複數鍵。類的職責和鍵的單複數必須一致。複數鍵本身不能證明對象是登錄檔；應由其操作和所有權決定。不得讓不相容的 host 與 client 聲明複用同一個 Cordis `Context` 鍵。即使二者使用獨立的執行時期上下文，TypeScript 聲明合併仍會同時看到兩種類型。如果自然複數已經屬於另一個端面，就增加職責後綴。

僅當沒有更精確的職責詞能夠如實描述對象時，才使用 `Service`。`GoalService` 和 `SessionTitleService` 是保留的有效名稱，因為它們各自擁有領域服務，其工作無法準確歸約為儲存、註冊或單一執行機制。

### 職責詞即約定

| 詞 | 適用場景 | 不適用場景 |
|---|---|---|
| `Controller` | 對象接受命令或使用者意圖，並更改一項已有的領域狀態或呈現狀態。它協調有界的狀態轉換。 | 對象執行任意工作、管理一組提供方，或僅將值轉換為顯示形式。 |
| `Store` | 對象擁有一組資料，主要對這些資料提供建立、讀取、更新、刪除、快照或訂閱操作。 | 對象驗證狀態機、行使裁決權、分派工作、決定提供方優先級，或協調多個領域。類內部存在對映並不會讓該類成為儲存。 |
| `Directory` | 對象公開條目，供發現或選擇。消費端會查詢有哪些選項，並讀取其元資料。 | 生產方可向其中註冊任意實作，或呼叫方透過它執行工作。目錄可以由登錄檔支撐，但兩者的對外職責並不相同。 |
| `Presenter` | 對象只負責將領域值或工具參數轉換為渲染意圖。它不擁有 I/O、訂閱、變更或生命週期。 | 對象讀取服務、更改狀態或控制工作執行時期機。這些職責屬於控制器或執行時期。 |
| `Registry` | 對象擁有一組動態的具名註冊項。它定義尋找規則、重複項或優先級規則、註冊生命週期和資源釋放。 | 呼叫方的主要約定是分派、執行、取消、策略執行或編排。執行時期可以在內部包含登錄檔。 |
| `Runtime` | 對象執行即時工作。它跨呼叫擁有分派、取消、提供方協調或操作生命週期。 | 對象只儲存記錄、返回目錄、解析單個值或保存設定。`Runtime` 不是 `Service` 的通用替代詞。 |
| `Resolver` | 對象根據所提供的輸入計算或定位一個答案，通常不擁有答案的生命週期。 | 對象擁有可變集合或長時間執行的執行生命週期。 |
| `Binder` | 對象將一個已聲明介面附加到呼叫方的上下文或生命週期，並返回綁定後的值。 | 對象以集合形式擁有綁定值、控制其領域狀態，或僅轉換資料。 |
| `Engine` | 對象實作領域演算法或有狀態執行模型，例如工作流程、壓縮或查詢求值。 | 對象只選擇提供方，或跨協議邊界轉發請求。 |
| `Policy` | 對象決定允許、選擇、限制或觀察什麼。 | 對象執行決策所允許的機制。策略和執行器必須分別命名。 |
| `Executor` | 對象在一項能力內執行明確的請求或已解析的規範。 | 對象擁有寬泛的應用生命週期或提供方目錄。 |
| `Gateway` | 對象適配行程、網路、RPC 或 API 邊界，並在兩側之間轉換。 | 對象只註冊同進程服務或儲存元資料。 |
| `Provider` | 對象為一項能力定義提供一種實作。如果可以存在多個提供方，應增加機制或供應商限定詞。 | 對象是能力定義、提供方登錄檔或面向消費端的執行時期。 |
| `Backend` | 對象在已定義介面之後，實作可替換的底層持久化、傳輸或執行後端。 | 對象是面向使用者的服務，或只是對某個即時對象返回的引用。 |
| `Handle` | 該值是對一個即時資源的引用，並控制或觀察該資源。 | 對象建立並管理整個資源池。不得使用 `Owner` 或含義模糊的 `Resource`；如果 `Handle` 或更精確的管理職責合適，就應採用後者。 |
| `Config` | 對象擁有一個已解析的設定值，或一份邊界嚴格受限的設定記錄及其更新約定。 | 物件儲存通用集合、執行工作或公開不相關的設定。 |
| `Service` | 對象擁有一項職責內聚的領域服務，且以上更精確的職責詞都無法如實描述其職責範圍。 | 僅因為類繼承自 Cordis `Service` 而使用該名稱，或因為確定真正的職責需要進一步思考。 |

實用判斷方式很直接。如果呼叫方主要呼叫 `register()` 並收到資源釋放函式，應使用 `Registry`。如果呼叫方主要呼叫 `run()`、`dispatch()`、`cancel()` 或 `execute()`，應使用 `Runtime`、`Engine` 或 `Executor`。如果呼叫方主要瀏覽選項，應使用 `Directory`。如果對象主要將一份規範綁定到呼叫方擁有的上下文和生命週期，應使用 `Binder`。如果對象只將領域資料對映為 UI 資料，應使用 `Presenter`。如果它還會更改狀態，就不是呈現器。

### 使用能夠補充資訊的限定詞

如果協議或方言名稱能夠區分實作，就應保留。實作相依性相應機制時，保留 `Bash`、`Pwsh`、`JSON-RPC`、`SQLite`、`JSONL`、`OpenTelemetry`、`Claude Code` 和 `E2B`。每個當前後端都已使用 LLM（大型語言模型）seam 時，不要在壓縮後端名稱中加入 `LLM`；在出現更具體的演算法名稱之前，`basic` 纔是如實且中性的名稱。

不得虛構 `process sandbox` 概念。當前 `sandbox` 系列已經準確命名其產品職責。本決策不改變該職責。

PascalCase 識別符號中的首字母縮略詞使用首字母大寫格式：`Ui`、`Llm`、`JsonRpc` 和 `ApiProxy`。在文案和適用的包名中使用慣例規定的全大寫形式：UI、LLM、JSON-RPC 和 API。`Typert` 是識別符號和文案中的唯一準確產品拼寫；不得寫成 `TypeRT`、`TypeRt`，也不得對 `Typert` 作其他內部拆分。

不得為了避免重複而刪除有意保留的供應商限定詞。`dsh-subagent-dsh-sdk` 表示 DeepSeek Harness SDK 提供方，可避免與其他 SDK 混淆。其私有類改名為 `SdkSubagentProvider`，因為類名還需要說明它提供什麼。

### 將規則寫入項目文件

配對的包建立指南 `docs/cookbook/adding-a-package.md` 包含完整的職責詞約定，`packages/AGENTS.md` 連結到該約定。術語表和根項目說明使 `SDK` 和 `Typert` 各自只有一種含義。本 Agent Note 負責記錄理由和被否決的替代方案；指南負責記錄貢獻者應遵循的規則。

## 重新命名清單

以下表格記錄公開名稱和倉庫級名稱的變更。`当前名称` 欄記錄當前名稱。引用相同職責的私有區域性變數也使用相同詞彙。若寬泛替換並不正確，清單會明確指出保留的底層名稱或產品可見名稱。

### 執行時期 SDK

| 舊名稱 | 當前名稱 | 理由 |
|---|---|---|
| `@deepseek-ai/dsh-jsonrpc` | `@deepseek-ai/dsh-sdk-jsonrpc-server` | 它是 SDK 協議的伺服器端。單獨使用 `jsonrpc` 只說明編碼；`sdk-jsonrpc-server` 則同時說明所屬系列、機制和職責。 |
| `HarnessSdkServer` | `HarnessSdkJsonRpcServer` | 該類是 JSON-RPC 伺服器的一種實作，並不代表所有可能的 SDK 伺服器。 |

保留 `@deepseek-ai/dsh-sdk-client`、`@deepseek-ai/dsh-sdk-protocol` 和 `deepseek-harness-sdk-runtime`。排除 `@deepseek-ai/create-sdk`、`@deepseek-ai/dsh-scripts`、`@deepseek-ai/dsh-helper` 和 `@deepseek-ai/dsh-telemetry`；單獨的移除決策負責刪除這些包及其支撐相依性圖。

### Shell 與終端機

| 舊名稱 | 當前名稱 | 理由 |
|---|---|---|
| `packages/bash/` | `packages/shell/` | 該組包含方言無關的執行器 seam、Bash 和 PowerShell 實作、環境支持以及 shell 工具。 |
| `@deepseek-ai/dsh-bash`, `ctx.bash` | `@deepseek-ai/dsh-shell`, `ctx.shell` | PowerShell 已經實作該 seam。此項能力是 shell 執行，而不是 Bash。 |
| 方言無關的 `BashExecutor`、`BashExecRequest`、`BashExecSpec`、`BashProcess`、`BashRunResult`、`BashSandboxInfo`、`BashProcessRead` 和 `BashProcessStatus` 名稱 | 對應的 `Shell*` 名稱 | 這些類型橫跨 Bash 和 PowerShell 實作。描述 Bash 文法或行為的葉層類型保留 `Bash`。 |
| `BASH_SETTINGS_NAMESPACE`，設定命名空間 `bash` | `SHELL_SETTINGS_NAMESPACE`，設定命名空間 `shell` | 兩個 shell 提供方都註冊這項由能力擁有的設定分區。常數和持久化命名空間必須使用能力名稱。 |
| `@deepseek-ai/dsh-bash-env`, `ctx.bashEnv`, `BashEnvRegistry` | `@deepseek-ai/dsh-shell-env`, `ctx.shellEnv`, `ShellEnvRegistry` | Bash 和 PowerShell 工具共享該環境登錄檔。 |
| `docs/subsystems/bash.md` | `docs/subsystems/shell.md` | 該子系統頁面記錄方言無關的能力。 |
| `packages/pty/` | `packages/terminal/` | 該包系列負責持久終端機工作階段。原始 PTY 分配仍位於子行程層。 |
| `@deepseek-ai/dsh-pty`, `ctx.pty`, `PtyService` | `@deepseek-ai/dsh-terminal`, `ctx.terminals`, `TerminalSessionService` | 呼叫方管理多個具名終端機工作階段，而不是透過該服務分配原始 PTY。 |
| 公開的高層 `Pty*` 工作階段和後端名稱 | `Terminal*` 名稱 | 公開抽象是終端機工作階段。保留底層 `SubprocessTerminal*` 名稱，因為它們已經說明底層機制。 |
| `@deepseek-ai/dsh-pty-local`, `LocalPtyBackend` | `@deepseek-ai/dsh-terminal-bash`, `BashTerminalBackend` | 該提供方相依性 Bash 提示符和 shell 行為。`local` 隱藏了實際方言。 |
| `@deepseek-ai/dsh-tool-pty` | `@deepseek-ai/dsh-tool-terminal` | 面向模型的工具已使用 `terminal_*`；包應採用相同的產品名詞。 |
| 原 PTY 系列中的 `tool-bash-persistent` | `shell/tool-bash-persistent/` | 該工具是 Bash 工具，應與 shell 工具放在一起。保留其 NPM 名稱：`persistent` 將它與一次性 `bash` 區分開來，而 `bash-terminal` 會混淆產品工具與終端機工作階段系列。 |
| `docs/subsystems/pty.md` | `docs/subsystems/terminal.md` | 該頁面記錄終端機工作階段，而不是原始 PTY 分配。 |

保留 Bash 和 PowerShell 專用的葉層包、外掛程式 id、類型和工具。這些方言名稱準確無誤。

### 語言伺服器與作業

| 舊名稱 | 當前名稱 | 理由 |
|---|---|---|
| `@deepseek-ai/dsh-lsp-local` | `@deepseek-ai/dsh-lsp-stdio` | 該提供方透過可替換的檔案系統和子行程服務，以 stdio 傳輸 LSP。它不一定在本機執行。 |
| `packages/tasks/` | `packages/jobs/` | 該系列負責脫離前景執行的工具作業。`jobs` 簡短，並可避免與使用者任務或 todo 概念衝突。 |
| `@deepseek-ai/dsh-tasks`, `ctx.tasks`, `TaskService` | `@deepseek-ai/dsh-jobs`, `ctx.jobs`, `JobRegistry` | 該服務註冊、擁有、觀察、等待並取消多個後臺作業。它是登錄檔，而不是通用任務服務。 |
| 公開的 `TaskId`、`TaskKindMap`、`TaskStart`、`TaskHooks`、`TaskOutcome`、`TaskSnapshot`、`TaskRead` 和 `TaskDoneListener` 名稱 | 對應的 `Job*` 名稱 | 這些類型屬於重新命名後的作業領域。`JobId` 比 `BackgroundTaskId` 或 `BgTaskId` 更短、更清晰。 |
| `@deepseek-ai/dsh-tasks-local`, `LocalTaskService` | `@deepseek-ai/dsh-jobs-local`, `LocalJobRegistry` | 這是作業登錄檔的行程內提供方。此處的 `local` 有明確含義，因為作業和回呼都存在於同一行程。 |
| `@deepseek-ai/dsh-tool-tasks` | `@deepseek-ai/dsh-tool-jobs` | 消費端控制作業登錄檔，應使用相同的領域名詞。 |
| `ToolTasks`、`toolTasks`、`ToolTasksConfigSchema`、`PublicTaskSnapshot`、`publicTask`、`validateTaskId` | 對應的 `*Jobs`、`*Job*` 與 `validateJobId` 名稱 | import、轉發設定、公開工具值與輔助函式都屬於同一個作業領域。包重新命名後繼續保留 `Task`，會為同一功能製造第二套詞彙。 |
| `task_output`, `task_list`, `task_kill` | `job_output`, `job_list`, `job_kill` | 這些模型工具操作的是作業，而不是使用者任務。`run_in_background` 返回 `JobId`。 |
| `@deepseek-ai/dsh-client-ui-task`、`client/ui-task/` | `@deepseek-ai/dsh-client-ui-jobs`、`client/ui-jobs/` | 該用戶端包呈現後臺作業集合，而不是一項使用者任務。 |
| `TaskView`、線路幀 `session/tasks`、`tasksBySession` | `JobView`、線路幀 `session/jobs`、`jobsBySession` | 瀏覽器約定及其映像檔應採用與登錄檔和工具相同的作業領域名稱。 |
| `docs/subsystems/tasks.md` | `docs/subsystems/jobs.md` | 該子系統頁面必須採用公開的作業詞彙。 |

保留基礎 LSP 包、`ctx.lsp`、LSP 協議類型和 LSP 工具。該 seam 有意公開語言伺服器語義；錯誤的只有提供方限定詞。

### 輸入觸發器、工具呈現、權限預設和使用者問題

| 舊名稱 | 當前名稱 | 理由 |
|---|---|---|
| `@deepseek-ai/dsh-client-ui-slash`, `ui-slash/` | `@deepseek-ai/dsh-client-ui-input-trigger`, `ui-input-trigger/` | 用戶端處理 `/`、`@`、鍵盤仲裁、候選選單和程序化啟動，並非只處理斜槓命令。 |
| `ctx.slash`、`SlashService`、`SlashController`、`SlashSource` | `ctx.inputTriggers`、`InputTriggerService`、`InputTriggerController`、`InputTriggerSource` | 這些名稱覆蓋所有受支持的觸發器，並保留現有的服務、控制器和來源職責。耦合的區域設定和公開類型名稱也改用 `InputTrigger`。 |
| `@deepseek-ai/dsh-agent-tool-mode`，外掛程式 `tool-mode` | `@deepseek-ai/dsh-agent-tool-presentation`，外掛程式 `tool-presentation` | 該外掛程式改變工具向模型呈現的方式，而不改變執行行為。保留區域性 `Config.mode` 和 `ToolPresentationMode`。 |
| `packages/interaction/permission/` | `packages/interaction/permission-presets/` | 該包擁有沙盒與審批設定的具名組合，而不負責執行權限。 |
| `@deepseek-ai/dsh-permission`, `ctx.permission`, `PermissionService` | `@deepseek-ai/dsh-permission-presets`, `ctx.permissionPresets`, `PermissionPresetService` | 該服務選擇並持久化預設。沙盒和審批服務負責執行結果。 |
| `@deepseek-ai/dsh-client-ui-permission` | `@deepseek-ai/dsh-client-ui-permission-presets` | UI 編輯和選擇權限預設。 |
| `docs/subsystems/permission.md` | `docs/subsystems/permission-presets.md` | 該頁面記錄預設選擇，而不是權限執行。 |
| `@deepseek-ai/dsh-user-interaction`, `user-interaction/` | `@deepseek-ai/dsh-user-questions`, `user-questions/` | 該 seam 僅支持批次問題和答案。審批、命令和目錄選擇屬於其他互動 seam。 |
| `ctx.userInteraction`, `UserInteractionService`, `UserInteractionProvider`, `UserInteractionError` | `ctx.userQuestions`, `UserQuestionService`, `UserQuestionProvider`, `UserQuestionError` | 這些名稱說明唯一受支持的互動形式。保留 `AskUserQuestion*`、`ask_user_question` 工具和 `@deepseek-ai/dsh-tool-ask-user`。 |
| `docs/subsystems/user-interaction.md` | `docs/subsystems/user-questions.md` | 該頁面只記錄問題和答案。 |

保留 `/permission`、`permissions` 投影、`permission` 設定命名空間和 `permission/preset`；它們都是準確的產品詞彙或持久化詞彙。保留完整名稱 `PermissionPresetSettingsController`。刪除 `Preset` 會去掉限定其權限的詞。移除 `both` 工具呈現模式的工作仍推遲到另一份提案；本次重新命名不移除行為。

### Typert、API 閘道與工具

| 舊名稱 | 當前名稱 | 理由 |
|---|---|---|
| `packages/typert/type-meta/`, `@deepseek-ai/dsh-type-meta` | `typert/protocol/`, `@deepseek-ai/dsh-typert-protocol` | 該包擁有 Typert Remote 協議、裝飾器、綁定、編解碼器、尋找邏輯和上下文約定。它不是通用類型元資料。 |
| 協議包中的 `GatewayService` | `TypertRemoteService` | 該基類標記要匯出為 Remote 的同進程服務。它不是 API 閘道。 |
| `bindTypeRTGateway`、`typertGateway` 綁定 | `bindTypertRemote`、`typertRemote` | 這些綁定公開 Typert Remote 服務，而非具體的 API 閘道服務。 |
| 公開的 `TypeRT*` 識別符號和小駝峯形式的 `typeRT*` 識別符號 | `Typert*` 和 `typert*` | `Typert` 是唯一規範的產品拼寫。 |
| 協議介面 `TypeRTService` | `TypertRegistryContract` | 該協議擁有的介面是現有具體類 `TypertRegistry` 所實作的相依性倒置介面。不同的後綴可避免匯入和聲明衝突。 |
| `ToolRegistry` | `ToolRuntime` | 該類擁有呈現、審批與防護策略、分派、取消、驗證、終結和觀察。註冊只是內部組成部分。 |
| `ToolRegistryScheduler`, `TOOL_REGISTRY_SCHEDULER` | `ToolRuntimeScheduler`, `TOOL_RUNTIME_SCHEDULER` | 調度器控制執行時期分派，而不是註冊。 |

保留 `@deepseek-ai/dsh-tools` 和 `ctx.tools`。保留 `@deepseek-ai/dsh-api-gateway`、其 `gateway/` 目錄、`ctx.typertGateway` 以及 `TypertGatewayService`；該服務是真正的 API 閘道。其內部的 `TypeRT*` 識別符號仍應遵循 `Typert*` 拼寫規則。

### 工作區指令、遙測、身份和啟動環境

| 舊名稱 | 當前名稱 | 理由 |
|---|---|---|
| Host `ctx.workspace` | Host `ctx.workspaceRegistry` | `WorkspaceRegistry` 擁有多個工作區，但 Client `ctx.workspaces` 已經使用不相容的類型。即使二者執行時期上下文獨立，兩份聲明仍會在編譯時合併進同一個 Cordis `Context` 介面。職責後綴明確指出 host 服務，並避免該衝突。保留 `@deepseek-ai/dsh-workspace`、`WorkspaceRegistry`、`Workspace` 和 `workspace.*` 協議名稱。 |
| `@deepseek-ai/dsh-workspace-context`, `context/workspace-context/` | `@deepseek-ai/dsh-agent-instructions`, `context/agent-instructions/` | 該包為 agent（代理）載入分層的 `AGENTS.md` 和 `CLAUDE.md` 文件。它並非通用工作區上下文。 |
| 外掛程式名稱和持久來源名稱 `workspace-context` 與 `workspace-instructions` | `agent-instructions` | 記錄的來源是一類具體的 agent 指令。以 `AgentInstruction*` 替換公開的 `WorkspaceInstruction*` 名稱。該術語不包括系統訊息、開發者訊息或使用者訊息。 |
| `ctx.telemetry`、抽象類 `Telemetry` | `ctx.sessionTelemetry`、`SessionTelemetryBackend` | 該服務捕獲工作階段帳本遙測，並交給報告後端。它不是倉庫級指標或追蹤服務。 |
| `TelemetryBackend` | `SessionTelemetrySink` | 該底層接收已寄出的記錄。`Sink` 用於將它與協調型後端服務區分開。 |
| `TelemetryCoordinator`、`TelemetryRecord`、`TelemetrySeverity`、`TelemetrySharingStatus` 和 `TelemetryCapture` | 對應的 `SessionTelemetry*` 名稱 | 這些公開類型只屬於工作階段遙測。 |
| `telemetry/record` | `session-telemetry/record` | 事件名稱必須說明所屬領域。 |
| `TelemetryOtel`、`TelemetryMode`，外掛程式 `telemetry-otel` | `OpenTelemetrySessionBackend`、`SessionTelemetryMode`，外掛程式 `session-telemetry-otel` | 提供方名稱同時說明 OpenTelemetry 機制和工作階段作用域。保留包名 `dsh-session-telemetry` 和 `dsh-session-telemetry-otel`。 |
| `docs/subsystems/telemetry.md` | `docs/subsystems/session-telemetry.md` | 該頁面記錄工作階段遙測，而不是倉庫級可觀測性。 |
| `session/user-id/`, `@deepseek-ai/dsh-user-id` | `identity/anonymous-user-id/`, `@deepseek-ai/dsh-anonymous-user-id` | 該值是遙測、回饋和 DeepSeek 請求共用的隨機關聯 id。它既不屬於 Session 領域，也不是經過身分驗證的使用者身份。 |
| `USER_ID_FILE_NAME`、`.userid`，回饋標籤 `User` | `ANONYMOUS_USER_ID_FILE_NAME`、`.anonymous-user-id`，回饋標籤 `Anonymous user` | 文件和 UI 不得暗示帳戶身份。保留現有 `AnonymousUserId` 函式和標準 OTel 屬性 `user.id`。 |
| `util/environment/`, `@deepseek-ai/dsh-environment` | `util/launch-environment/`, `@deepseek-ai/dsh-launch-environment` | 該包在啟動時捕獲一份不可變的分層快照。它不是通用環境 API。 |
| 公開的 `Environment*`、`createEnvironmentSnapshot`、`environmentOf`、`DSH_ENVIRONMENT_KEY` | `LaunchEnvironment*`、`createLaunchEnvironmentSnapshot`、`launchEnvironmentOf`、`DSH_LAUNCH_ENVIRONMENT_KEY` | 這些名稱說明快照的生命週期和用途。 |
| `ctx.launcherEnvironment` | `ctx.launchEnvironment` | 該值描述應用啟動，而不只描述啟動器元件。保留來源標籤 `process`、`project-env` 和 `user-env`。 |

### 日程、工作流程、目標與壓縮

| 舊名稱 | 當前名稱 | 理由 |
|---|---|---|
| `@deepseek-ai/dsh-tool-schedule`、`schedule/tool-schedule/`、外掛程式 `tool-schedule` | `@deepseek-ai/dsh-schedule`、`schedule/schedule/`、外掛程式 `schedule` | 該包擁有持久 Schedule 領域、持久化屏障、管理工具、定時器、後續輪次和執行時期生命週期。`tool-` 只描述其中一部分。 |
| `ScheduleOwner` | `ScheduleRuntime` | 該逐 agent 對象執行即時定時器、持久化投影、分派、空閒等待和資源釋放。`Owner` 沒有說明這一執行職責。耦合的私有 `owner*` 名稱也改用 `runtime*`。 |
| `WorkflowService`, `ctx.workflows` | `WorkflowEngine`, `ctx.workflowEngine` | 一個引擎負責解析並執行工作流程序。複數鍵錯誤地暗示這是登錄檔。保留 `@deepseek-ai/dsh-workflow` 以及工作流程事件和工具。 |
| `@deepseek-ai/dsh-workflow-workerthread`, `WorkerWorkflowEngine` | `@deepseek-ai/dsh-workflow-worker-thread`, `WorkerThreadWorkflowEngine` | `worker thread` 是準確的 Node 機制，倉庫拼寫要求使用完整單詞。 |
| `@deepseek-ai/dsh-goal-session`, `goal/goal-session/` | `@deepseek-ai/dsh-goal-round-driver`, `goal/goal-round-driver/` | 該外掛程式驅動程式同一工作階段內的 Goal Rounds。它既不儲存目標，也不定義工作階段。保留 `GoalService`、目標來源、事件和約定。 |
| `packages/compact/` | `packages/compaction/` | 該組是以名詞命名的領域系列。`compact` 仍作為面向使用者的命令動詞。 |
| `@deepseek-ai/dsh-compact`, `ctx.compact`, `CompactService` | `@deepseek-ai/dsh-compaction`, `ctx.compaction`, `CompactionEngine` | 該對象執行壓縮（compaction）演算法和生命週期。它是引擎，而不是通用服務。 |
| `compact/*` 事件和公開領域前綴 | `compaction/*` | 事件和領域類型使用名詞形式。保留動詞形式的操作，例如 `compactNow`、`compactRegion` 和 `compactIfNeeded`。 |
| `@deepseek-ai/dsh-compact-basic`、`BasicCompactService`、公開的 `BasicCompact*` | `@deepseek-ai/dsh-compaction-basic`、`BasicCompactionEngine`、對應的 `BasicCompaction*` | `basic` 樸素但準確。`compaction-llm` 沒有增加資訊，因為當前實作系列已使用 LLM。 |
| `@deepseek-ai/dsh-compact-tool-result-prune`, `ToolResultPruneService`, `ctx.toolResultPrune` | `@deepseek-ai/dsh-compaction-tool-result-pruner`, `ToolResultPruner`, `ctx.toolResultPruner` | 該外掛程式是剪除工具結果的執行主體。名詞 `pruner` 說明瞭這一職責。 |

保留 `/compact`、命令包，以及相互獨立的壓縮定義包和提供方包。合併這些包的提議仍被否決。本次重新命名只改變詞彙，不改變該包邊界。

### 設定、憑據、用戶端模組和較小的核心職責

| 舊名稱 | 當前名稱 | 理由 |
|---|---|---|
| 抽象類 `Settings` | `SettingsProvider` | 該類透過可替換能力提供設定。保留包、鍵和事件。 |
| `@deepseek-ai/dsh-settings-local`, `SettingsLocal` | `@deepseek-ai/dsh-settings-file`, `FileSettingsProvider` | 該實作透過檔案系統 seam 以文件為後端。`file` 說明機制，`local` 則不能。 |
| 抽象類 `Credentials` | `CredentialProvider` | 該類解析憑據引用。保留包名、鍵和事件。 |
| `CredentialsLocal` | `LocalCredentialProvider` | 該提供方讀取宿主行程和 `.env` 狀態，因此本機執行屬於其約定。 |
| `ClientModuleHostService`, `ctx.clientModuleHost` | `ClientModuleRegistry`, `ctx.clientModules` | 該服務擁有多個已註冊的用戶端模組。保留包和瀏覽器端的 `ClientModuleLoader`。 |
| `AgentDefaultModelService` | `AgentDefaultModelConfig` | 該物件儲存一項默認模型選擇。它不執行服務，也不是通用登錄檔。保留其包、鍵、設定命名空間和類型。 |
| `SessionReferenceService`, `ctx.sessionReferences` | `SessionReferenceResolver`, `ctx.sessionReferenceResolver` | 它從 URI 或輸入解析一個工作階段引用，並不擁有引用集合。 |
| `SessionQueryService`, `SessionQuerySqlite` | `SessionQueryEngine`, `SqliteSessionQueryEngine` | 這些類執行查詢模型及其 SQLite 實作。保留包名、鍵和工具。 |
| `@deepseek-ai/dsh-session-export`, `session-export/`, Loader id `session-export`, `ctx.sessionExport` | `@deepseek-ai/dsh-session-log-export`, `session-log-export/`, Loader id `session-log-download`, `ctx.sessionLogDownload` | npm 包名使用 Session 日誌匯出語義，因為 npm 禁止包名包含 `download`。Loader id 與瀏覽器 API 保留 `download`，因為它們描述瀏覽器副作用。 |
| `SessionExportDownloadController`, 其他 `SessionExport*` 瀏覽器類型、`useSessionExport`、`SessionExportHeader` | `SessionLogDownloadController`, 對應的 `SessionLogDownload*` 類型、`useSessionLogDownload`、`SessionLogDownloadHeaderAction` | 該 controller 擁有預檢、重複請求合併、彈出視窗狀態和瀏覽器保存。`ExportDownload` 重複表達同一動作，該元件貢獻的是一個 Header action，不是整個 Header。 |
| 宿主命令包中的 `CommandService` | `CommandRuntime` | 該對象跨即時呼叫註冊並執行宿主命令。保留其包、鍵、類型和事件。 |
| `TokenMeterService` | `TokenMeter` | 該對象測量 token 用量。`Service` 沒有補充作用域資訊。 |
| `LlmService` | `LlmRuntime` | 該對象選擇提供方並執行即時模型請求。保留包、鍵、配接器和事件。 |

### Host Web 伺服器、工作階段資料與程式碼執行

| 舊名稱 | 當前名稱 | 理由 |
|---|---|---|
| `HttpServerService`, `ctx.httpServer` | `WebServer`, `ctx.webServer` | 該伺服器擁有 HTTP 路由和 WebSocket 升級路由。`Web` 可以同時涵蓋兩者；此處的 `Http` 作用域過窄。保留 `packages/host/webserver`、`@deepseek-ai/dsh-host-webserver`、`WebRoute` 和 `WebUpgradeRoute`。 |
| 文件子系統標籤 `http-server` | `web-server` | 子系統標籤必須與服務採用相同作用域。 |
| `SessionPersistenceJsonl` | `JsonlSessionPersistence` | 將實作限定詞放在前面，同時完整保留能力職責。 |
| `SessionPersistenceSqlite` | `SqliteSessionPersistence` | 採用與 JSONL 相同的提供方命名順序。 |
| `@deepseek-ai/dsh-session-title-first-message-llm`，觸發週期 `first-message` | `@deepseek-ai/dsh-session-title-first-prompt-llm`，觸發週期 `first-prompt` | 觸發條件是第一條使用者提示詞，而不是工作階段日誌中的任意訊息。 |
| `@deepseek-ai/dsh-session-title-all-messages-llm`，觸發週期 `all-user-messages` | `@deepseek-ai/dsh-session-title-all-prompts-llm`，觸發週期 `all-prompts` | 後端根據使用者提示詞刷新。`all messages` 會錯誤地包含助手訊息和工具事件。 |
| `@deepseek-ai/dsh-code-runtime-worker`, `WorkerCodeRuntime` | `@deepseek-ai/dsh-code-runtime-worker-thread`, `WorkerThreadCodeRuntime` | 該實作使用 Node 工作執行緒。單獨的 `worker` 作用域過寬。 |
| `SubprocessService` | `SubprocessRuntime` | 該服務擁有即時子行程的執行和生命週期。保留其包和鍵。 |
| `LocalSubprocessService` | `LocalSubprocessRuntime` | 該提供方執行同主機行程和行程樹。 |
| `E2BSubprocessService` | `E2BSubprocessRuntime` | 該提供方在 E2B 執行時期中執行子行程。 |

保留完整的工作階段投影系列和 `SessionProjection*` 詞彙。投影是持續維護的讀取模型；`Reducer` 只說明其摺疊操作，會淡化快取和尋找職責。保留 `SessionTitleService`、檢查點策略、持久化包名、時間上下文和 tmux 上下文。

### 檔案系統、skill、subagent 和 Web 提供方

| 舊名稱 | 當前名稱 | 理由 |
|---|---|---|
| `@deepseek-ai/dsh-fs-policy` | `@deepseek-ai/dsh-fs-observation-policy` | 該包定義哪些檔案系統觀察可以授權後續操作。它不是完整的檔案系統策略或沙盒策略。 |
| `FsPolicyExec` | `FsObservationActor` | 該值表示策略所關聯的觀察與操作的執行主體。它本身不執行策略。 |
| `SkillService` | `SkillRegistry` | 該服務註冊提供方，並從其目錄解析 skill（技能）。 |
| `@deepseek-ai/dsh-skill-local`、`LocalSkillProvider`，提供方 id `local` | `@deepseek-ai/dsh-skill-filesystem`、`FileSystemSkillProvider`，提供方 id `filesystem` | 該提供方透過可位於本機或遠端的 `ctx.fs` 發現 skill 文件。其機制是檔案系統訪問，而不是本機性。 |
| `SubagentService` | `SubagentRuntime` | 該服務選擇提供方，並擁有即時 spawn、復原、跟進、取消和結帳行為。 |
| `@deepseek-ai/dsh-subagent-spawn`, `SpawnProvider` | `@deepseek-ai/dsh-subagent-spawn-in-process`, `SpawnInProcessProvider` | 該提供方在當前行程內啟動子 agent。設定的提供方 id 仍為 `spawn`。 |
| `@deepseek-ai/dsh-subagent-fork`, `ForkProvider` | `@deepseek-ai/dsh-subagent-fork-in-process`, `ForkInProcessProvider` | 該提供方在當前行程內 fork 一個 agent。設定的提供方 id 仍為 `fork`。 |
| `@deepseek-ai/dsh-subagent-inprocess`, `subagent-inprocess/` | `@deepseek-ai/dsh-subagent-in-process-driver`, `subagent-in-process-driver/` | 該包包含通用的行程內驅動程式邏輯，而不是第三個提供方。 |
| 私有的 `SdkProvider`，位於 `dsh-subagent-dsh-sdk` 中 | `SdkSubagentProvider` | 重複的包限定詞是有意保留的，類名還必須說明它透過 SDK 提供 subagent。 |
| `WebService`, `WebServiceConfig` | `WebRuntime`, `WebRuntimeConfig` | 該對象選擇提供方並執行即時搜尋和抓取操作。保留包、鍵、提供方包和模型工具。 |
| `@deepseek-ai/dsh-web-fetch-local`、`LocalFetchProvider`、`LocalFetchLimits`，提供方 id `local-http` | `@deepseek-ai/dsh-web-fetch-http`、`HttpFetchProvider`、`HttpFetchLimits`，提供方 id `http` | 該提供方執行直接 HTTP 抓取。`local` 只說明程式碼恰好在哪裡執行，並未說明它提供哪種機制。 |

保留 `@deepseek-ai/dsh-subagent-dsh-sdk`、其提供方 id `dsh-sdk`、外部 ACP（Agent Client Protocol）、Codex 和 Claude Code 提供方系列、subagent 工具包名、主檔案系統包和後端、檔案系統工具和事件，以及 skill 徽章和工具包。

### 掛鉤、防護、Plan Mode、擴充與診斷

| 舊名稱 | 當前名稱 | 理由 |
|---|---|---|
| `@deepseek-ai/dsh-hooks-claude`、`ClaudeHookConfig`、`parseClaudeConfig`，方言 `claude` | `@deepseek-ai/dsh-hooks-claude-code`、`ClaudeCodeHookConfig`、`parseClaudeCodeConfig`，方言 `claude-code` | 該掛鉤橋接面向 Claude Code，而非所有 Anthropic 或 Claude 產品。 |
| `@deepseek-ai/dsh-repeat-tool-guard`，外掛程式／來源 `repeat-tool-guard` | `@deepseek-ai/dsh-repeat-tool-reminder`，外掛程式／來源 `repeat-tool-reminder` | 該外掛程式向模型新增提醒，並不阻止工具呼叫，也不執行防護決策。 |
| `@deepseek-ai/dsh-timeout-policy` | `@deepseek-ai/dsh-tool-call-timeout-policy` | 完整的 `tool-call` 限定詞說明該策略限制的對象，而不會把外掛程式稱為面向模型的工具。保留其 `guard/timeout-policy/` 目錄和外掛程式 id `timeout-policy`；`packages/*/tool-*` 目錄約定仍只適用於註冊工具的包。 |
| `PlanModeService` | `PlanModeController` | 該對象控制進入和退出計畫模式的狀態轉換，而不是通用執行執行時期。 |
| `packages/self-modification/` | `packages/extensions/` | 該組包含倉庫外掛程式檢查和掛載工具。`extensions` 說明穩定的包職責，但不聲稱 agent 會修改自身。保留包名 `tool-cordis` 和倉庫外掛程式名稱。 |
| `packages/support/` | `packages/test-support/` | 該組僅包含測試基礎設施，其路徑必須明確說明這一點。 |
| 原 support 系列中的 `invariants/` | `runtime-diagnostics/invariants/` | 儘管交付預設未包含不變數檢查，它們仍可在生產診斷中執行，因此不屬於測試支持。 |
| `InvariantService` | `InvariantRegistry` | 該對象擁有已註冊的不變數檢查。保留 `@deepseek-ai/dsh-invariants` 和 `ctx.invariants`。 |
| `packages/client/test-runtime/` | `packages/test-support/client-runtime/` | 該包是用戶端測試基礎設施。如果現有 NPM 名稱已經說明這一約定，則予以保留。 |

保留 MCP、Todo、Plan Mode 包、鍵、事件和工具名稱。本決策重新命名控制器類，而不是產品功能。

### 實用工具、E2B、Host、組合包、示例與應用

| 舊名稱 | 當前名稱 | 理由 |
|---|---|---|
| `util/paths/`, `@deepseek-ai/dsh-paths` | `util/home-paths/`, `@deepseek-ai/dsh-home-paths` | 這些輔助函式解析 Harness 主目錄下的路徑，並非通用路徑庫。已準確說明返迴路徑的函式名保持不變。 |
| `util/retention/`, `@deepseek-ai/dsh-retention` | `util/output-retention/`, `@deepseek-ai/dsh-output-retention` | 該策略保留命令和工具輸出，而不是通用資料保留框架。 |
| `E2BSandboxService` | `E2BRuntime` | 該類建立、複用和釋放檔案系統與子行程配接器所使用的 E2B 執行環境。它比單個沙盒控制代碼的職責更廣，又比通用所有者更具體。保留 `@deepseek-ai/dsh-e2b`、`ctx.e2b` 和 `e2b/` 組。 |
| `@deepseek-ai/dsh-frontend-static` | `@deepseek-ai/dsh-host-frontend-static` | 該包是提供前端資源的 Host 外掛程式。此前綴可將它與前端應用程式碼區分開。 |
| `PluginInventoryService` | `PluginInventoryGateway` | 該類只負責把即時 Loader 樹適配到 `pluginInventory/list` RPC。它不擁有同進程服務、快取、歷史或修改路徑。`Gateway` 準確說明現有角色。 |
| `@deepseek-ai/dsh-jsonrpc-demo` | `@deepseek-ai/dsh-sdk-jsonrpc-demo` | 該示例演示透過 JSON-RPC 使用執行時期 SDK，屬於 SDK 的唯一含義。 |
| `@deepseek-ai/dsh-frontend` | `@deepseek-ai/dsh-web-frontend` | 該應用是 Web 前端。保留其物理目錄 `apps/web/`。 |

保留 atomic-write、brand、native-command、timeout 實用工具、目錄選擇器、`dsh-base`、`dsh-web-app`、應用啟動、CLI（命令列介面）名稱，以及 `headless` 包、組合包和示例身份。`headless` 是預期的產品本質，未來也可以支持不止一次性執行。

### 用戶端執行時期與 UI

| 舊名稱 | 當前名稱 | 理由 |
|---|---|---|
| `SlotsService` | `SlotRegistry` | 該對象擁有具名 slot 聲明和註冊項。 |
| `SessionsService` | `SessionRuntime` | 該對象擁有即時用戶端工作階段協調職責，而不是被動的工作階段清單。 |
| `WorkspacesService` | `WorkspaceRuntime` | 該用戶端對象協調即時工作區選擇和操作。如果清單未點名更改某個現有 `ctx` 鍵，則該鍵保持不變。 |
| `WorkspaceGroupBy`、`WorkspaceOrderBy`、`workspaceExpansion`、`setWorkspaceExpanded`、`expandedProjects`、`projectLabel`、`recentSessionOrder`、`recentSessionUpdatedAt`、`syncRecentSessions`、`setRecentSessionOrder`、`retainWorkspaceKeys`、`workspaceKey` | `SessionGroupBy`、`SessionOrderBy`、`groupExpansion`、`setGroupExpanded`、`expandedGroups`、`workspaceLabel`、`sessionOrderByAccount`、`sessionUpdatedAtByAccount`、`syncSessionOrderAccount`、`setSessionOrder`、`retainAccountKeys`、`accountKey` | 這些名稱描述的是工作階段清單查看狀態。其 account 包括真實工作區、未分組項和平鋪清單。因此，`Workspace`、`project` 和 `recent` 指向了錯誤的對象或機制。保留 `WorkspaceViewState`；該儲存仍屬於工作區瀏覽器。 |
| `LocaleService` | `LocaleRuntime` | 該對象協調區域設定定義、選擇、持久化和變更發布。 |
| `ThemeService` | `ThemeRuntime` | 該對象協調主題、偏好解析、系統感知和變更發布。 |
| `LayoutService` | `LayoutController` | 該對象控制當前 UI 版面配置狀態。 |
| `@deepseek-ai/dsh-client-ui-model` | `@deepseek-ai/dsh-client-ui-model-selection` | 該包控制工作階段的模型選擇。單數 `model` 名稱作用域過寬。 |
| `ModelService`, `ctx.models` | `ModelDirectoryResolver`, `ctx.modelDirectories` | 它唯一的公開操作 `directoryFor(sessionId)` 為每個即時工作階段解析並保留一個目錄。它沒有註冊 API，因此使用 `Registry` 並不準確。每個 `ModelDirectory` 仍是面向消費端的選填模型目錄。 |
| `SettingsScopeService` | `SettingsScopeBinder` | 它唯一的操作把一份命名空間規範綁定到呼叫方的傳輸層和生命週期，並返回 `SettingsScopeController`。保留 `ctx.settingsScope`；它命名的是單一綁定能力，而不是 scope 集合。 |
| `@deepseek-ai/dsh-client-ui-models` | `@deepseek-ai/dsh-client-ui-settings-models` | 該包擁有 Models 設定面板。保留 `ModelsSettingsStore`；它保存一個具有資料操作和訂閱能力的設定檢視表模型，確實是儲存。 |
| `@deepseek-ai/dsh-client-ui-plugin-config`、`client/ui-plugin-config/` | `@deepseek-ai/dsh-client-ui-settings-plugins`、`client/ui-settings-plugins/` | 該包擁有 Plugins 設定分區，而不是通用的外掛程式設定系統。目標名稱歸入 `ui-settings-*` 系列，並採用該分區的複數產品名。 |
| `PluginConfigSection`、`PluginConfigSectionProps`、`PluginConfigSectionInjected`、`PluginSettingsTabRow`、`PluginConfigKey`、`settings.pluginConfig` | `PluginsSettingsSection`、`PluginsSettingsSectionProps`、`PluginsSettingsSectionInjected`、`PluginsSettingsTabEntry`、`PluginsSettingsLocaleKey`、`settings.plugins` | 該分區擁有 Plugins 設定呈現和 tab 清單。元資料值表示一項 slot entry，而不是一條渲染行。每張卡片仍編輯一個外掛程式的設定。 |
| `@deepseek-ai/dsh-client-ui-plugins`、`client/ui-plugins/`、Loader id `ui-plugins`、`client-ui-plugins-invariant` | `@deepseek-ai/dsh-client-ui-settings-plugin-inventory`、`client/ui-settings-plugin-inventory/`、Loader id `ui-settings-plugin-inventory`、`client-ui-settings-plugin-inventory-invariant` | 這個後來加入的包擁有 Plugins 設定分區中的只讀 Plugin Inventory tab。`ui-plugins` 作用域過寬，也無法將該清單與可編輯外掛程式設定區分開。 |
| 原 `ui-plugins` 包中的 `PluginSettingsSection`、`PluginSettingsSectionProps`、`PluginSettingsSectionInjected`、`PluginsKey`、`settings.plugins` | `PluginInventorySettingsTab`、`PluginInventorySettingsTabProps`、`PluginInventorySettingsTabInjected`、`PluginInventoryLocaleKey`、`settings.pluginInventory` | 該元件現在貢獻一個 tab，而不是設定分區。其餘名稱明確說明清單主題，並避免與 `PluginsSettingsSection` 及其 `settings.plugins` 區域設定命名空間衝突。保留共享的 `settings.plugins.tab` slot 名；兩個 tab 都透過該 slot 向 Plugins 分區貢獻內容。 |
| `@deepseek-ai/dsh-client-ui-feedback`、`client/ui-feedback/`、Loader id `ui-feedback`、`client-ui-feedback-invariant` | `@deepseek-ai/dsh-client-ui-message-feedback`、`client/ui-message-feedback/`、Loader id `ui-message-feedback`、`client-ui-message-feedback-invariant` | 這個包透過 `messageFeedback` Remote 展示 assistant 訊息的評分和說明。舊名稱看起來還涵蓋 command feedback 和以後可能出現的其他回饋介面，但實際並非如此。 |
| 原 `ui-feedback` 包中的 `FeedbackController`、`FeedbackStatus`、`FeedbackView`、`FeedbackActionResult`、`FeedbackInjected`、`FeedbackActionProps`、`FeedbackActions`、`FeedbackKey` | `MessageFeedbackController`、`MessageFeedbackStatus`、`MessageFeedbackView`、`MessageFeedbackActionResult`、`MessageFeedbackInjected`、`MessageFeedbackActionProps`、`MessageFeedbackActions`、`MessageFeedbackKey` | 這些名稱會從 Client 包匯出。增加 `Message` 限定詞，避免它們聲稱代表所有回饋領域。保留 `Controller`：該對象接受評分和說明操作，並協調一個 Session 的載入、修改、衝突、重連和釋放狀態。 |
| `agent-loop-store.ts`、`bash-store.ts`、`web-search-store.ts` | `agent-loop-card-controller.ts`、`bash-card-controller.ts`、`web-search-card-controller.ts` | 每個模組都匯出一個卡片控制器。私有 `SnapshotStore` 欄位不會讓模組成為儲存。 |
| `card-store.ts` | `card-form.ts` | 該模組擁有暫存表單、欄位轉換和表單操作。它返回的快照儲存是呈現配接器，而不是模組的主要職責。 |
| `@deepseek-ai/dsh-client-ui-question` | `@deepseek-ai/dsh-client-ui-user-questions` | UI 呈現使用者問題 seam，而不是任意問題領域。 |
| `@deepseek-ai/dsh-client-ui-command`, `ui-command/` | `@deepseek-ai/dsh-client-ui-commands`, `ui-commands/` | 該包呈現並執行一組命令。 |
| `@deepseek-ai/dsh-client-ui-directory-picker`、`client/ui-directory-picker/`、Loader id `ui-directory-picker`、`client-ui-directory-picker-invariant` | `@deepseek-ai/dsh-client-ui-directory-picker-browse`、`client/ui-directory-picker-browse/`、Loader id `ui-directory-picker-browse`、`client-ui-directory-picker-browse-invariant` | 用戶端包現已拆成 `browse` 和 `native` 兩種目錄選擇器呈現。未加限定詞的包實際只是 browse 實作，並非兩者的共同定義。目標名稱與 Host 後端系列一致，不改變邊界。 |
| 用戶端 `ctx.command`、`CommandService`、`CommandServiceContract` | `ctx.commandUi`、`CommandUiRuntime`、`CommandUiContract` | Host 已擁有 `ctx.commands`。該用戶端服務是命令發現和執行的 UI 執行時期。現有 `CommandUiSpec` 確立了 `Ui` 大小寫格式。 |
| `ConversationService` | `ConversationController` | 該對象控制當前對話狀態和使用者操作。 |
| `InputService` | `SessionInputResolver` | 該介面為一個工作階段作用域解析輸入外觀。它既不是全域性輸入登錄檔，也不是執行服務。保留 `InputHub` 作為具體中樞，並保留 `ctx.conversation.input` 作為對外介面。 |

PascalCase 識別符號內部使用 `Ui`，不要使用 `UI`。除非清單明確要求重新命名，否則保留其餘用戶端包名。暫時保留已棄用的用戶端連線和 Host `ApiProxy` 詞彙；API 平面將替換它們，而在計畫移除的表面上重新命名只會增加改動量。

## 明確保留的名稱

以下經過討論的名稱保持不變，因為當前作用域準確，或重新命名會製造虛假概念：

- 保留完整的 sandbox 系列和 `ctx.sandbox`。不得引入 `processSandbox`。
- 保留 `@deepseek-ai/dsh-api-gateway`、`ctx.typertGateway` 和 `TypertGatewayService`。
- 保留工作階段投影名稱。投影並不只是歸約函式。
- 保留 `@deepseek-ai/dsh-session-stats`、`sessionStats` 和 `SessionStatsProjection`。這些名稱準確表示全工作階段統計資料及承載它們的持續維護讀模型。
- 保留 `GoalService`；它擁有目標狀態機、裁決權、比較並設定行為、事件和遠端操作，不只是儲存。
- 保留 `SessionTitleService`；它的職責是由多個標題提供方共享的領域服務。
- 保留 `PermissionPresetSettingsController`，即使它很長。每個詞都在限定其職責。
- 保留 `ModelsSettingsStore`；其主要約定是一個具有儲存操作的設定資料模型。
- 保留 `InputHub`；它是支撐 `SessionInputResolver` 的具體中樞。
- 保留 `dsh-subagent-dsh-sdk` 和提供方 id `dsh-sdk`；重複的限定詞可避免歧義。
- 保留 `headless`；即使執行時期以後支持不止一次性使用，該產品身份仍然準確。
- 保留已棄用的 Host `ApiProxy` 和用戶端連線名稱，直至 API 替代方案將其移除。
- Host 伺服器和提供方無關的 Web 能力都保留 `Web`。僅直接抓取提供方使用 `HTTP`。
- 保留 `E2B` 作為包名和上下文名稱，不改為 `E2B sandbox`。
- 保留 MCP、Todo、應用啟動、基礎組合包、web-app 組合包和 CLI 名稱。保留目錄選擇器能力和 Host 後端名稱；只重新命名未加限定詞的 Client `browse` 呈現。
- 保留 `@deepseek-ai/dsh-client-ui-directory-picker-native`；其後綴說明它是在重新命名後的 `-browse` 變體旁使用原生選擇器的呈現。保留 `SURFACE_PACKAGES`；在目錄選擇器自動選擇器中，它是用戶端呈現端面的包對映，並與 `BACKEND_PACKAGES` 對照。
- 保留 `@deepseek-ai/dsh-host-plugin-inventory`、`ctx.pluginInventory`、`pluginInventory/list` Remote 以及 `PluginInventory*` 載荷類型。它們準確命名由 Host 擁有的只讀清單；只有配接器類和作用域過寬的用戶端呈現名稱需要修改。
- 保留 `ConfigurablePluginsTab`。該 tab 渲染具有可編輯設定的外掛程式，不擁有完整的 Plugins 設定分區。
- 保留共享的 `settings.plugins.tab` slot。它屬於 Plugins 設定分區。清單包只把自己的 locale namespace 改為 `settings.pluginInventory`，不會建立獨立的 tab slot。
- 保留 `@deepseek-ai/dsh-message-feedback` 能力、`messageFeedback` Remote、assistant-action entry id `feedback`、hook key `feedback` 和 locale namespace `feedback`。它們所在的介面已經把作用域限定為訊息回饋或本機 assistant-message slot。只修改作用域過寬的 Client 包名和匯出的 UI 名稱。
- 保留 `RemoteFailure`、`RemoteResult` 和 `SessionRemotes`。前兩者是 Typert 載體結果值，後者是用戶端 Session 叢集使用的一組 Remote 命名空間。它們都不是 store、controller、registry 或 runtime。
- 保留使用者命令 `/export`、Host 路由 `/api/session.export`、`DownloadsApi` 及其 `sessionLog` 操作。命令說明使用者動作，Host 路由匯出歸檔，API 則歸類直接 HTTP 下載。重新命名的 Client controller 擁有獨立的瀏覽器下載步驟。
- 測試檔名保留 `.client` 和 `.host`。它們標識測試進入的編譯端面，不聲稱產品職責。

## 考慮過的替代方案

**保留現有名稱並新增詞彙表。**不予採納。詞彙表無法讓由 PowerShell 實作的 `BashExecutor` 名副其實，也無法讓 `ToolRegistry` 表明它會執行並強制實施工具策略。識別符號本身必須承載有用的區別。

**為每個 NPM 包新增所屬組前綴。**不予採納。扁平的 NPM 名稱不需要復刻目錄樹。機械新增前綴只會增加長度，無法解釋包的職責。

**將整個倉庫稱為 SDK。**不予採納。該專案是 agent harness（代理框架）。SDK 是 Python 和 TypeScript 用戶端使用的、受支持的 JSON-RPC 用戶端／伺服器棧。一詞兩義會使包名和產品文案產生歧義。

**所有 Cordis 服務類都使用 `Service`。**不予採納。Cordis 繼承只是實作事實。類名必須告訴呼叫方該對象負責註冊、儲存、解析、控制還是執行工作。

**統一使用 `Runtime` 替換 `Service`。**不予採納。只有對象擁有即時執行或生命週期時，`Runtime` 才正確。登錄檔、儲存、目錄、控制器、解析器、引擎和設定對象都應保留更精確的職責名。

**優先使用最短的名稱。**不予採納。只有作用域明確之後，簡短纔有價值。`PermissionPresetSettingsController` 保留 `Preset`；`JobId` 簡短，是因為 `Job` 已經表明領域；`BgTaskId` 雖短，卻晦澀難懂。

**為未來可能出現的功能使用寬泛名稱。**不予採納。應按穩定的當前職責命名。未來若要改變邊界，可以在發布前再次重新命名對象，或在發布後另寫提案。含義模糊的名稱會讓每位當前讀者為尚未建置的未來付出理解成本。

**將 `dsh-compact-basic` 重新命名為 `dsh-compaction-llm`。**不予採納。`LLM` 沒有在當前後端系列中增加區別。`basic` 意圖更剋制，也不會聲稱存在一個實際並不存在的演算法。

**將工作階段投影重新命名為歸約器。**不予採納。歸約只是建置投影的方式。該包還擁有讀取模型值、快取和尋找約定。

**將持久 Bash 工具重新命名為 `bash-terminal`。**不予採納。該名稱與終端機工作階段系列衝突。將 `tool-bash-persistent` 移到 `shell/` 可以糾正其歸屬位置，同時現有名稱仍能將其與一次性 Bash 工具區分開。

**應用清單時一並重命名或拆分邊界。**不予採納。評審人必須能夠確認行為沒有改變。真正的邊界缺陷需要獨立提案、測試和後果分析。

**為舊名稱保留別名。**不予採納。沒有已發布的消費端需要這些別名。別名會保留兩套詞彙，使首次發布攜帶一項從未有使用者需要的遷移。

## 驗證

- 清單中的每項對映都出現在倉庫中。每個系列只有一套公開詞彙；同一個 Cordis 上下文中沒有相容包、重新匯出別名、重複的 `ctx` 鍵、雙重外掛程式 id、雙重事件 id、舊工具別名或回退解析器。
- 執行時期行為、包邊界、預設值、策略、持久化語義和模型行為保持等價，只有識別符號本身可見時除外。
- 包目錄、NPM 名稱、匯入、manifest（中繼資料清單）、TypeScript 引用和路徑、Cordis 設定、外掛程式 id、服務鍵、事件、工具、RPC 名稱、清單點名的持久化名稱、fixture、快照、示例、生成的目錄和當前文案都使用已實作詞彙。
- 當前處於 implemented 狀態的 Agent Note 使用事實名稱和路徑。包重新分組說明記錄分組清單和包名目標，SDK 移除說明將 `SDK` 限定為執行時期協議，逾時策略說明記錄包名理由。
- 配對的包建立指南包含職責詞約定，`packages/AGENTS.md` 連結到該約定，術語表記錄選定用詞和 `Typert` 拼寫，根項目文案將產品稱為 DeepSeek Harness，而不是 DeepSeek Harness SDK。
- 已移除的 SDK 項目工具鏈繼續保持不存在。
- `pnpm run check:ci` 覆蓋原始碼平面的型別檢查、建置、包衛生檢查、生成參考資料檢查、受影響的快照、翻譯配對、`doc-sync` 和 lint。發布形態的 Python 執行時期冒煙測試和必需 CI 覆蓋打包執行時期與平臺路徑。

## 後果

倉庫為每個重新命名系列保留一套詞彙。清單點名的舊磁碟名稱、協議值、工具名稱和設定項不再工作。能夠識別過時設定的所屬解析器會明確報錯，而不是同時接受兩種形式。

一些名稱更長。額外增加的詞只有在防止誤述權限或機制時纔有意義。如果名稱中的詞不能全部限定職責，長名稱仍然錯誤。

職責後綴不能替代對行為的檢查。包建立指南保留本決策中的直接判斷方式：檢查呼叫方執行什麼操作、對象擁有什麼生命週期，以及對象控制什麼失敗或策略。

基於舊路徑和舊符號的分支需要解決衝突。這是發布前移除舊詞彙且不保留相容別名的一次性成本。
