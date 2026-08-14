# goal/：持久化的同工作階段目標

[English](README.md) | 繁體中文

agent 工作階段的持久目標狀態，獨立於消費它的面向模型工具與續行策略。goal 狀態是所屬工作階段日誌的一部分；消費端相依性 `dsh-goal`，絕不相依性具體的 agent loop（代理循環）。

| 包 | 職責 | ctx 鍵 |
|---|---|---|
| [`goal/`](goal/README.md) | 目標狀態與生命週期 | `ctx.goals` |
| [`goal-round-driver/`](goal-round-driver/README.md) | 同工作階段目標續行 | 無 |
| [`tool-goal/`](tool-goal/README.md) | 面向模型的目標工具 | 無 |
| [`command-goal/`](command-goal/README.md) | 面向使用者的目標命令 | 無 |

子系統參考——goal 標識、生命週期快照、啟用、變更記錄——見 [docs/subsystems/goal.md](../../docs/subsystems/goal.md)。
