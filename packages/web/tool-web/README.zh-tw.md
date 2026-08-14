# @deepseek-ai/dsh-tool-web

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

面向模型的 web 工具套件 `web_search` 與 `web_fetch`，建置於 [web 能力 seam](../web/README.md)（`ctx.web`）之上。它只負責面向模型的事項：工具名稱、JSON Schema、snake_case 參數名稱、提示詞區段、結果數量上限、結果格式、HTML→markdown 呈現，以及 UI 呈現投影——`presentCall`、`presentResult`（以 `kind: 'search' | 'fetch'` 區分的 `card: 'web'` 結果卡片），以及承載有損算繪文字無法攜帶的結構化搜尋來源或抓取摘要的 `output.presentationMeta`（見 [web-result-card Agent Note](../../../.agents/notes/implemented/feature/2026-07-30-web-result-card.md)）。所有 web 訪問都透過 `ctx.web`；該包絕不匯入具體提供方。兩個工具都不公開面向模型的逾時：每個工具的協作式工具呼叫逾時預算透過設定在此聲明（`fetchTimeoutMs`／`searchTimeoutMs`，附加為 `ToolDefinition.timeoutMs`），由 [`@deepseek-ai/dsh-tool-call-timeout-policy`](../../guard/timeout-policy/README.md)（`tools/execute` 包裝層）強制執行；每個工具只把 `exec.signal` 轉發給 seam。

每個工具獨立註冊；只需要其中一個工具的產品可以透過設定停用另一個（`{ search: false }`／`{ fetch: false }`）。僅當抓取也透過設定啟用時，搜尋指引才會提及 `web_fetch`；僅啟用搜尋的組合則會要求模型使用返回的 snippet 並引用其 URL。

## 工具

| 工具 | 參數 | 行為 |
|---|---|---|
| `web_search` | `query`（string） | 用於發現資訊。返回選填答案與來源 URL。`max_results` **不**面向模型：工具設定上限（`searchMaxResults` 設定，預設 8）並傳給 seam。 |
| `web_fetch` | `url`（string） | 取得特定 URL。HTML 主體算繪為 markdown（turndown，帶 GFM 表格／刪除線）；文字主體原樣透過。非 2xx 狀態會報告，而非報錯。工具呼叫逾時是部署策略（`dsh-tool-call-timeout-policy`），不是模型參數。 |

兩個工具都選擇並行調度，因為提供方讀取會返回內容，不會修改父 agent（代理）的狀態。

規範化後的服務結果也是標準工具值：`WebSearchResult` 與 `WebFetchResult`。原生算繪器會保留下文所述的答案、來源和抓取正文文字；提供方對搜尋結果數量和正文大小的上限仍屬於取得限制，而非僅用於呈現的截斷。

## 設定

| 設定鍵 | 預設值 | 含義 |
|---|---|---|
| `search` | `true` | 註冊 `web_search`。 |
| `fetch` | `true` | 註冊 `web_fetch`。 |
| `searchMaxResults` | `8` | 一次 `web_search` 呼叫返回的來源數量上限（seam 截斷更長的提供方清單並標記）。 |
| `fetchTimeoutMs` | `30000` | `web_fetch` 的協作式工具呼叫逾時預算（ms）。 |
| `searchTimeoutMs` | `30000` | `web_search` 的協作式工具呼叫逾時預算（ms）。 |
| `fetchMaxOutputChars` | `200000` | 同步轉換的源字元數與單次完整 `web_fetch` 輸出的上限（狀態頭、算繪後的主體與頁腳合併計算）；主體被截斷時，在能容納的情況下附帶截斷提示。 |

`fetchTimeoutMs`／`searchTimeoutMs` 聲明每個工具的協作式逾時預算（附加為 `ToolDefinition.timeoutMs`），由 [`@deepseek-ai/dsh-tool-call-timeout-policy`](../../guard/timeout-policy/README.md) 強制執行；面向模型的 schema 不公開逾時參數。`fetchMaxOutputChars` 同時限制同步轉換工作量和完整算繪結果：只轉換至多該數量的源字元，隨後對狀態頭、轉換後的前綴和截斷提示合併設限。預設值為本機提供方的 100,000 字元主體上限留出餘量，但算繪膨脹仍可能使最終上限截斷結果。

```yaml
- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
```

## 穩定註冊

工具註冊遵循產品**啟用狀態**，而非後端可用性。即使選中的提供方缺失、錯誤設定、存在歧義或暫時不可用，工具仍保持可見；seam 在執行時解析提供方，執行以結構化 `WebError`（例如 `WEB_PROVIDER_UNAVAILABLE`、`WEB_PROVIDER_AMBIGUOUS`）失敗，`ToolRuntime.execute()` 會把它轉為模型可讀、掛鉤／UI 可路由的錯誤工具結果。這樣無需把外掛程式載入順序、憑據狀態或 HMR（熱模組替換）時機納入面向模型約定，也能保持模型 schema 穩定。要徹底移除 web 工具，請在此處透過設定將其停用。

