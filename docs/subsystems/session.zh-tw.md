# 工作階段

[English](session.md) | [简体中文](session.zh.md) | 繁體中文

[dsh-session](../../packages/core/session) 的記憶體事件溯源模型。`Session` 是一份由類型化 `SessionEvent` 組成的**僅附加日誌**，是 agent（代理）完整互動歷史的唯一真源。LLM（大型語言模型）訊息歷史從日誌*派生*而來，從不單獨儲存；重播即從同一組事件重新派生。日誌如何實作**持久化**（持久化 seam、後端、當機復原）是兄弟文件 [persistence.md](persistence.md) 的關注點。

原始碼：[`packages/core/session/src/types.ts`](../../packages/core/session/src/types.ts)

## `SessionEventMap`：事件詞彙

僅附加的事件類型。可透過聲明合併擴充：外掛程式透過 declaration merging 聲明額外的事件類型。例如[壓縮（compaction） seam](compaction.md) 新增了 `compaction/start` / `compaction/summary` / `compaction/end`，`@deepseek-ai/dsh-hook-protocol` 為掛鉤橋接新增了僅記錄日誌的 `hook/invoked` / `hook/result` 記錄。與 `compaction/*` 一樣，這些都不是 `SurfaceEventType`（沒有 `surfaceOp`）。生成的[持久化日誌事件目錄](../persistence-catalog.md)列舉了所有成員（核心與合併擴充的），包含其 payload、surface 標記與聲明位置。

```ts type-equiv
/** A user-role specialization of the one shared message representation. */
interface UserMessage extends Message {
  readonly role: 'user'
}
```

```ts type-equiv
/**
 * The merge-extensible, append-only source of truth for an agent interaction.
 * Message history is derived from this log. Every event is lossless JSON and
 * sequence numbers stay contiguous, including raw chunks, so persistence can
 * store the canonical log verbatim.
 */
interface SessionEventMap {
  /**
   * Opens turn `turn` before the loop claims queued input or runs pre-step.
   * Rejection, empty input, cancellation, or failure may close it with no
   * step; otherwise the following identified `user/message` event or batch
   * records the messages entering the step.
   */
  'turn/start': { turn: number }
  /**
   * Closes turn `turn` with the {@link TurnEndReason} that ended it. A turn
   * with no entered step has no `step/start` or `step/end`. The loop does not await a
   * flush at turn boundaries: `dsh-session-checkpoint-policy` owns the
   * per-request durability checkpoint, and consumers that read storage after
   * `whenIdle()` flush themselves. Success commits the turn; rejection is
   * reported live and does not prevent later work.
   */
  'turn/end': { turn: number; reason: TurnEndReason }
  /** Opens step `step` of turn `turn` — one model call plus the tool executions it requested. */
  'step/start': { turn: number; step: number }
  /** Closes step `step` of turn `turn`. */
  'step/end': { turn: number; step: number }
  /**
   * A user-role message on the model-visible surface: a direct human prompt
   * (the queued message claimed for this turn), a synthetic `agent.inject()`
   * context (file-change notices, subdir AGENTS.md, skill content, cron
   * notifications, …), or an entered goal continuation round. All three
   * project their `content` verbatim; `source` tells them apart.
   */
  'user/message': UserMessage
  /** Raw stream chunk — token-level replay fidelity. */
  'assistant/chunk': { turn: number; step: number; chunk: StreamChunk }
  /**
   * Assembled assistant message for one step (derived history uses this).
   * Carries the step's `usage` when the adapter reported token accounting, so
   * the model output and its accounting travel together (there is no separate
   * usage record). `usage` is absent when the adapter reported none.
   */
  'assistant/message': { turn: number; step: number; message: AssistantMessage; usage?: TokenUsage }
  /**
   * The model requested one tool invocation: `name` with the raw `arguments`
   * JSON string exactly as the model produced it (unparsed). `callId` pairs the
   * call with its `tool/result`.
   */
  'tool/call': { turn: number; step: number; callId: CallId; name: string; arguments: string }
  /**
   * A completed tool call's model-facing result, optional internal failure
   * identity, and optional tool-private `meta` presentation payload. `meta` is
   * opaque to the core (the producing tool owns its shape and reads it back in
   * `presentResult`) but MUST be JSON-serializable: `Session.append`
   * runtime-validates all event data with `isJsonValue`, so a non-serializable
   * `meta` is rejected at the source, and the durable log reproduces the
   * identical card on replay. Absent
   * unless the tool attaches one (e.g. `dsh-tool-fs` carries its result-time
   * contextual diff here).
   */
  'tool/result': {
    turn: number
    step: number
    message: ToolResultMessage
    error?: { name: string; code: string }
    meta?: JsonValue
  }
  /** Whole-list snapshot; latest write wins on replay. Log-only UI state; never derived history. */
  'todo/write': { todos: TodoItem[] }
  /**
   * Full header for the next request, appended inside its step before dispatch.
   * It is log-only; the latest snapshot reconstructs the request header.
   */
  'request/header': { header: EpochHeader; reason: RequestHeaderReason }
  /**
   * Route metadata for the next request, logged only when the route or capacity
   * changes. It does not participate in request reconstruction or header equality.
   */
  'request/context': RequestContext
  /**
   * Marks the end of a constructor seed. Events before it have smaller seq
   * values and came from the seed (resume, fork, or replay); this lifecycle
   * produced none of them. This log-only event is the durable projection of
   * {@link Session.firstLiveSeq}. Its payload is empty — position and `time`
   * carry the meaning.
   *
   * Locate the LAST one in stored history. A seed already ending in one is not
   * re-marked, so reopening an untouched session does not grow its log per
   * pickup and the event need not be at the current `firstLiveSeq`.
   *
   * `Session`'s constructor is the only legitimate writer. The invariant
   * companion deliberately constrains nothing here, so a plugin appending one
   * would silently classify every live bracket before it as seed history.
   *
   * An owner of a standalone open/close bracket (`compaction/start` …
   * `compaction/end`) reads it because seed history and live work are otherwise
   * byte-identical: an unmatched opening marker before this event belongs to
   * an ended lifecycle, whatever ended it. NOT a liveness signal about other
   * writers — a concurrently live session holds its own boundary elsewhere,
   * so tolerating concurrent writers needs a signal beyond the log.
   */
  'session/end-seed': Record<string, never>
}
```

