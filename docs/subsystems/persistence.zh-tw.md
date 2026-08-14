# 工作階段持久化

[English](persistence.md) | [简体中文](persistence.zh.md) | 繁體中文

事件日誌的**持久性 seam**。[session.md](session.md) 描述了記憶體中的 `Session`：僅附加的 `SessionEvent` 日誌即為真源。本頁描述如何使該日誌持久化：抽象的 `SessionPersistence` 服務、它的後端、flush 檢查點、當機復原，以及隨日誌一同儲存的元資料頭。日誌承載的事件詞彙在生成的[持久化日誌事件目錄](../persistence-catalog.md)中逐項列舉。

該 seam 是一個[能力 seam](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)：一個抽象服務（[dsh-session-persistence](../../packages/session/session-persistence)，`ctx.sessionPersistence`）在現有 `SessionEvent` 上定義 locate/create/append、可複用的 Session 準備流程、邏輯 load/inspect、物理後綴讀取，以及輕量的 list/snapshot 觀察——**沒有平行的持久化事件類型**——以及兩個實作同一約定的可互換後端。見 [session-persistence Agent Note](../../.agents/notes/implemented/architecture/2026-06-14-session-persistence.md)。

## flush 檢查點

`session/event` 是一個*同步*通知；持久化外掛程式會將事件複製到逐工作階段控制器，而不阻塞生產方。第一個待處理事件會開啟固定批次處理視窗，後續事件會加入但不會重設截止時間。視窗到期後會啟動一個持久化批次；該次寫入期間接納的事件會獲得自己的截止時間，並形成後續批次。`session/flush` 會取消等待並排空至完全靜止，因此迴圈仍將其用作在領取下一個普通輪次之前的順序與錯誤觀察檢查點。後臺寫入被拒絕時會保留對應事件並暫停自動重試；新事件會開啟新的固定視窗，而顯式 flush 會立即重試，並透過 `agent/error` 和 logger 報告失敗，絕不會把失敗記錄成已關閉輪次之後的工作階段事件。dispose（資源釋放）會執行同樣的最終排空。設定的最大值只限制有意的批次處理等待，不限制事件迴圈調度或後端完成持久化的延遲（[決策](../../.agents/notes/implemented/architecture/2026-08-08-bounded-session-persistence-write-batching.md)）。

## 當機復原保留被中斷的輪次

