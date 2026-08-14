# @deepseek-ai/dsh-web-search-exa

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

由 [Exa](https://exa.ai) 支持的 `WebSearchProvider`，用於 harness [web 能力 seam](../web/README.md)（`ctx.web`）。它呼叫 Exa 的 `POST /search` 端點並請求高亮摘要內容，把扁平 `results[]` 對映為 seam 規範化的 `WebSearchResult`。

這是一個**實作**包：它向 `ctx.web` 註冊提供方，不擁有 `ctx.web` 鍵，也不註冊面向模型的工具（後者屬於 `@deepseek-ai/dsh-tool-web`）。與 `@deepseek-ai/dsh-llm-deepseek` 一樣，它是函式／命名空間外掛程式（`inject: ['web']`），負責註冊後端，而非默認匯出服務。

## 設定

| 設定鍵 | 預設值 | 含義 |
|---|---|---|
| `apiKey` | `$EXA_API_KEY` | Exa API 金鑰。為空或缺失時提供方不可用。 |
| `baseURL` | `https://api.exa.ai` | 端點基址；追加 `/search`。無法解析時提供方不可用。 |
| `searchType` | `auto` | 以 Exa `type` 傳送的檢索模式：`auto`（由 Exa 決定）、`keyword` 或 `neural`。 |
| `numResults` | （未設定） | 請求不含 `maxResults` 時使用的默認結果數。未設定時不傳送預設值。必須是正整數。 |
| `highlightsPerResult` | `1` | 每個結果請求的 highlight 句子數（Exa `highlightsPerUrl`）。必須是正整數。 |

```yaml
- id: web-search-exa
  name: '@deepseek-ai/dsh-web-search-exa'
  config:
    apiKey: !!js process.env.EXA_API_KEY
```

## 對映

Exa 返回扁平 `results[]`，不返回生成答案，因此省略 `content`。每項結果對映為 `WebSearchSource`：`url` ← `url`、`title` ← `title`、`snippet` ← 第一個非空的 `highlights[]` 條目（沒有高亮摘要的結果缺少可移植的 snippet，會被丟棄）、`publishedAt` ← `publishedDate`。請求的 `maxResults` 優先於已設定的默認 `numResults`，並作為 Exa `numResults` 傳送，以最佳化成本和延遲；最終上限由 seam 強制執行。提供方失敗（HTTP 錯誤、網路失敗、回應體無法解析或結構不符）以 `WebError` `WEB_PROVIDER_ERROR` 呈現；中止請求以 `WEB_ABORTED` 呈現。HTTP 重定向會在訪問 `Location` 指向的目標之前被拒絕，並以 `WEB_PROVIDER_ERROR` 呈現。

## 模型體驗

透過 [`dsh-tool-web`](../tool-web/README.md) 間接影響；該工具保留此提供方經 `maxResults` 限制的 URL、標題、首條 highlight 與發布日期，或將確切的錯誤訊息 `Exa search aborted`、`Exa search request failed: <error>` 和 `Exa returned an unprocessable response body: <error>` 置於消費端的錯誤包裝層內；生成答案與提供方私有欄位不進入上下文。

#### KV Cache 影響

不會直接導致 KV Cache 失效；請求前綴變更由上述消費端負責。

## 已知限制與暫緩事項

- **沒有非空白高亮摘要的結果會被整個丟棄**：沒有可對映的可移植 snippet，因此返回源可能少於請求數量。
- **只公開 `searchType`／`numResults`／`highlightsPerResult`**：Exa 的其他控制項（livecrawl、category、網域／日期過濾條件、全文內容）等待提供方無關的 Service Definition 欄位（見 [seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)）。
- **按錯誤形狀分類中止**：只有 `DOMException` 且名為 `AbortError` 時才對映為 `WEB_ABORTED`；攜帶自訂原因的中止（例如 `dsh-timeout` 的 `TimeoutReason`）會呈現為 `WEB_PROVIDER_ERROR`。
