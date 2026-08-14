# `@deepseek-ai/dsh-agent-loop-testkit`

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

為執行具體 `AgentLoop` 的測試共享掛載先決相依性。`mountAgentLoopTestDependencies(ctx, options?)` 按相依性順序安裝 LLM（大型語言模型）、工作階段、系統提示詞、工具和 agent（代理）服務，然後在 agent loop 掛載前返回。

呼叫方註冊配接器和選填外掛程式，使用待測設定掛載 `AgentLoop`，並 dispose（資源釋放）自己的 Context。系統提示詞和工具登錄檔設定可透過 `options` 轉發；該輔助函式不提供超出服務自有預設值的測試預設值。外掛程式載入失敗會使輔助函式呼叫被拒絕，而順序中較早啟用的服務仍歸呼叫方的 Context 所有。

```ts
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'

const ctx = new Context()

await mountAgentLoopTestDependencies(ctx)
// Register the test adapter and any optional plugins here.
await ctx.plugin(AgentLoop, { agents: [] })
```

針對注入失敗、部分拓撲、服務載入順序或服務清理的測試會直接掛載其相依性，而不使用此輔助函式。

## 模型體驗

無。該測試專用組合輔助工具既不驅動程式也不修改模型請求。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **只共享必需的先決主幹**：配接器、選填外掛程式、`AgentLoop`、agent 和 Context 清理仍由呼叫方負責，以使特定場景的掛載順序清晰可見。
