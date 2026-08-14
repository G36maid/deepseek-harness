# dsh-timeout

[English](README.md) | 繁體中文

逾時的**時序與分類**部分：一個零相依性純函式庫（無執行時期 harness 相依性），由每個需要限制呼叫方逾時提示、啟動 deadline，並在之後區分「已逾時」與「已取消」的能力共享。

它**不負責終止**。它寄出的訊號只會*通知*；真正停止工作仍由各能力負責，因為機制各不相同：bash 對作業系統行程組傳送 SIGKILL，web 關閉 `fetch` Socket，沒有任何共享層能夠承擔全部終止機制。[Agent Note](../../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md) 將邊界劃定為：共享時序/分類，將強制終止保留在本機。

它是**庫，而非服務或外掛程式**：沒有 `ctx`，不註冊任何內容，不持有狀態，也不寄出事件。「逾時服務」必須瞭解如何停止每項能力的工作，這正是微核心要排除在共享層之外的知識。

## 對外介面

```ts
import { clampTimeout, deadline, idleWatchdog, MAX_TIMER_DELAY_MS, timeoutOf, TimeoutReason } from '@deepseek-ai/dsh-timeout'
```

| 匯出項 | 職責 |
|---|---|
| `clampTimeout(requested, def, max, name?)` | 驗證呼叫方選填的、值為正且有限的提示，從 `def` 填充，並限制在 `max` 以內。如果提示為非正數或非有限數，則拋出錯誤（包含 `name`）。 |
| `deadline(upstream, timeoutMs, code)` | 將 `upstream` 取消與逾時融合為一個 `AbortSignal`（`AbortSignal.any`）；逾時攜帶 `TimeoutReason`。`[Symbol.dispose]` 清除 timer。 |
| `idleWatchdog(upstream, timeoutMs, code)` | 保持一個穩定的融合訊號，並且只在受保護的非同步迭代器 `next()` 尚未完成時啟動 timer。完成後停止 timer；後續需求或 `pulse()` 活動會重新啟動 timer；dispose（資源釋放）時清除；並行需求被拒絕。 |
| `MAX_TIMER_DELAY_MS` | Node 在不將延遲限制為 1 毫秒時可調度的最大延遲（`2_147_483_647`）。負責 timer 的設定不得超過該值。 |
| `timeoutOf(signal \| { reason }, code?)` | 從已中止的訊號/錯誤中復原 `TimeoutReason`，否則返回 `undefined`，即逾時與取消的分類器。傳入 `code` 可僅匹配這個 deadline 的 timer（見下文的巢狀）。 |
| `TimeoutReason` | 標記在逾時中止上的內部原因（`code` + `timeoutMs`）。它不是公開錯誤；提供方將其轉換為自己的錯誤/欄位。 |

## `timeoutMs <= 0` 哨兵值

`0` 是後端自有後臺工作（bash `start()`）使用的**內部**「無逾時」值。`deadline()` 不啟動 timer，只轉發 `upstream`；如果也沒有 upstream，它將返回永不中止的訊號和無操作 disposer，因此每個呼叫方都能保持同一種呼叫形態。外部請求提示會透過 `clampTimeout` 驗證為**正有限數**，之後才進入 `deadline`，因此 `0` 絕不是面向模型/外掛程式的「停用逾時」值。

## 使用形態

```ts
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'

declare function runWork(options: { signal: AbortSignal }): Promise<unknown>

// Scope-lifetime consumer (foreground bash, one fetch): `using` disposes the timer.
export async function runWithDeadline(upstream: AbortSignal | undefined, timeoutMs: number): Promise<unknown> {
  using d = deadline(upstream, timeoutMs, 'BASH_TIMEOUT')
  const outcome = await runWork({ signal: d.signal })               // work listens on d.signal and terminates itself
  const timedOut = timeoutOf(d.signal, 'BASH_TIMEOUT') !== undefined // classify the first abort, scoped to OUR code
  const aborted = d.signal.aborted && !timedOut                     // mutually exclusive: timeout won, or cancel did
  return { outcome, timedOut, aborted }
}
```

該訊號只會*通知*；呼叫方必須接入自己的終止機制（`d.signal.addEventListener('abort', kill)`，或將 `d.signal` 傳給 `fetch`）。讓 promise 與 timer 競速，會在子行程或Socket仍在洩漏時就讓工具呼叫完成；寄出訊號則會強制要求存在真正的終止路徑。

將你自己的 `code` 傳給 `timeoutOf`，使分類可在巢狀場景中正確組合。當 `upstream` 本身是 deadline 訊號時，如果該 timer 先觸發，`AbortSignal.any` 會保留它的 `TimeoutReason`。將匹配範圍限定為你的 code，會把外部逾時視為普通的 upstream 取消，而不會聲稱本機 timer 已到期。

對於流式傳輸，建立一個 `idleWatchdog`，將其穩定的 `signal` 傳給傳輸層，並為提供方的每次讀取呼叫 `watchdog.next(iterator)`。當傳輸活動不產生迭代器值時，呼叫 `watchdog.pulse()`。間隔必須為正有限數，且不得超過 `MAX_TIMER_DELAY_MS`；否則 Node 會將其限制為 1 毫秒。它只對尚未完成的讀取請求計時，因此當下游程式碼進行渲染或在請求下一個區塊前以其他方式等待時，timer 不會執行。該原語仍然只會通知，因此傳輸層必須觀察穩定訊號；DeepSeek 和 pi-ai 配接器證明，逾時會關閉它們的真實回應正文或 SDK 請求。

## 哪些操作不設定逾時

本機文件 `read`/`write`/`edit` 不接受 `timeoutMs`：文件 IO 不設時限地執行，因為截止時間會中止作業系統仍會完成的工作。詳見[檔案系統子系統頁面](../../../docs/subsystems/filesystem.md)。

## 模型體驗

透過 `dsh-tool-call-timeout-policy` 等消費端間接影響模型；消費端可能會將提供方結果替換為已保留的逾時錯誤，或抑制延遲結果。

#### KV Cache 影響

不會直接導致 KV Cache 失效；請求前綴變更由上述消費端負責。

## 已知限制與暫緩事項

- **只發出通知**：deadline 無法停止忽略其訊號的工作；每項能力仍需要自己的 socket/行程/任務終止路徑。
- **`timeoutMs <= 0` 是內部詞彙**：只有在所屬後端已解析策略後，它才會停用本機 timer；絕不會作為面向模型/外掛程式的公開開關。
- **第一個中止原因決定分類**：當 upstream 取消早於本機 timer 發生時，即使自己的逾時之後也會到期，該層也無法再報告。
- **空閒 watchdog 不是總 deadline**：它針對每個尚未完成的迭代器需求重新啟動，並刻意排除消費端的處理時間。
