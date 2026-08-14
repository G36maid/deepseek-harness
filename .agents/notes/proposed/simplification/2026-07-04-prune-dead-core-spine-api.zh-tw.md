# Agent Note: 裁剪無用的公開與結果介面

Status: proposed

[English](2026-07-04-prune-dead-core-spine-api.md) | [简体中文](2026-07-04-prune-dead-core-spine-api.zh.md) | 繁體中文

## 問題

若干包根匯出、結果欄位和便利方法沒有生產消費端。它們之所以存活，要麼是因為測試透過公開入口匯入了內部實作，要麼是因為某個類型預期了一個從未出現的呼叫者。每一項單獨看都很小，但合在一起，它們擴大了 SDK 約定、生成的 catalog、文件和回歸矩陣，卻沒有支撐任何已交付的路徑。

生產語料庫是 `packages/*/*/src`、示例原始碼/設定和執行時期指令碼。測試、包 README 和 Agent Note 行文是發布的證據，但不是固定呼叫者。`cordis_inspect` 使 `packages/extensions/tool-cordis/src/api-catalog.ts` 對模型可見，`cordis_mount` 可以透過受保護的真實服務代理呼叫注入的服務，因此 catalog 中的服務方法和返回形狀是真正的動態產品介面。下表因此區分「沒有固定的倉庫呼叫者」與「不可達」：涉及 catalog 詞彙的行有意收縮模型編寫的 mount 能發現和呼叫的內容，而包根實作輔助函式並不透過該服務門面可達。精確符號搜尋得出以下清單：

