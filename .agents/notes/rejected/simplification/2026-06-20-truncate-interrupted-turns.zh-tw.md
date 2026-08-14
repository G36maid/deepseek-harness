# Agent Note: 載入時截斷被中斷的最終輪次

Status: rejected — 單個輪次可以包含大量真實工作，包括多個步驟和大量工具輸出。保留被中斷的輪次，優於在載入時靜默丟棄這段尾部。

[English](2026-06-20-truncate-interrupted-turns.md) | 繁體中文

## 問題

當前的持久化約定會保留已持久寫入但從未關閉的最終輪次。載入時，`interruptedTurnClosers()` 掃描尾部，為未應答的工具呼叫合成 error `tool/result` 事件，在步驟處於打開狀態時追加 `step/end`，追加 `turn/end { kind: 'interrupted' }`，並要求後端持久提交這次修復。協調器、JSONL 後端、SQLite 後端、工作階段事件詞彙、不變式、文件和測試都對這條合成關閉路徑進行了建模。

這是一套龐大的機制，只為保留上次崩潰輪次中的部分工作。它還會憑空創造從未發生過的事件。合成的工具結果雖然有用（因為它使提供方歷史保持合法），但也意味著復原後的日誌中包含了模型可見、卻並非任何工具產出的文字。當前設計在尚無已發布產品、也沒有真實復原 UX 來證明部分輪次復原確有價值的情況下，就以最大限度保留尾部為最佳化目標。

## 提案

載入時只保留最後一個已完成的輪次。後端仍然容忍並截斷撕裂的最終記錄，但如果解析出的持久前綴在 `turn/start` 之後仍有輪次未關閉，規範的修復方式是丟棄上一個 `turn/end` 之後的所有事件。不合成 `tool/result`，不合成 `step/end`，不追加 `turn/end { interrupted }`，也不引入 `interrupted` 輪次結束原因。

這使持久化的輪次邊界變得簡單：一個已完成的 `turn/end` 就是檢查點。最後一個檢查點之後的內容都是崩潰尾部。下一次提示詞從最後一個已知合法的提供方 transcript（文字記錄）復原，而不是從部分重建的最終輪次復原。

## 驗收標準

- `TurnEndReasonMap` 移除 `interrupted` 變體。
- `interruptedTurnClosers()` 及其測試刪除。
- 持久化協調器的修復掛鉤截斷後端特有的撕裂或未關閉的尾部狀態，不追加關閉事件。
- [工作階段持久化文件](../../../../packages/session/session-persistence/README.md)說明載入返回最後一個已完成的輪次，不包含部分最終輪次。
- 快照與約定測試隨其所固定的行為一同更新。
- 工作階段格式版本與記錄的 fixture（測試前置資料）刷新；按預發布格式策略，非當前版本的儲存日誌被拒絕，不提供遷移路徑。

## 放棄的內容

崩潰可能丟失最終輪次中的真實工作：上一個 `turn/end` 之後追加的助手文字、工具呼叫和工具輸出。這是有意為之的簡化。產品尚未發布，最終輪次復原的語義未經使用者驗證，而一個乾淨的「已完成輪次即檢查點」模型在解釋、測試和實作上都容易得多。未來若需「復原部分崩潰工作」功能，應設計為面向使用者的顯式復原檢視表，而非靜默插入規範 transcript 的合成事件。

## 相關

本提案是對[工作階段持久化](../../implemented/architecture/2026-06-14-session-persistence.md)與歷史上的[通用輪次封閉規則](../../archived/architecture/2026-06-15-turn-enclosure-invariant.md)的直接簡化。它還移除了持久化步驟邊界事件的大部分動機，使[移除持久化步驟邊界事件](2026-06-20-drop-durable-step-boundaries.md)的改動更小。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
