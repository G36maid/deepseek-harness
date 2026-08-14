# Agent Note: follow-up 入隊與自有執行邊界

Status: implemented

[English](2026-07-30-followup-enqueue-and-owned-runs.md) | [简体中文](2026-07-30-followup-enqueue-and-owned-runs.zh.md) | 繁體中文

## 問題

`Agent.followup()` 會標識一條使用者訊息並將其排入佇列，但單次 follow-up 並不擁有隨後發生的活動。在 agent（代理）下一次進入 idle 前，steering（中途引導）、注入的上下文、工具續行、復原和後續排隊訊息都可能參與活動。因此，`MessageId` 可以證明訊息已獲 inbox 准入，但不能標識哪一條 assistant 訊息或哪一個 `turn/end` 是該輸入的結果。

[one-send-one-turn 決策](../simplification/2026-07-17-one-send-one-turn.md) 已經在覈心 API 中排除了按 send 返回完成控制代碼的設計。凡是把一項提示詞請求與一個輪次結果配對的協議層和 SDK 層，都會在下遊人為構造這一缺失的關係。一旦活動准入更多輸入，該配對就會產生歧義，還會把輪次機制暴露為提示詞級結果。

## 決策

保留 `Agent.followup(message): void`，使其僅執行入隊。`Agent.whenIdle()` 和 `agent/status` 仍用於觀察整個 agent 的生命週期；二者都不結帳單則訊息。Inbox 持久性會記錄已標識訊息及其准入或取消，但不會把後續輸出歸屬於該訊息。

底層 SDK 協議在入隊成功後立即以 `{ messageId }` 回應 `session/prompt`。它透過 `session.event` 流式傳輸持久事實，透過 `session.status` 發布整個 agent 的狀態轉換，且不包含 `session.finished`。底層用戶端可以觀察該回執和之後的 idle，但不會收到提示詞結果。

只有明確擁有一個活動區間時，高層自動化 API 才返回 `RunResult`。TypeScript 和 Python SDK 的 `run()` 方法從已提交訊息的持久 inbox 回執開始收集，直至整個 agent 下一次進入 `idle`；其最終回應是該區間內最後一條已提交的 assistant 訊息，而不是按因果關係歸屬於已提交提示詞的回應。Python SDK 還把根工作階段最後一個輪次的結束原因 kind 作為執行級 [`finish_reason`](../bug-fix/2026-08-11-owned-run-finish-reason.md) 返回，但不會將其歸因於已提交的提示詞。單次 CLI（命令列介面）擁有相應的 idle 到 idle 區間。隔離的子 agent 執行可以報告結果，因為呼叫方擁有完整的子級生命週期，任何 steering 都屬於該執行。

ACP（Agent Client Protocol）必須返回協議規定的 `stopReason`。其橋接層對每個 ACP 工作階段中的提示詞進行序列處理，確保一次只有一個提示詞正在處理，等待整個 agent 進入 idle，其他情況均報告通用的 `end_turn`。token 上限的輪次結束不歸因於提示詞：它們以 `end_turn` 結帳。與該提示詞關聯的輪次上的模型錯誤會立即以該錯誤拒絕提示詞（錯誤按其所屬輪次歸因），而無輪次的 slot（准入已丟棄提示詞）會在 idle 時以 `cancelled` 結帳，與顯式 ACP 取消或 dispose（資源釋放）並列。

Goal 續行只保留 `MessageId`，用於識別持久排隊和已准入的 goal 訊息。它在整個 agent 進入 idle 時根據持久 goal 狀態推進，不把訊息對映到輪次結果。

## 考慮過的替代方案

**將 `MessageId` 對映到准入它的輪次。** 一個輪次可能使用 steering 和注入的上下文，還可能經過多個模型／工具步驟繼續執行。該對映只能標識准入，不能確立結果輸出或停止原因的因果歸屬。

**返回按 follow-up 區分的完成控制代碼。** 這樣的控制代碼暗示共享 agent 生命週期中存在並不實際成立的結果邊界。它要麼遺漏影響活動的工作，要麼在不作說明的情況下吸收後續無關輸入。

**使用進入 idle 前觀察到的最後一個 `turn/end`。** 對於明確擁有的區間，這是一項有用的執行級觀測；但如果將其命名為已提交訊息的結果，就會再次作出錯誤的因果聲明。

## 驗證

- Agent 與 inbox 測試固定 follow-up 僅入隊、持久准入或取消以及整個 agent 的 idle 觀測。
- SDK 協議、TypeScript SDK 和 Python SDK 測試固定 `{ messageId }` 回執、`session.status`、不存在 `session.finished`，以及不含提示詞級 `status` 或 `reason` 的回執到 idle `RunResult` 收集；Python SDK 測試另行固定其執行級 `finish_reason` 觀測。
- ACP、單次 CLI、goal 續行和 subagent 測試固定各整合實際擁有的不同活動邊界。
- 消費端測試固定生產整合都不會透過關聯 `MessageId` 與 `turn/end` 來推導 follow-up 結果。

## 後果

自有活動區間可以包含進入 idle 前提交的 steering、注入上下文或其他工作，因此其最終回應、結束原因和事件有意比初始訊息涵蓋更廣。SDK 和 ACP 結果仍不包含提示詞級模型錯誤和 token 上限分類；呼叫方可以檢查執行級或持久事件事實，但不能聲稱這些事實具有因果歸屬。在同一工作階段上並行執行自動化操作時，必須採用顯式序列或所有權策略，不能相依性隱式的按提示詞結果。