後端重新載入一個在輪次中途崩潰的日誌時，會發現一個已打開的 `turn/start` 卻沒有 `turn/end`。它**不會**截斷日誌：在長週期任務中，單個輪次可能非常龐大（許多步驟、大量工具輸出），而這些事件在崩潰前已被持久追加。後端改為用一個合成的 `turn/end { reason: { kind: 'interrupted' } }` 關閉這個殘留輪次，在不改變其前後任何獨立事件的情況下配平被中斷的執行。`interrupted` 是唯一一個不由迴圈寄出的 `TurnEndReason`（見 [session.md](session.md#why-a-turn-ended-turnendreasonmap)）。

修復僅適用於冷工作階段。對於活躍 id，`SessionPersistence.load(id)` 會等待權威記憶體快照完成持久化，並且只在日誌平衡時返回；若活躍輪次仍未閉合，則拒絕操作，而不是新增合成的中斷邊界。HMR（熱模組替換）會接管活躍前綴，而不會關閉其中正在進行的輪次。

`SessionPersistence.inspect(id)` 會構造一個不可變的邏輯 Session，但不發布它，也不寫入復原內容。冷檢查會在記憶體中配平中斷的輪次，同時保持撕裂的物理尾部不變；檢查已處於活躍狀態的 Session 則借用其當前不可變快照，因此可能包含未閉合的輪次。使用協調器的實作會在有界 LRU 中保留這個精確的冷未發布 Session，因此重複歷史讀取與後續 `prepare(id)` 可複用同一次讀取、解壓縮、驗證、凍結及 Session 構造。`prepare(id)` 會預留該 Session、提交待處理修復並返回可 dispose 的發布控制代碼；`load(id)` 使用相同機制提交修復，但不會發布 Session。該生命週期由 [Session 準備階段決策](../../.agents/notes/implemented/architecture/2026-08-05-session-preparation.md)定義。

## `SessionLocation`——選填的逐工作階段產物目標

`SessionPersistence.locate(meta)` 會同步解析一個歸後端所有的獨立產物，而不會讀取、建立或 flush 它。JSONL 返回其項目/工作階段目錄內 transcript（文字記錄）的絕對路徑；SQLite 因各工作階段共享一個數據庫而返回 `undefined`。因此，返回的路徑可能指向尚不存在的文件，或指向還不包含當前尚未 flush 輪次的文件；它是位置提示，不是授權或新鮮度保證。

```ts type-equiv
/**
 * A backend-resolved, per-session local artifact location. The path is an
 * absolute target path and can name an artifact that has not materialized yet.
 * Consumers must treat it as a location hint, never as an authorization token.
 */
interface SessionLocation {
  /** Backend-specific artifact kind, for example `jsonl`. */
  readonly kind: string
  /** Absolute path to this session's backend-owned artifact. */
  readonly path: string
}
```

<a id="sessionheader--metadata-beside-the-log"></a>

## `SessionHeader`：日誌旁的元資料

每個工作階段的元資料與事件日誌**分開**儲存：格式版本、cwd、血統與 seed 邊界是儲存層關注點而非對話事件，因此不進入 `SessionEventMap`，也不會到達 `deriveMessages()`。header 透過 `session.header` 附加到 `Session` 上。

原始碼：[`packages/core/session/src/types.ts`](../../packages/core/session/src/types.ts)

```ts type-equiv
/**
 * Immutable validated storage metadata, kept outside the conversation event log.
 */
interface SessionHeader {
  /**
   * On-disk format version, stamped from {@link SESSION_FORMAT_VERSION} when the
   * session is created. A persistence backend rejects any other version on load
   * (no migration — see the constant).
   */
  readonly version: number
  /** The session's id (mirrors the {@link Session}'s id). */
  readonly id: SessionId
  /** Non-negative safe-integer Unix epoch milliseconds when the session was created. */
  readonly createdAt: number
  /** Absolute working directory the session was created in (if any). */
  readonly cwd?: string
  /** The session this one was forked from (seed lineage), if any. */
  readonly parentSession?: SessionId
  /**
   * How many leading events were inherited through a seed. Persisting this
   * boundary lets resume and replay distinguish parent history from child work.
   */
  readonly seedLength?: number
  /**
   * Coarse product classification for a session created as a subagent child.
   * This is presentation metadata, not proof that the child is continuable.
   */
  readonly origin?: 'subagent'
  /**
   * Delegation depth: absent (zero) for a top-level session, parent depth + 1
   * for a subagent child. Persisted so a recursion budget survives restart and
   * resume — a runtime-only depth would reset a resumed child to top-level.
   */
  readonly delegationDepth?: number
  /**
   * Id of the agent preset this session's agent was composed from, when the
   * deployment composes per session. Durable because the preset decides the
   * session's tools and prompt: a resume that restored a different composition
   * would replay history the model can no longer act on.
   */
  readonly agentPreset?: string
}
```

## 格式拒絕：本建置無法可靠讀取的日誌

後端用 `SessionFormatUnsupportedError` 拒絕無法可靠解讀的日誌，它與 `SessionPersistenceCorruptionError` 區分，因為資料沒有損壞。header 的 `version` 比 `SESSION_FORMAT_VERSION` 新時，訊息說明方向（"由更新的 harness 寫入，請升級 harness 後打開"）；比它舊時說明本建置沒有升級路徑。經過 legacy 形狀歸一化後，本建置生成詞彙表（`KNOWN_SESSION_EVENT_TYPES`，由 `gen-persistence-catalog` 生成）之外的事件類型同樣被拒絕，除非該事件的信封帶 `ignorable: true`：靜默跳過一個不認識的必需事件可能改變日誌其餘部分的解讀方式。後端為每個工作階段保留獨立文件時，訊息附上原始日誌路徑，被拒絕的文字仍然可讀。JSONL 後端直接從原始 header 行拒絕外來版本，先於當前 header 形狀校驗和任何事件行解碼，因此結構完全不同的未來格式仍會報告升級方向，絕不會報"損壞"；SQLite 則先由自己的 `SCHEMA_VERSION` pragma 把關整個文件的結構。設計理由與推遲建設的升級器鏈見 [session-log 版本機制 Agent Note](../../.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md)。

## `CreateSessionOptions`：seed 與元資料

透過 store 建立 `Session` 時會接收 `seed`（初始重播或 fork 歷史）與 `meta`（store 整合進 `SessionHeader` 的儲存層欄位）。store 填充 `version`/`id` 並為 `createdAt` 提供預設值；呼叫方可以提供已校驗的絕對 `cwd`、`parentSession` 譜系、`seedLength` 種子邊界、選填的粗粒度 `origin`、`delegationDepth`、用於組裝該 agent（代理）的 `agentPreset` 以及已有的 `createdAt`。`origin: 'subagent'` 讓產品導覽能夠隱藏重複的 child 行；它不證明描述符有效，也不證明 child 可以復原。

```ts type-equiv
/**
 * Options for creating a {@link Session} via the store. `seed` replays/forks
 * an existing event log; `meta` carries the caller-supplied storage fields the
 * store folds into a {@link SessionHeader}.
 */
interface CreateSessionOptions {
  /** Initial replay or fork history supplied at construction. */
  readonly seed?: readonly SessionEvent[]
  /**
   * Storage metadata read once before publication. `seedLength` is explicit
   * because a resumed seed contains the full stored log, not only its inherited prefix.
   */
  readonly meta?: {
    readonly cwd?: string
    readonly parentSession?: SessionId
    readonly createdAt?: number
    readonly seedLength?: number
    readonly origin?: 'subagent'
    readonly delegationDepth?: number
    readonly agentPreset?: string
  }
}
```

因此，重播/fork 的呼叫方式為 `ctx.sessions.create(id, { seed: seedEvents })`；將一個*持久化*工作階段復原為活躍 agent 的呼叫方式為 `ctx.agents.resume({ resumeSessionId })`。

## `SessionRawArtifact`——逐字儲存工件文字

後端為單個工作階段自持的工件文字，與其持久化寫入的位元組逐字一致（按物理編碼解碼）。`readRaw` 返回它而不從解析後事件重建，因此後端特定的序列化（chunk 打包、鍵序、換行）得以保留。Consumer 須先檢查 `supportsRawArtifacts`：`false` 表示後端不提供此能力（如 SQLite），而 `readRaw(...) === undefined` 表示受支持的後端沒有該工作階段的已實體化工件。

```ts type-equiv
/** A backend's own raw artifact text for one session, verbatim. */
interface SessionRawArtifact {
  /** The session header parsed from the artifact's own first line. */
  readonly meta: SessionHeader
  /** The artifact's base filename on disk, without any physical encoding suffix. */
  readonly filename: string
  /** The artifact's full text content, decoded from the backend's physical encoding. */
  readonly content: string
}
```

## 準備與復原所有權

`SessionStore.prepare()` 接收普通建立選項，或透過 `RestoredSessionOptions` 轉移所有權的全新的持久化對象圖。復原分支會就地驗證並凍結轉移來的 header 與事件，因此呼叫方不得保留可變別名。`SessionPreparation` 隨後持有該精確的未發布 Session，直至發布或回滾；dispose 是同步且冪等的。持久化檢查只暴露 `SessionInspection`，即從同一個已準備 Session 借用的不可變邏輯檢視表。

```ts type-equiv
/**
 * Fresh storage values transferred to {@link SessionStore.prepare} without a
 * second serialization copy. Callers retain no mutable aliases.
 */
interface RestoredSessionOptions {
  /** Fresh detached storage events to validate and freeze in place. */
  readonly seed: SessionEvent[]
  /** Fresh detached storage metadata to validate and freeze in place. */
  readonly meta: SessionHeader
  /** Select the persistence ownership-transfer path. */
  readonly seedSource: 'persistence'
}
```

```ts type-equiv
/** Inputs accepted while constructing an unpublished Session. */
type PrepareSessionOptions =
  | (CreateSessionOptions & { readonly seedSource?: undefined })
  | RestoredSessionOptions
```

```ts type-equiv
/** Options for a preparation whose provider retains unpublished state. */
interface SessionPreparationOptions {
  /** Release provider-owned state when the Session was not published. */
  readonly release?: () => void
}
```

```ts public-api
/**
 * One exact unpublished Session and the provider state that keeps it usable.
 * Disposal is synchronous and idempotent. Providers decide whether release
 * returns the Session to a cache or discards it; publication may consume that
 * state before disposal, making the callback a no-op.
 */
declare class SessionPreparation implements Disposable {
  /** The exact Session to use for setup and publication. */
  readonly session: Session;
  /**
   * Wrap an unpublished Session in one preparation lifetime.
   * @param session - exact unpublished Session.
   * @param options - optional provider release behavior.
   * @returns a preparation disposed after publication or rollback.
   */
  static create(session: Session, options?: SessionPreparationOptions): SessionPreparation;
  /** Release provider state once when this preparation leaves its caller. */
  [Symbol.dispose](): void;
}
```

```ts type-equiv
/** Immutable logical session prepared from persistence or a live owner. */
interface SessionInspection {
  /** Validated immutable session metadata. */
  readonly meta: SessionHeader
  /** Validated contiguous logical event log. */
  readonly events: readonly SessionEvent[]
}
```

## 輕量源修訂號

派生狀態的消費端會在載入完整事件日誌之前比較一個低開銷的不透明修訂號。其表示由持久化後端擁有，並隨 append 或會修改資料的 load 修復以交易方式改變；呼叫方僅比較修訂號是否相等。

```ts type-equiv
/**
 * Backend-owned token that identifies both one storage source and one revision
 * of a persisted session log.
 */
type SessionPersistenceRevision = Branded<'SessionPersistenceRevision'>
```

```ts type-equiv
/** Lightweight immutable source identity returned without loading a full log. */
interface SessionPersistenceSnapshot {
  /** Detached metadata for one materialized session. */
  header: SessionHeader
  /** Opaque source-qualified token that changes whenever this stored log changes. */
  revision: SessionPersistenceRevision
}
```

## 後端

兩者都實作同一個抽象 `SessionPersistence`（在 `SessionEvent` 上執行 locate/create/append/prepare/load/inspect/readFrom/list/listSnapshots，觀察方法選填支持取消），並透過共享的 `runPersistenceContract` 套件：

- **[dsh-session-persistence-jsonl](../../packages/session/session-persistence-jsonl)**——每個工作階段一份僅附加的邏輯 JSONL 日誌，默認儲存為帶 checksum 的連續 Zstandard frame，也可設定為原始行；支持崩潰安全的原子寫入、被中斷輪次的復原以及讀取/重播路徑。
- **[dsh-session-persistence-sqlite](../../packages/session/session-persistence-sqlite)**：基於 `node:sqlite`，每個 `SessionEvent` 一行。行欄位 `(session_id, seq, type, time, data, source_event_seqs, surface_op)` 與事件 1:1 對映（包含選填的 surface 元資料），因此沒有需要保持同步的平行持久化 schema。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsessionpersistence--sessionpersistence-abstract-seam"></a>

### `ctx.sessionPersistence` — `SessionPersistence` (abstract seam)

Durable append-only session storage. Implementations preserve contiguous, losslessly JSON-serializable events; append resolves only after durability, and load balances a complete interrupted tail without rewriting committed events.

```ts cordis-catalog
/**
 * Resolve this backend's independent local artifact for a session without
 * reading, creating, flushing, or otherwise materializing it. Backends such
 * as SQLite that do not own one artifact per session return `undefined`.
 * @param meta - the immutable session header whose artifact is requested.
 * @returns the backend-specific absolute location, when one exists.
 */
abstract locate(meta: SessionHeader): SessionLocation | undefined

/**
 * Read a session's backend-owned artifact text verbatim — the exact durable
 * bytes the backend wrote (decoded from its physical encoding, e.g. a
 * decompressed JSONL). The returned `content` is the raw text, not a
 * reconstruction from parsed events, so it preserves backend-specific
 * serialization (chunk packing, key order, line breaks). Callers first test
 * {@link supportsRawArtifacts}; `undefined` then means only that the requested
 * session has no materialized artifact.
 * @param _id - the persisted session to read (unused by the default: no
 * per-session artifact).
 * @param signal - optional cancellation for backend read work.
 * @returns the raw artifact plus its parsed header, or `undefined` when the
 * session is absent.
 * @throws when this backend does not expose per-session raw artifacts.
 */
readRaw(_id: SessionId, signal?: AbortSignal): Promise<SessionRawArtifact | undefined>

/**
 * Register a new session's metadata. A backend MAY defer the physical write
 * until the first {@link append} (lazy materialization), in which case a
 * created-but-never-appended session is absent from {@link list}
 * — abandoned sessions leave nothing behind.
 * @param meta - the immutable header (id, version, cwd, lineage) to record.
 */
abstract create(meta: SessionHeader): Promise<void>

/**
 * Durably persist a batch of events. Honors the append-only and contiguous-
 * seq contracts: the first event's `seq` MUST equal the stored next-seq
 * (after `load` has durably closed any interrupted turn). Rejects non-JSON-
 * serializable `event.data` with an error naming the offending event type.
 * @param id - the session the batch belongs to.
 * @param events - the contiguous batch to persist, in seq order.
 */
abstract append(id: SessionId, events: readonly SessionEvent[]): Promise<void>

/**
 * Prepare the exact unpublished Session used by resume. Implementations may
 * reuse object graphs retained by an earlier {@link inspect} after confirming
 * their durable revision is still current; disposal releases an unpublished
 * reservation. Revision retries require the durable log to remain unchanged
 * for one read/check round trip; continuous external writers may delay completion.
 * @param id - persisted session to prepare.
 * @param signal - optional cancellation for preparation work.
 * @returns one owned unpublished Session preparation.
 */
async prepare(id: SessionId, signal?: AbortSignal): Promise<SessionPreparation>

/**
 * Load an immutable balanced logical view and commit any required cold
 * recovery. A complete interrupted final turn is preserved and durably
 * closed with missing tool errors plus any open step and turn boundaries;
 * only a torn final record is discarded. Unknown versions and corruption in
 * the committed prefix reject. Implementations MUST NOT crash-repair an
 * identity still bound to a live Session: a balanced live log may return as a
 * durable snapshot, while an open live turn rejects. Returned values may be
 * shared with immutable live or prepared state and must not be mutated.
 * Revision-based implementations may wait for one stable read/check round trip.
 * @param id - the persisted session to reload.
 * @returns the header and a log ending on a balanced `turn/end`.
 */
abstract load(id: SessionId): Promise<SessionInspection>

/**
 * Inspect an immutable logical session without committing recovery or
 * publishing it. A cold complete interrupted turn receives synthetic closers
 * in memory and a torn physical tail remains untouched. An already-live
 * Session instead yields its current immutable snapshot, which may contain an
 * open turn and its `session/end-seed` boundary. Coordinator-backed
 * implementations retain the exact cold unpublished Session for bounded
 * reuse by a later {@link prepare}. A stale ready source is reloaded; a source
 * already committing or reserved for resume remains exclusive, and inspection
 * may borrow its immutable view. Callers borrow only the immutable header and
 * log. Continuous external writers may delay revision convergence.
 * @param id - the persisted session to inspect.
 * @param signal - optional cancellation for queued and backend read work.
 * @returns the validated header and current logical event log.
 */
abstract inspect(id: SessionId, signal?: AbortSignal): Promise<SessionInspection>

/**
 * Read the stored events from `fromSeq` onward — the read-from-seq
 * primitive for read models that resume from a watermark (e.g. a persisted
 * projection cache folding only the tail past its checkpoint). Unlike
 * {@link inspect}, it is a detached physical suffix read: no preparation
 * cache, torn-tail truncation, synthetic closers, or coordinator-state
 * publication. Only events from the valid contiguous stored prefix are
 * returned, so a torn fragment never reaches the caller. `fromSeq` at or
 * beyond the stored prefix returns an empty event list (never an error).
 * Backends whose medium can seek by seq
 * (SQLite) read only the suffix; sequential media (JSONL, both encodings)
 * still parse the whole artifact and skip forward — the primitive bounds
 * what is RETURNED and refolded, not every backend's physical read.
 * @param id - the persisted session to read.
 * @param fromSeq - first event seq to include; a non-negative safe integer.
 * @param signal - optional cancellation for queued and backend read work.
 * @returns the header and the stored events with `seq >= fromSeq`.
 */
abstract readFrom(id: SessionId, fromSeq: number, signal?: AbortSignal): Promise<{ meta: SessionHeader; events: SessionEvent[] }>

/**
 * Lightweight listing from metadata, without a full-log parse.
 * @param signal - optional cancellation for backend listing work.
 * @returns one header per materialized session.
 */
abstract list(signal?: AbortSignal): Promise<SessionHeader[]>

/**
 * List materialized sessions with cheap per-log change tokens.
 *
 * Repeated observations of an unchanged log return the same revision. A
 * successful mutating {@link load} repair changes the next listed revision.
 * Revisions also distinguish independently backed stores so backend-local
 * counters cannot compare equal across different persistence sources.
 * @param signal - optional cancellation for backend snapshot-listing work.
 * @returns one header and opaque revision per materialized session without loading full logs.
 */
abstract listSnapshots(signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]>
```

Types: [SessionEvent](session.md) · [SessionId](core.md)

Source: [`packages/session/session-persistence/src/index.ts:84`](../../packages/session/session-persistence/src/index.ts)
<!-- END GENERATED cordis-surface -->
