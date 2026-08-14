# 訊息回饋

[English](feedback.md) | [简体中文](feedback.zh.md) | 繁體中文

[`@deepseek-ai/dsh-message-feedback`](../../packages/feedback/message-feedback)擁有針對單條 assistant 訊息的可編輯回饋。它刻意與不可變的 Session 級 `feedback/record` 事件分離：message feedback 是本機 storage-domain 伴隨記錄（sidecar），不是 Session 日誌內容或投影，也不執行遙測交接。

來源：[`packages/feedback/message-feedback/src/types.ts`](../../packages/feedback/message-feedback/src/types.ts)

## 公開類型

```ts type-equiv
/** Opaque compare-and-set token for one exact feedback item revision. */
type MessageFeedbackVersion = Branded<'MessageFeedbackVersion'>
```

```ts type-equiv
/** The human's overall judgment of one assistant message. */
type MessageFeedbackRating = 'positive' | 'negative'
```

```ts type-equiv
/** One current feedback value and its opaque mutation token. */
interface MessageFeedbackItem {
  /** Stable identity of the assistant message inside the owning Session. */
  readonly messageId: MessageId
  /** Overall positive or negative judgment. */
  readonly rating: MessageFeedbackRating
  /** Optional explanation, preserved verbatim after validation. */
  readonly note?: string
  /** Equality-only token replaced by every material create or update. */
  readonly version: MessageFeedbackVersion
  /** Host-assigned creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Host-assigned time of the most recent material update. */
  readonly updatedAt: number
}
```

```ts type-equiv
/** Read all message feedback belonging to one persisted Session lifecycle. */
interface MessageFeedbackListRequest {
  /** Persisted Session whose sidecar should be read. */
  readonly sessionId: SessionId
}
```

```ts type-equiv
/** Current feedback values for one Session, in first-creation order. */
interface MessageFeedbackListValue {
  /** Fresh immutable item snapshots. */
  readonly items: readonly MessageFeedbackItem[]
}
```

```ts type-equiv
/** Create or replace feedback for one assistant message. */
interface MessageFeedbackPutRequest {
  /** Persisted Session that owns the target message. */
  readonly sessionId: SessionId
  /** Target assistant-message identity. */
  readonly messageId: MessageId
  /** Desired overall judgment. */
  readonly rating: MessageFeedbackRating
  /** Optional non-blank explanation. */
  readonly note?: string
  /** Observed item version, or `null` to require that no item exists. */
  readonly ifVersion: MessageFeedbackVersion | null
}
```

```ts type-equiv
/** Delete feedback for one message after observing its current version. */
interface MessageFeedbackDeleteRequest {
  /** Persisted Session that owns the sidecar. */
  readonly sessionId: SessionId
  /** Message whose feedback should be absent after this operation. */
  readonly messageId: MessageId
  /** Observed item version; ignored when the item is already absent. */
  readonly ifVersion: MessageFeedbackVersion
}
```

```ts type-equiv
/** Idempotent deletion acknowledgement. */
interface MessageFeedbackDeleteValue {
  /** Stable postcondition shared by the first deletion and every retry. */
  readonly absent: true
}
```

```ts type-equiv
/** No persisted Session header exists for the requested id. */
interface MessageFeedbackSessionNotFound {
  readonly code: 'session-not-found'
  readonly sessionId: SessionId
}
```

```ts type-equiv
/** The id does not name a derived, append-origin assistant message. */
interface MessageFeedbackTargetNotFound {
  readonly code: 'target-not-found'
  readonly sessionId: SessionId
  readonly messageId: MessageId
}
```

```ts type-equiv
/** A material mutation did not match the addressed item's current version. */
interface MessageFeedbackVersionConflict {
  readonly code: 'version-conflict'
  /** Authoritative current item, or `null` when it does not exist. */
  readonly current: MessageFeedbackItem | null
}
```

```ts type-equiv
/** A supplied note contains no non-whitespace character. */
interface MessageFeedbackNoteBlank {
  readonly code: 'note-blank'
}
```

```ts type-equiv
/** A supplied note exceeds the configured UTF-8 byte limit. */
interface MessageFeedbackNoteTooLarge {
  readonly code: 'note-too-large'
  readonly maxBytes: number
  readonly actualBytes: number
}
```

```ts type-equiv
/** Failures shared by the public message-feedback operations. */
type MessageFeedbackFailure =
  | MessageFeedbackSessionNotFound
  | MessageFeedbackTargetNotFound
  | MessageFeedbackVersionConflict
  | MessageFeedbackNoteBlank
  | MessageFeedbackNoteTooLarge
```

