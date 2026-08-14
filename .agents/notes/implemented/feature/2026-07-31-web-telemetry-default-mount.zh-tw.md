# Agent Note: dsh web 組合默認掛載工作階段遙測（OTel 上報）

Status: implemented

[English](2026-07-31-web-telemetry-default-mount.md) | [简体中文](2026-07-31-web-telemetry-default-mount.zh.md) | 繁體中文

## 問題

遙測 seam 與 OTel 後端（[revival Note](2026-07-23-session-telemetry-otel-revival.md)）自完成以來從未接入任何部署組合：沒有 roster 行、沒有開關、沒有節奏口徑，內部部署對使用者工作階段的可觀測性為零。需要一個部署決策：哪些 surface 上報、報到哪、什麼節奏、怎麼關、CI 怎麼隔離。

## 決策

共享 dsh 基礎組合包（`packages/bundle/base/cordis.patch.yml`）掛載帶有內建生產 endpoint 的 `session-telemetry-otel` 設定行，使每個 profile 都具有一致的遙測能力。[預設關閉決策](2026-08-10-telemetry-default-off.md)讓該設定行保持 `DISABLED` 模式，除非部署方顯式選擇 `FULL` 或 `FEEDBACK_ONLY`；僅設定 endpoint 不構成上報授權。Web 與 headless 在 SIGINT/SIGTERM 時使用[有界、可升級的行程關閉控制器](../bug-fix/2026-08-03-cli-signal-shutdown-escalation.md)，在啟動器 5 秒上限到期前，先給已啟用的後端 3 秒關閉截止時間完成排空。

| 決策項 | 取值 | 理由 |
|---|---|---|
| 掛載面 | `packages/bundle/base/cordis.patch.yml` | 每個載入共享基礎組合包的 profile 都使用同一個能力設定行 |
| 共享模式 | `DSH_TELEMETRY_MODE`，默認 `DISABLED`；顯式設定 `FULL` 或 `FEEDBACK_ONLY` 即啟用 | 新 profile 不寄出遙測網路請求，內部部署仍可使用兩種上傳策略 |
| endpoint | `DSH_TELEMETRY_OTLP_URL`，預設 `https://harness-telemetry.deepseeksvc.com/v1/logs` | 內部 collector；env 覆蓋供本機/聯調 |
| 硬性退出 | `DSH_TELEMETRY_DISABLED` 非空（含 `0`/`false`）即停用該設定行 | 啟動器 patch 在載入期傳輸校驗之前生效，並覆蓋所有已設定模式 |
| 上報節奏 | 上傳模式中為 `processor.scheduledDelayMillis: 10000`（10s/批） | 在工作階段執行期間流式上報，而非僅在退出時上報；崩潰至多丟失最後一個尚未匯出間隔內的資料 |
| 退出 drain 上界 | `exporter.timeoutMillis: 1000` + `maxExportBatchSize: 2048`（與 maxQueueSize 相等） + `exportTimeoutMillis: 1500` + `shutdownTimeoutMillis: 3000` | collector 不可達的常規故障會在約 1s 內放行：timeoutMillis 是單次 socket 逾時與重試 deadline，使用與佇列等大的單批可避免依次排空導致耗時倍增。由 DSH 管理的 3s 外層上限覆蓋 SDK 先執行的無界 `forceFlush()` 等待，即傳輸 Promise 始終無法取得 socket 的情況。 |
| 壓縮 | `compression: gzip` | 事件 body 含全文，跨機房頻寬 |
| CI 隔離 | GitHub 工作流程頂層 `env: DSH_TELEMETRY_DISABLED: '1'` | 即使 CI 任務顯式選擇上傳模式，縱深防禦也會讓測試工作階段留在本機 |


基礎組合包測試固定交付的 `DISABLED` 模式表達式，後端測試套件固定省略模式時不構造傳輸，真實 Loader 組合測試則在驗證 OTLP 投遞時顯式選擇每種上傳模式。

## 考慮過的替代方案

**默認不掛載，部署方自行新增設定行。** 不採用：掛載的 `DISABLED` 模式會保留本機回饋警告，並為所有 profile 提供同一個 patch 目標，同時不授權任何上傳。

**開關做成 config 欄位而非 env patch。** 不可行：cordis 行沒有 config 層的 disable 語義，且 `exporter.url` 校驗在外掛程式構造期 fail-loud，開關必須在 Loader 之前生效——AppCLIEntry patch 層是唯一落點。

**退出時 `Promise.race` 兜底逾時。** 最初暫緩，是因為 SDK 參數看似已經將後端排空耗時限制在約 1.5-3s（通常 <100ms），實測 SIGINT 到退出耗時 110ms-1.1s。後來在 Linux 沙盒中復現並證明，`BatchLogRecordProcessor.shutdown()` 可能在 `exporter.forceFlush()` 中永久等待，無法進入受 `exportTimeoutMillis` 限制的完成 Promise。因此，[CLI 關閉修復](../bug-fix/2026-08-03-cli-signal-shutdown-escalation.md) 既為這一特定缺口增加 3 秒後端上限，也為整棵外掛程式樹增加 5 秒行程級上限和重複訊號退出途徑。

## 後果

- 開發者執行沒有遙測設定的 `dsh web` 時，不會發出遙測網路請求。內部部署需設定 `DSH_TELEMETRY_MODE`，並可讓 `DSH_TELEMETRY_OTLP_URL` 指向其他 collector。
- **沒有掛載任何脫敏規則**：顯式啟用的匯出即原始捕獲副本（使用者/助手訊息全文、工具參數與工具結果、系統提示詞、`session.cwd` 本機路徑）。跨信任邊界前必須先掛載 `session-telemetry/record` 規則；脫敏規則、其餘身份 Resource 屬性和使用情況指標仍是獨立的部署工作。匿名 user id 由[匿名 user id Note](2026-07-31-telemetry-anonymous-user-id.md)交付。
- 測試載具默認將資料留在本機；顯式啟用上傳模式的測試提供自己的 collector 和模式。
