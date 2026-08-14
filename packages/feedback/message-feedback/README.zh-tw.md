# @deepseek-ai/dsh-message-feedback

[English](README.md) | 繁體中文

本包提供由 Host 擁有、針對單條已完成 assistant 訊息的可編輯回饋。它註冊 `ctx.messageFeedback`，在 storage-domain 中為每個 Session 持久化一條綁定生命週期的伴隨記錄（sidecar），並行布 Host `messageFeedback.list`、`messageFeedback.put` 與 `messageFeedback.delete` 一元 Remote 契約。它與不可變的 Session 級 `feedback/record` 事件相互獨立，不執行遙測交接。[訊息回饋伴隨記錄 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-10-message-feedback-sidecar.md)擁有其設計邊界。

公開的請求、值、版本與失敗類型從包根入口及 `@deepseek-ai/dsh-message-feedback/types` 匯出；其原始碼為 [`src/types.ts`](src/types.ts)。

## 設定

| 鍵 | 含義 |
|---|---|
| `maxNoteBytes` | 必填正 safe integer：一條選填備注的最大 UTF-8 位元組長度。 |

備注必須包含至少一個非空白字元，但透過校驗的文字按原樣儲存，不會 trim。省略 `note` 表示目標值不含備注，因此 version 匹配的實質 `put` 會清除已有備注。備注校驗早於 Session 尋找，因此即使 Session 不存在，也可能在不訪問持久化的情況下返回 `note-blank` 或 `note-too-large`。

```yaml
- id: message-feedback
  name: '@deepseek-ai/dsh-message-feedback'
  config:
    maxNoteBytes: 8192
```

服務注入 `storageDomain`、`sessionPersistence` 與 `sessions`。其持久儲存域為 `message_feedback`，其中 `sessions` 表按 `SessionId` 每個一行。

## 資料、生命週期與持久性

`MessageFeedbackItem` 包含 `messageId`、`rating: 'positive' | 'negative'`、選填 `note`、只能做相等比較的 opaque `version`，以及由 Host 分配、以 Unix 毫秒錶示的 `createdAt`/`updatedAt` 時間戳。實質更新保留 `createdAt`、替換 `version`，並保證 `updatedAt` 不倒退。`list` 按首次建立順序返回新的不可變快照；更新條目時保留其位置，刪除後再建立則追加為新條目。

每條儲存行都攜帶檢查所得 Session header 身份 `{createdAt, cwd}`。不匹配按不存在處理：`list` 返回空 `items` 陣列，`delete` 返回已不存在的後置條件，`put` 可以用綁定當前身份的新行替換過時行。這會在複用的 `SessionId` 具有不同 header 身份時形成隔離。fork 使用獨立的 Session 身份，不複製回饋伴隨記錄。

`SessionPersistence.inspect()` 提供 cold-safe 觀測，不發布或復原 Agent，也不提交 cold repair。對於沒有 live owner 的 Session，系統先用 `listSnapshots()` 判定明確不存在；已進入目錄的 Session 若 `inspect()` 失敗，仍屬於基礎設施故障，不會被猜測成 `session-not-found`。`put` 只接受具有指定 `MessageId` 的非空、append-origin `assistant/message`；replacement-origin 訊息、僅承載 usage 的空 assistant 記錄與非 assistant 記錄都返回 `target-not-found`。

初步校驗後，`put` 在寫入伴隨記錄前建立 durability barrier。身份匹配的 live Session 先透過權威 `ctx.sessions.flush` checkpoint 提交，隨後 live 與 cold 路徑都會透過 `SessionPersistence.readFrom` 從序列零做物理復讀。之後再次校驗所得觀測的 header 身份與目標。缺少 flush 參與方、身份變化、目標消失或物理讀取失敗都會阻止伴隨記錄提交，因此持久回饋絕不會先於其持久目標訊息。

message feedback 不是 Session 日誌內容或 Session 投影。它不寄出 `feedback/record` 事件，不進入模型歷史，也不觸發 `FEEDBACK_ONLY` 遙測釋放。

## 服務與 Host Remote 契約

`TypertRemoteService` 與 `@Remote` 將 `MessageFeedbackService` 的同三個方法發布出去；Host endpoint 名稱為 `messageFeedback.list`、`messageFeedback.put` 與 `messageFeedback.delete`。每個方法都返回判別式業務 union：`{ ok: true, value }` 或 `{ ok: false, error }`。儲存、損壞或缺少 durability listener 等操作故障會產生 reject，不會被誤標為業務錯誤。

