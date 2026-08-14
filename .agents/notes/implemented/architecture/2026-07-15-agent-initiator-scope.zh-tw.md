# Agent Note: 基於 AsyncLocalStorage 的發起 Agent 作用域

Status: implemented

[English](2026-07-15-agent-initiator-scope.md) | [简体中文](2026-07-15-agent-initiator-scope.zh.md) | 繁體中文

## 問題

harness 中存在兩種有用但不同的上下文概念。Cordis `Context` 負責選擇服務、註冊歸屬和生命週期；`agent.ctx` 是一個存活 Agent 所擁有的扁平註冊作用域。Agent 與工作階段身份描述的則是非同步操作主體。若把根 `ctx.agent` 改成「當前正在執行的 Agent」，就會混淆這兩種含義，並在單行程並行驅動多個 Agent 時失效。

行程內深層基礎設施有時需要在顯式傳遞的迴圈、工具及請求參數之下取得可信的發起 Agent，例如宿主感知傳輸層、追蹤輔助函式、日誌器或閘道用戶端。要求每個私有輔助函式都轉發 `agent` 會造成重複，而行程級可變槽會在跨 `await` 時發生並行錯誤。模型可見參數也不適用，因為模型不得選擇可信的工作階段或路由請求標頭。該載體歸 Agent 服務所有，而非模型可見的選填上下文。

## 決策

