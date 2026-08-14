# Agent Note: 原生工作區目錄選擇器

Status: implemented

[English](2026-07-27-native-workspace-directory-picker.md) | [简体中文](2026-07-27-native-workspace-directory-picker.zh.md) | 繁體中文

## 問題

桌面端 GUI 在新增現有工作區時要求使用者輸入絕對路徑。相比使用作業系統原生選擇器選取目錄，這種操作速度更慢，也更容易出錯。GUI 由本機 Web 載體提供，因此打開原生對話框也會形成一條特權邊界，普通遠端請求不得越過這條邊界。

## 決策

新增一個用於選擇單個資料夾的 `host.pickDirectory` RPC，並透過 `WorkspaceRuntime` 暴露該 RPC。工作區選單提供平鋪操作 **新增工作區…**（本決策做出時是兩個操作：**打開本機資料夾…** 與一個按名稱建立的入口，後者已被[單一路徑 Note](../simplification/2026-07-31-one-route-to-add-a-workspace.md)刪除）。選定資料夾後，系統複用現有的 `workspace.create({ path })` 流程，選中返回的工作區，並啟動一個空白工作階段。

工作區管理器必須在選擇回呼執行前插入或更新返回的工作區。因此，新納入的目錄會立即顯示其 basename。再次打開已註冊的路徑時，則保留該工作區現有的標題。

## 互動約定

- 在 macOS、Windows 和 Linux 上，選擇器一次只允許選擇一個目錄。
- 取消系統對話框不會顯示提示，並返回 `null`。
- 路徑重複時，選中現有工作區。
- 即使派生顯示名與另一個 Workspace 相同，不同 canonical path 也會被收編為獨立 Workspace（見[身份決策](../bug-fix/2026-07-31-same-basename-workspace-adoption.md)）。
- 選擇器的其他故障會顯示簡潔且可重試的錯誤提示。
- 本決策當時未觸碰的按名稱建立流程現已刪除；選擇目錄就是新增工作區的全部（見[單一路徑 Note](../simplification/2026-07-31-one-route-to-add-a-workspace.md)）。

## 宿主邊界

只有來自回環Socket、且攜帶同源瀏覽器元資料的請求才能呼叫原生對話框 RPC。該 RPC 不使用默認的 30 秒請求逾時，因為系統對話框可能無限期保持打開；呼叫方中止或連線中止仍會傳遞至平臺行程。

平臺配接器不經 shell 打開對話框——POSIX 上 spawn 原生工具，Windows 上進行行程內 COM 互動：

- macOS：`osascript` 和系統資料夾選擇器。
- Windows：koffi `IFileOpenDialog` 子行程，使用宿主接受的最佳執行緒 DPI 感知（可用時為 per-monitor-v2；不支持 PMv2 的主機級聯到 per-monitor 或 system-aware）（見[行程內對話框 Note](2026-08-02-win32-in-process-folder-dialog.md)）；該層無回退——失敗原樣上報（見[PowerShell 鏈刪除](../simplification/2026-08-04-drop-windows-powershell-picker-fallback.md)）。
- Linux：使用 `zenity`；Zenity 不可用時回退到 `kdialog`。

## 考慮過的替代方案

- 自訂目錄瀏覽器會重複實作作業系統的行為和權限邏輯，而且應屬於 Web 實作，而非本次僅面向桌面端的變更。
- 繼續使用手動路徑欄位會保留當前容易出錯的互動方式。
- 為一個本機原生對話框新增身份認證基礎設施，會使變更範圍超出其威脅模型；對當前載體而言，回環與同源檢查已經足夠。

## 後果

當前 GUI 可以在 macOS、Windows 和 Linux 上透過原生選擇器打開一個本機資料夾。取消操作不會改變任何狀態，故障仍可重試；重複路徑的處理具有冪等性，basename 相同的不同路徑則可作為獨立 Workspace 共存。選中的工作區及其顯示名稱會在啟動新的空白工作階段前完成刷新。該選擇器現已是獲得工作區的唯一路徑（見[單一路徑 Note](../simplification/2026-07-31-one-route-to-add-a-workspace.md)）：操作者要麼選一個已有目錄，要麼在選擇器內新建一個。

新增的宿主、執行時期、元件和 GUI 測試覆蓋原生邊界、請求信任校驗、取消與故障處理、已有路徑複用、同 basename 路徑收編和可見名稱即時更新。該特權 RPC 仍僅面向本機桌面載體；遠端 Web 目錄瀏覽器不屬於本次決策範圍。

## 風險

- Linux 桌面環境可能不提供任何一種受支持的選擇器。GUI 會報告這項限制，而不會回退到要求使用者輸入路徑。
- 在受支持的本機載體之外，瀏覽器元資料可能有所不同。對於無法證明其滿足所需本機同源上下文的請求，該端點會按設計拒絕。
