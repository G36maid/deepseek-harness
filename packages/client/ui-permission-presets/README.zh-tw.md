# @deepseek-ai/dsh-client-ui-permission-presets

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

面向兩種不同生命週期的瀏覽器權限介面。「通用」設定行讀取顯式暴露的 `permission` Settings 描述符，從 host 的動態 `defaultPreset` enum 中推導選項，並攜帶描述符的 revision 寫入一條 `settings.mutate` 路徑操作。它的 observable 經 slot 系統的 `hooks` 格傳遞，因此 React 掛鉤由算繪器綁定；推送的失效通知會重新取得描述符。這個值僅在後續工作階段建立時生效；改變它不會切換當前工作階段。選擇 Full access 時必須先顯式確認風險，該行隨後才會寫入。

當前工作階段介面仍是掛在 host `/permission` 命令上的 popupSelect **裝飾**（`ctx.commandUi.decorate`）。裝飾不是第二條命令——host 命令保留斜槓選單行、帶參路徑（`/permission <preset>` 直接切換）與持久生命週期記帳；裝飾只把裸呼叫替換為選擇框：一張扁平預設清單，當前值標記為 active，kebab-case 預設名算繪為 Title Case 標籤（`workspace-write` → `Workspace Write`，與 composer chip 的顯示變換孿生），選中即提交 `/permission <preset>` 命令列。選項與 active 標記讀取工作階段的 `permissions` 投影（與 composer chip 算繪的同一份 host 計算 select），因此兩個當前工作階段介面共享同一讀源與同一寫路徑，推送的投影幀是兩者共同跟隨的唯一確認。裝飾恰在投影 key 存在時可用；無權限組合既不顯示選擇框，也不顯示 Settings 行。

`/client` 匯出面為外掛程式本體（`apply`／`inject`）。

## 模型體驗

透過兩個介面寫入的權限事實間接影響：Settings 行使未來工作階段帶著全量值旋鈕事件（`permission/preset`、`sandbox/mode`、`approval/policy`）啟動，而 `/permission` 選擇框切換當前工作階段時會追加相同的事實；這些事件決定後續工具呼叫解析到的沙盒模式與審批策略，選擇框互動本身不新增任何提示詞內容。

#### KV Cache 影響

無直接失效；請求前綴的變化由旋鈕消費端自行承擔。

## 已知限制與暫緩事項

- **Settings 行僅在 Web 中可用**：非 Web 用戶端仍可透過 `/permission` 切換當前工作階段，但不會獲得這項瀏覽器貢獻。
