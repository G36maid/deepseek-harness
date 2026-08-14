# terminal/：持久 PTY 能力家族

[English](README.md) | 繁體中文

`PTY` 的全稱是 **Pseudo-Terminal（偽終端機）**。這項能力提供持久且限定所有者範圍的終端機工作階段，適用於需要跨工具呼叫保留狀態或使用互動式 stdin 的工作流程。PTY 是單次 bash 與檔案系統工具的補充，不會取代後兩者更嚴格的逐操作約定。

| 包 | 職責 | ctx 鍵 |
|---|---|---|
| [`pty`](terminal/README.md)（`@deepseek-ai/dsh-terminal`） | 後端登錄檔、品牌化 id、精確的 Agent 所有權、工作階段操作與等待完成的清理 | `ctx.terminals` |
| `terminal-bash`（`@deepseek-ai/dsh-terminal-bash`） | `ctx.subprocess.spawnTerminal` 之上的 shell 後端：就緒偵測、有界終端機狀態、沙盒策略與工作階段操作 | 註冊到 `ctx.terminals` |
| `tool-terminal`（`@deepseek-ai/dsh-tool-terminal`） | 6 個面向模型的工具，並為後臺傳送整合通用任務 | 註冊到 `ctx.tools` |

設計與暫緩邊界記錄在[持久 PTY Agent Note](../../.agents/notes/implemented/feature/2026-07-16-persistent-pty-sessions.md) 中。

子系統參考——id、後端/工作階段約定、傳送就緒、有界讀取——見 [docs/subsystems/terminal.md](../../docs/subsystems/terminal.md)；設計與暫緩邊界見[持久 PTY Agent Note](../../.agents/notes/implemented/feature/2026-07-16-persistent-pty-sessions.md)。
