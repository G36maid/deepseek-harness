# @deepseek-ai/dsh-sdk-jsonrpc-server

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

`jsonrpc` 外掛程式透過 stdio 提供以換行符分隔的 JSON-RPC，使行程外 SDK 用戶端能夠驅動程式 harness agent（代理）。[`HarnessSdkJsonRpcServer`](src/server.ts) 負責協議方法和通知；傳輸與具名協議類型位於 [`dsh-sdk-protocol`](../protocol/README.md)，與用戶端 SDK 共享；[`jsonrpc-demo`](../../examples/jsonrpc-demo/README.md) 提供外圍的 `cordis.yml` 應用。

## 組裝

`inject: ['agents']`。伺服器按 `sessionId` 取得或建立一個 agent。只有服務對生命週期建立快照時記錄的 `local` 標志為 true，伺服器才會轉發 subagent 完成事件；提供方名稱、子級 id 和持久化譜系均不能證明本機性。已註冊的配接器優先；尚無配接器負責的 `deepseek-official` 路由會掛載 `dsh-llm-deepseek`，任何其他尚無配接器負責的提供方都會導致初始化失敗。其他能力由外圍 `cordis.yml` 提供。

## 設定

`maxTokensAsSuccess` 預設為 `false`，且隻影響 `subagent.finished` 上由部署對映的狀態；根工作階段提示詞沒有提示詞級狀態。`JsonRpcConfig.input`、`output` 和 `exit` 是僅供執行時期使用的傳輸掛鉤；生產環境使用行程 stdio 和 `process.exit`。

## stdout 即協議

Stdout 只承載 JSON-RPC 幀。部署不得組合 stdout logger；診斷應寫入 stderr。

## 關閉與退出語義

外掛程式回應 `shutdown`，刷新回應並 dispose（資源釋放）根上下文，使 SDK 持有的 agent、訂閱和持久化達到完全靜止，然後以程式碼 0 退出。EOF 和訊號退出由 app bin 處理，後者也會 dispose 根上下文。僅解除安裝此外掛程式會停止服務，但不會退出行程。

## 協議說明

`initialize.serverInfo.name` 的協議穩定值為 `deepseek-harness-sdk-runtime`。選填的正整數 `initialize.maxTokens` 會成為每個 SDK 建立的 agent 及其行程內後代的請求輸出上限；非法值會使初始化失敗，省略時則不傳送 SDK 上限，並應用所選配接器或提供方路由的預設值。`session/prompt` 將一條帶標識的使用者訊息排入佇列，並立即返回 `{ messageId }`。伺服器將每個持久事實作為 `session.event` 流式寄出，並將整個 agent 生命週期的每次狀態轉換作為 `session.status` 寄出；它不會把某條助手訊息或 `turn/end` 歸屬於該提示詞。同一工作階段上的獨立請求可以繼續排入更多工作。持久化根目錄和 persona 由 `cordis.yml` 提供。

## 模型體驗

### SDK 使用者訊息

#### 模型看到的內容

對於每個已接受的 `session/prompt`，對話模型會將呼叫方提供的 `contentBlocks` 原樣作為該 SDK 工作階段中的一條使用者訊息接收。此包不會新增系統提示詞文字或工具 schema；這些內容來自外圍 `cordis.yml` 中的外掛程式。

#### Token 影響

依資料而定的使用者訊息 token 會進入保留的工作階段歷史，並在後續輪次中重複傳送，直至另一個包將其壓縮（compaction）。JSON-RPC 幀、工作階段通知和伺服器內部記錄不會增加模型上下文 token。

#### KV Cache 影響

僅附加；新可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **協議沒有逐工作階段關閉或提示詞取消方法**：SDK 建立的 agent 會一直存活到行程關閉。
- **沒有逐提示詞結果**：`MessageId` 只標識 inbox 准入；擁有自動化活動區間的用戶端必須自行定義並觀察該區間。
- **stdout 純淨性由部署保證**：外圍設定仍可能載入 stdout logger 並破壞 JSON-RPC 通道；此外掛程式不會檢查或否決同級 logger。
- **自動掛載配接器僅支持 DeepSeek**：`initialize` 可以複用任何預先註冊的模型配接器，但唯一的回退行為是掛載 `dsh-llm-deepseek`。
