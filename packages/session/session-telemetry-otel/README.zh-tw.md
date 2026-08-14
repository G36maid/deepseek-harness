# @deepseek-ai/dsh-session-telemetry-otel

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

[遙測（telemetry）seam](../session-telemetry/) 的 OpenTelemetry 後端，也是部署方唯一要載入的條目。其 `mode` 決定 seam 是即時跟隨工作階段事件、僅在記錄回饋時重播權威日誌，還是將遙測留在本機。上傳模式會原樣組合 OTel JS SDK（`LoggerProvider` → `BatchLogRecordProcessor` → OTLP/HTTP 日誌匯出器），把每條已交接記錄對映到 `logger.emit()`，並使用兩個插樁作用域（instrumentation scope）：ledger 記錄掛在 `@deepseek-ai/dsh-session-sessionTelemetry-otel` 下，運維記錄掛在 `@deepseek-ai/dsh-session-sessionTelemetry-otel/ops` 下。資源身份包含 `service.name`/`service.version`（來自 `dsh-llm` 的 `APP_IDENTITY`），以及本包的匿名 `user.id`（`$DSH_HOME/.anonymous-user-id`；首次使用時建立的隨機 UUID，刪除該文件可重設）；這些身份隨每個匯出批次攜帶一次，而非逐條記錄攜帶。

## 設定

```yaml
- id: sessionTelemetry-otel
  name: '@deepseek-ai/dsh-session-sessionTelemetry-otel'
  config:
    mode: FULL                # explicit opt-in; default: DISABLED
    shutdownTimeoutMillis: 3000 # optional; defaults to 3000
    exporter:                # passed verbatim to the SDK's OTLP/HTTP log exporter
      url: https://collector.example.com/v1/logs
      headers:
        authorization: !!js `Bearer ${process.env.OTLP_TOKEN}`
    processor: {}            # optional; passed verbatim to BatchLogRecordProcessor
```

| `mode` | 行為 |
|---|---|
| `FULL` | 每條已投影記錄都立即交給 OTel SDK，包括生命週期運維記錄。 |
| `FEEDBACK_ONLY` | 每個 `feedback/record` 都會重播權威工作階段日誌中截至該事件的後綴，並進行投影與脫敏。後續記錄等待下一個回饋事件；如果沒有後續回饋，則留在本機。 |
| `DISABLED` | 預設值。不構造協調器、提供方、處理器或匯出器。沒有遙測記錄會離開行程。`feedback/record` 會記錄 `session sessionTelemetry is DISABLED; nothing will be shared and this feedback remains local`；該事件留在本機工作階段日誌中。 |

程序化 TypeScript 設定使用匯出的 `SessionTelemetryMode` 枚舉（`SessionTelemetryMode.FULL`、`SessionTelemetryMode.FEEDBACK_ONLY` 或 `SessionTelemetryMode.DISABLED`）；原始字串字面量不可賦值。序列化後的 Cordis 設定繼續使用上表所示的字串值。

上傳授權採用顯式許可，且為 fail-closed。透過直接構造傳入未知模式時，會在學取傳輸設定前失敗。只有 `FULL` 接受對 `ctx.sessionTelemetry.emit()` 的直接呼叫。`FEEDBACK_ONLY` 向其按需協調器提供私有後端能力，並且僅在 `feedback/record` 對象已經儲存於 `session.events[event.seq]` 且對象身份完全相同時，才將其視為同意；獨立寄出的總線值會被忽略。即使存在匯出器選項，`DISABLED` 也絕不會構造 SDK 管線。