| 介面 | 生產證據 | 簡化方式 |
| --- | --- | --- |
| `SurfaceManager.invalidate()` | 只有其單元測試呼叫它；seeding 在惰性建立的 manager 存在之前就已完成，且工作階段從不替換其日誌引用。 | 刪除它及其不可能觸發的整體替換約定。 |
| `ToolExecutionResult.callId` | 每個掛鉤已經接收不可變的 `ToolExecution`；迴圈和 ACP（Agent Client Protocol）透過呼叫/工作階段事件關聯。沒有消費端讀取這個重複的結果欄位。 | 移除該欄位、複製/不匹配守衛，以及證明該重複不可能不一致的測試。 |
| `ReactLoopAgent` 根匯出 | 包外的命名匯入都是測試；生產程式碼面向 `Agent` 程式設計，透過 `ctx.agents` 建立/復原。 | 將返回類型和介面類型設為 `Agent`，將具體迴圈類改為包內部；保留有意設計的同步、僅設定的 `AgentLoop.create()` 路徑。 |
| `workflow-worker-thread` 的 protocol/runtime/session 再匯出與命名的 `WorkerThreadWorkflowEngine` | 所有透過包名匯入的消費端都使用默認引擎；工作流程 Agent Note 已將 worker 協定格式（wire format）定義為私有。 | 保留默認外掛程式類/設定約定；移除重複的命名類匯出，將協議模組保持為原始碼私有。 |
| `code-runtime-worker` 的 protocol/bootstrap 再匯出 | 包外的生產/e2e 消費端使用 `WorkerThreadCodeRuntime` 和設定，而非 `BootstrapPort`、`PatchableStream` 或 worker 訊息/啟動類型。 | 保留執行時期類/設定約定，將其協定格式/bootstrap 詞彙改為原始碼私有。 |
| ACP 的 `agentOptions` 根匯出 | 該輔助函式只有同文件和 ACP 測試消費端；唯一的包外生產消費端掛載的是外掛程式命名空間。 | 保留 `name`、`inject`、`Config`、`AcpConfig` 和 `apply`；將 `agentOptions` 改為原始碼私有，透過橋接層行為測試。 |
| `providerWording` 與 `completedTurnPrefix` 根匯出 | 各有一個同包生產呼叫者；只有 balanced-prefix 輔助函式有一個同包白盒測試。 | 改為原始碼私有，測試提供方行為。 |
| `depthOf`、`SubagentDepthError`、`waitForExit` 與 `exitsWithin` 根匯出 | 生產 subagent 後端消費的是行程內 runner 和子行程構造/dispose（資源釋放）輔助函式，而非這些強制機制和測試內部實作。`SENSITIVE_ENV_PATTERN` 不在其中，因為 SDK helper 會將它應用於呼叫方傳入的環境。 | 保留深度與退出行為，但將剩餘輔助函式和 error 改為原始碼私有；透過 spawn 和 dispose 測試。保持共享憑據正則公開。 |
| `PersistenceCoordinator.inits`、後端 `inits` 訪問器、`seedCoversPrefix` 與 `assertSerializable` | 訪問器為白盒測試而存在；`seedCoversPrefix` 沒有包外生產匯入者；`assertSerializable` 沒有生產呼叫者，且與 coordinator append 邊界的無損快照重複。 | 透過 `session/flush` 觀察初始化，將 `seedCoversPrefix` 改為原始碼私有，刪除 `assertSerializable`。保留兩個後端、`SessionHeader` 和 SQLite 的版本約定。 |
| `LlmError.status` 與重播 status | 配接器/重播填充它，但生產分支基於穩定的錯誤碼/訊息判斷，從不讀取原始 status。 | 移除未讀欄位和重播管道，保留錯誤分類。 |
| `BlockAssembler.push()` 回傳值 | 兩個生產呼叫者都忽略返回的已完成塊。 | 返回 `void`；保留有意公開的 `blocks()`/`message()` 約定。 |
| `compactRegion` 的獨立 `session` 參數 | 固定呼叫方傳入的對象就是 `agent.session` 中已有的對象；模型可見的 mount API 也可以呼叫該方法，但同時接受兩個獨立對象，會讓掛載的外掛程式傳入不一致的組合。 | 保留手動 region API，同時有意將其收窄為以 `agent.session` 為唯一真源。 |
| `CompactionResult.startSeq`、`summarySeq`、`endSeq` 與 `summary` | 生產消費端只讀取 shadowed range/seq/token 統計；持久日誌擁有 summary 和事件標識。 | 移除四個結果回顯，保留兩個共享的 transcript（文字記錄）渲染器。 |
| `BasicCompactionEngine` 的估算/摘要方法可見性 | 沒有包外生產呼叫者呼叫這五個方法；已實作的 Agent Note 只將 `estimateContentTokens()` 和 `summarize()` 命名為子類掛鉤。 | 將這兩個方法改為 `protected`，其餘三個編排專用的估算器改為 private。 |
| `CodeLogEntry.source`/`level` 與 `RunCodeMeta.dispatches` | 每個生產消費端都將日誌對映為文字；沒有 presenter/模型路徑讀取其他欄位或持久化的 dispatch 計數。 | 將 code-runtime 日誌改為字串（或純文字條目），移除 result-meta 的 dispatch 管道；保留用於生成確定性 dispatch id 的本機計數器。 |
| `CodeRuntime.language` 與 `CodeRuntime.isolation` | worker 後端提供唯一的生產值，而 Code Mode 及其他所有生產呼叫方只調用 `run()`。 | 移除未讀描述符，同時保留 worker 的語言、隔離、預算、取消與資源釋放行為。 |
| `ToolNotFoundError.toolName`、`SystemPrompt.config` 與 `BashTask.command` | 每個儲存的公開值都沒有生產讀取者。 | 移除未讀欄位，保留錯誤訊息、已解析的設定行為和任務生命週期。 |
| 後端包根實作輔助函式 | 下方精確清單僅透過相對路徑的同包匯入呼叫。生產命名空間匯入掛載的是保留的外掛程式約定，不讀取這些屬性；包根命名匯入的消費端都是測試。 | 保留每個配接器/提供方/服務及其設定/錯誤約定；停止在包根匯出所列輔助函式/常數。 |
| 消費端包根實作輔助函式 | 下方精確清單只有同包生產呼叫者。生產命名空間匯入掛載的是外掛程式約定，不讀取輔助屬性；包根命名匯入的消費端都是測試。 | 保留外掛程式約定和穩定的錯誤碼；將測試遷移到包內模組或公開行為，停止在包根匯出所列輔助函式。 |

### 分組輔助匯出清單

