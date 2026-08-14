# interaction/：人機協作平面

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

人與執行中的 agent（代理）協作所經由的服務與外掛程式——提問、審批、權限預設、命令。這些是**產品**包：由使用者直接操作的真實介面。

| 包 | 職責 | ctx 鍵 |
|---|---|---|
| [`commands/`](commands/README.md) | 為互動式配接器註冊並分派使用者命令。 | `ctx.commands` |
| [`user-approval/`](user-approval/README.md) | 協調一次性審批決策。 | `ctx.approval` |
| [`permission/`](permission-presets/README.md) | 呈現並持久化面向使用者的權限預設。 | `ctx.permissionPresets` |
| [`user-questions/`](user-questions/README.md) | 定義與提供方無關的使用者問答 seam。 | `ctx.userQuestions` |
| [`tool-ask-user/`](tool-ask-user/README.md) | 向模型提供使用者問題。 | （註冊到 `ctx.tools`） |

這些包透過現有的 agent 和工作階段約定整合，而不改變迴圈。互動式應用提供具體的命令、審批和提問配接器；自動化使用 [`acp/`](../acp/README.md)，可執行的示範組合包位於 [`examples/`](../examples/README.md)。產品 [`dsh`](../../apps/cli/README.md) CLI（命令列介面）直接組合這些包。

子系統參考：[approval.md](../../docs/subsystems/approval.md)、[permission-presets.md](../../docs/subsystems/permission-presets.md)、[user-questions.md](../../docs/subsystems/user-questions.md)與 [commands.md](../../docs/subsystems/commands.md)。僅自動化的 ACP 傳輸是 [`acp/`](../acp/README.md)，SDK 的 JSON-RPC 伺服器端是 [`sdk/server`](../sdk/README.md)，共享 bin 啟動膠水是 [`boot/`](../boot/README.md)。
