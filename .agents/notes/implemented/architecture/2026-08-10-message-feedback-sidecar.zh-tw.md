# Agent Note: 綁定生命週期的訊息回饋伴隨記錄

Status: implemented

[English](2026-08-10-message-feedback-sidecar.md) | [简体中文](2026-08-10-message-feedback-sidecar.zh.md) | 繁體中文

## 問題

現有 `/feedback` 命令記錄不可變的 Session 級 `feedback/record` 事件。在 `FEEDBACK_ONLY` 下，該事件可以釋放待處理的遙測前綴，因此它不適合作為掛在單條 assistant 訊息上的可編輯好評／差評與選填備注的權威來源。訊息回饋需要獨立的更新與刪除語義，且不得進入權威 Session 日誌、改變投影、到達模型上下文，或隱式表示遙測同意。

只按 `SessionId` 建索引的伴隨記錄可能在該 id 以不同 header 身份重建後，繼續存活於其所描述的日誌生命週期之外。Session 級 revision 還會讓無關訊息的編輯彼此衝突，而普通 storage-domain 讀／寫不提供跨行程 compare-and-swap。Session disposal 只是從 live store 脫離，並非持久刪除；當前 Session 持久化 seam 也沒有可擁有真實級聯的刪除操作。

## 決策

`@deepseek-ai/dsh-message-feedback` 擁有 `ctx.messageFeedback` 服務，並把訊息回饋存為每個 Session 一條 storage-domain 伴隨記錄（sidecar）。該伴隨記錄既不是 Session 日誌內容，也不是 Session 投影。它不寄出 `feedback/record` 事件，也不執行遙測交接；command-feedback 與 message-feedback 約定保持獨立。

每條可用記錄都綁定到經檢查的 Session header 身份 `{createdAt, cwd}`，而不只是其 `SessionId`。生命週期不匹配按不存在處理：`list` 返回空條目，`put` 可以用綁定當前身份的新記錄替換過時行。因此，以不同 header 身份複用的 id 不會繼承過時回饋。fork 擁有自己的 Session 身份，且不複製伴隨記錄：即使 fork 種子包含相同的 assistant 訊息，回饋仍只屬於人類記錄它的那個 Session。

`put` 只接受由 `SessionPersistence.inspect()` 觀測到的非空、append-origin `assistant/message`，且其 `MessageId` 必須與目標相同。replacement-origin 訊息、僅承載 usage 的空 assistant 記錄以及非 assistant 目標都會被拒絕。檢查使用 cold-safe 權威路徑：它不會僅為驗證回饋而發布或復原 Agent，也不會提交 cold 日誌修復。cold 路徑由 `listSnapshots()` 預檢明確不存在；已進入目錄的 Session 若檢查失敗，仍按基礎設施故障處理。因此，請求若恰落在 live detach 到 header materialization 的極短視窗，可能返回 `session-not-found`，呼叫方在 retirement materialization 後重試。

`put` 提交伴隨記錄前，會先讓目標日誌透過 durability barrier。身份匹配的 live Session 經過權威 `ctx.sessions.flush` checkpoint，隨後 live 與 cold 路徑都會透過 `SessionPersistence.readFrom` 從序列零做物理復讀。之後再次校驗所得觀測的 header 身份與目標。缺少 flush 參與方、身份變化、目標消失或物理讀取失敗都會阻止伴隨記錄寫入，因此已提交回饋絕不會先於它引用的持久 assistant 訊息。

每個訊息條目都攜帶自己的 opaque version，以及 Host 分配的 `createdAt` 和 `updatedAt` 時間戳。`put` 只把呼叫方的 `ifVersion` 與目標條目比較，因此編輯一則訊息不會使另一則訊息失效。即使目標值已經相同，比較仍然嚴格執行，從而防止過時請求穿過 ABA 值迴圈；衝突會返回權威當前條目，呼叫方無需二次讀取即可協調。攜帶匹配 version 的無變化請求會保留 version 與時間戳；實質更新保留 `createdAt`、替換 version，並保證 `updatedAt` 不倒退。刪除已經不存在的條目也同樣成功。version 是隻能做相等比較的 token，不是呼叫方可以排序或自行合成的計數器。

按 Session 劃分的變更佇列覆蓋生命週期檢查、伴隨記錄讀取、衝突判斷與整行寫入。這使同一個服務實例的變更序列化，並在單個 Host 行程內保持逐訊息 compare-and-swap 約定。Plugin disposal 會關閉接納、排空已進入佇列的工作，然後關閉 storage domain。底層 storage-domain API 不提供跨行程條件寫，因此實作不承諾跨行程線性一致性或防止丟失更新。

`maxNoteBytes` 是必填的部署選擇，用於限制選填備注的 UTF-8 位元組長度；Web Host bundle 將其顯式設為 `8192`。該包透過 `TypertRemoteService` 與 `@Remote` 直接發布 Host `messageFeedback.list`、`messageFeedback.put` 與 `messageFeedback.delete` 約定。用戶端 Remote 聚合掛載與 UI 由各自邊界負責並保持延後；後續適配層只是該 Host 約定的薄消費者。

服務不偽造刪除級聯。`session/disposed` 與 `host/session-removed` 表示脫離 live ownership，而非持久刪除，Session persistence 當前也沒有刪除介面。因此在帶外移除日誌後，伴隨記錄可能繼續存在；不同的 `{createdAt, cwd}` 可阻止此類殘留記錄變成後來複用該 id 的 Session 回饋。

## 考慮過的替代方案

**把編輯追加到 Session 日誌並派生投影。** 不予採納，因為可編輯 UI 元資料會變成權威且鄰近對話的歷史，fork 會重播並繼承它，刪除需要 tombstone，而複用 `feedback/record` 會把訊息評分與遙測同意靜默耦合。

**按全域性 `MessageId` 建索引、在 fork 時複製，或使用一個 Session revision。** 不予採納，因為訊息 id 僅在某個 Session 生命週期內有意義，fork 後的對話需要獨立的人類判斷，而且無關訊息的變更不應製造虛假衝突。

**在本次變更中為 `KvTable` 擴充跨行程 compare-and-swap。** 不予採納，因為現有 storage-domain 後端沒有共同的條件寫原語。行程內佇列符合受支持的單 Host 拓撲；真實的多行程保證需要後端級原子約定，屬於獨立工作。

**在 Session disposal 時刪除回饋。** 不予採納，因為 disposal 包含普通 detach 與 rollback 路徑。把它當成持久刪除會在 Session 日誌仍存在時丟失回饋；清理必須等待真正的 Session 刪除權威。

## 後果

訊息回饋在本機持久化並可獨立編輯，且不改變模型可見歷史或遙測行為。同一 Host 中的並行呼叫方獲得逐訊息衝突偵測與可安全重試的結果；多個寫入者共享同一儲存根目錄的部署仍不受支持。不同的 header 身份會讓過時記錄被視為不存在，但不會將其回收；本約定無法區分保留相同 `{createdAt, cwd}` 的克隆日誌。Host Remote 約定現在可用；用戶端組裝與 UI 可以保持為薄消費者，而不接管持久化或並行語義。
