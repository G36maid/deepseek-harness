# 事件系統

[English](events.md) | 繁體中文

事件是 Cordis 外掛程式間通訊的核心機制。Harness 大量使用事件來實作松耦合的擴充點。

## 基本用法

### 監聽事件

```ts ignore-check
ctx.on('event-name', (payload) => {
  // Handle the event.
})
```

### 觸發事件

```ts ignore-check
ctx.emit('event-name', payload)
```

## 事件模式

Cordis 提供多種事件模式，適用於不同的互動契約：

### emit — 廣播

所有監聽器同步執行，回傳值會被忽略：

```ts ignore-check
// Emit
ctx.emit('my-plugin/ready', { id: 'worker-1' })

// Listen
ctx.on('my-plugin/ready', ({ id }) => {
  console.log(`${id} is ready`)
})
```

### bail — 短路

監聽器按順序執行，第一個不是 `null`、`false` 或 `undefined` 的回傳值會成為最終結果：

```ts ignore-check
// Dispatch
const result = ctx.bail('some-check', input)

// Listen: a returned value stops later listeners.
ctx.on('some-check', (input) => {
  if (shouldBlock(input)) return 'blocked'
  // Return null, false, or undefined to continue to the next listener.
})
```

### serial — 順序執行

監聽器按註冊順序依次執行，並等待非同步結果；第一個不是 `null`、`false` 或 `undefined` 的回傳值會終止後續執行：

```ts ignore-check
await ctx.serial('setup-phase', context)
```

### waterfall（瀑布式事件）— 管線

每個監聽器可以包裝下游回傳值，形成處理鏈。**必須呼叫 `next()` 傳遞給下游**，不呼叫即會短路管線：

```ts ignore-check
// Dispatch
const output = await ctx.waterfall('my-plugin/transform', input, async () => input)

// Listen: next() is mandatory.
ctx.on('my-plugin/transform', async (_input, next) => {
  const downstream = await next()
  return downstream.trim()
})
```

::: warning
waterfall 監聽器**必須呼叫 `next()`**。不呼叫 `next` 會短路整個管線，這是故意為之的設計——用於實作攔截/閘道邏輯。
:::

## 類型安全的事件

Harness 使用 TypeScript 聲明合併來為事件提供類型安全：

```ts
import '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'my-plugin/ready': (payload: { id: string }) => void
    'my-plugin/check': (input: string) => boolean | undefined
    'my-plugin/transform': (input: string, next: () => Promise<string>) => Promise<string>
  }
}

// ctx.on('my-plugin/ready', ...) and ctx.emit('my-plugin/ready', ...)
// are now inferred correctly.
```

## Cordis 事件與工作階段記錄

Harness 的 Cordis 事件遵循 `namespace/action` 命名，例如 `agent/step`、`agent/request`、`agent/request-error`、`tools/result` 和 `session/event`。完整簽名與觸發模式見[子系統頁面](../../../subsystems/core.md)上生成的 `cordis-surface` 區塊。

`turn/*`、`step/*`、`tool/call`、`tool/result` 和 `compaction/*` 是持久化的工作階段事件類型，不是同名 Cordis 事件。需要觀察它們時，監聽 `session/event` 並檢查 `event.type`。

## 事件監聽器也是效果

透過 `ctx.on()` 註冊的監聽器會在外掛程式解除安裝時自動移除：

```ts ignore-check
export function apply(ctx: Context) {
  // This listener is removed when the plugin disposes.
  ctx.on('tools/result', handler)
}
```

## 示例：日誌外掛程式

這個外掛程式記錄工具呼叫和工具結果：

```ts
import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-tools'

export const name = 'tool-logger'

export function apply(ctx: Context) {
  ctx.on('tools/result', (exec, result) => {
    console.log(`[tool] ${exec.name}(${JSON.stringify(exec.arguments)})`)
    const text = result.content
      .map(block => block.type === 'text' ? block.text : '')
      .join('')
    console.log(`[tool result] ${text.slice(0, 100)}`)
  })
}
```

## 下一步

- [能力分層](../practice/) — 瞭解能力介面中的事件
- [LLM（大型語言模型）配接器](../practice/llm-adapter.md) — 實作一個完整的 LLM 後端
