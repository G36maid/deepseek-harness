<!-- 英文原始檔由 scripts/gen-cordis-catalog.ts 生成；本中文文件是透過雙語配對維護的經評審對側。
     更新時先執行 `pnpm run gen-cordis-catalog` 更新英文，再更新本文件並執行 `pnpm run verify-translation-pairing --write docs/cordis-api/fiber.md` 重新記錄配對。 -->

# Fiber

[English](fiber.md) | [简体中文](fiber.zh.md) | 繁體中文

fiber 是一個已載入的外掛程式實例，包含其生命週期狀態、經過校驗的設定以及已註冊的作用。`ctx.fiber` 是當前 fiber，`ctx.effect()` 會將呼叫委託給它。

### ctx.effect(execute, label?)

```ts cordis-catalog
/**
 * Register a cleanup-aware effect on this fiber.
 *
 * `execute` runs immediately; the disposers it produces are collected and
 * run (in reverse order) either when the returned disposer is called or
 * when the fiber unloads, whichever comes first. Calling the disposer twice
 * is a no-op. Throws `CordisError('INACTIVE_EFFECT')` if the fiber is
 * already disposed, and `TypeError` if `execute` returns an invalid shape.
 *
 * @param execute — the effect body; see {@link Effect} for accepted shapes.
 * @param label — effect label shown in `getEffects()` diagnostics.
 * @returns a disposer that tears the effect down and settles once done.
 */
effect(execute: () => SyncEffect, label?: string): Disposable<Promise<void>>
effect(execute: () => Effect, label?: string): AsyncDisposable<Promise<void>>
```

在此 fiber 上註冊一個支持清理的作用。

`execute` 會立即執行；它產生的清理函式將被收集，並在呼叫返回的清理函式或解除安裝 fiber 時按相反順序執行，以先發生者為準。重複呼叫清理函式不會產生任何效果。如果 fiber 已經 dispose（資源釋放），則拋出 `CordisError('INACTIVE_EFFECT')`；如果結構無效，則拋出 `TypeError`，表示 `execute` 返回了不受支持的結果。

- `execute`：作用主體；可接受的結構見 `Effect`。
- `label`：在 `getEffects()` 診斷資訊中顯示的作用標籤。

**返回**一個用於撤銷該作用的清理函式，並在清理完成後結帳。

