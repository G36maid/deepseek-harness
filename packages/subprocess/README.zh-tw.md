# subprocess/：子行程能力家族

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

這裡集中提供一個執行世界的共享行程基底：可執行文件尋找、具有原始或收集式 stdio 的完全明確指定的受管子行程樹，以及一項底層終端機行程原語，負責 PTY 分配、前臺行程組和提供方仍可觀察到的工作階段成員清理。命令預設值補全、shell 語義、時限、協定分幀、就緒狀態與呈現留在消費端：[bash 執行器](../shell/README.md)、[LSP 主機](../lsp/README.md)、[PTY shell 後端](../terminal/README.md)與 [ACP（Agent Client Protocol）subagent 後端](../subagent/README.md)。參見 [subprocess seam Agent Note](../../.agents/notes/implemented/architecture/2026-07-26-subprocess-seam.md)。

| 包 | ctx 鍵 | 角色 |
|---|---|---|
| [`subprocess`](subprocess/README.md)（`@deepseek-ai/dsh-subprocess`） | `ctx.subprocess` | Service Definition：可執行文件尋找、普通受管 spawn、終端機行程原語、控制代碼生命週期，以及共享的環境／輸出詞彙 |
| [`subprocess-local`](subprocess-local/README.md)（`@deepseek-ai/dsh-subprocess-local`） | 無 | 本機 Service Provider：detached 行程樹、有界收集／spill、`node-pty`、前臺／工作階段檢查、行程樹訊號傳送，以及先終止再等待結束的 dispose（資源釋放） |

即使消費端重載，行程生命週期仍由服務負責管理；消費端負責定義行程的含義（一條 bash 命令、未來的非 shell 執行器），以及決定塑造該行程的每一項預設值。

子系統參考——spawn spec、輸出讀取器、結果、`DSH_*` 環境——見 [docs/subsystems/subprocess.md](../../docs/subsystems/subprocess.md)；seam 決定見 [subprocess seam Agent Note](../../.agents/notes/implemented/architecture/2026-07-26-subprocess-seam.md)。
