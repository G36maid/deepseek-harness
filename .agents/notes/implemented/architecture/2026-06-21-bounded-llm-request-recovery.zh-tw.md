# Agent Note: LLM 暫時性請求失敗的有界復原

Status: implemented

[English](2026-06-21-bounded-llm-request-recovery.md) | [简体中文](2026-06-21-bounded-llm-request-recovery.zh.md) | 繁體中文

[按提供方設定的請求重試策略](../feature/2026-07-24-provider-retry-policies.md)在此基礎上增加了確切提供方設定與顯式無界 mode。本說明繼續負責結構化失敗事實、已關閉步驟的復原邊界、normal mode 的暫時性預設值、可見的單次嘗試和持久重試狀態。[LLM（大型語言模型）流的終止失敗](2026-07-29-terminal-llm-stream-failures.md)取代了其中關於拋出錯誤身份和流 sidecar 的機制。

## 問題

提供方配接器可能在分發或迭代時拋出例外，也可能以 `finish { kind: 'error' | 'aborted' }` 結束。最終配接器邊界會在 `dsh-agent-loop` 接收前把拋出值規範化為該終止 finish 協議；middleware 與結果處理缺陷仍會拋出。loop 會將終止模型請求失敗交給 `agent/request-error`。未被處理的失敗是終態；處理失敗的監聽器修復策略自有狀態，返回 `{ kind: 'retry' }`，並停止 waterfall（瀑布式事件）委託。[重試動作決策](../simplification/2026-07-27-request-error-retry-action.md)規定這一返回約定。

該邊界已能安全地再次發起請求。原始 `assistant/chunk` 事件攜帶失敗的 `turn` 和 `step`；除非某條成功的 `assistant/message` 引用這些事件，否則訊息派生會忽略它們。只有終止性 finish 成功且組裝完成後，系統才會分發工具呼叫；重試則會從持久日誌開啟新的編號輪次。因此，harness 無需引入第二套回應生命週期或暫定輸出協議，即可分隔兩次嘗試。

此前的邊界還留有三個較窄的缺口。

- 提供方失敗只保留訊息，通常還會保留一個 code。HTTP 狀態、重試延遲和提供方請求 id 會被丟棄，或者只能透過提供方專用錯誤對象復原，因此通用復原機制如果不解析文字，便無法作出決策或解釋決策。
- 重試的歸屬因配接器而異。手寫 DeepSeek 配接器只嘗試一次，pi-ai profile 則可以啟用庫內部的不透明重試。如果把隱藏的傳輸重試與 `agent/request-error` 監聽器結合，嘗試次數會成倍增加，中間失敗也不會記入工作階段日誌。
- 復原後的失敗沒有持久狀態事實。失敗的步驟和區塊仍可重建，但觀察者無法得知 agent（代理）是否在有意退避、將等待多久，以及等待原因。長時間的靜默等待看起來與迴圈停滯無異。

默認策略的目標是從同一個顯式提供方／模型請求的暫時性失敗中進行有界復原。提供方或模型故障轉移、回應拼接和語義輸出修復都屬於其他問題，目前沒有消費端。

## 決策

### 保留失敗事實，不嵌入策略

`@deepseek-ai/dsh-llm` 匯出唯一的可 JSON 序列化 `LlmFailure` 載荷：

```ts ignore-check
type ProviderRequestId = Branded<'ProviderRequestId'>

interface LlmFailure {
  message: string
  code: string
  status?: number
  providerRetryAfterMs?: number
  requestId?: ProviderRequestId
}
```

`code` 仍是 `HarnessError` 建立的提供方無關機器路由分類體系；新欄位是在提供方邊界觀測到的事實。`ProviderRequestId` 由 `dsh-llm` 擁有並構造，序列化後為提供方發放的字串。該載荷有意不包含 `retryable`、`failover`、`partialOutput`、提供方、模型、階段或路由 id 欄位。是否可重試屬於策略，提供方／模型已位於持久請求標頭中，部分輸出則從失敗步驟的 `assistant/chunk` 事件派生。

