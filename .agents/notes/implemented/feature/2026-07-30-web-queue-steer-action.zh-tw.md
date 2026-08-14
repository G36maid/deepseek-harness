# Agent Note: 將 Web 已排隊訊息轉為活動輪次的 steering（中途引導）

Status: implemented

[English](2026-07-30-web-queue-steer-action.md) | [简体中文](2026-07-30-web-queue-steer-action.zh.md) | 繁體中文

## 問題

Web composer 原本會在 agent（代理）執行期間把所有 Enter 提交作為 Queue 入隊。QueueDock 已經為每條待處理訊息提供可尋址的行，持久 transcript（文字記錄）也已能把消費後的 steer 事件渲染為使用者樣式氣泡，但 Web 既沒有連線這兩個介面的操作，也沒有讓使用者從 composer 直接選擇當前輪次 steering 的手勢。

如果 Web 先在用戶端刪除該行，再呼叫 `session.prompt(mode: 'steer')`，就會把使用者的一次意圖拆分到兩個 RPC 中。驅動程式器可能在兩次呼叫之間先認領該項，steering 投遞也可能在刪除後失敗；現有盡力而為的 `agent.steer()` 回退還可能在原單次入隊項被移除後，靜默追加一個新的 Queue 項。因此，立即傳送操作必須區分當前輪次 steering 與 Queue 前移，並在 steering 已不可用時保留原行。

## 決策

### 產品約定

普通工作階段中每個非編輯態的 QueueDock 行都會提供名為「插話傳送」的向上箭頭操作。僅當工作階段報告 agent 正在執行時期，該操作才會啟用；包含混合內容的訊息仍可使用，因為 steering 會轉發完整且不可變的 `UserMessage`，而非該行的文字投影。已尋址 subagent 的 Queue 投影保持只讀，因為其繼續執行傳輸不提供 Queue 變更。

觸發該操作會針對對應的 `InboxItemId` 請求嚴格的當前輪次 steering。操作成功後，權威 Host 快照會移除 Queue 行，並在 `Deep diving...` 執行狀態行之後立即投影同一條待處理 steering；該氣泡提供複製，但訊息尚無持久事件序號，因此不提供 fork。AgentLoop 排空該項後，現有持久 `user/message` 事件會接管同一個使用者樣式氣泡，並復原時鐘、複製和 fork，無需另建持久展示路徑。

running 標志位只用於提示互動狀態。在同步變更邊界上，AgentLoop 的 `acceptsNextStep` 值纔是權威依據。如果該視窗已經關閉，操作會保持 Queue 單次入隊項不變並返回類型化的 `steer-unavailable` 錯誤，隨後原喚醒單次入隊項會經 Queue 繼續執行。如果驅動程式器已經認領該項，則返回現有的 `queue-item-not-found` 錯誤，且獨立輪次投遞已經開始。UI 會把兩種競態都視為已收斂的 Queue 投遞，不顯示失敗通知；傳輸和未知錯誤仍會顯示。

Composer 對新輸入採用另一套盡力而為約定。所尋址工作階段空閒時，Enter 和 Cmd/Ctrl+Enter 都執行普通 Queue 傳送。主工作階段執行期間，General Settings 偏好會把普通 Enter 分配為 Queue（預設值）或 Steer，Cmd/Ctrl+Enter 則執行另一種行為；Shift+Enter 用於換行。已尋址 subagent 會讓這兩個手勢都使用其僅支持 Queue 的繼續執行傳輸。Host settings 文件會在共享同一 DSH home 的 Web origin 之間持久化該偏好，並且它隻影響支持 steering 的繁忙態手勢對。如果 composer 直接寄出的 Steer 錯過當前 next-step 視窗，AgentLoop 會自動將其接納為下一條喚醒 Queue 輪次，Web 不顯示失敗。

### Agent 與生命週期邊界

`InboxAction` 會在編輯和移除之外，新增由實際消費端支撐的 `{ kind: 'steer' }` 操作。`Agent.updateInbox()` 只有在找到 queued 單次入隊項並確認 `acceptsNextStep` 後才會處理該操作，絕不會委託給盡力而為的 `agent.steer()` 別名。

