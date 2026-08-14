# Agent Note: DeepSeek 請求使用者與工作階段身份頭部

Status: implemented

[English](2026-08-11-deepseek-request-user-id-header.md) | [简体中文](2026-08-11-deepseek-request-user-id-header.zh.md) | 繁體中文

## 問題

當呼叫方提供 `GenerateOptions.sessionId` 時，直連 DeepSeek 請求已攜帶 `x-deepseek-harness-session-id`，讓提供方側支持與診斷可以關聯同一對話中的多個輪次。但請求缺少跨工作階段的穩定身份，而 harness 已為遙測與回饋持久化匿名使用者 id。另行生成 id 會破壞關聯；把它放進提供方無關的歸屬輔助函式，則會讓每個 HTTP 配接器都發送穩定的逐使用者標識。

使用者 id 是傳輸元資料，不是模型輸入。它不得進入請求體、提示詞、token 計量、KV cache 身份或工作階段日誌。傳送目標是配接器解析後的 `baseURL`，既可能是 DeepSeek 自身，也可能是設定的閘道，因此必須明確隱私邊界。

## 決策

`dsh-llm-deepseek` 在憑據解析成功後寄出的每個提供方請求上傳送 `x-deepseek-harness-user-id`。該值來自 `@deepseek-ai/dsh-anonymous-user-id`，因此與同一 `$DSH_HOME` 的 OpenTelemetry Resource `user.id` 及 `/feedback` 確認一致。配接器繼續僅在存在 `GenerateOptions.sessionId` 時傳送 `x-deepseek-harness-session-id`；普通 agent、標題生成與壓縮請求由 agent loop 提供當前持久化 `Session.id`。

外掛程式在憑據解析成功後惰性取得使用者 id，並在該外掛程式實例內快取。缺少憑據不會建立 `.anonymous-user-id`；即使設定了 `DSH_TELEMETRY_DISABLED`，首個已授權的提供方請求仍可能建立它。直連配接器構造函式接收 `resolveUserId` 相依性，使線路行為可在單元測試中保持確定性。

兩個頭部都是傳送到解析後 `baseURL` 的模型不可見 HTTP 元資料。它們不在 JSON 請求體中，也不會成為模型可見輸入或工作階段事件。設定的閘道會收到它們。遙測共享只控制遙測匯出，不會停用提供方請求身份。

## 驗證

- mock 提供方斷言已授權請求攜帶 `getOrCreateAnonymousUserId()` 返回的同一使用者 id，並在未提供工作階段 id 時省略工作階段頭部。
- 工作階段身份線路測試斷言兩個頭部都存在，並原樣保留傳入的工作階段 id。
- 直連配接器測試斷言每條 stream 僅解析一次使用者 id，keyless 設定測試則證明憑據失敗不會建立 `.anonymous-user-id`。
- 真實 Loader 組合測試斷言組裝後的外掛程式使用共享 user-id 包，而非測試專用值。
- 無需修改 keyless snapshot，因為這些頭部不是模型可見或使用者可見的 transcript 內容。

## 考慮過的替代方案

| 已否決 | 原因 |
|---|---|
| 把 id 加進通用 `attributionHeaders()` | 該輔助函式是提供方無關且靜態的；加入逐使用者值會把它傳送給無關提供方，並違反其應用身份隱私契約 |
| 在 `cordis.yml` 中設定固定自訂頭部 | 部署設定無法推導當前工作階段 id，且會把穩定身份暴露為可變設定，而不是使用其所屬執行時期契約 |
| 生成 DeepSeek 專用使用者 id | 提供方請求將無法與同一 harness home 的遙測和回饋關聯 |
| 隨遙測共享關閉該頭部 | 提供方請求身份與遙測匯出的接收方和目的不同；共用開關會掩蓋真實隱私邊界 |
| 把 id 放進 OpenAI 相容的 `user` 或 `metadata` 請求欄位 | body 欄位可能影響提供方 schema、日誌、快取、token 化或模型可見重建；HTTP 元資料可保留預期邊界 |

## 後果

- DeepSeek 支持可以透過一個匿名 harness-home id 跨工作階段關聯請求，並透過持久化 session id 關聯同一對話。
- 首個已授權 DeepSeek 請求可獨立於遙測匯出建立 `$DSH_HOME/.anonymous-user-id`。
- 自訂 DeepSeek 閘道會收到穩定使用者 id 與可用的工作階段 id，因此運維方必須將設定的 `baseURL` 視為身份接收方。
- 請求體、提示詞、token 數、KV cache 身份和工作階段日誌保持不變。
