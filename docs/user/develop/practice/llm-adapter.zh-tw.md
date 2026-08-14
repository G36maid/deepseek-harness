# LLM 配接器

[English](llm-adapter.md) | [简体中文](llm-adapter.zh.md) | 繁體中文

本文介紹如何為 Harness 接入新的模型提供方。

## 概述

LLM 配接器是一個繼承 `LlmAdapter` 並實作 `stream()` 方法的類，它會將 Harness 的提供方無關請求轉換為具體提供方的 API 呼叫，並將回應轉換回 Harness 區塊。

## 最小實作

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

class MyAdapter extends LlmAdapter {
  private apiKey: string

  constructor(apiKey: string) {
    super()
    this.apiKey = apiKey
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // 1. Convert options.messages to the provider format.
    // 2. Call the streaming API.
    // 3. Convert the response into StreamChunk values.
  }
}

export interface Config {
  apiKey: string
  providers: string[]
}

export const Config: Schema<Config> = Schema.object({
  apiKey: Schema.string().required(),
  providers: Schema.array(Schema.string()).required(),
})

export const name = 'my-llm-adapter'
export const inject = ['llm']

export function apply(ctx: Context, config: Config) {
  const adapter = new MyAdapter(config.apiKey)
  ctx.llm.registerAdapter(config.providers, adapter)
}
```

## StreamChunk 協定

`stream()` 必須按以下協定生成區塊：

```ts
import { CallId, type StreamChunk } from '@deepseek-ai/dsh-llm'

async function* exampleChunks(): AsyncIterable<StreamChunk> {
  // 1. Start each content block with block-start.
  yield { type: 'block-start', index: 0, blockType: 'text' }

  // 2. Stream text through text-delta.
  yield { type: 'text-delta', index: 0, text: 'Hello' }
  yield { type: 'text-delta', index: 0, text: ' world' }

  // 3. End each content block with block-end and the complete block.
  yield {
    type: 'block-end',
    index: 0,
    block: { type: 'text', text: 'Hello world' },
  }

  // 4. Tool-call block.
  yield { type: 'block-start', index: 1, blockType: 'tool-call' }
  yield {
    type: 'tool-call-delta',
    index: 1,
    id: CallId('call-123'),
    name: 'bash',
    argumentsDelta: '{"command":"ls"}',
  }
  yield {
    type: 'block-end',
    index: 1,
    block: {
      type: 'tool-call',
      id: CallId('call-123'),
      name: 'bash',
      arguments: '{"command":"ls"}',
    },
  }

  // 5. Token usage.
  yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 50 } }

  // 6. Finish reason.
  yield { type: 'finish', reason: { kind: 'stop' } }
  // Alternatively, { kind: 'tool-calls' } requests tool execution.
}
```

### 關鍵規則

- 每個 `block-start` 都必須有與之對應的 `block-end`。
- `index` 從 0 開始遞增，用於標識內容區塊的順序。
- `tool-call-delta` 的 `argumentsDelta` 是原始 JSON 文字的增量，可以在一個區塊中完整生成，也可以分多個區塊生成。
- `finish` 必須是最後一個區塊。
- `usage` 必須在 `finish` 之前生成。

## GenerateOptions

`stream()` 接收倉庫匯出的 `GenerateOptions`。它包含模型、配接器擁有的推理強度 ID、對話歷史、系統提示詞、工具 schema、生成參數、停止序列和中止訊號；完整欄位以 `@deepseek-ai/dsh-llm` 匯出的 TypeScript 類型為準。配接器必須將支援的欄位對映到具體 API；如果無法支援某個欄位，應拋出帶穩定 code 的 `LlmError`，不得靜默丟棄。

請覆寫 `resolveModel(provider, model, signal?)`，在一次查詢中返回確切的提供方／模型身份以及選填的 `context` 和 `reasoning` 中繼資料。推理中繼資料包含有序的不透明 ID、展示名稱，以及選填的設定預設值；請保留配接器給出的權威選填清單，包括其上游能力 API 返回的 `off`，不要將這些值提升為核心枚舉。非同步查詢必須回應該選填訊號，使取消和資源釋放程序完全靜止。服務會校驗聚合結果，並在呼叫 `stream()` 前拒絕顯式指定但不受支援的推理強度；省略 `reasoning` 表示該模型沒有選填的推理強度能力。

## 註冊配接器

```ts ignore-check
ctx.llm.registerAdapter(['my-provider'], adapter)
```

第一個參數是該配接器處理的提供方路由清單。`GenerateOptions.provider` 選擇已註冊的配接器，`GenerateOptions.model` 則傳入由配接器擁有、無需在生命週期啟動時註冊的模型 id。配接器能夠向選擇器公佈模型選項時，請覆寫 `listModels()`。

## 在 cordis.yml 中使用

```yaml
- id: my-llm
  name: './src/my-llm-adapter.ts'
  config:
    apiKey: !!js process.env.MY_API_KEY
    providers:
      - my-provider

- id: agent-loop
  name: '@deepseek-ai/dsh-agent-loop'
  config:
    agents:
      - id: main
        provider: my-provider
        model: my-model-v1
```

## 實戰參考

倉庫中包含以下兩個完整實作：

- `packages/llm/llm-deepseek/` — DeepSeek API 配接器（OpenAI 相容格式）
- `packages/llm/llm-pi-ai/` — Pi AI 配接器（不同的 API 格式）

對比這兩個已交付的配接器，可以看到同一套 harness 契約如何在不同提供方 SDK 之上實作。

## 錯誤處理

配接器應透過帶穩定 code 的 `LlmError` 拋出傳輸和協定故障；agent loop（代理循環）會保留該錯誤及其 code，用於診斷和策略處理。不要相依性普通 `Error` 被自動轉換。每個提供方 HTTP 請求還必須合併 `attributionHeaders()`，並傳遞 `options.signal`。

```ts
import {
  attributionHeaders,
  LlmAdapter,
  LlmError,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

class HttpAdapter extends LlmAdapter {
  constructor(private readonly endpoint: string) {
    super()
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...attributionHeaders(),
      },
      body: JSON.stringify({ model: options.model, messages: options.messages }),
      ...options.signal ? { signal: options.signal } : {},
    })
    if (!response.ok) {
      throw new LlmError(`Provider API error: ${response.status}`, 'PROVIDER_HTTP_ERROR')
    }
    // A real adapter parses the response and emits the complete chunk sequence.
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
```
