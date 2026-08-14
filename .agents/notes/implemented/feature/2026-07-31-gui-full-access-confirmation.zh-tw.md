# Agent Note: GUI Full access 風險確認

Status: implemented

[English](2026-07-31-gui-full-access-confirmation.md) | 繁體中文

## 問題

在 Web 用戶端的權限選擇器中切換到 `danger-full-access` 只需一次點擊，且預設以 Title Case 機器名 `Danger Full Access` 展示。Full access 會減少確認步驟，允許 agent（代理）執行敏感操作、修改文件或執行外部命令，誤點即在毫無刻意確認環節的情況下啟用了最危險的預設。

## 決策

**每個權限選擇器都把 `danger-full-access` 關進共享的頁面內 `RiskConfirmation` 對話框：啟用按鈕在使用者勾選明確的風險確認核取方塊前保持停用；預設以產品標籤 `Full access` 展示；所有取消路徑都不作任何提交。**

- `RiskConfirmation`（ui-primitives）是受控的 Modal 組合：標題、說明、確認核取方塊、取消，以及 `acknowledged` 勾選前停用的確認按鈕。它始終是頁面內對話框——Modal portal 到本文件 body，絕不打開可能落在另一塊顯示器上的原生或獨立瀏覽器視窗。`Modal` 新增 `contentClassName` slot，令警示正文在受限的行動裝置／橫屏視口內滾動，動作行保持固定。
- composer chip（ui-conversation 的 `PermissionSelect`）在 `/permission` 提交前攔截 Full-access 選擇：`confirmation`/`acknowledged` 元件狀態打開對話框，確認後經與其他選擇完全相同的注入 `command` 通道提交 `/permission danger-full-access`；取消、Escape、關閉與遮罩點擊均保持當前預設不變並重置核取方塊。工作階段鎖定時確認自行撤銷（`locked`／值缺席 effect），切換任務時隨 `key={sessionId}` 重掛載而重設。文案經標準 `conversation` locale slot 以 `access.confirm.*` 鍵供給。
- `/permission` popup（ui-permission 建置於 ui-commands 外殼之上）以資料而非第二套對話框實作完成把關：`SelectOption` 新增選填的 `confirmation` 載荷，popup 控制器擁有 `confirming`/`acknowledged` 狀態遷移，`PopupSelectView` 在門控選項未決期間把選擇卡換成同一個 `RiskConfirmation`。
- 「通用」設定中的「權限」行在把 Full access 持久化為後續工作階段的預設值前，也使用同一個受控 `RiskConfirmation`。警示會明確說明該設定隻影響後續工作階段；取消、Escape、關閉與點擊遮罩均不會改動已存預設值。
- `Full access` 在每個選擇器中都有意覆蓋 kebab 轉 Title Case 的顯示變換；命令與 Settings 寫入在 wire 上保留機器名，每份警示正文都保持中英文 locale 感知。

## 考慮過的替代方案

**原生／作業系統或獨立視窗確認。** 已拒：對話框必須留在當前 WebUI 視窗內；第二個視窗可能出現在另一塊顯示器上，使決策脫離其守護的頁面狀態。

**每個介面的安全文案共享一個 locale namespace。**不予採用：ui-permission bundle 與 ui-conversation 可獨立載入，而 Settings 警示說明的是另一種隻影響後續工作階段的生效週期。每個 bundle 各自擁有文案，ui-permission 也將 popup 與 Settings 詞典分開，而非跨 bundle 邊界 import。

**在 host／權限後端把關。** 設計上即出界：本變更只涉瀏覽器用戶端確認流；後端權限語義、預設值與更安全預設的一鍵行為均不變。

## 後果

進入 Full access 的每條可見 GUI 路徑現在都要求刻意且知情的確認，代價是真想啟用該預設的使用者多一步對話框。新的選擇器透過各自擁有的狀態機複用共享對話框，或在 popup 路徑掛 `confirmation` 載荷。驗收：`input-bar.spec.tsx` 中編輯器流的門控用例、`popup-view.spec.tsx` 與 `popup.spec.ts` 的 popup 門、`permission-row.spec.tsx` 的預設設定門控、`atoms.spec.tsx` 的 Modal/RiskConfirmation 約定，以及組裝態 Web 重播。
