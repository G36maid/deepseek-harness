# Agent Note: 瀏覽器下行 WebSocket 載體

Status: implemented

[English](2026-08-04-websocket-downlink-carrier.md) | [简体中文](2026-08-04-websocket-downlink-carrier.zh.md) | 繁體中文

## Problem

瀏覽器 Web GUI 的 `events.mux` 與 `events.host` 長期使用兩條 SSE（Server-Sent Events）回應。HTTP/1.1 瀏覽器通常只允許每個來源約六條並行連線；每個頁面永久佔住兩條會讓同源多分頁標籤、外掛程式資源和普通 RPC 爭搶連線槽，達到上限後不是降速而是排隊阻塞。RPC 協議本身是通道無關的，約束來自瀏覽器物理載體，不應滲入工作階段/執行時期對象層。

## Decision

瀏覽器真實載體為兩類下行流各開一條獨立 WebSocket：`/api/events.mux` 只發送 `MuxFrame`，`/api/events.host` 只發送 `HostFrame`。每條文字訊息是一份完整的 `ServerRequest` JSON；用戶端繼續先校驗信封，再按路徑校驗具體 frame union，並把窄形 `RpcRequest<Frame>` 交給既有 `ConnectionController`。兩條流保持獨立生命週期和無跨流順序保證，任一條結束仍使整個 connection generation 失敗並按既有退避策略重建。

WebSocket 只承擔 host→browser 下行。所有 client→host unary 呼叫和對 server request 的 `respond` 繼續使用既有 `POST /api/*`；不在 WebSocket 上接收任何用戶端業務訊息。`WebApiClient` 因而同時持有 HTTP `fetch` 上行與 WebSocket 下行，而 fixture（測試前置資料）和 `InProcessApiClient(toFetchHandler(api))` 繼續實作同一 `IApiClient` 雙流抽象。行程內 fetch 載體保留 SSE 編解碼來檢驗通道無關的協議同構，但網路上對 `/api/events.*` 的 GET 請求只返回 upgrade required，不作為瀏覽器相容回退。

## Upgrade 與生命週期邊界

`dsh-host-webserver` 提供與普通 route 並列的精確 upgrade-route 註冊點，只按 pathname 分發 Node upgrade socket，隔離原始 socket 錯誤，並在 server teardown 期間等待仍存活的升級連線關閉；它不認識 Harness 幀或 WebSocket 訊息。`dsh-client-connection` 擁有 WebSocket handshake、frame 寫出和流取消，並在 upgrade 前複用 `/api` 的 Host／Origin 信任柵欄。未受信任的 authority 或跨來源 Origin 在 `ctx.apiProxy.events.*` 啟動前即被拒絕。

瀏覽器 abort 或 socket close 會取消對應的 host 流；外掛程式 teardown 還會等待該 source iterator 完成清理。host 流中途拋錯時，載體傳送一個現有的 `stream/error` frame 後關閉 socket；用戶端把該 frame 收斂為連線丟失，不投遞給業務 sink。每條 WebSocket 獨立報告 open，既有 readiness handshake 仍等待 mux、host 都 open 且 `host.describe` HTTP 呼叫成功後才發布 connected。

## Verification

webserver 約定測試釘住 upgrade pathname 分發、重複註冊拒絕、資源釋放與 teardown；connection 的真實網路測試釘住兩條 WebSocket 各自的信任檢查、open、schema 信封、frame 順序、流錯誤與關閉時取消；用戶端測試同時證明下行建立 `ws:`／`wss:` URL，而 unary 與 `respond` 仍呼叫 HTTP `fetch`。組裝後的 keyless 瀏覽器重播繼續覆蓋 Chromium、真實 host、HTTP 上行與 WebSocket 下行整鏈。

## Alternatives considered

**用一條 WebSocket 複用 mux 與 host。** 這會新增 channel tag、複用佇列與單連線背壓策略，並改變現有雙流 readiness 語義；兩條 WebSocket 已避開 HTTP/1.1 六連線上限，同時讓本次變更保持在物理載體層。

**把 unary 與 respond 一並遷入全雙工 WebSocket。** 這會改寫逾時、取消、HTTP 狀態、信任柵欄和請求關聯行為，卻不能為當前的下行連線槽問題帶來額外收益；上行 HTTP 是明確保留的邊界。

**保留網路 SSE 回退。** 雙載體會讓生產瀏覽器路徑可因代理或握手差異靜默分叉，並讓連線上限問題繼續存在於一個受支持分支；預發布階段只交付 WebSocket 下行，失敗由既有重連與連線狀態顯式呈現。

**相依性 HTTP/2 擴大並行連線能力。** 內建開發伺服器是明文 Node HTTP/1.1，部署前置代理也不是產品可相依性的不變式；物理下行應直接使用不受該連線池限制的瀏覽器原語。

## Consequences

每個 Web 頁面仍有兩條長期下行連線，但它們不再消耗瀏覽器的 HTTP/1.1 六連線配額；執行時期繼續消費原有雙流並保留所有重連、流修復和跨流無序語義。代價是 webserver 多一個 upgrade 註冊面，connection 包的 host 半側新增一項 WebSocket 實作相依性，並需分別維護瀏覽器 WebSocket 與行程內 SSE 兩種物理編解碼；它們共享同一 `ServerRequest`／frame schema 和 `IApiClient` 語義，避免形成第二套業務協議。
