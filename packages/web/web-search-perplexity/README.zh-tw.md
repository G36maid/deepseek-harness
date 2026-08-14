# @deepseek-ai/dsh-web-search-perplexity

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

由 [Perplexity](https://perplexity.ai) 支援的 `WebSearchProvider`，用於 harness [web 能力 seam](../web/README.md)（`ctx.web`）。它呼叫 Perplexity 的 OpenAI 相容 `POST /chat/completions` 端點，把生成答案與引用對映為 seam 規範化的 `WebSearchResult`。

這是一個**實作**包：它向 `ctx.web` 註冊提供方，不擁有該鍵，也不註冊面向模型的工具。與 `@deepseek-ai/dsh-llm-deepseek` 一樣，它是函式／命名空間外掛程式（`inject: ['web']`）。OpenAI 相容協定格式（wire format）是提供方私有細節，並**不**使該提供方相依性 `ctx.llm`。

## 設定

| 設定鍵 | 預設值 | 含義 |
|---|---|---|
| `apiKey` | `$PERPLEXITY_API_KEY` | Perplexity API 金鑰。為空或缺失時提供方不可用。 |
| `baseURL` | `https://api.perplexity.ai` | 端點基址；追加 `/chat/completions`。無法解析時提供方不可用。 |
| `model` | `sonar` | 搜尋模型名稱。 |
| `maxTokens` | `1024` | 生成答案 token 上限（`max_tokens`）。必須是正整數。 |
| `searchRecency` | （未設定） | 以 `search_recency_filter` 傳送的新近程度視窗：`day`、`week`、`month` 或 `year`。未設定時不傳送過濾條件。 |

```yaml
- id: web-search-perplexity
  name: '@deepseek-ai/dsh-web-search-perplexity'
  config:
    apiKey: !!js process.env.PERPLEXITY_API_KEY
```

## 對映

`content` ← `choices[0].message.content`（生成答案）。`sources[]` 優先使用結構化 `search_results[]`（`url`、`title`、`snippet`、`publishedAt` ← `date`），否則回退到只含 URL 的 `citations[]` 陣列；僅當不存在 `search_results` 時才採取這條回退路徑。這些源只攜帶 `url`，因此 seam 上的 `title`／`snippet`／`publishedAt` 是選填欄位。提供方失敗以 `WebError` `WEB_PROVIDER_ERROR` 呈現；中止請求以 `WEB_ABORTED` 呈現。HTTP 重定向會在訪問 `Location` 指向的目標之前被拒絕，並以 `WEB_PROVIDER_ERROR` 呈現。Perplexity 沒有結果數量控制，因此 seam 會強制執行 `maxResults`（截斷 `sources[]` 並設定 `truncated`）。

## 模型體驗

### 輔助 Perplexity 請求

#### 模型看到的內容

獨立的 Perplexity 模型透過 chat-completions 端點將 `<query>` 原樣作為唯一使用者訊息接收。該請求不屬於工作階段模型上下文。

#### Token 影響

每次搜尋會產生獨立的提供方 token；`maxTokens` 限制生成答案。

#### KV Cache 影響

與工作階段請求快取相互獨立。同一模型路由下的相同查詢可能複用提供方快取；查詢或路由改變會建立不同前綴。

### 間接的工作階段工具結果

#### 模型看到的內容

透過 [`dsh-tool-web`](../tool-web/README.md)，工作階段模型會看到生成答案及結構化結果中繼資料，或只含 URL 的引用。該提供方確切的錯誤訊息為 `Perplexity search aborted`、`Perplexity search request failed: <error>` 和 `Perplexity returned an unprocessable response body: <error>`；HTTP 失敗保留提供方訊息。錯誤包裝層屬於消費端。

#### Token 影響

註冊不會直接產生工作階段 token。答案與源 token 取決於資料，源數量受服務限制；保留的結果或錯誤會重複傳送，直到發生壓縮（compaction）。

#### KV Cache 影響

僅附加；新可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **引用回退源只含 URL**：Perplexity 省略結構化 `search_results[]` 時，源不含 `title`／`snippet`／`publishedAt`，因此工具只算繪純主機名標籤。
- **超量返回的來源仍會增加 token 消耗和延遲**：協定沒有結果數量控制，`maxResults` 只能由 seam 在事後截斷。
- **只公開 `model`／`maxTokens`／`searchRecency`**：Perplexity 的其他搜尋控制項（網域過濾條件、`web_search_options` 上下文大小、圖片）有待提供方無關的 Service Definition 欄位支援（見 [seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)）。
- **按錯誤形狀分類中止**：只有 `DOMException` 且名為 `AbortError` 時才對映為 `WEB_ABORTED`；攜帶自訂原因的中止（例如 `dsh-timeout` 的 `TimeoutReason`）會呈現為 `WEB_PROVIDER_ERROR`。
