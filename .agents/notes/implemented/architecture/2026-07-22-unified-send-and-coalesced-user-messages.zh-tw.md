# Agent Note: 將 agent 投遞統一到 send(target × wakeup) 並把注入的上下文合併進 user/message

Status: implemented

[English](2026-07-22-unified-send-and-coalesced-user-messages.md) | [简体中文](2026-07-22-unified-send-and-coalesced-user-messages.zh.md) | 繁體中文

## 問題

agent（代理）的對外驅動介面逐漸長出三個近乎平行的動詞——`send`、`steer`、`inject`——各自帶有獨立的選項類型、獨立的即時事件敘事，以及獨立的持久事件。`send` 和 `steer` 都會把一條凍結的 inbox 記錄入隊並行出 `agent/queued`；`inject` 則繞過 inbox，寫入一條獨立的 `context/message` 持久事件。這三個動詞實際上只沿兩條獨立的軸變化：一個佇列項加入哪個佇列（一個全新的輪次，還是當前活躍的輪次），以及這個佇列項是否讓模型執行。把這個 2×2 編碼成三個手寫方法，掩蓋了其中的對稱性，讓「排入一個輪次但不喚醒驅動器」無法表達，也讓 `cancel()` 無從在保留排隊工作的前提下中止一個輪次。

另外，`context/message` 與 `user/message` 已經趨同：對外介面把二者都原樣投影為 user 角色內容，唯一真正的區別是注入的上下文攜帶非 user `source` 且「不是提示詞」。一個投影對應兩種事件類型，意味著每個消費端都要根據事件類型分支來回答「這是不是一條人類提示詞？」，而 goal 系統把這種類型區分當作側通道使用（第 0 個 Round 的狀態變更是 `context/message`，已准入的 Round 是 `user/message`）。

## 決策

**一個原語，三個預設別名。** `Agent` 介面的 `send(message, target, wakeup)` 覆蓋（`target` × `wakeup`）矩陣。完整的 `UserMessage` 持有標識、角色、模型可見 `content` 與生產方 `source`；其餘參數只持有路由策略。`followup`（`next-turn`/wakeup）、`steer`（`next-step`/wakeup）和 `inject`（`next-step`/no-wakeup）都接收這一則訊息並固定策略。`wakeup` 會在 agent 空閒時保留一個驅動器；已經活躍的驅動器不會獲得第二次保留，只有在抵達後續 pre-step 邊界時才能領取該輸入。`next-turn`/no-wakeup（入隊但不喚醒）可以表達，只是沒有別名，也沒有當前呼叫方。

**inject 是不會喚醒的 next-step 投遞。** 它始終把完整訊息追加到 next-step inbox，並在持久 `agent/inbox/spliced` 事件中記錄該插入。驅動器會在後續 pre-step 領取它，並且只有最終決策把它放入進入步驟的批次時，才會將其記錄為模型可見的 `user/message`；空閒注入會保持待處理，直到其他投遞喚醒驅動器。必填的 `UserMessage.source` 會保留呼叫方提供的源欄位。

**context/message 已移除。** 注入的上下文在 inbox 中使用同一個 `UserMessage` 值，並在獲準時成為 `user/message` 事件；上下文生產方顯式提供合適的非 `user` 類別 `source`，類型化 source 變體攜帶持久化的生產方專用欄位。對外介面、派生邏輯和 `SurfaceEventType` 都不再包含 `context/message`；需要判斷「這是不是一條人類提示詞？」的消費端改為讀取 `source.kind === 'user'`，而不是事件類型。

**Goal 繼續執行歸屬使用正數 Round。** Goal 生命週期狀態透過後續的[Goal 自有持久事件決策](2026-07-31-goal-owned-durable-events.md)所定義的領域自有 `goal/change` 事件提交。正數 Round 只從已准入的繼續執行 `user/message` 推進；goal 持久化不使用注入或 inbox 狀態。

**`send` 不返回標識。** 呼叫方已經持有完整訊息及其不透明的 `MessageId`；訊息的建立與凍結由[帶標識的不可變訊息值決策](2026-07-28-identified-immutable-message-values.md)負責，而不是由路由負責。

**Inbox 變更只有一份持久投影和三種最小即時通知。** 每次 append、prepend、編輯、刪除、取消與領取都會記錄規範化的 `agent/inbox/spliced` 坐標。插入會發出 `agent/inbox/inserted { message }`；普通刪除攜帶持久 `outcome: 'canceled'`，並行出 `agent/inbox/discarded { message }`；迴圈的原子 `claim()` 會記錄純刪除 splice，隨後寄出 `agent/inbox/claimed { message, turn }`。`MessageId` 是唯一的單次出現標識，並在兩個待處理清單間保持唯一。即時載荷刻意不攜帶 placement、outcome 或批次封套，因為這些事實由持久 splice 持有。

