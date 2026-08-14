# Agent Note: 空模型補全是可重試的 EMPTY_RESPONSE 失敗

Status: implemented

[English](2026-07-24-empty-model-response-is-retryable.md) | [简体中文](2026-07-24-empty-model-response-is-retryable.zh.md) | 繁體中文

## 問題

提供方偶爾會返回一種退化的 completion：流本身格式完好，以終止性的 `stop` 結束，卻沒有任何內容區塊——沒有文字、沒有推理（reasoning）、沒有工具呼叫。如果配接器把這種形態對映為成功的 `{kind: 'stop'}` 結束，主迴圈就會記錄一條空的 `assistant/message`，並把該輪次以 `completed` 結束。系統不會重試，失敗也不會向呼叫方暴露，而像 goal-round-driver 這樣的驅動方會消耗一個 Round，卻沒有取得任何進展。

## 決策

由配接器把「已完成但為空」的回應歸類為一次提供方邊界失敗，重試策略則將其視為瞬時性問題：

- `dsh-llm` 在 `CONTEXT_WINDOW_EXCEEDED_CODE`/`QUOTA_EXCEEDED_CODE` 之外，匯出規範程式碼 `EMPTY_RESPONSE_CODE`（`'EMPTY_RESPONSE'`）。
- `dsh-llm-pi-ai`（`mapStopReason`）：當終止性 `stop` 所對應的 assistant 訊息沒有內容區塊時，它會變成一個攜帶該程式碼的 `finish {kind: 'error'}`。上下文溢位偵測在其適用場景中仍然優先（它先被檢查，也是更具可操作性的歸類）。
- `dsh-llm-deepseek`（`translate`）：在 `[DONE]` 處，若 `stop`（或缺失）結束且沒有打開過任何塊，則同樣變成該錯誤結束。僅含推理的流算作有內容，仍視為成功。
- 由提供方定義的常規重試預設值包含 `EMPTY_RESPONSE`：這次嘗試沒有產生任何持久內容，因此重複它是安全的；部署方仍可透過 `retryableCodes` 將其移除，而 `dsh-llm-retry` 會執行解析後的策略。

偵測僅限於 `stop` 結束。內容為空的 `max-tokens` 保持其既有含義（pi-ai 已經把零輸出的溢位場景歸一化處理），`tool-calls` 在實踐中不可能是空塊，而 error／aborted 結束本身已經算失敗。

這套歸類使用既有的主迴圈機制——`finishError` → `agent/request-error` → `dsh-llm-retry`——並讓 `agent-loop` 保持提供方無關。重試預算耗盡時，該輪次會以顯式的 `EMPTY_RESPONSE` 失敗結束，而不是在沒有內容的情況下成功結束。

## 考慮過的替代方案

**在主迴圈或 `BlockAssembler` 中偵測。** 只需一份共享實作，但這會把對提供方回應的判斷挪進主迴圈，違背「外掛程式優先，而非改動主迴圈」，且 assembler 是純粹的組裝演算法。配接器纔是把協議層面的事實轉化為 harness 歸類的地方，而溢位重歸類正是精確的先例。

**在 `llm/stream` waterfall（瀑布式事件）上做一個流轉換外掛程式。** 這種做法提供方無關且只需一份實作，但它為「每個配接器幾行就能聲明的邊界事實」額外增加了一個包和相應接線，而且預設開啟的行為仍需改動每一個 bundle。

**把僅含空白或僅含推理的回應也當作空回應。** 作為過度設計予以否決：這類回應攜帶了模型產生的內容，把一個合法（哪怕無用）的回應誤判為傳輸類失敗，會在那些故意在推理之後停止的模型上引發重試迴圈。其範圍嚴格限定為「零內容區塊」。

## 後果

- 一個偶發例外的提供方會消耗一次有界重試，而不是一個沒有輸出的輪次；一個持續返回空內容的模型則會產生使用者可據以行動的 `EMPTY_RESPONSE` 輪次失敗。
- 一個確實打算什麼都不說的模型（罕見，但在一次工具結果之後有可能出現）會被重試，若始終為空，則該輪次失敗。這個取捨是經過審慎權衡後接受的：一條空的 assistant 訊息與提供方缺陷無法區分，且對使用者毫無價值。
- `empty-response-retry` ACP（Agent Client Protocol）快照（一個人工編寫的無金鑰場景，配有確定性的 1 ms 零抖動重試 overlay，`examples/acp-agent/retry.cordis.yml`）釘住了產品可見的行為：持久的 `llm/retry` 事件、被丟棄的嘗試不產生任何 ACP 輸出、復原後的回覆，以及一次正常完成的輪次。