`LlmError` 攜帶 `failure: LlmFailure`，並保持 `failure.code === error.code`。`FinishReasonMap.error` 和 `FinishReasonMap.aborted` 攜帶同一載荷，而不是平行的失敗形狀。最終配接器邊界會從配接器拋出值中分離這些事實，並行出相應的終止 finish；未知 SDK 例外會獲得 `UNKNOWN` 載荷。精確的拋出對象身份不會跨越 LLM 流 seam。

agent loop（代理循環）會將終止 finish 的 `LlmFailure` 傳給 `agent/request-error`，並在記錄未復原的 `turn/end.reason` 時使用同一載荷。

配接器會先提取結構化事實，再回退到訊息檢查。它們會驗證 HTTP 狀態，將 `Retry-After` 的秒數或日期解析為正的有限毫秒延遲，在提供方公開請求 id 時將其品牌化，並區分自身逾時與呼叫方中止。提供方專用 code 和訊息可以細化對映，但復原監聽器不會解析它們。

共享的暫時性 code 集有意保持很小：配接器針對 `RATE_LIMIT` 和 `SERVER` 的對映，遠端失敗使用的顯式 `TIMEOUT` 和 `TRANSPORT` code，以及提供方回應已完成卻沒有內容區塊時使用的 `EMPTY_RESPONSE`。兩個配接器都會把最後一種情況歸類為錯誤 finish；詳見[空模型回應可重試](../bug-fix/2026-07-24-empty-model-response-is-retryable.md)。身分驗證、配額、無效請求、上下文溢位、協議、中止和未知失敗都保留不同的穩定 code，且默認不屬於暫時性失敗。新增 code 需要配接器 fixture（測試前置資料）和已記錄的策略決策；無需擴充第二個失敗類枚舉。

### 將重試策略放在現有失敗步驟擴充點上

`@deepseek-ai/dsh-llm-retry` 是監聽 `agent/request-error` 的函式外掛程式。它不引入服務或新的迴圈分支；agent-loop 包僅會更改透過現有失敗步驟復原控制流攜帶的資料。

`agent/request-error` waterfall 攜帶當前 `LlmFailure`、在連續復原序列中授權重試輪次的不可變先前失敗清單，以及提供服務的註冊項所攜帶的不可變重試策略。迴圈只傳遞而不解釋該策略；它擁有連續失敗歷史，並在模型請求成功後清除。`dsh-llm-retry` 的 normal 策略統計由同一項確切提供方策略安排的持久重試記錄，`dsh-compaction-basic` 則維護自己的上下文溢位預算。因此，暫時性失敗與上下文溢位交替出現時，會各自獨立消耗其有限預算；最大請求數等於 1 加上所有已載入有限預算之和。

