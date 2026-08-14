# Agent Note: 僅複製的 preset 創作，與通往 preset 文件的入口

Status: implemented

[English](2026-08-08-copy-only-preset-authoring.md) | [简体中文](2026-08-08-copy-only-preset-authoring.zh.md) | 繁體中文

## 問題

agent-preset 設定頁帶著一個網頁 YAML 編輯器：`agentPreset.write` 接收任意組裝文字，頁面是一個沒有補全、高亮或 diff 的文字域，形狀檢查相依性 Loader 自己的 `entryListSchema`——其方言含 `!!js`，所以「過了形狀檢查的文字」在下一次掛載時仍是任意程式碼。作為編輯器很弱，作為能力很寬，還是該分區不得不防禦的「編輯器 vs 名單」競態的來源。

## 決策

創作改為宿主端複製，文件就是編輯器。`agentPreset.write` 變為 `agentPreset.copy { from, agentPreset, name? }`：兩個由宿主對照自身根目錄解析的 id 加一個選填顯示名，整目錄 `cp`（符號連結解引用，權限收緊為僅屬主並保留屬主執行位），元資料重寫為保留來源描述、但絕不保留其名稱與 `order`。頁面變為：隨附組裝的只讀查看器、作為唯一建立入口的複製對話框（不再有空白「新建預設」——從零手寫 YAML 不是人會做的事）、自訂行的刪除，以及通向文件的位置操作——`agentPreset.openDocument { agentPreset }` 在宿主端解析目錄並原生打開，部署沒有桌面時回答 `{ opened: false, path }` 供該行以文字形式展示（`list` 上的 `hasDocument`；在 `canOpenNativePath` 平臺探測會失真處由閘道的 `nativeOpen` 設定釘死，例如 e2e 與容器）。

## 後果

- 創作兩個方向都不再有組裝文字或路徑跨越瀏覽器傳輸層；`entryListSchema`/`!!js` 的顧慮隨 `assertComposition` 本身（已刪除）一並消解。特權集現為 `read`/`copy`/`openDocument`/`remove`——沒有一個接收檔案系統目標。
- 編輯器移除後，手改 `agent.cordis.yml` 成為唯一的組裝編輯方式，因此常駐掛載層增加了以 stamp 為鍵的代際：`ensureStanding` 比對文件的 mtime+大小，為後續工作階段開啟下一代際（[常駐掛載 note](../architecture/2026-08-08-per-preset-standing-mounts.md)，已就地更新）。沒有它，改過的文件要等行程重新啟動才生效。
- 副本是完整快照，會隨隨附來源升級而漂移——接受；preset 層沒有 patch 語義（那是 bundle 層 `cordis.patch.yml` 的能力），隨附集合自己也為「一個文件讀完整份組裝」付了同樣的代價（`cordis`/`code` 就是 `standard` 的完整副本）。
- `read` 去掉了 `writable`（沒有編輯器可門控），內建目錄絕不被打開（`openDocument` 與 `remove` 一樣拒絕非 `user` 信任）：安裝目錄會被升級覆蓋，把編輯器指向它等於招攬會被升級悄悄丟棄的編輯。

## 關鍵實作細節

- **複製目標的拒絕刻意分兩道檢查。** roster 檢查拒絕任一根目錄提供的 id——與隨附 preset 同名的使用者目錄會被遮蔽，「建立」只會落下一個永遠不被列出的文件；磁碟檢查（`cp` 之前的 `PresetExistsError`，`errorOnExist` 作競態兜底）拒絕佔著名字卻不是 preset 的目錄，那是 discovery 看不見的。
- **展示的路徑是回應方向的披露，且釘在環回。**「沒有任何瀏覽器載荷能選中任意檔案系統目標」這條不變數說的是請求方向；把解析出的目錄展示給環回使用者正是方案要求的降級。它絕不搭乘非特權的 `list`。
- **e2e lane 釘死 `nativeOpen: false`**（`agent-preset-authoring.overlay.yml`）——既讓 golden 在 macOS 開發機與無頭 Linux CI 上渲染同一分支，也讓測試執行永不彈出真實文件管理器。揭示的目錄由 lane 自己 token 化為 `{{presetRoot}}`，因為 `normalizeAria` 只認識 workspace cwd。

## 考慮過的替代方案

保留 write 換個更好的編輯器（CodeMirror 等）：傳輸層上仍是任意能力，仍是競態來源，而且仍不如使用者自己的編輯器。帶 patch 語義的副本（「standard 加這點 diff」）：bundle 面之下沒有這樣的層，倉庫自己的隨附 preset 也刻意選了完整副本。瀏覽器端拿返迴路徑調 `host.openPath`：路徑一旦成為請求參數，就打破了 README 的「不選填中任意目標」不變數。