| 方法 | 請求 | 成功 `value` | 拒絕的 `error.code` |
|---|---|---|---|
| `list` | `MessageFeedbackListRequest { sessionId }` | `MessageFeedbackListValue { items }` | `session-not-found` |
| `put` | `MessageFeedbackPutRequest { sessionId, messageId, rating, note?, ifVersion }` | 已提交的 `MessageFeedbackItem` | `session-not-found`、`target-not-found`、`version-conflict`、`note-blank`、`note-too-large` |
| `delete` | `MessageFeedbackDeleteRequest { sessionId, messageId, ifVersion }` | `MessageFeedbackDeleteValue { absent: true }` | `session-not-found`、`version-conflict` |

`MessageFeedbackVersionConflict` 返回權威 `current` 條目；條目不存在時為 `null`。呼叫方無需額外執行 `list`，即可協調當前 rating、note 與 version。`MessageFeedbackNoteTooLarge` 同時返回 `maxBytes` 與 `actualBytes`。用戶端 Remote 聚合尚未掛載生成的用戶端 contribution；Host 呼叫方無需該用戶端組裝即可使用 service/Remote 契約。

## Compare-and-set 與冪等性

`ifVersion: null` 表示僅當條目不存在時才建立；已有條目的每次請求都必須與其當前 version 完全一致，即使目標值已經相同、不會產生實質更新。檢查按訊息而非按 Session 進行，因此修改一個條目不會與另一個條目衝突。每次實質建立或更新都會分配新的 opaque UUID token，防止過時寫入穿過 ABA 值迴圈。

攜帶匹配 version 的無變化請求會返回已存條目，version 與時間戳均不變。成功回應丟失後，使用舊 token 重試會得到 `version-conflict.current`；呼叫方無需額外讀取，即可把權威當前值與目標值比較。條目已不存在時，`delete` 忽略 `ifVersion`；成功後始終返回穩定的 `{ absent: true }` 後置條件。

按 Session 劃分的 promise 佇列覆蓋檢查、持久性校驗、伴隨記錄讀取、比較與整行寫入。這些語義會序列化經由同一服務實例的並行變更；storage-domain 自身沒有跨行程條件寫。

Plugin disposal 會先關閉變更接納，排空已進入各個 Session 佇列的所有操作，然後才關閉 storage domain。disposal 開始後提交的變更會以生命週期故障拒絕，不會進入正在關閉的 domain。

## 模型體驗

### 本機訊息回饋狀態

#### 模型看到的內容

無。`ctx.messageFeedback` 不註冊工具、提示詞段落、模型可見上下文或 Session 事件；除非另一個具有獨立文件的 Consumer 顯式公開回饋，否則它只留在 Host 擁有的伴隨記錄中。

#### Token 影響

為零。本包的請求、結果、評分、備注、時間戳或失敗都不會進入模型請求。

#### KV Cache 影響

相互獨立。讀取或變更訊息回饋不會觸碰模型請求前綴，也不會使本可複用的提供方快取條目失效。

## 已知侷限與延後工作

- **缺少用戶端聚合與 UI**——Host Remote 契約已經發布，但用戶端 Remote 聚合 contribution 與任何 UI 消費端由各自邊界負責並保持延後。
- **Compare-and-set 僅限單行程**——按 Session 劃分的佇列只序列化一個服務實例；storage-domain 不提供跨行程條件寫，因此多個 Host 行程寫入同一儲存根目錄時仍可能丟失更新。
- **沒有持久 Session 刪除級聯**——Session persistence 沒有刪除介面，且 `session/disposed`/`host/session-removed` 表示 detach 而非持久刪除。因此服務會保留空行，並可能在帶外移除日誌後留下殘留行，而不會在 detach 時刪除仍有效的回饋。
- **Detach/catalog retirement 視窗**——請求若恰好落在 live detach 之後、persistence catalog 物化 header 之前的極短視窗，可能收到 `session-not-found`；呼叫方應在 retirement materialization 後重試。
- **Header 身份不是內容指紋**——只有 `{createdAt, cwd}` 不同時才能識別複用；本契約無法區分保留相同 header 身份的克隆日誌。
- **呼叫方邊界受信任**——`list`/`put`/`delete` 不攜帶已認證的 actor 或審計身份。在加入授權與歸屬資訊前，部署方必須只透過受信任或另行認證的邊界暴露 Host gateway。
- **目錄與行邊界**——由於 persistence 沒有按 id 讀取元資料的操作，cold 請求會掃描完整的 Session snapshot 目錄。`maxNoteBytes` 只限制單條備注，單個 Session 行的條目數和聚合保留位元組尚無上限；按索引讀取元資料和由部署決定的行邊界，延後到具體消費端明確策略時處理。