```ts type-equiv
/** Successful public operation result. */
interface MessageFeedbackSuccess<T> {
  readonly ok: true
  readonly value: T
}
```

```ts type-equiv
/** Rejected public operation result with a stable business failure. */
interface MessageFeedbackRejected<E extends MessageFeedbackFailure> {
  readonly ok: false
  readonly error: E
}
```

```ts type-equiv
/** Result returned by the message-feedback `list` operation. */
type MessageFeedbackListResult =
  | MessageFeedbackSuccess<MessageFeedbackListValue>
  | MessageFeedbackRejected<MessageFeedbackSessionNotFound>
```

```ts type-equiv
/** Result returned by the message-feedback `put` operation. */
type MessageFeedbackPutResult =
  | MessageFeedbackSuccess<MessageFeedbackItem>
  | MessageFeedbackRejected<
    | MessageFeedbackSessionNotFound
    | MessageFeedbackTargetNotFound
    | MessageFeedbackVersionConflict
    | MessageFeedbackNoteBlank
    | MessageFeedbackNoteTooLarge
  >
```

```ts type-equiv
/** Result returned by the message-feedback `delete` operation. */
type MessageFeedbackDeleteResult =
  | MessageFeedbackSuccess<MessageFeedbackDeleteValue>
  | MessageFeedbackRejected<MessageFeedbackSessionNotFound | MessageFeedbackVersionConflict>
```

## 資料與並行

每個 Session 的一條伴隨記錄包含 header 身份 `{createdAt, cwd}` 和以 `MessageId` 為鍵的回饋條目。每個條目攜帶好評或差評、選填備注、Host 分配的 `createdAt`/`updatedAt` 時間戳及自己的 opaque version。version 只能用於相等比較，且只與目標訊息比較；呼叫方不能排序或自行合成它。

`put` 採用嚴格樂觀並行：已有條目的每次請求都必須匹配當前 `ifVersion`，即使請求不會改變目標值。衝突會返回權威當前條目（不存在時為 `null`），因此呼叫方無需額外讀取，即可協調丟失回應或並行編輯。刪除已經不存在的條目同樣成功。按 Session 劃分的佇列覆蓋檢查、讀取、衝突判斷與整行寫入，因此這些保證適用於單個 Host 行程中的並行呼叫。

## 目標與生命週期權威

`SessionPersistence.inspect()` 提供目標 Session 的觀測，且不會發布或復原 Agent，也不會提交 cold repair。cold 路徑先由 `listSnapshots()` 預檢明確不存在；已進入目錄的 Session 若檢查失敗，會按基礎設施故障原樣傳播。`put` 只接受具有指定 `MessageId` 的非空、append-origin `assistant/message`；replacement-origin、僅承載 usage 的空記錄和非 assistant 記錄都不是回饋目標。

儲存的 `{createdAt, cwd}` 身份必須與檢查所得 header 匹配。不匹配按不存在處理：`list` 返回空條目，`put` 則可用綁定當前 header 身份的新記錄替換過時行。fork 使用新的 Session 身份，即使種子包含相同訊息，也不獲得伴隨記錄副本。

## 持久化與 Remote 約定

服務透過 `ctx.storageDomain` 在 `message_feedback` 儲存域中保存完整 Session 行。`put` 提交引用目標訊息的伴隨記錄前，身份匹配的 live 目標先經過權威 `ctx.sessions.flush` checkpoint；隨後 live 與 cold 路徑都會透過 `SessionPersistence.readFrom` 從序列零做物理復讀。寫入伴隨記錄前會再次校驗所得觀測，因此目標日誌的持久提交始終先於其伴隨記錄。`maxNoteBytes` 為必填項，按 UTF-8 位元組限制備註文本；Web Host 組合將其設為 `8192`。該包透過 `TypertRemoteService` 與 `@Remote` 發布 Host `messageFeedback.list`、`messageFeedback.put` 和 `messageFeedback.delete` 一元 Remote 約定；下方生成的 Cordis API 是方法級權威。

Plugin disposal 會先關閉變更接納，排空已進入各 Session 佇列的工作，然後才關閉 storage domain。

## Web 介面

[`@deepseek-ai/dsh-client-ui-message-feedback`](../../packages/client/ui-message-feedback) 是瀏覽器側消費端。`@deepseek-ai/dsh-api-remotes` 掛載生成的 `messageFeedback` 貢獻，因此該外掛程式呼叫 `ctx.remote.messageFeedback`，不接觸傳輸層。

