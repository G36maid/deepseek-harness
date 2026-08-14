# @deepseek-ai/dsh-client-web

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

Web 外殼核心：`new AppWebEntry(el, seams?).run()` 透過兩階段啟動（web2）掛載整個用戶端。第一階段（模組側）：建置用戶端模組系統（`@deepseek-ai/dsh-client-modules`），以主機推送的設定項圖（`window.__DSH_BOOT__`）為基礎，平行預取 `immediately` 層級；執行組合包只會註冊 factory。第二階段（外掛程式側）：掛載倉庫內建的 Cordis Loader，並透過其 `internal` 約定注入模組系統；為每一行圖資料建立一個 loader 設定項，另建立外殼自身的 app-shell 組裝設定項（tree.import 會物化各模組）；以 settle 作為 AppRoot 的閘門（loader 完全靜止 + 每個設定項 fiber 都為 ACTIVE → 一次切換顯示完整 UI）。組合完全由主機圖決定：花名冊和 immediately 層級都位於負責組合的應用中；外殼不作任何組合決策。

外殼自給自足（web2 硬性規則）：核心不對任何外掛程式包執行值匯入；啟動狀態 store 與訊號在這裡手寫（`loader-status.ts`），因此即使外掛程式失敗，載入頁面仍能工作，而此時這一點尤其重要。app-shell 組裝（`@deepseek-ai/dsh-client-app-shell`，由外殼擁有、背後沒有 npm 包的偽設定項）是唯一透過 `registerStatic` 註冊的模組；它與任何外掛程式一樣，透過 inject 等待 slots/sessions/layout。

`PLATFORM_MODULES`（src/platform.ts）是共享模組介面的唯一真源：種子表 key、tsdown 用戶端 external 和 vite alias 集都是它的投影。

選填的覆蓋參數 `seams` 會為外部 `<script>` 執行無法到達頁面上下文的環境轉發模組系統的 `loadBundle` 傳輸覆蓋（`BootSeams`）；普通瀏覽器呼叫方省略此參數。

外殼擁有瀏覽器標題投影。選中帶有持久標題的工作階段時，它會渲染 `<session title> — <existing HTML title>` 並回應後續標題修訂；未選擇工作階段或選中無標題工作階段時，會保留現有標題；外殼解除安裝時復原標題。現有 HTML 標題仍是可設定的產品後綴。

## 模型體驗

無。入口外殼負責啟動瀏覽器外掛程式樹；這裡沒有任何內容進入模型請求。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **有意採用一次性渲染**：UI 等待啟動 settle；只要一個設定項失敗，載入頁面就會保留並逐項顯示醒目的報告，不提供部分可用性（漸進式渲染將作為獨立項目復原）。
- **窄視窗外殼行為缺少組裝後演練**：ui-layout 已實作讓步鏈，但該包沒有外殼級窄視口驗收用例。
