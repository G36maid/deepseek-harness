<!-- 英文原始檔由 scripts/gen-cordis-catalog.ts 生成；本中文文件是透過雙語配對維護的經評審對側。
     更新時先執行 `pnpm run gen-cordis-catalog` 更新英文，再更新本文件並執行 `pnpm run verify-translation-pairing --write docs/cordis-api/events.md` 重新記錄配對。 -->

# 事件

[English](events.md) | [简体中文](events.zh.md) | 繁體中文

每個上下文中都混入了事件分發 API。Harness 事件聲明及其分發模式會生成到各自所屬的[子系統頁面](../subsystems/core.md)。

### ctx.parallel(name, ...args)

```ts cordis-catalog
/**
 * Dispatch an event, running all listeners concurrently.
 *
 * @param name — the event name.
 * @param args — arguments passed to every listener.
 * @returns a promise resolving once every listener has settled.
 */
parallel<K extends keyof Events>(name: K, ...args: Parameters<Events[K]>): Promise<void>
parallel<K extends keyof Events>(thisArg: NoInfer<ThisType<Events[K]>>, name: K, ...args: Parameters<Events[K]>): Promise<void>
```

分發一個事件，並行執行所有監聽器。

- `name`：事件名稱。
- `args`：傳遞給每個監聽器的參數。

**回傳值**：一個 Promise，在所有監聽器均已完成後兌現。