已掛載的服務透過 seam 的 [`SessionTelemetrySharingStatus`](../session-telemetry/README.md#the-sharing-disclosure) `sharing` 屬性披露解析後的模式（`full` / `feedback-only` / `disabled`），因此 `/feedback` 的確認文字可以報告工作階段是否以及如何被共享。該披露在構造函式中設定，與採集相互獨立：即使 `DISABLED` 也會披露 `disabled`。

`exporter.url` 在 `FULL` 與 `FEEDBACK_ONLY` 中必填，無預設值，且必須能解析為 `http(s)`；在 `DISABLED` 中可省略且不使用。在上傳模式中，`shutdownTimeoutMillis` 是由 DSH 管理的有限正數外層截止時間，預設值為 3000 ms；`processor.maxExportBatchSize` 不是正整數時也會在外掛程式載入時失敗，因為 SDK 會接受該值，隨後卻在關閉時掛起。兩個 SDK 設定塊都整體透傳（passthrough）：`OTLPExporterNodeConfigBase` 的每個欄位（`headers`、`timeoutMillis`、`compression`、`keepAlive` 等）都會到達匯出器；批次處理、匯出節奏（`scheduledDelayMillis`）、重試、佇列上限，以及持續失敗下的丟失策略，都是透過 `processor` 調節的 SDK 行為。該後端不實作 `flush()`：常規 flush 由批次處理器負責。關閉期間，OTel 會先等待 `exporter.forceFlush()`，再等待受處理器 `exportTimeoutMillis` 限制的完成 promise；如果該傳輸 promise 始終不結帳，本包會在 `shutdownTimeoutMillis` 到期時放棄等待，透過協調器記錄已隔離的關閉失敗，並讓應用繼續拆卸。該截止時間無法取消 SDK 傳輸，因此屆時仍待處理的記錄可能在行程結束時丟失。

## 哪些資料會離開本機

在上傳模式中，記錄攜帶完整的 `event.data`，內容以 seam 的 `sessionTelemetry/record` waterfall（瀑布式事件）返回的結果為準：使用者與 assistant 訊息內容、工具參數與工具結果（命令輸出、文件內容）、完整的系統提示詞與工具 schema（`request/header`）、todo 文字、壓縮（compaction）摘要、掛鉤的 `stderrSummary`、回饋文字，以及工作階段 `cwd`（一個本機路徑）。seam 不帶任何脫敏規則：未掛載 `sessionTelemetry/record` 監聽器時，匯出的就是捕獲原樣的副本，因此向可信邊界之外匯出的部署方要掛載自己的規則（見 [seam README](../session-telemetry/README.md#the-redact-waterfall)）。`FULL` 在追加時執行脫敏；`FEEDBACK_ONLY` 不保留遙測副本，而是在回饋觸發權威日誌重播時執行當時掛載的規則。無論如何，提供方憑據都不會出現：配接器的 API key 是構造函式參數而非工作階段事件，因此它們在結構上就不存在於日誌中，也就不存在於遙測中。`DISABLED` 不會構造 SDK 管線，也不會將任何捕獲內容交給後端。

## 欄位對映

seam 記錄 → SDK 日誌記錄：`time` → `timestamp`/`observedTimestamp`；`severity` → `severityNumber`/`severityText`（INFO 9 / WARN 13 / ERROR 17）；`body` → 結構化日誌 body；`attributes` 原樣照搬。接收端基於 `(session.id, event.seq)` 去重，並按嚴重等級告警。在 `FULL` 中，接收端還可透過缺少 `shutdown` 記錄偵測崩潰：該標記在工作階段自身 dispose（資源釋放）或應用關閉時寄出；標記之後出現更多事件，說明遙測發生了重載。在 `FEEDBACK_ONLY` 中，已釋放的前綴通常不包含隨後的 `shutdown` 標記，因此缺少該標記不是崩潰訊號。跨譜系（lineage）的流並不自足：復原的工作階段在其自身 id 的流上從上一個行程停止之處繼續；fork 出的工作階段的流從繼承邊界開始，其前綴位於父工作階段的流中，由接收端基於 `session.parent_id` + `session.seed_length` 拼接。復原後的本機日誌可能包含從未匯出的合成關閉事件；協定流忠實於實際交給 SDK 的記錄。

## 模型體驗

無。該後端只把 seam 脫敏後的記錄轉發進 OTel SDK 管線；它絕不向模型請求貢獻任何內容。

#### KV Cache 影響

無；本包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **上游實驗性原始碼樹**：`@opentelemetry/sdk-logs` 仍從上游實驗性（experimental）原始碼樹發布；SDK API 的變動只會落在本包，也僅落在本包；seam 約定不動。
- **真實 collector 行為屬於 SDK 匯出器**：身分驗證、TLS、限流及其他真實 OTLP 部署行為遵循上游 SDK，不由本包自有相容層處理。
- **回饋時快照**：`FEEDBACK_ONLY` 在回饋前不保留遙測自有副本。記錄回饋時，它讀取並脫敏當前的權威日誌；回饋前發生崩潰時什麼都不上傳，而回饋前的策略變更會影響該次重播的匯出內容。