`UserMessage` 是普通提示詞、注入上下文、steering（中途引導）與即時收件箱事件共享的帶標識且凍結的 user-role 值。事件包裝層只會增加事件本機的位置或結果事實；條目待處理期間，loop 只額外附加驅動程式器自有的路由狀態。

### `TodoItem`：一條待辦項

這是 `todo/write` 事件全量清單快照中的單元。它有意保持精簡：一行 `content` 加一個三態 `status`（沒有 id、優先級或 `activeForm`）；清單在每次寫入時整體替換，因此條目無需穩定標識。見 [todo_write Agent Note](../../.agents/notes/implemented/feature/2026-06-29-todo-write-tool.md)。

```ts type-equiv
/**
 * One entry in an agent's todo list — the unit of the `todo/write`
 * {@link SessionEventMap} event's whole-list snapshot.
 *
 * Deliberately minimal: a human-readable `content` line and a three-state
 * `status`. No id, priority, or `activeForm` — the list is replaced wholesale
 * on every write (last-write-wins), so entries need no stable identity. The
 * three statuses describe the complete portable lifecycle needed by model and
 * UI consumers.
 */
interface TodoItem {
  /** What this task is — a short imperative line shown in the UI. */
  content: string
  /** Lifecycle state. `in_progress` marks a task being worked now; parallel work may mark several. */
  status: 'pending' | 'in_progress' | 'completed'
}
```

<a id="the-request-header-event-requestheader"></a>

### 請求標頭事件：`request/header`

請求信封（即 `EpochHeader`：呼叫設定 + 配接器所提供預設值的標記 + 渲染後的系統提示詞 + 已組裝的工具 schema）會作為工作階段狀態寫入日誌，因此每個對話請求都是日誌的純函式（見可重建性 Agent Note）。帶有 reason `'initial'` 或 `'resume'` 的完整 `request/header` 快照記錄每個 agent loop 實例的邊界；之後請求發生變化時，系統會以 reason `'change'` 記錄另一份完整快照。`foldRequestHeader(events)` 透過選擇最新快照重建請求標頭。該事件不是 `SurfaceEventType`，不產生 LLM 訊息。

```ts type-equiv
/**
 * Logged request state outside derived history: call config, system prompt, and
 * tools. The latest full `request/header` snapshot reconstructs it; canonical
 * empty optional fields are absent.
 */
interface EpochHeader {
  /** The conversation's call configuration (provider, model, reasoning effort, and sampling scalars). */
  config: LlmCallConfig
  /** Effective config fields materialized from the exact adapter rather than proposed by a caller. */
  adapterDefaults?: LlmCallConfigAdapterDefaults
  /** Rendered system prompt text; absent for a system-less request. */
  system?: string
  /** Assembled tool schemas; absent for a tool-less request. */
  tools?: ToolSchema[]
}
```

規範形式：空系統提示詞和空工具清單都表示為欄位缺失，與請求建置方式一致。包含舊版 `request/header-delta` 事件或完整快照原因為 `fallback` 的舊版 v0 日誌，會在 seed、append 和持久化載入邊界被拒絕，而不會以不完整方式重播。

### 路由容量事件：`request/context`

請求所解析到的路由的上下文元資料是獨立的已記錄狀態，在同一步驟內緊隨 `request/header` 追加，且僅在提供方、模型或容量與上一條記錄不同時追加。它保持在 `EpochHeader` 之外，因為該類型是 `headerEquals` 逐欄位比較的重建約定。容量描述的是路由，不是請求輸入，把它摺疊進去會讓一次容量變化被登記為請求信封的 `change`，也會把配接器元資料拉進 loop 的重建不變式。與 `request/header` 一樣，它不是 `SurfaceEventType`，也不產生 LLM 訊息。`session.requestContext()` 以增量方式歸並最新一條記錄。配接器不公佈容量的路由會以缺失 `contextWindow` 的形式記錄，因此新記錄可以清除較早路由的容量。

```ts type-equiv
/** Registration-bound metadata for one resolved model route. */
interface RequestContext {
  /** Registered provider route the metadata belongs to. */
  provider: string
  /** Provider-owned model id the metadata belongs to. */
  model: string
  /** Maximum combined request and response context in tokens, when advertised. */
  contextWindow?: number
}
```

## `SessionEvent<T>`：一條日誌條目

基於 `type` 的真正可辨識聯合（而非獨立的 `type`/`data` 聯合），因此 `switch (event.type)` 能直接收窄 `event.data`，無需類型斷言。`seq` 是日誌中的單調遞增位置（`seq = log.length`）；`time` 為 epoch 毫秒。

