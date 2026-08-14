# Agent Note: 所有 /api 路由共用一道載體級瀏覽器信任邊界

Status: implemented

[English](2026-07-28-api-browser-trust-boundary.md) | [简体中文](2026-07-28-api-browser-trust-boundary.zh.md) | 繁體中文

## 問題

Web GUI 宿主以純 HTTP 提供 `/api`（默認 `127.0.0.1:3080`，支持 `--host 0.0.0.0`），而這個面上有遠端程式碼執行等級的方法——`session.prompt` 驅動的 agent（代理）可以執行 bash。瀏覽器會用兩種經典方式把操作者變成攻擊此類本機 API 的「混淆代理人」：惡意頁面寄出跨站「簡單請求」 POST（`text/plain`——不經 CORS 預檢即寄出），其副作用照常執行、只是回應不可讀；以及 DNS rebinding 後的源以「同源」身份直連 socket，CORS 整體失效，只有 `Host` 頭會暴露攻擊者的網域。在本決策之前，系統裡唯一的瀏覽器信任檢查（`isTrustedNativeDialogRequest`：回環 socket、同源、回環 Host）只守著一個裝飾性的路由——`host.pickDirectory`，其原生對話框彈在宿主螢幕上——而所有真正具有嚴重後果的方法都沒有防護。按 RPC 逐個設防也活不過應用內目錄瀏覽器：它存在的意義就是服務合法的遠端用戶端，回環規則恰恰會拒絕它們。

## 決策

在載體層對整個 `/api` 前綴一次性執行瀏覽器信任檢查——分為兩部分：

- **媒體類型柵欄（dsh-host-apiproxy）**：每個 `/api` POST 必須聲明 `application/json`，否則在解析前以 415 拒絕。跨站「簡單請求」由此不復存在：任何跨站嘗試都被逼進一次本伺服器從不應答的 CORS 預檢。
- **權威柵欄（dsh-client-connection，`src/api-request-trust.ts`）**：每個請求的 `Host` 都必須是回環地址，或與某個 `trustedHosts` 條目匹配（帶埠的 `host:port` 條目精確匹配，不帶埠的條目匹配任意埠，均經 WHATWG 歸一化；rebinding 防禦）。刻意不為無標記請求開捷徑：明文 HTTP 下瀏覽器的讀取（EventSource、圖片、導覽——這些頭只發給可信目標）既不帶 `Origin` 也不帶 Fetch-Metadata，因此無標記請求可能是被重綁頁面發起且回應可被讀走的讀取，而 Host 是重綁唯一偽造不了的請求標頭；非瀏覽器用戶端經由回環地址、推導的 LAN IP 字面量或已聲明的權威透過。若帶 `Origin` 則必須與 Host 權威完全一致；`sec-fetch-site: cross-site` 一律拒絕。不是單純規範化 authority 的 `trustedHosts` 條目會導致外掛程式載入失敗——否則 WHATWG 解析會悄悄授權筆誤裡的 hostname，或放大精確埠授權。`host.pickDirectory` 失去專屬守衛，與其他請求同柵而行。

兩條邊界刻意留在範圍之外：可達性由 webserver 的綁定設定（`host: 127.0.0.1 | 0.0.0.0`）控制；真正遠端部署的認證是延期工作，記錄在 connection README——這道柵欄是混淆代理人防禦，不是認證層。舊守衛的回環 socket 檢查被放棄而非泛化：綁定表達可達性、`trustedHosts` 點名遠端權威之後，socket 地址提供不了頭部柵欄覆蓋不到的任何東西。

## 曾考慮的替代方案

- **按 RPC 設防（延續現狀）。** 否決：守衛清單永遠追著方法清單跑，價值最高的方法本來就沒被守住，而 browse RPC 上的回環規則會破壞它們為之存在的遠端部署。
- **CORS 頭與省略憑據。** 否決：我們根本不想要任何跨源讀取，應答預檢只會擴大暴露面；拒絕預檢嚴格更強也更簡單。
- **現在就上認證權杖。** 在本變更中否決：權杖的簽發、儲存、輪換是真實的產品面；柵欄今天就能封死瀏覽器混淆代理人漏洞，無需預先決定認證設計。

## 後果

- 未來任何 `/api` 方法天然在覆蓋範圍內；不存在會被遺忘的按路由信任決定。
- 非回環部署的對外服務 authority 必須列入信任範圍，否則請求會被拒絕。dsh CLI 透過把本機 LAN IP 字面量推導進 connection 行（不帶埠的條目——IP 字面量 Host 不可能是被重綁的網域，且綁定埠可能由作業系統分配）來保住它公佈的 `--host 0.0.0.0` LAN URL，並提供 `dsh web --trusted-host` 聲明具名權威；並非由 CLI 啟動的組合自行聲明 `trustedHosts`。非瀏覽器自動化走同一道柵欄：回環地址、推導的 LAN IP 或已聲明的權威可透過；未聲明的 DNS 別名會被拒絕。
- 用戶端必須給 POST 體標注 `application/json`（我們自己的用戶端一向如此；裸 fetch 測試補上了該頭）。
- 無認證 `0.0.0.0` 部署的「可信網路」假設從隱含變為成文。
