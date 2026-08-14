# 工作階段投影

[English](session-projection.md) | [简体中文](session-projection.zh.md) | 繁體中文

工作階段投影 seam 是一項[能力 seam](../capability-seams.md)：領域 host 外掛程式經由它向用戶端載體供給按工作階段的日誌派生狀態的當前全量值；三方分別是 Service Definition 與登錄檔（[dsh-session-projection](../../packages/session/session-projection)，`ctx.sessionProjections`）、領域貢獻方（每個領域註冊一個純單元）與載體（[dsh-host-apiproxy](../../packages/host/apiproxy) 的歷史尾頁與 `session/projection` 推送幀）。它是一項選填能力，不屬於 agent loop（代理循環）主幹。框架負責驅動，領域負責計算：登錄檔只訂閱一次 `session/event`，並把每個已提交事件摺疊進每個單元；領域不持有任何訂閱，用戶端也從不摺疊領域事件——它們收到的是成品值。設計權威：[session-projection RFC](../../.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md)；驅動、快取與變更流約定：[包 README](../../packages/session/session-projection/README.md)。

原始碼：[`packages/session/session-projection/src/index.ts`](../../packages/session/session-projection/src/index.ts)

## 投影單元

`SessionProjectionMap` 是整條鏈路（host 側單元、協議塊、用戶端掛鉤）的 merge-extensible 類型表；值是協議層 JSON 全量值，渲染歸 slot 體系管，永遠不歸本層。領域為每個 key 貢獻一個 `ProjectionDefinition`：

```ts type-equiv
/**
 * One domain's state-driven computation unit: three pure synchronous
 * functions plus declarations — never an opaque getter. The framework drives
 * `apply` on every committed session event; the domain holds no
 * subscriptions and owns only the mathematics. All three functions MUST be
 * synchronous (an async unit would tear the carriers' consistency cut) and
 * `state` MUST be plain JSON (the persisted-cache precondition).
 */
interface ProjectionDefinition<K extends keyof SessionProjectionMap, S> {
  /** The projection key this unit owns (its `SessionProjectionMap` entry). */
  key: K
  /** Validates the wire payload (`view` output) before it leaves the host. */
  schema: ZodType<SessionProjectionMap[K]>
  /**
   * State for the empty log.
   * @returns the initial state.
   */
  init(): S
  /**
   * Pure transition: previous state + one committed event → next state. A
   * unit uninterested in an event MUST return the same state reference — an
   * unchanged reference (`Object.is`) produces zero downstream work.
   * @param state - the state covering all prior events.
   * @param event - the next committed session event.
   * @returns the next state (same reference when the event is not the unit's).
   */
  apply(state: S, event: SessionEvent): S
  /**
   * State → wire payload (the read-side projection).
   * @param state - the current state.
   * @returns the whole current value for this unit's key.
   */
  view(state: S): SessionProjectionMap[K]
  /**
   * Persisted-cache invalidation version: bump whenever the serialized state fields or the
   * fold semantics change, so persisted `(sessionId, key, ver, seq, val)`
   * rows from an older unit are discarded instead of being forward-applied
   * into garbage. Non-negative integer.
   */
  stateVersion: number
}
```

全量值事件規則是承重結構：攜帶狀態的日誌事件攜帶的是變更後的完整狀態，絕不是裸增量——這讓每次狀態轉移始終足夠廉價，也讓每個被供給的值自描述（對消費端即 last-wins）。

## 快照與變更流

```ts type-equiv
/**
 * One consistent read cut over every registered unit for one session.
 * `asOfSeq` is the shared watermark — the seq of the last event every value
 * reflects (`-1` for an empty log, mirroring `session/subscribed.lastSeq`).
 */
interface ProjectionSnapshot {
  /** Seq of the last event the values reflect; -1 for an empty log. */
  asOfSeq: number
  /** Whole current value per registered key. */
  values: Partial<SessionProjectionMap>
}
```

```ts type-equiv
/**
 * Change-feed listener: one unit's value changed for one session. `value` is
 * the schema-validated `view` output; `seq` is the unit's watermark at
 * emission (the seq of the event that caused the change).
 */
type ProjectionChangeListener = (
  session: Session,
  key: Extract<keyof SessionProjectionMap, string>,
  value: unknown,
  seq: number,
) => void
```

`snapshot(session)` 完全同步：載體在切出頁面切片的同一 tick 內讀取它，因此 `asOfSeq` 使兩次讀取使用同一個序號。每個值在返回前都會透過其單元的 schema 校驗；如果 `view` 被誤寫為非同步函式，它會返回 Promise，schema 校驗將拒絕該值。對於每個已提交事件，變更流會為每個狀態*引用*已變化的單元觸發一次；狀態未變時，`apply` 必須返回同一引用。

## 登錄檔：`ctx.sessionProjections`

