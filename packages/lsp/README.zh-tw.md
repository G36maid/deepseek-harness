# lsp/ - LSP 能力家族

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

語言伺服器能力 seam：LSP Service Definition、通用 stdio 提供方，以及面向模型的 `lsp` 工具。這些全是**產品**包。

| 包 | 職責 | ctx key |
|---|---|---|
| `lsp/` | Service Definition（按品牌化 id + 擴充名對映組織的提供方登錄檔、逐查詢選擇、詞彙、`LspError`） | `ctx.lsp` |
| `lsp-stdio/` | 基於 `ctx.fs` 與 `ctx.subprocess` 的通用多伺服器 stdio 後端（JSON-RPC、查詢時臨時打開文件） | （在 `ctx.lsp` 上註冊提供方） |
| `tool-lsp/` | 面向模型的 `lsp` 工具（四種操作、從 1 開始的 UTF-16 遊標坐標） | （註冊到 `ctx.tools`） |

Service Definition 位於 `lsp/lsp/`。該 seam 恰好公開四種語義操作：`goToDefinition`、`findReferences`、`goToImplementation`、`hover`，且不提供通用 JSON-RPC 逃生口；因此，替換提供方不會改變模型請求導覽的方式，也不會讓協議載荷或未經評審的修改進入模型約定。提供方註冊的是**能力**而非工具；`tool-lsp` 是面向模型的名稱、schema、提示詞指引和呈現的唯一 owner。

設計原理見 [LSP 能力 seam Agent Note](../../.agents/notes/implemented/architecture/2026-07-15-lsp-capability-seam.md)，其中也解釋了文件為何在每次查詢時臨時打開、stdio 主機為何使用共享的檔案系統／子行程執行環境，以及擴充名歸屬為何在同一執行時期內互斥。

子系統參考——操作、坐標、請求／結果、`LspError`——見 [docs/subsystems/lsp.md](../../docs/subsystems/lsp.md)；設計依據見 [LSP 能力 seam Agent Note](../../.agents/notes/implemented/architecture/2026-07-15-lsp-capability-seam.md)。
