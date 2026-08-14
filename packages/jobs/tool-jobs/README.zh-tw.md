# @deepseek-ai/dsh-tool-jobs

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

`ctx.jobs` 的面向模型控制器：三個與 kind 無關的工具、完成通知和一個後臺工作提示詞區段。載入該外掛程式會附加 `ctx.jobs.start()` 所要求的控制器。

## 工具

- `job_output(job_id, wait?, timeout_ms?)` 默認以非阻塞方式讀取。流任務只返回下一個增量；最終輸出任務在終止後返回結果。每個回應都以 `[status: ...]` 結尾。`wait: true` 最多等待到設定上限，逾時時仍讓執行中的任務保持存活。
- `job_list()` 以 `<id> [<kind>] <status> — <label>` 返回呼用方可見的任務。
- `job_kill(job_id, reason?)` 立即請求取消並轉發已記錄的原因。終止任務返回非消費式快照。

三個工具都使用通用 UI 卡片：output 和 list 使用 `read`，kill 使用 `execute`。

它們的規範值依次為 `{ text, job }`、`PublicJobSnapshot[]` 和 `{ outcome: 'cancellation-requested' | 'already-finished', job }`。公共快照攜帶 id、kind、label、status/detail 及開始／結束時間；它有意省略 `ownerSession` 和內部 `reported` 通知位。原生 renderer 保留上述狀態與確認文字。

當生產方提供 `outputLimitBytes` 時，`job_output`、針對已終止任務的 `job_kill` 和完成通知會在新增狀態或通知文字後，對完整的原生 UTF-8 結果施加上限。只要能夠容納，讀取就會保留輸出尾部與控制後綴；有界完成通知則先為 `background job <id>` 和 `job_output` 收集指令預留空間，再把剩餘位元組用於可變的 kind、label、status、detail 與截斷標記。一個前置 pre-execute 監聽器會在策略執行前捕獲呼叫方可見任務；每個任務控制定義的 final-content 回呼會把其生產方上限應用到單文字拒絕、短路、規範化工具或管線失敗、替換和阻止；結構化多塊策略結果保持自身形狀。已有的生產方截斷標記會複用，不會重複新增。省略該欄位的生產方保留現有的無界控制器行為。

## 完成通知

一項尚未報告的完成會把 `background job <id> (<kind>: <label>) finished [status: ...]. Read its output with job_output.` 交付給確切所有者。應用上限時，即使採用 PTY 支持的 64 位元組下限，穩定 id 前綴和收集命令的優先級也高於可變 label/detail，因此通知仍可操作。kill 或針對已終止任務的 read/wait 會把交付標為已報告並抑制重複通知；排空 owner 或服務的 teardown 取消同樣如此。

由哪條通道承載取決於所有者當時在做什麼。繁忙的所有者走注入：通知進入 next-step inbox，而該 inbox 尚有內容時 turn 無法結束，因此同時結帳的多個任務只花掉一步，而不是各佔一輪。空閒的所有者則被 follow-up 喚醒，因為無人領取的待發通知等於模型永遠不會知道的完成。`completionDelivery: quiet` 讓空閒所有者也留在注入通道上，確定性 transcript 需要的正是這一點。

喚醒是有界的。每個所有者最多可透過喚醒開啟 `maxConsecutiveWakes` 輪，此後的通知降級為注入；領取任何使用者撰寫的訊息都會復原該預算。設界是因為這條鏈會自激：被喚醒的一輪可能啟動某個背景工作，而它的完成又會喚醒同一個所有者。本外掛程式自己排隊的通知永遠不會補充它剛花掉的預算。

一個宿主登錄檔可能承載本外掛程式的多份掛載——每個 agent preset 一份。登錄檔會把每次結帳路由給所有者 scope 鏈所能抵達的監聽器，因此某個 preset 下的掛載永遠看不到另一個 preset 的 agent，無論掛載了多少 preset，一個 agent 每次完成都只讀到一條通知。同一套路由也決定本掛載的控制器服務哪些 agent：組閤中未載入 `tool-jobs` 的 agent 根本無法啟動後臺工作。

