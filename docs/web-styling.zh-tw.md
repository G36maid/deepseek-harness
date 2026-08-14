# Web UI 樣式參考

[English](web-styling.md) | [简体中文](web-styling.zh.md) | 繁體中文

本文規定瀏覽器用戶端包的樣式職責歸屬與元件規則。當前 token 值位於 [`packages/client/ui-theme/src/styles/`](../packages/client/ui-theme/src/styles/)；本文不重複這份由原始碼生成的清單。

## 職責歸屬

[`ui-theme`](../packages/client/ui-theme/README.md) 負責 `--dsw-*` 靜態色階、語義別名、排版、動效、漸變、陰影、捲軸樣式以及明暗主題偏好。[`ui-layout`](../packages/client/ui-layout/README.md) 將解析後的主題快照應用到文件。功能包使用語義別名，不得另行定義全域性主題。

全域性樣式表歸 `ui-theme/src/styles/` 所有。元件樣式以 CSS Modules 形式放在元件旁。當某個值屬於該元件的版面配置或呈現約定時，元件可以定義區域性自訂屬性；共享顏色、排版、層級和動效屬於主題包。

## 元件規則

- 使用 CSS Modules 和 `clsx`；不得新增元件庫或 Tailwind。
- 功能元件使用 `--dsw-alias-*` 語義 token。不得複製靜態色板值或在其中寫入顏色字面量。
- 功能元件 CSS 不得包含主題選擇器。明暗主題覆蓋屬於主題所有方。
- 字體大小必須與行高配對；已有角色匹配時使用主題排版變數。
- 當元件約定要求保留列結構時，原始碼文字、終端機輸出和 diff 行不得換行；使用共享捲軸樣式，不得定義元件專用捲軸選擇器。
- 呈現規則寫在 CSS 中。React 內聯樣式可以傳遞元件區域性自訂屬性值，但不得編碼主題分支。
- 新增過渡動畫或僅懸停可見的控制元件時，保留清晰可見的鍵盤焦點和減少動態效果行為。

## 變更系統

在所屬 `ui-theme` 樣式表中新增或修改共享 token，然後在功能包中使用其語義別名。公共樣式約定發生變化時，更新所屬包的參考文件。視覺行為遵循[測試策略](testing.md)；[樣式系統 Agent Note](../.agents/notes/implemented/process/2026-07-19-web-styling-system.md) 記錄框架依據。
