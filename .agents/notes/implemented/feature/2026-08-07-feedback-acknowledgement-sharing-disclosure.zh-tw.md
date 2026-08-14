# Agent Note: 回饋確認中的工作階段共享披露

Status: implemented

[English](2026-08-07-feedback-acknowledgement-sharing-disclosure.md) | [简体中文](2026-08-07-feedback-acknowledgement-sharing-disclosure.zh.md) | 繁體中文

## 問題

`/feedback` 命令會記錄一個僅寫入日誌的 `feedback/record` 事件並確認使用者，但確認文字沒有攜帶關於工作階段去向的持久資訊：掛載了工作階段遙測（`FULL`、`FEEDBACK_ONLY` 或 `DISABLED`）的部署無法告知使用者其回饋和工作階段是否離開了行程，確認文字也沒有回顯接收工作階段的 id。命令外掛程式無法讀取共享策略，因為遙測 seam 只暴露採集能力，而 OTel 模式枚舉位於選填的後端包中。

## 決策

遙測 seam（`@deepseek-ai/dsh-session-telemetry`）現在擁有與後端無關的共享詞彙：`SessionTelemetrySharingStatus`（`full` | `feedback-only` | `disabled`），並在 `SessionTelemetryBackend` 服務類上增加一個必需的抽象 `sharing` 成員——每個後端都必須披露其策略，因此消費端只有在未掛載任何遙測服務時才渲染「未設定」。`@deepseek-ai/dsh-session-telemetry-otel` 在構造函式中把序列化的 `SessionTelemetryMode`（模式語義由[回饋門控投遞決策](2026-08-05-feedback-gated-session-telemetry.md)負責）對映到該狀態並披露，包括 `DISABLED` 模式。`/feedback` 處理器透過外掛程式上下文讀取已掛載的服務（`ctx.get('telemetry')`，絕不是聲明的注入，因此命令在無遙測時也能載入和執行），並在確認文字後追加一句共享披露：`Feedback recorded for session {id}. <句子>`。無服務 → `Session sharing is not configured.`；`disabled` → `Session sharing is disabled.`；`feedback-only` → `Session sharing is feedback-gated; recording feedback releases the session prefix for sharing.`；`full` → `Session sharing is enabled.`

披露只陳述當前的共享策略，絕不承諾投遞或留存：交接是後端的非阻塞入隊，批次處理、重試與丟失策略仍歸後端 SDK，且後續重新設定可能改變已共享的內容，因此句子不聲稱任何內容已到達採集端，也不聲稱未來的留存。披露不新增任何工作階段事件，也絕不會進入模型 surface；Web 用戶端透過現有的命令列（`CommandNode` 的結果文字）原樣渲染，無需用戶端改動。

## 備選方案

**用戶端新增狀態 RPC 與徽標。** 拒絕，因為確認文字由宿主生成，Web 用戶端已經在命令列中原樣渲染命令結果文字；單獨的 RPC 會在第二個 surface 重複該狀態，並為一句文案新增線上契約。

**在 `command-feedback` 中聲明 `telemetry` 注入。** 拒絕，因為遙測是選填的：服務缺失時聲明注入會導致外掛程式載入失敗，而命令必須在無遙測時可用。外掛程式改為在處理器執行時用 `ctx.get('telemetry')` 讀取服務。

**由 OTel 包擁有詞彙。** 拒絕，因為 `command-feedback` 不能相依性選填的 OTel 後端包。seam 擁有 `SessionTelemetrySharingStatus`，任何後端都能披露策略。

## 後果

確認文字對使用者可見：它點名接收工作階段並報告當前的共享策略，如實說明 fire-and-forget 交接。包級測試為每種狀態以及無服務場景固定句子；組裝瀏覽器 e2e 以 FULL 模式掛載隨附的遙測行（指向本機 dead 端點），並以 golden 固定隨附默認句子（`Session sharing is enabled.`）。seam 成員是必需的，因此已掛載的後端總會披露策略，「未設定」句子如實地表示沒有遙測服務；`/feedback` 命令在未掛載遙測時仍能正常工作。仍為空白的新 Web 工作階段不渲染命令列，因此首則訊息之前記錄的回饋沒有可見確認（已在包 README 的限制中記錄）。
