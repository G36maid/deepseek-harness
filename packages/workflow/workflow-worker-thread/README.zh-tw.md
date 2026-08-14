# @deepseek-ai/dsh-workflow-worker-thread

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

本包為 `WorkflowEngine` 提供實作，每次執行使用一個 Node worker thread。worker 執行編排指令碼；子 agent（代理）留在宿主上，指令碼透過帶類型的宿主／worker 協議經由 `ctx.subagents` 訪問它們。

包根目錄默認匯出引擎外掛程式及其 `Config`；worker 協議、執行時期和工作階段模組均為實作私有。操作入口 `./worker` 仍是引擎的 spawn 目標。

這種拆分只有一個主要目的：同步指令碼迴圈不能阻塞 harness 事件迴圈，忽略取消的指令碼可以連同其 worker 一起終止。它不是安全沙盒。

## 信任與隔離邊界

工作流程指令碼由模型編寫，信任前提與模型已有的 bash 訪問相同。worker 內的 `node:vm` 是塑造 API 的機制，不是安全邊界：逃逸的指令碼可以用宿主行程權限重新取得 Node 能力。

worker 仍提供實用的隔離：

- 指令碼 CPU 工作和同步自旋不會佔用宿主事件迴圈；
- `worker.terminate()` 為 dispose（資源釋放）提供真實的最終停止手段；
- 除未建置 loader 所需的銜接設定外，worker 以空環境啟動，因此環境憑據不會透過 `process.env` 跨越邊界；
- 宿主/worker 訊息使用結構化克隆資料，並在指令碼邊界執行普通 JSON 校驗。

真正的不可信指令碼沙盒需要在同一工作流程 seam 背後採用不同引擎。

## 指令碼約定

工作流程的 `meta` 是宿主提供的資料，而不是待求值的指令碼文字。引擎會校驗必需的 `name` 和 `description`、拒絕未知欄位，並在返回執行前檢查指令碼正文能否解析。

在 worker 內，指令碼會收到 `args` 以及以下掛鉤：

- `agent(prompt, { label, phase, schema, model })` 啟動一個宿主側 subagent。提供 schema 時返回結構化值，否則返回最終文字。普通子 agent 失敗會產生 `null`；
- `parallel(thunks)` 在已設定的並行限制下執行 thunk；
- `pipeline(items, ...stages)` 在沒有跨階段屏障的情況下傳遞 `(previous, item, index)`；
- `phase(title)` 和 `log(message)` 寄出觀察器敘述。

未知選項、格式錯誤的參數、不支持的 schema、超出上限、提供方啟動失敗和基礎設施結果失敗都屬於致命工作流程錯誤。有意不注入 timer、檔案系統 API 或 Node 全域性變數，但上述信任注意事項仍然適用。

## 執行順序

`start()` 會校驗 meta、解析指令碼正文、解析一個已註冊且規範化的提供方路由，並解析每次執行的子 agent 總數上限，然後才建立 worker 或發布 `workflow/start`。請求的 `maxTotalAgents` 必須是正安全整數，且不能超過引擎設定的部署上限。原始碼模式透過 data URL bootstrap 安裝 TypeScript 轉換；建置模式把同級 `lib/worker.cjs` 作為檔案系統路徑傳入，因為 pkg 的虛擬檔案系統（VFS）掛鉤要求 CommonJS。兩者都能在普通 Node 下執行。ready/go 握手可以避免啟動訊號取消與 worker 啟動發生競態，導致指令碼最初的同步片段被執行。

對於每次 `agent()` 呼叫：

1. worker 傳送 `child-start`，其中包含普通資料提示詞和選項。
2. 宿主透過非同步 `SubagentRuntime.start` 呼叫啟動請求中指定的提供方，否則呼叫已設定的提供方；呼叫會傳入工作流程父級和該次執行共用的唯一中止訊號。提供方選擇應用於該次執行的每個子 agent，對指令碼不可見。
3. 如果啟動被拒絕，宿主會發送 `child-start-error`；提供方啟動已經完全靜止，不會發出子 agent 生命週期事件。
4. 如果啟動兌現時工作流程仍接納工作，宿主會記錄該執行、觀察 `result`，然後傳送 `child-started`。即使結果已經結帳，也只會隨後轉發，以保持先啟動、後結果的順序。
5. worker 寄出成對的 `workflow/agent-start` 和 `workflow/agent-end` 敘述，並在收集後請求 dispose 子 agent。

提供方啟動與已發布子 agent 分開跟蹤。如果啟動仍在等待，而取消、worker 死亡或正常工作流程結帳關閉了接納，共享訊號會中止該啟動。即便提供方隨後兌現，宿主也會 dispose 它，且絕不向 worker 通知。

## 值邊界

離開指令碼的值會經過 `materializeFromRealm`；該函式接受普通的無損 JSON 資料，並拒絕特殊原型、函式、symbol、迴圈、稀疏陣列、非有限數和巢狀 `undefined`。遍歷在 worker 內執行，並把對象鍵定義為資料屬性，使 `__proto__` 無法改變原型。

子 agent 結果從宿主跨越到 worker 之前，會先投影並製作快照。這是真正近似行程的序列化邊界；它有意不同於可信的同進程工作流程和 subagent 事件 payload，後者以不可變方式借用值。

## 取消與 dispose

`WorkflowRun.cancel()` 會記錄第一個原因、通知 worker 取消、中止每個待處理及已發布子 agent 共享的唯一訊號，並啟動 `disposeGraceMs` 定時器。worker 掛鉤會在下次 await 時拋出 `CANCELLED`。如果執行到期限仍未結帳，宿主會將其以已取消狀態兌現、為懸空的子 agent 生命週期事件配對，並終止 worker。