- `dsh-llm-deepseek`：`httpErrorCode`、`serializeMessages`、`serializeRequest`、`DONE`、`parseSse`、`mapFinishReason`、`mapUsage` 與 `translate`；`dsh-llm-pi-ai`：`buildModel`、`mapStopReason`、`mapUsage`、`toPiContext` 與 `toStreamChunks`。
- `dsh-bash-local`：`DEFAULT_GRACE_MS`、`ENV_OVERRIDES`、`killGroup`、`OutputCollector` 與 `runBash`；`dsh-bash-sandbox`：`shellQuote`、`classifyDenial` 與 `classifyRunnerFailure`；`dsh-sandbox-local`：`bwrapProfileArgs`、`landlockProfileArgs` 與 `seatbeltProfileArgs`。公開的可變測試注入欄位及其類型不在本提案範圍內。
- `dsh-fs-local`：`applyLiteralEdit`、`listDirectory`、`probe`、`readForEdit`、`readTextForDiff`、`readWholeText`、`resolveLocalTarget`、`restoreLineEndings`、`streamWholeText` 與 `writeFileAtomic`。
- `dsh-web-fetch-http`：`classifyContentType`、`decoderForCharset`、`isSameOrigin`、`parseCharset` 與 `validateFetchUrl`；`dsh-web-search-exa`：`mapExaResponse` 與 `mapExaResult`；`dsh-web-search-deepseek`：`citationSnippets` 與 `mapAnthropicResponse`；`dsh-web-search-perplexity`：`mapPerplexityResponse` 與 `mapPerplexityResult`。
- `dsh-tool-fs`：`READ_LIMIT`、`STREAM_MIN_SIZE`、`READ_MAX_BYTES`、`READ_MAX_LINE_LENGTH`、`DIFF_CONTEXT`、`applyReadTool`、`parseReadArgs`、`applyWriteTool`、`formatWriteOutput`、`parseWriteArgs`、`applyEditTool`、`formatEditOutput`、`parseEditArgs`、`buildWindow`、`formatReadOutput`、`computeHunkDiffs` 與 `diffsFromMeta`。
- `dsh-tool-web`：`WEB_SEARCH_MAX_RESULTS`、`applyWebSearchTool`、`formatSearchOutput`、`parseSearchArgs`、`presentSearchCall`、`applyWebFetchTool`、`formatFetchOutput`、`parseFetchArgs`、`presentFetchCall`、`renderBody` 與 `htmlToMarkdown`；`dsh-tool-call-timeout-policy`：`toolTimeoutResult`；`dsh-compaction-basic`：`resolveConfig`；`dsh-tool-bash`：`renderResult`。

## 提案

以一次有界的、協調的公開介面清理，移除或降級上述每一行。同步更新包 README、JSDoc、生成的 API/事件 catalog、type-equiv 記錄、必要的 exports map 以及測試，使測試透過所屬的公開約定驗證行為，而非保留僅為測試而存在的入口。不摺疊任何能力 seam、LLM（大型語言模型）配接器、持久化後端或生命週期完全靜止約定。

## 曾考慮的替代方案

**保留測試便利函式和自包含的結果欄位為公開。** 公開輔助函式可以讓白盒測試更方便，自包含的結果欄位看起來更易用，未來的嵌入者可能需要具體迴圈類或枚舉方法。這些好處是假設性的；當前它們讓每處實作和文件都要解釋沒有已交付呼叫者能觀察到的狀態。真正的消費端可以引入它所需的最小約定，其所有權和失敗語義明確。

**保留所有 catalog 成員以供模型編寫的 mount 使用。** 自引用工具集是一條真實的通用消費路徑，而非生成文件的噪音。然而，它的價值來自準確、可組合的服務介面，而非無限期保留重複欄位或不一致的參數對；上述每一項 catalog 收縮都移除了在同一次執行、同一個 agent（代理）或同一結果中其他位置已可獲得的事實，並在同一變更中更新 API 參考。

## 驗收標準

- 精確符號搜尋顯示：在本 Agent Note 及任何對已實作 Agent Note 的修正之外，沒有被移除的介面。
- 本 Agent Note 列出的每個介面均按指定方式移除或降級；清單之外有意保留的擴充/測試約定不變。
- 工具執行、上下文壓縮（context compaction）、兩個 LLM 配接器、兩個持久化後端、工作流程隔離以及 agent 建立/復原保持其已交付行為。
- 型別檢查、覆蓋率、快照、doc-sync（文件同步閘門）、module-graph 校驗、建置和 hygiene 透過。

## 風險

大多數移除在編譯時可見但對執行時期無影響。上下文壓縮參數清理有意禁止工作階段/上下文不匹配，同時保留手動 region API。外部預發布嵌入者和現有模型編寫的 mount 可能匯入更少的輔助函式、傳遞更少的參數或接收更窄的結果形狀；這是有意的產品介面收縮，而非僅僅是生成 catalog 的清理。倉庫尚未發布，因此承載不受支持的接口才是更大的基礎成本。
