# 能力的三種角色設計

[English](index.md) | [简体中文](index.zh.md) | 繁體中文

本文分為兩部分：先參考三種角色能力模式的概念，再透過進階教學建置一項能力。請先完成[基礎外掛程式路徑](../basic/)和[服務教學](../framework/service.md)。

## 概念參考

當一項能力足夠通用，需要支援可替換的提供方時（例如 Bash 執行），harness 會區分三種角色：**Service Definition**、**Service Provider** 和 **Consumer**。角色需要獨立演進或替換時，將它們放入不同包；否則一個包可以承擔多個角色。完整能力構成其 seam。任何單一角色都不是 seam。

## 以 Bash 為例

以 Bash 執行能力為例：

- **Service Definition** (`dsh-shell`)：定義 Cordis 服務以及 Bash 請求和結果類型
- **Service Provider** (`dsh-bash-local`)：在本機電腦上執行命令
- **Consumer** (`dsh-tool-bash`)：將該能力公開為模型可呼叫的工具

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│  dsh-shell   │────▶│  dsh-bash-local  │     │ dsh-tool-bash│
│(definition) │     │    (provider)     │     │(consumer/tool)│
└─────────────┘     └──────────────────┘     └──────────────┘
       ▲                                            │
       └────────────────────────────────────────────┘
                    inject: ['shell']
```

## 拆分的好處

### 提供方可替換

同一個 Service Definition 可以有多個提供方，可透過 `cordis.yml` 選擇：

```yaml
# Local execution
- name: '@deepseek-ai/dsh-bash-local'

# Replace this row with another package that provides the same service.
```

更換提供方時，Service Definition 和工具均保持不變。

### 獨立演進

- 呼叫方開始相依性 Service Definition 的約定後，Service Definition 很少改動。
- Service Provider 可以獨立最佳化效能和安全性。
- Consumer 可以調整能力向模型呈現的方式。

### 相依性解耦

- Service Provider 相依性 Service Definition。
- Consumer 相依性 Service Definition。
- Service Provider 和 Consumer **互不相依性**。

當前內建系列及其包連結由[能力 seam 參考](../../../capability-seams.md)負責。

## 教學：開發三種角色的能力

### 第一步：編寫 Service Definition

```ts ignore-check
// packages/my-cap/my-cap/src/index.ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    myCap: MyCapService
  }
}

export abstract class MyCapService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'myCap')
  }

  /** Execute the capability. */
  abstract execute(request: MyCapRequest): Promise<MyCapResult>
}

export interface MyCapRequest {
  input: string
}

export interface MyCapResult {
  output: string
}
```

### 第二步：編寫 Service Provider

```ts ignore-check
// packages/my-cap/my-cap-local/src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import { MyCapService, type MyCapRequest, type MyCapResult } from '@deepseek-ai/dsh-my-cap'

class MyCapLocal extends MyCapService {
  async execute(request: MyCapRequest): Promise<MyCapResult> {
    // Local provider behavior.
    return { output: request.input.toUpperCase() }
  }
}

export const name = 'my-cap-local'

export function apply(ctx: Context) {
  ctx.plugin(MyCapLocal)
}
```

### 第三步：編寫消費端

```ts ignore-check
// packages/my-cap/tool-my-cap/src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-my-cap'
export const inject = ['tools', 'myCap']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'my_cap',
    description: 'Execute my capability.',
    parameters: {
      input: { type: 'string', required: true },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const result = await ctx.myCap.execute({ input: args.input })
      return result.output
    },
  }))
}
```

### 在 cordis.yml 中組合

```yaml
- name: '@deepseek-ai/dsh-my-cap-local'
- name: '@deepseek-ai/dsh-tool-my-cap'
```

## 設計要點

- **不要預防性拆分**：只有角色需要獨立演進時，才使用不同包。簡單的工具外掛程式無需拆分。
- **Service Definition 擁有 Request/Result 類型**：Service Provider 和 Consumer 只相依性 Service Definition 包。
- **顯式優於隱式**：實作應透過顯式的 `resolve(request): Spec` 步驟處理預設值，而不是在 `run()` 中隱藏 `?? default`。

## 下一步

- [LLM（大型語言模型）配接器](./llm-adapter.md)：實作一個 LLM 提供方
