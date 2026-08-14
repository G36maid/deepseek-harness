# @deepseek-ai/dsh-web

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

**`WebRuntime`**（`ctx.web`）定義 harness 具備哪些 web 訪問能力（搜尋 web、抓取 URL），並透過多個提供方實作，不把模型約定綁定到某個廠商的 API 形狀。

本包承擔 web 能力的 Service Definition 角色。與 shell/fs 不同，它在一個 seam 上跨越搜尋與抓取兩種操作，每種操作都可能有多個提供方：

| 包 | 職責 |
|---|---|
| `@deepseek-ai/dsh-web`（本包） | Service Definition：服務、提供方登錄檔、選擇策略、請求／結果詞彙、`WebError` 分類體系 |
| `@deepseek-ai/dsh-web-search-exa` | 搜尋提供方：Exa |
| `@deepseek-ai/dsh-web-search-perplexity` | 搜尋提供方：Perplexity |
| `@deepseek-ai/dsh-web-fetch-http` | 抓取提供方：匿名公共 HTTP(S) |
| `@deepseek-ai/dsh-tool-web` | Consumer：面向模型的 `web_search`／`web_fetch` 工具 schema，建置於 `ctx.web` 之上 |

搜尋與抓取沒有共享請求 schema 或業務邏輯，但有意共用一個 seam：`ctx.web` 是單一 web 訪問中間層，擁有一項提供方選擇策略、一套中止／錯誤詞彙和一個面向產品的「該 harness 如何訪問 web」設定介面。成對的 `Search`／`Fetch` 方法保持平行是有意為之。

## 服務 API（`ctx.web`）

| 成員 | 語義 |
|---|---|
| `registerSearchProvider(provider)`／`registerFetchProvider(provider)` | 註冊後端。同一能力類型下 id 重複時拋出 `WebError` `WEB_DUPLICATE_PROVIDER`。返回 disposer。隨呼叫 fiber 一並 dispose（資源釋放）。 |
| `search(request, signal?)` | 解析搜尋提供方並執行一次搜尋。在結果上強制執行 `request.maxResults`（截斷 `sources[]`，設定 `truncated`）。能力無法執行時期拋出 `WebError`。 |
| `fetch(request, signal?)` | 解析抓取提供方並取得一個 URL。非 2xx 回應是結果，不會拋出例外。無法安全取得或表示資源時拋出 `WebError`。 |

提供方註冊的是**能力**而非工具。`dsh-tool-web` 是面向模型的名稱、描述、提示詞指引、JSON Schema 和呈現的唯一歸屬方。

## 選擇

選擇絕不相依性註冊、設定或 HMR（熱模組替換）順序。能力要麼具有顯式提供方 id（設定 `searchProvider`／`fetchProvider`，或由環境變數 `$DSH_WEB_SEARCH_PROVIDER`／`$DSH_WEB_FETCH_PROVIDER` 提供相同欄位），要麼在恰好只註冊一個可用提供方時自動選擇。`search()`／`fetch()` 會在執行時解析提供方：

| 情況 | 執行 |
|---|---|
| 已設定 id 已註冊且 `available()` | 執行該提供方 |
| 已設定 id 未註冊 | `WEB_PROVIDER_CONFIGURED_MISSING` |
| 已設定 id 已註冊但不可用 | `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` |
| 無 id，恰好一個已註冊的可用提供方 | 執行該提供方 |
| 無 id，沒有可用提供方 | `WEB_PROVIDER_UNAVAILABLE` |
| 無 id，多個可用提供方 | `WEB_PROVIDER_AMBIGUOUS` |

失敗分支會拋出 `WebError`；呼叫方按其結構化 code（加訊息細節：缺失 id、歧義候選集合）路由。提供方自身的 `available()` 是便宜的區域性檢查（憑據是否存在、設定是否可解析），供執行時選擇使用，且**禁止發起網路呼叫**；`dsh-tool-web` 永遠不會呼叫它。工具透過 `ctx.web.search()`／`fetch()` 執行，並按拋出的 code 路由，因此提供方選擇只有一個歸屬方。

## 詞彙

`WebSearchRequest`（`query`、`maxResults?`）→ `WebSearchResult`（`content?`、`sources[]`、`truncated`）；每個 `WebSearchSource` 都有必填 `url` 與選填 `title`／`snippet`／`publishedAt`（Perplexity 引用可能只含 URL）。`WebFetchRequest`（`url`）→ `WebFetchResult`（最終 `url`、`statusCode`、`body`、`truncated`）；取消作為選填的直接 `AbortSignal` 參數傳給 `search()`／`fetch()`。`WebFetchBody` 是這裡擁有的封閉判別聯合（`html` | `text`）；消費端使用 `switch` 實作窮盡檢查，因此新增類型會導致編譯失敗，直到處理完畢。完整約定見 `src/types.ts`，其中也包含 `WebError` code 分類體系。

## 模型體驗

透過 `dsh-tool-web` 間接影響；該工具會保留有界的規範化提供方資料，或者原樣保留以下失敗：已設定的提供方缺失、提供方不可用、無提供方、存在多個提供方以及 `Error: <message>`；本登錄檔自身不貢獻提示詞或 schema。

#### KV Cache 影響

不會直接導致 KV Cache 失效；請求前綴變更由上述消費端負責。

## 已知限制與暫緩事項

- **沒有觀測介面**：沒有提供方變更事件或能力狀態查詢；可用性只能透過執行 `search()`／`fetch()` 並按拋出的 `WebError` code 路由來觀測，無提供方失敗是通用的 `WEB_PROVIDER_UNAVAILABLE`，不會枚舉逐提供方原因（見 [Agent Note](../../../.agents/notes/archived/simplification/2026-07-04-drop-unconsumed-web-observation-surface.md)）。
- **`WebSearchRequest` 只攜帶 `query` + `maxResults`**：提供方無關的控制項（新近程度、網域過濾條件、區域提示、搜尋深度）暫緩至 Exa 與 Perplexity 都能誠實支援時（見 [seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)）。
- **`WebFetchBody` 沒有 `pdf` 分支**：可提取文字的 PDF 支援屬於明確的暫緩工作；封閉聯合會使新增該分支成為三個 web 包中由編譯強制執行的變更。
- **提供方支援的頁面提取不屬於 `fetch()` 範圍**：Firecrawl/Tavily 風格的 `web_extract` 能力暫緩，而不會擴充抓取操作。
