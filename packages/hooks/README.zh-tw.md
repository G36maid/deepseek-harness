# hooks/ — 掛鉤橋接與共享協定

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

hooks 子系統讓使用者像使用 Claude Code 和 Codex 一樣，在生命週期節點擴充 agent（代理）：把橋接外掛程式指向現有 `hooks.json`（或設定），即可忠實執行這些外部 shell 掛鉤。規範擴充介面本身是 harness 的類型化攔截點（參見[攔截擴充點 Agent Note](../../.agents/notes/implemented/feature/2026-06-30-interception-extension-points.md)）；「原生掛鉤」只是這些擴充點上的普通 Cordis 外掛程式。這些包是把外部 shell 掛鉤協定轉換到同一介面的**橋接**，也包括它們共同相依性的共享協定庫。

| 包 | 職責 | 形態 |
|---|---|---|
| [`hook-protocol/`](hook-protocol/README.md) | 共享 shell 掛鉤協定庫 | 庫 |
| [`hooks-claude-code/`](hooks-claude-code/README.md) | Claude Code 掛鉤橋接 | 外掛程式 |
| [`hooks-codex/`](hooks-codex/README.md) | Codex 掛鉤橋接 | 外掛程式 |

共享庫負責通用協定行為；各橋接負責自身方言的事件對映。子 README 記錄這些約定。
