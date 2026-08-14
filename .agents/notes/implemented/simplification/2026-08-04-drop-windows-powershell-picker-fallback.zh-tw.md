# Agent Note: 刪除 Windows PowerShell 選擇器回退

Status: implemented

[English](2026-08-04-drop-windows-powershell-picker-fallback.md) | [简体中文](2026-08-04-drop-windows-powershell-picker-fallback.zh.md) | 繁體中文

## 問題

原生目錄選擇器的 win32 分支在 koffi `IFileOpenDialog` 子行程之下保留了一條兩級 PowerShell 回退：先 `pwsh.exe`，再 `powershell.exe`（Windows PowerShell 5.1），兩者執行同一個主動啟用 `SetProcessDPIAware` 的 WinForms 指令碼。該鏈的存在是為了在 koffi 層「不可用」時仍能給出一個可用的選擇器，但它可能保護的每一個觸發條件都是我們自己打包或部署的失敗，而不是作業系統的：

- koffi 的原生二進位作為普通的選填 NPM 相依性（`@koromix/koffi-win32-x64`，無 install script）分發；能裝上該包的宿主就一定有二進位，裝不上的宿主會在安裝期明確報錯——回退程式碼也根本不會得到載入。
- 「上古 Windows」不可能出現：本倉庫支持的 Node 版本執行在遠比 Vista 時代 `IFileOpenDialog` ABI 新的 Windows 世代上。
- koffi/COM 缺陷只崩對話框子行程（crash isolation）；對我們自己 bug 的正確反應是上報失敗，而不是靜默降級到舊版對話框。

這條鏈還付出了真實的複雜度：兩個 spawn 層執行同一指令碼、把回退觸發從 `ENOENT` 拓寬為 pwsh 的任何失敗以修復 PowerShell 6（無 WinForms）回歸問題、攜帶全部三個原因的三連敗 `AggregateError`，以及每層的 abort 重檢。seam 早已擁有唯一重要的回退——組合層面的 `browse` 後端，由 `directory-picker-auto` 在啟動時選擇一次。

## 決策

win32 層恰好就是 koffi `IFileOpenDialog` 子行程；任何失敗原樣上報，無回退。PowerShell 鏈——`pwsh` → Windows PowerShell 5.1 級聯、DPI 修正的 WinForms 指令碼、`AggregateError` 聚合——被刪除，`pickNativeDirectory` 的 win32 分支成為單次呼叫。`dsh-native-command` 仍為 POSIX 層保留相依性。

本包其餘部分早已遵循的回退判據現在統一適用：回退層只存在於作業系統/桌面環境提供且可能缺失的工具（Linux 的 `zenity` → `kdialog`，啟動探針同樣取樣它們）；我們自己打包的工具（`koffi`）失敗即明確報錯。macOS `osascript` 與之前一樣保持無回退。

本次變更合併並刪除了 pwsh 優先的 DPI 選擇器修復 Agent Note：其決策在此被完全反轉，其保留的理由對只含 koffi 的層不再指導未來工作。其中真實的部分：PowerShell 7 呈現基於 `IFileDialog` 的現代資料夾選擇器，而 5.1 的 `FolderBrowserDialog` 被硬連到舊版 `SHBrowseForFolder` 樹；指令碼的 `SetProcessDPIAware` 修正了 spawn 的系統 DPI 上限；pwsh→5.1 的跳轉存在是因為可解析的 PowerShell 6 沒有 WinForms（退出碼 1，而非 `ENOENT`）。其被拒絕的替代方案（要求 PowerShell 7、匯入 `resolvePwshPath`、在 harness 行程設定 DPI 感知）隨鏈刪除而失去意義。

## 考慮過的替代方案

**保留鏈但去掉 pwsh 質量層（`koffi` → Windows PowerShell 5.1）。**拒絕：剩下的層仍在防範我們自己打包的相依性發生故障，仍要付出指令碼、拓寬的觸發與聚合的代價，仍會把我們自己的 vtable/COM 缺陷藏到舊版對話框後面。「僅對外部提供的工具回退」的判據不接受任何 Windows 層。

**原樣保留鏈。**拒絕：它是選擇器中唯一的二級執行時期回退，其觸發條件是本就會明確報錯的部署側失敗，並且它把一次失敗的選擇操作降級為 `AggregateError`，其中最具可操作性的條目卻指向 PowerShell 宿主。

**原生 pick 失敗時在執行時期回退到 `browse`。**拒絕：seam 的流程洞屬於 `single` 類型，`-auto` 組合已在啟動時選擇一個後端；執行時期跨類型跳轉會同時掛載兩個後端並模糊能力邊界。

## 後果

- win32 選擇器的失敗面是來自單一層的一個錯誤；呼叫方看到真實原因（koffi 載入失敗、COM 拒絕、對話框崩潰），而不是鏈式聚合的錯誤。
- 本包不再呼叫 `pwsh`/`powershell.exe`；WinForms 指令碼、其 `SetProcessDPIAware` 修正與 `-STA` 標志隨之消失。
- 測試相應縮減：pwsh/5.1 級聯與三連敗用例被一個「失敗原樣上報、無回退」用例取代；默認配接器測試改驅動程式 Linux 層。
- 重新引入條件：未來出現在我們打包鏈之外的 win32 機制（我們不隨包分發的系統提供的對話框宿主）才值得在同一判據下保留一層回退。
