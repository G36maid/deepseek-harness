# plan/：plan 協作狀態

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

Plan mode 是按 agent（代理）記錄的協作狀態，而不是通用模式登錄檔或能力 seam。

| 包 | 職責 | ctx 鍵 |
|---|---|---|
| [`plan-mode/`](plan-mode/README.md) | 負責 plan mode 狀態、指引、命令和評審流程 | `ctx.planMode` |

[plan 專用協作狀態](../../.agents/notes/implemented/simplification/2026-07-22-plan-specific-collaboration-state.md)決策記錄了該家族的設計。

子系統參考——`plan/mode` 摺疊、步驟邊界刷寫、設定、退出工具——見 [docs/subsystems/plan.md](../../docs/subsystems/plan.md)；設計見[計畫專屬協作狀態](../../.agents/notes/implemented/simplification/2026-07-22-plan-specific-collaboration-state.md)。
