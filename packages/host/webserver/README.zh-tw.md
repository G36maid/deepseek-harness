# @deepseek-ai/dsh-host-webserver

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

Web HTTP 與 upgrade route 註冊外掛程式（預設匯出 `WebServer`，設定為 `{host, port}`）：一個在啟用時開始監聽的 `node:http` 伺服器，提供 `ctx.webServer`。`register(route)` 新增具名的 `exact`／`prefix` HTTP route；`registerUpgrade(route)` 新增精確 pathname 的 upgrade route；同一張表內的重複路徑會拋錯，因為 route 模式是組合層約定，衝突即設定錯誤；兩者返回的 disposer 都會移除註冊。`registerFallback(handler)` 註冊一個 handler，處理所有未被具名 route 命中的請求。第二次註冊會拋錯；隨附的 SPA dist 伺服器 [`dsh-host-frontend-static`](../frontend-static/README.md) 是該 handler 的所有者，沒有註冊 handler 時伺服器返回 404。`tapIndex(transform)` 新增一個 index.html 轉換，`applyIndexTaps(html)` 按註冊順序對一段回應體執行已註冊的轉換；fallback handler 在每次 index 回應時呼叫它。`port` 讀取正在監聽的埠（當 `port` 為 0 時讀取 OS 分配的值），`host` 讀取設定的綁定宿主（這些是其他外掛程式據以自適應的組合期事實，例如 directory-picker 選擇器）。HTTP 匹配順序固定不變：先在整張表中匹配精確 route，再匹配最長前綴，最後交給 fallback handler。upgrade 只做精確匹配，未命中連線直接關閉；註冊順序不影響請求處理。

該包不瞭解任何 harness 概念，也不提供任何文件服務：`/api` HTTP 橋接與下行 WebSocket 是 connection 外掛程式的 route，外掛程式 bundle 與 HMR（熱模組替換）事件串流是 modules／hmr 外掛程式的 route，dist 服務則屬於 fallback 持有者。upgrade handler 擁有協定握手與連線內容；webserver 只交付原始 socket 與 request。`host` 只接受 `127.0.0.1`（預設安全姿態）和 `0.0.0.0`（有意向網路開放）。該伺服器只服務瀏覽器；Electron 透過 `file://` 載入 dist，並經 IPC 橋接承載 fetch。該包從不列印內容；URL 行屬於 shell。

監聽失敗（EADDRINUSE……）會從啟用程序拋出，並以綁定診斷資訊拒絕 Loader 組合；失敗的候選 fiber 會被 dispose（資源釋放）。處理 HTTP 請求時拋錯（例如 fallback 持有者的 `decodeURIComponent` 收到格式錯誤的百分號轉義，或用戶端在請求體傳輸中途中斷連線）時，伺服器會回應 400；若回應標頭已經寄出，則銷毀 socket，並記錄 warning，但絕不會結束行程。upgrade handler 拋錯或升級 socket 出現傳輸錯誤時，會記錄 warning 並銷毀對應 socket。資源釋放會啟動 `close()` 與 `closeAllConnections()`，銷毀所有受跟蹤的升級 socket，並僅在 HTTP server 與這些 socket 均已關閉後返回。

## 模型體驗

無。該包只是瀏覽器與其他外掛程式所註冊 HTTP／upgrade route 之間的 Web 載體，其中沒有任何內容會進入模型請求。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **不提供 TLS、驗證或來源策略**：綁定非回環地址會向對應網路公開伺服器；面向部署的加固措施（或在前方放置真正的反向代理）有意不納入面向開發環境的 v1。
- **Socket 選項固定不變**：設定只選擇綁定宿主與埠；在具體部署產生需求前，backlog 和其他 socket 設定仍保持內部實作。