必需的 `ctx.agents` 服務使用 Node `AsyncLocalStorage` 攜帶發起 Agent。它直接儲存同一個 `Agent`，不引入只有一個欄位的幀；另一個私有執行標記只記錄巢狀邊界的譜系，供 teardown 記帳使用，不攜帶身份。[核心資料目錄](../../../../docs/subsystems/core.md#initiating-agent)標明瞭所攜帶的類型。

`currentInitiator()` 用於選填讀取，`requireInitiator()` 拋出 `no initiating agent is active`，`withInitiator(agent, operation)` 保留操作返回的同步值或 Promise 本身。`withoutInitiator(operation)` 會建立清空邊界，供不得繼承 Agent 的工作使用。工作階段仍透過 `agent.session` 推導；輪次、步驟、工具呼叫、`signal`、模型、`cwd`、沙盒和授權繼續由現有歸屬方管理。

`AgentLoop` 已經注入 `ctx.agents`，並用 `agents.withInitiator(agent, ...)` 包裹每個具體驅動的完整 `runLoop` 生命週期。迴圈、輪次、步驟和工具呼叫的包內私有入口從 `ctx.agents` 復原同一個 Agent，一次推導 `agent.session`，再由操作內輔助函式捕獲該值，避免在淺層介面中轉發具體驅動或 `Session`。若 `Session` 本身就是底層輔助函式的實際介面，該函式會保留狹窄的 `Session` 參數，而不會只為隱式尋找而接收更寬泛的 `Context`。

因此，並行驅動使用彼此獨立的儲存。子驅動的非同步延續攜帶子 Agent；`withInitiator()` 返回後，呼叫方立即復原之前的儲存，而活動執行計數仍持續跟蹤返回的 Promise，直到其結束。建立、持久化載入和尚未發布的 `setup(agentCtx)` 位於子驅動邊界之外：由父 Agent 發起的建立使用父身份，而 `agentCtx.agent` 顯式標識子 Agent。

隱式身份不會取代顯式約定。`ToolExecution.agent`、`AssembleContext.agent`、`GenerateOptions.sessionId`、任務歸屬、父子請求、`ctx.agent`、`agentCtx.agent`、審批與 hook 主體、`cwd` 選擇、取消、worker 和行程訊息、持久化記錄及協議身份都保持顯式傳遞。遠端邊界會把所需身份寫入類型化請求，因為 ALS 只在行程內有效。

`AgentRegistry` 管理一個有序的發起方生命週期。teardown 會先拒絕新邊界；移除 `ctx.agents` 後，AgentLoop 等注入方開始排空，登錄檔隨後等待活動的返回 Promise 邊界，最後呼叫 `AsyncLocalStorage.disable()`。如果某個邊界繼承的非同步呼叫鏈啟動所屬 Cordis fiber 的解除安裝，私有執行標記譜系會從排空範圍中釋放該巢狀邊界鏈，從而避免 teardown 等待自身完成，同時繼續排空無關邊界。在普通排空期間，進行中程式碼可透過保留的服務引用繼續呼叫 `currentInitiator()` 和 `requireInitiator()`；dispose（資源釋放）後，發起方方法會拋出 `agent initiator scope is disposed`。根 Context dispose 可能並行啟動同級 fiber 的 teardown，因此除 Cordis 相依性順序外仍必須統計活動邊界。

發起方作用域不負責管理脫離返回鏈的工作：登錄檔排空只跟蹤 `withInitiator()` 或 `withoutInitiator()` 返回的 Promise。邊界內建立的非同步資源會繼承其儲存，直到自身結束或 ALS 被停用；所屬 seam 必須顯式停止未納入返回 Promise 的工作。Agent 所屬的前臺工作會把完整生命週期納入回傳值，並保留顯式取消約定。無關的定時器、佇列和部署基礎設施在 `withoutInitiator(operation)` 下啟動；佇列、worker、行程和協議邊界必須序列化身份，不能期待 ALS 傳播。

宿主感知的傳輸層可以從 `ctx.agents.requireInitiator().session.id` 推導由部署方擁有的 `X-Harness-Session-Id` 等請求標頭；模型可見 schema 和參數中不包含該請求標頭。本決策不讓現有生產 MCP 或 Web 傳輸層採用此請求標頭。測試替身傳輸層用於證明可信邊界，而不會把宿主路由策略分配給現有的提供方無關 seam。

本決策擴充 [Agent 註冊作用域約定](2026-07-08-agent-scope-contexts.md)及其[執行時期設計](2026-07-12-agent-scope-runtime-design.md)，不會改變其中 `agent.ctx` 的靜態含義。

## 驗證

Agent 服務測試鎖定選填與必需讀取、同步值及跨 realm Promise 的精確身份、內建 Promise 結束狀態觀察、並行、巢狀及清空邊界、同步拋錯或 Promise 拒絕後的復原、普通與重入排空順序及保留引用的錯誤。AgentLoop 整合測試鎖定並行與巢狀驅動、無 Agent 呼叫、AgentRegistry 重新啟動、根 Context 銷毀，以及包內私有的迴圈和工具調度透過隱式尋找完成。組合、模組圖、建置及執行時期閉包檢查確保默認組合包、SDK 主幹、Python 執行時期閉包及直接 AgentLoop harness 透過 `ctx.agents` 完成接線，無需其他提供方。

測試替身形式的宿主感知傳輸層在內部推導 `X-Harness-Session-Id`，並驗證工具 schema 與日誌中記錄的參數都不包含身份欄位。服務有意不排空邊界操作所返回 Promise 之外的非同步工作；這類工作仍由所屬方的顯式停止約定管理。

## 考慮過的替代方案

**在每個函式中傳遞 Agent。** 公開、worker、行程、持久化和協議邊界繼續顯式傳遞，但要求每個行程內私有輔助函式都攜帶 Agent 只會造成重複轉發，不會提高可信度。ALS 僅限於這些顯式邊界內部的非同步呼叫鏈。

**讓 `ctx.agent` 變成動態值。** `ctx.agent` 已經表示與 Agent 作用域 Cordis 上下文靜態關聯的 Agent。改變根上下文的含義會混合註冊作用域與執行作用域，並讓並行行為變得意外。

**新增獨立的 `ctx.agentExecution` 服務。** 該載體沒有獨立後端、設定或身份類型：它儲存的是 `ctx.agents` 已經管理的同一個 `Agent`，而 AgentLoop 本就相依性該服務。第二個必需提供方會增加包、組合、生命週期、生成目錄及測試 harness 接線，卻沒有拆出真實能力。

**保存命名幀或完整執行時期幀。** 只有一個欄位的 `{ agent }` 幀只是包裝該值，而 Agent、工作階段、inbox、取消、輪次、步驟、工具執行和持久化已經有各自的真源。增加更多欄位會產生過時快照和另一套生命週期；直接攜帶 `Agent`，由方法名標識邊界，無需重複保存狀態。

**包含步驟級 `AbortSignal`、`cwd`、沙盒或授權。** 它們的生命週期及權限範圍與驅動邊界不一致，而且現有 seam 已經顯式傳遞這些值。新增控制能力需要獨立決策和巢狀生命週期約定。

**使用行程級 `currentAgent`。** 並行 Agent 和 subagent 會在非同步延續執行之間相互覆蓋，因此可變全域性值只在 harness 不具備的序列保證下才正確。

**從模型可見參數推導身份。** 不能信任模型或使用者輸入來選擇工作階段、租戶或沙盒路由。

**給每個能力 seam 增加路由身份。** 這會把宿主關注點擴散到提供方無關 API。宿主感知實作擁有其傳輸請求標頭，而公開邊界繼續顯式傳遞身份。

## 後果

深層基礎設施可以獲得一個可信的行程內發起 Agent，而無需加寬現有工具和能力請求。並行及巢狀驅動會自動隔離，AgentLoop 不增加新的必需服務，HMR（熱模組替換）或根 Context dispose 會在停用 ALS 前達到完全靜止。

該相依性不會出現在函式簽名中，並且攜帶一個具有控制能力的 Agent 對象。消費端必須將其限制在橫切基礎設施中，把隱式存在視為既不證明存活、也不授予權限，並保留顯式取消和歸屬檢查。ALS 還有常駐傳播成本，也無法跨越 worker、行程、HTTP 或持久化佇列邊界。

該銷毀設計有意相依性 Node 的 [Stability 1（實驗性）](https://nodejs.org/api/async_context.html#asynclocalstoragedisable) API `AsyncLocalStorage.disable()`。Node 要求在 ALS 實例可被垃圾回收前呼叫 `disable()`，這對 HMR 替換 AgentRegistry 所擁有的實例尤為重要；服務狀態守衛會阻止 dispose 後透過後續邊界重新進入該實例。

該作用域有意只攜帶 Agent，省略輪次、步驟、`signal`、`cwd`、沙盒和授權。若真實消費端無法使用現有顯式欄位，必須另行論證擴充；過時欄位最多隻能誤標遙測資料，絕不能授予控制權。
