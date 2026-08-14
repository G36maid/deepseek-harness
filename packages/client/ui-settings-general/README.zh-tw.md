# @deepseek-ai/dsh-client-ui-settings-general

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

設定外殼、無特定功能歸屬文案與持久化產品引導 namespace。它以觸發控制元件和模態設定面板佔用 `sidebar.settings`，把 `settings.section` 帳本投影成導覽、把 `settings.onboarding` 帳本投影成每次只掛載一個步驟的引導流程，並在設定頁面上註冊所有不屬於單一功能的內容：觸發器、標題欄與關閉控制元件內容、本機設定檔操作，「通用」分區及其 `settings.general.item` slot，以及 `settings` 字典。它渲染進的那些 slot 類型歸 ui-settings——設定領域底座——所有；只有外殼自身的契約類型放在這裡，因為它們引用 ui-sidebar 的 slot 類型，而底座不得相依性任何 `ui-*` 包。歸具體功能所有的行（「權限」、「語言」、「外觀」）、分區（「模型」）和條件式首次使用引導步驟仍由各自的功能包提供。

外殼不自帶引導文案：所有文字都來自註冊方。導覽 label 可以是跟隨語言的 thunk，因此導覽投影經 `resolveSlotLabel` 解析，並在分區帳本更新或 locale revision 變化時重新渲染（`ctx.get('locale')` 選填讀取，無硬 locale 相依性）。首次使用引導記錄按升序投影，每次只掛載一個步驟；可見步驟自行持有彈出視窗框架和應用根節點 `inert` 生命週期。已掛載但仍在判定私有事實的步驟渲染 null，因此判定期間不繪製也不阻塞任何內容。當前註冊方會收到該條目的 id、`complete()` 和 `openSection(id)` 回呼；完成或跳過當前步驟後，所有權轉交給下一項。持久化完成狀態、能力就緒狀態、文案、變更操作以及可見包裝均由註冊方持有，因此獨立註冊的流程無法堆疊，外殼也不會成為第二個設定事實來源。

回環瀏覽器透過 `settings.describe` 載入提供方的 `hasDocument` 能力，且只有在 Host 確認可準備好一份由提供方持有的本機文件時才渲染**打開設定檔**。該操作傳送無路徑參數且僅限回環訪問的 `settings.openDocument` 請求；Host 會再次解析提供方路徑、在文件缺失時將其建立出來，並交給原生文字編輯器（macOS 上使用 `open -t`，繞過瀏覽器文件關聯；Linux 和 Windows 上使用桌面文件關聯；WSL 上經 `wslpath -w` 轉換後使用 Windows 文件關聯）。打開失敗時該操作仍可使用，並渲染本機化錯誤。臨時讀取失敗或 Host 拓撲變化後，重新打開對話框或重新連線會刷新可用性。遠端瀏覽器從不註冊該操作，也從不發起這項特權設定讀取。

宿主端在使用者設定 seam 中註冊 `ui-onboarding`。`ui-settings-models` 提供的歡迎步驟透過既有公開 settings 邊界讀寫其中的 `welcomeNoticeVersion`；外殼本身仍不持有產品策略。

## 模型體驗

無。該外掛程式渲染瀏覽器設定 UI；這裡沒有任何內容進入模型請求。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- 「通用」分區沒有內建行；每一行僅在其所屬功能外掛程式掛載時出現。
