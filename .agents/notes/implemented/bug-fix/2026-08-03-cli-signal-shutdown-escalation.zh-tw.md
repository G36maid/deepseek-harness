# Agent Note: Web 與 headless 的有界訊號關閉和重複訊號強制退出

Status: implemented

[English](2026-08-03-cli-signal-shutdown-escalation.md) | [简体中文](2026-08-03-cli-signal-shutdown-escalation.zh.md) | 繁體中文

## 問題

默認掛載遙測後，`dsh web` 與 headless 命令（現為 `dsh --profile headless`）新增了 SIGINT/SIGTERM 處理器，使行程退出時可以排空 Cordis 外掛程式樹，而不是丟棄排隊中的遙測資料。每個處理器都使用單向布林閂鎖（latch），並且只有在 `ctx.fiber.dispose()` 結帳後才退出。headless 正常完成時同樣會無界等待整棵樹執行 dispose（資源釋放）。

隨後有使用者復現，headless 命令在列印觀察 URL 後立即卡死，重複按 `Ctrl+C` 也沒有反應；設定 `DSH_TELEMETRY_DISABLED=1` 後不再卡死，而同一 Linux 沙盒中的獨立 Node 訊號處理器能夠收到 SIGINT。這將待結帳的 disposer 定位到遙測，而非終端機訊號轉發。OTel 的 `BatchLogRecordProcessor.shutdown()` 會先等待 `exporter.forceFlush()`，再等待受 `exportTimeoutMillis` 限制的完成 Promise；OTLP 匯出器的 `forceFlush()` 則直接等待正在進行的 HTTP Promise。因此，代理／沙盒連線始終無法取得 socket 時，即使已經設定兩項 SDK 逾時，也會讓提供方關閉一直待結帳。

閂鎖隨後把這個遙測缺陷變成無法終止的 CLI（命令列介面）：正常完成流程已經在等待單次根級 dispose；第一次 SIGINT 會加入同一個待結帳的 dispose，並設定訊號閂鎖；後續 SIGINT 在閂鎖處直接返回，因此行程再無退出途徑。正常完成之前收到訊號時，同樣會陷入無界等待。Web 使用的閂鎖結構與此相同。

遙測自身的逾時無法證明整棵外掛程式樹都能結帳。任何當前或未來的 disposer 都可能卡死；行程邊界既要保留第一次優雅關閉的機會，也必須給使用者留下強制退出的途徑。

## 決策

修復分為兩層歸屬。OTel 後端圍繞 SDK 提供方的完整關閉 Promise 增加 `shutdownTimeoutMillis`（預設值和交付值均為 3 秒）。超過該截止時間時會以拒絕狀態結帳，並進入遙測協調器現有的失敗隔離路徑，使 Cordis 外掛程式樹能夠完成 dispose；由於 OTel 未公開取消傳輸 Promise 的能力，待處理記錄可能丟失。

Web 與 headless 共用 `createProcessShutdown`，它是圍繞根級 dispose 建立的行程級控制器：

- 多次正常關閉呼叫會匯合到同一次 dispose，並保留首次請求的退出碼；這些呼叫不會相互觸發強制退出。dispose 成功後，控制器透過 `process.exitCode` 記錄該退出碼，讓 Node 自然排空剩餘控制代碼；dispose 失敗時仍強制退出，因為啟動器不能假定失敗的外掛程式樹已經完全靜止。
- 第一個訊號會啟動同一次優雅 dispose，並設定一個帶引用的 5 秒退出兜底。dispose 無論成功或失敗都會觸發且僅觸發一次退出；任何一種結果都無法取消行程退出。
- 關閉待結帳期間收到訊號時，會立即按該訊號路徑的退出碼強制退出。這既包括 headless 正常完成已經進入 dispose 後收到的第一次 `Ctrl+C`，也包括由訊號啟動排空後收到的第二個訊號。
- 5 秒上限是行程安全不變式，而不是部署調節項。它足以覆蓋遙測部署的常規排空時限，同時仍在啟動器邊界為任何卡死的 disposer 設定等待上限。

