# Agent Note: Code Mode 的 UI 基礎——run_code 的 description 參數，以及與原生同等保真的分發日誌

Status: implemented

[English](2026-07-26-code-dispatch-ui-foundation.md) | 繁體中文

> 範圍：讓 UI 能以與原生工具呼叫相同的保真度渲染 Code Mode 輪次的宿主側約定變更，即其他 Code Mode UI Agent Note 賴以建置的基礎。傳輸設計歸 [Code Mode 基礎](2026-06-15-code-mode.md)所有；模型可見的 `description` 參數、攜帶完整內容的 `tool/code-dispatch` 載荷，以及 `dsh` 設定樹上臨時的 `DSH_TOOLS_MODE` 啟用開關，歸本篇所有。

## 問題

`run_code` 輪次過去在每個產品介面上都不透明。呼叫卡片的標題就是原始程序文字，在行寬內無法閱讀；而且不同於 `bash`（其必填的 `description` 用作卡片標籤，命令本身放在展開後的輸入裡），`run_code` 完全沒有模型撰寫的標籤。`tool/code-dispatch` 事件過去只攜帶每個子呼叫的 `resultSummary`（上限 200 字元、經 cwd 歸一化），因此任何 UI 都無從展示子呼叫實際返回的內容：Web 對話檢視表（[chat 子呼叫行](2026-07-26-code-mode-chat-subcall-rows.md)）會用渲染原生 `tool/result` 卡片的同一批元件來渲染子呼叫，而有界摘要無法支撐一張與原生同等保真的卡片。同時，`dsh web` 組合此前根本無法啟用 Code Mode：`tools` 行釘死在 schema 預設值上，設定樹裡也完全沒有該執行時期。

## 決策

三項變更，每項對應一個障礙：

1. **`run_code` 新增必填的 `description` 參數**（與 bash 完全相同的約定：主動語態、5-10 個詞、展示在 UI 中；僅含空白的取值在執行時被拒絕）。`presentCall` 現在以該 description 作為卡片標題，並把程序文字移入 `rawInput`。提示詞側的成本是每次呼叫多出幾個 token；換來的是每個介面——TUI 卡片、ACP（Agent Client Protocol）標題、Web 行——都無需解析 TypeScript 就能獲得可供人閱讀的標籤。
2. **`tool/code-dispatch` 記錄子呼叫面向模型的完整結果**（`content: ContentBlock[]` 加 `isError`，即 `tool/result` 的詞彙），取代 `resultSummary`，並把摘要與 cwd 歸一化機制徹底刪除。UI 渲染子呼叫走的程式碼路徑與渲染原生結果完全相同，包括錯誤文字和非文字塊。該事件仍僅用於日誌（`deriveMessages()` 忽略它）：模型上下文沒有任何變化。
3. **`dsh` 設定樹上的 `DSH_TOOLS_MODE` 環境變數**（`native`|`code`|`both`；未設定時保持 schema 預設值）：`tools` 行透過 `!!js` 讀取它，worker 程式碼執行時期則無條件掛載（本項交付時 loader 元資料仍是靜態的，因此不存在條件行；後來的 [`disabled` 插值決策](../architecture/2026-08-11-loader-entry-disabled-interpolation.md) 讓條件行成為可能，但此處不變——native 啟動只是註冊該服務，worker 要到每次執行時期才 spawn）。這是一個明確標注為臨時的設定掛鉤：設計目標是讓 Web UI 擁有按工作階段的工具模式選擇，該目標落地後，這個環境變數隨即退役。

## 曾考慮的替代方案

**保留有界摘要（提高上限，或上限加 `truncated` 標志）。** 否決：本堆疊 PR（Pull Request）鏈已敲定的要求是，子呼叫的行與詳情必須與原生呼叫渲染得*完全一致*；任何上限都會強制引入第二條降級的渲染路徑，外加截斷 UI。轉而接受的代價是：讀取大文件的程序會把渲染後的內容原樣記錄在分發事件上，不設上限、位於 spill 策略之外，並以同樣的位元組數增大工作階段日誌。持久化副本的 spill 整合已作為 [code-dispatch 日誌 spill](2026-07-26-code-dispatch-log-spill.md) 交付。

**一個 `--tools-mode` CLI（命令列介面）標志或 profile 設定鍵。** 推遲，而非否決：標志文法暗示永久性，profile JSON 又是使用者設定；兩者都會固化這個 seam，而按工作階段選擇的設計本就打算移除它。環境變數則如實呈現了它權宜之計的本質。

**記錄規範 `value`，而非渲染後的 `content`。** 否決：`tool/result` 持久化的是內容而非值（見[規範輸出約定](../architecture/2026-07-20-canonical-tool-output-contract.md)），與原生同等保真意味著與之精確對齊；值始終僅存在於執行期本機。

## 後果

工作階段格式保持 `SESSION_FORMAT_VERSION` 為 0（預發布階段的變動不遞增版本號；攜帶 `resultSummary` 的舊日誌只是多出一個不被讀取的欄位並缺少 `content`；v0 不作任何相容性承諾）。既有的 Code Mode 快照 fixture（測試前置資料）已重新錄制。模型可見範圍擴大了：`run_code` 的 schema（新增一個必填參數）以及每一份 Code Mode 系統提示詞／工具 schema 快照都發生了變化。Web UI 工作直接建置在新的事件載荷之上；每個子呼叫的即時執行狀態已把本事件重塑為一對分發 start/end 事件（[即時平行分發](2026-07-26-code-mode-live-parallel-dispatch.md)）。