控制元件是 `conversation.chat.assistant-actions` list slot 的 `feedback` 條目（order 10），該 slot 由 `ui-conversation` 聲明，並渲染在已定稿助手訊息的 IconActions 行內。為抵達該渲染點需要一處管道改動：`AssistantMessageNode` 現在攜帶來自 `assistant/message` 事件的選填 `messageId`。被中斷凍結的部分輸出沒有該欄位，渲染點在欄位缺失時跳過該 slot。該操作欄每個 Turn 渲染一次，位於收尾的助手訊息上：Host 接受每條 append-origin 步驟訊息作為目標，但多步驟 Turn 中較早的步驟渲染的是工具行而非可評分正文，因此 UI 暴露的範圍比 Host 約定允許的更窄。

每個 Session 一個 `MessageFeedbackController`，支撐該 Session 內所有訊息的控制元件：一次 `list` 讀取即填充整段對話，且延遲到首次 hover 或 focus 才發起，而非掛載時觸發。每次變更把該 controller 最後觀察到的版本作為 `ifVersion` 傳送；`version-conflict` 回應攜帶權威條目，controller 據此對帳而不重新拉取。變更按 Session 序列，排隊操作與已提交版本比較。`connection/reset` 只刷新已讀取過的 Session。

## 邊界與限制

- 變更佇列僅在行程內生效。storage-domain 沒有跨行程條件寫，因此多個 Host 寫入同一儲存根目錄時，不提供 compare-and-swap 或防止丟失更新的保證。
- Session persistence 沒有持久刪除介面。服務不把 `session/disposed` 或 `host/session-removed` 當作刪除，因此不偽造級聯；在帶外移除日誌後，孤兒伴隨記錄可能繼續存在。
- 請求若恰好落在 live detach 之後、persistence catalog 物化 header 之前的極短視窗，可能收到 `session-not-found`；呼叫方應在 retirement materialization 後重試。
- 由於 persistence 沒有按 id 讀取元資料的操作，cold 請求會掃描完整的 Session snapshot 目錄。單個 Session 行也沒有條目數或聚合位元組上限；在具體消費端擁有行策略之前，`maxNoteBytes` 只限制每條備注。
- 只有 `{createdAt, cwd}` 不同時，header 身份才能識別複用的 id；本約定無法區分保留相同 header 身份的克隆日誌。
- Host 約定不記錄已認證的 actor 或審計身份，因此假設呼叫方邊界可信。
- Web 控制元件只出現在對話檢視表。trajectory 與 waterfall 檢視表不渲染回饋條目，儘管它們的助手節點攜帶相同的 `messageId`。
- 該 sidecar 不發布即時幀，因此另一個分頁標籤的評分要等到重連或下一次衝突回應纔可見，不會立即出現。
- 備注編輯器不預先校驗 `maxNoteBytes`；超長備注在保存時以 `note-too-large` 失敗，而不是在輸入過程中。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmessagefeedback--messagefeedbackservice"></a>

### `ctx.messageFeedback` — `MessageFeedbackService`

Storage-domain sidecar service. It inspects persisted Session history and never creates or resumes an Agent or Session.

```ts cordis-catalog
/**
 * Read feedback belonging to the current persisted Session lifecycle.
 * A stale row from a reused Session id is invisible.
 * @param request - Session identity to inspect and list.
 * @returns current immutable items or `session-not-found`.
 */
@Remote('list') async list(request: MessageFeedbackListRequest): Promise<MessageFeedbackListResult>

/**
 * Create or replace feedback for one derived append-origin assistant
 * message. Every request must match the addressed item's current version;
 * a matching no-op returns the stored item without changing its revision.
 * @param request - target, desired value, and observed item version.
 * @returns the committed item or an explicit business failure.
 */
@Remote('put') put(request: MessageFeedbackPutRequest): Promise<MessageFeedbackPutResult>

/**
 * Delete one feedback item. Absence is successful regardless of the
 * supplied version; an existing item requires an exact version match.
 * @param request - Session, message, and observed item version.
 * @returns the stable absent postcondition, or an explicit failure.
 */
@Remote('delete') delete(request: MessageFeedbackDeleteRequest): Promise<MessageFeedbackDeleteResult>
```

Source: [`packages/feedback/message-feedback/src/index.ts:150`](../../packages/feedback/message-feedback/src/index.ts)
<!-- END GENERATED cordis-surface -->
