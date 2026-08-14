# core/ — 產品 API 主幹

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

構成 harness 默認控制主幹的工作階段日誌、系統提示詞組裝、工具登錄檔、agent（代理）詞彙、部署默認模型選擇和具體迴圈。這些是**產品**包，即外掛程式和消費端建置所相依性的穩定介面。

| 包 | 職責 | ctx key |
|---|---|---|
| [`scope/`](scope/README.md) | 作用域上下文註冊原語 | 庫，不使用 ctx key |
| [`session/`](session/README.md) | 事件溯源工作階段日誌和記憶體儲存 | `ctx.sessions` |
| [`system-prompt/`](system-prompt/README.md) | 提示詞和工具 schema 組裝登錄檔 | `ctx.systemPrompt` |
| [`tools/`](tools/README.md) | 作用域工具登錄檔和執行管線 | `ctx.tools` |
| [`agent/`](agent/README.md) | Agent 介面、登錄檔和事件詞彙 | `ctx.agents` |
| [`agent-default-model/`](agent-default-model/README.md) | 各 Agent 入口共享的默認模型選擇 | `ctx.agentDefaultModel` |
| [`agent-loop/`](agent-loop/README.md) | 默認具體 agent 驅動程式器 | `ctx.agentLoop` |

`scope` 提供共享作用域原語。`agent` 負責公開約定，`agent-loop` 是其默認實作；擴充外掛程式相依性該 seam，從而保持驅動程式器可替換。`agent-default-model` 負責部署選擇，Agent 入口僅在工作階段自身沒有選擇時使用它。

可執行組合屬於 [`examples/agent-spine-demo`](../examples/agent-spine-demo/README.md)；該分組只負責可替換的主幹元件。

子系統參考——逐包迴圈圖、`Agent` 控制代碼及其投遞／攔截約定——見 [docs/subsystems/core.md](../../docs/subsystems/core.md)；默認可執行組合是 [`examples/agent-spine-demo`](../examples/agent-spine-demo/README.md)。
