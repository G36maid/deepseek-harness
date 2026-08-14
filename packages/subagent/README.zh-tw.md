# subagent/：subagent 能力家族

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

本家族允許一個 agent（代理）將工作委派給子 agent。多個具名提供方可在同一上下文中共存。

| 包 | 職責 | ctx 鍵 |
|---|---|---|
| [`subagent/`](subagent/README.md) | 定義提供方註冊、委派和繼續執行 | `ctx.subagents` |
| [`subagent-inprocess/`](subagent-in-process-driver/README.md) | 提供共享的行程內執行驅動程式器 | 無 |
| [`subagent-spawn-in-process/`](subagent-spawn-in-process/README.md) | 啟動全新的行程內子 agent | 註冊到 `ctx.subagents` |
| [`subagent-fork-in-process/`](subagent-fork-in-process/README.md) | 從父 agent 已完成的歷史記錄啟動行程內子 agent | 註冊到 `ctx.subagents` |
| [`subagent-acp/`](subagent-acp/README.md) | 透過 ACP（Agent Client Protocol）啟動行程外子 agent | 註冊到 `ctx.subagents` |
| [`subagent-codex/`](subagent-codex/README.md) | 啟動真實的 Codex app-server 子 agent | 註冊到 `ctx.subagents` |
| [`subagent-claude-code/`](subagent-claude-code/README.md) | 透過官方 Claude Agent SDK 啟動真實的 Claude Code 子 agent | 註冊到 `ctx.subagents` |
| [`subagent-dsh-sdk/`](subagent-dsh-sdk/README.md) | 透過 TypeScript SDK 啟動行程外 Harness 子 agent | 註冊到 `ctx.subagents` |
| [`tool-subagent/`](tool-subagent/README.md) | 向模型公開委派操作 | 註冊到 `ctx.tools` |
| [`tool-subagent-control/`](tool-subagent-control/README.md) | 向模型公開子級訊息傳送和列舉操作 | 註冊到 `ctx.tools` |
| [`tool-subagent-report/`](tool-subagent-report/README.md) | 提供從子級到父級的報告通道 | 註冊到子級作用域 |

參見有關[能力家族](../../.agents/notes/implemented/feature/2026-06-21-subagent-capability-seam.md)、[可繼續執行的子級](../../.agents/notes/implemented/feature/2026-07-21-continuable-background-subagents.md)和[控制工具](../../.agents/notes/implemented/simplification/2026-07-26-merge-subagent-control-service.md)的決策。

子系統參考——啟動請求、結果、即時執行、提供方約定、可續跑後臺子 agent——見 [docs/subsystems/subagent.md](../../docs/subsystems/subagent.md)；設計依據見 [subagent 能力 seam](../../.agents/notes/implemented/feature/2026-06-21-subagent-capability-seam.md)、[可續跑後臺 subagent](../../.agents/notes/implemented/feature/2026-07-21-continuable-background-subagents.md)與[合併 subagent 控制服務](../../.agents/notes/implemented/simplification/2026-07-26-merge-subagent-control-service.md) Agent Note。
