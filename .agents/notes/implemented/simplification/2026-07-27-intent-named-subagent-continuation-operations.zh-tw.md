# Agent Note: 按意圖命名的 subagent 繼續執行操作

Status: implemented

[English](2026-07-27-intent-named-subagent-continuation-operations.md) | 繁體中文

當前基於 Activation 的實作由[可繼續的 subagent](../feature/2026-07-28-continuable-subagent-conversations.md)負責。它保留本記錄命名的 `followup` 操作，返回已接受的 `MessageId`，使用裸 `Agent` 參數作為確切的線上直屬父級權限，並將提供方對可繼續 child 的參與限制為 `prepareContinuable`。

## 問題

將可繼續 child 的編排合併到 `ctx.subagents` 後，提供方分發與呼叫方意圖共存於同一個公開服務中。`resume(name, request)` 接受描述符、已鑒權的 parent、持久化 child id 與啟用訊號，而只有內部繼續執行管理器才能正確解析這些資料。`sendMessage(...)` 暴露的是傳輸層措辭，而不是 `Agent` 已採用的 `followup` 意圖；它還將來源與訊號拆成獨立參數，擴大了操作介面，而每個呼叫方都必須以原子方式同時使用二者。

持久性邊界還同時公開了 `SessionStore.flush()` 與 `flushRequired()`。二者執行相同的作用域內平行分發，唯一差別是是否接受空的監聽器快照，因此工作階段介面將一個消費端的策略編碼為第二項操作。

## 決策

`SubagentRuntime` 分離四種執行意圖：`start(name, request)` 返回普通的、由持有方負責的 one-shot run；`startContinuable(spec)` 建立持久化 child，並返回其 id 與已接受的初始 `MessageId`；`followup(parent, childId, content, { source, signal })` 傳送後續 parent 內容；`reportFrom(child, content, { delivery, signal })` 將選定的 child 內容傳送給其直接 parent。`followup` 與 `Agent.followup()` 一致，而 `SubagentRun.steer()` 仍是範圍更窄的能力，僅向已確認仍在執行的 run 提供 steering（中途引導）。面向模型的工具保留穩定的 `send_message` 與 `report` 名稱，並將路由委託給對應的意圖方法。

呼叫方請求與提供方請求相互分離。`SubagentStartRequest` 包含呼叫方提供的 one-shot 資料；`ResolvedSubagentStartRequest` 會在呼叫 `SubagentProvider.start()` 前加入由服務解析的描述符。建立可繼續 child 時，管理器將 `ContinuableCreateRequest` 傳給選填的 `SubagentProvider.prepareContinuable()`，且只接收分離的建立資料。`SubagentRuntime.resume()` 與提供方復原分發均不存在：繼續執行管理器載入描述符、對 parent 進行鑒權，並負責 Agent 實體化、提示詞投遞、冷復原與 teardown。

`SessionStore.flush(session)` 是唯一的持久性屏障，並返回 `Promise<boolean>`。至少一個作用域內監聽器成功參與後，它解析為 `true`；監聽器快照為空時解析為 `false`；所有監聽器結帳後，如有失敗，則以註冊順序最靠前的監聽器錯誤拒絕。參與結果無法表明所選的持久化後端是否已經儲存狀態。普通檢查點可以忽略該布林值；繼續執行管理器同樣將最終 flush 視為 best-effort 屏障，有意忽略參與結果，記錄拒絕日誌，並仍會對 child 執行 dispose（資源釋放）並釋放所有權。

## 已考慮的替代方案

**保留公開的提供方復原分發。** 繼續執行管理器之外，沒有任何生產呼叫方同時負責安全呼叫所需的描述符尋找、直接 parent 鑒權、Agent 實體化、Activation 所有權與 child-first teardown。公開方法會暴露已解析的實作資料，卻沒有合理的獨立呼叫意圖；提供方改為透過 `prepareContinuable` 貢獻分離的首次建立資料，且從不參與冷復原。

**在服務上保留 `sendMessage`。** 面向模型的工具傳送訊息，但服務操作表達的是後續操作，既可能對執行中的啟用執行 steering，也可能從持久化儲存復原。`followup` 與結構化 `Agent` 介面保持一致，也不承諾特定路由。

**保留 `flushRequired()`。** 第二個方法只封裝了空監聽器檢查。由現有屏障返回是否有監聽器參與，可以讓分發只保留一套實作，並讓每個呼叫方自行判定缺少監聽器是否可接受。

**合併普通啟動與可繼續啟動。** 一個標志會讓同一方法要麼等待由持有方負責的 one-shot run 就緒後返回，要麼立即返回持久化 child 與訊息標識。按意圖拆分的方法無需回傳值聯合類型即可保留所有權與時序差異。

## 影響

- Cordis 服務目錄只包含呼叫方操作；提供方可以透過 `SubagentProvider.prepareContinuable?()` 選擇參與可繼續 child 的首次建立，但不會獲得 Agent 生命週期權限或公開復原操作。
- 後續操作的來源與取消訊號透過同一個選項對象傳遞，與 `Agent` 上按意圖命名的輔助方法形態一致，同時保留線上投遞與從持久化儲存復原的語義。
- 工作階段持久性只有一個屏障操作。參與結果仍可觀測，但任何可繼續 child 路徑都不會將任意監聽器參與視為持久化後端已儲存狀態的證明。
- `send_message` 與 `report` schema、已接受的訊息標識、`AgentHandle` 所有權、持久化事件詞彙與模型可見的 transcript（文字記錄）遵循上文連結的基於 Activation 的實作。
