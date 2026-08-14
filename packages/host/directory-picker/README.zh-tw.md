# @deepseek-ai/dsh-host-directory-picker

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

web GUI 宿主的工作區目錄選擇是一項能力 seam。抽象的 `DirectoryPicker` 服務（`ctx.directoryPicker`）是其 Service Definition。該服務只提供一個方法：`capability()`，它返回一個可辨識聯合類型，說明操作者如何選擇目錄。後端之間的使用者互動不同，不只是實作不同：`{ kind: 'native', pick(signal) }` 在宿主螢幕上打開一個原生 OS 選擇器（[`-native`](../directory-picker-native/README.md)）；`{ kind: 'browse', list(path?), createDirectory(path, name) }` 提供應用內瀏覽器使用的列舉與建立操作，也能服務於無法訪問 OS 對話框的遠端用戶端（[`-browse`](../directory-picker-browse/README.md)）。消費端按 `capability().kind` 分支；聯合類型由可合併擴充的 `DirectoryPickerCapabilities` 對映派生，新後端透過聲明合併在其中加入自己的變體。遇到未知 kind 時，消費端會隱藏目錄選擇入口，而不是失敗。能力對象在服務生命週期內必須保持穩定。每個後端包還提供 browser 入口，在 ui-workspace 的 directory-flow slot 中註冊匹配的互動，因此一項組合設定會同時選擇宿主能力與 client 流程。需要在執行時期選擇互動的組合掛載 [`-auto`](../directory-picker-auto/README.md)，它在啟動時檢查一次宿主情況，並掛載匹配的後端行。

瀏覽原語失敗時會拋出帶類型的 `DirectoryPickerError`（`directory-unreadable`／`directory-exists`／`directory-create-failed`，各自攜帶出錯對象的 `path`），消費閘道將其 1:1 對映為協議錯誤碼。`DirectoryEntry` 行攜帶宿主判定的 `hidden` 標志（POSIX 點前綴約定），展示策略留在用戶端；`DirectoryListing.crumbs` 是從檔案系統根開始的祖先鏈，每個 crumb 都是跳轉目標。設計依據、與 `ctx.fs` 的切分、策略裁決見 [目錄選擇能力 seam Agent Note](../../../.agents/notes/implemented/architecture/2026-07-28-directory-picker-capability-seam.md)。

## 模型體驗

無。該 seam 服務於 GUI 宿主的目錄選擇；這裡沒有任何內容進入模型請求。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **不支持多根目錄**——瀏覽約定每次列舉只公開一條祖先鏈；按部署限定可瀏覽根（以及在盤符根的上一級枚舉 Windows 各盤符根目錄）等到出現需要它的消費端再做，見 DirectoryPicker Agent Note。
