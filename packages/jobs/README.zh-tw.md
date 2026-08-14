# jobs/：背景工作能力家族

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

本家族為長時間執行的工具提供一套按所有者隔離的背景工作協議，用於觀察、取消、等待和完成通知。

| 包 | 職責 | ctx 鍵 |
|---|---|---|
| [`jobs/`](jobs/README.md) | 定義任務登錄檔和生命週期約定 | `ctx.jobs` |
| [`jobs-local/`](jobs-local/README.md) | 實作行程本機任務登錄檔 | 註冊到 `ctx.jobs` |
| [`tool-jobs/`](tool-jobs/README.md) | 向模型公開任務控制和完成通知 | 註冊到 `ctx.tools` |

參見[背景工作執行時期](../../.agents/notes/implemented/architecture/2026-06-20-generic-long-running-tool-runtime.md)和[任務登錄檔](../../.agents/notes/implemented/architecture/2026-07-26-job-registry-seam.md)決策。

子系統參考文件——id 方案、所有者隔離約定、快照——見 [docs/subsystems/jobs.md](../../docs/subsystems/jobs.md)；設計見[背景工作執行時期](../../.agents/notes/implemented/architecture/2026-06-20-generic-long-running-tool-runtime.md)與[任務登錄檔約定](../../.agents/notes/implemented/architecture/2026-07-26-job-registry-seam.md)兩篇 Agent Note。
