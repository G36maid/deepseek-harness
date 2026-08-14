# Agent Note: 在單一 pre-step 決策前領取 inbox 輸入

Status: implemented

[English](2026-07-31-claimed-pre-step-inbox-lifecycle.md) | [简体中文](2026-07-31-claimed-pre-step-inbox-lifecycle.zh.md) | 繁體中文

## 問題

迴圈此前把一個步驟邊界拆成提示詞準備、提示詞准入與序列步驟掛鉤。准入結果可以保留或丟棄已領取輸入，即時佇列事件還攜帶了與持久 inbox 狀態重複的資料結構。外掛程式不得不在修改 inbox、改寫已提交批次與直接追加工作階段歷史之間選擇，而觀察方無法相依性一套明確順序。

單次出現專屬的 inbox 包裝層也重複了每個 `UserMessage` 已有的標識。它把插入、編輯、領取、取消、重連投影與步驟進入合併成一套協議，但僅附加工作階段本就擁有持久佇列投影。

## 決策

每個擬議步驟之前，`Inbox.claim(target)` 會原子移除完整批次：全部 `next-step` 訊息，以及輪次邊界上的一條 `next-turn` 訊息。在首次邊界，迴圈會先提交 `turn/start`，使領取及其唯一一次 `agent/pre-step` 決策擁有持久輪次歸屬。領取會記錄規範化、不帶 outcome 的純刪除 `agent/inbox/spliced`。隨後，迴圈針對每條已領取消息寄出一次 `agent/inbox/claimed { message, turn }`，並用該獨佔批次與 `{ turn, step, signal }` 等待 waterfall（瀑布式事件）。

`PreStepDecision` 為 `{ kind: 'reject' } | { kind: 'enter'; messages: UserMessage[] }`。reject 不會打開步驟，會讓已領取批次保持已刪除，並將輪次關閉為 blocked，且不產生任何步驟事件。空的 enter、取消以及 `step/start` 前的失敗同樣會關閉一個邊界平衡的無步驟輪次。enter 提供在 `step/start` 後以 `user/message` 追加的完整批次。包裝 `next()` 的監聽器會保留下游變更，除非有意替換，因此全部訊息改寫只在最終回傳值中一次性結帳。系統不再存在 `agent/prompt-prepare`、`agent/prompt-submit` 或 `agent/step` 擴充點。

持久 inbox 仍是兩份透過 `MessageId` 尋址的 `UserMessage[]` 清單。`append`、`prepend` 與 `splice` 接受 target；`replace(messageId, newMessage)` 與 `remove(messageId)` 則在提交規範化 splice 前，透過 `MessageId` 跨兩份清單定位待處理訊息。替換可以改變標識，並先將舊訊息作為 discarded 發布，再將新訊息作為 inserted 發布。每次插入寄出 `agent/inbox/inserted { message }`；普通刪除記錄 `outcome: 'canceled'` 並行出 `agent/inbox/discarded { message }`。領取是迴圈在 inbox 上的內部步驟邊界操作，記錄不帶通知或 outcome 的純刪除，因此迴圈可以自行發布 claimed 事件。這些即時事件不增加 placement、outcome 或批次欄位。

兩類事件介面服務不同消費端。跟蹤單則訊息的觀察方使用 `agent/inbox/inserted`、`claimed` 與 `discarded`。包括 Web 佇列投影和重連基線在內的整體佇列消費端使用持久 `agent/inbox/spliced` 流；UI 編輯與移除透過 `Inbox.splice()` 或其他 Inbox 變更方法處理，從而讓同一投影記錄所有變化。

必須對當前步驟進行原子改寫的外掛程式從 `agent/pre-step` 返回訊息。只需要稍後上下文的外掛程式可以直接修改 `agent.inbox`。Workspace context 同時使用兩條路徑：非同步檔案系統投影會暫存一條可替換的 `next-step` 訊息，而下一次進入步驟的 pre-step 會把該訊息或新組合的基線折入最終批次，並移除仍待處理的副本。reject 會讓該條目繼續排隊。

已歸檔的[可尋址佇列項決策](../../archived/feature/2026-07-29-addressable-queue-operations.md)描述了已被取代的單次出現包裝層設計。現在由 `MessageId` 負責尋址，而保留的 Host 佇列映像檔根據持久 splice 投影派生快照。

## 曾考慮的替代方案

**保留分離的 prepare 與 admit 掛鉤。** 這樣準備階段可以在領取前修改 inbox，准入階段可以在領取後改寫，但同一邊界會出現兩個順序表面，取消歸屬也會變得模糊。

**reject 時把已領取批次重新入隊。** 這看似保留重試行為，卻會讓否決隱式修改佇列；若不為每個競態加圍欄，還會複製後續工作，並使 claim 無法成為原子所有權轉移。

**在每個即時事件上攜帶 placement 與 outcome。** 持久 splice 已經擁有這些事實。即時通知重複它們會建立可能漂移的第二份約定，而持有確切訊息標識的消費端並不需要這些欄位。

## 驗證

agent loop（代理循環）覆蓋固定先 `turn/start`、再領取、後 pre-step 的順序、即時事件的確切載荷、邊界平衡的無步驟 reject、最終批次改寫、領取後插入的輸入、監聽器失敗與取消。Inbox 和消費端測試固定純領取刪除、普通刪除的 canceled 結果、agent-instructions 的暫存、替換與同一步驟進入、plan/goal/掛鉤行為、UI 清理、壓縮（compaction）、檢查點以及復原後的持久投影。生成的事件與類型目錄只公開新的 waterfall 與載荷。

## 後果

迴圈在每個步驟前只有一個需等待的決策，對輸入也只有一次所有權轉移。已領取消息不會隱式返回 inbox；後續插入保持獨立。即時事件與其他 inbox 通知保持對稱，但不映像檔持久元資料；外掛程式可以顯式選擇精確的當前步驟改寫，或普通的後續 inbox 投遞。
