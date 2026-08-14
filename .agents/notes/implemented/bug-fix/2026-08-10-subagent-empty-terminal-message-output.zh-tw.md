# Agent Note: 用同一條選取規則在空終止訊息後保留子代理輸出

Status: implemented

[English](2026-08-10-subagent-empty-terminal-message-output.md) | [简体中文](2026-08-10-subagent-empty-terminal-message-output.zh.md) | 繁體中文

## 問題

當 `max-tokens` 步驟只組裝了工具呼叫塊時，agent loop（代理循環）會追加一條空內容的 `assistant/message`，因為 `BlockAssembler.blocks()` 會丟棄被截斷的工具呼叫；這則訊息僅記錄 usage。三個消費端獨立選取子 agent 的輸出，並把這條 usage 記錄當成輸出。行程內驅動程式的 `readResult` 與 continuable Activation 的 `subagent/end` capture 不加過濾地選取最後一條 `assistant/message`，SDK 後端的觀察器則讓任何 `assistant/message` 優先於累積的文字。在被 max-tokens 截斷的多步輪次中，最後那條空訊息導致 `SubagentResult.output`、工具結果、遙測與 `subagent/end.lastAssistantMessage` 都漏掉真實的部分回答。行程內驅動程式也沒有流式文字兜底，因此被取消的子 agent 若其唯一文字只存在於 `assistant/chunk` 事件中，也會報告 `[]`。

## 決策

`dsh-subagent` 在 `src/assistant-output.ts` 中擁有唯一的規範選取規則：選取最後一條非空 assistant 訊息；沒有時選取累積的 `text-delta` 流；忽略空內容訊息。增量的 `AssistantOutputFold` 透過 `push(event)` 處理工作階段事件傳輸，透過 `pushText(text)` 處理僅區塊傳輸，並透過 `collect()` 完成選取。`finalAssistantOutput(events)` 把規則應用於完整的事件後綴，供行程內 `readResult` 與 Activation capture 使用。SDK 後端摺疊通知事件；ACP 後端不暴露完整的 assistant 訊息，而是摺疊原始區塊文字。`SubagentResult.output` 定義結果約定，`subagent/end.lastAssistantMessage` 使用同一規則。子 agent 不產生這兩種輸出中的任何一種時，一次性與 continuable 執行的生命週期欄位都會預設，而不是空陣列。`max-tokens` 或 `aborted` 結果保留實際的終止原因。

前臺委派工具使用同一選取規則。非 `completed` 的結果仍是 `isError` 工具結果，但其訊息會在終止原因標題之後附上子 agent 的部分文字，讓父模型同時接收失敗資訊與已有輸出。

## 驗證

無金鑰 SDK 後端測試使用 `FAKE_EMPTY_MESSAGE` 寄出一條僅記錄 usage 的終止訊息。`subagent-max-tokens-partial` ACP 快照記錄一個子 agent：它流式輸出文字與一次工具呼叫，結束於僅含工具呼叫的 max-tokens 步驟，持久化日誌中含一條空的 usage 訊息，並透過父側的錯誤工具結果返回部分文字。單元覆蓋檢查空終止訊息、取消、訊息順序、不含文字的非空訊息，以及排除工具結果內容。

## 考慮過的替代方案

**各消費端就地修復、不抽共享輔助函式。** 之所以否決：三處獨立選取已發生分歧，而同一次執行的觀察方必須對其輸出達成一致。

**讓 loop 不再追加空訊息。** 之所以否決：這則訊息記錄 usage，並在持久化日誌中保留該步驟（"model-visible ⟺ logged"）；為處理輸出選取而改動工作階段事件，會影響所有 replay 與 projection 消費端。

**把空內容訊息視為錯誤。** 之所以否決：流式文字纔是子代理真實的部分回答，且終止原因已經告訴消費端輪次被截斷。

## 後果

被 max-tokens 截斷的多步子 agent 會報告其更早的文字；被取消的行程內子 agent 保留中止前已流式的文字；一次性與 continuable 的 `subagent/end` 事件同 `SubagentResult.output` 一致。內容非空但不含文字的訊息（例如僅含 reasoning 的內容）仍然優先於流式文字，因為規則檢查內容長度，而不是文字是否存在。非空訊息同樣優先於其後才流式出的文字：子 agent 在流式輸出後續步驟時被取消，報告的是更早那條完整訊息，終止原因則記錄該截斷。
