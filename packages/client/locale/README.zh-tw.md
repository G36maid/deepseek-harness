# @deepseek-ai/dsh-client-locale

[English](README.md) | 繁體中文

locale 外掛程式：LocaleRuntime——`zh`／`en` 偏好以 `locale.preference` 儲存在 `$DSH_HOME/settings.yaml` 中；若沒有顯式 Host 值，全新瀏覽器會暫時使用 `navigator` 請求的語言（按主子標籤匹配；若其請求的語言本應用都不提供，則使用 `zh`）。Host 讀取在外掛程式啟用後執行，因此 settings 服務不可用不會阻塞頁面；讀取結果會即時替換瀏覽器暫定值。settings API 僅限回環請求，因此遠端瀏覽器的選擇僅保留在行程內。`locale/change` 僅在切換語言時觸發。該服務還擁有 ns×locale 字典登錄檔（類型化 `register(ns, {zh, en})` 按 `LocaleNamespaceMap` 校驗，`bind(ns)`→`TranslateNS<ns>`；尋找鏈 ns → common → zh → key），實作 slot 系統的 `LocaleFace`，並經 `ctx.slots.installLocale` 自行安裝，支撐框架注入的 `t` 標準席位（`Translate`／`TranslateNS` 是 ui-slots 的類型；請從那裡匯入——本包的再匯出僅為字典所有者提供便利）。該持久化邊界由[Host settings 支撐的偏好決策](../../../.agents/notes/implemented/bug-fix/2026-08-06-host-backed-web-preferences.md)擁有。

## 模型體驗

無。locale 登錄檔為瀏覽器 UI 文案提供服務；這裡沒有任何內容進入模型請求。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **部分介面仍保留內聯文案**——設定行、側邊欄、問題作答器和模型選擇使用 locale seat；其他包仍直接擁有靜態文字。
- **登錄檔持有的文字只讀取一次翻譯**——在 slot 渲染路徑之外於註冊時捕獲的文案（例如 command 登錄檔中的 `/model` 命令描述）在重新註冊前保持註冊時的語言；slot 渲染的文案隨切換即時更新。