[原始碼](../../vendor/cordis/src/events.ts#L44)

### ctx.emit(name, ...args)

```ts cordis-catalog
/**
 * Dispatch an event synchronously, ignoring listener return values.
 *
 * @param name — the event name.
 * @param args — arguments passed to every listener.
 */
emit<K extends keyof Events>(name: K, ...args: Parameters<Events[K]>): void
emit<K extends keyof Events>(thisArg: NoInfer<ThisType<Events[K]>>, name: K, ...args: Parameters<Events[K]>): void
```

同步分發一個事件，忽略監聽器的回傳值。

- `name`：事件名稱。
- `args`：傳遞給每個監聽器的參數。

[原始碼](../../vendor/cordis/src/events.ts#L53)

### ctx.serial(name, ...args)

```ts cordis-catalog
/**
 * Dispatch an event, awaiting listeners in order until one bails.
 *
 * @param name — the event name.
 * @param args — arguments passed to each listener.
 * @returns the first bail value (non-null, non-false, non-undefined), if any.
 */
serial<K extends keyof Events>(name: K, ...args: Parameters<Events[K]>): Promisify<ReturnType<Events[K]>>
serial<K extends keyof Events>(thisArg: NoInfer<ThisType<Events[K]>>, name: K, ...args: Parameters<Events[K]>): Promisify<ReturnType<Events[K]>>
```

分發一個事件，依次等待各監聽器，直到其中一個提前終止分發。

- `name`：事件名稱。
- `args`：傳遞給每個監聽器的參數。

**回傳值**：第一個提前終止值（非 null、非 false 且非 undefined）；如果沒有，則不返回此類值。

[原始碼](../../vendor/cordis/src/events.ts#L63)

### ctx.bail(name, ...args)

```ts cordis-catalog
/**
 * Dispatch an event, calling listeners in order until one bails.
 *
 * @param name — the event name.
 * @param args — arguments passed to each listener.
 * @returns the first bail value (non-null, non-false, non-undefined), if any.
 */
bail<K extends keyof Events>(name: K, ...args: Parameters<Events[K]>): ReturnType<Events[K]>
bail<K extends keyof Events>(thisArg: NoInfer<ThisType<Events[K]>>, name: K, ...args: Parameters<Events[K]>): ReturnType<Events[K]>
```

分發一個事件，依次呼叫各監聽器，直到其中一個提前終止分發。

- `name`：事件名稱。
- `args`：傳遞給每個監聽器的參數。

**回傳值**：第一個提前終止值（非 null、非 false 且非 undefined）；如果沒有，則不返回此類值。

[原始碼](../../vendor/cordis/src/events.ts#L73)

### ctx.waterfall(name, ...args)

```ts cordis-catalog
/**
 * Dispatch an event whose last argument is a `next` continuation.
 *
 * Each listener wraps the rest of the chain: calling `next()` invokes the
 * next listener (finally the built-in behavior); not calling it vetoes.
 *
 * @param name — the event name.
 * @param args — listener arguments; the final one is the innermost `next`.
 * @returns the outermost listener's return value.
 */
waterfall<K extends keyof Events>(name: K, ...args: Parameters<Events[K]>): ReturnType<Events[K]>
waterfall<K extends keyof Events>(thisArg: NoInfer<ThisType<Events[K]>>, name: K, ...args: Parameters<Events[K]>): ReturnType<Events[K]>
```

分發一個事件，其最後一個參數是續接執行的 `next` 回呼。

每個監聽器都會包裝呼叫鏈的其餘部分：呼叫 `next()` 會執行下一個監聽器，最終執行內建行為；不呼叫則會否決後續執行。

- `name`：事件名稱。
- `args`：監聽器參數；最後一個參數是最內層的 `next`。

**回傳值**：最外層監聽器的回傳值。

[原始碼](../../vendor/cordis/src/events.ts#L86)

### ctx.on(name, listener, options?)

```ts cordis-catalog
/**
 * Register an event listener owned by the current fiber.
 *
 * @param name — the event name to listen for.
 * @param listener — called with the dispatch arguments.
 * @param options — listener options; a boolean is shorthand for `prepend`.
 * @returns a disposer removing the listener; `true` if it was still registered.
 */
on<K extends keyof Events>(name: K, listener: Events[K], options?: boolean | EventOptions): () => boolean
```

註冊一個歸當前 fiber 所有的事件監聽器。

- `name`：要監聽的事件名稱。
- `listener`：使用分發參數呼叫的監聽器。
- `options`：監聽器選項；布林值可作為 `prepend` 的簡寫。

**回傳值**：一個用於移除監聽器的資源釋放函式；如果呼叫該函式時監聽器仍處於註冊狀態，則返回 `true`。

[原始碼](../../vendor/cordis/src/events.ts#L97)

### ctx.once(name, listener, options?)

```ts cordis-catalog
/**
 * Same as `on()`, but the listener disposes itself after its first call.
 *
 * @param name — the event name to listen for.
 * @param listener — called at most once with the dispatch arguments.
 * @param options — listener options; a boolean is shorthand for `prepend`.
 * @returns a disposer removing the listener; `true` if it was still registered.
 */
once<K extends keyof Events>(name: K, listener: Events[K], options?: boolean | EventOptions): () => boolean
```

與 `on()` 相同，但監聽器在首次呼叫後會自行註銷。

- `name`：要監聽的事件名稱。
- `listener`：使用分發參數呼叫，最多呼叫一次。
- `options`：監聽器選項；布林值可作為 `prepend` 的簡寫。

**回傳值**：一個用於移除監聽器的資源釋放函式；如果呼叫該函式時監聽器仍處於註冊狀態，則返回 `true`。

[原始碼](../../vendor/cordis/src/events.ts#L106)

## EventOptions

`ctx.on()` 和 `ctx.once()` 接受的選項。

```ts cordis-catalog
/** Options accepted by `ctx.on()` and `ctx.once()`. */
interface EventOptions {
  /** Add the listener before existing listeners for the same event. */
  prepend?: boolean
  /** Receive the event regardless of context filter checks. */
  global?: boolean
}
```

[原始碼](../../vendor/cordis/src/events.ts#L112)

## DispatchMode

事件服務使用的事件分發策略。

`emit` 執行同步監聽器但不等待它們，`parallel` 同時等待所有監聽器，`serial` 依次等待監聽器直至其中一個提前終止分發，`bail` 遇到第一個同步提前終止值時停止，`waterfall` 則圍繞最終的 `next` 回呼組合監聽器。

```ts cordis-catalog
/**
 * Event dispatch strategy used by the event service.
 *
 * `emit` runs synchronous listeners without awaiting them, `parallel` awaits
 * all listeners together, `serial` awaits them in order until one bails,
 * `bail` stops on the first synchronous bail value, and `waterfall` composes
 * listeners around a final `next` callback.
 */
type DispatchMode = 'emit' | 'parallel' | 'serial' | 'bail' | 'waterfall'
```

[原始碼](../../vendor/cordis/src/events.ts#L32)
