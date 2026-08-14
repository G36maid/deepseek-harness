# llm/ — LLM 能力家族

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

LLM（大型語言模型）seam 及其提供方配接器。`llm` 包同時承擔 Service Definition 和 Consumer 角色：抽象服務、內容區塊詞彙和流式區塊組裝器。提供方配接器註冊到 `ctx.llm`。這些全是**產品**包。

| 包 | 職責 | ctx key |
|---|---|---|
| [`llm/`](llm/README.md) | LLM 服務和共享流式詞彙 | `ctx.llm` |
| [`token-meter/`](token-meter/README.md) | 可感知重播的 token 測量 | `ctx.tokenMeter` |
| [`llm-retry/`](llm-retry/README.md) | 提供方作用域的重試策略 | 監聽 `agent/request-error` |
| [`llm-deepseek/`](llm-deepseek/README.md) | 直接 DeepSeek 配接器 | 註冊到 `ctx.llm` |
| [`llm-pi-ai/`](llm-pi-ai/README.md) | 多提供方 pi-ai 配接器 | 註冊到 `ctx.llm` |

配接器在 seam 上註冊提供方路由；重試與 token 測量仍是獨立消費端。子 README 負責路由、中繼資料、重播和提供方協定細節；[LLM 架構決策](../../.agents/notes/implemented/architecture/2026-06-13-twin-llm-adapters.md)說明設計原理。

子系統參考——訊息與內容區塊、模型請求、`StreamChunk` 協定、配接器約定（adapter contract）——見 [docs/subsystems/llm-streaming.md](../../docs/subsystems/llm-streaming.md)（token 計量：[token-meter.md](../../docs/subsystems/token-meter.md)）；另見[孿生配接器](../../.agents/notes/implemented/architecture/2026-06-13-twin-llm-adapters.md)、[重播 token 計量](../../.agents/notes/implemented/architecture/2026-07-15-replay-token-meter-service.md)與[按路由模型上下文](../../.agents/notes/implemented/architecture/2026-07-20-routed-model-context-and-compaction-policy.md) Agent Note。
