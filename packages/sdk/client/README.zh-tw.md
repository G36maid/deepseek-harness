# @deepseek-ai/dsh-sdk-client

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

以子行程方式驅動 DeepSeek Harness 執行時期、走 stdio JSON-RPC 的 TypeScript 用戶端 SDK——[Python SDK](../../../python/README.md)（`deepseek-harness`）的設計孿生，共享同一個執行時期對端、協定與分層：`DeepSeekHarness` 是高層自有執行 API，`HarnessClient` 是低層協定用戶端。包（package）根枚舉消費端介面：兩層用戶端、面向呼叫方的類型和 `JsonRpcResponseError`；源模組、規範化輔助函式與訂閱投遞機制不供消費端匯入。純庫：不在任何 Cordis 上下文註冊；它所 spawn 的執行時期行程是一個完整 harness，其組成由自己的 `cordis.yml` 決定。

與 Python SDK 不同，啟動規格完全顯式（`command`/`args`）：本包面向倉庫近旁的 TypeScript 消費端，包括 [`dsh-subagent-dsh-sdk`](../../subagent/subagent-dsh-sdk/README.md) 後端和自動化；它們知道自己要啟動哪個執行時期。捆綁執行時期解析（尋找打包可執行文件）仍歸 Python 發行版負責。

## DeepSeekHarness

```ts
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'

await using harness = new DeepSeekHarness({
  launch: { command: 'node', args: ['lib/bin.js', 'cordis.yml'] },
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  maxTokens: 49_152,
})
const result = await harness.run('say hi')
console.log(result.finalResponse)
```

子行程在首次使用時惰性啟動，並在多次 `run()` 之間持續歸實例所有；必須 `close()`（或 `await using`），子行程才總能被回收。`start()` 記憶化 `initialize` 握手（工作區 cwd——在透過協定傳輸之前解析為絕對路徑——加 provider/model 路由和選填的正整數 `maxTokens` 輸出上限）；握手失敗會回收執行時期並換入全新用戶端，後續呼叫用新子行程重試（直到終結性的 `close()`）。該上限作用於根 agent（代理）的每次請求，並由行程內後代繼承；壓縮（compaction）外掛程式單獨持有摘要上限。`session(id?)` 打開具名或全新的工作階段控制代碼。

`run(input, { sessionId?, onNotification? })` 擁有一個活動區間：它將提示詞排入佇列，等待其 `MessageId` 出現在持久的 `agent/inbox/spliced` 回執中，然後持續收集到整個 agent 下一次進入 `idle`。它返回 `RunResult { sessionId, finalResponse, events, notifications }`。`finalResponse` 是該區間內根工作階段最後提交的助手文字，並非因果上歸屬於該提示詞的回應；steering（中途引導）、注入的上下文和其他排隊工作都可能在 idle 前參與其中。`events` 包含根工作階段事件，`notifications` 還包含透過 `subagent.started` 發現的後代，均按協定傳輸順序排列。結果不攜帶提示詞級狀態或輪次原因。傳輸丟失、逾時和協定違例會導致 Promise 被拒絕；模型結果仍可在事件串流中觀察，但不會歸屬於某一輸入。

## HarnessClient

自有執行 API 之下的協定用戶端：顯式 `start()`/`initialize()`/`prompt()`/`request()`/`close()`，外加通知訂閱。`prompt()` 在執行時期接受排隊訊息後立即返回該訊息的 ID，絕不等待 agent 活動。`subscribe(filter?)` 返回 `NotificationSubscription`（可等待的 `next()`、非阻塞 `tryNext()`、非同步迭代）；`subscribeSessionTree(id)` 把範圍限定到一個工作階段及從 `subagent.started` 血緣邊發現的後代——執行時期對上下文內每個工作階段都發通知，範圍限定在用戶端完成，與 Python SDK 完全一致。本包匯出有明確類型的錯誤：`JsonRpcResponseError`（協定錯誤回應，保留 code/data）、`RequestTimeoutError`（設定的時限已到）、`SdkProtocolError`（回應超出文件化協定）、`TransportClosedError`（執行時期已消失——訊息攜帶結束碼與有界 stderr 尾部）。

`close()` 先請求協定 `shutdown`（受 `shutdownTimeoutMs` 約束，預設 1000 毫秒），然後走 stdin-EOF → SIGTERM → SIGKILL 階梯（`disposeEofGraceMs` 預設 6000，`disposeGraceMs` 預設 3000）直到行程真正結束。該階梯為本用戶端私有：它執行在任何 harness 上下文之外，無法搭乘 [`dsh-subprocess`](../../subprocess/README.md) 服務——即該 seam 所記錄的 SDK 託管傳輸例外。冪等，已關閉的用戶端拒絕複用。

`HarnessClientOptions.env` 給定時整體替換子行程環境（`undefined` 原樣繼承父行程環境）；憑據策略歸呼叫方——`dsh-subprocess` 的 `scrubbedParentEnv` 是面向隔離啟動的共享擦除基底。

## 模型體驗

無，因為這是一個用戶端行程庫；模型執行在 spawn 出的執行時期中，其體驗由該執行時期的 `cordis.yml` 所組合的外掛程式決定。

#### KV Cache 影響

無；本包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **無捆綁執行時期解析**——呼叫方顯式指定執行時期可執行文件；打包可執行文件的發現留在 Python 側，直到出現 TypeScript 發行版消費端。
- **無輪次中取消**——協定層沒有提示詞取消方法；放棄輪次意味著關閉執行時期（見協定的 [已知限制](../protocol/README.md)）。
- **沒有逐提示詞結果或取消**——低層 `prompt()` 只返回入隊回執；高層 `run()` 負責從回執收集到 idle，放棄該程序意味著關閉執行時期。
- **用戶端→伺服器端通知與伺服器端→用戶端請求**在協定兩端都未實作；傳輸層為未來審批流保留了承載能力。