正常完成會刻意避免呼叫 `process.exit()`：Undici 請求剛完成後立即強制退出，可能會在原生控制代碼清理尚未排空時觸發 Node 的 [Windows libuv 非同步控制代碼斷言](https://github.com/nodejs/node/issues/56645)。如果正常 dispose 已經完成，但仍有其他控制代碼讓行程保持存活，訊號依然可以強制退出。

headless 對完成的輪次仍以 0 退出，對其他輪次結束原因或 API 業務錯誤仍以 1 退出，對 SIGINT 以 130 退出，對 SIGTERM 以 143 退出。Web 保留現有行為：SIGTERM 以 0 退出，SIGINT 以 130 退出。

這項決策取代了[遙測部署 Agent Note](../feature/2026-07-31-web-telemetry-default-mount.md) 中 SDK 匯出器／處理器逾時能夠限制提供方完整關閉流程的假設，也取代了其中暫緩行程級退出兜底的決定。後端負責匯出資料丟失與延遲策略，並封住已知的 SDK `forceFlush()` 缺口；啟動器負責最外層保證，確保任何外掛程式都無法無限期困住行程。

## 考慮過的替代方案

**只限制遙測後端的 `shutdown()`。** 仍不充分：它能保護已知的 OTel 等待，但無法保護啟動器免受其他外掛程式 disposer 的影響。

**復原 Node 默認的訊號即時退出。** 不予採納：收到第一個訊號時，健康流程仍應刷新遙測資料並釋放其他資源。即時退出是顯式的強制退出路徑，而非默認行為。

**只增加 5 秒逾時。** 不予採納：使用者再次按下 `Ctrl+C`，就是要求立即停止等待。若在剩餘寬限期內繼續吞掉這一意圖，只是縮短了報告中故障的持續時間，並未解決問題。

**dispose 成功後仍總是呼叫 `process.exit()`。** 不予採納：根級 dispose 只能證明應用外掛程式樹已經完全靜止，不能證明 Node 及其原生相依性已經回收所有非同步控制代碼。設定 `process.exitCode` 既保留請求的狀態碼，也允許執行時期完成這部分工作。

## 後果

健康的正常退出流程仍會對整棵 Cordis 外掛程式樹執行 dispose，隨後等待 Node 事件迴圈自然排空。已知的遙測等待最多會在 3 秒後解除；其他退出流程卡死時，如無進一步輸入，最多等待 5 秒；收到訊號時，仍在排空控制代碼的正常完成流程或待結帳的關閉流程都會立即結束行程。強制退出或受截止時間限制的退出可能中斷遙測匯出或尚未完成的清理工作；只有優雅關閉約定已經失敗，或使用者明確要求強制退出時，才會有意接受這一結果。

該控制器屬於啟動器基礎設施，而不是 Cordis 外掛程式：它不會聲稱 dispose 已經完成，也不會削弱普通 disposer 必須達到完全靜止狀態的生命週期規則。

## 測試

`apps/cli/tests/process-shutdown.spec.ts` 固定了 dispose 成功後的自然完成、dispose 失敗後的強制退出、5 秒退出兜底、正常呼叫匯合、由訊號發起的 dispose、訊號中斷正常 dispose 或 dispose 後控制代碼排空，以及第二次訊號強制退出的行為。

`apps/cli/tests/headless-shutdown.e2e.ts` 在 PTY 中啟動真實交付的 Web/headless Loader 外掛程式樹，並掛載一個僅用於測試的外掛程式；該外掛程式的 disposer 會聲明已經進入清理流程，但永不結帳。測試在觀察地址出現後傳送 SIGINT，等待 dispose 已啟動的證據，再次傳送 SIGINT，並要求行程以 130 退出。原始碼／產物啟動解析器使兩個執行平面都覆蓋同一項回歸。該 PTY 用例覆蓋使用者可見的行程狀態；模型輸出快照沒有變化。

`packages/session/session-telemetry-otel/tests/otel.spec.ts` 在定時器匯出開始後保持一條真實 OTLP 請求打開，並固定以下行為：即使 SDK 的 `forceFlush()` 仍待結帳，Cordis dispose 也會在 `shutdownTimeoutMillis` 到期時返回。隨後測試釋放 collector，使仍受觀察的提供方 Promise 乾淨結帳。
