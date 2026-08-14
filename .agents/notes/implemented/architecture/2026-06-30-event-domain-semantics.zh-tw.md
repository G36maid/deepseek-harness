# Agent Note: 事件域語義——工作階段是事實日誌，agent 是即時事件通道

Status: implemented

[English](2026-06-30-event-domain-semantics.md) | [简体中文](2026-06-30-event-domain-semantics.zh.md) | 繁體中文

## 問題

harness 透過 Cordis 事件分類體系擴充 agent loop（代理循環）（見[微核心事件分類體系 Agent Note](2026-06-11-microkernel-event-taxonomy.md)）。隨著該分類體系的成長，三個事件域之間的界限變得模糊：

- `session/*` 承載持久的、事件溯源的日誌（`SessionEventMap`）。
- `agent/*` 承載執行時期即時訊號，向外掛程式傳遞 `Agent` 控制代碼。
- `tools/*` 承載工具登錄檔與執行管線。

兩個問題促使我們固形容詞義。第一，若干輪次/步驟邊界同時作為持久的 `SessionEvent`（`turn/start`、`turn/end`、`step/start`、`step/end`）和映像檔的 `agent/*` emit（`agent/turn-start`、`agent/turn-end`、`agent/step-start`、`agent/step-end`）存在。消費端對同一事實有兩個真源，每次生命週期變更都必須同時更新兩處。第二，掛鉤子系統需要一個連貫且有文件的訂閱表面——外掛程式作者（以及基於其上建置的 Claude Code / Codex 掛鉤橋接）必須在不閱讀迴圈程式碼的情況下知道應該監聽工作階段事件還是 agent 事件，以及原因。

這套詞彙是攔截決策、持久的 `hook/*` 日誌，以及 Claude Code 和 Codex 橋接的基礎。

## 決策

**三個域，各司其職，以一條邊界規則統一。**

- **`session/*`——持久的、可重播的事實日誌。** 擁有 `SessionEventMap`；每條記錄僅含 JSON（無活對象）。每次追加觸發一次 `session/event` emit，加上 `session/flush` 平行持久性檢查點。它同時也是即時 transcript（文字記錄）源：想渲染或回應已發生事件的消費端在此訂閱，因此即時渲染與重播投影共享同一路徑。
- **`agent/*`——執行時期即時表面。** 始終攜帶活的 `Agent`。攔截 waterfall（瀑布式事件）（`agent/pre-step`、`agent/request`、`agent/request-error`）負責變換、拒絕或復原；awaited `agent/turn-stopping` 觀察停止邊界；瞬態 emit 報告生命週期、狀態、inbox 的插入、領取和丟棄，以及錯誤。輪次和步驟邊界不在此處——它們是持久的工作階段事件，從 `session/event` 讀取；token 流（`assistant/chunk`）和輪次中途以 `user/message` 呈現的 steering（中途引導）同理。
- **`tools/*`——工具登錄檔與執行管線。**

**邊界規則：** 持久的、可重播的事實是 `SessionEvent`；即時攔截或瞬態/活對象訊號是 `agent`/`tools` Cordis 事件。輪次或步驟邊界是持久事實，因此存在於工作階段日誌中並從 `session/event` 源讀取——不會被映像檔為 `agent/*` emit。

**將規則應用於邊界映像檔：** 全部四個邊界映像檔——`agent/turn-start`、`agent/turn-end`、`agent/step-start`、`agent/step-end`——被**移除**。沒有生產消費端需要在邊界處取得活的 `Agent`：ACP（Agent Client Protocol）橋接將其進行中的提示詞與精確對應的 `session/event` `turn/start`/`turn/end` 事件對關聯，其他 transcript 消費端同樣從持久流派生邊界。見[移除邊界映像檔事件 Agent Note](../simplification/2026-06-20-remove-agent-boundary-mirror-events.md)，該決策由它負責。移除 emit 也簡化了迴圈的 `closeStep`/`closeTurn`（各只需一次 append，無需配對 emit）。

## 後果

- 迴圈不再 emit 任何邊界映像檔；`closeStep` 僅附加 `step/end`，`closeTurn` 僅附加 `turn/end`。`Session.append` 負責 post-commit observer 隔離，因此拋出例外的邊界 observer 無法改變輪次結果或餓死後續消費端；事件接納失敗或內部校驗失敗仍會在邊界進入日誌之前向外拋出。
- 之前透過已移除 emit 觀察邊界的測試，現在觀察持久的 `turn/start`/`turn/end`/`step/start`/`step/end` 工作階段事件——它們所鎖定的行為（邊界順序、步驟計數）不變；只是讀取的源移到了規範源。那些測試*拋出例外的輪次邊界 emit 監聽器*的用例被刪除，因為該程式碼路徑不再存在（沒有 emit 可供拋出）。按照 [AGENTS.md「測試記錄行為，而非黃金真相」](../../../../AGENTS.md)，行為與其測試一同遷移（或一同消亡）。
- 迴圈僅在 `append('step/start')` 返回後才標記步驟已打開（`stepOpen = true`）。內部分發校驗在日誌推入之前執行，可能在不打開步驟的情況下拒絕；post-commit `session/event` observer 的失敗被隔離在 `Session.append` 內部。因此該標記精確表示已提交的、欠一個後續 `step/end` 的邊界。
- 完整實作見[簡化 Agent Note「停止將持久邊界映像檔為 agent 事件」](../simplification/2026-06-20-remove-agent-boundary-mirror-events.md)：全部四個邊界映像檔被移除，所有消費端從 `session/event` 讀取邊界。`agent/steering`（不是邊界映像檔）不在該 Agent Note 範圍內，由其後續 Agent Note [移除 `agent/steering` 映像檔 emit](../../archived/simplification/2026-07-04-remove-agent-steering-mirror.md) 單獨移除——它映像檔的是持久的中途 steering `user/message`。
- 生成的 Cordis 事件表面（`docs/subsystems/` 各頁）不再列出鏡像事件。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