工具絕不會呼叫提供方的 `available()`，也不會枚舉提供方；唯一執行路徑是 `ctx.web.search()`／`ctx.web.fetch()`，提供方不可用時，選擇機制會在執行階段拋出結構化 `WebError`，其錯誤碼由工具接收。提供方選擇完全留在 seam 內，由單一主體負責。

## 模型體驗

### 系統提示詞

#### 模型看到的內容

搜尋與抓取分別貢獻以下 web-search 和 web-fetch 指引。搜尋會在註冊時根據設定選用啟用抓取或僅搜尋的文字。scope 工具限制不會移除這些獨立註冊的區段。

##### 啟用抓取時的 Web 搜尋指引

```markdown
Use the web_search tool to discover current information on the web. It returns an optional answer plus a list of source URLs. Follow up with web_fetch when you need the full content of a specific result, and cite the relevant URLs as markdown links.
```

##### 僅搜尋時的 Web 搜尋指引

```markdown
Use the web_search tool to discover current information on the web. It returns an optional answer plus a list of source URLs. Use the returned source snippets when available, and cite the relevant URLs as markdown links.
```

##### Web 抓取指引

```markdown
Use the web_fetch tool to retrieve the content of a specific HTTP(S) URL (for example a result from web_search). It returns the page content decoded to text. Cite the URL as a markdown link when you use its content.
```

#### Token 影響

每個透過設定啟用的工具都會為每次請求增加固定的指引 token 開銷，即使限制隱藏了其 schema。切換抓取狀態不僅會註冊或移除抓取區段，也會更改搜尋指引。

#### KV Cache 影響

只要啟用工具、scope 與指引文字不變，前綴就保持穩定。設定啟用狀態（包括因切換抓取狀態而改變搜尋指引分支）或外掛程式生命週期可能使從第一個變化的提示詞區段起的複用失效；scope schema 限制不會移除該區段。

### 工具 schema

#### 模型看到的內容

模型會看到生成的 [`web_search` 與 `web_fetch` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-web)。結果數量與逾時預算屬於部署設定，不是模型參數。

#### Token 影響

每次請求都會產生固定的 schema token 開銷；透過設定停用會同時移除 schema 與指引，scope 限制只移除 schema。

#### KV Cache 影響

只要定義與可見性不變，前綴就保持穩定。設定啟用狀態、外掛程式生命週期或 scope 限制可能使從第一個變化的 schema token 起的複用失效。

### 搜尋結果

#### 模型看到的內容

選填的提供方答案之後是 `Sources:`，再跟隨內容取決於資料且格式嚴格為 `- [<title-or-url>](<url>)` 的行，並可新增後綴 ` — <snippet> (<publishedAt>)`。既無答案也無來源時，結果顯示 `No results found.`。清單被截斷至上限時會新增 `(Showing the first <count> sources. Refine the query for more.)`；每個結果都以 `Cite the relevant URLs above as markdown links in your answer.` 結尾。

#### Token 影響

資料相關結果會重複傳送直到壓縮（compaction），來源數量由 `searchMaxResults` 限制。

#### KV Cache 影響

僅附加；新可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

### 抓取結果

#### 模型看到的內容

成功抓取的精確形狀是 `Fetched <finalUrl> (HTTP <statusCode>)`、一個空行，以及由提供方返回的已解碼正文。發生截斷時會再新增一個空行和 `(Content truncated. Fetch a more specific URL or section for the full text.)`；失敗變為 `Error: <message>`。查詢與 URL 保留在呼叫歷史中。

#### Token 影響

提供方上限限制主體大小；保留的呼叫參數與結果會重複傳送直到壓縮，逾時策略可以把遲到結果替換為簡短錯誤。

#### KV Cache 影響

僅附加；新可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

### 參數錯誤

#### 模型看到的內容

空輸入精確地變為 `Error: query must be a non-empty string` 或 `Error: url must be a non-empty string`。

#### Token 影響

只有失敗呼叫會增加這些保留 token。

#### KV Cache 影響

僅附加；新可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **HTML→markdown 轉換會在 GFM 無法安全表示的輸入上降級**：[turndown](https://github.com/mixmark-io/turndown)（帶 GFM 表格／刪除線）透過真實 DOM 轉換至多 `fetchMaxOutputChars` 個源字元。保守的 512 層詞法守衛會將深層或巢狀有歧義的主體作為原始 HTML 直接透傳，轉換例外也會如此處理；表格的 `colspan` 會被忽略，因為 GFM 無法表示跨列單元格。這些限制可避免阻塞事件迴圈，也避免不受信任的數值屬性使輸出膨脹（[已封存的相依性決策](../../../.agents/notes/archived/simplification/2026-07-26-turndown-for-tool-web-html-markdown.md)）。
- **面向模型的介面有意保持精簡，後續擴充暫緩**：`max_results` 保持為設定上限（不是模型參數），`web_fetch` 只接受 `url`（沒有 `format`／`prompt`／LLM（大型語言模型）摘要模式）；兩項都列為 [seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md) 中的後續步驟。
- **沒有 web 專用權限策略**：兩個工具都不會請求 `ctx.approval` 就直接執行；需要確認的部署必須新增 `tools/pre-execute` 策略，該包不定義持久化的 URL／網域授權。
