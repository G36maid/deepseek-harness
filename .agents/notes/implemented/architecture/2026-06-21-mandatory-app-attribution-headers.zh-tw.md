# Agent Note: 對提供方請求強制攜帶 `User-Agent` 歸屬標識

Status: implemented

[English](2026-06-21-mandatory-app-attribution-headers.md) | [简体中文](2026-06-21-mandatory-app-attribution-headers.zh.md) | 繁體中文

## 問題

LLM（大型語言模型）提供方請求應當標識寄出請求的產品。這對提供方側的技術支援、濫用調查、相容性除錯和流量分析都有價值。在本 Agent Note 之前，harness 只做了部分工作：手寫的 DeepSeek 配接器傳送了一個手動複製的 `User-Agent` 常數（`packages/llm/llm-deepseek/src/adapter.ts`），而基於 pi-ai 的孿生配接器則完全不傳送 harness 自有的頭部（`packages/llm/llm-pi-ai/src/adapter.ts`）。因此新配接器可以悄無聲息地省略歸屬標識，而基於庫的配接器也可能與手寫配接器產生偏差——儘管[孿生配接器 Agent Note](2026-06-13-twin-llm-adapters.md) 的存在正是為了確保兩種實作中的提供方約定真實可靠。

直接觸發因素來自 OpenRouter 的[應用歸屬](https://openrouter.ai/docs/app-attribution)文件。OpenRouter 根據 `HTTP-Referer` 加上用於展示和分類的頭部來建立應用頁面和排名。這有價值，但它不是 HTTP 標準中的應用身份機制。風險在於：把 OpenRouter 的精確頭部集當作通用標準來採納，然後將提供方特有的頭部洩漏到直連 DeepSeek 的請求、未來的 OpenAI/Anthropic/Vertex 配接器、測試伺服器或無限期記錄未知欄位的代理中。

## 調研

- **OpenRouter 的機制是提供方特有的。** 其當前文件說明應用歸屬透過 `HTTP-Referer`（必需）、`X-OpenRouter-Title` 和 `X-OpenRouter-Categories` 來追蹤；`X-Title` 僅為向後相容而接受。其 API 參考稱這些頭部為選填，並說它們使應用在 OpenRouter 上可被發現。這是一項具體的 OpenRouter 約定，而非 IETF 或 OpenAI 相容 API 標準。
- **在 agent（代理）工具生態中，`HTTP-Referer` 是一種 OpenRouter 感知的慣例，而非通用 agent 慣例。** 它足夠常見，以至於 OpenRouter SDK 和示例直接暴露它，面向 OpenRouter 的框架通常需要一種方式來透傳它。但 ACP（Agent Client Protocol）等 agent 協議在自己的 initialize 訊息中協商名稱、版本和能力，而模型提供方請求仍需 HTTP 層面的身份標識。因此「在 agent 世界中被接受」意味著「被 OpenRouter 整合所識別」，而非「可跨 agent 執行時期或提供方移植」。
- **程式設計 agent 在 `User-Agent` 中標識產品和版本。** 公開實作在環境細節和提供方特有的附加頭部上各有不同，但產品身份是共同約定；不存在通用的精確格式。
- **標準化的通用用戶端身份頭部是 `User-Agent`。** RFC 9110 第 10.1.5 節將 `User-Agent` 定義為使用者代理軟體身份，說明它用於互操作性報告和分析，並說使用者代理應當在每個請求中傳送它（除非被設定為不傳送）。這是唯一直接對應「哪個產品在寄出此 HTTP 請求」的標準頭部。
- **`Referer` 是標準的，但 OpenRouter 的 `HTTP-Referer` 不是標準欄位。** RFC 9110 第 10.1.3 節將 `Referer` 定義為取得目標 URI 的來源 URI，並用大量篇幅討論隱私限制。OpenRouter 則要求 `HTTP-Referer`，將其用作應用 URL 識別符號。該名稱和含義是 OpenRouter 特有的，儘管它形似標準 `Referer` 頭部的 CGI 環境變數形式。
- **`From` 是標準的，但不適合作為強制預設值。** RFC 9110 第 10.1.2 節將 `From` 定義為負責使用者代理的人的電子郵件地址。機器人代理應當傳送它以便伺服器聯絡運營者，但非機器人代理出於隱私和安全策略考慮不應在未經使用者顯式設定的情況下發送。harness 可以後續支持運營者聯絡方式，但不得憑空捏造或全域性強制要求。
- **請求體中的 `user` 或 `metadata` 欄位不是應用歸屬。** 部分模型 API 暴露穩定的終端機使用者識別符號、請求元資料、標籤或項目/帳戶頭部。這些對濫用監控、內部計費、儀錶板或鏈路追蹤有用，但它們要麼標識的是終端機使用者而非產品，要麼是提供方特有的 body schema，要麼不保證能透過 OpenAI 相容閘道透傳。它們不能替代靜態的應用身份頭部。
- **SDK 遙測頭部標識的是 SDK，而非應用。** 官方和第三方 SDK 常傳送庫/版本頭部。這些幫助 SDK 維護者除錯其用戶端，但除非應用顯式提供產品歸屬層，否則它們不能標識 harness 作為應用。
- **pi-ai 有原生支持的頭部掛鉤。** `@earendil-works/pi-ai` 的 `StreamOptions.headers` 將呼叫方頭部最後合併（覆蓋提供方預設值），因此基於庫的配接器無需包裝或上游改動即可滿足與手寫配接器相同的線路約定。mock 伺服器測試套件對兩個配接器都斷言頭部到達了線路。

## 決策

在 LLM 配接器邊界，提供方無關的應用歸屬是強制的，且僅使用標準 `User-Agent` 頭部。規則：每個產品級 LLM 配接器在每個提供方 HTTP 請求上傳送一個靜態、非機密的應用身份，且每個配接器都有測試證明 `User-Agent` 到達了線路（mock 伺服器斷言收到的頭部；對於基於庫的配接器，透過庫的頭部掛鉤饋入同一個 mock 伺服器斷言）。這條規則約束應用歸屬，不約束提供方特有的請求身份；[DeepSeek 請求身份決策](../feature/2026-08-11-deepseek-request-user-id-header.md)另行負責其使用者與工作階段頭部。

OpenRouter 應用歸屬刻意未實作。`HTTP-Referer`、`X-OpenRouter-Title`、`X-Title` 和 `X-OpenRouter-Categories` 是 OpenRouter 特有的產品展示頭部，不是提供方無關的模型請求歸屬。它們可以後續由 OpenRouter 配接器或顯式 OpenRouter 模式提出，附帶自己的隱私/產品決策、測試和文件。在此之前，即使請求指向 OpenRouter，也只發送本決策定義的共享 `User-Agent` 歸屬。

提供方無關的身份由 `dsh-llm`（`packages/llm/llm/src/attribution.ts`）擁有，而非各配接器。`AppIdentity` 僅包含建置 `User-Agent` 所需的公開產品事實，默認的 `APP_IDENTITY` 取值如下：

- `User-Agent` 的產品 token：`deepseek-harness`（與 Agent Note 之前的線路值及倉庫/組織身份保持連續性）
- 版本：透過 `createRequire` 從所屬包的 manifest（中繼資料清單）讀取，絕不手動複製常數
- 應用 URL：`https://github.com/deepseek-ai/deepseek-harness`——倉庫主頁

預設值是強制的且非空。白標部署透過向 `attributionHeaders(identity)` 傳入自己的 `AppIdentity` 來覆蓋——覆蓋掛鉤就是函式參數，在有消費端需要之前不做部署設定管道——省略時回退到 harness 預設值而非抑制歸屬。沒有逐請求 API 允許模型、使用者提示詞、工作階段 id、cwd、使用者郵箱、API key 所有者或本機機器身份影響這些欄位。

線路對映（`attributionHeaders`；程式碼中頭部名稱小寫——HTTP 欄位名線上路上不區分大小寫）：

| 目標 | 對映 |
|---|---|
| 所有基於 HTTP 的配接器 | `User-Agent: {product}/{version} (+{url})`——括號中的 `+url` 註釋符合 RFC 9110 保守的 product/comment 文法。 |
| 直連 DeepSeek 端點 | `User-Agent` 用於應用歸屬；`x-deepseek-harness-user-id` 與條件性的 `x-deepseek-harness-session-id` 由 DeepSeek 特有決策作為獨立請求身份管理。除非 DeepSeek 文件化了等效約定，否則不傳送 OpenRouter 特有頭部。 |
| OpenRouter 端點 | 目前僅 `User-Agent`。本決策下不傳送 `HTTP-Referer`、`X-OpenRouter-Title`、`X-Title` 或 `X-OpenRouter-Categories`。 |
| 未來提供方 | 僅 `User-Agent`，除非後續提供方特有的 Agent Note 接受額外頭部。不要類比複用 `HTTP-Referer`。 |

端點偵測不在本 Agent Note 範圍內，因為此處不接受任何端點特有的對映。如果後續支持 OpenRouter，偵測必須是顯式的：要麼是專門的 OpenRouter 提供方包，要麼是顯式的 `provider: 'openrouter'` / `attributionTarget: 'openrouter'` 設定，而非任意路徑片段或模型名稱。

## 驗證

已落地的約定：

- `dsh-llm` 為 `LlmAdapter` 作者文件化了強制的 `User-Agent` 歸屬約定（`LlmAdapter` JSDoc、包 README，以及 `docs/subsystems/llm-streaming.md` 的配接器約定（adapter contract）章節）。
- 共享輔助函式（`attributionHeaders` / `userAgent`）從包元資料建置應用身份和標準 `User-Agent` 值，配接器無需手動複製版本常數。
- `dsh-llm-deepseek` 在每個請求上傳送共享的 `User-Agent`，其 mock 伺服器套件斷言精確值。
- `dsh-llm-pi-ai` 透過 pi-ai 的 `StreamOptions.headers` 掛鉤傳送相同的 `User-Agent`，其 mock 伺服器套件斷言精確值。
- 本決策下沒有配接器傳送 OpenRouter 特有的歸屬頭部（`HTTP-Referer`、`X-OpenRouter-Title`、`X-Title`、`X-OpenRouter-Categories`）。
- 沒有應用歸屬欄位攜帶機密、本機路徑、工作階段 id、提示詞文字、模型輸出、使用者郵箱或逐使用者的穩定識別符號。
- 配接器 README 聲明瞭 `User-Agent` 歸屬策略，並明確避免將 OpenRouter 應用歸屬記錄為已實作的行為。

## 曾考慮的替代方案

**現在就實作 OpenRouter 應用歸屬。** 本決策否決。傳送 `HTTP-Referer` 加 `X-OpenRouter-Title` 可以滿足 OpenRouter 排名，但這些頭部是提供方特有的產品功能，不是本決策所標準化的提供方無關的模型請求歸屬。支持它們應當是後續顯式的 OpenRouter 配接器/模式決策，而非隱藏在首個共享歸屬輔助函式中。

**向所有提供方傳送 OpenRouter 頭部。** 否決。這會把一項自訂的 OpenRouter 約定當作通用標準，並向未要求這些欄位的提供方傳送語義誤導的頭部。還有風險將 `HTTP-Referer` 當作通用應用 URL 欄位使用，儘管標準 HTTP 已有 `User-Agent` 用於產品身份、`Referer` 用於不同的瀏覽上下文概念。

**僅使用提供方帳戶/項目身份。** 否決。組織/項目頭部、API key、雲帳戶和計費項目標識的是誰付費或誰擁有請求，而非哪個應用在傳送流量。它們也不暴露公開的應用標題/類別，無法幫助 OpenRouter 等閘道建置應用排名。

**終端機使用者 `user`/`metadata` 欄位。** 本 Agent Note 否決。這些對濫用監控和客戶支持有價值，但描述的是請求背後的人或租戶。應用歸屬必須是靜態的產品身份，且可安全地在每個請求上傳送。

**僅設定啟用的歸屬。** 否決。預設關閉的設定正是配接器不斷漂移的原因。策略是強制默認歸屬加可覆蓋的公開值，而非選填歸屬。

**以 SDK 命名的 token（`deepseek-harness-sdk`）。** 曾考慮用於 `User-Agent` token，因為受支持的執行時期用戶端棧使用 SDK 名稱。`deepseek-harness` 勝出，因為它命名 DeepSeek Harness 產品、與組織／倉庫身份和包 scope 一致，並且在不把完整產品稱為 SDK 的前提下保持線路歸屬穩定。

## 後果

**提供方看到流量來自 harness。** 這正是目的，但意味著此前混在通用 SDK 流量中的部署變得可識別。緩解措施：僅傳送靜態公開產品資料，並允許 fork/白標部署傳入自己的 `AppIdentity`。

**不同用戶端庫的頭部支持有差異。** 手寫配接器直接設定頭部；基於 pi-ai 的配接器相依性 pi-ai 繼續尊重 `StreamOptions.headers`（最後合併覆蓋提供方預設值）。線路級 mock 伺服器測試是守衛：如果 pi-ai 升級後不再投遞該頭部，套件會變紅。這對抽象施加了有益的壓力：一個無法設定強制頭部的提供方配接器不能完整實作 harness 的 LLM 約定。

**OpenRouter 排名尚未受益。** `User-Agent` 是提供方無關的 HTTP 身份的正確基線，但它不會建立 OpenRouter 應用頁面或排名，因為 OpenRouter 要求 `HTTP-Referer` 來實作該產品功能。這是有意為之：公開應用市場參與是一個獨立的產品決策，不是強制請求歸屬的前提。
