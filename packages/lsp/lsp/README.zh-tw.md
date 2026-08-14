# @deepseek-ai/dsh-lsp

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

**LSP 能力 seam**：抽象 `LspService`（`ctx.lsp`）定義 harness 具備哪些語義程式碼導覽能力（轉到定義、尋找引用、尋找實作、懸停），並透過語言伺服器提供方實作，不把模型約定綁定到本機子行程。

本包承擔 LSP 能力的 Service Definition 角色：

| 包 | 職責 |
|---|---|
| `@deepseek-ai/dsh-lsp`（本包） | Service Definition：服務、以品牌化 id + 擴充名對映為 key 的提供方登錄檔、逐查詢選擇、請求／結果詞彙、`LspError` 分類體系 |
| `@deepseek-ai/dsh-lsp-stdio` | Service Provider：通用本機後端，註冊已設定的 stdio 語言伺服器提供方 |
| `@deepseek-ai/dsh-tool-lsp` | Consumer：面向模型的 `lsp` 工具，基於 `ctx.lsp` |

該 seam 恰好公開四種語義操作：`goToDefinition`、`findReferences`、`goToImplementation`、`hover`，且沒有通用 JSON-RPC 逃生口，因此任何協議載荷或未經評審的命令／修改都無法透過 `ctx.lsp` 到達提供方。

## 服務 API（`ctx.lsp`）

| 成員 | 語義 |
|---|---|
| `registerProvider(provider)` | 註冊後端，以原子方式保留其品牌化 `id` 與每個規範化文件擴充名。任何無效輸入或衝突都不會發布內容，並拋出 `LspError`（`LSP_INVALID_PROVIDER`／`LSP_CONFLICT`）。返回釋放所有保留項的 disposer。隨呼叫 fiber 釋放。 |
| `query(request, signal?)` | 按文件最終擴充名選擇提供方，從該提供方的對映派生 `languageId`，並執行一次查詢。沒有匹配項時拋出 `LspError` `LSP_UNAVAILABLE`。 |

選擇逐查詢進行且與順序無關：一個提供方獨佔一組擴充名，因此註冊和 HMR（熱模組替換）順序絕不會改變路由。擴充名 key 規範化為小寫且以點開頭；`languageId` 只用於同步臨時文件，絕不參與選擇。第一版沒有 glob、language-id 或顯式路由 selector。

提供方註冊的是**能力**而非工具。`dsh-tool-lsp` 是面向模型的名稱、描述、提示詞指引、schema 和呈現的唯一 owner。

## 詞彙

`LspQueryRequest`（`operation`、`filePath`、`position`、`workspaceRoot`）：每個欄位都必填，因此沒有欄位需要實作預設值，也不存在 `resolve()` 步驟。位置與範圍使用從零開始的 UTF-16，與協議一致；工具擁有從 1 開始的遊標約定。`findReferences` 始終包含聲明，提供方在內部強制執行，因此呼叫方沒有 flag。`LspQueryResult` 是封閉的判別聯合：導覽使用 `{ kind: 'locations'; locations; resolvedWorkspaceUri }`，懸停使用 `{ kind: 'hover'; hover }`（內容或 `null`）；消費端透過 `switch` 實作窮盡檢查，因此新增分支會使編譯失敗，直到完成處理。`resolvedWorkspaceUri` 是提供方的規範工作區 `file:` URI；呼叫方相對化位置 URI 時以它為基準，而不是對可能含符號連結的請求根應用宿主平臺路徑規則。完整約定見 `src/types.ts`；`src/index.ts` 給出 `LspError` code，包括 `LSP_DISPOSED` 和 `LSP_MALFORMED_RESPONSE`。

## 模型體驗

透過 `dsh-tool-lsp` 間接影響；該工具擁有面向模型的 `lsp` schema、提示詞與渲染結果，本登錄檔自身不貢獻提示詞或 schema。

#### KV Cache 影響

不會直接失效；請求前綴變更由 `dsh-tool-lsp` 負責。

## 已知限制與暫緩事項

- **同一執行時期內擴充名歸屬互斥**：兩個提供方不能同時聲明 `.ts`，即使 language id 不同；重疊會使註冊失敗。預期擴充是在註冊之上增加部署設定的 selector；它可以放寬互斥保留，而無需把提供方選擇加入模型輸入（見 [seam Agent Note](../../../.agents/notes/implemented/architecture/2026-07-15-lsp-capability-seam.md)）。
- **僅四種操作**：symbol 與 call hierarchy 暫緩（它們需要不同 schema）；diagnostics 需要獨立的新鮮度／累積規則；修改操作（rename、code action、formatting）需要獨立工具，並整合預覽、權限和寫入策略。
- **沒有觀測表層**：可用性只能透過執行 `query()` 並按拋出的 `LspError` code 路由來觀測；沒有提供方變更事件或能力狀態查詢。
