# Agent Note: 移除獨立的 CLI demo

Status: implemented

[English](2026-08-08-remove-cli-demo.md) | [简体中文](2026-08-08-remove-cli-demo.zh.md) | 繁體中文

## 問題

在 [`dsh --profile headless`](../architecture/2026-08-06-app-owned-command-line.md) 成為產品的一次性命令後，`@deepseek-ai/dsh-cli-demo` 仍是承擔同一工作的第二個應用包。它另行擁有一套可執行文件、參數文法、應用組裝、取消生命週期、文字／JSON／stream-JSON 輸出約定、建置產物、配套文件和測試套件。兩個入口組裝的樹也不相同，因此 demo 成功不能證明已交付的 `headless` profile 可用，使用者還必須在功能重疊的命令之間作出選擇。

重播套件仍需要規範工作階段事件來固定組裝後的後端行為。這一測試需求不需要已發布命令或相容性約定。

## 決策

徹底刪除 `@deepseek-ai/dsh-cli-demo`：包括它的包、bin、解析器、應用外掛程式、輸出格式、測試、workspace 引用、生成目錄條目和現行文件。不保留別名或相容包。原始碼使用者透過 `pnpm dsh --profile headless` 呼叫產品命令；stdout 上的最終文字、stderr 上的失敗診斷、持久化、退出狀態和關閉行為均由該命令負責。

`examples/headless-agent` 成為顯式測試組裝。其 Loader 設定把 `@deepseek-ai/dsh-agent-spine-demo`、一個根 agent（代理）、JSONL 持久化和檢查點策略掛載為獨立設定行，不再將其隱藏在應用組合包之後。支持層的 `@deepseek-ai/dsh-loader-smoke` 包負責共享的直接 agent 輪次 helper；未匯出的示例本機 driver 選擇各自的 Loader 設定，並將規範事件渲染為 JSONL。這些 driver 只由測試啟動，不提供 bin，也不定義受支持的產品輸出格式。

## 考慮過的替代方案

- **保留 `dsh-cli-demo` 作為 `dsh --profile headless` 的別名或包裝層。** 不予採納：第二個 bin 和包會讓同一功能繼續存在兩個可發現的歸屬方，卻沒有增加任何能力。
- **把 JSON 和 stream-JSON 標志移到 `dsh --profile headless`。** 不予採納：當前沒有產品消費端需要這些標志；沿用舊 demo 協議，只會為了保留測試機制而擴大規範 CLI（命令列介面）約定。
- **隨包一並刪除規範事件快照。** 不予採納：這些快照固定了模型可見的組裝行為，而只檢查最終文字的產品驗收無法觀察這些行為。
- **保留應用外掛程式，只刪除它的 bin。** 不予採納：隱藏的組裝仍會重複顯式的 headless profile，並掩蓋測試葉節點掛載了哪些服務。

## 後果

這是有意為之的破壞性變更。`dsh-cli-demo`、它的 `--output-format` 選項以及對 `@deepseek-ai/dsh-cli-demo/src/cli.ts` 的匯入都不再可解析。本變更不提供公開的事件串流替代介面；呼叫方使用 `dsh --profile headless` 執行一次性任務，需要結構化自動化時則必須選擇現有的協議介面。

倉庫透過僅供測試的基礎設施保留後端重播覆蓋，產品冒煙測試和 built-bin 驗收則執行 `dsh --profile headless`。只有當獨立的一次性包負責一套真正獨立、帶版本且不能歸產品啟動器所有的協議時，它纔可以重新引入；第二種命令寫法或輸出 shim 並不足以構成理由。

## 驗證

聚焦的 Loader 冒煙測試在原始碼模式和由普通 Node 啟動的建置模式下覆蓋顯式組裝，快照測試對比其規範 JSONL 和持久化日誌，產品驗收覆蓋 `dsh --profile headless`，文件檢查及生成圖譜／目錄閘門則拒絕對已移除包的活躍引用。凍結的 Agent Note 歸檔保留為歷史證據，不會被重寫。
