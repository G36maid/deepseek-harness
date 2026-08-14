# @deepseek-ai/dsh-session-telemetry

[English](README.md) | 繁體中文

遙測（telemetry）Service Definition 聲明 `SessionTelemetrySink` 後端約定，捕獲協調器把工作階段記錄傳給實作該約定的任意上報 SDK 後端。捕獲側可跟隨即時工作階段事件，也可按需重播權威工作階段日誌前綴。本包呼叫 `emit()` 後就停止處理：批次處理、重試、排隊與丟失策略都屬於後端自身的 SDK，本包既不規定也不包裝。設計依據與被否決的替代方案見[復活 Agent Note](../../../.agents/notes/implemented/feature/2026-07-23-session-telemetry-otel-revival.md)、[回饋門控投遞](../../../.agents/notes/implemented/feature/2026-08-05-feedback-gated-session-telemetry.md)與[無緩衝回饋重播](../../../.agents/notes/implemented/simplification/2026-08-06-buffer-free-feedback-telemetry.md)。

## 後端約定

`SessionTelemetrySink` 有三個成員：`emit(record)` 必須入隊且不能阻塞，因為它會在 `session/event` 或顯式權威日誌重播期間同步執行；選填的 `flush()` 是輪次結束後的提示，呼叫方不等待結果，多數後端省略它並使用 SDK 的常規批次處理計畫；`shutdown()` 排空已入隊記錄，並在 SDK 停止後結束，dispose（資源釋放）會等待它。提供 `flush()` 的實作必須安排並行 flush 與 `shutdown()` 最終排空的先後順序。`SessionTelemetryBackend` 將此 API 註冊在 `sessionTelemetry` 上下文鍵下：每個上下文只允許一個實作，重複載入會拋出例外。後端以 `live` 或 `on-demand` 捕獲構造 `SessionTelemetryCoordinator`，並在自己選擇的觸發器中呼叫 `captureSession(session, throughSeq?)`。

