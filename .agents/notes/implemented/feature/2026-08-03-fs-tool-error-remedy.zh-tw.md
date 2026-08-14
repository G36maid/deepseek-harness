# Agent Note: 受防護變更錯誤在模型邊界追加復原指令

Status: implemented

[English](2026-08-03-fs-tool-error-remedy.md) | 繁體中文

## 問題

受防護的 `write` 與 `edit` 失敗以只陳述條件、不給出唯一正確復原方式的訊息到達模型：`FS_STALE_VERSION`（「file changed since it was read」）與 `FS_NOT_OBSERVED`（「edit requires reading … first」）。模型必須自行猜測復原方式是重新讀取（或首次讀取）後重試，而基於結構化錯誤碼路由的重試/權限/UI 層看到的也是同一段訊息文字。提供方擁有的訊息屬於儲存 seam 的面向機器詞彙（[檔案系統能力 seam](../architecture/2026-06-17-filesystem-capability-seam.md)），因此復原指令不能放在那裡，否則會把面向模型的措辭洩漏給 `FsError` 的每個消費端。

## 決策

`dsh-tool-fs` 擁有一個面向模型的錯誤包裝層 `remediateFsError`（位於 `src/error.ts`），在 `write.ts` 與 `edit.ts` 中於沙盒拒絕對映之後應用。它為兩個受防護變更錯誤碼追加復原指令，其餘錯誤原樣透傳：

- `FS_STALE_VERSION`（包括缺失的編輯目標——它與過時錯誤共用同一錯誤碼）追加 `— re-read the file, then retry`。
- `FS_NOT_OBSERVED` 追加 `— read the file, then retry`。

結構化 `FsError` 錯誤碼保持不變，使重試/權限/UI 層繼續基於它路由；原始錯誤作為 `cause` 鏈入。提供方訊息保持面向機器且不變。

在 `edit.ts` 中，`fs/edit-intent` waterfall（瀑布式事件）現在與提供方變更位於同一個 `try` 內，因此策略外掛程式從 intent slot 拋出的 `FS_NOT_OBSERVED` 拒絕也會獲得復原指令——兩條拒絕路徑都以相同的復原措辭到達模型。

## 考慮過的替代方案

- **在 `dsh-fs` / `dsh-fs-local` 的提供方訊息中追加復原指令。** 被拒絕：這些訊息是面向機器的 seam 詞彙，被重試、權限、UI 和麵向模型的各層消費；面向模型的措辭應位於模型邊界，即 `dsh-tool-fs` 已經擁有結果格式化之處（[檔案系統能力 seam](../architecture/2026-06-17-filesystem-capability-seam.md)）。
- **改為在提示詞引導中加入復原方式。** 被拒絕：失敗發生在任務中途；靜態指令無法可靠地影響重試決策，而錯誤訊息恰好在模型必須行動時出現。
- **用新的 `FsError` 錯誤碼表達復原指令。** 被拒絕：這兩種失敗對應的條件，重試層本就已經處理；拆分錯誤碼會使相同語義採用不同路由。

## 後果

兩個錯誤碼的模型可見文字發生變化；`fs-policy-reject` 無金鑰快照被重新錄制，`dsh-tool-fs` 與 `dsh-fs-observation-policy` 的 README 逐字固定追加後的文字。單元測試直接覆蓋包裝層（復原指令文字、錯誤碼保留、cause 鏈、其他錯誤碼與非 `FsError` 值的透傳），組裝後的工具路徑斷言兩個錯誤碼的復原指令都到達模型。

[檔案系統缺失觀測後續決策](../bug-fix/2026-08-09-filesystem-absence-observation.md)使外部刪除場景下的過時復原指令能夠生效。失敗的重新讀取仍返回 `FS_NOT_FOUND`，但會記錄確認缺失：隨後 edit 返回 `FS_NOT_FOUND`，不再附加過時復原指令；write 則以原子 `createIfAbsent` 重試，並保留任何並行建立者寫入的文件。
