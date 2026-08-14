# Agent Note: Win32 資料夾選擇器遷至 koffi 子行程

Status: implemented

[English](2026-08-02-win32-in-process-folder-dialog.md) | [简体中文](2026-08-02-win32-in-process-folder-dialog.zh.md) | 繁體中文

## 問題

Windows 目錄選擇器的主層此前是圍繞 WinForms `FolderBrowserDialog` spawn 出的 PowerShell 指令碼：只有恰好安裝了 PowerShell 7 的機器纔有現代對話框；一處回歸——PowerShell 6 可解析卻沒有 WinForms（退出碼 1 而非 `ENOENT`，5.1 回退永遠不會觸發）；`SetProcessDPIAware` 只有系統 DPI 的上限；選擇器的行為取決於機器裝了哪些 shell，而不是取決於 Windows 本身。

## 決策

`packages/host/directory-picker-native` 現在經 koffi——它已是倉庫其他 `win32.ts` 程式碼的工作區相依性——在行程內打開 `IFileOpenDialog`（`FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR`），作為 win32 主層。COM 工作階段執行在 spawn 出的子行程中，模態 `Show` 永不阻塞宿主事件迴圈；子行程在阻塞前上報其原生執行緒 id，驅動程式層透過向該執行緒的視窗反覆投遞 `WM_CLOSE`（`EnumThreadWindows`）來處理中止請求，關閉等待預算耗盡後強制終止子行程。對話框是子行程的第一個視窗，Windows 會自動啟用它，無需手動前臺呼叫。子行程執行緒啟用宿主接受的最佳執行緒 DPI 感知（`SetThreadDpiAwarenessContext`，按 per-monitor-v2 → per-monitor → system-aware 級聯並檢查回傳值），嚴格優於指令碼的系統 DPI 上限；DPI 保持為純外觀的 best-effort——不接受其中任何一種的宿主仍得到現代對話框，而不會降級。模組切分讓覆蓋率在任何主機上都誠實：`win32-dialog-logic.ts`（純時序）與 `win32-dialog.ts`（driver）可在任何平臺使用 fake 進行測試；`win32-dialog-bindings.ts` 對 mock 的 `koffi` COM 世界測試（`dsh-session-persistence-jsonl` 的技法）；POSIX 主機執行真實的 spawn 管道，並驗證其因 koffi 載入失敗而拒絕；win32 主機執行真實的打開對話框並透過中止將其關閉的冒煙測試。先於本層存在的 PowerShell 鏈已被刪除（見[鏈刪除](../simplification/2026-08-04-drop-windows-powershell-picker-fallback.md)）：該層無回退。

## 考慮過的替代方案

- **預編譯原生輔助程序（`native/` 家族，如 `@deepseek-ai/node-addon-landlock-run`）。** 否決：再增加一個 npm 包家族、MSVC 環境設定和 Windows 建置／發布通道——只為交付約 150 行倉庫目前無法透過 CI 檢驗的 C 程式碼（現有 CI 沒有真 Windows 通道）；koffi 以零新增供應鏈提供同一 COM 介面。
- **N-API 行程內外掛程式。** 否決：同樣的 CI／工具鏈原因，還需自行維護處理 STA 執行緒與訊息泵的 C++ 程式碼，而子行程 + koffi 用 TypeScript 就能表達。
- **保留 PowerShell 為主層並探測版本。** 否決：選擇器仍被 shell 打包形態挾持（6 與 7、Store 別名、profile），且沒有 pwsh 的機器仍只能使用 5.1 的舊版對話框；只有拓寬回退觸發條件這一項改動被納入了回退層。
- **在主線程上阻塞模態呼叫。** 直接否決：對話框打開期間 web 宿主必須繼續服務 RPC。

## 後果

- 每臺 Windows 機器都得到帶其所支持的最佳 DPI 感知（1703+ 為 per-monitor-v2）的現代對話框，無論是否安裝 PowerShell。
- 真實對話框的渲染與完成選擇的流程仍需在 Windows 上手動檢查（自動關閉冒煙測試證明打開／中止／收尾）。
- 所用 COM vtable 槽位與 GUID 是凍結的 Windows ABI（Vista 起）；koffi 簽名錯誤可能引發原生訪問衝突，但被限制在對話框子行程內——宿主 Node 行程存活，失敗原樣上報（無回退層；見[鏈刪除](../simplification/2026-08-04-drop-windows-powershell-picker-fallback.md)）。mocked-koffi 的 ABI 固定測試與真實 win32 冒煙測試正是為了在交付前捕獲這類錯誤。
- 打包二進位路徑——打包後的可執行文件以對話框入口形式自我 spawn——不受任何自動化測試覆蓋：原始碼側與普通 node 下建置出的 `lib/worker.cjs` 已被覆蓋，打包 spawn 推遲到 Windows CI 路線圖。
