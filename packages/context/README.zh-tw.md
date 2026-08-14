# context/ — 請求上下文擴充

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

在不定義工具的情況下新增模型可見的請求上下文的產品外掛程式。`agent-instructions` 包含在默認 `dsh-agent-spine-demo` 組合包中，可透過組合包設定停用；`time-context`、`tmux-context` 和 `session-reference` 需主動啟用。

| 包 | 職責 | ctx key |
|---|---|---|
| [`session-reference/`](session-reference/README.md) | 其他工作階段的有界快照 | `ctx.sessionReferenceResolver` |
| [`time-context/`](time-context/README.md) | 當前時間與耗時上下文 | — |
| [`tmux-context/`](tmux-context/README.md) | tmux 位置上下文 | — |
| [`agent-instructions/`](agent-instructions/README.md) | 工作區指令上下文 | — |

工作階段引用見 [docs/subsystems/session-reference.md](../../docs/subsystems/session-reference.md)；[`agent-instructions` 決策記錄](../../.agents/notes/implemented/feature/2026-06-24-workspace-context.md)規定了其按 agent（代理）/工作階段隔離與生命週期拆分。
