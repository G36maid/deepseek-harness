# test-support/：開發和測試基礎設施

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

這些包為倉庫開發、測試和示例提供支援，而不是產品 API。其相容性取決於所服務的開發需求。

| 包 | 職責 |
|---|---|
| [`acp-snapshot/`](acp-snapshot/README.md) | 提供 ACP（Agent Client Protocol）快照測試工具包 |
| [`agent-loop-testkit/`](agent-loop-testkit/README.md) | 為 AgentLoop 測試掛載共享先決條件 |
| [`invariants/`](../runtime-diagnostics/invariants/README.md) | 執行開發期執行時期約定斷言 |
| [`loader-smoke/`](loader-smoke/README.md) | 啟動由 Loader 組合的應用以執行冒煙測試 |
| [`llm-mock-server/`](llm-mock-server/README.md) | 提供確定性的 OpenAI 相容故障伺服器 |
| [`llm-replay/`](llm-replay/README.md) | 為無金鑰測試和示範重播已記錄的模型回應 |

當一個包獲得產品約定和產品消費端時，它會移出 `test-support/`。

不變式約定記錄在 [docs/subsystems/invariants.md](../../docs/subsystems/invariants.md)。
