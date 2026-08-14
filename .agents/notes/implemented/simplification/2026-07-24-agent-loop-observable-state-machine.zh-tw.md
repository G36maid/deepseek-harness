# Agent Note: 圍繞可觀察狀態機收攏 agent loop 事件

Status: implemented

[English](2026-07-24-agent-loop-observable-state-machine.md) | [简体中文](2026-07-24-agent-loop-observable-state-machine.zh.md) | 繁體中文

## 問題

agent loop（代理循環）曾將其控制流暴露為大量 Cordis 事件。`pre-step` 和 `post-step` 兩個獨立檢查點分列步驟前後，`session-prefix` 和 `step-result` 分別變換請求訊息與回應訊息，`request-error` 決定失敗的請求是否在當前輪次內重試，`turn-continuation` 與 `turn-stop` 則組合相互競爭的繼續執行決策。

即使持久工作階段日誌已經記錄了對應的輪次與步驟事實，這些事件仍會將內部階段公開。它們還混用了兩種擴充模型：部分監聽器觀察邊界並行出 agent 命令，另一些監聽器則返回由迴圈解釋的控制決策。因此，要理解公開狀態機，必須同時還原事件順序、waterfall（瀑布式事件）優先級和特殊的終止覆蓋規則。

agent 生命週期、agent 整體活動狀態、收件箱條目的進度以及每輪次的結帳，是彼此獨立的狀態維度。若將它們視為一個狀態或一條線性回呼序列，常見問題就會產生歧義：agent 可以在多個輪次之間持續保持 `running`；已接受的條目可以不啟動輪次就被丟棄；一個輪次可以完成結帳，而後續工作仍讓 agent 保持活動。

## 決策

公開約定暴露四個正交的狀態維度：

- 註冊生命週期是從 `agent/created` 到 `agent/disposed` 的區間。dispose（資源釋放）是登錄檔的終止邊界，而不是一種 `AgentStatus`。
- agent 整體活動狀態為 `AgentStatus = 'idle' | 'running'`。連續多個輪次可以共用同一個 `running` 區間。
- 待處理訊息插入時會發出 `agent/inbox/inserted`，隨後要麼在原子純刪除領取後寄出 `agent/inbox/claimed`，要麼在普通刪除後寄出 `agent/inbox/discarded`。`MessageId` 關聯確切訊息；持久 splice 坐標保留位置資訊與取消資訊。inbox 事件描述插入、領取和丟棄，而不是輪次完成。
- 已領取的輪次經過 pre-step 進入決策和零個或多個請求步驟。自動重試會關閉失敗輪次並立即開啟另一個輪次；`agent/settled` 只報告該重試鏈的終態輪次，且仍不同於 agent 整體轉換到 `status === 'idle'`。

迴圈保留四個狀態機擴充事件。`agent/pre-step` 對獨佔的已領取批次執行 reject 或 enter 決策，並在每個擬議步驟前執行。`agent/request` 是凍結呼叫設定所用的 waterfall；設定只能來自 `await next()`，不再透過重複的位置參數提供。`agent/request-error` 序列確定需要等待的模型請求復原由誰負責。當輪次原本已經沒有剩餘工作時，`agent/turn-stopping` 執行；需要再執行一個步驟的監聽器使用 `agent.steer()` 記錄真實的 steering（中途引導），迴圈在所有監聽器完成後根據這份資料作出決定。

是否繼續和終止執行由資料表達，不再由返回的控制枚舉表達。工具呼叫和已接受的 steering 要求再執行一個步驟。攜帶 `concludesTurn` 的工具結果會在其所屬步驟終止工具迴圈。迴圈不再暴露通用的 `ContinuationDecision` 或終止返回通道。

模型請求失敗會先關閉當前步驟，再攜帶該錯誤本身、標準化 `LlmFailure` 和仍有效的輪次訊號進入 `agent/request-error`。負責復原的監聽器修復狀態、返回 `{ kind: 'retry' }`，並停止繼續委託。迴圈會關閉失敗輪次，並基於該狀態開啟一個重試輪次，中間不發布空閒通知；重試不是失敗輪次內的另一個步驟。`agent/settled` 報告終態結果；對於需要脫離輪次結帳單獨報告失敗的消費端，`agent/error` 仍作為即時錯誤通知保留。[重試動作決策](2026-07-27-request-error-retry-action.md)取代了本設計中命令形式的部分。

