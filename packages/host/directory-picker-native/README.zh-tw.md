# @deepseek-ai/dsh-host-directory-picker-native

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

[目錄選擇 seam](../directory-picker/README.md) 的**原生 OS 選擇器後端**：`NativeDirectoryPicker` 以 `native` 能力註冊 `ctx.directoryPicker`，其 `pick(signal)` 每次呼叫打開一個原生選擇器並解析出所選絕對路徑（取消時為 `null`）。平臺工具不經 shell 呼叫：macOS 使用 `osascript`，Linux 使用 Zenity 並以 KDialog 回退；呼叫方的中止訊號會終止原生行程。Windows 在 spawn 的子行程中打開現代 `IFileOpenDialog`——由 koffi 在子行程主線程上驅動的 COM 工作階段，採用宿主接受的最佳執行緒 DPI 感知（優先 per-monitor-v2），中止時向對話框執行緒投遞 `WM_CLOSE`。只有操作者坐在宿主螢幕前時纔可用——遠端部署應組合 [`-browse`](../directory-picker-browse/README.md)。命令邊界（`DirectoryPickerRunner`）與平臺事實可注入。共享的免 shell 子行程執行器位於 [`dsh-native-command`](../../util/native-command/README.md)。

**雙麪包**：瀏覽器端（`./client`）向 [ui-workspace](../../client/ui-workspace/README.md) 的兩個目錄流 slot 註冊一個無算繪的流程佔用者——每次 `open` 請求驅動 `host.pickDirectory`，並透過 slot 的屬主互動約定上報唯一結果（所選路徑／取消／失敗）。兩個目錄流程聲明必須同時處於有效狀態，任一貢獻才會安裝。因此一行 cordis.yml 同時組合原生互動的兩側；用戶端不包含任何按能力類型進行的分支，掛載第二個流程包會在載入期失敗（slot 的 kind 為 `single`）。

## 模型體驗

無。該後端服務於 GUI 宿主的目錄選擇；這裡沒有任何內容進入模型請求。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與延期工作

- **Linux 相依性桌面工具**——Zenity 與 KDialog 均未安裝時，`pick` 以包含解決建議的錯誤拒絕；它不會回退為手輸路徑提示（組合層面的回退是 browse 後端）。
- **Windows 沒有機制級回退**——透過打包相依性 koffi 執行的子行程選擇器是唯一原生層級，因此 COM 拒絕或對話框崩潰會直接上報失敗。組合層面的回退仍是 browse 後端。
