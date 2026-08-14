# workflow/：動態工作流程能力家族

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

本家族透過 subagent 執行由模型編寫的編排工作流程，並將通用工具與固定策略工具公開給模型。

| 包 | 職責 | ctx 鍵 |
|---|---|---|
| [`workflow/`](workflow/README.md) | 定義工作流程執行和生命週期事件 | `ctx.workflowEngine` |
| [`workflow-worker-thread/`](workflow-worker-thread/README.md) | 線上程中執行工作流程指令碼 | 註冊到 `ctx.workflowEngine` |
| [`tool-workflow/`](tool-workflow/README.md) | 向模型公開通用工作流程執行 | 註冊到 `ctx.tools` |
| [`tool-ralph/`](tool-ralph/README.md) | 公開使用全新 agent（代理）的固定 Ralph 工作流程 | 註冊到 `ctx.tools` |

worker thread 將工作流程執行與宿主事件迴圈隔離，但不構成安全邊界。參見[動態工作流程](../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md)和 [Ralph 工具](../../.agents/notes/implemented/feature/2026-07-19-fresh-agent-ralph-workflow-tool.md)決策。

子系統參考——啟動請求、`WorkflowMeta`、結果、即時執行、`workflow/*` 事件——見 [docs/subsystems/workflow.md](../../docs/subsystems/workflow.md)；決策見[動態工作流程](../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md)與 [Ralph 消費端](../../.agents/notes/implemented/feature/2026-07-19-fresh-agent-ralph-workflow-tool.md) Agent Note。
