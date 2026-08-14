# @deepseek-ai/dsh-host-directory-picker-auto

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

[目錄選擇 seam](../directory-picker/README.md) 的**自適應選擇器**：一個只有 node 半側的外掛程式，在啟動時一次性判定宿主處境，並把匹配的雙面後端——[`-native`](../directory-picker-native/README.md) 或 [`-browse`](../directory-picker-browse/README.md)——作為真實的 Loader 條目掛進記憶體根樹（絕不持久化到設定檔；根樹的 `write()` 是 no-op）。由於後端以普通條目的形式到達，其 browser half 被 client 模組表發現的方式與設定行完全相同，因此對判定出的選擇，seam 的“一行同時換兩面”不變式依然成立。解除安裝該選擇器會再次移除該條目，連同兩面一起解除安裝。

判定是一次純函式的啟動時取樣（`resolveDirectoryPickerBackend`），已匯出供複用。`native` 要求“操作者看得到宿主螢幕、且 native 後端能服務它”的全部訊號：僅回環的綁定（從注入的 `webServer` 讀取；全網路卡綁定會接入任何 OS 選擇器都觸及不到的遠端瀏覽器）；非 SSH 啟動（`SSH_CONNECTION`／`SSH_TTY` 未設定或為空——SSH 埠轉發下選擇器會彈在無人值守的伺服器上）；以及可服務的顯示工作階段——darwin／win32 上視為存在；linux 上要求 `DISPLAY`／`WAYLAND_DISPLAY`，外加 `PATH` 上有 zenity 或 kdialog 二進位（該探查是又一項啟動時事實）；其餘任何平臺上都不成立，因為 native 後端驅動程式的平臺恰為 darwin／win32／linux。任何含糊情形都判定為處處可用的 `browse`。取樣每次啟動恰好發生一次，因此掛載的能力在服務生命週期內保持穩定，符合 seam 的要求。固定某種互動在這裡不是設定欄位——直接組合 `-native` 或 `-browse` 行來替代本行，那纔是 seam 文件化的切換點；同時掛載選擇器**和**某個後端行會明確報錯（重複的 `directoryPicker` 服務、`single` 類 slot 中的重複 client 流程）。

## 模型體驗

無。該選擇器僅組合 GUI 宿主的目錄選擇；這裡沒有任何內容進入模型請求。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **探測是從啟動上下文推斷操作者位置，而任何啟動側訊號都無法證明這一點**——從 SSH 啟動中脫離的 tmux 工作階段會丟失 `SSH_*` 標記；Aqua 工作階段之外的 Darwin 行程仍被算作有顯示；在工作站本機啟動、之後經 `ssh -L` 訪問時，請求會從 `127.0.0.1` 到達，系統會判定 `native`，並把選擇器彈在無人值守的工作站上。錯誤的 `native` 選擇會退化為後端既有的可重試失敗對話框，而對這類部署，直接組合 `-browse` 即選擇安全的互動。
- **Linux 選擇器探查只讀 `PATH`**——以其他途徑可用的 zenity／kdialog（shell 別名、未裝在 PATH 上）仍判定為 `browse`；把任一二進位裝到 `PATH` 上，下次啟動即復原 `native` 資格。
- **僅在啟動時判定**——一次判定服務本次啟動的所有用戶端；按連線自適應（同一臺伺服器，本機瀏覽器用 native、遠端瀏覽器用 browse）需要按用戶端的能力對象以及 seam 有意刪除的協議通告，等到出現同時服務兩種形態的部署再做。
