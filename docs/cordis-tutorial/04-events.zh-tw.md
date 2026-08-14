# 4. 事件

[English](04-events.md) | [简体中文](04-events.zh.md) | 繁體中文

服務支持直接呼叫；**事件**讓外掛程式無需知道有哪些外掛程式正在監聽，就能寄出通知。harness 使用事件處理工具結果、模型請求和審批決定等互動。

## 聲明、寄出與監聽

建立 `stats.ts`，將它放在 `tmp/cordis-tutorial` 中。它是一項負責計數並在每次變化時寄出通知的服務：

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    stats: StatsService
  }
  interface Events {
    'stats/report'(name: string, count: number): void
  }
}

export class StatsService extends Service {
  private counts = new Map<string, number>()

  constructor(ctx: Context) {
    super(ctx, 'stats')
  }

  bump(name: string) {
    const next = (this.counts.get(name) ?? 0) + 1
    this.counts.set(name, next)
    this.ctx.emit('stats/report', name, next)
  }
}

export const name = 'stats'

export function apply(ctx: Context) {
  ctx.plugin(StatsService)
}
```

`interface Events` 合併與第 3 章的 `interface Context` 合併在事件系統中相互對應：它聲明事件名稱及其監聽器簽名，因此 `ctx.emit` 和 `ctx.on` 都具有完整類型。`namespace/action` 命名約定讓扁平的事件命名空間保持易讀。

建立 `reporter.ts`：

```ts ignore-check
import type { Context } from '@deepseek-ai/cordis'
import type {} from './stats.ts'

export const name = 'reporter'
export const inject = ['stats']

export function apply(ctx: Context) {
  ctx.on('stats/report', (name, count) => {
    console.log(`[stats] ${name} -> ${count}`)
  })
  ctx.stats.bump('tool_call')
  ctx.stats.bump('tool_call')
  ctx.stats.bump('prompt')
}
```

`import type {} from './stats.ts'` 行不會在執行時期匯入任何內容；它的作用是讓 TypeScript 看到聲明合併。組合並執行：

```yaml
- name: './stats.ts'
- name: './reporter.ts'
```

```
[stats] tool_call -> 1
[stats] tool_call -> 2
[stats] prompt -> 1
```

因為 `ctx.on()` 屬於 effect，監聽器會隨外掛程式一同消失，絕不需要手動維護 `removeListener`。

## 分發模式

`emit` 是 5 種分發模式之一。事件採用哪種模式是其約定的一部分，決定了監聽器能否回傳值、能否並行執行，以及能否彼此短路：

| 模式 | 呼叫 | 語義 |
|---|---|---|
| emit | `ctx.emit(name, ...args)` | 同步廣播；不會等待或收集返回的 promise 與值。 |
| parallel | `await ctx.parallel(name, ...args)` | 所有監聽器並行執行，並一同等待。 |
| serial | `await ctx.serial(name, ...args)` | 監聽器按順序執行並等待；第一個非 `null`/`false`/`undefined` 回傳值勝出，並停止後續監聽器。 |
| bail | `ctx.bail(name, ...args)` | serial 的同步版本。 |
| waterfall（瀑布式事件） | `ctx.waterfall(name, ...args, next)` | 環繞中介軟體，見下文。 |

每個 harness 事件都會在其所屬[子系統頁面](../subsystems/core.md)自動生成的參考文件中記錄其模式。

## waterfall：轉換或短路

waterfall 是實作攔截的模式。每個監聽器都會收到參數和一個 `next()` continuation；它可以轉換 `next()` 的回傳值，也可以不呼叫 `next()` 就直接返回，從而短路鏈條的其餘部分。Cordis 文件把後一種行為稱為否決。建立 `waterfall-demo.ts`：

```ts
import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'demo/transform'(input: string, next: () => Promise<string>): Promise<string>
  }
}

export const name = 'waterfall-demo'

export function apply(ctx: Context) {
  // Listener 1: wrap the downstream result.
  ctx.on('demo/transform', async (input, next) => {
    const downstream = await next()
    return downstream.toUpperCase()
  })

  // Listener 2: short-circuit when it owns the decision.
  ctx.on('demo/transform', async (input, next) => {
    if (input.includes('blocked')) return '** blocked **'
    return next()
  })

  void (async () => {
    console.log(await ctx.waterfall('demo/transform', 'hello', async () => 'hello'))
    console.log(await ctx.waterfall('demo/transform', 'blocked words', async () => 'blocked words'))
  })()
}
```

讓 `cordis.yml` 只指向該文件並執行：

```
HELLO
** BLOCKED **
```

按順序看第二行如何產生：監聽器 1 先執行並呼叫 `next()`，從而呼叫監聽器 2；監聽器 2 看到 `blocked` 後直接返回而不呼叫 `next()`，因此最內層默認邏輯（傳給 `ctx.waterfall` 的函式）從未執行；返回途中，監聽器 1 再把替換訊息轉換為大寫。

由此得到一項紀律：**只負責觀察或標注的 waterfall 監聽器必須呼叫 `next()`**；不呼叫就直接返回代表有意短路。如果日誌監聽器忘記呼叫 `next()`，會悄無聲息地吞掉所有下游的默認行為。這是本倉庫的常設規則（[waterfall 語義](../cordis-primer.md#cordis-waterfall-semantics)）。

harness 使用 waterfall 處理協作外掛程式可以包裝或回答的決策：[`agent/request`](../subsystems/core.md#agentrequest--waterfall) 允許外掛程式替換模型呼叫設定，[`approval/request`](../subsystems/approval.md#approvalrequest--waterfall) 允許策略代替使用者作答。

下一章：[設定](05-config.md)：來自 `cordis.yml` 的外掛程式選項。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
