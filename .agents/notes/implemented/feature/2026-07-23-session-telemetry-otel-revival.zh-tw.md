# Agent Note: 設有強制脫敏點和 OTel 後端的工作階段遙測 seam

Status: implemented

[English](2026-07-23-session-telemetry-otel-revival.md) | [简体中文](2026-07-23-session-telemetry-otel-revival.zh.md) | 繁體中文

## 問題

每個想把 harness 工作階段接入可觀測性體系的部署方都得手寫一個工作階段日誌消費端：訂閱、生命週期交接、以及最難的脫敏——原始日誌攜帶文件內容與命令輸出，可能內嵌憑據。遙測 seam 和 OTel 後端曾在 `session-telemetry-otlp-rfc` 分支（PR #222/#231）上完成過一版，但從未進入 master：該提案將原始工作階段事件原樣匯出，法務評審未予透過。捕獲側設計（後端約定、coordinator、handoff 遊標、區塊投影）本身合理且經過評審；匯出側的立場纔是阻塞點。

## 決策

`packages/session/`（原 `telemetry/`）以 SDK 立場復活這兩個經過評審的包——harness 提供能力，部署方設定上報去向並對匯出內容負責：

- **`@deepseek-ai/dsh-session-telemetry`** —— seam 本體。`SessionTelemetrySink`（`emit`/`flush?`/`shutdown`）、服務註冊形態的 `SessionTelemetryBackend`、以及擁有捕獲側的 `SessionTelemetryCoordinator`：帶遊標回讀的即時納管與逐 append 的 firehose（投影 → `structuredClone` → 脫敏 → `emit`，零 I/O）、從權威日誌進行的無緩衝按需重播、固定的每個（輪次、步驟）組合首區塊投影、即時 `agent/error` 轉發，以及即時 dispose（資源釋放）時的 `shutdown` 記錄。
- **`session-telemetry/record` waterfall（瀑布式事件）** —— 相對分支版本的增量，也是該 seam 的脫敏擴充點。每條記錄抵達任何後端前必經此處；seam 自身不帶任何規則——最內層 `next()` 原樣透傳，部署方以監聽器掛載自己的規則（透過變換 `next()` 的回傳值堆疊），拋例外的規則將該記錄 fail-closed 扣下。脫敏只作用於匯出副本；canonical log 永不改寫。
- **`@deepseek-ai/dsh-session-telemetry-otel`** —— 參考後端：OTel JS SDK 日誌管線（`LoggerProvider` → `BatchLogRecordProcessor` → OTLP/HTTP exporter），經 `exporter`/`processor` passthrough 原樣設定。`DISABLED` 是預設值，且不構造任何傳輸；[回饋門控遙測決策](2026-08-05-feedback-gated-session-telemetry.md)定義了需顯式啟用的 `FULL` 與 `FEEDBACK_ONLY` 投遞模式，這兩種模式要求 `exporter.url`，且不移動脫敏或後端邊界。[無緩衝回饋重播](../simplification/2026-08-06-buffer-free-feedback-telemetry.md)避免在記憶體中建立工作階段前綴的第二份副本。


邊界公理保持不變：harness 的職責止於 `emit()`。批次處理、重試、排隊與丟失策略屬於 reporting SDK，經 passthrough 設定——投遞是盡力而為（崩潰時至多一次），兩份 README 對此如實陳述。

## 考慮過的替代方案

**實作 runtime-telemetry RFC 的 outbox（落盤 spool、每 sink 遊標、at-least-once、持久化 seam 的 `readCommitted` 方法）。** 推遲而非否決：SDK 立場使投遞語義歸屬 reporting SDK，OTel SDK 自身的批次處理管線是誠實的默認。outbox 是純增量層（`emit()` 約定不動）；待某個部署提出遙測必須滿足的崩潰丟失要求時再復活。

**不設行程內脫敏點，交給接收端 collector processor。** 否決——接收端脫敏是先把祕密寄出去再擦除。waterfall 在位元組離開行程前提供一個可審計、可堆疊的擦除點；分支版本（PR #222 交付的形態）完全沒有脫敏點，如今每條記錄都必經該脫敏點。

**在 waterfall 最內層 `next()` 內建一套保守規則集。** 否決：作為 SDK 我們無法預知某個部署裡什麼模式算祕密，內建清單只覆蓋已知形狀卻會帶來「脫敏已開啟」的虛假信心，且誤報會破壞未提出此要求的消費端所接收的匯出 body。seam 擁有機制，部署方擁有策略——最內層 `next()` 原樣透傳，規則以監聽器掛載。

