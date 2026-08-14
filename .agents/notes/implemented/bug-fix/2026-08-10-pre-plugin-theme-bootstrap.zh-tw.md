# Agent Note: 外掛程式啟用前的主題引導

Status: implemented

[English](2026-08-10-pre-plugin-theme-bootstrap.md) | [简体中文](2026-08-10-pre-plugin-theme-bootstrap.zh.md) | 繁體中文

## 問題

Web 殼在瀏覽器側外掛程式樹啟用前呈現 `Loading plugins…`。主題 token 已隨殼樣式載入，但 `color-scheme` 和 `body[data-ds-dark-theme]` 要等 ui-theme 的 ThemeRuntime 與 ui-layout 的 ThemePresenter 啟用後才寫入；持久化偏好為深色時，載入頁因此先按淺色調色板繪製，再切為深色。

`dshClient.immediately` 只把 bundle 納入第一階段預取，不會讓外掛程式在 HTML 解析或殼首次渲染前執行。僅調整用戶端外掛程式的載入檔位無法關閉這段時間視窗。

## 決策

ui-theme 的主機側透過 `ctx.webServer.tapIndex()` 轉換每份 index HTML，在 `<body>` 起始標籤後緊接一段同步內聯指令碼。該轉換透過選填的 `httpServer` 注入註冊，因此不含該服務的組合仍會啟用 ui-theme，但不會安裝轉換。HTML 解析器執行該指令碼時，body 已存在，而殼的模組指令碼與 React 根節點尚未執行。

settings provider 存在時，主機側會註冊 [`ui-theme.preference` settings 分節](2026-08-06-host-backed-web-preferences.md)。它為每份 index 回應把經過 schema 校驗的內建偏好嵌入內聯指令碼；不存在 settings provider 或有效註冊時則嵌入預設值 `system`。瀏覽器透過 `prefers-color-scheme` 解析 `system`，不支持 `matchMedia` 時回退為淺色。指令碼只寫 ThemePresenter 後續擁有的兩項 DOM 狀態：`document.documentElement.style.colorScheme` 與 `body[data-ds-dark-theme]`。

引導邏輯只認識內建的 `light`、`dark`、`system` 語義，不註冊監聽器，也不解析第三方主題或 token 覆蓋。瀏覽器側外掛程式樹啟用後，ThemeRuntime 仍是主題狀態的權威來源，ThemePresenter 會把完整解析結果重新寫入同一組 DOM 狀態並負責後續更新與釋放。

## 驗證

ui-theme 的單元測試覆蓋不含任一選填 Host 服務時的啟用、指令碼位置、Host 設定優先級、系統偏好、缺少 `matchMedia`、不含 body 的輸入、即時讀取 settings，以及 Host 註冊隨外掛程式 fiber 一同釋放。真實 Web 組合的 Chromium 場景會選擇持久化深色偏好並攔住外掛程式 bundle 請求，使載入頁保持可觀察，再斷言 index 回應產生了深色背景、body 屬性和根元素 `color-scheme`。該變化不改變可訪問性樹，因此不產生新的頁面 golden。

## 考慮過的替代方案

**把邏輯固定寫進 `apps/web/index.html`。** 這樣能在相同時機執行，但靜態 HTML 無法嵌入當前 Host 設定，還會複製 ui-theme 擁有的偏好解析和 DOM 欄位；Host 轉換會跟隨主題外掛程式的生命週期，並讓應用殼無需瞭解主題領域。

**讓 ui-theme 用戶端 bundle 同步或更早啟用。** `immediately` 只控制預取，外掛程式實例化仍發生在殼開始執行之後；把首次渲染阻塞到 ThemeRuntime 啟用會延後可見的載入與報錯介面，也會讓殼的故障呈現相依性被它監測的外掛程式樹。

**只相依性 `prefers-color-scheme` 的 CSS。** 媒體查詢無法讀取顯式持久化選擇，因此作業系統為淺色而使用者選擇深色時仍會閃爍。

**在 `<head>` 中執行並給 html 新增臨時類。** body 此時尚不存在，還需要一套與正式調色板屬性不同的臨時選擇器。緊接 `<body>` 是能夠直接寫正式 DOM 欄位的最早解析位置。

## 後果

載入頁首幀與持久化內建偏好一致；未組合 settings provider 時則默認採用系統偏好。index 轉換會為每份回應讀取 Host settings，而內聯指令碼只包含選定的內建值與 `system` 解析邏輯。內建偏好語義或 ThemePresenter DOM 欄位變化時，必須同時更新指令碼與 ThemeRuntime。自訂主題仍會在瀏覽器外掛程式啟用後才完整應用；載入期間，頁面使用該主題解析後的淺色或深色基礎調色板。
