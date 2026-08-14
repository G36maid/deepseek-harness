# shell/ — bash 能力家族

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

該能力家族涵蓋規範執行器 seam、其實作、共享 shell 環境和麵向模型的工具。這些全是**產品**包。

| 包 | 職責 | ctx key |
|---|---|---|
| [`shell/`](shell/README.md) | 定義 Service Provider 與 Consumer 共享的執行器約定。 | `ctx.shell` |
| [`bash-local/`](bash-local/README.md) | 透過本機 [`subprocess`](../subprocess/README.md) 服務執行命令。 | （註冊 `ctx.shell`） |
| [`bash-sandbox/`](bash-sandbox/README.md) | 在本機執行前應用已設定的 [`sandbox`](../sandbox/README.md) 後端。 | （註冊 `ctx.shell`） |
| [`pwsh-local/`](pwsh-local/README.md) | 採用 Windows 特有的行程行為執行 PowerShell 命令。 | （註冊 `ctx.shell`） |
| [`shell-env/`](shell-env/README.md) | 提供 shell 工具共享的託管 `DSH_*` 環境。 | `ctx.shellEnv` |
| [`tool-bash/`](tool-bash/README.md) | 向模型公開 Bash 執行和背景工作整合。 | （註冊到 `ctx.tools`） |
| [`tool-pwsh/`](tool-pwsh/README.md) | 向模型公開 PowerShell 執行。 | （註冊到 `ctx.tools`） |

葉節點 `cordis.yml` 選擇一個執行器實作和所需的面向模型工具。沙盒化組合還會選擇一個 `ctx.sandbox` 提供方；[ACP（Agent Client Protocol）示例](../../examples/acp-agent/)展示一套完整接線。

子系統參考——請求/spec 詞彙、結果、後臺行程、服務與事件——見 [docs/subsystems/shell.md](../../docs/subsystems/shell.md)。
