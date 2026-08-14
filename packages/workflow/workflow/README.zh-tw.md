# @deepseek-ai/dsh-workflow

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

工作流程 seam（擴充點，`ctx.workflowEngine`）執行由模型編寫、可扇出 subagent 的編排指令碼。該 seam 定義指令碼、執行、結果、錯誤和事件契約；引擎負責決定如何隔離並執行指令碼。

`@deepseek-ai/dsh-workflow-worker-thread` 是當前引擎，`@deepseek-ai/dsh-tool-workflow` 是面向模型的消費端。未來的行程或沙盒引擎可以替換實作，而無需更改工具。

包根是 Host face。瀏覽器安全的 `@deepseek-ai/dsh-workflow/types` 子路徑包含執行身份、元資料、結果和僅供觀察的生命週期 payload，不匯入 `Agent`、Cordis service 或 Host Context 聲明；Host 專用的 `WorkflowStartRequest` 與 `WorkflowRun` 只從包根提供。

## 服務與執行契約

`WorkflowEngine.start(request): WorkflowRun` 會同步完成足夠多的校驗，在執行建立前拒絕格式錯誤的 meta 塊、無法解析的指令碼、不可用的提供方路由或不受支持的單次執行限制。返回後，`WorkflowRun.result` 絕不拒絕：執行失敗以 `stopReason: 'error'` 兌現，取消則在引擎有限的寬限時間內以 `cancelled` 兌現。

執行由持有方負責。引擎外掛程式解除安裝會阻止新的啟動，但不會撤銷已接受的執行。持有方必須在每條路徑上呼叫 `dispose()`；dispose（資源釋放）會取消剩餘工作，並在文件規定的期限內達到或放棄完全靜止。

`WorkflowStartRequest` 包含 `{ meta, script, args?, subagentProvider?, maxTotalAgents?, parent, signal? }`。`parent` 把每個子 agent（代理）歸屬於呼叫 agent。`subagentProvider` 可以為該次執行的所有子 agent 指定路由，同時不向指令碼公開提供方選擇；省略時使用引擎設定的提供方。`maxTotalAgents` 可以為一次執行降低引擎的部署上限，同樣對指令碼不可見。實作會同步拒絕無效路由和限制。`meta` 與 `args` 是普通資料，不是指令碼片段。

`WorkflowRun` 公開 `{ id, meta, result, cancel(reason?), dispose() }`。`WorkflowResult` 包含 `{ value, stopReason, error?, agentsStarted }`；`value` 是普通 JSON 資料或 `null`。

## 事件

工作流程事件只供觀察。它們攜帶 `WorkflowRunInfo`（`id` 加 `meta`），而不是活動執行，因此監聽器無法取得取消或 dispose 權限。

- `workflow/start` / `workflow/end` 為執行配對；
- `workflow/phase` 和 `workflow/log` 公開指令碼敘述；
- `workflow/agent-start` / `workflow/agent-end` 按 `seq` 為每次子 agent 呼叫配對；提供方的非同步啟動呼叫被拒絕時，該子 agent 不會發出其中任何一個事件。

同進程事件 payload 是以不可變方式借用的值。每個監聽器都獨立隔離：同步拋出例外或返回的 promise 被拒絕時，只會記錄日誌，不會阻塞同級監聽器或改變執行。

## 失敗紀律

`WorkflowError` 攜帶一個程式碼和 `fatal` 標志。致命錯誤總會逸出 `parallel()` 和 `pipeline()`，而不會變成普通的逐項 `null`：

- `SCRIPT_PARSE` / `META_INVALID`：工作流程無法啟動；
- `INVALID_ARGUMENT` / `UNSUPPORTED_OPTION` / `UNSUPPORTED_SCHEMA`：掛鉤呼叫違反引擎契約；
- `AGENT_CAP` / `ITEM_CAP`：超過已設定的安全上限；
- `AGENT_START`：提供方的非同步啟動呼叫被拒絕；
- `AGENT_RESULT`：已發布子 agent 的結果因基礎設施故障而被拒絕；
- `RESULT_UNSERIALIZABLE`：指令碼/worker 值不是普通 JSON 資料；
- `CANCELLED`：取消會接管該執行，待處理和未來的掛鉤都會拒絕。

子 agent 若以非完成的結束原因正常兌現，並不屬於基礎設施例外：`agent()` 返回 `null`，使指令碼可以處理普通的子 agent 失敗。

## 模型體驗

透過 `dsh-tool-workflow` 和工作流程引擎間接產生影響；兩者建立子 agent 請求，並返回保留在父級的工具結果。

#### KV Cache 影響

不會直接導致 KV Cache 失效；請求前綴的任何變化均由上述消費端負責。

## 已知限制與暫緩事項

- **僅支持前臺收集**：呼叫方負責一個活動執行並等待它；後臺啟動／輪詢、spill 控制代碼和分離收集均暫緩處理。
- **沒有日誌化或復原**：指令碼、子 agent 進度和中間值均不設檢查點，因此行程重新啟動後無法繼續執行。
- **沒有已保存或巢狀工作流程**：該 seam 只啟動呼叫方提供的指令碼，工作流程指令碼不會收到用於遞迴編排的 `workflow()` 掛鉤。
- **沒有 token 預算詞彙**：引擎會限制並行、條目和子 agent，但請求與結果都不會統計跨子 agent 的模型 token。
- **執行由持有方負責，不由服務跟蹤**：解除安裝引擎不會發現獨立的活動控制代碼；每個消費端都必須 dispose 自己啟動的執行。

暫緩實作的工作流程介面見[動態工作流程 Agent Note（agent 決策記錄）](../../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md)。
