# acp/：Agent Client Protocol 自動化

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

ACP（Agent Client Protocol）組透過該協議將 harness 中的 agent（代理）公開給程序化用戶端。它是互操作傳輸層，不是展示或人機互動層；配對的行程外 subagent *用戶端*在 [`subagent/subagent-acp`](../subagent/subagent-acp/README.md)，因為它實作的是 subagent 提供方介面。

| 包 | 職責 |
|---|---|
| [`acp/`](acp/README.md) | 僅面向自動化的 ACP 伺服器。 |

伺服器約定見 [`acp/README.md`](acp/README.md)。