**對映到 OTel span（GenAI 語義約定）而非日誌。** 本次復活否決：分支實作的日誌對映已經過評審、形態可交付；span 模型對可 fork、可中斷的工作階段有損，留給將來真正有 span 查詢需求的消費端。

**handoff 遊標未存活時全量重播日誌（重新匯出構造函式種子）。** 首輪復活曾交付此方案，其後收窄：接管操作現在從工作階段的構造邊界起重播（`Session.firstLiveSeq`，即構造函式種子長度，這一事實工作階段早已校驗過卻未曾暴露；`header.seedLength` 不能勝任：它是持久保存的 fork 譜系（lineage）值，而復原工作階段的構造函式種子是其完整的已儲存日誌）。復原工作階段的歷史已由上一個行程以同一 id 寄出，fork 繼承的前綴也已在父工作階段的流中寄出；再次匯出任何一者，都會讓每次復原為其完整歷史重複付費，並在沒有原生攝取去重的 OTLP 後端上使查詢時的計數翻倍。接收端基於 `session.parent_id` + `session.seed_length` 拼接 fork 譜系。此次收窄放棄的內容與至多一次立場一致：復原不再回填上一個行程未能投遞的記錄（彼時遙測未掛載，或崩潰時仍在佇列中）——這本是全量重播唯一的真實收益，代價卻由常見情形承擔。提出回填要求的部署需要的是上文已推遲的 outbox，而不是重播。該邊界同樣吞掉 `SessionPersistence.load()` 修復被崩潰打斷的日誌時寫入的合成輪次關閉事件（它們落在 `firstLiveSeq` 之前，儘管在上一個行程中從未存在過）。這是有意為之，而非附帶效果：遠端輪次的真實尾部記錄已隨崩潰行程的佇列一同消亡，匯出合成關閉事件無法補全該輪次，只會讓一個未完成的輪次看起來已經關閉。匯出的流忠實於崩潰行程實際寄出的內容；接收端會把復原後的流中一個從未關閉的輪次讀作「上一個行程死在了該輪次之內」（OTel README 陳述了這條規則），其後乾淨的 `shutdown` 標記也只證明復原後進程自身的退出。若為讓修復以即時事件的身份匯出而將修復前邊界貫穿 load/prepare 傳遞，將使三個包相互耦合，只為抹除這一訊號。

**將 seam 的輪次邊界 `flush()` 提示轉發到 OTel 提供方的 `forceFlush()`。** 首輪復活曾交付此轉發，其後移除：三條不同的靜默丟失路徑共用同一份包裝層狀態——dispose 與進行中的 flush 之間的競態（SDK 的並行 flush 防護會令 shutdown 的內部排空被跳過）、相互重疊的提示頂掉留存的 promise、以及提供方固定的 30 秒 flush 逾時在批次處理器仍在排空時便 reject。這些路徑存在的唯一原因，是該轉發讓這個後端成為行程內第二個執行 flush 的元件，面對的還是上游實驗性（experimental）原始碼樹中未見諸文件的 SDK 內部行為；不實作 `flush()` 時，批次處理器就是唯一執行 flush 的元件，其 `scheduledDelayMillis`（已可由部署方經 `processor` passthrough 調優）決定匯出節奏，`shutdown()` 的排空從構造上就是完整的。僅當某個部署提出 `scheduledDelayMillis` 無法滿足的輪次邊界延遲要求時才復原此轉發——且屆時應呼叫留存的 `BatchLogRecordProcessor` 自身的 `forceFlush()`，絕不呼叫提供方那個帶逾時包裝的版本。

## 後果

部署方在 `cordis.yml` 加一個帶 OTLP endpoint 的 Cordis 設定項，並顯式選擇 `FULL`，即可把工作階段流接入任何 OTel 相容體系；選擇 `FEEDBACK_ONLY` 則會在記錄回饋時重播權威日誌前綴。`DISABLED` 是[預設值](2026-08-10-telemetry-default-off.md)，且不構造上報管線；刪除該設定項仍是靜默退出方式，而停用模式會保留本機回饋警告。未掛載規則的部署匯出的記錄與捕獲時完全一致，包括文件內容與命令輸出中內嵌的任何憑據。因此，跨信任邊界的部署必須掛載 `session-telemetry/record` 監聽器，兩個 README 對此如實陳述。掛載規則後，匯出的 body 可能與 canonical log 位元組不同，接收端不得把遙測當作位元組精確副本；日誌仍是真源。崩潰持久性在上述 outbox 決定重新審議前明確不在範圍內。
