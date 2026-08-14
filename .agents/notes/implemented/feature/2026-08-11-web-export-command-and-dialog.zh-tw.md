# Agent Note: Web `/export` 共用流式 Session ZIP 下載

Status: implemented

[English](2026-08-11-web-export-command-and-dialog.md) | [简体中文](2026-08-11-web-export-command-and-dialog.zh.md) | 繁體中文

## Problem

Session 匯出需要一個穩定的 Session 級外顯入口，以及語義等價的斜槓命令路徑。第二套後端讀取器或 Host 路徑寫入器會重複下載實作，並引入平臺相關的文件權限和路徑公開問題。

## Decision

`@deepseek-ai/dsh-session-log-export` 註冊 Web 專用的 `/export` 使用者命令，並提供瀏覽器 `ctx.sessionLogDownload` 控制器。該命令記錄普通的 `command/run` 和 `command/done`；`command.execute` 返回成功結果後，`dsh-client-ui-commands` 會發布本機確認，請求當前瀏覽器的控制器下載 ApiProxy 現有的 `GET /api/session.export` ZIP。其他用戶端會渲染廣播的命令節點，但不會重複執行瀏覽器副作用。Session Header 中 111×32 的 `Session log` 膠囊按鈕會直接呼叫該控制器。兩種入口透過 `HEAD` 預檢獲得準備階段錯誤，再把 GET URL 交給瀏覽器下載管理器，因此 JavaScript 不會緩衝 ZIP；兩種入口共用進行中狀態和 Modal。

Header 貢獻佔用最右側的 `conversation.session.header.utilities` 清單，渲染帶尾部下載圖示的 `Session log` 文字 capsule 和共享 Modal。標題旁的 `conversation.session.header.actions` 清單繼續承載模式、Subagent 和 Task 設定項，掛載 Session export 不會改變它們的順序或位置。匯出貢獻不觀察 Session 歷史。逐 Session 控制器會摺疊並行操作，在外掛程式釋放時取消活動預檢，忽略釋放後的遲到請求，並在請求後來完成時保留使用者已經關閉彈出視窗的狀態。

ZIP 端點與持久化 `readRaw` 能力仍由 `dsh-host-apiproxy` 和持久化包擁有。端點會在學取工件前 flush 活動的根 Session，因此本機確認不會早於持久命令生命週期行。本包不序列化 Session 事件、不寫 Host 文件、不交付 Host 路徑，也不實作 SQLite 回退。

本包是普通的 Client 聚合項目。單一 `tsconfig.json` 會一起編譯 Node loader 入口與瀏覽器貢獻；Host 側測試仍透過原始碼入口驗證命令與 invariant。

## Alternatives considered

**把外顯入口放進 Trajectory。** 不採用，因為匯出是 Session 級操作，使用者不應先打開診斷檢視表才能發現它。

**讓 `/export` 寫入 Host 側 JSONL 文件。** 不採用，因為這會偏離包含子 Session 與附件的 ZIP，需要處理 Windows ACL，並返回對遠端瀏覽器可能沒有意義的 Host 路徑。

**同時保留 Header 與 Trajectory 按鈕。** 不採用，因為兩個外顯控制元件執行同一項 Session 操作，會形成重複歸屬和不一致的位置。

## Consequences

Header 操作與 `/export` 會下載同一個 ZIP，並顯示相同回饋。已執行命令保留在持久文字記錄中，且不建立模型輪次。預檢會報告流式傳輸開始前發現的失敗；瀏覽器消費 GET 時發生的失敗仍屬於瀏覽器下載失敗。持久化後端沒有逐 Session 原始工件時，使用者會收到端點現有的失敗；SQLite 支持保留為獨立工作。Session 首輪前的命令可用性屬於獨立工作。