**pre-step 會領取 next-step 輸入，但不會為它單獨建立輪次。** steering（中途引導）和注入始終進入同一個 next-step inbox；steering 會喚醒驅動器，注入則不會。在輪次邊界，驅動器會原子領取待處理的 next-step 輸入，再領取一條排隊提示詞；在步驟之間則只領取 next-step 輸入。領取會記錄純刪除 splice，並針對每則訊息寄出一次 `agent/inbox/claimed { message, turn }`。隨後 `agent/pre-step` 會拒絕擬議步驟，或返回進入步驟的完整批次。拒絕與監聽器失敗都會讓已領取批次保持已刪除；領取後纔到達的輸入會等待後續邊界。

**一條已接受訊息只保留一種表示。** 持久的使用者角色輸入和附加的模型可見上下文都直接使用帶標識且凍結的 `UserMessage`。迴圈把該值與私有路由狀態存放在一起，不會將其標識、內容或來源複製到另一種公開形狀中。steering、注入和工具產生的上下文都會在 next-step inbox 中保留各自帶標識的訊息。[帶標識的不可變訊息值決策](2026-07-28-identified-immutable-message-values.md)取代了本記錄此前的 `UserMessageData`/`AgentMessage` 層級，並將這一表示擴充到 assistant 訊息和工具結果訊息。

**空閒喚醒在插入之後發生。** 會喚醒的傳送會先插入輸入，再於返回前進入 running 驅動器。首次 pre-step 可能立即領取該輸入；因此，後續同步傳送會加入正在執行的迴圈，並等待更晚的邊界。自喚醒開始，取消就歸屬於 running 輪次訊號，中間不會插入獨立的預執行 phase。

**cancel 新增 keepInbox。** `cancel(cause, { keepInbox? })`；呼叫方顯式選擇 cause，且 `keepInbox: true` 會中止活躍輪次，同時保留排隊項和 steering 項（不寄出 discard 事件，尚未啟動的工作也不會被丟棄）。

## 考慮過的替代方案

- **為注入內容設立專門的 `MessageSource` 類別 `context`。** 不予採納，因為 `plugin` 已經表示「不是人類」，因此第四種類別會增加一條平行的軸，讓授權檢查不得不去學習它。由外掛程式產生的注入上下文會顯式提供其外掛程式來源。
- **在 `UserMessage` 上設一個類型化的判別欄位**（例如 `origin: 'prompt' | 'context'`）來取代事件類型的區分。不予採納，轉而採用 `source`——每個消費端都已經攜帶它，goal 系統也已經以它為鍵；第二個判別欄位會重複這一事實。
- **在 inbox 事件之外保留 `agent/queued`。** 作為映像檔而被否決：`agent/inbox/inserted` 已經是即時插入訊號，claimed/discarded 通知描述退出，而持久 splice 保留 placement。
- **根據 agent 狀態推導 inbox 放置方式。** 不予採納，因為 `running` 同時涵蓋 pre-step 處理與結帳。生產方已經把精確目標寫入持久 splice。

## 後果

投遞介面現在是一個原語加三個自解釋的預設，（`target` × `wakeup`）矩陣把此前無法表達的組合顯式化。同一個帶標識訊息值同時服務提示詞、注入的上下文和 Goal Round，因此每一處「是否人類提示詞？」檢查都簡化為一次 `source` 判斷。`Agent` 約定仍是介面，因此其他實作和對象字面量形式的測試替身只需實作同一個最小結構介面。正數 Goal Round 從已准入的 `user/message` 事件摺疊，而 goal 生命週期狀態位於投遞介面之外。空閒注入會保持待處理，不打開輪次也不執行模型；後續會喚醒的投遞在 pre-step 將其放入進入步驟的批次時，它才成為 `user/message`。

`wakeup` 是「模型是否應當執行」的訊號，因此 inbox 會區分能喚醒的排隊工作與任何可領取的項：一個孤立的 `next-turn`/no-wakeup 佇列項會停泊在空閒狀態，並隨下一次喚醒 send 一同帶出，而 `whenIdle`/`cancel` 依據喚醒訊號來結帳完全靜止。每次插入與退出都會發布對應的即時通知，特定於領域的持久事實則透過類型化訊息 source 傳遞，而非透過平行的元資料通道。直接使用待處理訊息的表示方式，使持久 splice 與即時事件保持可關聯，既無需維護第二個 steering 包裝層，也避免資料發生分歧。後續的[已領取 pre-step inbox 生命週期](2026-07-31-claimed-pre-step-inbox-lifecycle.md)決策保留透過 `MessageId` 尋址的即時佇列變更，並把單訊息生命週期通知與持久的整體佇列 splice 投影分離。

## 相關

- [one-send-one-turn](../simplification/2026-07-17-one-send-one-turn.md)——本決策所依託的「每輪次只認領一則訊息」規則。
- [remove-agent-steering-mirror](../../archived/simplification/2026-07-04-remove-agent-steering-mirror.md)——摺疊映像檔即時事件的先例。
- [explicit-turn-cancellation](2026-07-16-explicit-turn-cancellation.md)——`keepInbox` 所擴充的取消原因訊號。
- [帶標識的不可變訊息值](2026-07-28-identified-immutable-message-values.md)——本路由決策現在所依託的訊息標識與表示約定。
