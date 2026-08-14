# Agent Note: Web 工作階段日誌匯出——宿主流式 ZIP 下載

狀態：implemented

[English](2026-08-10-web-session-log-export.md) | [简体中文](2026-08-10-web-session-log-export.zh.md) | 繁體中文

## 問題

Trajectory 檢視表沒有任何方式把除錯工件交到人手裡：原始工作階段日誌存放在磁碟與宿主側，用戶端歷史面只提供摺疊後的投影（而非原始事件），而帶子代理的工作階段橫跨多個相互獨立的工作階段日誌。bug 報告需要整棵工作階段樹的完整原始日誌，並且形態要能在被轉發後仍然可用。

## 決策

- **匯出是宿主側的下載面，不是 RPC**：`GET /api/session.export?sessionId=…&includeDescendants=true` 流式返回一個 ZIP 附件。每個文件都是工作階段**儲存工件的逐字原文**：持久化服務新增的 `readRaw` 讀取後端自己的持久化位元組（jsonl 後端解碼其物理 zstd 幀，或直接返回明文）——絕非從解析後事件重建，因此 chunk 打包、鍵序、換行全部逐位元組保留——放在其原始基礎檔名下（根為 `session.jsonl`，子代理為 `subagents/<id>/session.jsonl`）。壓縮在宿主側使用 fflate 流式 `Zip`/`ZipDeflate` API 和已驗證的 `sessionExportCompressionLevel` 0–9（默認 6），使部署可以在 CPU／延遲與歸檔大小之間取捨；每個條目按有界分塊邊產出邊壓縮，回應隨生成分塊寫出，宿主從不把整個歸檔放進單個緩衝區（除預載的根外，最多同時持有一條後代的工件文字）。到達 64 KiB 回應位元組高水位後，生產會等待 Consumer pull 復原容量；fflate 的同步回呼最多隻會在該佇列界限外再增加一次有界輸入 push。不寫清單——每個文件都與持久化工件逐位元組一致，並透過自身 header 行自描述。
- **錯誤詞彙是 HTTP 原生的**：服務缺失 → 500，後端不提供每工作階段原始工件 → 501，根工作階段缺失 → 404（三者都在任何位元組流出前判定），後代缺少儲存工件 → 流失敗（fail-loud，絕不靜默少匯出）。請求中止會保持取消語義而不會改寫成 500；請求取消與回應 Consumer 取消匯合到生產者 signal，該 signal 會傳到血緣、持久化與附件讀取，並終止活躍壓縮器。載體（`toFetchHandler`）已對 `/api` 應用信任圍欄；GET 分支與既有 SSE GET 路由並列，由 `ApiProxy.downloads.sessionLog`（host-only、無 wire 信封、不在 `IApiClient` 上）實作。
- **UI 只負責下載**：瀏覽器 Consumer 可以先發出不讀取 body 的 `HEAD` 預檢以取得準備階段錯誤，再把 GET 端點交給瀏覽器原生下載管理器，因此 JavaScript 不會緩衝 ZIP。早先迭代發布的 `session.log` RPC 已刪除——下載端點是它唯一的消費者，倉庫規則是不留無當前所有者的公共介面。用戶端 bundle 不包含任何歸檔實作。
- 當前 Header 與 `/export` Consumer 由 [Web 匯出命令與彈出視窗決策](2026-08-11-web-export-command-and-dialog.md)定義。

## 考慮過的替代方案

- **`session.log` 資料 RPC + 用戶端打包**——先發布，後與使用者共同否決：瀏覽器要拉取完整原始 JSON（約為最終 zip 的 10 倍）並在主線程壓縮；對實際使用中 23 MB 等級的工作階段，宿主流式嚴格更優。遷移時把該 RPC 一並刪除，而不是留作無消費者的公共介面。
- **用信封行把多工作階段編碼進單一 JSONL**——與使用者共同否決：把多個工作階段混進一個 JSONL 會失去幹淨的按文件邊界；ZIP 讓每個工作階段保持一個規範文件。
- **jszip**——更重（約 100 kB），相依性圖還會拉入 readable-stream 的瀏覽器對映；fflate 專為此而生且體積小。
- **將 fflate 瀏覽器入口 vendoring 進倉庫**——倉庫的 vendoring 流程面向 cordis 等級的固定原始碼；resolveId 別名在保持維護中的相依性的同時無需複製程式碼（宿主側 fflate 根本不需要別名）。

## 後果

- 匯出保真度：讀取每個即時根工作階段或後代前，匯出器會透過權威的 `SessionStore.flush` 持久性屏障；每個匯出文件都與由此得到的持久化工件逐位元組一致。即時工作階段可能在自身讀取後再次追加，因此歸檔是按工作階段讀取邊界形成的快照，而不是整棵樹的原子快照。壓縮包名為 `dsh-session-<sanitized-id>.zip`，歸檔路徑在塑造條目前會先淨化工作階段 id。
- `supportsRawArtifacts` 明確區分後端能力與工作階段缺失：SQLite 等不支持的後端報告 `false`，具體 `readRaw` 默認會拒絕；JSONL 覆寫則報告 `true`、自持物理解碼，並只用 `undefined` 表示工件缺失。`ApiProxy.downloads.sessionLog` 為契約新增一個 host-only 成員，外加宿主側 query schema，並在 fetch handler 加一個 GET 分支——沒有 RPC map 行、信封 schema 或用戶端 `IApiClient` 面。
- fixture 模式（無宿主）對匯出應答 404，瀏覽器會將其報告為下載失敗；navigation-panes golden 快照包含「匯出」按鈕。
- 暫緩：transcript.md 以及 report/feedback 打包留待後續；逐位元組忠實、無清單的形態讓 v2 的打包擴充保持廉價。
