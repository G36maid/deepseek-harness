# Agent Note: 移除 stdio 和 Echo agent

Status: implemented

[English](2026-07-20-remove-stdio-and-echo-agents.md) | [简体中文](2026-07-20-remove-stdio-and-echo-agents.zh.md) | 繁體中文

## 問題

DeepSeek Harness 在 TUI 和 Headless coding agent 之外，還提供了兩個重複的產品 agent（代理）。面向行的 stdio agent 使用混合的提示符/輸出協議，同時重複實作終端機互動與非互動執行。Echo 則以無需聯網的 mock 模型加一個教學工具重複實作 Headless，把測試 fixture（測試前置資料）變成面向使用者的 agent 和默認快速上手路徑。

兩個 agent 的配套實作都不止葉節點設定。stdio 擁有 UI 外掛程式、app 包（package）、SDK 介面、REPL 葉節點、提示符協議和 Loader 測試。Echo 擁有可執行命令、mock 配接器、工具、CI 演示閘門、圖譜條目、教學引用和共享測試 fixture。保留其中任何產品路徑，都會間接保留這個重複的 agent。

標準輸入輸出仍是 ACP、JSON-RPC、MCP 和子行程的協議邊界。確定性模型配接器也仍可用於測試。這些機制不足以成為保留面向行或僅使用 mock 的產品 agent 的理由。

## 決策

徹底移除 stdio 和 Echo agent，不提供相容包、模式、命令或別名。刪除 stdio UI 包與 app 包、`examples/repl-agent`、`examples/echo-agent`、`demo:repl`、`demo:echo`、各自的專屬測試，以及相關的 manifest（中繼資料清單）、閘門、圖譜和文件條目。

保留的應用角色均有明確歸屬：

- `@deepseek-ai/dsh-tui` 負責終端機互動式執行。它會在 Loader 啟動前拒絕非 TTY 流；`apps/cli/config/base.cordis.yml` 與 `tui.cordis.yml` overlay 擁有完整 coding 組裝，PTY 與終端機快照覆蓋則位於 `apps/cli/tests/`。
- [`dsh --profile headless`](../../../../apps/cli/README.md) 負責非互動式執行。其 `headless` profile 是產品組裝；`examples/headless-agent` 負責重播快照、通用真實 agent 測試套件和未匯出的無金鑰 Loader driver。
- [`@deepseek-ai/dsh-acp-demo`](../../../../packages/examples/acp-demo/README.md) 和 `@deepseek-ai/dsh-sdk-jsonrpc-server` 負責各自的分幀協議整合。

承載 `stdio` 執行介面選項的 SDK 項目模型已由 [SDK 項目工具鏈移除決策](2026-08-11-remove-sdk-project-toolchain.md)刪除。倉庫中的演示文件要求 DeepSeek API key，並優先引導到當前可執行的產品。

無金鑰驗證由測試負責。Headless Loader 冒煙測試使用 fixture 配接器驗證真實工具往返；`dsh` built-bin 測試套件固定已發布的一次性入口和輸出；產品 Headless 快照固定持久化；Headless PTY 關閉 e2e 固定訊號升級。各包專屬的 Loader 測試則將確定性配接器放在對應場景旁。其中任何一項都不會作為可執行的 mock agent 對外暴露。

## 驗證

TUI 與 Headless 的 Loader 覆蓋以原始碼和建置產物兩種模式執行真實 app 包。由 PTY 驅動的子行程覆蓋僅用於 TUI 生命週期；其他入口冒煙測試使用單次管道協議。Headless 驗證任務/結果約定和工具呼叫約定。生成圖譜與倉庫搜尋會拒絕過時的包、命令、葉節點、SDK 介面、`createStdioChat` 和 `StdioRuntime` 引用。

建置後的 `dsh` 可執行文件會在 Loader 啟動前拒絕透過管道啟動 TUI，並指向 `dsh --profile headless`；`apps/cli/tests/built-bin.e2e.ts` 在普通 Node 下固定產品的一次性入口，包括輸出和無效參數。`examples/headless-agent/tests/headless.snapshot.ts` 固定產品持久化，`apps/cli/tests/headless-shutdown.e2e.ts` 則負責有界訊號升級。headless 示例僅供測試的 JSONL driver 保留組裝後的規範事件快照，而不會建立第二套 CLI（命令列介面）約定。Code Mode 由程序化 TUI 快照與 ACP overlay demo 覆蓋。時間上下文整合透過顯式的 Headless 測試組裝執行兩個有序輪次，而更細粒度的耗時行為由時間上下文的包級測試負責。

## 曾考慮的替代方案

- **僅為 pipe 保留面向行 agent**：不予採納，因為 Headless 已提供有界任務約定、格式純淨的 stdout、持久完成邊界和行程退出狀態。
- **將 readline helper 作為包保留、摺疊或提升**：不予採納，因為它只有一個 app 消費端，並不存在可獨立替換的約定。將它摺疊進 stdio app 雖然移除了沒有正當理由的支撐包邊界，卻仍保留了重複產品；將來要重新引入這個包，獨立的面向行 UI 必須先有真正的第二個消費端。
- **保留 Echo 作為無金鑰快速上手路徑**：不予採納，因為首次產品體驗應使用真實模型和受支持的 coding agent，而不是帶專用工具的指令碼化配接器。
- **只為 CI 演示命令保留 Echo**：不予採納，因為由測試持有的 Headless fixture 可以覆蓋相同的 Loader 和建置產物邊界，無需保留 mock 產品葉節點。
- **移除所有 stdio 或 mock 機制**：不予採納，因為分幀協議、行程 I/O 和確定性測試配接器是獨立基礎設施，並不是被移除的 agent。

## 後果

- 互動式與非互動式產品執行分別只有一個歸屬方和一個可執行的 coding 葉節點。
- 倉庫沒有面向使用者的無金鑰 agent 演示；本機 agent 演示需要 `DEEPSEEK_API_KEY`。
- CI 通過測試 fixture 保留針對真實入口的無金鑰覆蓋，而不是相依性產品命令。
- 既有 stdio agent 設定和 Echo 命令會直接失敗，不會被轉換。
- 有意移除了單行程內基於管道的多輪互動，以及面向非 TTY `ask_user_question` 的 readline 提供方；復原工作階段可以滿足持久多輪工作，非 TTY 組裝則必須自行提供互動提供方。
