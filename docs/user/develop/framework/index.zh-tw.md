# 外掛程式與生命週期

[English](index.md) | [简体中文](index.zh.md) | 繁體中文

本頁介紹 Cordis 外掛程式模型和生命週期狀態機。

## Fiber 狀態機

每個被載入的外掛程式都擁有一個 **Fiber** 作用域，其狀態如下：

```
PENDING → LOADING → ACTIVE
                 ↘ FAILED
ACTIVE → UNLOADING → DISPOSED
```

| 狀態 | 含義 |
|------|------|
| PENDING | 已聲明，但所需相依性未就緒 |
| LOADING | 相依性就緒，正在執行 `apply` |
| ACTIVE | 外掛程式執行中 |
| FAILED | `apply` 拋出例外 |
| UNLOADING | 外掛程式正在解除安裝並釋放資源 |
| DISPOSED | 已完全解除安裝 |

## 相依性驅動程式的載入

聲明瞭 `inject` 的外掛程式會等待所有必需服務就緒：

```ts ignore-check
export const inject = ['tools', 'llm']

export function apply(ctx: Context) {
  // ctx.tools and ctx.llm are ready here.
}
```

如果相依性的服務消失（例如提供方被替換時），外掛程式會被自動解除安裝（ACTIVE → DISPOSED），待服務復原後重新載入。

## 自動清理機制

透過 `ctx` 做的任何註冊，在外掛程式解除安裝時都會自動撤銷：

```ts ignore-check
export function apply(ctx: Context) {
  // Event listener: removed automatically on unload.
  ctx.on('some-event', handler)

  // Custom resource: the returned disposer runs on unload.
  ctx.effect(() => {
    const connection = createConnection()
    return () => connection.close()
  })
}
```

以下操作都會被自動追蹤和清理：
- `ctx.on(event, handler)` — 事件監聽
- `ctx.tools.register(tool)` — 工具註冊
- `ctx.llm.registerAdapter(names, adapter)` — LLM（大型語言模型）配接器註冊
- `ctx.effect(() => cleanup)` — 自訂資源

外掛程式解除安裝時，處置器按註冊順序的逆序開始呼叫，但多個非同步處置器會並行執行，不保證逐個完成。存在順序相依性的清理步驟必須放進同一個 `ctx.effect()` 返回的處置器中，由該處置器負責序列等待。

## 巢狀上下文

`ctx.plugin()` 建立子 Fiber，它繼承父上下文但有獨立的生命週期：

```ts ignore-check
export function apply(ctx: Context) {
  // Register a child plugin.
  ctx.plugin(childPlugin)

  // The child has its own Fiber and unloads with its parent.
}
```

## dispose（資源釋放）語義

當你需要提前終止一個外掛程式實例：

```ts
import type { Context } from '@deepseek-ai/cordis'

declare const ctx: Context
declare function myPlugin(ctx: Context): void

const fiber = ctx.plugin(myPlugin)

// Dispose it manually later.
await fiber.dispose()
```

`dispose` 保證：
1. 該外掛程式擁有的所有註冊均被移除
2. 它的子外掛程式也被遞迴解除安裝
3. 返回的 Promise 會在所有非同步清理完成後兌現

## HMR（熱模組替換）

透過 `cordis.yml` 載入 `@deepseek-ai/cordis-plugin-hmr` 後，修改外掛程式原始檔會觸發：

1. 解除安裝舊外掛程式（清理所有註冊）
2. 重新載入新程式碼
3. 執行新的 `apply`

因為外掛程式註冊會被自動清理，所以熱替換不會保留舊實例的註冊。

## 生命週期示例

```ts ignore-check
export function apply(ctx: Context) {
  console.log('plugin loading')

  ctx.effect(() => {
    console.log('effect registered')
    return () => console.log('effect cleaned up')
  })
}
```

載入時輸出：
```
plugin loading
effect registered
```

解除安裝時輸出：
```
effect cleaned up
```

## 下一步

- [服務與相依性](./service.md) — 讓外掛程式向其他外掛程式提供能力
- [事件系統](./events.md) — 在外掛程式之間通訊
- [Cordis 框架教程](../../../cordis-tutorial/index.md) — 在 Cordis 執行時期上逐步搭出同一套生命週期、服務與事件
