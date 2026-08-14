# Agent Note: 移除首次啟動內測聲明

Status: implemented

[English](2026-08-13-remove-first-run-beta-notice.md) | [简体中文](2026-08-13-remove-first-run-beta-notice.zh.md) | 繁體中文

## 問題

GUI 每次首啟都會先顯示佔滿視口的內測聲明：內部測試的定位表述，加上透過 `DSH_TELEMETRY_MODE` 開啟 Session Log 上傳的說明。工作階段遙測在 mode 未設定時已解析為 `DISABLED`（[遙測預設關閉](../feature/2026-08-10-telemetry-default-off.md)），因此引導流程中關於遙測的全部內容就是一段教使用者如何開啟的提示，而內部測試的定位表述本身也不應出現在發布版本裡。

## 決策

本決策當時把首啟聲明從組裝後的產品中整體移除，而不是改寫。`ui-settings-general` 不再註冊任何 `settings.onboarding` 步驟；聲明元件、確認 store、文案所有者文件和 locale 鍵均被刪除，Host 則保留 `ui-onboarding` namespace，使既有設定文件繼續有效。後續的[共用彈出視窗產品引導](../feature/2026-08-13-shared-modal-product-onboarding.md)在 `ui-settings-models` 中復原了一份新的簡潔測試階段聲明，複用該欄位與後端契約，但不會復原已移除的接管式版面配置或遙測說明。遙測的開啟仍是顯式的部署環境變數選擇，記錄在 [CLI reference README](../../../../apps/cli/reference/README.md) 中；復原後的聲明不涉及如何開啟遙測。

## 曾考慮的替代方案

**保留聲明，只刪除其中的遙測段落。** 不予採用：發布版本不應呈現的正是內部測試的定位表述本身，而一個沒有實質內容的強制首啟插頁只剩下打擾。

**改為詢問上傳同意（版本化的同意步驟）。** 本次發布不予採用：首啟詢問是否開啟上傳仍然是一個遙測提示。未來的同意流程可以透過保持不變的 `settings.onboarding` seam 註冊，並使用新的版本化欄位做重新確認。

**連 `ui-onboarding` namespace 一起註銷。** 不予採用：既有設定文件已經包含該分節，而設定 seam 會用已註冊的 namespace 校驗儲存文件；保留註冊就能讓這些文件繼續有效，且沒有額外成本。

## 後果

這次移除消除了佔滿視口的聲明及其遙測文案。後續復原有意採用不同的展示與文案版本：共用彈出視窗先於行內憑據彈出視窗出現，遠端場景重新覆蓋行程內確認，既有 `welcomeNoticeVersion` 欄位記錄新的文案版本。歷史上的遙測提示仍未復原。
