<!-- 英文原始檔由 scripts/gen-cordis-catalog.ts 生成；本中文文件是透過雙語配對維護的經評審對側。
     更新時先執行 `pnpm run gen-cordis-catalog` 更新英文，再更新本文件並執行 `pnpm run verify-translation-pairing --write docs/cordis-api/registry.md` 重新記錄配對。 -->

# 登錄檔

[English](registry.md) | [简体中文](registry.zh.md) | 繁體中文

外掛程式載入與相依性注入。

### ctx.inject(deps, callback)

```ts cordis-catalog
/**
 * Run a callback once the requested services are available.
 *
 * Shorthand for `ctx.plugin({ inject, apply: callback })`: the callback
 * is unloaded and re-run whenever a required service changes.
 *
 * @param deps — required services, as an array or a name → config map.
 * @param callback — plugin body called with `(ctx, config)`.
 * @returns the fiber; awaiting it settles once loading finished.
 */
inject(deps: Inject, callback: Plugin.Function<void>): Fiber & PromiseLike<Fiber>
```

請求的服務可用後，執行回呼。

這是 `ctx.plugin({ inject, apply: callback })` 的簡寫形式：每當某個必需服務發生變化時，系統都會解除安裝並重新執行該回調。

- `deps`：必需服務，形式可以是陣列，也可以是從名稱到設定的對映。
- `callback`：以 `(ctx, config)` 呼叫的外掛程式主體。

**返回** fiber；對其執行 await 會在載入完成後結束等待。

[原始碼](../../vendor/cordis/src/registry.ts#L176)

### ctx.plugin(plugin, ...args)

```ts cordis-catalog
/**
 * Load a plugin in the current context.
 *
 * @param plugin — a function, class, or `{ apply }` object plugin.
 * @param args — the plugin config, validated against its `Config` schema.
 * @returns the fiber; awaiting it settles once loading finished
 * (rejecting on config or startup errors).
 */
plugin<P extends Plugin>(plugin: P, ...args: Spread<GetPluginConfig<P>>): Fiber & PromiseLike<Fiber>
```

在當前上下文中載入外掛程式。

- `plugin`：函式、類或 `{ apply }` 對象形式的外掛程式。
- `args`：外掛程式設定，會根據其 `Config` schema 進行校驗。

**返回** fiber；對其執行 await 會在載入完成後結束等待（如果發生設定錯誤或啟動錯誤，則會被拒絕）。

[原始碼](../../vendor/cordis/src/registry.ts#L185)

## Plugin

支援的外掛程式入口點形式。

```ts cordis-catalog
/** Supported plugin entrypoint shapes. */
type Plugin<T = any> =
  | Plugin.Function<T>
  | Plugin.Constructor<T>
  | Plugin.Object<T>

/** Types associated with plugin entrypoints and runtime records. */
namespace Plugin {
  /** Shared metadata understood by the plugin registry and related tooling. */
  export interface Base<T = any> {
    /** Display name used for fiber diagnostics and logger names. */
    name?: string
    /** Standard-schema validator applied to config before the plugin starts. */
    Config?: StandardSchemaV1<any, T>
    /** Services the plugin requires; it only loads while all are available. */
    inject?: Inject
    /** Service name(s) the plugin provides (read by `Service` and by loaders). */
    provide?: string | string[]
    /** Service names whose intercept config the plugin declares it consumes. */
    intercept?: Dict<boolean>
  }

  export interface Transform<S, T> {
    /** Marks the transform object as a schema/config transform. */
    schema?: true
    /** Convert user-facing config to runtime config. */
    Config: (config: S) => T
  }

  /** Function plugin called with `(ctx, config)`. */
  export interface Function<T = any> extends Base<T> {
    (ctx: Context, config: T): any
  }

  /** Class plugin constructed with `(ctx, config)`. */
  export interface Constructor<T = any> extends Base<T> {
    new (ctx: Context, config: T): any
  }

  /** Object plugin with an `apply(ctx, config)` method. */
  export interface Object<T = any> extends Base<T> {
    apply(ctx: Context, config: T): any
  }

  /** Mutable registry record shared by all fibers of one plugin callback. */
  export interface Runtime {
    /** Display name copied from the first registered plugin shape. */
    name?: string
    /** Every live fiber of this plugin (one per `ctx.plugin()` call). */
    fibers: DisposableList<Fiber>
    /** The executable entrypoint all fibers share (registry identity key). */
    callback: globalThis.Function
    /** Standard-schema validator applied to each fiber's config. */
    Config?: StandardSchemaV1
  }
}
```

[原始碼](../../vendor/cordis/src/registry.ts#L92)

## Inject

外掛程式和 `@Inject` 裝飾器接受的服務相依性聲明。

陣列形式請求不帶攔截設定的服務。對象形式將每個服務名稱對映到外掛程式上下文中選填的攔截設定。

```ts cordis-catalog
/**
 * Service dependency declaration accepted by plugins and the `@Inject`
 * decorator.
 *
 * Array form requests services without intercept config. Object form maps each
 * service name to optional intercept config for the plugin context.
 */
type Inject<M = Dict> = (keyof M)[] | { [K in keyof M]?: M[K] }

/** Utilities for normalizing plugin dependency declarations. */
namespace Inject {
  /**
   * Convert array/object/class-inherited inject metadata into a plain map.
   *
   * @param inject — the declaration to normalize; `null`/`undefined` add nothing.
   * @param result — the map to fill (service name → intercept config or `null`).
   * @returns `result`.
   */
  export function resolve(inject: Inject | null | undefined, result: Dict = Object.create(null))
}
```

[原始碼](../../vendor/cordis/src/registry.ts#L19)
