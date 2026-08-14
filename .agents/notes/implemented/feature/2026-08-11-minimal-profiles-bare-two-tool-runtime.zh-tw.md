# Agent Note: minimal profile 使用裸雙工具執行時期

Status: implemented

[English](2026-08-11-minimal-profiles-bare-two-tool-runtime.md) | [简体中文](2026-08-11-minimal-profiles-bare-two-tool-runtime.zh.md) | 繁體中文

## 問題

Web `minimal` preset 與獨立 JSON-RPC minimal 組合對外提供持久 `bash` 和 `str_replace_editor`，但支撐服務與目標訓練執行時期不一致。兩者都掛載上下文壓縮，而 Web preset 繼承宿主的沙盒檔案系統，JSON-RPC 組合則掛載 `fs-sandbox` 和檔案系統策略。因此，長工作階段可能替換歷史記錄，編輯器也會宣告並實施裸本機參考執行時期並不具備的檔案系統策略。

兩條啟動路徑的設定所有者也不同。Web 在已執行的宿主上掛載逐 agent preset，Python SDK 則初始化一個完整的 stdio JSON-RPC 子行程。將二者視為可互換的同一個 Cordis leaf 會掩蓋生命週期差異，而且 SDK 示例沒有透過環境選擇模型或系統提示詞的入口。

## 決策

兩種隨附 minimal profile 都只對外提供持久 `bash` 與 `str_replace_editor`，不掛載上下文壓縮提供方，為新建工作階段抑制每個 `dsh-system-prompt` runtime-context 貢獻，並讓編輯器使用 `@deepseek-ai/dsh-fs-local`。Web preset 在 agent entry 內隔離 `ctx.fs`，將 `fs-local` 與編輯器一起掛載，因此其他 Web agent 仍使用宿主檔案系統提供方。其 persona 繼續採用較早的 [minimal preset 組合決策](../bug-fix/2026-08-10-minimal-preset-owns-rl-composition.md)所擁有的固定 complete 提示詞，並僅為該 agent 作用域實施 runtime-context 抑制。獨立 spine 將同一設定轉發給其行程擁有的 system-prompt 服務。沙盒與批准服務仍保持掛載並強制其策略；只有它們面向模型的動態上下文缺席。

獨立的 [`minimal.cordis.yml`](../../../../examples/jsonrpc-agent/minimal.cordis.yml) 仍是完整的 JSON-RPC 行程組合。它掛載 `dsh-sdk-jsonrpc-server`、持久 Bash 所需的本機 PTY 和子行程服務、`fs-local`、兩個工具消費端，以及未壓縮的 JSONL 持久化。它不掛載 `token-meter`、`compaction-basic`、`fs-sandbox` 或 `fs-observation-policy`。持久 Bash 仍消費部署的 danger-full-access 沙盒策略；編輯器不受該策略限制。

`DSH_SYSTEM_PROMPT` 選擇獨立組合的 persona。`DSH_MODEL` 命名 DeepSeek 提供方目錄項，`DSH_CONTEXT_WINDOW` 提供該目錄項的容量。由於 SDK 用戶端擁有 JSON-RPC `initialize` 請求，[`minimal.py`](../../../../examples/jsonrpc-agent/minimal.py)也使用 `DSH_MODEL` 作為 `model` 參數的預設值；顯式 `--model` 仍具有最高優先級。端點與憑據變數繼續由 DeepSeek 配接器現有的環境解析路徑持有。

## 驗證

Web 重播會啟動完整 Web 宿主，透過 preset 服務建立 agent，並斷言作用域檔案系統為裸後端、不存在作用域壓縮服務、沒有追加 system-prompt 擁有的 runtime-context 訊息，而且組裝請求只包含固定提示詞與兩個工具。隨後，它透過真實作用域服務執行持久 Bash 和編輯器。

SDK 重播透過 SDK 用戶端啟動真實 JSON-RPC agent 行程，注入由環境選擇的提示詞，斷言組裝提示詞與精確雙工具目錄，另外斷言不存在任何 system-prompt 擁有的 runtime-context 訊息，並執行兩個工具。Python SDK 內建執行時期覆蓋會透過每種可用的打包載體，使用環境選擇的模型、模型容量和提示詞值初始化獨立設定。Cordis 校驗會檢查兩份設定能否解析聲明的外掛程式和設定欄位。

## 考慮過的替代方案

**以較高閾值保留 `compaction-basic`。** 不予採用，因為即便提供方在短測試中未觸發，較長工作階段仍允許替換歷史記錄，而且 minimal 組合仍會相依性模型容量元資料與 token meter。

**在 danger-full-access 模式下保留 `fs-sandbox`。** 不予採用，因為沙盒提供方仍會使限權與提權成為編輯器能力的一部分。目標執行時期要求裸本機提供方，而其不具備 `sandboxMode` 正是組合事實。

**為 Web 與 Python SDK 啟動使用同一個 Cordis leaf。** 不予採用，因為 Web preset 向現有多工作階段宿主貢獻 agent 作用域服務，而 Python SDK 必須啟動包含 JSON-RPC 伺服器及其行程級相依性的完整行程。

**只在 Cordis 內讀取 `DSH_MODEL`。** 不予採用，因為 Cordis 設定提供方目錄，但不擁有 SDK 用戶端的 JSON-RPC `initialize` 請求。launcher 必須向用戶端請求傳遞同一個模型，環境值才能選擇路由模型。

## 後果

Minimal 工作階段不會摘要或替換較早歷史，也不會新增 runtime-context 快照；呼叫方必須讓工作階段輪次保持在所選模型的上下文容量內，且不得相依性模型可見的常駐沙盒或批准策略說明。編輯器可以訪問執行時期行程可見的任何絕對路徑，且不受持久 shell 沙盒策略影響。兩條啟動路徑共享面向模型的工具、無上下文與無壓縮保證，同時保留適合各自所有者的不同提示詞和模型設定。Python SDK 路徑繼續僅透過內建 stdio JSON-RPC 執行時期通訊。