[原始碼](../../vendor/cordis/src/fiber.ts#L415)

### ctx.fiber

```ts cordis-catalog
/** The fiber (plugin runtime instance) that owns this context. */
fiber: Fiber
```

擁有此上下文的 fiber（外掛程式執行時期實例）。

[原始碼](../../vendor/cordis/src/fiber.ts#L12)

## Fiber 類

單次外掛程式應用的執行時期實例。

fiber 會跟蹤 `ctx.plugin()` 返回的外掛程式上下文所對應的相依性狀態、經過校驗的設定、生命週期作用和清理操作。

[原始碼](../../vendor/cordis/src/fiber.ts#L184)

### fiber.uid

```ts cordis-catalog
/** Unique id within the registry; 0 for the root fiber, `null` once disposed. */
public uid: number | null
```

在登錄檔中的唯一 id；根 fiber 的 id 為 0，dispose 後為 `null`。

[原始碼](../../vendor/cordis/src/fiber.ts#L186)

### fiber.ctx

```ts cordis-catalog
/** The context this fiber's plugin runs in (extends the parent context). */
public readonly ctx: Context
```

此 fiber 的外掛程式執行所在的上下文（擴充自父上下文）。

[原始碼](../../vendor/cordis/src/fiber.ts#L188)

### fiber.config

```ts cordis-catalog
/** The validated plugin config (updated by `update()`). */
public config: any
```

經過校驗的外掛程式設定（由 `update()` 更新）。

[原始碼](../../vendor/cordis/src/fiber.ts#L190)

### fiber.state

```ts cordis-catalog
/** Current lifecycle state; transitions emit `internal/status`. */
public state
```

當前生命週期狀態；狀態轉換會發出 `internal/status`。

[原始碼](../../vendor/cordis/src/fiber.ts#L194)

### fiber.dispose

```ts cordis-catalog
/** Dispose this fiber: unload the plugin, then settle once cleanup finished. */
public readonly dispose: () => Promise<void>
```

dispose 此 fiber：解除安裝外掛程式，並在清理完成後結帳。

[原始碼](../../vendor/cordis/src/fiber.ts#L196)

### fiber.store

```ts cordis-catalog
/** Snapshot of required service implementations while loaded; `undefined` otherwise. */
public store: Dict<Impl> | undefined
```

載入期間所需服務實作的快照；其他情況下為 `undefined`。

[原始碼](../../vendor/cordis/src/fiber.ts#L198)

### fiber.inertia

```ts cordis-catalog
/** The in-flight load/unload transition, if one is currently running. */
public inertia: Promise<void> | undefined
```

當前正在進行的載入或解除安裝轉換；如果沒有此類轉換，則為 undefined。

[原始碼](../../vendor/cordis/src/fiber.ts#L200)

### fiber.name

```ts cordis-catalog
/** The plugin's display name, inherited from the nearest named ancestor, else `'root'`. */
get name()
```

外掛程式的顯示名稱，繼承自最近的具名祖先；如果不存在，則為 `'root'`。

[原始碼](../../vendor/cordis/src/fiber.ts#L336)

### fiber.assertActive()

```ts cordis-catalog
/**
 * Throw if the fiber has already been disposed.
 *
 * @returns nothing when the fiber is still active.
 * @throws {CordisError} `INACTIVE_EFFECT` when the fiber's uid has been cleared.
 */
assertActive()
```

如果 fiber 已經 dispose，則拋出例外。

**返回**：fiber 仍處於活動狀態時不返回任何內容。

[原始碼](../../vendor/cordis/src/fiber.ts#L351)

### fiber.effect(execute, label?)

```ts cordis-catalog
/**
 * Register a cleanup-aware effect on this fiber.
 *
 * `execute` runs immediately; the disposers it produces are collected and
 * run (in reverse order) either when the returned disposer is called or
 * when the fiber unloads, whichever comes first. Calling the disposer twice
 * is a no-op. Throws `CordisError('INACTIVE_EFFECT')` if the fiber is
 * already disposed, and `TypeError` if `execute` returns an invalid shape.
 *
 * @param execute — the effect body; see {@link Effect} for accepted shapes.
 * @param label — effect label shown in `getEffects()` diagnostics.
 * @returns a disposer that tears the effect down and settles once done.
 */
effect(execute: () => SyncEffect, label?: string): Disposable<Promise<void>>
effect(execute: () => Effect, label?: string): AsyncDisposable<Promise<void>>
```

在此 fiber 上註冊一個支持清理的作用。

`execute` 會立即執行；它產生的清理函式將被收集，並在呼叫返回的清理函式或解除安裝 fiber 時按相反順序執行，以先發生者為準。重複呼叫清理函式不會產生任何效果。如果 fiber 已經 dispose，則拋出 `CordisError('INACTIVE_EFFECT')`；如果結構無效，則拋出 `TypeError`，表示 `execute` 返回了不受支持的結果。

- `execute`：作用主體；可接受的結構見 `Effect`。
- `label`：在 `getEffects()` 診斷資訊中顯示的作用標籤。

**返回**一個用於撤銷該作用的清理函式，並在清理完成後結帳。

[原始碼](../../vendor/cordis/src/fiber.ts#L415)

### fiber.getEffects()

```ts cordis-catalog
/**
 * Return metadata for currently registered effects.
 *
 * @returns one {@link EffectMeta} tree per labeled live effect.
 */
getEffects()
```

返回當前已註冊作用的元資料。

**返回**：每個帶標籤的活動作用對應一棵 `EffectMeta` 樹。

[原始碼](../../vendor/cordis/src/fiber.ts#L568)

### fiber.await()

```ts cordis-catalog
/**
 * Wait for current lifecycle work and rethrow startup errors.
 *
 * @returns this fiber, once it has settled into a stable state.
 * @throws the config-validation or plugin-startup error, if any.
 */
async await()
```

等待當前生命週期工作完成，並重新拋出啟動錯誤。

**返回**：進入穩定狀態後的此 fiber。

[原始碼](../../vendor/cordis/src/fiber.ts#L704)

### fiber.restart()

```ts cordis-catalog
/**
 * Dispose and immediately reload this plugin with its current config.
 *
 * @returns a promise resolving once the reload settled.
 * @throws {CordisError} `INACTIVE_EFFECT` when the fiber is already disposed.
 */
async restart()
```

dispose 此外掛程式，並立即使用其當前設定重新載入。

**返回**一個在重新載入完成後兌現的 promise。

[原始碼](../../vendor/cordis/src/fiber.ts#L718)

### fiber.update(config, noSave?)

```ts cordis-catalog
/**
 * Validate and apply new config, then restart the plugin.
 *
 * Runs the `internal/update` waterfall first, so update hooks (and HMR)
 * can veto or replace the restart.
 *
 * @param config — the new raw config; validated before anything restarts.
 * @param noSave — hint for persistence hooks not to write the change back.
 * @returns the update waterfall result; the default restart returns a promise.
 * @throws when validation, an update listener, or the restarted plugin fails.
 */
update(config: any, noSave = false)
```

校驗並應用新設定，然後重新啟動外掛程式。

首先執行 `internal/update` waterfall（瀑布式事件），因此更新掛鉤（以及 HMR（熱模組替換））可以否決或取代重新啟動操作。

- `config`：新的原始設定；在任何內容重新啟動前進行校驗。
- `noSave`：提示持久化掛鉤不要寫回此變更。

**返回**更新 waterfall 的結果；默認的重新啟動操作返回一個 promise。

[原始碼](../../vendor/cordis/src/fiber.ts#L736)

## Effect

`ctx.effect()` 和外掛程式啟動所接受的作用主體結果。

可以是單個清理函式、兌現為清理函式的 promise，或生成多個清理函式的（可能為非同步的）可迭代對象。生成器作用會在每個清理函式產生時將其註冊。

```ts cordis-catalog
/**
 * Effect body result accepted by `ctx.effect()` and plugin startup.
 *
 * Either a single disposer, a promise of one, or a (possibly async) iterable
 * yielding several — generator effects register each yielded disposer as it
 * is produced.
 */
type Effect<T = any> =
  | SyncEffect<T>
  | AsyncEffect<T>
```

[原始碼](../../vendor/cordis/src/fiber.ts#L83)

## Disposable

作用返回的函式，用於在資源釋放期間釋放資源。

擁有該函式的 fiber 解除安裝時，清理函式會按註冊的相反順序執行；清理函式可以是非同步的，此時解除安裝過程會等待其完成。

```ts cordis-catalog
/**
 * Function returned by an effect to release resources during disposal.
 *
 * Disposers run in reverse registration order when the owning fiber unloads;
 * they may be async, in which case unloading awaits them.
 */
type Disposable<T = any> = () => T
```

[原始碼](../../vendor/cordis/src/fiber.ts#L74)

## EffectMeta

用於在診斷資訊中公開巢狀作用標籤的樹節點。

```ts cordis-catalog
/** Tree node used to expose nested effect labels for diagnostics. */
interface EffectMeta {
  /** Human-readable effect label, e.g. `ctx.on("event")` or `ctx.provide("name")`. */
  label: string
  /** Metadata of nested effects registered while this effect ran. */
  children: EffectMeta[]
}
```

[原始碼](../../vendor/cordis/src/fiber.ts#L96)

## CordisError

具有穩定機器可讀錯誤碼的框架錯誤。

```ts cordis-catalog
/** Framework error with a stable machine-readable code. */
class CordisError extends Error {
  /**
   * @param code — the stable error code; also the default message.
   * @param message — optional human-readable override.
   */
  constructor(public code: CordisError.Code, message?: string)
}

/** Cordis error code definitions. */
namespace CordisError {
  export type Code = keyof typeof Code

  export const Code = {
    INACTIVE_EFFECT: 'cannot create effect on inactive context',
  } as const
}
```

[原始碼](../../vendor/cordis/src/fiber.ts#L157)

## ValidationError

外掛程式設定未透過 standard-schema 校驗時拋出的錯誤。

```ts cordis-catalog
/** Error raised when plugin configuration fails standard-schema validation. */
class ValidationError extends TypeError {
  name = 'ValidationError'

  /**
   * Build the aggregated message from schema issues.
   *
   * @param issues — the standard-schema issues, one message line each.
   */
  constructor(issues: readonly StandardSchemaV1.Issue[])
}
```

[原始碼](../../vendor/cordis/src/fiber.ts#L19)
