# Agent Note: 結構化錯誤分類體系

Status: implemented

[English](2026-06-11-structured-error-taxonomy.md) | 繁體中文

## 問題

故障跨越 seam 時只是裸字串。工具錯誤被扁平化為一個文字塊（name、code 和 stack 全部丟失），導致未來的沙盒/重試外掛程式無法區分 ENOENT 和 EACCES，模型也未能獲得本可提供的更具可操作性的回饋。非 Error 的 throw 退化更嚴重：agent loop（代理循環）將其包裝為 `new Error(String(x))`，丟棄了所有 code。而 `LlmError` 是系統中唯一的類型化錯誤，沒有共享基類，消費端無法對其進行通用的 `instanceof` 判斷。

## 決策

在 `dsh-llm`（葉子包，所有其他包都已相依性它，不引入新的相依性邊）中引入一個 `HarnessError extends Error` 基類：穩定的 `code`（與 `message` 分離）、透過 `ErrorOptions` 進行 `cause` 連結、`name` 預設為子類名。`isHarnessError` 在 seam 處做類型收窄。

- `LlmError` 和 `ToolArgsError`（dsh-tools）繼承該基類，保留各自既有的 code。
- `ToolExecutionResult` 新增選填欄位 `error: { name, code }`，在登錄檔的 catch 中當拋出值為 `HarnessError` 時填充。agent loop 將其轉發到 `tool/result` 工作階段事件（該事件也新增了同一選填欄位），使結構化的失敗資訊保留在日誌中，供重試/沙盒外掛程式和重播使用。面向模型的文字塊保持不變。
- agent loop 的 `toError` 將非 Error 的 throw 包裝為 `HarnessError`（`code: 'UNKNOWN'`，原始值作為 `cause` 連結），而非裸 `Error`；這樣即使是不規範的 throw 也能攜帶可路由的 code 進入工作階段的 `error` 事件（該事件此前已暴露 `code`）。

## 後果

- 錯誤端到端可機器路由：外掛程式可以基於 `error.code` 分支，而無需對訊息做子串匹配。
- 一個基類被廣泛匯入，但它位於所有包已經相依性的包中，代價僅是一條 import 語句，而非新的相依性邊。
- `deriveMessages` 不會將 `error` 暴露到模型歷史中——模型仍然看到文字塊；結構化欄位服務於程式碼和重播。
- 參數校驗保留其既有的 code 和行為；包自有的診斷不變式獨立攜帶穩定 code，使不變式登錄檔無需匯入產品包。共享基類增加了跨 seam 的路由元資料，不改變面向模型的文字。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
