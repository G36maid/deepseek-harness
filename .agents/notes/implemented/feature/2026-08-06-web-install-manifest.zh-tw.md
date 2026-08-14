# Agent Note: Web 安裝 manifest 元資料

Status: implemented

[English](2026-08-06-web-install-manifest.md) | [简体中文](2026-08-06-web-install-manifest.zh.md) | 繁體中文

## 問題

Web 建置產物已有文件標題和 favicon，卻沒有可供瀏覽器發現穩定安裝身份、啟動邊界或安裝後呈現方式的 manifest（中繼資料清單）。新增這類元資料也可能暗示應用並不具備的能力：service worker 會讓人以為應用提供離線約定，而單一語言或調色板取值會錯誤描述這個能夠解析淺色與深色主題的雙語 UI。

## 決策

Web 入口連結 `/manifest.webmanifest`，Vite 會將其從 `apps/web/public/` 複製到生產建置產物。manifest 將產品命名為 `DeepSeek Harness`，為安裝後的瀏覽器介面提供簡稱 `DSH`，並把 `id`、`start_url` 和 `scope` 固定為 `/`。它請求 `display: "fullscreen"`，使支持這一模式的瀏覽器能夠把可用顯示區域交給安裝後的編輯器式介面，同時不改變普通分頁標籤；瀏覽器可以應用使用者覆蓋設定，或回退到其他顯示模式。其圖示條目複用 `/favicon.svg`，將它作為尺寸為 `any`、用途為 `any` 的 SVG。

這一選擇沿用了 code-server 的全屏方案，但沒有照搬其 `window-controls-overlay` 顯示覆蓋項。DSH 沒有自訂標題欄，也沒有圍繞原生視窗控制元件安排版面配置，因此使用這類覆蓋項會在未落實所需安全版面配置的情況下取代全屏模式。

manifest 有意不包含 `lang`、`theme_color` 或 `background_color`。產品介面支持雙語，並不由 manifest 中的單一語言定義；任一靜態顏色值都可能與應用解析後的一套調色板不一致。因此，主題元資料仍放在安裝 manifest 之外。

該功能不新增 service worker、快取策略或離線回退。manifest 只提供安裝元資料；是否具備安裝資格、是否提供安裝入口仍由瀏覽器策略決定。實際交付的 [`dsh-host-frontend-static`](../../../../packages/host/frontend-static/README.md) 回退將 `.webmanifest` 識別為 `application/manifest+json`，因此同一資產經實際交付的 HTTP 組合提供時同樣有效，而不只在 Vite 輸出目錄中有效。

## 驗證

Web 建置產物測試解析輸出的 manifest，並固定完整的元資料對象，包括面向使用者顯示的名稱、簡稱、圖示、根路徑身份、啟動邊界和顯示模式，同時驗證生產建置的 `index.html` 仍保留該連結。`dsh-host-frontend-static` 的真實 Loader 組合測試提供一個 `.webmanifest` fixture（測試前置資料），並固定其 `application/manifest+json` 媒體類型。

## 曾考慮的替代方案

**新增 service worker，並宣稱應用支持離線。** 不予採納，因為只快取應用外殼，卻不定義工作階段傳輸、失效策略、失敗行為和升級語義，會形成具有誤導性的不完整離線約定。

**聲明單一的 `lang`。** 不予採納，因為沒有任何一種語言足以描述雙語產品介面；省略該欄位可避免聲稱安裝後的體驗由某一種區域設定獨佔。

**選擇一組靜態背景色和主題色。** 不予採納，因為應用會在執行時期解析淺色和深色調色板，因此選擇任一固定值，都是明知它與其中一種受支持狀態不符。

**立即交付光柵和可遮罩圖示變體。** 在某個受支持的安裝目標證明現有可縮放 favicon 無法滿足其要求之前，不予採納。新變體只是對 manifest 的增量擴充，並非公開當前身份的前提。

**只斷言建置產物中的根路徑欄位和顯示欄位。** 不予採納，因為產品名稱、簡稱或圖示被刪除或更改，同樣屬於已交付安裝體驗的回歸。任何 manifest 元資料發生變化時，測試都有意要求顯式改動。

## 後果

支持這一機制的瀏覽器可以發現以根路徑為作用域的穩定安裝身份和全屏偏好，而應用無需承諾離線行為。在路徑前綴下部署該建置產物時，必須同時重新審視絕對路徑的 manifest 連結，以及身份、啟動、作用域和圖示 URL。日後可能因瀏覽器特有的圖示要求而新增變體；每一項有意的元資料變更都會同步更新精確的建置產物約定。
