# Agent Note: 將僅用於追蹤的工作階段事實摺疊進承載實際功能的事件

Status: implemented

[English](2026-06-20-collapse-trace-only-session-events.md) | 繁體中文

## 問題

工作階段事件詞彙中包含一些一等事件，它們不屬於可重播的對話歷史，在生產環境中幾乎沒有消費端。`usage` 已經作為模型流區塊存在，之後迴圈又追加了一個獨立的 `usage` 事件。`error` 與 `turn/end { kind: 'error', message, code }` 中的迴圈失敗原因重複；ACP（Agent Client Protocol）結帳讀取輪次結束原因，而訊息投影和 UI 投影都會跳過獨立的 `error` 事件。

這些事件讓規範的 transcript（文字記錄）看起來比實際更適合作為遙測資料。它們增加了事件變體、不變式、測試、快照和持久化用例，但作為獨立記錄並不承載實際功能。它們攜帶的事實仍然有用：token 用量應當保留以供覈算，錯誤的步驟編號也不應悄然消失。簡化的方式是將這些事實摺疊進消費端本已必須理解的鄰近事件，而非減少記錄的資訊量。

## 決策

僅在資訊已被保留、無需平行記錄的情況下，移除獨立的、僅用於追蹤的事件：

- 成功步驟的 usage 摺疊進匹配的 `assistant/message`（`assistant/message { turn, step, content, usage? }`），使組裝好的模型輸出與其覈算資訊一同傳遞。
- 失敗或中止的步驟如果有 usage 但沒有助手內容，則將 usage 放在一個空內容的 `assistant/message { content: [], usage }` 上——不會有已持久化的 usage 區塊無處安放。必須確保資訊不丟失的典型情形是 max-tokens 路徑：一個被截斷的步驟有 usage 但內容為空（例如只有一個被丟棄的工具呼叫），以前會發出獨立的 `usage`。為防止空內容事件向提供方 transcript 注入一個多餘的無內容的助手輪次，`deriveMessages()` 跳過空內容的 `assistant/message` 事件；回歸測試斷言 usage 仍有記錄，且派生歷史未被破壞。
- 獨立 `error` 事件中的步驟編號摺疊進 `turn/end.reason`（當 `kind: 'error'` 時：`{ kind: 'error', step, message, code? }`）——`turn/end` 是 ACP 和復原機制已經消費的持久輪次結果。
- `agent/error` 與日誌保留用於即時診斷；`turn/end` 之後不再有第二條工作階段日誌錯誤記錄。

使用者對話日誌包含渲染、復原、審計和覈算所需的全部資訊，消費端無需協調重複的追蹤行。

## 曾考慮的替代方案

**保留獨立行作為遙測**——這些事件讓規範 transcript 看起來比實際更適合作為遙測資料，代價是增加了事件變體、不變式、測試、快照和持久化用例，卻沒有任何消費端使用。如果分析需求真正出現，正確的形態是投影輔助工具或帶有獨立保留策略的專用遙測儲存，而非對話日誌中的重複追蹤行。

## 驗證

`SessionEventMap` 不再包含獨立的 `usage` 或 `error`；agent loop（代理循環）不再追加獨立的 usage 事件，並透過 `turn/end { kind: 'error', step, message, code? }` 持久記錄失敗；ACP 快照和持久化測試斷言不存在僅用於追蹤的行；已錄制的 fixture（測試前置資料）使用新事件形狀，工作階段格式版本固定為 `0`（後端按預發布格式策略拒絕任何版本非 `0` 的已儲存日誌）；文件說明瞭 token 用量和執行錯誤的觀測位置。

## 後果

消費端不能再從規範日誌中篩選獨立的 `usage` 或步驟級 `error` 行，而必須從承載這些資訊的助手訊息或失敗事件中讀取這些事實。由於相同事實仍然存在——「驗證」一節給出了證明——這是合理的簡化。

## 實作說明

**格式版本。** 此變更影響已持久化的事件，但預發布工作階段格式仍固定為 `0`，拒絕任何其他版本且不做遷移。`dsh-session` 擁有寫入方和載入校驗使用的常數。單調遞增的格式版本從首次正式發布開始。

Usage 現在透過 `assistant/message.usage` 觀測；執行錯誤的步驟編號透過 `turn/end.reason`（當 `kind: 'error'` 時）觀測。`agent/error` 與日誌用於即時診斷，保持不變。
