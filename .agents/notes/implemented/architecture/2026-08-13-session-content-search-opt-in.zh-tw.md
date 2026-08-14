# Agent Note: 工作階段內容搜尋透過 openAt never 以 opt-in 方式交付

Status: implemented

[English](2026-08-13-session-content-search-opt-in.md) | [简体中文](2026-08-13-session-content-search-opt-in.zh.md) | 繁體中文

## 問題

交付的 bundle 之前以啟用狀態掛載 SQLite 工作階段查詢提供方的全文索引（`openAt: first-search`），因此每個默認部署都攜帶一個派生 FTS 索引，Web 側邊欄提供內容搜尋。一個部署是否需要該索引——它的 node:sqlite 匯入、每次搜尋的來源對帳和派生儲存——是部署自身的選擇，產品默認不攜帶它交付；面向模型的搜尋工具此前已經是 opt-in 且未掛載（見[非默認交付決策](../feature/2026-08-02-session-search-not-shipped-default.md)）。

透過解除安裝外掛程式行來關閉該能力不可行。`ApiProxyService` 將 `sessionQuery` 聲明為必需注入，沒有該提供方時整個宿主 API 閘道保持未載入，Web GUI 無法啟動。工作階段日誌匯出透過 `ctx.sessionQuery.traceSession` 追蹤子代理後代，子代理分叉也透過同一血緣追蹤解析其 Workspace——兩者都需要選填服務守衛加一個替代血緣來源，改動面大約擴大三倍，同時使精確讀取在所有地方消失。

## 決策

內容搜尋在提供方處強制關閉。`openAt: 'never'` 是 `@deepseek-ai/dsh-session-query-sqlite` 的第三個打開階段：`searchSessions` 和 `searchEvents` 在任何請求規範化之前就以類型化的 `SESSION_QUERY_SEARCH_DISABLED` 程式碼失敗，node:sqlite 絕不會被匯入或打開，也不執行任何來源觀察或對帳。`ctx.sessionQuery` 上繼承的全部精確讀取、過濾和跟蹤保持可用，因此工作階段匯出、分叉的 Workspace 繼承和標題讀取不受影響。

`SESSION_QUERY_SEARCH_DISABLED` 加入封閉的 `SessionQueryErrorCode` 分類，`tool-session-query` 的服務邊界將它對映為模型安全訊息 `session search is disabled in this deployment`。

base bundle 在 `session-query-sqlite` 行上設定 `openAt: never`，web bundle 的重述保持該值；啟用內容搜尋只需在後續 patch 層用一行覆蓋 `openAt`（`first-search` 或 `startup`），通常同時配一個持久 `path`。宿主 `session.search` 端點沿現有錯誤路徑報告提供方失敗，Web 側邊欄保持其既有降級：本機標題/工作區匹配加內容搜尋不可用提示。CLI 相容性測試固定交付的 `openAt: never` 行，而 Web e2e 腳手架保持內容搜尋啟用——其種子工作階段場景透過內容搜尋導覽，這些執行也是 opt-in 路徑的裝配級覆蓋。

## 曾考慮的替代方案

- **解除安裝外掛程式行**（在 base patch 中 `disabled: true`）——否決：api-gateway 的必需 `sessionQuery` 注入會使整個宿主 API 保持未載入，而把該注入改為選填需要守衛加上工作階段匯出與分叉解析中的 header 遍歷血緣回退。
- **在消費端處關閉**（宿主 `session.search` 端點或側邊欄）——否決：強制應由做出決定的操作執行；opt-in 的模型工具或任何其他消費端仍會觸達索引。
- **在 `openAt` 旁增加獨立布林開關**——否決：打開階段已經擁有"SQLite 何時啟動"這一軸；`never` 延伸同一根軸，而不是增加一個可能與之矛盾的第二個旋鈕。

## 結果

- 默認部署不執行任何派生索引：沒有 node:sqlite 匯入或實驗性 SQLite 啟動警告，沒有對帳工作，磁碟上沒有派生資料庫。側邊欄搜尋只匹配工作階段標題和工作區名稱。
- 默認狀態下的搜尋失敗是類型化且穩定的，呼叫方可以把部署選擇與索引故障（`SESSION_QUERY_INDEX_FAILED`）區分開。
- 重新啟用內容搜尋是逐部署設定而非程式碼改動，並原樣復原完整的 FTS 行為。
- 掛載搜尋工具但未覆蓋 `openAt` 的組合，每次搜尋呼叫都會得到模型安全的已停用訊息；啟用工具意味著同時啟用索引。