當前設定形狀由[提供方策略決策](../feature/2026-07-24-provider-retry-policies.md)規定。提供方配接器會註冊巢狀的 `retryPolicy`；省略時使用 normal 預設值：兩次暫時性重試、500 毫秒初始延遲、10 秒延遲上限、10% 抖動，以及上述五個暫時性 code。計數與延遲邊界參考了所調查實作中較保守的一端：[OpenCode 使用兩次請求重試，延遲邊界為 500 毫秒／10 秒](https://github.com/anomalyco/opencode/blob/9976269ab1accfc9f9dc98a4a688c516934de422/%70ackages/llm/src/route/executor.ts#L36-L39)；[Pi 將三次 agent 級重試與提供方重試分開，且提供方重試預設為零](https://github.com/earendil-works/pi/blob/3da591ab74ab9ab407e72ed882600b2c851fae21/%70ackages/coding-agent/docs/settings.md#L139-L147)；[Codex 使用有限請求／流預算以及五分鐘空閒逾時](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/model-provider-info/src/lib.rs#L25-L33)。10% 抖動參考 [Codex 的有界抖動](https://github.com/openai/codex/blob/0fb559f0f6e231a88ac02ea002d3ecd248e2b515/codex-rs/codex-client/src/retry.rs#L40-L47)。

對於預算未耗盡的合格失敗，從 1 開始的暫時性重試計數使用有界指數退避。有效的 `providerRetryAfterMs` 只有在不超過 `maxDelayMs` 時才會取代指數退避；提供方延遲更長時，系統會委託給下一監聽器，而不會違反提供方指令提前重試。本機退避乘以 `[1 - jitterRatio, 1 + jitterRatio]` 內的注入隨機因子，並將最終值限制到 `maxDelayMs`；提供方延遲不加抖動。

外掛程式擁有一個覆蓋其整個生命週期的 `AbortController`，並跟蹤每個活躍的復原回呼，包括委託的 waterfall 工作與退避。effect 的 dispose（資源釋放）會先註銷監聽器，再中止並等待活躍回呼；中止會勝過較晚到達的委託重試決策，被捕獲的回呼在外掛程式 dispose 後既不能重試，也不能進入其 waterfall 的剩餘部分。儘管 Cordis 已捕獲該監聽器，此設計仍能使 HMR（熱模組替換）的 dispose 達到完全靜止。

休眠前，`dsh-llm-retry` 會追加一條不進入表層的 `llm/retry` 工作階段事件，其中包含輪次、失敗步驟、提供方、策略 mode、完整的解析後策略 key、提供方策略重試編號、特定於 mode 的有限上限（如有）、計畫延遲和 `LlmFailure`。該 key 會對 code 集排序，並在提供方路由被行為不同但 mode 相同的策略替換時分隔重試歷史。該外掛程式擁有 `SessionEventMap` 聲明合併，並透過其瀏覽器安全的 `./types` 子路徑匯出載荷；`dsh-session` 繼續負責通用持久化，不會吸收選填策略的詞彙。事件記錄已安排的內容，而不是下一個請求已完成；延遲期間取消隨後會在 `turn/end` 中可見。因為該事件的目的是表示執行狀態，而不是收集跟蹤資料，所以它會與生產渲染器及重播／快照覆蓋一起交付。

對非暫時性 code、耗盡的策略預算或超出上限的提供方延遲，監聽器會呼叫 `next()`。這保留了與上下文溢位復原及後續策略外掛程式的組合能力。對自身處理的失敗，它會記錄並等待延遲，然後在不委託的情況下返回 `{ kind: 'retry' }`。輪次取消和外掛程式 dispose 會結束等待且不返回重試動作，此後仍以迴圈的取消／dispose 檢查為準。

agent-spine 演示組合包載入該外掛程式，因此共享的 stdio/TUI、一次性 CLI（命令列介面）、ACP（Agent Client Protocol）和 headless 示例組合使用同一套按提供方路由的策略。隨產品交付的 Web 組合也會載入該外掛程式，因此瀏覽器請求與命令列請求使用相同的提供方預設值。庫消費端仍需顯式組合外掛程式：省略該外掛程式時，請求失敗保持終態。

### 由單一層負責可見的嘗試

配接器每次呼叫 `stream()` 只執行一次提供方請求。pi-ai 配接器移除公開的 `maxRetries` 和 `maxRetryDelayMs` profile 欄位，並停用庫內部重試；手寫配接器保持現有的單次嘗試行為。這樣既避免 SDK 預算成倍放大 agent 預算，又能確保每次暫時性重試都由一個已關閉的失敗步驟加 `llm/retry` 表示。

`ctx.llm.stream()` 仍是原始的單次嘗試 waterfall。壓縮（compaction）摘要等直接呼叫方會收到結構化失敗，但不會自動獲得重試，因為它們沒有 agent 步驟邊界，也沒有可供分隔嘗試的通用持久位置。未來的直接呼叫消費端可能會需要一個緩衝輔助函式，僅在尚未寄出任何區塊時重試；本決策不增加此類輔助函式。

### 在能夠終止停滯流的位置施加邊界

每個配接器都公開一個經過驗證的 `streamIdleTimeoutMs` 設定欄位，預設值採用上文引用的五分鐘先例。該間隔不超過 Node 的最大定時器延遲，因此不會被鉗制為 1 毫秒。它覆蓋每個尚未完成的迭代器 `next()`：從消費端請求下一項開始，到配接器識別到提供方活動為止；消費端在兩次 `next()` 呼叫之間花費的時間不屬於提供方空閒時間。DeepSeek SSE（Server-Sent Events）註釋計為傳輸活動，但絕不會成為 `StreamChunk` 值或工作階段日誌事件。

`@deepseek-ai/dsh-timeout` 公開一個可重新佈防的空閒看門狗原語。一個穩定的區域性 `AbortController` 會與呼叫方訊號融合，並在整個配接器呼叫期間傳給傳輸層；每個尚未完成的 `next()` 都會佈防看門狗，該呼叫完成時解除佈防，下一次請求資料時再重新佈防。帶外傳輸活動會呼叫 `pulse()`，在不產生值的情況下為尚未完成的需求重新佈防。逾時會使用能力自身擁有的 `TimeoutReason` 中止這個穩定控制器，`finally` 則會清除定時器。配接器將自身看門狗歸類為 `TIMEOUT`，將更早發生的上游中止歸類為 `ABORTED`。現有的一次性 `deadline()` 不會被描述為滑動計時器。

邊界測試證明兩個實際傳輸層都能終止。手寫配接器會中止其 fetch／reader，pi-ai 配接器會把穩定訊號對映到 SDK，並證明 SDK 會關閉回應。如果定時器只拒絕消費端 promise，卻讓請求繼續執行，就不滿足此約定。

### 在現有日誌中分隔嘗試

一次失敗嘗試可以在已關閉的步驟中留下 `assistant/chunk` 事件，但絕不會追加 `assistant/message`，也不會分發工具。重試會關閉失敗輪次，開啟下一個編號輪次，從持久表層重建請求，並生成自己的區塊。步驟仍處於打開狀態時，UI 可以渲染即時區塊；當 `llm/retry` 標識失敗步驟，或 `turn/end` 記錄失敗時，UI 再標記或清除這份暫時檢視表。Web 會驗證完整的重試載荷約定，在 `llm/retry` 到達時清除失敗的部分輸出，將連續重試輪次的事件投影為穩定的一行，並用最新一次嘗試更新該行，再從後續輪次事實派生 scheduled、started 或 cancelled 狀態。倒計時以瀏覽器收到事件的時刻為計畫延遲的起點，而不是使用 Host 事件時鐘；它按向上取整且不低於 1 秒的秒數顯示，僅在重試尚未結束時顯示動畫，並把最近一次失敗的準確詳情摺疊在該行之後。即使失敗嘗試沒有 assistant 節點，重試節點也會錨定自身的軌跡輪次。訊息派生仍會忽略失敗區塊；Web 在重建歷史時也會應用同一投影，因此重新整理頁面不會讓已丟棄的部分輸出重新出現，也不會生成重複的重試行。

如果復原預算耗盡，最終失敗會連同結構化事實在 `turn/end.reason` 中儲存一次。Web 會在該序列位置派生一個 `turn-error` 節點，並內聯渲染適合展示的訊息與選填錯誤碼；AUTH 投影會把可能回顯憑據片段的提供方文案替換為 `API key is invalid`，原始診斷仍保留在工作階段日誌中。即時事件和歷史重播使用同一套摺疊邏輯。如果暫時性復原繼續，`llm/retry` 就是該次嘗試的失敗與延遲的持久歸屬位置，因此該失敗輪次不會再獲得終態錯誤行。本決策不增加獨立的最終錯誤事件或回應 id 詞彙。

## 不在範圍內

- 自動提供方或模型故障轉移。請求已顯式選擇一個提供方和模型，提供方登錄檔也有意規定每個提供方只由一個配接器負責。
- 在成功的終止性 finish 後重試或繼續，或將兩次嘗試的區塊拼接成一條 assistant 訊息。
- 修復格式錯誤的工具參數、拒答、內容過濾或其他語義模型輸出。
- 熔斷器、共享提供方健康狀態或跨 agent 重試預算。
- 在沒有生產消費端的情況下，把 `llm/stream` 改造成回應生命週期或增加便利的生成 API。

## 考慮過的替代方案

- **在 `llm/stream` 或提供方 SDK 內部重試**：拒絕採用，因為原始流一旦寄出區塊便沒有持久嘗試邊界，隱藏的 SDK 重試會成倍放大預算，而且兩條路徑都無法一致地記錄每次失敗嘗試。
- **向 `dsh-llm` 增加回應開始、中斷、丟棄、失敗和提交事件**：拒絕採用，因為 agent 日誌已經分隔原始區塊、成功訊息和編號嘗試。第二套狀態機會重複歸屬關係，又不能支持有界的同路由重試。
- **增加邏輯路由、能力矩陣和故障轉移選擇**：拒絕採用，因為當前請求已經顯式指定提供方和模型，每個提供方由一個配接器負責，而且沒有當前消費端要求自動回退或能夠證明語義相容性。
- **把 `retryable` 或 `failover` 放在 `LlmFailure` 上**：拒絕採用，因為配接器報告事實，部署策略決定動作。同一個 429 可以在互動式組合包中重試，也可以在成本受限的批次處理中被拒絕。
- **只要呼叫方仍處於活躍狀態就無限重試**：[按提供方設定的策略](../feature/2026-07-24-provider-retry-policies.md)對顯式 `always` 設定項推翻了這項拒絕，同時保留有界的 normal mode 作為預設值。
- **只透過行程 logger 記錄重試狀態**：拒絕採用，因為行程日誌無法重建工作階段行為，也不能驅動程式重播後的 UI 狀態。
- **只保留扁平 code**：拒絕採用，因為重試延遲和提供方請求 id 是結構化的提供方事實，而當不同協議失敗共用一個穩定 code 時，診斷還需要 HTTP 狀態。

## 驗證

- `LlmFailure` 是配接器拋出、錯誤 finish 和中止 finish 使用的唯一可序列化載荷；在可用時，規範化保留穩定 code、狀態、重試延遲、品牌化的提供方請求 id，以及呼叫方中止與配接器逾時之間的分類。
- 配接器拋出值會在抵達消費端前成為終止失敗區塊；middleware 與消費端例外仍在模型請求復原之外拋出。
- DeepSeek 和 pi-ai 配接器測試覆蓋具有代表性的 400、401/403、429、5xx、連線、格式錯誤／截斷流、逾時、中止、Retry-After 秒數／日期、請求 id 和未知 SDK 錯誤路徑，復原策略無需解析訊息文字。
- pi-ai 將 SDK 選項固定為零次重試，並針對可重試的提供方回應執行一次可觀測的線路請求嘗試；獨立測試確保移除任一邊界都會失敗。
- `agent/request-error` 攜帶當前失敗事實、不可變的先前已重試失敗事實，以及提供服務的註冊項所攜帶的不可變重試策略；成功會清除歷史，暫時性失敗／上下文溢位交替發生的整合測試證明兩種策略只消耗各自的有限預算。
- 每個提供方配接器都在 Loader 啟動時驗證其巢狀重試策略，`ctx.llm` 則將該策略與路由一同捕獲；normal mode 會委託不合格路徑，而且在沒有其他策略時最多發起 `maxRetries + 1` 次提供方請求。
- 退避期間執行 HMR 的測試證明：dispose 過程會註銷監聽器、中止並等待其捕獲的回呼，dispose 後不寄出重試決策，也不留下存活的定時器或 promise。
- 純單元測試覆蓋暫時性 code 選擇、指數退避和抖動邊界、有效及超出上限的 `Retry-After`、耗盡的預算、確定性定時器／隨機數掛鉤，以及退避期間中止。
- 真實 agent-loop 測試覆蓋區塊前失敗、部分區塊後失敗、拋出及帶內失敗、在新輪次中重試至成功、耗盡後寫入結構化 `turn/end.reason`，以及與 `dsh-compaction-basic` 上下文溢位復原的組合。
- 部分區塊整合測試證明：失敗區塊仍歸屬於失敗步驟，該步驟不會提交 assistant 訊息或工具副作用，成功的重試會記錄自己的區塊 seq 和提供方／模型路由。
- 外掛程式擁有的不進入表層的 `llm/retry` 事件可在 JSONL 和 SQLite 往返後保留，被訊息派生忽略，並驅動 TUI 和 Web 撤回及計畫重試渲染。用戶端測試覆蓋完整的 wire 驗證、獨立於時鐘的倒計時、已取消與已完成重試標籤的區別以及軌跡歸屬；無金鑰 UI 快照覆蓋 Web 的調度與成功，真實 Web 組合測試覆蓋部分傳輸失敗直至復原，ACP 自動化快照確認，被丟棄的嘗試不會透過協議寄出，而復原後的回覆會正常寄出。
- 空閒看門狗測試證明：只有 `next()` 尚未完成時才會重新佈防穩定訊號；在消費端思考期間及 `finally` 中會解除佈防；它與總呼叫 deadline 以及更早發生的呼叫方中止分開分類。配接器測試證明該訊號會終止底層請求，而不只是與其脫離。
- `ctx.llm.stream()` 的直接呼叫方仍只嘗試一次，並收到相同的結構化失敗事實。

## 後果

- 每次重試嘗試都以一個已關閉失敗輪次加 `llm/retry` 的形式可見，配接器級的單次嘗試行為會防止隱藏的 SDK 重試成倍增加策略決策。即使沒有區塊到達，重試仍可能造成提供方重複計費；normal mode 會限制此風險，而顯式 always mode 會接受它，直至取消或成功。
- 提供方 SDK 可能隱藏狀態或重試標頭。配接器會保留 SDK 公開的穩定事實，否則使用粗粒度 code，而不會讓復原策略解析脆弱的文字。
- 持久重試事件擴充了工作階段協議和 UI 狀態機。事件與其消費端一同交付，可避免產生無人使用的遙測詞彙；但以後更改 schema 仍需要同步完成持久化和重播工作。
- 清除失敗步驟的即時區塊可能會明顯撤回輸出。與把丟棄的文字或不完整工具 JSON 呈現為已提交歷史相比，這是更好的選擇；快照固定這一轉換。
- 配接器區域性的空閒強制機制可以終止停滯的傳輸，而不會計入消費端思考時間。每個傳輸邊界的約定測試會防止 SDK 漂移。
- 多個 normal 復原外掛程式會疊加各自的有限預算。always mode 會先委託，再提供無界回退；重疊的分類器仍會形成相依性註冊順序的策略，必須由引入它們的外掛程式記錄並測試。

## 相關資料

- [結構化錯誤分類體系](../../implemented/architecture/2026-06-11-structured-error-taxonomy.md)負責穩定、可供機器路由的 code 與 cause chaining。
- [可重建請求](../../implemented/architecture/2026-07-05-reconstructable-requests.md)使提供方／模型和完整請求輸入在分發前持久化。
- [逾時 deadline 庫](../../implemented/architecture/2026-07-06-timeout-deadline-library.md)將共享的 deadline 分類與能力自身擁有的終止操作分開。
- [呼叫後壓縮壓力與上下文溢位復原](../../implemented/architecture/2026-07-10-after-call-compaction-pressure-and-overflow-recovery.md)負責當前已關閉步驟的請求復原擴充點與有界溢位重試。
- [提供方路由的 LLM 配接器](../../implemented/architecture/2026-07-14-provider-routed-llm-adapters.md)負責顯式提供方／模型路由與每個提供方僅有一個配接器的不變數。
