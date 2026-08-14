# Agent Note：訊息回饋的 Web 介面

Status: implemented

[English](2026-08-11-message-feedback-web-surface.md) | [简体中文](2026-08-11-message-feedback-web-surface.zh.md) | 繁體中文

## 問題

[PR #2217](https://github.com/deepseek-harness/deepseek-harness/pull/2217) 交付了持久化的訊息回饋 sidecar 及其三個 Host Remote 方法，但它明確只做後端：沒有任何用戶端包消費 `messageFeedback.list`、`put` 或 `delete`，因此 Web GUI 無法記錄評價。它的 Agent Note 把「用戶端 Remote aggregate 掛載與 UI」留給了另一個負責人。Issue #1326 要求的正是 Web 介面，卻在該後端合併時被關閉，而使用者可見的那一半並不存在。

更早的全端嘗試 [PR #1010](https://github.com/deepseek-harness/deepseek-harness/pull/1010) 帶有 UI 層，但它基於自己的後端、形狀不同：整個 Session 一個 `revision` 做 compare-and-swap，RPC 名為 `feedback.upsert`。#2217 最終交付的是逐條 `ifVersion` 與 `messageFeedback.put`，因此 #1010 的 controller 邏輯不再匹配契約；它的分支在結構上也已漂移（改動了 `packages/cordis/`，該目錄已重新命名為 `packages/extensions/`；新增的頂層 `packages/session-feedback/` 與整合後的 `packages/feedback/` 衝突）。它作為 superseded 關閉，而不是 rebase。

任何 UI 的阻塞缺口在於瀏覽器無法指名一個回饋目標。Host 只接受以 `MessageId` 尋址的 append 來源 `assistant/message`，但 `AssistantMessageNode`——用戶端表示已完成 assistant 輸出的節點——只攜帶 `seq`、`turn`、`step`，沒有訊息身份。只有 `SteeringMessageNode` 有 `messageId`。

## 決策

三個接縫，各自歸屬於其權威已經所在的位置。

**用戶端節點中的訊息身份。** `AssistantMessageNode` 增加選填的 `messageId`，在該節點由已完成的 `assistant/message` 物化時從 `event.data.message.id` 複製。它在被中斷凍結的部分輸出上保持缺失——那些從未完成、不指向任何持久訊息——在 trajectory 版面配置為未完成部分輸出構造的合成哨兵上同樣缺失。該欄位之所以選填，正是為了讓這兩種情況無法被表示為回饋目標，而不是用佔位值掩蓋過去。`ui-conversation` 與 `ui-trajectory` 各自物化自己的該節點副本，因此兩條「已完成」分支都做了更新；「被中斷」分支被有意保留原樣。這與 Host 自身的目標規則一致——它按 `isAppendSurfaceEvent` 過濾——因此用戶端與 Host 在「什麼是可尋址的」上取得一致，而不需要共享程式碼。

**聲明式槽位而非直接相依性。** `ui-conversation` 聲明 `conversation.chat.assistant-actions`（list 類型、session 作用域、owner 為 `{messageId}`），並把它授權為 `turn-tail` 節點渲染器的第二個子項，與既有的 `conversation.chat.turnTail` 鏈並列。`TurnTailNodeView` 渲染它，並透過新的 `extraActions` prop 把結果傳入 `MessageIconActions`，位置在複製與分支之間。當 `messageId` 缺失時渲染點整體跳過該槽位，因此被中斷的 Turn 不顯示任何控制元件。回饋包因此只貢獻一個 entry，從不引入 conversation 的實作；當該外掛程式從 `cordis.yml` 組裝中移除時，這條操作欄以零成本渲染為空。

`extraActions` 是一個 `ReactNode` prop 而不是第二個 render-slot 洞，因為 `MessageIconActions` 是使用者訊息與 assistant 訊息共享的外殼：由 assistant 一側解析槽位並把結果向下傳遞，使用者路徑則對這個它永遠不該渲染的槽位保持無感。

**per-session controller 中的逐條 CAS。** `@deepseek-ai/dsh-client-ui-message-feedback` 為每個 Session 持有一個 `MessageFeedbackController`，以 `MessageId` 為鍵存入 map。一次 `list` 為該 Session 轉錄中的所有控制元件播種。每次 mutation 傳送該 controller 最後觀察到的版本作為 `ifVersion`——當它不知道任何條目時為 `null`，這正是 Host 的「必須不存在」前置條件。

衝突路徑是與 #1010 分歧最大的地方。`MessageFeedbackVersionConflict` 攜帶權威的 `current` 條目（或 `null`），因此競爭失敗方直接從回覆本身收斂；#1010 對每次衝突都以一次盲目的全量刷新作答。報告 `current: null` 的衝突會刪除本機條目，這就是在另一個分頁標籤中被移除的評價在此處消失的方式。mutation 在 per-Session 的尾部序列化，因此排隊中的操作總是與已提交的版本比較，而不是與點擊落下那一刻讀到的版本比較。

list 讀取被推遲到首次 hover 或 focus，而不是在 mount 時觸發，因為控制元件會為可見歷史中每條已結帳訊息各 mount 一次；在 mount 時做全轉錄讀取會導致每則訊息欄各發一個請求。`connection/reset` 只刷新狀態不再是 `cold` 的 Session，因此重連不會預熱沒人看過的 Session。

切換語義讓兩個動詞保持誠實：再次點擊已記錄的評價呼叫 `delete`，切換到另一側呼叫 `put` 並攜帶已有備注，而對沒有已知條目的訊息執行清除會直接返回成功且不發起呼叫，因為它已處於被請求的狀態。

**Remote 掛載。** `@deepseek-ai/dsh-api-remotes` 現在把 `messageFeedbackRemote` 與 `goalsRemote` 並列掛載，並以相反順序組合兩個 disposer。生成的 `./remote` 產物在 #2217 的包匯出中已存在，因此不需要 codegen 改動；用戶端呼叫 `ctx.remote.messageFeedback`，從不接觸傳輸層。業務結果以普通的 tagged union 穿過該邊界——gateway 只在傳輸失敗時拋出——因此 controller 對 `ok` 做模式匹配，並把拋出翻譯為控制元件已經在渲染的同一種結帳結果形狀。

## 考慮過的替代方案

**複用 `conversation.chat.turnTail` 而不新增槽位。** 否決：`turnTail` 是以 Turn 為鍵的鏈，攜帶 `TurnTailOwnerProps {turn, seq, openFile}`，尋址的是 Turn 邊界而非訊息身份。回饋需要 `MessageId`，而鏈是選擇器路由的一次一個，操作欄則確實是一組互相獨立的貢獻者的清單。

**把 `messageId` 放到 chat 節點的 `id` 欄位上。** 否決：該 id 是 `"${turn}:${step}"`，且承載著 keyed dispatch 與穩定 React key 的作用。重載它會把節點身份與模型輸出身份耦合起來，而且一旦存在 replacement 來源的事件，訊息 id 本身在每個節點上也並非唯一。

**保留 #1010 的 session 級 revision。** 不可行：已合併的 Host 契約是逐條 `ifVersion`。即便作為用戶端側的簡化也更糟——單一 Session revision 會讓互不相關的逐條編輯相互衝突，而這正是 #2217 的 Agent Note 記錄的採用逐條版本的原因。

**Rebase #1010。** 經檢查後否決：102 個文件、`mergeable: false`、一個被 #2217 以不同名稱取代的重複後端與 RPC 層，以及此後的兩次目錄重新命名。只有其約 1400 行的 UI 層有殘餘價值，而該層呼叫的 `feedback.upsert` 及其 revision 已不復存在。基於已合併的契約重寫 UI 比調和該分支更省力，#1010 的關閉評論記錄了這一理由。

## 結果

Web GUI 可以記錄逐則訊息的評價與備注。#1326 中使用者可見的那一半現在存在了；該 Issue 之所以被重開，是因為後端合併在沒有任何入口存在的情況下關閉了它。

`AssistantMessageNode.messageId` 是選填的，因此所有既有讀取方無需改動即可編譯，但任何將來的消費端都必須處理缺失，而不能假定訊息已完成。兩個平行的物化點仍是重複隱患：第三個構造該節點的檢視表必須記得複製該 id，而沒有任何機制強制這一點。今天只有 chat 檢視表渲染控制元件，儘管 trajectory 與 waterfall 節點現在攜帶同一個 id。

回饋對模型保持不可見——該 sidecar 既不進入 Session 日誌、也不進入模型上下文與 telemetry——因此該包的 Model Experience 是一條經審計的 `none` 條目，而不是結構化區塊。

該 sidecar 不發布即時幀，因此第二個分頁標籤的評價會在重連時或下一次衝突回覆時才浮現，而不是立即。備注編輯器不預先校驗 `maxNoteBytes`（Web bundle 中為 8192），因此過大的備注會在保存時以 `note-too-large` 失敗，而不是在輸入過程中。

24 個既有 Web UI 快照在 27 條 assistant 訊息上獲得了這兩個評價按鈕，確認這條操作欄在已發布的組裝中觸達每條已結帳的 assistant 訊息，而不僅是被測試的那個 fixture。

一個專門的 Web E2E 針對已發布 bundle 覆蓋評分、備注、重載復原與撤回。它必須在重載後先 hover 未評分的控制元件，再斷言復原後的狀態，因為正是那次延遲的 list 讀取讓 sidecar 的值出現——該測試記錄了這一順序，而不是繞開它。把 controller 的 list 復原邏輯破壞掉會讓該規格失敗，因此這條持久性斷言是有效的。
