# @deepseek-ai/dsh-web-fetch-http

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

一個匿名公共 HTTP(S) `WebFetchProvider`，用於 harness [web 能力 seam](../web/README.md)（`ctx.web`）。它取得具體 URL，回傳狀態碼和長度受限的解碼內容。

這是一個**實作**包：它向 `ctx.web` 註冊提供方，不擁有該鍵，也不註冊面向模型的工具。它是函式／命名空間外掛程式（`inject: ['web']`）。

## 職責拆分

提供方擁有**安全資源取得**：URL 驗證、HTTP 傳輸、重定向策略、資源兜底逾時、中止傳播、位元組上限、charset 解碼、內容類型分類與二進位拒絕。`@deepseek-ai/dsh-tool-web` 擁有**呈現**（HTML→markdown、截斷格式）。非 2xx HTTP 回應是*結果*（狀態碼 + 解碼主體），不是錯誤；`WebError` 只用於無法安全取得或表示資源的失敗。

提供方的 `timeoutMs` 是直接 `ctx.web.fetch()` 呼叫方和設定有誤的部署所用的資源兜底，不是面向模型的工具呼叫預算。[`dsh-tool-call-timeout-policy`](../../guard/timeout-policy/README.md) 擁有 `web_fetch` 工具呼叫預算，並讓 `exec.signal` 在逾時時觸發，以強制執行該預算。

已交付的 web 工具部署會把提供方兜底設為高於工具預算，因此模型呼叫通常返回 `TOOL_TIMEOUT`。如果外層截止期限先於提供方的兜底逾時觸發，提供方會報告 `WEB_ABORTED`，外層策略再將其替換為 `TOOL_TIMEOUT`。因此，`WEB_FETCH_TIMEOUT` 表明直接服務呼叫方的提供方預算已經耗盡。

## 傳輸衛生

- 只接受 `http:` 和 `https:` URL；拒絕 URL 中的憑據（`WEB_BLOCKED_URL`）以及過長／格式錯誤的 URL（`WEB_INVALID_URL`）。
- 強制執行 URL 最大長度、回應位元組上限（`WEB_FETCH_TOO_LARGE`）、解碼主體字元上限、逾時（`WEB_FETCH_TIMEOUT`）和重定向跳數上限。
- 把呼叫方的中止訊號（`WEB_ABORTED`）傳播到網路請求與流式讀取。
- 只跟隨**同源**重定向；跨源重定向以 `WEB_REDIRECT_BLOCKED` 失敗，要求發起新的工具呼叫（沿用 Claude Code 的 WebFetch 模式）。
- 傳送顯式的產品 `User-Agent`，絕不偽裝成瀏覽器。
- 不受支援的內容類型（例如二進位）以 `WEB_UNSUPPORTED_CONTENT_TYPE` 拒絕。

## 設定

| 設定鍵 | 預設值 | 含義 |
|---|---|---|
| `maxUrlLength` | `2048` | 接受的請求 URL 最大長度。 |
| `maxResponseBytes` | `5_000_000` | 回應主體最大位元組數。 |
| `maxBodyChars` | `100_000` | 解碼主體最大字元數。 |
| `timeoutMs` | `30_000` | Node 定時器範圍內的抓取逾時：直接 `ctx.web.fetch()` 呼叫方的資源兜底，而非面向模型的工具呼叫預算（後者屬於 `dsh-tool-call-timeout-policy`）。 |
| `maxRedirects` | `5` | 同源重定向最大跳數（`0` 表示完全不跟隨）。 |
| `userAgent` | `deepseek-harness/…` | `User-Agent` 標頭。 |

數值限制會在外掛程式構造時驗證：除 `maxRedirects` 外，每個上限都必須是正的有限數；`maxRedirects` 必須是非負整數。無效值會拋出例外，不會靜默構造限制荒謬的提供方。

## 模型體驗

透過 [`dsh-tool-web`](../tool-web/README.md) 間接影響；該工具把此提供方經 `maxBodyChars` 限制的解碼文字或由 HTML 轉換得到的 markdown 置於抓取結果包裝層中，並保留提供方失敗；重定向、標頭與傳輸機制保持隱藏。

#### KV Cache 影響

不會直接導致 KV Cache 失效；請求前綴變更由上述消費端負責。

## 已知限制與暫緩事項

- **SSRF／私有網路防護暫緩**：不會阻止私有、loopback、link-local、multicast 或其他非公開目標，也不進行 DNS 解析後驗證或逐跳重新驗證（見 [web 能力 seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)）。在此功能落地前，該提供方是 SSRF 原語；能夠訪問敏感內部網路目標的部署**禁止啟用它**。
- **只解碼文字內容**：包括 html/xhtml 與 `text/*` 加 JSON/XML 家族；缺少 `Content-Type` 或任何二進位類型都會拋出 `WEB_UNSUPPORTED_CONTENT_TYPE`，可提取文字的 PDF 解碼屬於明確的暫緩工作。
- **charset 只來自 `Content-Type` 標頭**（預設為 UTF-8）：HTML `<meta charset>` 聲明會被忽略；聲明但無法識別的 charset 標籤會拋出例外，而非回退。
