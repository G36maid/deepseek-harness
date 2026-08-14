# 子系統

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

每個子系統一頁，覆蓋 DeepSeek Harness 的全部子系統：它是什麼、它操作哪些資料結構，以及——當它由某個 `ctx` 服務或事件作用域支撐時——一段生成的 **Cordis API** 小節，承載其服務與事件參考。本目錄與 [architecture.md](../architecture.md) 互補：後者描述跨子系統的*行為*（服務對映、工作階段/輪次/步驟生命週期、事件分類體系）；這裡的每一頁是單個子系統詞彙與接線的參考。

| 頁面 | 負責內容 |
|---|---|
| [core.md](core.md) | `packages/core` 如何控制 agent loop（代理循環）：逐包的迴圈說明、agent 建立與所有權（`AgentHandle`）、`Agent` 控制代碼的投遞/取消/攔截約定，以及全倉通用類型模式（`…Map → 派生联合`、品牌化 id） |
| [llm-streaming.md](llm-streaming.md) | `packages/llm` 的對話類型——`Message`/`ContentBlock`、組裝完成的模型請求、`StreamChunk` wire protocol 和配接器約定（adapter contract）、`BlockAssembler`，以及 `LlmAdapter` 提供方約定 |
| [token-meter.md](token-meter.md) | 不可變的標量與位置重播度量，附帶已消費日誌修訂號 |
| [scope.md](scope.md) | 作用域註冊標識、dispatch 載體，以及擁有的 `Scope` 上下文 |
| [typert.md](typert.md) | 遠端呼叫描述符、lookup/Context 聲明、Typert 登錄檔，以及 Host Gateway/Client API 邊界 |
| [goal.md](goal.md) | 持久 goal 標識、生命週期快照、啟用、變更記錄與 Round 歸屬 |
| [schedule.md](schedule.md) | 僅限 Session 內的提醒記錄、持久轉換、活動檢視表與普通對話交付 |
| [commands.md](commands.md) | 人類命令登錄檔服務：定義、配接器發現、直接呼叫、結果與解析檢視表 |
| [session.md](session.md) | 完整的 `SessionEventMap` 變體目錄、`TurnTrigger`/`TurnEndReason`、`deriveMessages()`、執行封閉與獨立事件 |
| [persistence.md](persistence.md) | 持久性 seam：`SessionPersistence`、JSONL + SQLite 後端、`session/flush`、當機復原、`SessionHeader` |
| [settings.md](settings.md) | 使用者設定 seam：`SettingsNamespace` 註冊、分層解析（預設值 → 組合 `base` → 使用者文件）、owner scope、熱提交 |
| [credentials.md](credentials.md) | 憑據 seam：設定中的 `CredentialRef` 引用（絕不含值）、按操作解析、對 UI 安全的 `CredentialInfo`、提供方來源層 |
| [session-query.md](session-query.md) | 邏輯記錄、有界精確事件讀取、關係追蹤、語義篩選器/文件與全文檢索結果頁 |
| [feedback.md](feedback.md) | 綁定生命週期的逐訊息回饋記錄、樂觀版本、伴隨記錄持久化與 Host Remote 契約 |
| [session-title.md](session-title.md) | 持久標題快照、被引用的來源訊息 seq 與非同步提供方約定 |
| [session-reference.md](session-reference.md) | 結構化跨工作階段引用：`SessionReferenceInput`/`Candidate`、prepared 訊息上下文、穩定錯誤分類 |
| [system-prompt.md](system-prompt.md) | 逐次組裝的上下文、工具提供方結果、提示詞段落與協作式組裝 |
| [tools.md](tools.md) | `ToolDefinition` 完整欄位、schema DSL、`ToolExecution`/`ToolResult`、工具展示 UI 類型，以及受保護的執行管線 |
| [user-questions.md](user-questions.md) | UI 支援的人工問答 seam：`AskUserQuestionRequest`、answer/options 詞彙、提供方 API、錯誤分類體系 |
| [approval.md](approval.md) | 一次性使用者審批 seam：`ApprovalRequest`、`ApprovalOutcome`、逐工作階段策略、審計事件和 answerer 約定 |
| [attachment.md](attachment.md) | 持久圖片標識與中繼資料、校驗輸入、經校驗讀取，以及 `AttachmentStore` seam |
| [shell.md](shell.md) | bash 執行器 seam：`ShellExecRequest`/`Spec`、`ShellRunResult`、後臺 `ShellProcess` 控制代碼 |
| [subprocess.md](subprocess.md) | 子行程 seam：完全顯式的 `SubprocessSpawnSpec`、基於偏移的輸出讀取器、不含分類的 `SubprocessOutcome`，以及受管 `DSH_*` 環境詞彙 |
| [terminal.md](terminal.md) | 持久化終端機 ID、後端/工作階段約定、傳送就緒狀態、有界讀取與 owner 可見快照 |
| [sandbox.md](sandbox.md) | 每工作階段策略解析與行程約束 seam：文件效果模式、執行/提供方策略、`ConfinedArgv`、強制執行與故障關閉錯誤 |
| [code-runtime.md](code-runtime.md) | 程式碼執行 seam：`CodeRunRequest`/`Result`、綁定命名空間、捕獲日誌、`CodeRunFailure` 分類體系 |
| [extensions.md](extensions.md) | 帶版本的動態 Cordis Plugin 與 Package、Host/Client 啟用、審批、執行時期檢查和生命週期撤銷 |
| [filesystem.md](filesystem.md) | 檔案系統 seam：`FsTarget`、讀/寫/編輯結果、觀測到的文件狀態、`FsErrorCode` |
| [lsp.md](lsp.md) | LSP 導覽 seam：`LspQueryRequest`/`Result`、`LspProvider`/`Service`、四種操作、`LspError` |
| [skills.md](skills.md) | skill（技能）服務：發現優先級、`SkillSummary`/`SkillDefinition`、工作階段前綴目錄、面向模型的 `skill` 載入 |
| [compaction.md](compaction.md) | 壓縮（compaction）seam：`compaction/*` 工作階段事件、`CompactionResult`、`CompactionEngine` 介面 |
| [subagent.md](subagent.md) | subagent seam：命名提供方登錄檔、`SubagentStartRequest`/`Result`/`Run`、啟動時與執行時期能力拆分 |
| [web.md](web.md) | Web 訪問 seam：`WebSearchRequest`/`Result`、`WebFetchRequest`/`Result`、`WebFetchBody`、提供方可用性、`WebError` |
| [spill.md](spill.md) | spill 儲存 seam：`SaveTextSpill`、`SpillOwner`/`SpillSource`、`SpillRef`、品牌類型 `SpillLocator` |
| [workflow.md](workflow.md) | 工作流程 seam：`WorkflowStartRequest`、`WorkflowMeta`、`WorkflowRun`/`Result`、`workflow/*` 事件載荷、`WorkflowError` 致命性 |
| [jobs.md](jobs.md) | 背景工作執行時期：品牌化 `JobId`、producer 約定、消費端檢視表和 `ctx.jobs` 服務行為 |
| [permission-presets.md](permission-presets.md) | 權限預設層：`PresetSpec`/`PresetOption`、派生的 `custom` 狀態、僅記日誌的 `permission/preset` 事件 |
| [plan.md](plan.md) | 計畫模式：僅記日誌的 `plan/mode` 狀態、待定選擇的沖刷、`PlanModeConfig`、`exit_plan_mode` 審閱流程 |
| [invariants.md](invariants.md) | 執行時期不變式登錄檔：選擇設定 `Config`、`InvariantInstaller`/`InvariantFailure`、空配套外掛程式約定 |
| [web-server.md](web-server.md) | HTTP 載體：`WebRouteKind`/`WebRoute`、匹配順序、可認領的回退席位、index 算繪掛接點 |
| [storage.md](storage.md) | 儲存子系統：後端約定（`StorageBackend`）、`StorageForms`、`DomainSpec`/`Domain`、`domain/changed` |
| [workspace.md](workspace.md) | 工作區登錄檔：`Workspace`/`WorkspaceId`、註冊與解析、與工作階段 `cwd` 的關係 |
| [client-modules.md](client-modules.md) | Web 外掛程式表：`dsh.client` 聲明、`WebBootGraph` 線上組合、bundle 路由與 index 轉換 |
| [session-projection.md](session-projection.md) | 投影 seam：`SessionProjectionMap`、純函式 `ProjectionDefinition` 單元、`ProjectionSnapshot` 的一致切面、變更饋送 |
| [session-telemetry.md](session-telemetry.md) | 對外工作階段上報能力 seam：`SessionTelemetryRecord`/`SessionTelemetrySeverity`、`SessionTelemetrySink` 約定和 `session-telemetry/record` 脫敏 waterfall |

> 這些頁面上的類型聲明及其 JSDoc 與原始碼等價，並由 `pnpm run verify-type-equiv` 檢查漂移（見 [development.md](../development.md#documenting-types-verbatim-ts-type-equiv)）。普通塊保留完整聲明；`public-api` 塊保留去除實作體的公開 class 聲明。Cordis 服務與事件使用每頁生成的 **Cordis API** 小節。
