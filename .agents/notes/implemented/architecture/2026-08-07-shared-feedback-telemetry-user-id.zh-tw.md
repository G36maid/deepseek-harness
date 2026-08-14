# Agent Note: 遙測、回饋與 DeepSeek 請求共享匿名使用者 id

Status: implemented

[English](2026-08-07-shared-feedback-telemetry-user-id.md) | [简体中文](2026-08-07-shared-feedback-telemetry-user-id.zh.md) | 繁體中文

## 問題

OpenTelemetry 後端已在 `$DSH_HOME/.anonymous-user-id` 中持久化一個匿名 UUID。`/feedback` 需要同時報告接收回饋的工作階段 id 與使用者 id，以便運維人員將確認文字與匯出的記錄相關聯。複製該身份或單獨生成身份會使報告的使用者失去意義；從 `session-telemetry-otel` 匯入身份則會讓直接命令相依性匯出後端，並在遙測側掛載回饋匯出時形成相依性環。

早先的[匿名使用者 id 決策](../feature/2026-07-31-telemetry-anonymous-user-id.md)刻意將輔助函式留在 OTel 後端內，直至出現第二個真實消費端。回饋成為第二個消費端，[直連 DeepSeek 請求身份](../feature/2026-08-11-deepseek-request-user-id-header.md)則是第三個。

## 決策

`@deepseek-ai/dsh-anonymous-user-id` 負責 `getOrCreateAnonymousUserId()` 和 `$DSH_HOME/.anonymous-user-id` 儲存約定。`session-telemetry-otel` 將返回的 id 用作 OpenTelemetry Resource 的 `user.id`；`/feedback` 的成功確認先報告 `Feedback recorded for session {sessionId}`，再在第二行顯示 `User: {userId}`；直連 DeepSeek 請求則透過 `x-deepseek-harness-user-id` 攜帶它。系統在取得 id 前拒絕無效回饋，DeepSeek 配接器也僅在憑據解析成功後取得 id，因此空命令和憑據失敗都不會建立 `.anonymous-user-id`。

此次抽取保留既有的隨機 UUID、home 解析、行程內快取、獨佔建立並行、損壞文件替換與 best-effort 寫入語義。

## 考慮過的替代方案

| 已否決 | 原因 |
|---|---|
| 從 `session-telemetry-otel` 匯入輔助函式 | 使回饋耦合到選填的匯出後端，並在遙測匯出回饋後形成反向相依性環 |
| 在回饋中複製持久化輔助函式 | 同一文件約定的兩份實作可能發生偏差，並因校驗或失敗語義不同而產生競態 |
| 生成獨立的回饋使用者 id | 確認文字無法與 OTel Resource 相關聯，因而不能達到報告目的 |

## 後果

- 一個 harness home 只有一個匿名 id，由回饋確認、工作階段遙測匯出與直連 DeepSeek 請求共享。
- 回饋包只相依性身份能力，不相依性遙測 seam 或 OTel SDK。
- 該包由三個消費端使用，成為有充分依據的共享庫；其空不變式伴生外掛程式解釋了為何讀取私有文件並非有用的執行時期關係檢查。
- 原始匿名使用者 id Note 仍是儲存與隱私語義的權威記錄；本 Note 僅取代其中由 OTel 本機擁有身份的決策。
