# 3. 服務

[English](03-services.md) | 繁體中文

**服務**是一個外掛程式提供、其他外掛程式透過 `ctx` 消費的具名能力。在 harness 中，`ctx.tools`、`ctx.llm` 和 `ctx.agents` 都是服務。消費端只指定 `'tools'` 之類的能力，而不匯入其提供方，因此設定可以選擇提供方，無需修改消費端。

## 提供服務

建立 `greeter.ts`，將它放在 `tmp/cordis-tutorial` 中：

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    greeter: GreeterService
  }
}

export class GreeterService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'greeter')
  }

  greet(who: string) {
    return `Hello, ${who}!`
  }
}

export const name = 'greeter'

export function apply(ctx: Context) {
  ctx.plugin(GreeterService)
}
```

兩部分協同工作：

- **執行時期**：`super(ctx, 'greeter')` 以名稱 `greeter` 註冊該實例。此後，任何外掛程式都可以透過 `ctx.greeter` 訪問它。註冊屬於 effect，解除安裝提供方時會移除該服務。
- **編譯時**：`declare module '@deepseek-ai/cordis'` 塊使用 TypeScript 聲明合併，把 `greeter` 加入 `Context` 介面，使 `ctx.greeter` 在各處都能透過型別檢查。它不會生成程式碼；沒有該聲明時，服務在執行時期仍能工作，但消費端會失去類型安全。

`Service` 子類本身就是外掛程式（第 1 章介紹的類形態），因此 `ctx.plugin(GreeterService)` 會像掛載其他外掛程式一樣掛載它。

## 使用 `inject` 消費服務

建立 `consumer.ts`：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'consumer'
export const inject = ['greeter']

export function apply(ctx: Context) {
  console.log(ctx.greeter.greet('world'))
}
```

`inject` 列出該外掛程式需要的服務。Cordis 會讓外掛程式保持 PENDING，直到列出的每項服務都存在，因此在 `apply` 內可以保證 `ctx.greeter` 已經就緒。`cordis.yml` 中的載入順序無關緊要：決定外掛程式何時啟動的是相依性關係，而不是文件順序。

組合並執行：

```yaml
- name: './greeter.ts'
- name: './consumer.ts'
```

```
Hello, world!
```

交換 `cordis.yml` 中兩行的順序後重新執行，輸出仍然相同。嘗試徹底移除 `./greeter.ts`：消費端會保持 PENDING，不輸出任何內容，既不崩潰，也不會只執行一部分。處於 PENDING 的 fiber 也不會讓 Node 的事件迴圈保持活躍，因此如果組閤中沒有其他執行項，行程會靜默地以狀態碼 0 退出。[第 6 章](06-composition-and-hmr.md)介紹如何診斷這種狀態。

## 載入後仍會跟蹤相依性關係

`inject` 並非一次性的啟動檢查。如果應用執行期間所需服務消失，例如提供方被解除安裝或熱替換，每個相依性外掛程式也會隨之解除安裝，並在服務復原後再次載入。結合 effect（[第 2 章](02-lifecycle-and-effects.md)），這能防止執行中的消費端保留對不可用服務的引用：相依性消失時，它自己的註冊也會撤銷。

這也是設定中可以替換服務的原因：解除安裝 Cordis 設定項 `dsh-bash-local`，掛載另一個 `shell` 提供方，所有注入 `'shell'` 的外掛程式都會重新啟動並使用新實作。

## 選填相依性

`inject` 用於硬性相依性。如果某項功能缺失時外掛程式仍可執行，請跳過 `inject`，並在使用處探測：

```ts ignore-check
export function apply(ctx: Context) {
  // undefined when no provider is loaded; the plugin still runs.
  const greeter = ctx.get('greeter')
  console.log(greeter?.greet('maybe') ?? 'no greeter available')
}
```

## 命名

每個應用中的服務名稱共用一個扁平命名空間。請為自有服務新增有辨識度的前綴或命名空間（harness 已佔用 `tools` 和 `llm` 等普通名稱）；[子系統頁面](../subsystems/core.md)上生成的 `cordis-surface` 區塊列出 harness 註冊的每個名稱。

下一章：[事件](04-events.md)：無需共享服務即可通訊。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
