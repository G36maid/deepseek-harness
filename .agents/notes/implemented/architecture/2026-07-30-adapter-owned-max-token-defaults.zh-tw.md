# Agent Note: 配接器持有的最大 token 預設值

Status: implemented

[English](2026-07-30-adapter-owned-max-token-defaults.md) | [简体中文](2026-07-30-adapter-owned-max-token-defaults.zh.md) | 繁體中文

## Problem

LLM（大型語言模型）配接器可以序列化顯式的 `GenerateOptions.maxTokens`，但無法透過 Cordis 設定建立可重建的對話預設值。僅在提供方序列化中應用回退，會導致協議請求與持久 `request/header` 不一致；若將各提供方預設值都放進 agent loop（代理循環），則會把部署與模型策略轉移到提供方無關的驅動器中。

## Decision

`LlmResolvedModelInfo.defaultMaxTokens` 攜帶一條確切提供方／模型路由的選填單次請求輸出上限，該值由配接器設定。`LlmRuntime` 將其校驗為正的安全整數，並且僅在呼叫方省略值時才填入 `LlmCallConfig.maxTokens`。準備後的呼叫會將已填入的 `maxTokens` 和 `reasoningEffort` 欄位標記為配接器預設值；顯式請求值或 agent 選項不帶該標記，因此優先且不會被自動調整。

agent loop 仍在記錄 `request/header` 前準備呼叫，因此生效設定和標明哪些欄位由配接器預設值填入的標記，會在分派前成為持久請求事實。下一次 `agent/request` waterfall（瀑布式事件）前，agent loop 會從提議中移除帶標記欄位，隨後精確模型解析會再次填入當前路由的預設值。因此，切換提供方／模型不會把前一個配接器的預設值誤當成顯式覆蓋，而顯式對話值則會保留。直接呼叫 `LlmRuntime.stream()` 時，也會在最終配接器邊界解析同一預設值。該欄位是請求預設值，而非模型輸出硬上限；沿用提供方自有預設值的配接器會省略它。

原生 DeepSeek 配接器在 Cordis 設定中公開 `maxTokens`，預設值為 256,000 token，並將生效值對映為 `max_tokens`。其默認上下文容量為 1,000,000 token：兩個內建 V4 設定項均公佈這一精確容量；不含容量的已設定項和未列出的原樣傳遞 id 則繼承同一個配接器級回退值。

## Alternatives considered

**僅在 DeepSeek 序列化中應用預設值。** 不予採納，因為提供方協議會包含持久請求 header 中缺失的模型可見值。

**在每個已發布應用中設定 `AgentOptions.maxTokens`。** 不予採納，因為應用會重複配接器部署策略，直接 LLM 呼叫的行為將不同，而且選擇另一個提供方後仍會保留 DeepSeek 專用上限。

**將 256,000 表示為每模型硬上限。** 不予採納，因為設定值是所需請求預算，無法證明每個已設定端點都會拒絕更大的輸出。顯式呼叫方仍具有最終決定權。

**由提供方預設值控制。** 對原生 DeepSeek 部署不予採納，因為產品要求各相容端點都採用穩定的 256,000 token 對話預算。

## Consequences

DeepSeek 對話默認傳送 `max_tokens: 256000`，工作階段請求 header 會記錄該值，並記錄該值由配接器提供。部署可以透過 `llm-deepseek.config.maxTokens` 更改配接器預設值；每個 agent 和每次請求的值都會覆蓋它。更改路由會重新填入新路由精確匹配到的配接器預設值，而不是繼續沿用 DeepSeek 派生出的值。其他配接器會保留現有行為，直至主動公佈 `defaultMaxTokens`。

對於預分配請求輸出的端點，256,000 token 的輸出預算會佔用 1,000,000 token 上下文中的很大部分。如果部署使用的 gateway 或模型僅支持較小預算，則必須調低 `maxTokens`；顯式設定優於無文件說明的提供方回退值。
