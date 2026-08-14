# Agent Note: 登錄檔邊界上的協作式工具取消

Status: implemented

[English](2026-07-19-cooperative-tool-cancellation.md) | [简体中文](2026-07-19-cooperative-tool-cancellation.zh.md) | 繁體中文

## 問題

每次類型化工具呼叫都需要一個由呼叫方持有的取消訊號。選填的 `ToolExecutionInput.signal` 允許直接呼叫方不承擔所有權，使每個工具主體中的 `exec.signal` 都成為選填值，也會誘使登錄檔提供無法表達真實呼叫方生命週期的後備訊號。

管線各階段對可變性的需求也不同。工具實作、前置策略、後置策略和結果觀察者只借用取消狀態，而環繞調度包裝層必須臨時替換訊號，以加入截止時間或其他詞法取消作用域。單一的可變公開類型要麼把修改權限授予過多階段，要麼阻止這種組合。

取消可能發生在策略之前、審批期間、環繞調度等待期間、工具主體啟動之後，或後置策略等待期間。單一的 `ABORTED` 結果無法讓持久化結果的消費端判斷工具主體是否可能產生過副作用。讓工具 promise 與取消競速也不是安全的後備方案，因為登錄檔報告完成後，被丟棄的同進程工作仍會繼續執行。

## 決策

`ToolExecutionInput.signal` 是必填且只讀的 `AbortSignal`，因此 `ToolExecution.signal` 和 `ToolRunContext.signal` 也都是必填且只讀。每個類型化呼叫方顯式提供自己持有的訊號；登錄檔不提供重載、默認控制器、永不中止哨兵或便捷執行路徑。

`ToolDefinition.execute(args, exec)` 保持現有簽名。`defineTool()` 會把 `exec.signal` 上下文推斷為必填的 `AbortSignal`，因此每個已註冊的 TypeScript 工具都能在無需類型斷言的情況下觀察或轉發取消。所有第一方直接呼叫方和 Code Mode 巢狀調度都會顯式傳入當前操作的訊號。

登錄檔信任這份類型化同進程約定。它不在執行時期校驗 `AbortSignal`，也不為缺失或畸形訊號新增敵意輸入測試。校驗仍位於解析器與設定、模型與工具 JSON、持久化與文件、worker、行程和協議邊界；違反 TypeScript 介面的無類型 JavaScript 不享有相容性約定。

### 可變性由管線階段決定

`ToolDispatchExecution` 與 `ToolExecution` 相同，唯一差異是其必填 `signal` 可修改。只有 `tools/execute` waterfall（瀑布式事件）接收這個類型。前置策略、後置策略、結果觀察者、守衛和工具實作接收登錄檔私有可變執行對象的只讀檢視表。

環繞調度包裝層可以在委託期間替換 `exec.signal`，但無法透過類型系統刪除它或賦值為 `undefined`。登錄檔在可變對象之外捕獲必填的呼叫方訊號，在工具主體呼叫前把每次包裝層替換與呼叫方訊號融合，在完成後移除僅屬於本次調度的監聽器，並無條件復原必填的上游訊號。

### 取消程式碼記錄是否發生過調度

`dsh-tools` 匯出 `TOOL_ABORTED = 'ABORTED'` 和 `TOOL_ABORTED_BEFORE_DISPATCH = 'ABORTED_BEFORE_DISPATCH'`。登錄檔在呼叫 `ToolDefinition.execute()` 的前一刻記錄工具主體已呼叫。

`ABORTED_BEFORE_DISPATCH` 攜帶 `{ name: 'AbortError' }` 和模型可見文字 `Error: tool call aborted before dispatch`。凡取消阻止工具主體呼叫時都使用該結果，包括進入時已中止、前置策略或審批期間取消、包裝層訊號已中止、包裝層在委託前返回的成功結果被呼叫方取消搶先，以及輪次取消後 agent loop（代理循環）跳過的同批呼叫。

`ABORTED` 攜帶模型可見文字 `Error: tool call aborted`，並且只在工具主體已經呼叫後使用，包括工具主體完成後環繞包裝層或後置策略監聽器等待期間發生的取消。拒絕、包裝層失敗、工具失敗或後置策略失敗比通用取消更具體。timeout-policy 自身擁有的逾時仍為 `TOOL_TIMEOUT`，成功結果被取消替換前延後附加的上下文仍會保留。

### 進入時已中止會在物化後短路