## 設定

| key | 預設值 | 含義 |
|---|---|---|
| `waitTimeoutMs` | `30000` | `wait: true` 省略 `timeout_ms` 時使用的等待時間 |
| `maxWaitTimeoutMs` | `600000` | 模型所給等待時間的上限 |
| `completionDelivery` | `wakeup` | `wakeup` 為空閒所有者開啟一輪；`quiet` 讓通知繼續待領 |
| `maxConsecutiveWakes` | `3` | 一個所有者可由喚醒開啟的輪數，超出後通知降級為注入 |

預設值高於上限時，外掛程式會在載入時失敗。

## 模型體驗

### 系統提示詞

#### 模型看到的內容

該外掛程式註冊 scope 中的每次請求都包含以下指引。按 agent（代理）scope 過濾工具時，可能會隱藏工具，卻不會移除獨立註冊的提示詞區段。

##### 背景工作指引

```markdown
Track every background job id you start. You are notified in-session when a job finishes — do not busy-poll or sleep on one; keep working on independent steps and do not duplicate a running job's work. Before giving a final answer, collect every still-relevant job with job_output (set wait: true only when you are genuinely blocked on it), and job_kill jobs that stopped mattering.
```

#### Token 影響

激活期間，每次請求都會產生少量固定的輸入 token 開銷。

#### KV Cache 影響

只要外掛程式 scope 與指引文字不變，前綴就保持穩定。啟用或釋放可能使從該提示詞區段起的複用失效。

### 工具 schema

#### 模型看到的內容

該工具集可見時，會看到生成的 [`job_output`、`job_list` 和 `job_kill` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-jobs)。

#### Token 影響

工具可見時，每次請求都會產生固定的 schema token 開銷。

#### KV Cache 影響

只要工具定義與可見性不變，前綴就保持穩定。註冊生命週期或 scope 限制可能使從第一個發生變化的 schema token 起的複用失效。

### 結果與通知

#### 模型看到的內容

讀取會返回輸出或 `(no new output)`，隨後是 `[status: <status>]` 和選填 detail。空清單返回 `(no background jobs)`。kill 返回 `requested cancellation of job <id>` 或現有終止狀態。尚未報告且有 owner 的任務完成時使用上述通知。

#### Token 影響

結果與通知在壓縮（compaction）前保留於父級歷史。流讀取不會重複已消費的輸出；生產方提供的 `outputLimitBytes` 會限制每次完整讀取或通知。在 `wakeup` 下，抵達空閒所有者的通知還會額外買下一次使用者並未要求的模型請求，其數量按所有者由 `maxConsecutiveWakes` 封頂；抵達繁忙所有者的通知則只是給它已經在付款的那一輪加一步。

#### KV Cache 影響

僅附加；新可見內容位於可複用請求前綴之後，不會使現有 KV-cache 條目失效。

## 已知限制與暫緩事項

- **落在 driver 退休視窗內的結帳仍會讓通知擱淺**：在輪次迴圈最後一次檢查 inbox 與 driver 提交 idle 相位之間，所有者讀起來仍是繁忙，因此通知走注入且無人喚醒。steer 有同樣的洞；堵上它屬於 `agent-loop`。
- **已花掉的喚醒預算不會隨時間復原**：只有使用者撰寫的輸入才能補充，因此預算耗盡的無人值守 agent 要等到其他原因開啟下一輪時才收走剩餘通知。
- **待領於空閒所有者的通知無法在該所有者釋放後存活**：釋放時的取消會清空未領取的 inbox，日誌保留插入/取消這一對作為記錄。
- **流讀取只有單一消費端**：獨立觀察者需要另一套執行時期 API。
- **無 owner 的任務沒有工作階段隔離**：外部呼叫方必須提供策略或避開這些任務。
