# @deepseek-ai/dsh-client-ui-theme

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

主題外掛程式：基於 --dsw-* token 基礎樣式表（靜態尺度 + 別名語義層）的 ThemeRuntime。該服務擁有即時主題偏好（`light`／`dark`／`system`），將 `system` 透過 `prefers-color-scheme` 解析為實際主題，並行布不可變的 `ThemeSnapshot`，透過 `theme/change` 事件通知變化；它絕不接觸 DOM：ui-layout 的呈現器會應用解析後的快照（`html { color-scheme }`、`body[data-ds-dark-theme]`，以及主題的別名 token 內聯變數）。來自回環地址的瀏覽器會先以 `system` 立即提供該服務，隨後在後臺載入 `ui-theme.preference`，並將每次內建主題選擇透過 Host settings API 寫入；其本機提供方預設將設定存入 `$DSH_HOME/settings.yaml`。收到推送的 settings 變更時或重連後，瀏覽器都會重新拉取該設定；連續快速選擇會按操作順序攜帶 namespace revision 序列寫入，最新寫入被拒時則重新載入持久化值。遠端瀏覽器無法訪問特權 settings API，因此它的選擇僅保留在行程內。已註冊的第三方主題 id 仍是行程內擴充，不會跨越內建 settings schema；移除其中任意一個都絕不會覆蓋最後一個持久化的內建偏好。該持久化邊界由[Host settings 支撐的偏好決策](../../../.agents/notes/implemented/bug-fix/2026-08-06-host-backed-web-preferences.md)擁有。

當主機組合包含 HTTP 伺服器時，主機側緊接 `<body>` 起始標籤注入同步引導程式碼。每份 index 回應會嵌入已註冊的 Host 設定 `ui-theme.preference`，沒有 settings provider 時則嵌入 `system`；瀏覽器按作業系統配色解析 `system`，隨後在外殼載入頁面算繪前設定 `color-scheme` 和 `body[data-ds-dark-theme]`。不含 HTTP 伺服器的組合不受影響，外掛程式樹啟用後，ThemeRuntime 與 ui-layout 仍分別是用戶端狀態和後續 DOM 更新的權威來源。

`src/styles/` 下有五張樣式表，全部由 web 殼的 `base.css` 匯入：`base.css`、`design-platform.css`、`scrollbar.css`、`gradient-shadow-text.css` 與 `shiki.css`。`scrollbar.css` 是 `--dsw-alias-scrollbar-*` token 的唯一消費端，必須排在聲明這些 token 的 `design-platform.css` 之後。

捲軸重新綁定約定：`scrollbar.css` 在 `body` 上把 `--dsh-scrollbar-thumb` 與 `--dsh-scrollbar-thumb-hover` 綁定到 l1（基礎表面）token，兩條算繪路徑都讀取這一組變數。高層級表面（選單、浮層、對話框）在自己的容器上設定 `--dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2)` 與 `--dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2)`；一次重新綁定即可為引擎實際走的那條路徑換色。這組變數的另一個合法目標是 `transparent`，即完全不繪製滑桿——[ui-sidebar](../ui-sidebar/README.md) 在指針不在欄內時就這樣重新綁定自己的列。綁回 l1 那組不算重新綁定，它只是重述基礎表面的預設值。`--dsh-scrollbar-width` 映像檔 WebKit 捲軸的版面配置寬度，供需要與佔版面配置寬度的捲軸對齊的表面使用——[ui-conversation](../ui-conversation/README.md) 用它作為覆蓋 composer 座位 `right` 偏移——scrollbar-styles 規格把它與映像檔規則及消費者配對檢查。

兩條路徑在構造上互斥。`scrollbar-width`／`scrollbar-color` 寫在 `@supports not selector(::-webkit-scrollbar)` 之內，因為這兩個屬性中的任一個只要取非 `auto` 值，Chromium 與 Safari 就會丟棄該元素上的全部 `::-webkit-scrollbar*` 規則，`::-webkit-scrollbar-thumb:hover` 也在其中——若無條件地同時聲明，`--dsh-scrollbar-thumb-hover` 在任何引擎上都不會被算繪。因此 Firefox 走標準屬性，WebKit 系引擎走偽元素，hover token 只經由偽元素這條路徑算繪。相關原理與實測計算值見[捲軸 Agent Note](../../../.agents/notes/implemented/bug-fix/2026-07-28-themed-scrollbars-and-reserved-gutter.md)。

## 模型體驗

無。主題服務管理瀏覽器偏好；這裡沒有任何內容進入模型請求。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **第三方主題是表層，不是產品**：註冊主題意味著覆蓋同名別名變數；目前不會驗證一組覆蓋是否完整。
- **token 樣式表是顏色值的唯一權威來源**：會有意不補入 cssdesign 中缺失的值（例如設計中的 #4176E6 分頁標籤藍色）；一律採用最接近的語義 token。設計負責人批准的新增值是例外：須在同一變更中以一個靜態尺度層級與一個語義別名的形式進入（`--dsw-static-blue-900` / `--dsw-alias-label-primary-bluish`）。