操作成功應用後，系統會結束 queued 單次入隊項，並把同一個不可變 `UserMessage` 接受為新的 steering 單次入隊項。steering 單次入隊項會獲得新的 `InboxItemId` 和如實反映投遞方式的 `placement: 'steering'`，訊息則保留其 `MessageId`、內容、來源和任何待處理 `SteeringReceipt` 投遞控制器。AgentLoop 會先安裝新的 outbox 項，再發布生命週期事件；隨後先發出新單次入隊項的 enqueue，再發出舊單次入隊項的 discard，確保可重入取消無法觀察或退役一個尚未公佈的項。因此，現有 inbox 守恆不變數仍然要求每個單次入隊項恰好對應一個 enqueue，以及一個終態 dequeue 或 discard。

該操作不會執行 `agent/prompt-submit`：選擇 steering 會有意把投遞方式從經獨立接納的輪次改為當前輪次的 next-step 輸入。它既不會取消當前工作，也不會重新排序 Queue 中的剩餘項。

### Host 與用戶端邊界

`session.updateQueue` 會攜帶 `steer` 操作，並把兩種負面結果對映為類型化 RPC 錯誤。這項轉換是一次同步 Agent 操作；Host 絕不會透過組合移除和提示詞呼叫來重建它。

Host 仍以現有 `queuedMirror` 作為唯一的瞬態 inbox 權威。`session/queue` 快照會攜帶所有存活單次入隊項及其 `placement: 'queued' | 'steering'`：QueueDock 只渲染 queued 行，ChatView 則在工作階段流末尾、`Deep diving...` 執行狀態行之後渲染待處理 steering，提供複製操作，但不提供 fork、編輯或刪除操作。重連會重放同一份快照，因此這項可見性既不相依性用戶端樂觀展示，也不需要第二個登錄檔。

AgentLoop 認領待處理 steering 時，會在同步追加持久 `user/message` 之前立即寄出 `agent/inbox/dequeue`。Host 會等到下一個微任務才退役該 steering 行，讓持久工作階段事件先進入線性 mux 流。用戶端 Session 接納該即時事件時，會在發布快照前退役第一個匹配的當前 steering 單次入隊項；歷史重播不會消費後來複用同一 `MessageId` 的單次入隊項。因此，ChatView 無需掃描持久歷史就能每次只渲染一份權威，持久投影則會根據已記錄的事件時間與序號復原時鐘、複製與 fork 操作。追加失敗時，已認領行仍會退役。

現有 `session.prompt(mode: 'steer')` 對主工作階段新輸入仍採用盡力而為的約定：在 next-step 視窗之外，它會變為喚醒 agent 的後續輪次。Composer 會讓顯式 `queue | steer` 模式經過 slash 裁決與引用序列化，再呼叫該約定。瀏覽器提交策略擁有即時繁忙態 Enter 偏好，而 Host settings 服務擁有持久性；該策略只為支持 steering 的工作階段把普通 Enter 與加速 Enter 解析為互補手勢，Settings 行和 InputBar 共享該策略，不重複實作儲存或投遞視窗權威。只有 Queue 行操作採用嚴格語義，因為任一種負面結果都會經原 Queue 單次入隊項收斂。

### 驗證

AgentLoop 約定覆蓋保持提示詞接納視窗打開，轉換一個精確的 queued 單次入隊項，並證明替代它的 steering 單次入隊項保留訊息值和投遞回執、以 `user/message` 的形式排空，且絕不啟動原本的獨立輪次。該覆蓋還釘住視窗不可用時保留原項、拒絕已被認領的地址，以及可重入取消下的生命週期守恆。