```ts type-equiv
/**
 * One immutable entry in the session log.
 *
 * A proper discriminated union over `type` (not independent `type`/`data`
 * unions), so `switch (event.type)` narrows `event.data` without casts.
 *
 * The {@link sourceEventSeqs} and {@link surfaceOp} fields are conditional:
 * they only exist on {@link SurfaceEventType} variants (`user/message`,
 * `assistant/message`, `tool/result`).
 * Non-surface events (boundary markers, chunks, usage, errors) never carry
 * surface metadata — the compiler enforces this at `Session.append()`
 * call sites.
 */
type SessionEvent<T extends SessionEventType = SessionEventType> = {
  [K in SessionEventType]: {
    type: K
    /** Monotonic sequence number within the session. */
    seq: number
    /** Unix epoch milliseconds. */
    time: number
    data: SessionEventMap[K]
    /**
     * Marks an event a reader may safely skip when it does not recognize
     * `type`. Absent means required: a reader meeting an unrecognized type
     * without this marker MUST refuse to reconstruct the session instead of
     * silently dropping the event, because an unrecognized required event may
     * change how the rest of the log is interpreted. A writer sets `true` only
     * on purely informational records whose loss cannot affect reconstruction;
     * defaulting to required means a forgotten marker over-refuses (an
     * inconvenience) rather than silently resuming a gutted session.
     */
    ignorable?: true
  } & (K extends SurfaceEventType ? {
    /**
     * Seq numbers of earlier events that this event cites as sources
     * (e.g. the `assistant/chunk` seqs that built an `assistant/message`,
     * or the surface nodes shadowed by a compaction replace node). An
     * `assistant/message` may carry a present empty array for a known empty
     * provider stream; when the field is absent, the event does not record which
     * earlier events produced the message.
     */
    sourceEventSeqs?: number[]
    /** How this event entered the surface; absent for non-surface events. */
    surfaceOp?: SurfaceOp
  } : object)
}[T]
```

`SessionEventType = keyof SessionEventMap`。由於 `SessionEventMap` 可透過合併擴充，對 `SessionEvent` 的 switch 語句禁止使用 `assertNever`：外掛程式新增的變體是合法的未知值；處理已知 case 後在 `default` 中放行。

對於 `assistant/message`，存在的 `sourceEventSeqs: []` 表示提供方流已知且完整地為空；舊格式或外部事件缺少該欄位時，沒有記錄這則訊息由哪些早期事件產生。agent loop 會為每次成功的模型呼叫寫入該欄位；其他 surface 事件只要包含該欄位，其清單就必須非空。

## Surface 類型

三種產生訊息的類型（`SurfaceEventType`：`user/message`、`assistant/message`、`tool/result`）攜帶 surface 元資料，用來聲明它們如何加入有序的派生 surface。見 [session surface Agent Note](../../.agents/notes/implemented/architecture/2026-06-18-session-surface.md)。

### `SurfaceEventType`：事件類型中產生訊息的子集

```ts type-equiv
/**
 * The subset of {@link SessionEventType} values whose events produce LLM
 * messages and are eligible to appear on the ordered surface. Only these
 * event types may carry {@link SurfaceOp} and {@link SessionEvent.sourceEventSeqs}.
 */
type SurfaceEventType =
  | 'user/message'
  | 'assistant/message'
  | 'tool/result'
```

### `SurfaceOp`：事件如何進入 surface

```ts type-equiv
/**
 * How a session event entered the ordered surface. Only valid on
 * {@link SurfaceEventType} events.
 *
 * - `'append'`: added to the tail — normal path for user/assistant/tool
 *   messages.
 * - `{ op: 'replace', start, end }`: replaces surface nodes from `start`
 *   (inclusive) through `end` (inclusive) with this node. Both must exist as
 *   surface nodes in the current surface. `start === end` replaces a single
 *   node. The node's {@link SessionEvent.sourceEventSeqs} must include every
 *   shadowed surface node. Used by compaction; any surface-replacing producer
 *   may use it.
 */
type SurfaceOp =
  | 'append'
  | { op: 'replace'; start: number; end: number }
```

`'append'` 是常規的尾部追加路徑。`replace` 會遮蔽從 `start` 到 `end`（含兩端）的 surface 條目（兩者都必須是有效的 surface seq；`start === end` 時僅替換單個條目），並在原位置插入新事件。

### `SurfaceIntent`：`session.append()` 的參數

```ts type-equiv
/**
 * Surface placement and cited source-event seqs for {@link Session.append}. Required on
 * message-producing events and forbidden on log-only events.
 */
interface SurfaceIntent {
  surfaceOp: SurfaceOp
  /**
   * Complete set of known source-event seqs. `assistant/message` may use a
   * present empty array for a known empty provider stream; when the field is
   * absent, the event does not record which earlier events produced the message.
   * Other surface events require a non-empty set when this field is present.
   */
  sourceEventSeqs?: number[]
}
```

對 `SurfaceEventType` 事件必填：每個產生訊息的事件都必須聲明它如何加入 surface（派生模型歷史的唯一來源）。面向人類的 transcript（文字記錄）是另一個投影，讀取的是日誌中追加來源的事件，因為 surface 會有意遮蔽替換所概括的範圍（見 [dsh-session](../../packages/core/session/README.md) 的 `isAppendSurfaceEvent`）。非 surface 類型在編譯期拒絕此參數。

只有 `assistant/message` 可以攜帶存在但為空的 `sourceEventSeqs`；欄位不存在時，該事件沒有記錄這則訊息由哪些早期事件產生，但提供方仍可能寄出過區塊。

### `SessionSurface`：即時只讀 surface 投影

`Session.surface` 返回工作階段穩定的 `SessionSurface` 檢視表。同一個增量管理器在提交前校驗追加候選事件，並根據已提交事件推進該投影；呼叫方可以觀察成員關係和替換代次，但不能呼叫校驗。

`SurfaceManager(log, baseSeq?)` 也可以摺疊一個連續的已載入視窗，其第一個事件的絕對序號為 `baseSeq`。每個事件在該絕對序號空間中仍保持連續；如果替換跨過視窗頭部，由於其聲明的範圍並不存在，該替換會失敗。

```ts type-equiv
/** Readonly live projection of the message-producing session events. */
interface SessionSurface {
  /** Current surface event sequences in model-visible order. */
  readonly nodes: readonly number[]
  /** Monotonic count of committed positional replacements. */
  readonly replaceGeneration: number
}
```

### `SurfaceFoldReplacement` 與 `SurfaceFoldResult`：完整的 surface 重播

`foldSurface(events)` 返回一份獨立的當前事件 seq 清單，以及每個聲明的替換範圍實際遮蔽的 seq。即時管理器複用同一套狀態轉換，但不保留替換歷史。每提交一次替換，其 `replaceGeneration` 就遞增一次，使增量消費端能夠區分純尾部成長與重寫。