登錄檔先建立呼叫 token，對可見工具定義的選填 `finalizeContent` callback 做快照，並對參數進行無損快照和凍結。即使呼叫方訊號已經中止，參數物化失敗仍優先返回。在最終內容處理之前，登錄檔還會對候選結果進行無損快照，並把結果快照失敗轉換為普通錯誤，從而使該 callback 仍能保證其內容不變數成立。參數物化成功後，進入時已中止的訊號會跳過 `tools/pre-execute`、審批、`tools/execute`、`tools/post-execute` 和工具主體，然後先由該僅處理內容的 callback 處理 `ABORTED_BEFORE_DISPATCH`，再發布且只發布一次凍結的權威 `tools/result`。

### 已啟動工作仍必須完全靜止

工具主體一旦啟動，登錄檔就會等待它完成。取消透過融合訊號到達工具主體，但登錄檔不會與其 promise 競速或丟棄該 promise。協作式實作會停止自身工作或繼續轉發取消，並在所持有的工作完全靜止後完成；不協作的同進程實作可能讓登錄檔無限期保持等待。行程、worker、網路和提供方層仍負責各自的終止機制。

這項決策只要求工具呼叫邊界攜帶取消訊號。讓工具主體可達的非同步能力也必須接收訊號，屬於另一項遷移，見提議中的[工具可達能力 seam 中的必填取消](../../proposed/architecture/2026-07-19-required-cancellation-through-tool-capability-seams.md)。

## 驗證

[`execution-signal-types.spec.ts`](../../../../packages/core/tools/tests/execution-signal-types.spec.ts) 證明必填的精確訊號類型、觀察者與工具的只讀檢視表、環繞調度可替換但不可刪除的檢視表，以及 `defineTool()` 推斷。[`tools.spec.ts`](../../../../packages/core/tools/tests/tools.spec.ts) 覆蓋進入時已中止的物化與階段跳過、策略和包裝層競態、工具主體呼叫分類、呼叫方訊號融合、錯誤優先級、上下文保留和完全靜止。[`tool-calls.spec.ts`](../../../../packages/core/agent-loop/tests/tool-calls.spec.ts) 與 [`contract-regressions.spec.ts`](../../../../packages/core/agent-loop/tests/contract-regressions.spec.ts) 覆蓋為未調度的同批呼叫補齊持久化結果。[`code-mode.spec.ts`](../../../../packages/core/tools/tests/code-mode.spec.ts) 和第一方整合測試覆蓋顯式轉發，[`timeout-policy.spec.ts`](../../../../packages/guard/timeout-policy/tests/timeout-policy.spec.ts) 保持逾時歸屬。

任何登錄檔測試都無法證明任意第三方同進程程式碼會觀察訊號或在有界時間內停止。各能力的測試仍需在擁有相應副作用的邊界證明取消與完全靜止。

## 考慮過的替代方案

**保留選填訊號並生成後備值。** 不予採納，因為登錄檔持有的後備訊號不代表任何呼叫方生命週期，也會保留類型系統本應阻止的缺失情況。

**在執行時期校驗 `AbortSignal`。** 不予採納，因為這是類型化同進程邊界，不是序列化邊界。執行時期檢查只會重複靜態約定，仍無法強制實作協作式使用訊號。

**新增 `supportsCancellation` 元資料、回呼參數數量檢查或訊號使用 lint。** 不予採納，因為這些方法都無法證明非同步工作會觀察或正確轉發取消。訊號可用性屬於類型約定；具體行為仍由工具和能力負責。

**向所有階段公開同一個可變執行類型。** 不予採納，因為觀察者和工具實作只需要借用訊號。按階段劃分類型可以把替換權限限制在管線擁有該操作的位置。

**禁止環繞包裝層替換訊號。** 不予採納，因為截止時間和巢狀操作作用域需要詞法派生訊號。捕獲並融合調用方訊號既保留組合能力，也不允許切斷呼叫方取消。

**讓工具 promise 與取消競速。** 不予採納，因為這種方式會在副作用仍可能存活時報告完成，違反[dispose（資源釋放）必須完全靜止的規則](../../../../docs/defensive-patterns.md#dispose-must-reach-quiescence-not-just-request-it)。

## 後果

- TypeScript 會拒絕所有缺少 `signal` 的 `ToolExecutionInput`、工具或觀察者對只讀訊號的修改，以及環繞調度刪除訊號的嘗試。
- 持久化結果的消費端可以區分工具主體可能產生過副作用的呼叫（`ABORTED`）和從未進入工具主體的呼叫（`ABORTED_BEFORE_DISPATCH`）。
- 根據倉庫的預發布原則，這項變更刻意保持破壞性；不保留相容重載或執行時期後備行為。
- 協作式工具會及時停止並完全靜止；忽略訊號的實作會表現為仍在等待的呼叫。
- 下游能力介面保持不變，直到關聯的提議 Agent Note 被接受並實作。
