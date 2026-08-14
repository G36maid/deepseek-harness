# acp-agent 示例

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

透過 JSON-RPC stdio 提供的面向自動化的 [ACP（Agent Client Protocol）](https://agentclientprotocol.com) 伺服器。它面向 parent agent（父代理）、subagent 提供方和其他程序化用戶端，而非產品 UI。

```sh
pnpm run demo:acp             # needs DEEPSEEK_API_KEY (repo-root .env or env)
pnpm run demo:code-mode       # same protocol with the Code Mode tool transport
```

該葉節點載入 ACP 應用、DeepSeek 配接器、受沙盒限制的 bash 與檔案系統棧、一次性批准策略、壓縮（compaction）、subagent、工作流程、掛鉤、派生工作階段查詢索引和重複守衛。應用為每次 `session/new` 建立一個新 agent，將工作階段持久化到 JSONL，並保持 stdout 只含協議內容。選填 overlay 可新增工作階段查詢、檔案系統 spill 儲存、Code Mode 或 Web 抓取。

## 協議通道

Stdout 只攜帶以換行分隔的 ACP JSON-RPC。`@deepseek-ai/dsh-acp-demo` 不安裝 stdout logger；該葉節點新增的元件必須使用 stderr 輸出診斷資訊。

自動化約定（支持的方法、基線提示詞內容、已提交文字輸出，以及有意缺少的 UI 介面）位於 [`@deepseek-ai/dsh-acp`](../../packages/acp/acp/README.md)。

## 工作階段 workspace 與權限

每次 `session/new` 都提供一個絕對 `cwd`。受沙盒限制的 bash 和檔案系統修改會以該工作階段 cwd 為基準應用 `workspace-write`，因此並行工作階段可以使用不同的項目根目錄；平臺臨時根目錄仍是共享可寫暫存空間（參見[沙盒約定](../../packages/sandbox/sandbox/README.md)）。`DSH_PERMISSION_MODE` 為部署選擇 `workspace-write` 或 `danger-full-access`。

在 `workspace-write` 下，如果模型重試請求更廣泛的沙盒訪問權限，就會觸發 `session/request_permission`，選項為 `allow_once` 和 `reject_once`。用戶端以程序方式決策；用戶端放棄選擇或無法給出答覆時，系統會按拒絕處理。選定結果僅適用於該次重試，並透過常規工具結果／審計路徑記錄。伺服器絕不公開權限選擇器，也不持久化用戶端策略。
