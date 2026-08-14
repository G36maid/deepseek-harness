# @deepseek-ai/dsh-web-search-deepseek

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

由 [DeepSeek](https://deepseek.com) 支援的 `WebSearchProvider`，用於 harness [web 能力 seam](../web/README.md)（`ctx.web`）。它呼叫 DeepSeek 的 **Anthropic 相容 Messages API**（`POST {baseURL}/messages`），啟用原生 `web_search_20250305` 伺服器工具，並把 DeepSeek 返回的結構化 `web_search_tool_result` 塊對映為 seam 規範化的 `WebSearchResult`。

這是一個**實作**包：它向 `ctx.web` 註冊提供方，透過選填的 `ctx.credentials` seam 為每次搜尋解析憑據，若存在發起請求的 agent（代理）工作階段，還會在其中記錄該輔助請求，且不註冊面向模型的工具。與 `@deepseek-ai/dsh-llm-deepseek` 一樣，它是函式／命名空間外掛程式（`inject: ['web']`）。Anthropic 協定格式（wire format）是提供方私有細節，並**不**使該提供方相依性 `ctx.llm`。

## 與專用搜尋端點的區別

Exa 和 Perplexity 提供專用搜尋端點，DeepSeek 則沒有。該提供方改為發起一次攜帶 `web_search` 伺服器工具的**完整 Messages 模型呼叫**，因此一次搜尋會產生完整模型輪次的延遲與 token 開銷，比純檢索端點更重。DeepSeek 在伺服器側執行搜尋，返回**結構化** `web_search_tool_result` 塊；提供方解析這些塊，**絕不會從模型文字中抓取 URL**。

**嚴格模式**：如果回應不含 `web_search_tool_result` 塊（未觸發原生搜尋），提供方會拋出 `WebError` `WEB_PROVIDER_ERROR`，而非降級為文字抓取。

它複用 `DEEPSEEK_API_KEY` 憑據引用（不增加金鑰），但**不會**複用 `$DEEPSEEK_BASE_URL`：搜尋端點使用 Anthropic 相容基址（`https://api.deepseek.com/anthropic/v1`），不同於 LLM（大型語言模型）配接器使用的 chat-completions 基址（`https://api.deepseek.com`）。已掛載的憑據服務具有權威性；沒有該服務時，提供方會回退到啟動行程的環境變數。每次搜尋都會解析該引用，因此在 Web 的 Models 頁中儲存或輪換的金鑰無需重新啟動，即可用於下一次呼叫。

## 設定

| 設定鍵 | 預設值 | 含義 |
|---|---|---|
| `apiKey` | 未設定 | DeepSeek API 金鑰字面值。優先使用 `apiKeyEnv`，避免金鑰進入設定；非空字面值優先。 |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 每次搜尋都會透過 `ctx.credentials` 解析該憑據引用；沒有該 seam 時則從行程環境解析。值缺失時，呼叫以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失敗。 |
| `baseURL` | `https://api.deepseek.com/anthropic/v1` | Anthropic 相容端點基址；追加 `/messages`。預設時回退到任一環境層中的 `$DEEPSEEK_SEARCH_BASE_URL`；禁止複用屬於 chat-completions LLM 配接器的 `$DEEPSEEK_BASE_URL`。無法解析時提供方不可用。 |
| `model` | `deepseek-v4-flash` | Anthropic 格式模型名稱。 |
| `apiVersion` | `2023-06-01` | `anthropic-version` 標頭值。 |
| `maxTokens` | `4096` | Messages 請求生成 token 的正整數上限。 |
| `maxUses` | `5` | 每次請求使用 `web_search` 伺服器工具的正整數上限。 |

```yaml
- id: web-search-deepseek
  name: '@deepseek-ai/dsh-web-search-deepseek'
  config:
    apiKeyEnv: DEEPSEEK_API_KEY
    baseURL: https://gateway.internal/anthropic/v1
```

上面的條目是 `web-search-deepseek` Settings 段的 base 層：疊加其上的使用者層會作用於**下一次**搜尋，因為提供方是按次投影該段，而不是在註冊時固化它。因此端點或模型變化時，seam 的提供方選擇不會閃斷。`apiKey` 帶有 `role('secret')`，所以它在任何一層都不會出現在 `describe()` 回應中——設定表層只能知道 credentials 領域是否為 `apiKeyEnv` 所命名的引用持有值，而無從知道某一層是否帶著字面金鑰。

## 對映

DeepSeek 返回的提供方生成答案均不被該提供方信任為 `content`，因此省略 `content`。`sources[]` 來自 `web_search_result` 條目，這些條目位於 `web_search_tool_result` 塊內：`url` ← `url`、`title` ← `title`、`publishedAt` ← `page_age`。`cited_text` 條目按 URL 標識，單獨位於文字塊的 `citations[]` 中；提供方會按 URL 將它們關聯到相應結果，沒有摘錄時省略 `snippet`。

結果按 URL 去重，因為一次請求可能在多次搜尋中呈現同一頁面。DeepSeek 公開 `maxUses` 而非結果數量旋鈕，因此 seam 會強制執行 `maxResults`：截斷 `sources[]` 並設定 `truncated`。

提供方失敗變為 `WEB_PROVIDER_ERROR`；呼叫方取消變為 `WEB_ABORTED`。HTTP 重定向會在接觸 `Location` 目標前被拒絕，並以 `WEB_PROVIDER_ERROR` 呈現。

## 請求日誌

由 agent 發起的搜尋會在寄出請求前一刻，向相應工作階段追加僅用於日誌的 `web/deepseek-search-llm-request` 工作階段事件。其中包含已解析端點、API 版本，以及傳送給 DeepSeek 且不含金鑰的精確 JSON 請求體；不包含標頭和憑據。寄出請求前發生憑據處理失敗或取消時不會建立事件；寄出請求後才發生 HTTP 或回應失敗時，本次請求嘗試仍保留持久記錄。在 agent 之外透過程序直接呼叫提供方時，沒有發起工作階段可供記錄。

## 模型體驗

### 輔助 DeepSeek 搜尋請求

#### 模型看到的內容

獨立的 DeepSeek 模型會原樣接收 `Perform a web search for the query: <query>` 作為使用者文字，並收到一個原生 `web_search` 伺服器工具定義。該請求不屬於工作階段模型上下文。

#### Token 影響

每次搜尋都會產生獨立的提供方輸入與輸出 token；`maxTokens` 限制生成輸出，`maxUses` 限制原生搜尋次數。

#### KV Cache 影響

與工作階段請求快取相互獨立。輔助指令與原生工具定義可以形成穩定前綴，但查詢或模型路由的每次變化都會阻止從首個差異起的複用。

### 間接的工作階段工具結果

#### 模型看到的內容

透過 [`dsh-tool-web`](../tool-web/README.md)，工作階段模型會看到結構化搜尋塊中去重後的 URL、標題、日期與引用 snippet；提供方文字不會作為答案受到信任。該提供方的具體錯誤訊息包括帶有處理指引的憑據缺失訊息、`DeepSeek search credential resolution failed: <error>`、`DeepSeek search aborted`、`DeepSeek search request failed: <error>`、`DeepSeek returned no web_search_tool_result blocks; the request may not have triggered native web search` 和 `DeepSeek returned an unprocessable response body: <error>`；HTTP 失敗保留提供方訊息。錯誤包裝屬於消費端。

#### Token 影響

註冊不會直接產生工作階段 token。結果 token 隨返回源與 snippet 成長，隨後 seam 會強制執行請求的源數量上限。

#### KV Cache 影響

僅附加；新可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **一次搜尋需要完整的 Messages 模型輪次**：會產生延遲與生成 token，並且最多執行 `maxUses` 次伺服器側搜尋；DeepSeek 不公開專用檢索端點。
- **動態憑據的可用性在操作內部解析**：同步的 `available()` 約定可以確認解析器存在，但無法查詢非同步憑據儲存。因此，選中的無金鑰提供方會使搜尋以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失敗；穩定的 `web_search` schema 仍保持註冊。呼叫方取消在本機與該預檢存在競態，但無法強制任意憑據後端自行停止工作。
- **超量返回的源仍消耗 token**：協定沒有結果數量旋鈕，`maxResults` 只能由 seam 在事後截斷。
- **未引用的結果沒有 `snippet`**：只有 `text` 塊中的引用（`cited_text`）匹配其 URL 時，源才會獲得 snippet。
