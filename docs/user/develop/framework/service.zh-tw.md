# 服務與相依性

[English](service.md) | [简体中文](service.zh.md) | 繁體中文

服務是一個外掛程式向其他外掛程式公開的能力。inject 聲明外掛程式需要哪些服務。

## 什麼是服務

在 Harness 中，`tools`、`llm`、`agents` 都是服務。服務是掛載在 `ctx` 上的命名能力：

```ts ignore-check
ctx.tools    // ToolRuntime service
ctx.llm      // LLM service
ctx.agents   // Agent service
```

任何外掛程式都可以提供服務，供其他外掛程式使用。

## 使用服務

聲明 `inject` 來使用已有服務：

```ts ignore-check
export const inject = ['tools']

export function apply(ctx: Context) {
  // ctx.tools exists and is ready here.
  ctx.tools.register(/* ... */)
}
```

框架保證：在 `apply` 執行時，`inject` 聲明的服務已經全部就緒。如果服務還沒準備好，你的外掛程式會等著，不會執行。

## 提供服務

### 使用 Service 基類

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

export default class MetricsService extends Service {
  static inject = ['llm']  // A service may depend on other services.

  constructor(ctx: Context) {
    super(ctx, 'metrics')  // 'metrics' is the service name.
  }

  // Public service method.
  record(event: string, value: number) {
    // ...
  }
}
```

載入這個外掛程式後，消費端就可以透過 `ctx.metrics` 訪問它：

```ts ignore-check
export const inject = ['metrics']

export function apply(ctx: Context) {
  ctx.metrics.record('tool_call', 1)
}
```

### 類型聲明

使用 TypeScript 聲明合併讓 `ctx.metrics` 有正確類型：

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    metrics: MetricsService
  }
}

export default class MetricsService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'metrics')
  }

  record(event: string, value: number) { /* ... */ }
}
```

## 相依性的行為

### 必需相依性與選填相依性

```ts ignore-check
// Required: the plugin does not load while the service is absent.
export const inject = ['tools']

// Optional: omit inject and query with ctx.get() at the use site.
export function apply(ctx: Context) {
  const metrics = ctx.get('metrics')
  metrics?.record('plugin_loaded', 1)
}
```

### 服務消失時的行為

如果應用執行期間某項必需服務消失（例如其提供方解除安裝）：

1. 相依性它的外掛程式會自動 dispose（資源釋放）
2. 當服務重新出現時，外掛程式自動重新載入

這可以防止外掛程式呼叫已不存在的服務。

<a id="service-isolation"></a>

## 服務隔離

`cordis.yml` 支援服務隔離——同一個服務可以有多個實例，不同外掛程式組看到不同實例：

```yaml
- id: group-a
  name: '@deepseek-ai/cordis-plugin-group'
  group: true
  isolate:
    shell: true
  config:
    - name: '@deepseek-ai/dsh-bash-local'
      config:
        timeoutMs: 5000
    - name: './src/plugin-a.ts'

- id: group-b
  name: '@deepseek-ai/cordis-plugin-group'
  group: true
  isolate:
    shell: true
  config:
    - name: '@deepseek-ai/dsh-bash-local'
      config:
        timeoutMs: 60000
    - name: './src/plugin-b.ts'
```

`plugin-a` 和 `plugin-b` 各自看到自己組內的 Bash 實例，互不影響。

## Harness 內建服務

服務名、公開方法和原始碼位置由倉庫自動生成到各服務的[子系統頁面](../../../subsystems/core.md)。開發外掛程式時應以這些生成區塊和服務的 TypeScript 介面為準，不要維護另一份靜態清單。

## 下一步

- [事件系統](./events.md) — 外掛程式間松耦合通訊
- [能力分層](../practice/) — 將服務用作能力介面