subagent seam 只有一個取消通道：請求訊號。不存在單獨的子 agent 取消 RPC。已發布子 agent 使用 `run.dispose()` 清理；待處理的提供方啟動在其 promise 拒絕或兌現前仍由提供方負責。

正常結帳也會中止待處理啟動，並在結果對外結帳前開始 dispose 所有已發布但無需等待的子 agent。宿主的完全靜止條件同時包括待處理啟動和已發布子 agent 的 dispose，因此清理不會遺漏非同步啟動交易。

`dispose()` 是冪等的。它會取消執行、立即啟動宿主驅動程式的 dispose、在同一寬限時間內等待結果和子 agent 完全靜止、無條件終止 worker，並執行最後一次倖存項掃描。每個子 agent 的 dispose 都會記憶化，使 worker RPC、宿主取消、死亡清理和公開 dispose 都匯入同一操作。

## 結果與事件保證

在宿主的結果確認點，終態結果遵循先到者勝。已接受的外部取消會覆蓋後到的非取消 worker 結果；先完成確認的結果或 worker 死亡不能被可重入清理回呼改寫。

worker 錯誤、訊息失敗或提前退出會在清理前關閉訊息接納，然後以 `error` 兌現；如果取消已經接管該執行，則不覆蓋取消。後到的排隊訊息無法在該邏輯邊界後建立子 agent 或寄出敘述。

宿主會維護已轉發子 agent 啟動的臺帳。優雅退出的 worker 會提供對應的結束事件；死亡或強制終止會把缺失的結束事件合成為已取消。因此，每個已轉發的 `workflow/agent-start` 都會且只會配對一次，不過已經到達的工作流程結果之後的清理可能稍後才完成。

## 設定

| 鍵 | 預設值 | 含義 |
|---|---|---|
| `provider` | `spawn` | `agent()` 使用的宿主側 subagent 提供方。 |
| `maxConcurrentAgents` | `0` | 並行 `agent()` 上限；`0` 會根據可用 CPU 平行度解析。 |
| `maxTotalAgents` | `1000` | 一次執行中的 `agent()` 呼叫總數。 |
| `maxItemsPerCall` | `4096` | 一次 `parallel()` 或 `pipeline()` 呼叫接受的條目數。 |
| `syncTimeoutMs` | `5000` | 指令碼最初同步片段的 VM 逾時時間。 |
| `disposeGraceMs` | `5000` | 強制結帳/終止之前的期限，也是公開 dispose 的期限。 |

負責該引擎的消費端可以為一次執行設定 `WorkflowStartRequest.subagentProvider` 和 `WorkflowStartRequest.maxTotalAgents`。它們屬於引擎級策略，不是指令碼掛鉤或面向模型的選項；普通 `workflow` 工具不會設定兩者。每次執行的子 agent 總數上限可以降低、但絕不能提高已設定的 `maxTotalAgents` 上限。

## 模型體驗

### 子 agent 請求

#### 模型看到的內容

指令碼每次呼叫 `agent()`，都會把提示詞原樣傳送給 subagent 提供方，並附帶選填模型或結構化輸出 schema。每個子 agent 看到該提供方自己的上下文；phase 和 log 敘述只留在觀察器事件中。

#### Token 影響

可能需要為許多獨立子 agent 上下文付款 token 成本，數量受 `maxConcurrentAgents`、`maxTotalAgents` 和 `maxItemsPerCall` 限制；這些上下文絕不會直接加入父級歷史。

#### KV Cache 影響

與父級請求快取和同級子 agent 快取相互獨立。每個子 agent 只能在其自身提供方、模型、提示詞和 schema 下複用逐位元組相同的前綴；其後續歷史僅附加成長。

### 父級工具結果（間接）

#### 模型看到的內容

透過 [`dsh-tool-workflow`](../tool-workflow/README.md)，成功結果只會在該消費端的包裝層中公開實體化的最終 JSON 值和子 agent 數量。本引擎提供穩定錯誤，包括 `workflow script does not parse: <error>`、`invalid meta: <violations>`、`agent() requires a non-empty prompt string`、`agent() could not start a child: <error>`、`child agent run failed: <error>`，以及其精確的 `parallel()`、`pipeline()`、`phase()`、選項、schema 和 JSON 邊界校驗訊息。中間子 agent 輸出可供指令碼使用，但不提供給父模型。

#### Token 影響

本引擎不會直接向父級新增 token。最終結果大小由工具消費端限制，並保留到壓縮（compaction）為止。

#### KV Cache 影響

僅附加；新增可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **worker/vm 不是安全邊界**：模型編寫的程式碼可以逃逸 `node:vm` 並取得 worker 的行程權限；不可信程式碼部署需要獨立行程或容器引擎。
- **每次執行都要付款一個 worker thread 的成本**：沒有池、預熱執行時期或跨執行指令碼快取。
- **不注入默認可用的定時器、檔案系統或網路，但逃逸程式碼仍可訪問 Node**：這些缺失的全域性變數屬於可移植性 API 設計，而非隔離措施。
- **終止只能報告宿主觀察到的啟動**：`agentsStarted` 不包括因並行限制仍在 worker 側排隊、且在強制終止後無法得知的呼叫。
- **跨 realm 錯誤在指令碼內無法透過 `instanceof Error`**：工作流程作者必須根據 `name` 和 `code` 等穩定欄位分支。