```ts type-equiv
/** One replacement operation observed while folding a session surface. */
interface SurfaceFoldReplacement {
  /** Seq of the event that replaced the prior surface range. */
  seq: number
  /** Declared inclusive start seq of the replaced surface range. */
  start: number
  /** Declared inclusive end seq of the replaced surface range. */
  end: number
  /** Actual surface entries removed by the operation, in surface order. */
  shadowedSeqs: number[]
}
```

```ts type-equiv
/** Complete result of replaying the surface operations in a session log. */
interface SurfaceFoldResult {
  /** Current surface event sequences in model-visible order. */
  nodes: number[]
  /** Replacement operations in event order. */
  replacements: SurfaceFoldReplacement[]
}
```

## `Session` 公共 API

去除方法體的聲明與原始碼中的普通類保持同步，覆蓋其脫離態工廠、狀態訪問器、append 方法和歷史投影。儲存操作仍由生成的 [`ctx.sessions` 小節](#ctxsessions--sessionstore)記錄。

```ts public-api
/**
 * An event-sourced session: an append-only log of {@link SessionEvent}s.
 *
 * Plain class (not a Service) — create live instances via
 * `ctx.sessions.create()` and detached instances via {@link create}.
 * Seeding with an existing event log replays/forks a session.
 * @typert object
 */
declare class Session {
  /** The ordered surface over this session's event log. */
  get surface(): SessionSurface;
  /**
   * Detached, deep-frozen creation metadata (format version, cwd, lineage,
   * seed boundary). Supplied by the store via `ctx.sessions.create()`. When a
   * `Session` is created without a store-owned header, a minimal header is
   * synthesized (stamped with the current {@link SESSION_FORMAT_VERSION}) so
   * `session.header` is always present. Kept out of the event log — it is a
   * storage concern, not replayable conversation state.
   */
  readonly header: SessionHeader;
  /** The session identity, derived from its durable header's single copy. */
  get id(): SessionId;
  /**
   * The first seq appended IN THIS PROCESS: the length of the constructor
   * seed (0 without one). Events with smaller seq values entered through
   * construction — replay, fork, or resume — and were never published on the
   * `session/event` firehose (constructor seeds do not emit), so consumers
   * that replay the log as a publication substitute (telemetry adoption)
   * start here. Distinct from `header.seedLength`, the DURABLE fork-lineage
   * boundary: a resumed session's constructor seed is its full stored log,
   * while its header keeps the original fork value — this field is the
   * in-process construction fact.
   *
   * Not persisted itself: a seeded session projects it into the log as the
   * `session/end-seed` event, which is what a consumer reading STORED history
   * reads. Locate the LAST such event, not necessarily one at this seq — a
   * seed already ending in one is not re-marked, so reopening an untouched
   * session leaves that event at a smaller seq than `firstLiveSeq`. Prefer
   * this field in-process: it is exact before the marker reaches storage.
   *
   * When this lifecycle appends the marker, it occupies this seq before the
   * store attaches and therefore does not publish either. Otherwise this seq
   * holds an ordinary published write.
   */
  readonly firstLiveSeq: number;
  /**
   * Create a detached session by validating and snapshotting borrowed seed
   * events and storage metadata.
   * @param id - session identity.
   * @param seed - optional borrowed replay or fork events.
   * @param header - optional borrowed storage metadata.
   * @returns a detached session.
   */
  static create(id: SessionId, seed?: readonly SessionEvent[], header?: SessionHeader): Session;
  /**
   * Restore a detached session by taking ownership of fresh persistence values.
   * The storage format, event envelopes, sequence continuity, surface transitions,
   * and header fields are validated before the restored objects are frozen.
   * @param id - restored session identity.
   * @param seed - fresh detached events whose ownership is transferred.
   * @param header - fresh detached metadata whose ownership is transferred.
   * @returns a restored detached session.
   */
  static fromRestore(id: SessionId, seed: readonly SessionEvent[], header: SessionHeader): Session;
  /**
   * An immutable snapshot of the append-only event log. The snapshot is reused
   * until the next append; a previously returned array does not grow later.
   * Events and their nested data are deep-frozen at acceptance, so neither a
   * cast nor ordinary JavaScript can rewrite durable history.
   */
  get events(): readonly SessionEvent[];
  /** The next event's sequence number — always the log length (the `seq = log.length` contiguity contract). */
  get seq(): number;
  /**
   * Append one typed event to the log and synchronously notify observers via
   * the store-owned, module-private publication hooks. The hot path never blocks
   * on I/O — persistence plugins buffer asynchronously. Once the event enters
   * the log, the append is committed: observer failures are logged and
   * contained per listener, so they do not change the return value or prevent
   * later listeners from observing the same accepted event.
   *
   * @param type - The event type (key of {@link SessionEventMap}).
   * @param data - The event payload; must be JSON-serializable.
   * @param opts - Surface metadata: `surfaceOp` controls how the event enters
   *   the ordered surface; `sourceEventSeqs` lists the seq numbers of earlier
   *   events this one derives from. REQUIRED for
   *   {@link SurfaceEventType} events (every message-producing event must
   *   declare how it joins the surface, the sole source of derived model
   *   history) and
   *   rejected by the compiler for non-surface types like `turn/start` or
   *   `assistant/chunk`.
   * @returns the logged event — its assigned `seq`/`time` plus the SNAPSHOT of
   *   `data` that entered the log, so reading `event.data` back sees the logged
   *   value, never the caller's still-mutable input.
   * @throws if `data` or surface metadata is not losslessly JSON-serializable
   *   (BigInt, function, symbol, undefined, negative zero, non-finite number,
   *   circular reference, sparse array, or an exotic object such as
   *   Map/Set/Date/class instance), or when the candidate violates the
   *   canonical surface contract (marker shape and eligibility, unique
   *   earlier source-event references, positional replacement validity, and complete
   *   shadowed-node coverage). One recursive pass reads, validates, and
   *   copies each nested value once, so a stateful getter cannot supply one value
   *   to validation and another to storage. The event log is the durable source
   *   of truth, so a bad event fails at the append site rather than later during
   *   a backend flush. A synchronous internal dispatch validation failure or an
   *   append reentered while this acceptance/publication boundary is open also
   *   rejects before the log changes.
   */
  append<T extends SessionEventType>(
    type: T,
    data: SessionEventMap[T],
    ...opts: T extends SurfaceEventType ? [opts: SurfaceIntent] : []
  ): SessionEvent<T>;
  /**
   * The {@link EpochHeader} in force after the log's last header event — the
   * header the NEXT request will be compared against — or undefined before
   * the first `request/header` snapshot. The live, incrementally-maintained
   * form of `foldRequestHeader(session.events)`: each header event is folded
   * once, when first seen, so a per-step read costs O(new events).
   * @returns the folded header, or undefined when no header event exists yet.
   */
  requestHeader(): EpochHeader | undefined;
  /**
   * Return the latest resolved route metadata, or `undefined` before the first
   * `request/context` event. Each event is folded once.
   * @returns the latest immutable route metadata.
   */
  requestContext(): RequestContext | undefined;
  /**
   * Derive the LLM message history by walking the ordered sequences of
   * message-producing events maintained by `surfaceOp` markers. The
   * surface is the single source of derived history: every message-producing
   * append records its `surfaceOp`, so a raw event with no marker (a chunk, a
   * turn boundary) is correctly absent, and a compaction `replace` deletes the
   * shadowed nodes from the derivation. The projection rules are
   * {@link deriveEventMessage}, folded per node.
   *
   * CACHED: each surface node is projected exactly once, when first seen — a
   * call costs O(new nodes), and a surface rewrite (a `replace`;
   * {@link SessionSurface.replaceGeneration}) rebuilds. The returned array is
   * a fresh snapshot per call (later appends never grow an array a caller
   * already holds); the `Message` objects in it are SHARED and **deep-frozen**.
   * Their content reuses the already frozen durable event data, so the cache
   * needs no second deep clone and consumers still cannot mutate the log.
   * @returns a fresh array of the shared, frozen derived history.
   */
  deriveMessages(): Message[];
  /**
   * Instance face of the pure per-node `deriveEventMessage` export from
   * `surface.ts`.
   * @param event - the event to project.
   * @returns the derived message, or null when the event produces none.
   */
  deriveEventMessage(event: SessionEvent): Message | null;
}
```

## 派生歷史：`deriveMessages()` 與 `deriveEventMessage()`

`Session.deriveMessages()` 將事件日誌投影為模型看到的 `Message[]`。它是快取的（每個 surface 節點在首次出現時投影一次；surface 重寫觸發重建）且凍結的（每次呼叫返回一個新陣列，引用共享的深凍結訊息，因此透過投影修改已記錄的歷史在類型上不可表達）。`deriveEventMessage(event)` 是摺疊所應用的逐節點純函式，公開暴露以便外部重建器和開發不變式檢查能以完全相同的規則投影日誌前綴，不會與快取產生分歧。投影規則：

- `user/message` → 一條攜帶確切 `content` 的 user 訊息；選填 envelope 僅作為日誌中的展示元資料保留。
- `assistant/message` → 一條 assistant 訊息，包含生成它的提供方和模型，以及選填的配接器私有重播狀態。原始 `assistant/chunk` 事件屬於重播/UI 資料，在派生時會被**跳過**（組裝後的訊息纔是權威）。**內容為空的** `assistant/message` 也會跳過：因 max-tokens 而截斷且無內容的步驟仍會記錄一條 `assistant/message` 來保存用量、提供方和模型，但無內容的 assistant 輪次不得進入提供方 transcript（文字記錄）。
- `tool/result` → 一條攜帶 `tool-result` 塊的 user 訊息。
- `user/message`（注入上下文，即非 `user` 來源）→ 按時間順序在相應位置生成一條 user-role 訊息，並原樣承載其 `content`；其類型化 source 標明生產方，並攜帶所有生產方專用資料。

其餘所有事件（`turn/*`、`step/*`、外掛程式所屬的 `llm/retry`）均為結構資訊，不會投影為訊息。token 記帳讀取每個步驟的 `assistant/chunk { type: 'usage' }` 記錄；如果沒有用量區塊，則將 `assistant/message.usage` 作為已提交步驟的後備。失敗的模型請求嘗試沒有 assistant 訊息，因此其用量區塊是持久化的記帳記錄。由於這一尚未發布的格式有意不提供相容性承諾，seed/load 校驗會拒絕沒有提供方／模型的請求標頭和 assistant 訊息，而不會猜測歷史資料應走的提供方路由。

## 活躍工作階段 fork API

`ctx.sessions.create(id, { seed, meta })` 是底層的重播/fork 原語。對於普通的活躍工作階段 fork，`SessionStore` 暴露一個策略 API：

- `fork(source, boundary?, childSessionId?)` 接受一個活躍的 `Session` 對象或活躍的 `SessionId`，選取到 `boundary` seq（含）為止的源事件（預設為當前最後一個事件），要求所選前綴結束時沒有開放輪次，然後建立一個活躍的子工作階段，包含深克隆的種子事件和子工作階段元資料（`parentSession`、`seedLength` 及繼承的 `cwd`）。

顯式 `boundary` 允許呼叫者從任意穩定的輪次間位置 fork，包括之前的 `turn/end` 或更晚的獨立純日誌事件，即使源工作階段有更新的事件或正在進行的輪次。API 拒絕結束於開放輪次內的前綴，而不是靜默截斷。更廣泛的執行關係健全性檢查留在既有的 `dsh-invariants` 外掛程式和持久化修復路徑中，不在 `fork()` 中重複。`dsh-subagent-fork-in-process` 保留其已完成前綴截斷邏輯，因為工具呼叫時的委託通常在父輪次仍然打開時啟動；普通的工作階段分支應顯式指定請求的 boundary。

<a id="why-a-turn-ended-turnendreasonmap"></a>

## 輪次的結束原因：`TurnEndReasonMap`

`turn/start` 沒有 trigger 欄位。已進入的 `user/message` 批次記錄進入每個步驟的內容，`llm/retry` 記錄請求復原，idle 注入則保持待處理，直到喚醒交付抵達後續 pre-step。即時輪次會保留停止驅動程式器的類型化 [`AgentCancelCause`](core.md#the-agent-handle)；只有在匯入受支持的粗粒度取消記錄且記錄未保存呼叫方時，持久化才使用額外的 `{ kind: 'legacy' }` 原因。

```ts type-equiv
/** Durable cancellation cause, including imports whose original coarse record carried no cause. */
type TurnEndCancelCause = AgentCancelCause | { readonly kind: 'legacy' }
```

```ts type-equiv
/**
 * Why a turn ended. Merge-extensible sum type.
 */
interface TurnEndReasonMap {
  completed: { kind: 'completed' }
  /** A cancellation request interrupted the live turn. */
  aborted: { kind: 'aborted'; reason: TurnEndCancelCause }

  blocked: { kind: 'blocked' }
  /**
   * The turn failed. `error` is always a structured failure: the `LlmError`
   * facts verbatim, or `{ message: errorChain(error), code: 'UNKNOWN' }`
   * flattened from any other error.
   */
  error: { kind: 'error'; error: LlmFailure }
  /** At least one step reached its output-token ceiling, even if a plugin continued the turn. */
  'max-tokens': { kind: 'max-tokens' }
  /**
   * A persistence backend closed a crash-orphaned turn on reload. The loop never
   * emits this marker, and the events recorded before the crash remain intact.
   */
  interrupted: { kind: 'interrupted' }
}
```

`max-tokens` 與模型呼叫中同名的 `FinishReason` 對應：只要輪次內有任何步驟以 `max-tokens` 結束，整個輪次就以 `max-tokens` 而不是 `completed` 結束（即使之後繼續執行，截斷事實仍優先），讓消費端能夠區分正常停止和截斷停止。取消和錯誤仍是不同的結果。`interrupted` 是唯一不會由任何 loop 寄出的原因：它由當機復原合成（見 [persistence.md](persistence.md)）。該 map 可透過合併擴充。

## 執行封閉與獨立事件

一個輪次包圍一次模型迴圈執行，而不是整個工作階段日誌。AgentLoop 只會在輪次內進入 pre-step 批次時記錄注入的 `user/message` 事件；外掛程式所屬的純日誌事件仍可出現在 `turn/end` 與下一個 `turn/start` 之間，佔用事件 seq 但不遞增輪次編號。持久化會將每個連續且已接受的事件納入有界持久化批次，而崩潰修復只關閉確實仍處於開放狀態的尾部輪次。需要即時持久性屏障的生產方會顯式等待 `ctx.sessions.flush(session)`。

選填的 `dsh-session/invariant` 配套外掛程式會強制核心擁有的關係：輪次與步驟編號、執行事件封閉，以及同一步驟內的工具呼叫／結果配對。可合併擴充事件的關係由聲明它的外掛程式擁有，因此核心不會僅因沒有開放輪次就拒絕未知事件。見[獨立事件決策](../../.agents/notes/implemented/simplification/2026-07-28-remove-synthetic-log-only-turns.md)。

## 種子結束邊界：`session/end-seed`

帶種子的工作階段（復原、fork 或重播）緊接構造種子之後追加這個僅日誌事件，作為自己的第一次即時寫入。在它之前的事件具有更小的 seq，且來自種子。它是 `firstLiveSeq` 的持久投影：該欄位為持有對象的消費端回答本生命週期的寫入從哪裡開始，該事件則為只持有儲存位元組的消費端回答同一問題。payload 為空，因此位置與 `time` 承載全部含義，且不產生任何訊息。`Session` 的構造函式是唯一合法的寫入方。

顯式傳入的空種子會在 seq 0 寫入 `session/end-seed`，從而把從空日誌復原的工作階段與全新工作階段區分開來。種子本身已以 `session/end-seed` 結尾時不會重複標記，因此重新打開一個未被改動的工作階段不會每次拾起都成長日誌。應定位儲存歷史中的最後一條 `session/end-seed`，而不是假定 `firstLiveSeq` 處一定有一條：在一次沒有產生工作的拾起之後，該事件的 seq 會小於下一個生命週期的 `firstLiveSeq`。

它之所以必要，是因為種子歷史與即時工作在位元組層面完全相同，這會讓任何擁有獨立開／閉括號的外掛程式失效：一個未配對的 `compaction/start`，無論寫入方是在壓縮中途崩潰、還是此刻正在壓縮，讀起來都一樣。在 `session/end-seed` 之前的開啟標記來自構造種子，並且屬於一個已結束的生命週期，無論結束原因為何（崩潰、行程接替，或從仍在執行的父工作階段 fork 出來），因此其所有方可以視之為已死。這只覆蓋*本*工作階段繼承的括號：另一個並行存活的工作階段可能在同一段歷史上持有開放括號，而它自己的邊界在別處，因此容忍並行寫入方還需要日誌之外的存活訊號。核心寫入該邊界但不從中讀取任何內容——括號的詞彙表仍歸其所屬外掛程式，這也正是崩潰修復只關閉輪次／步驟／工具邊界而從不處理 `compaction/*` 的原因。

按真人活動排序 Session 的消費端會排除該邊界：接手 Session 不算工作，因此按日誌尾部排序會把每個打開過的 Session 頂到最前。

## 外掛程式貢獻的僅日誌事件

外掛程式可以透過 declaration merging 新增額外的 `SessionEventMap` 類型。這些是**僅日誌**事件：不是 `SurfaceEventType`（不攜帶 `surfaceOp`，不參與派生歷史）。事件所有方決定它們屬於一個開放的執行輪次，還是可以獨立位於輪次之間，並在自己的不變數配套外掛程式中強制所需關係。生成的[持久化日誌事件目錄](../persistence-catalog.md)會列出每個核心或外掛程式貢獻的事件，以及其 payload、surface 標記和聲明位置；壓縮 seam 的 `compaction/*` 語義在 [compaction.md](compaction.md) 中討論。

如果同一個外掛程式事件族中的多條事件要組裝成一個 Web Client Conversation Node，該事件族中的每條 start、update、result、resource 或 interruption 事件都必須攜帶或獨立推匯出同一個穩定業務 id。此要求只約束需要關聯的 Node 事件族，並不要求每條 Session 事件都有業務 id；Client 因此無須根據相鄰關係猜測歸屬，也無須掃描歷史。參見 [Conversation Node 實作手冊](../cookbook/adding-a-conversation-node.md)。

掛鉤橋接層的 `hook/invoked` / `hook/result` 對（來自 `@deepseek-ai/dsh-hook-protocol`）透過 `handlerId` 關聯。`UserPromptSubmit`、`PreToolUse`、`PostToolUse` 與 `Stop` 在 loop 已打開的輪次內觸發，因此其 `hook/*` 記錄天然位於輪次之內。`SessionStart` 不生成 `hook/*` 記錄，因為它在輪次 1 之前執行；其上下文會在 inbox 中保持待處理，直到喚醒交付打開一個輪次（見[掛鉤橋接 Agent Note](../../.agents/notes/implemented/feature/2026-06-30-hook-bridges.md)）。

## 持久性約定

持久化後端相依性的約定如下：持久日誌無損保存每個事件，**包括** `assistant/chunk`；`seq` 必須連續，因此不能從規範日誌中過濾區塊。後端可以為事件批次選擇自己的儲存編碼，只要 `load` 返回與追加時完全一致的事件即可（JSONL 後端預設啟用的打包區塊行就是此類編碼；見 [persistence.md](persistence.md)）。所有 `event.data` 都必須可序列化為 JSON；`Session.append` 會從源頭強制這一要求（遇到不可序列化資料時拋出），因此錯誤事件絕不會進入日誌，`session.events` 始終與後端可持久化的內容一致。新增會攜帶不可序列化資料、破壞核心執行巢狀或違反事件所有方聲明關係的事件類型，都會構成磁碟格式的破壞性變更。

消費此約定的後端見 [persistence.md](persistence.md)。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsessions--sessionstore"></a>

### `ctx.sessions` — `SessionStore`

In-memory session store (`ctx.sessions`).

Persistence is intentionally not implemented here — persistence plugins subscribe to `session/event` and flush on `session/flush` / dispose.

```ts cordis-catalog
/**
 * Create a session owned by the calling fiber: disposing that fiber stops
 * event notification and removes the session from the store. `options.seed`
 * populates the session with a copy of those events (replay/fork);
 * `options.meta` attaches creation metadata (validated absolute `cwd`, seed
 * and parent lineage, and delegation depth) as the immutable
 * {@link SessionHeader} (the store fills `version`/`id`/`createdAt`).
 *
 * For an agent whose session must be torn down IN ORDER with its loop (so the
 * loop's final events are published before the store attachment ends), do NOT use this
 * — fold the session lifecycle into the agent's own effect via
 * {@link prepare} + {@link enter} + {@link announce} (see
 * `dsh-agent-loop`'s creation transaction).
 *
 * @param id - the session id; omitted, the store mints `session-<n>`.
 * @param options - seed events and/or creation metadata for the header.
 * @returns the live session, already entered and announced.
 * @throws if a session with `id` already exists, metadata is not a plain
 *   lossless-JSON record with valid scalar fields, or `meta.cwd` is a
 *   non-absolute path (storage backends key directories off it).
 */
create(id?: SessionId, options?: CreateSessionOptions): Session

/**
 * Build a session WITHOUT entering it into the store — validate the id/cwd and
 * construct the {@link Session} (with its immutable {@link SessionHeader}).
 * Pairs with {@link enter} + {@link announce}: a caller that owns a composite
 * `ctx.effect` (the agent factory) folds the session lifecycle into that ONE
 * effect so a fiber unload tears the session + agent down as a single ORDERED
 * chain rather than as racing sibling effects — which would remove the publication hooks
 * before the driver's closing events commit, dropping them.
 *
 * @param id - the session id; omitted, the store mints `session-<n>`.
 * @param options - seed events and/or creation metadata for the header. With
 *   `seedSource: 'persistence'`, metadata and events must be fresh detached
 *   graphs whose ownership transfers to this call: they are validated and
 *   frozen in place through {@link Session.fromRestore}, so the caller must
 *   retain no mutable aliases.
 * @returns the constructed session, NOT yet in the store.
 * @throws if a session with `id` already exists, metadata is not a plain
 *   lossless-JSON record with valid scalar fields, or `meta.cwd` is a
 *   non-absolute path.
 */
prepare(id?: SessionId, options?: PrepareSessionOptions): Session

/**
 * Enter a {@link prepare}d session into the store: install the module-private
 * append publication hooks and add it to the store. Returns the DETACH
 * disposer (hooks + store removal). Does NOT emit `session/created` —
 * the caller yields this disposer inside its effect and THEN calls
 * {@link announce}, so a throwing `session/created` listener rolls the attach
 * back instead of leaking it.
 *
 * Re-checks the id for a duplicate: `prepare` and `enter` are public
 * cross-package primitives and a caller may interleave arbitrary work (or
 * another create) between them, so a stale prepared session must NOT overwrite
 * a live store entry of the same id — its detach disposer would later delete
 * the REAL session. The {@link create} convenience and the agent factory call
 * the two back-to-back so they never trip this, but the public API cannot
 * assume that.
 *
 * @param session - a {@link prepare}d session not yet in the store.
 * @returns the detach disposer (publication hooks + store removal). When called from
 *   a synchronous `session/created` listener, removal and disposal wait until
 *   that creation dispatch unwinds.
 * @throws if a session with this id is already in the store.
 */
enter(session: Session): () => void

/** Emit `session/created` exactly once for an {@link enter}ed session (with
 * the carrier {@link enter} captured). Separate from {@link enter} so the
 * caller can yield the detach disposer first (rollback safety — see
 * {@link enter}).
 * @param session - the entered session to announce to listeners.
 * @throws if the session is not live or its announcement already began,
 *   including a reentrant call from a creation listener. */
announce(session: Session): void

/**
 * Dispatch the awaited `session/flush` durability checkpoint for `session`,
 * with the carrier captured at {@link enter}. THE flush entry point: the
 * store owns the carrier, so callers (the checkpoint policy's per-request
 * barrier, goal-round-driver's idle checkpoint, teardown drains, and consumers
 * that flush themselves before reading storage) must come through here
 * rather than dispatch a raw `ctx.parallel('session/flush', …)` — one owner,
 * one spelling, and the scoped-dispatch invariant can pin it.
 * @param session - the session whose buffered events must reach durable storage.
 * @returns whether at least one durability listener participated, after every
 *   listener has settled successfully.
 * @throws the first registered listener failure after every listener settles.
 */
async flush(session: Session): Promise<boolean>

/**
 * Look up a live session.
 * @param id - the session id to look up.
 * @returns the session, or undefined when no live session has that id.
 */
get(id: SessionId): Session | undefined

/**
 * All live sessions, in creation order.
 * @returns a fresh array; mutating it does not affect the store.
 */
list(): Session[]

/**
 * Create a live child session from a stable prefix of a live source.
 * `boundary` is an inclusive source event seq; omitted means the source's
 * current last event. The selected slice may end with a between-turn event
 * but must not end inside an open turn.
 *
 * @param source - Live source session object or id.
 * @param boundary - Inclusive source event seq to fork through; omitted means
 *   the source's current last event, and omitted on an empty source forks an
 *   empty child.
 * @param childSessionId - Optional child session id; omitted delegates to
 *   `SessionStore`'s id policy.
 * @returns The created live child session.
 */
fork(source: SessionForkSource, boundary?: number, childSessionId?: SessionId): Session
```

Types: [CreateSessionOptions](persistence.md) · [PrepareSessionOptions](persistence.md) · [SessionId](core.md)

Source: [`packages/core/session/src/index.ts:792`](../../packages/core/session/src/index.ts)

<a id="session-events"></a>

### `session/*` events

<a id="sessioncreated--emit"></a>

#### `session/created` — emit

Creation announcement during session publication. A synchronous throw vetoes and rolls back with a paired disposal; detach requested during dispatch is deferred. A returned-promise rejection is logged but cannot retroactively veto this synchronous boundary. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only sessions entered through that agent's context.

```ts cordis-catalog
/**
 * Creation announcement during session publication. A synchronous throw vetoes and rolls
 * back with a paired disposal; detach requested during dispatch is deferred.
 * A returned-promise rejection is logged but cannot retroactively veto this
 * synchronous boundary.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners
 * receive only sessions entered through that agent's context.
 * @param session - the session just entered and announced.
 * @dshScopeScan unsupported
 * @mode emit
 */
'session/created'(this: Scoped<Session>, session: Session): void
```

Types: [Scoped](scope.md)

Source: [`packages/core/session/src/index.ts:54`](../../packages/core/session/src/index.ts)

<a id="sessiondisposed--emit"></a>

#### `session/disposed` — emit

Emitted once when an announced session leaves the store, including publication rollback, but never for an entry whose creation announcement did not begin. Listener failures are logged and contained. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`) reuses the owner scope.

```ts cordis-catalog
/**
 * Emitted once when an announced session leaves the store, including
 * publication rollback, but never for an entry whose creation announcement
 * did not begin. Listener failures are logged and contained.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`) reuses the owner scope.
 * @param session - the session that is no longer live in the store.
 * @dshScopeScan unsupported
 * @mode emit
 */
'session/disposed'(this: Scoped<Session>, session: Session): void
```

Types: [Scoped](scope.md)

Source: [`packages/core/session/src/index.ts:64`](../../packages/core/session/src/index.ts)

<a id="sessionevent--emit"></a>

#### `session/event` — emit

Post-commit, fire-and-forget append feed. The listener snapshot resolves before the log push, but callbacks run after it; observer failures are logged and contained without making the committed append fail. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only events from sessions entered through that agent's context.

```ts cordis-catalog
/**
 * Post-commit, fire-and-forget append feed. The listener snapshot resolves
 * before the log push, but callbacks run after it; observer failures are
 * logged and contained without making the committed append fail.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners
 * receive only events from sessions entered through that agent's context.
 * @param session - the session whose log grew.
 * @param event - the appended event, exactly as recorded.
 * @dshScopeScan unsupported
 * @mode emit
 */
'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void
```

Types: [Scoped](scope.md)

Source: [`packages/core/session/src/index.ts:76`](../../packages/core/session/src/index.ts)

<a id="sessionflush--parallel"></a>

#### `session/flush` — parallel

Awaited parallel durability checkpoint: every listener runs and the caller awaits all of them, with no waterfall veto. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`) reuses the session's owner scope.

```ts cordis-catalog
/**
 * Awaited parallel durability checkpoint: every listener runs and the
 * caller awaits all of them, with no waterfall veto. Scope-filtered dispatch
 * (`@deepseek-ai/dsh-scope`) reuses the session's owner scope.
 * @param session - the session whose buffered events must reach durable storage.
 * @dshScopeScan unsupported
 * @mode parallel
 */
'session/flush'(this: Scoped<Session>, session: Session): Promise<void> | void
```

Types: [Scoped](scope.md)

Source: [`packages/core/session/src/index.ts:85`](../../packages/core/session/src/index.ts)
<!-- END GENERATED cordis-surface -->
