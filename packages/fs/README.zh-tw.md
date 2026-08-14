# fs/：檔案系統能力族

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

檔案系統棧包括：提供方約定（執行世界路徑、有界文字 I/O 與帶選填版本防護的原子變更）、本機實作、政策閘門外掛程式（已觀察狀態、編輯前讀取、版本防護的寫入/編輯）、面向模型的文件工具與執行器，以及基於 ripgrep 的發現工具。全部都是**產品**包。

| 包 | 角色 | ctx 鍵 |
|---|---|---|
| `fs/` | Service Definition：規範化行程路徑、文件 URI 與包含關係、文字 I/O 和原子變更原語；擁有 `fs/*` 政策事件 | `ctx.fs` |
| `fs-local/` | 本機檔案系統 `FileSystem` 實作 | （註冊 `ctx.fs`） |
| [`e2b/fs-e2b`](../e2b/fs-e2b/README.md) | 以 E2B 為後端的 `FileSystem` 實作，共享由 `ctx.e2b` 擁有的遠端執行時期 | （註冊 `ctx.fs`） |
| `fs-sandbox/` | 強制沙盒的 `FileSystem`：擴充 `fs-local`，並按每次呼叫的模式與工作區根政策約束寫入/編輯（只讀模式拒絕，工作區寫入模式限制在工作階段工作區與臨時根目錄內）；讀取直接透過 | （註冊 `ctx.fs`） |
| `fs-observation-policy/` | 政策閘門外掛程式：透過 `fs/*` 事件閘門提供已觀察狀態、編輯前讀取和版本防護的寫入/編輯 | （無服務，僅有 `fs/*` 監聽器） |
| `tool-fs/` | 面向模型的 `read`/`write`/`edit` 工具以及執行器（透過 `ctx.fs` 讀取，擁有讀取視窗邏輯，分派 `fs/*`）；為工作階段 cwd 相對路徑保留檔案系統語義，並在已掛載的 `ctx.fs` 實施約束時聲明沙盒升級欄位 | （註冊到 `ctx.tools`） |
| `tool-fs-search/` | 面向模型的 `glob`/`grep` 發現工具，由經 `ctx.subprocess` spawn 的打包 `@vscode/ripgrep` 二進位檔案支持，而不是使用 `ctx.fs` 提供方方法 | （註冊到 `ctx.tools`） |

Service Definition 位於 `fs/fs/`。沙盒化、遠端或限定項目作用域的檔案系統後端可以替換 `fs-local`，而無需更改 Service Definition、政策閘門或面向模型的工具 schema：`fs-sandbox` 基於共享沙盒模式提供行程內路徑圍欄（[決策](../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md)），而 `fs-e2b` 則把文件狀態置於與 E2B 子行程提供方共享的遠端執行世界中（[決策](../../.agents/notes/implemented/architecture/2026-07-28-portable-execution-world-consumers.md)）。政策（`fs-observation-policy/`）是一個只透過 `fs/*` 事件閘門參與的外掛程式，不是工具注入的服務；因此移除它會平穩失去政策，留下不受約束的裸提供方，而不會破壞工具。載入 `tool-fs/` 的部署也應載入該外掛程式。模式圍欄與編輯前讀取閘門彼此正交，可以組合。發現（`tool-fs-search/`）有意不擴充提供方約定：搜尋是由行程支持的 `rg` 工作流程（經 `ctx.subprocess` spawn 的打包 `@vscode/ripgrep` 二進位檔案），因此檔案系統後端無需承擔通用搜尋約定；其工具會無條件註冊。如果搜尋工作目錄與 `read` 根目錄是同一工作區，結果就能繼續讀取，這也是其 README 所述的共置部署。

## 文件 I/O 不設逾時

`read`/`write`/`edit` **不** 接受 `timeoutMs`，提供方約定也不設定 deadline：這裡的文件 I/O 不計時執行，因為 deadline 只會殺掉作業系統仍會完成的工作——參見[檔案系統子系統頁面](../../docs/subsystems/filesystem.md)。取消仍透過工具執行訊號傳播，在系統呼叫邊界盡力中止。

子系統參考——目標、結果、防護、策略事件、錯誤分類體系，以及文件 IO 為何不設逾時——見 [docs/subsystems/filesystem.md](../../docs/subsystems/filesystem.md)；沙盒圍欄見[跨家族 fs 沙盒 Agent Note](../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md)。
