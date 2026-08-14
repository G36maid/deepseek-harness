# Agent Note: 統一 agent id 與工作階段 id

Status: implemented

[English](2026-06-20-unify-agent-and-session-id.md) | [简体中文](2026-06-20-unify-agent-and-session-id.zh.md) | 繁體中文

## 問題

一個存活的 agent（代理）/工作階段對需要使用同一 identity 完成登錄檔路由、事件溯源和持久化。讓 factory 接受相互獨立的 `agentId` 和 `sessionId` 輸入，會允許任何生產路徑都無法使用的配對，同時迫使每個消費端為同一生命週期在兩個名稱之間選擇或轉換。

ACP（Agent Client Protocol）對兩種 identity 使用相同值。Stdio 和掛鉤也在工作階段事件流上工作，並且直接需要對應的存活 agent；沒有生產路徑會把一個存活 agent 對象重新附著到多個工作階段，或透過多個 agent id 驅動程式一個工作階段。

[agent 範圍執行時期](../architecture/2026-07-12-agent-scope-runtime-design.md)使用同一個 `AgentCreationTransaction` 執行建立和復原，agent/工作階段條目共享相同的最終條目衝突規則。第二個 identity 並不代表單獨的存活性、回滾或完全靜止；它只會圍繞同一交易增加 API 與轉換狀態。

工作階段 identity 同樣只有一個歸屬，即 `Session.header.id`；`Session.id` 是派生訪問器，而非需要重複驗證的獨立狀態。

## 決策

agent 的登錄檔 id 等於其工作階段 id。`CreateAgentOptions` 接受一個 `sessionId`，同時用於兩個最終登錄檔條目；復原時以 `resumeSessionId` 註冊 agent；行程內 subagent 建立使用子工作階段 id；`Session.id` 則派生自 `header.id`。遠端 ACP 執行沒有本機 agent/工作階段對：它保留一個由父項鑄造的生命週期 id，而子伺服器協議本機的工作階段 id 仍僅供 ACP 呼叫內部使用。現有建立交易、最終條目衝突檢查和精確條目分離語義保持不變；唯一職責是在本機 id 之間轉換的 map 與欄位已經消失。

設定驅動程式路徑保留 `agents[].id` 作為穩定設定標籤，而非存活態路由 identity。普通的全新啟動會鑄造組合 id `${label}-session-${randomUUID()}`，使持久重新啟動不會衝突。耦合應用可以預先鑄造並傳入精確的 `sessionId`：首次使用時建立它，而當持久化服務已經存在時，AgentLoop 重新掛載會在同一 identity 下復原已物化歷史。`resumeSessionId` 則要求已有的持久化 identity。兩個精確 id 輸入互斥。Stdio 使用「復原或建立」形式，使設定建立的 agent 和 UI 在迴圈重載之間共享一個不透明 identity，而不是根據前綴猜測。日誌可以使用穩定標籤，而所有存活態與持久化尋找都使用同一個 `SessionId`。

`agent/created` 和 `agent/disposed` 保留。它們是成對的發布生命週期事件，而非 identity 別名；以後若發現沒有消費端並要移除，必須先重新搜尋，再提出獨立提案。

## 曾考慮的替代方案

**保持路由與日誌 identity 分離。** 穩定的設定標籤加全新的持久對話確實有用，但不需要兩個存活 identity：標籤可以繼續作為設定/顯示元資料，而每次執行的組合 `SessionId` 負責路由和持久化。保留兩個 id 會讓轉換 map 持續存在，允許不可能的配對，卻不會增加生命週期能力。

## 驗證

- agent 建立/復原和 subagent 建立只攜帶一個 identity，`Session` 也只在一個位置儲存它。
- 建立交易繼續覆蓋最終條目衝突、精確條目分離、回滾和完全靜止，無需 identity 特有的生命週期狀態。
- ACP、stdio、掛鉤、bash 歸屬、持久化和 lineage 直接使用共享 `SessionId`。ACP subagent 後端在父命名空間中鑄造其生命週期 id，因為子伺服器返回的工作階段 id 僅在伺服器本機有效；ACP bridge 根據正向工作階段 map 驗證精確的 `Agent` 歸屬；JSON-RPC 只轉發生命週期事件中由服務快照保存的 `local` 標記為 true 的事件，從帶範圍的事件 carrier 取得委託父項，並且不保留子 identity 或 lineage cache。
- 設定驅動程式的復原或建立策略是顯式的，並在持久化重新啟動場景下得到覆蓋。
- 生產監聽器搜尋確認保留 `agent/created`/`agent/disposed` 及其發布語義。

## 後果

這排除了潛在的多工作階段 actor 和工作階段交接設計，並使由用戶端選擇、已持久化的工作階段 identity 成為登錄檔 identity。如果獨立路由 identity 成為真實需求，就需要顯式的生命週期設計，而不是由呼叫方提供一對不受約束的值。