Host schema 和代理測試覆蓋新操作、兩種類型化錯誤、帶 placement 的快照與重連重放，以及先持久化再退役的順序。用戶端測試覆蓋兩種語義競態的靜默收斂、真實錯誤報告、只讀 subagent 行和僅支持 Queue 的 subagent 手勢。執行時期與 ChatView 測試覆蓋按單次入隊項完成的待處理到持久交接，包括重複的 `MessageId` 值；Web ARIA 快照則覆蓋位於執行狀態行之後且僅有複製的待處理 steering，以及帶時鐘、複製和 fork 的持久節點。

無金鑰 Web steering 場景在第一次回應流式輸出期間，透過真實 composer 排隊一則訊息並觸發行上的箭頭，再用 `ask_user_question` 作為穩定的待處理 steering 屏障。該場景證明 Host 支撐的待處理氣泡會在准入前出現，在回答後交接為唯一一條持久插話，並影響下一次模型請求。組裝後的 composer 場景證明默認模式下的 Cmd+Enter 無需建立 Queue 行，也會進入同一條待處理與持久路徑；Steer 模式下的 Cmd+Enter 則會建立 Queue 行。Settings 與提交策略覆蓋會固定預設值、持久化、僅限繁忙態的作用域和互補手勢對映；Queue 編輯／刪除場景繼續證明這些操作沒有變化。

## 考慮過的替代方案

**在 Web 中刪除該行，再呼叫 `session.prompt(mode: 'steer')`。** 不予採納，因為兩個 RPC 無法讓刪除和 steering 成為原子操作；失敗和驅動程式器認領競態可能丟失或重複使用者訊息。

**復原向上箭頭對應的 Queue 前移操作。** 不予採納，因為把某個項移到隊首仍然會建立一個獨立接納的輪次。該控制元件承諾的是當前輪次 steering，而不是 Queue 內的優先級。

**為 Queue 行使用現有盡力而為的 `agent.steer()` 行為。** 不予採納，因為關閉的 next-step 視窗會建立新的 queued 單次入隊項，而且位置和標識可能不同。嚴格拒絕會保留原單次入隊項，讓 UI 能將其視為同一次已接納的 Queue 投遞。新輸入的 composer 訊息沒有需要保留的現有 Queue 單次入隊項，因此有意採用盡力而為行為。

**讓每個呼叫方使用的 `agent.steer()` 都採用嚴格語義。** 不予採納，因為 TUI 和外掛程式呼叫方會針對新提交的輸入使用其安全的後續輪次回退。queued 行具有這些呼叫方不具備的可復原狀態。

**改變投遞方式時保留同一個 `InboxItemId`。** 不予採納，因為 `InboxItemId` 標識一次 FIFO 接受，而 `placement` 記錄該次接受解析出的投遞方式。結束一個 queued 單次入隊項並接受一個 steering 單次入隊項，能夠使生命週期事實保持如實，並讓守恆不變數保持不變。

**增加專用的待處理 steering 投影和用戶端 store。** 不予採納，因為 queued 與 steering 單次入隊項已經共享同一套 Agent inbox 生命週期和 Host mirror。第二份投影會重複保存重連狀態與順序權威；placement 標籤能讓各用戶端介面選取自己的行，而不擴大 Queue 變更語義。

**取消活動輪次並執行選中的 Queue 項。** 不予採納，因為這會破壞無關的進行中工作，並且會啟動新輪次，而不是 steering 當前輪次。

## 後果

`session/queue` 表示帶 placement 的瞬態 inbox 快照，而不只是 Queue 清單，因此每個消費端都必須按 placement 過濾。待處理 steering 會在介面中立即出現並能在重連後復原，但在持久 `user/message` 提交前仍不持久。嚴格 next-step 視窗關閉後，running 標志位仍可能短暫保持為 true，因此已啟用的操作可能會在內部返回 `steer-unavailable`，而產品仍經 Queue 繼續執行且不顯示失敗。

這項顯式操作會把投遞方式從經獨立接納的輪次改為當前輪次 steering，因此提示詞接納外掛程式不會處理轉換後的訊息。為保證可重入取消安全，生命週期事件仍必須先發布 enqueue 再發布 discard；有針對性的回歸覆蓋會保護這一順序。