該服務還攜帶必需的 [`SessionTelemetrySharingStatus`](#the-sharing-disclosure) `sharing` 成員：每個後端都必須向面向使用者的確認 surface（`/feedback` 命令的確認文字）披露的部署級共享策略。消費端只有在未掛載任何遙測服務時才渲染「未設定」。seam 擁有該詞彙（`full` | `feedback-only` | `disabled`），因此任何後端都可以披露策略，而無需相依性 OTel 包。

<a id="the-sharing-disclosure"></a>

## 共享披露

一條已記錄的回饋條目的確認文字會報告該工作階段是否以及如何被共享，讀取自已掛載後端的 `sharing`。後端根據其部署設定設定該屬性：`full`（每個事件在發生時立即交接）、`feedback-only`（在 `feedback/record` 事件釋放其之前的未釋放前綴之前，不交接任何內容）或 `disabled`（完全不交接任何內容）。消費端把狀態對映為面向使用者的文案；披露從不聲稱投遞——交接是非阻塞入隊，批次處理、重試與丟失策略仍歸後端 SDK。

## 捕獲點

在 `live` 模式中，協調器的全部註冊都經由組合方 fiber 的 effect 完成：`session/created`（收養：記錄 header，並經投影從構造邊界起回讀日誌；來自 fork 或復原的構造函式種子絕不會在 firehose 上再次寄出，也絕不會再次匯出）、`session/event`（投影、深拷貝、脫敏，再交接；零 I/O）、`session/flush`（轉發選填的 `flush()` 提示並返回 void；迴圈所等待的平行任務絕不能等待遙測）、`session/disposed`（在工作階段自身的終止邊緣捕獲該工作階段的 `shutdown` 運維記錄，然後將其退役）、`agent/error`（唯一的即時總線轉發；工作階段事件詞彙有意不包含運維錯誤記錄）、一個 dispose effect（捕獲每個仍存活工作階段的 shutdown，再等待後端的 `shutdown()`；失敗只發出警告而不拋出），以及對 `ctx.sessions.list()` 的收養掃描（熱重新載入不會重放 `session/created`）。在 `on-demand` 模式中，協調器只註冊 dispose effect：`captureSession()` 讀取權威日誌，直至選填的序列號邊界（含邊界）；flush 提示與運維事件留在本機。

## 脫敏 waterfall（瀑布式事件）

每條記錄在投影后立即經過 `sessionTelemetry/record` waterfall，這是 Service Definition 的脫敏擴充點。本包自身不帶任何規則：最內層的 `next()` 原樣透傳記錄，因此未掛載監聽器時，記錄以捕獲時的原樣到達後端；匯出資料能幹淨到什麼程度，恰恰取決於部署方掛載了什麼規則。監聽器透過變換 `next()` 的回傳值來堆疊；不呼叫 `next()` 就返回，即替換其下方的全部邏輯；拋出例外的監聽器會在協調器的隔離範圍內以 fail-closed 方式攔下這一條記錄。即時捕獲在追加時執行 waterfall；按需捕獲則在重播權威日誌時使用當時掛載的規則執行 waterfall。脫敏只作用於外發副本；權威工作階段日誌永不改寫。

## handoff 遊標

一個模組作用域的 `WeakMap<Session, seq>` 記錄每個工作階段已交接（而非已投遞）的最高 seq。即時捕獲在追加時推進遊標；按需捕獲只有在 `captureSession()` 將請求的前綴交給後端時才推進遊標。未捕獲的前綴只留在權威日誌中，因此協調器重載不會增加遙測自有的復原狀態。重播時，協調器只重新交接遊標之後的事件（遊標及其之前的事件仍用於重建區塊投影狀態）；遊標缺失時安全退化為從工作階段構造邊界起的重新交接（`Session.firstLiveSeq`，對在本行程中誕生的工作階段即 seq 0），由接收端基於 `(session.id, event.seq)` 的去重吸收。構造函式種子絕不會再次匯出：復原工作階段的歷史已由上一個行程以同一 id 寄出，fork 繼承的前綴則位於父工作階段的流中（接收端基於 `session.parent_id` + `session.seed_length` 拼接）。由此接受的代價與至多一次（at-most-once）投遞一致：復原不會回填上一個行程未能投遞的記錄；有回填要求的部署需要的是已推遲的 outbox，而不是重播。這是對「註冊即 effect」紀律的一次有意且範圍極窄的例外：條目隨其工作階段消亡，值是單調水位線，丟失它絕不是錯誤。

## 固定區塊投影

每個 `(turn, step)` 只發出第一條 `assistant/chunk`；其餘區塊在捕獲時丟棄，且絕不推進遊標。這一條區塊就是「流已開始」的訊號：`step/start`、首區塊是否存在、`assistant/message` 是否存在，加上 `turn/end` 的原因，無需區塊流量即可區分「請求從未開始」與「流中途夭折」，首個 token 延遲（time-to-first-token）也仍然可以計算。區塊省略使匯出流中的 `seq` 缺口成為常態：缺口絕不是丟失訊號。其餘所有事件類型都會完整透傳，包括本包從未聽說過的外掛程式所合併的事件類型。

## 邏輯記錄

`SessionTelemetryRecord` 包含：`channel`（`ledger` | `ops`）、`time`（epoch 毫秒）、`severity`（預先對映好的嚴重等級：`tool/result.isError`、`turn/end` 的錯誤原因與 `agent-error` 對映為 ERROR，其他已捕獲記錄對映為 INFO，而 `sessionTelemetry/record` 策略可以指定 WARN）、只含身份資訊的 `attributes`（`session.id`、`event.type`、`event.seq`，header 中存在時再加 `session.cwd`/`session.parent_id`/`session.seed_length`），以及作為 `body` 的完整深拷貝 `event.data`，且以脫敏後的內容為準。運維記錄攜帶 `sessionTelemetry.op`（`agent-error` | `shutdown`）和 `session.id`，並刻意不帶 `event.seq`/`event.type`：它們是用來告警的訊號，不是用來累加的條目；`agent-error` 會把任意拋出值規範化為穩定的 `{ name, message }` 記錄主體。交接之後的投遞由後端 SDK 負責；重複仍然可能出現（無遊標的重新收養、SDK 重試），因此接收端基於 `(session.id, event.seq)` 去重。

## 模型體驗

無。本包只觀察工作階段流，並把脫敏後的副本交給上報後端；它絕不向模型請求貢獻任何內容。

#### KV Cache 影響

無；本包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **盡力而為的投遞**：遊標標記的是已交接而非已投遞；在重載視窗內被拆除的工作階段無法重新收養；崩潰時留在後端佇列中的內容會丟失。持久化 outbox（spool、每 sink 遊標、at-least-once）推遲到有部署方提出明確的崩潰丟失要求時再實作；見[復活 Agent Note](../../../.agents/notes/implemented/feature/2026-07-23-session-telemetry-otel-revival.md)。
- **不內建脫敏規則**：未掛載 `sessionTelemetry/record` 監聽器時，記錄以捕獲時的原樣離開行程，包括文件內容或命令輸出中內嵌的任何憑據；向共享 collector 匯出的部署方自行負責其規則集。
- **按需脫敏使用當前狀態**：未捕獲的事件只存在於權威工作階段日誌中。後續的 `captureSession()` 會使用當時掛載的策略，深拷貝並脫敏其當前值；不存在捕獲時的遙測快照或持久化的捕獲前 spool。
