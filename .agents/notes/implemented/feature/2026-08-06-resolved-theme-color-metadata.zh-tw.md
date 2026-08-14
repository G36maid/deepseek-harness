# Agent Note: 基於解析後主題的顏色元資料

Status: implemented

[English](2026-08-06-resolved-theme-color-metadata.md) | [简体中文](2026-08-06-resolved-theme-color-metadata.zh.md) | 繁體中文

## 問題

Web 用戶端可以獨立於作業系統偏好解析主題，因此 manifest（中繼資料清單）中單一的 `theme_color` 值或帶媒體條件的靜態元資料可能與顯式選擇的 Light 或 Dark 不一致。此時，無論是已安裝頁面還是普通頁面，其周圍的瀏覽器介面都未必與應用介面一致，儘管版面配置呈現器已經擁有解析後的 document 調色板。

## 決策

ui-layout 的 `ThemePresenter` 擁有一個 `<meta name="theme-color">`，與根元素上的 `color-scheme`、深色調色板屬性和內聯 token 寫入並列。在應用解析後快照的調色板與 token 覆蓋值之後，呈現器讀取 body 計算樣式中的 `background-color`，寫入該元資料元素，再將該節點插入 document head。後續快照會更新同一節點，資源釋放時則移除它。

渲染後的 body 背景仍是顏色真源。PWA manifest 不包含靜態 `theme_color` 或 `background_color`，`ThemeDefinition` 也不新增可能與 token 調色板偏離的第二個顏色欄位。這樣一來，註冊主題的基礎背景 token 也能透過頁面介面使用的同一條應用路徑作用於瀏覽器介面。

## 驗證

呈現器的單元測試約定覆蓋淺色和深色模式下的計算顏色、節點複用及資源釋放。ui-layout 組合測試覆蓋初始插入、事件驅動的複用和 fiber 清理。Web 瀏覽器設定場景透過實際交付的組合依次驅動 Light、Dark、System、作業系統偏好變化和重新載入，並斷言頁面始終只有一個元資料元素，其內容等於計算後的 body 背景且控制台無錯誤。這項元資料變更不會出現在渲染後的無障礙樹輸出中，因此場景現有的預期輸出保持不變。

## 曾考慮的替代方案

**在 manifest 中設定 `theme_color`。** manifest 只能提供一個適用於整個應用的值，因此任一內建調色板都可能與之不一致；manifest 有意省略該欄位。

**用 `prefers-color-scheme` 媒體查詢聲明淺色和深色元資料。** 媒體查詢跟隨作業系統，而非應用內顯式選擇，因此無法表示解析後的偏好。

**為每個 `ThemeDefinition` 新增 `themeColor` 欄位。** 單獨的值可讓自訂主題獨立選擇瀏覽器介面配色，但會複製基礎背景色，並允許頁面與周圍的瀏覽器介面發生偏離。如果受支持的主題需要這種有意差異，可以再引入獨立欄位。

## 後果

支持該元資料的瀏覽器會在用戶端應用初始解析後快照及之後每次主題變化時更新周圍介面；不支持 `theme-color` 的瀏覽器會忽略這項元資料。由於該值來自計算後的呈現結果，用戶端必須確保 body 始終有明確的背景色。呈現器會建立並移除自己的節點，head 中無關的元資料則保持不變。
