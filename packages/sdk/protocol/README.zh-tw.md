# @deepseek-ai/dsh-sdk-protocol

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

DeepSeek Harness SDK 執行時期的共享協定格式（wire format）：一個按換行分幀的 JSON-RPC 2.0 傳輸類，加上協定兩端共同使用的具名請求、結果與通知類型。包根枚舉協定消費端介面；源模組不支援深層匯入。伺服器端是 [`dsh-sdk-jsonrpc-server`](../server/README.md) 外掛程式；用戶端是 [`dsh-sdk-client`](../client/README.md)（TypeScript）與 [Python SDK](../../../python/README.md)（後者復現這些結構但不匯入它們）。純庫——無外掛程式、無 Config、無註冊。

## 傳輸

`JsonRpcLineTransport` 在呼叫方持有的位元組流上為 JSON-RPC 2.0 分幀，每行一個緊湊 JSON 幀、以 `\n` 結尾。帶 `id` 與 `method` 的幀是請求，僅 `id` 是回應，僅 `method` 是通知；非法 JSON 行被忽略。`start()` 掛接流監聽器，`close()` 移除監聽器並拒絕掛起請求，但不銷毀流。缺失請求處理器時應答 `-32601`；處理器返回的 Promise 被拒絕時，則應答攜帶錯誤訊息的 `-32603`。錯誤回應會以 `JsonRpcResponseError` 拒絕掛起的 `request()` Promise，並保留協定格式中的 `code` 與選填 `data`。`JsonRpcTransportPeer` 是伺服器類據以進行類型聲明的出站介面（request/notify）。

## 協定類型

`types.ts` 為 `HarnessSdkJsonRpcServer` 所服務協定的每個載荷命名：

| 方向 | 方法 | 類型 |
|---|---|---|
| client→server | `initialize` | `InitializeParams` → `InitializeResult` |
| client→server | `session/prompt` | `SessionPromptParams` → `SessionPromptResult`（持久入隊回執） |
| client→server | `shutdown` | 無參數 → `{}` |
| server→client | `session.event` | `SessionEventNotification`（執行時期內每個工作階段，不過濾） |
| server→client | `session.status` | `SessionStatusNotification`（整個 agent（代理）的 `running`/`idle` 轉換） |
| server→client | `subagent.started` | `SubagentStartedNotification` |
| server→client | `subagent.finished` | `SubagentFinishedNotification`（僅行程內執行） |

`HarnessSdkRequestMap` 與 `HarnessSdkNotificationMap` 按方法名索引這些類型。`SessionPromptResult.messageId` 標識已排隊的 `UserMessage`；它不標識後續的助手訊息、輪次結束或提示詞結果。用戶端根據自己對活動區間的所有權，組合持續開放的 `session.event` 流與 agent 級的 `session.status`。`SubagentFinishedNotification.lastAssistantMessage` 包含子 agent 最後一條非空 assistant 訊息；若不存在這類訊息，則包含其累積的 assistant 文字；子 agent 兩種輸出均未產生時，該欄位預設。`InitializeParams.maxTokens` 是選填的正的安全整數，用於限制 SDK 建立的 agent 及其行程內後代的每次對話模型輸出；省略時會應用所選配接器的確切模型預設值，否則提供方行為保持不變。通知載荷類型相依性 `SessionEvent`（`dsh-session`）、`ContentBlock`（`dsh-llm`）與 `SubagentStopReason`（`dsh-subagent`）——協定以完整工作階段日誌封套進行流式傳輸，因此工作階段詞彙是協定格式約定的一部分。`serverInfo.name` 的協定值固定為 `deepseek-harness-sdk-runtime`。

## 模型體驗

無，因為此包定義面向用戶端的協定格式；模型可見介面屬於組合在對外服務入口 [`dsh-sdk-jsonrpc-server`](../server/README.md) 後方的執行時期外掛程式。

#### KV Cache 影響

無；此包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **無協定版本協商**——握手只攜帶 `serverInfo.version`（`0.0.1`，用戶端不校驗）；處於預發布階段，無相容承諾。
- **無取消與工作階段關閉方法**——用戶端放棄輪次的方式是關閉執行時期行程；見 [`dsh-sdk-jsonrpc-server` README](../server/README.md)。
- **server→client 請求是未使用的功能**——傳輸層支援，但伺服器從不傳送；Python SDK 的應答介面為未來審批流程預留。