`SessionProjectionRegistry`（[簽名](#ctxsessionprojections--sessionprojectionregistry)）擁有驅動權：一份 `session/event` 訂閱、對每個已註冊單元即時呼叫 `apply`，以及每工作階段每單元的水位線（watermark）cell。cell 惰性建置：在事件串流過之後才註冊的單元，或比登錄檔更早的工作階段，都在首次觸達（事件或讀取）時從 `init` 出發在記憶體日誌上摺疊。註冊是一個 effect，其 disposer 隨呼叫方 fiber 走：領域外掛程式解除安裝後，其 key（連同快取的 cell）從後續驅動與快照中消失，用戶端將其讀作能力缺失；key 重複直接 throw。領域外掛程式在 `ctx.inject(['sessionProjections'], …)` 下註冊，因此不帶登錄檔的 headless 組裝完全不受影響。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsessionprojectioncache--sessionprojectioncache"></a>

### `ctx.sessionProjectionCache` — `SessionProjectionCache`

The persisted projection cache service. Opens the `session_projcache` domain at init, checkpoints live sessions on a throttled write-behind (count/interval triggers from Config) plus two mandatory points — `turn/end` and session disposal (the live-to-cold moment) — and serves the cold-read ladder: cached row, persistence `readFrom` tail, registry `restore`, durable write-back. Every durable write is fail-soft: failures log a warning and the cache self-heals on the next write or cold read.

```ts cordis-catalog
/**
 * The zero-I/O listing read: whole values viewed straight from the stored
 * rows (version-matching keys only), each cut carried with its watermark
 * so a client value store can seed under its higher-seq-wins rule — as
 * stale as the last durable checkpoint but never wrong, and never from an
 * unrelated log (the caller's header is the identity witness). Fresher
 * paths (the history tail baseline, {@link coldSnapshot}) supersede these
 * values whenever a session is actually opened.
 * @param meta - the listed session's header (identity witness; no log read).
 * @returns the cut (`asOfSeq` = lowest served-row watermark), or
 *   `undefined` when no usable row exists for this lifecycle.
 */
cachedSnapshot(meta: SessionHeader): ProjectionSnapshot | undefined

/**
 * Durably checkpoint one live session NOW (both mandatory points call
 * this; tests and carriers may too). The registry cut is snapshotted at
 * this boundary (states are live references), then the whole record is
 * replaced. NOT fail-soft — callers on the fail-soft paths contain it.
 * @param session - the live session to checkpoint.
 * @returns resolution after durability and event emission.
 */
async write(session: Session): Promise<void>

/**
 * Cold-read one persisted session's projections with zero full-log load:
 * cached rows + a persistence `readFrom` tail from the registry's restore
 * floor, refolded by the registry and written back (fail-soft) so the next
 * cold read starts closer. A cache row invalidated by a shrunk log
 * (crash-repair truncation) triggers one full re-read from seq 0 — the
 * ladder's slow rung, still no crash. Rejects when the session has no
 * persisted log (`not found` from the persistence seam).
 * @param id - the persisted session to read.
 * @param signal - optional cancellation for the persistence reads.
 * @returns the snapshot cut at the stored log end.
 */
async coldSnapshot(id: SessionId, signal?: AbortSignal): Promise<ProjectionSnapshot>
```

Types: [Session](session.md) · [SessionHeader](persistence.md) · [SessionId](core.md)

Source: [`packages/session/session-projection-cache/src/index.ts:71`](../../packages/session/session-projection-cache/src/index.ts)

<a id="ctxsessionprojections--sessionprojectionregistry"></a>

### `ctx.sessionProjections` — `SessionProjectionRegistry`

`ctx.sessionProjections`: the projection unit table and its drive. The service subscribes to `session/event` once; every committed event passes every registered unit's `apply` (eager drive), and a changed state reference notifies the change feed with the schema-validated view. Cells build lazily — a unit registered after events flowed, or a session older than the registry, folds `init` over the in-memory log on first touch (event or read). Registration is an effect (disposer rides the calling fiber): an unloaded domain plugin's key disappears from snapshots and clients read it as capability absence. Domain plugins register under `ctx.inject(['sessionProjections'], …)` so headless assemblies without the registry stay unaffected. Registrants sharing a key share one unit and are counted: the same tool package mounted in N agent presets registers N times, and the key survives until the last one unloads.

```ts cordis-catalog
/**
 * Register one domain's unit. The registration is an effect on the calling
 * context's fiber: disposing the fiber (or calling the returned disposer)
 * removes the key — and the unit's cached cells — from subsequent drives
 * and snapshots.
 * @param definition - key, state schema, pure unit functions, and stateVersion.
 * @returns the exact disposer that unregisters this unit.
 */
register<K extends keyof SessionProjectionMap, S>(definition: ProjectionDefinition<K, S>): () => void

/**
 * Subscribe to the change feed. The registration is an effect on the
 * calling context's fiber.
 * @param listener - called once per unit whose state reference changed, per committed event.
 * @returns the exact disposer that unsubscribes.
 */
onChanged(listener: ProjectionChangeListener): () => void

/**
 * One consistent cut over every registered unit for one session, read from
 * the watermark cache (missing cells fold lazily over the in-memory log).
 * Fully synchronous — every value and `asOfSeq` reflect the same log
 * position. Each value passes its unit's schema before leaving.
 * @param session - the session whose projection values are read.
 * @returns the snapshot; `values` is empty when no unit is registered.
 */
snapshot(session: Session): ProjectionSnapshot

/**
 * State-level checkpoint of every registered unit for one session, read
 * from the watermark cache (missing cells fold lazily over the in-memory
 * log). This is the write side of the persisted projection cache: the
 * returned rows are the `(key → {ver, seq, val})` part of the durable
 * `(sessionId, key, ver, seq, val)`
 * rows. Every `val` is a DETACHED structured clone — never the live
 * cell reference: the watermark cache is this registry's authoritative
 * mutable state, and a caller reaching the live reference could corrupt
 * every subsequent snapshot and frame through it (plain JSON by the unit
 * contract, so the clone is total).
 * @param session - the session whose unit states are checkpointed.
 * @returns one row per registered key; empty when no unit is registered.
 */
checkpoint(session: Session): ProjectionCheckpoint

/**
 * The stored seq a {@link restore} tail read over `checkpoint` must start
 * at: one event BELOW the lowest usable watermark (a row is usable when
 * its `ver` matches the live unit's `stateVersion`; an absent or mismatched row
 * pulls the floor to `0` — that key must refold the full log). The
 * one-below anchor is load-bearing: the tail then proves how far the
 * stored log still extends, so {@link restore} can detect a log that
 * shrank below a row's watermark (crash-repair truncation) instead of
 * serving the stale row as current — an empty tail read from the anchor
 * yields an end below every watermark and the restore rejects for a full
 * re-read.
 * @param checkpoint - persisted rows for one session (possibly stale or empty).
 * @returns the seq to hand the persistence `readFrom`, or `undefined`
 *   when no unit is registered (no read needed — {@link restore} would
 *   serve empty values regardless).
 */
restoreFloor(checkpoint: ProjectionCheckpoint): number | undefined

/**
 * View a checkpoint's rows without any log read: for every registered
 * unit whose row's `ver` matches, serve the schema-validated
 * `view` of the stored state; mismatched or absent rows leave their key
 * absent (a cold or listing consumer treats it as not-yet-available and a
 * fuller read path refolds it). The zero-I/O rung of the read ladder —
 * values are as stale as their rows, never wrong.
 * @param checkpoint - persisted rows for one session (possibly stale or empty).
 * @returns whole values per key with a usable row; empty when none.
 */
viewCheckpoint(checkpoint: ProjectionCheckpoint): Partial<SessionProjectionMap>

/**
 * Cold read: fold every registered unit over a stored log suffix, seeding
 * each from its checkpoint row when usable — the one read recipe (cached
 * state + forward tail replay + `view`) applied without a live `Session`.
 * Call with the events returned by a persistence
 * `readFrom(id, restoreFloor(checkpoint))` and that same floor as
 * `baseSeq`; the floor's one-below anchor makes the supplied end honest,
 * so a shrunk log is detected here. A row is usable iff its
 * `ver` matches the live unit's `stateVersion`, it does not predate `baseSeq`
 * (`seq >= baseSeq - 1`), and it does not claim events past the
 * supplied end (`seq <= endSeq`); an unusable row is discarded
 * and its key refolds from `init` — which is only sound over the full
 * log, so a discarded row with `baseSeq > 0` throws (the caller re-reads
 * from seq 0, e.g. after a crash-repair truncation shrank the log below
 * a row's watermark).
 * @param checkpoint - persisted rows for one session (possibly stale or empty).
 * @param events - the stored events with `seq >= baseSeq`, in seq order.
 * @param baseSeq - the seq `events` starts at (its first event's seq when non-empty).
 * @returns the snapshot cut at the supplied log end (`asOfSeq` is the last
 *   supplied event's seq, `baseSeq - 1` for an empty tail) plus the
 *   refreshed checkpoint rows at that cut, ready for a durable write-back.
 */
restore(checkpoint: ProjectionCheckpoint, events: readonly SessionEvent[], baseSeq: number): { snapshot: ProjectionSnapshot; checkpoint: ProjectionCheckpoint }
```

Types: [Session](session.md) · [SessionEvent](session.md)

Source: [`packages/session/session-projection/src/index.ts:171`](../../packages/session/session-projection/src/index.ts)
<!-- END GENERATED cordis-surface -->
