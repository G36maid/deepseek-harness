# Agent Note: 讓 JSON-RPC 完成結果與傳輸方向單一化

Status: proposed

[English](2026-07-19-make-jsonrpc-directional.md) | [简体中文](2026-07-19-make-jsonrpc-directional.zh.md) | 繁體中文

## 問題

JSON-RPC 橋接層把兩個端點都建模為對稱的對等端，但實際協議具有固定方向。共享傳輸層（現為 `dsh-sdk-protocol`，由伺服器端與 TypeScript SDK 用戶端共用，後者行使出站請求/入站通知方向）仍實作著沒有任何端點使用的兩個半邊：伺服器端發起的請求與用戶端發起的通知。Python SDK 傳送請求並接收回應或通知，卻還會把來自伺服器端、但未使用的入站請求放入佇列，並公開回應輔助方法。

`session/prompt` 還會用兩種協議結構報告同一個已結束輪次。伺服器端先發出 `session.finished`，再返回常數 `{ accepted: true }`；Python SDK 丟棄該回應，轉而等待通知以取得狀態。回應只有在處理函式返回後才會寫入，因此在同一條有序流上，通知必然先於這個常數回應。

這些未使用的雙向能力引入了待處理請求表、生成 ID、請求佇列、關閉時的拒絕路徑、回應輔助方法和第二套完成等待邏輯，卻沒有任何生產呼叫方使用。

## 提案

按實際角色收窄兩個端點。伺服器端保留入站請求、出站回應和出站通知；TypeScript 與 Python 用戶端保留出站請求以及入站回應或通知。刪除沒有任何端點使用的方向——伺服器端發起的請求與用戶端發起的通知。

在 `agent.whenIdle()` 完成後，由 `session/prompt` 直接返回 `{ status, reason }` 作為輪次結果。刪除 `session.finished`、常數接納回應以及 Python 中回應後的完成等待迴圈。`session.event` 與 subagent 通知仍在回應前流式寄出，持久化工作階段事件仍是最終回應重建的真源。

## 實施計畫

1. 在 `packages/sdk/server/src/server.ts` 中，用 `status: 'ok' | 'error' | 'aborted'` 和捕獲的 `TurnEndReason` 替換 `SessionPromptResult.accepted`。`HarnessSdkJsonRpcServer.prompt()` 把 `completed` 對映為 `ok`，把 `aborted` 對映為 `aborted`，把其他當前已有或可透過聲明合併擴充的原因對映為 `error`；進入空閒狀態卻沒有 `turn/end` 仍視為不變數錯誤。只刪除 `session.finished`，保持 `session.event`、`subagent.started` 和 `subagent.finished` 不變。
2. 在 `packages/sdk/protocol/src/transport.ts` 中，把共享類收窄到有消費者的方向——入站請求/出站回應（伺服器端）與出站請求/入站回應及入站通知（TypeScript SDK 用戶端）——只刪除伺服器端發起的 `request()` 用法與用戶端發起的通知分發，或把該類拆分為伺服器端與用戶端兩個傳輸。請求結果、方法不存在與處理器錯誤回應保持原有行為，並繼續排在被等待處理器寄出的通知之後。
3. 在 `python/sdk/src/deepseek_harness/client.py`、`models.py` 和 `__init__.py` 中，刪除 `IncomingRequest`、`_requests`、`notify()`、`next_request()`、`respond()` 和 `respond_error()`。新增公開且經過校驗的 `SessionPromptResponse` 來攜帶狀態與原因，由 `session_prompt()` 返回該對象，並保留明確的讀取保護：忽略意外的伺服器端請求幀，避免它們命中回應等待器。
4. 在 `python/sdk/src/deepseek_harness/api.py` 中，根據 `SessionPromptResponse` 構造 `TurnResult.status` 和新增的 `TurnResult.reason`，再刪除 `session.finished` 分支與第二個完成迴圈。請求期間保持訂閱打開，並保留 `_request_raw()` 最後的通知排空步驟，確保寫在回應前的最後一條 `turn/end` 事件與任何 subagent 通知，都會在 `Session.run()` 重建最終助手訊息之前被收集。
5. 用按方向的覆蓋替換 `packages/sdk/protocol/tests/transport.spec.ts` 中的對稱傳輸對用例，並更新 `server.spec.ts`、`plugin-apply.spec.ts` 和 `built-scope-carrier.e2e.ts`，覆蓋直接結果、順序、重疊、關閉和收窄後的偽實作；同步更新 TypeScript SDK 用戶端（`packages/sdk/client`）及其套件以採用基於回應的結束流程。更新 `python/sdk/tests/test_client.py`，覆蓋基於回應的結束流程、意外請求幀處理、回呼與並行行為，以及已刪除的公開輔助方法。同步更新 JSON-RPC README、雙語 Python SDK README、匯出 JSDoc 與聲明、`scripts/smoke-python-runtime.py` 和 Python 單可執行文件快照。

## 備選方案

**為未來方法保留通用的對稱 JSON-RPC 對等端。** 伺服器端發起的請求將來可能用於互動式權限，但當前沒有類型化方法或生產消費端。該功能完成設計後，預發布協議可以增加所需的最小方向，無需提前保留未使用的對等端能力。

**為流式用戶端保留 `session.finished`。** 輪次結束不是增量資料：請求回應已經標識同一個邊界，並且在有序流中位於先前所有通知之後。第二條終止通知會產生兩種結果表示，迫使用戶端進行協調。

## 驗收標準

- TypeScript 端點無法發起請求，也不消費通知。
- Python 端點無法發起通知，也不消費伺服器端請求。
- 輪次結束後，`session/prompt` 返回權威的 `ok`、`error` 或 `aborted` 狀態及其原因。
- 輪次中寄出的工作階段事件與 subagent 生命週期通知都先於回應到達。
- 同一工作階段的重疊拒絕、分幀、多位元組輸入、處理器錯誤、flush、關閉順序與最終回應重建保持原有行為。
- TypeScript 橋接測試、Python SDK 測試、建置後 JSON-RPC 覆蓋、快照和生成的 API 文件全部透過。

## 風險

本提案會刻意收窄預發布協定格式。僅監聽 `session.finished` 的原始用戶端，以及使用未使用對稱傳輸方法的嵌入方，都必須改為讀取請求回應。未來若需要伺服器端發起請求，應新增類型化協議，而不是複用休眠的通用機制。