事件分類體系移除了舊的提示詞準備／提交與序列步驟掛鉤，以及 `agent/post-step`、`agent/session-prefix`、`agent/step-result`、`agent/turn-continuation` 和 `agent/turn-stop`。唯一的 `agent/pre-step` waterfall 負責已領取消息能否進入步驟。持久的輪次與步驟邊界仍由工作階段事件記錄。面向模型的新增內容使用有日誌記錄的訊息通道，請求設定使用 `agent/request`，回應內容按組裝後的原樣記錄，失敗請求復原使用 `agent/request-error` 返回動作，輪次結束時是否繼續則使用 `agent/turn-stopping` 加 steering 表達。

## 考慮過的替代方案

**保留細粒度事件序列。** 這樣可以為每個內部階段保留專用攔截點，包括僅用於請求的前綴、助手訊息改寫、步驟後處理、輪次內請求復原以及終止覆蓋。但這也會使迴圈的私有執行順序成為永久的公開約定，並允許相互重疊的擴充點表達彼此衝突的決策。當前決策接受這些攔截點的缺失，以換取每項受支持的擴充職責僅對應一個邊界。

**將 dispose 表示為第三種 `AgentStatus`。** 這樣會讓仍被持有的控制代碼得到一個終止狀態值，但也會重複表達 `agent/disposed` 已經體現的登錄檔生命週期。當前決策讓 `AgentStatus` 只表示 agent 存續期間的活動狀態，並將註冊生命週期作為獨立維度。

**讓 `agent/request-error` 返回重試決策。** 這一替代方案已由[重試動作決策](2026-07-27-request-error-retry-action.md)取代；新決策移除了重複命令，並將決策侷限於 waterfall 的返回結果。

**將持久的輪次與步驟邊界對映為 agent 事件。** 這樣會為同一事實向即時消費端提供第二條事件串流。當前決策將工作階段日誌保留為真源，僅暴露擴充檢查點或持久事件串流無法承載的純即時事實。

## 影響

可觀察狀態機更小，也更容易組合：註冊生命週期、活動狀態、條目進度和終態結帳可以分別追蹤。尤其是，`agent/settled` 並不意味著 `agent.status === 'idle'`；前者報告一次排空鏈的終態輪次，`agent/status` 則報告整個 agent 是否處於活動狀態。

外掛程式不再能夠改寫迴圈的每個階段。不再提供僅用於請求的訊息前綴、助手訊息變換、步驟後檢查點、通用的繼續執行枚舉、通用的終止結果或輪次內請求重試。擴充改用剩餘的歸屬明確的通道，而不是重新構造這些階段。

負責繼續執行的外掛程式發布可持久化的 steering，而不是返回未記錄到日誌中的原因。復原外掛程式在失敗步驟結束後處理錯誤，並返回顯式重試動作。這樣，每次嘗試都會成為完整輪次，同時非同步修復和策略歸屬集中在一個狹窄的 waterfall 邊界。

收件箱生命週期用於補充持久工作階段日誌，而非取代它。`MessageId` 將接受操作與領取或丟棄操作關聯起來；輪次編號與步驟編號、訊息、工具活動和終止原因仍屬於工作階段事實。

## 相關內容

- [統一 agent 交付路由，並將注入上下文合併到 user/message](../architecture/2026-07-22-unified-send-and-coalesced-user-messages.md)
- [移除普通傳送中的隱式批次處理](2026-07-17-one-send-one-turn.md)
- [微核心事件分類體系](../architecture/2026-06-11-microkernel-event-taxonomy.md)
- [有界 LLM（大型語言模型）請求復原](../architecture/2026-06-21-bounded-llm-request-recovery.md)
- [可重建的請求](../architecture/2026-07-05-reconstructable-requests.md)
