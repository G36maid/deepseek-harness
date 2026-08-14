# Agent Note: 鎖存取消收斂視窗內到達的喚醒請求

Status: implemented

[English](2026-08-07-cancel-convergence-wake-latch.md) | [简体中文](2026-08-07-cancel-convergence-wake-latch.zh.md) | 繁體中文

## 問題

`Agent.cancel(cause, { keepInbox: true })` 在觸發 abort 訊號後立即返回，但活動 driver 可能尚未收斂到 `idle`：LLM（大型語言模型）流拆除、工具取消與 `turn/end` 落盤都會在 `abort()` 返回後非同步展開。在該視窗內到達的喚醒 send 被放入 `next-turn`，而 `wakeDriver()` 對仍處於 `running` 的 phase 直接返回，退出的 driver 也從不重放這次喚醒——訊息會一直停放到下一條喚醒 send 到達。被中止的 `runMaintenance` 活動周圍也存在同樣的喚醒丟失視窗。多個測試固化了停放行為（「等待下一次喚醒」）；該缺陷同時破壞了 `session.cancel` 與 `subagent.interrupt` 組合路徑（issue #1838）。取消與傳送約定由以下既有決策定義：[顯式輪次取消](../architecture/2026-07-16-explicit-turn-cancellation.md)與[統一發送](../architecture/2026-07-22-unified-send-and-coalesced-user-messages.md)；生產環境中的 `keepInbox` 消費端是[Web 停止保留佇列](2026-07-31-web-stop-preserves-queue.md)。

## 決策

`running` phase 攜帶 `wakeRequested` 鎖存，與既有的 `maintenance` phase 欄位對稱。`wakeDriver()` 在當前活動無法投遞喚醒時鎖存——maintenance 任務從不讀取佇列，被中止的活動收斂後不會重新啟動——而存活的 driver 不需要鎖存，因為它自己會認領排隊的工作。退出中的活動在其自身收斂邊界（`kick` 的 `finally` 與 `runMaintenance` 的 `finally`）重放鎖存：這一位置保證 `turn/end N` 先於重放 driver 打開 `turn/start N+1` 落盤，並保證 `whenIdle()` 透過其 `activityDone` 迴圈看到重放 driver。兩個重放點僅在 `inbox.hasPending` 時執行，因此收斂前被從 inbox 移除的鎖存喚醒不會啟動空 driver。而 agent（代理）已處於 idle 時傳送的喚醒，即使訊息在 driver 認領前被清除，仍會打開自己的輪次邊界——這趟 `idle → running → idle` 轉換是可觀察約定：目標工作階段 driver 的 pause/disarm 回退相依性取消預訂後的 `idle` 轉換觸發（把守衛放進 `wakeDriver()` 會抑制該邊界）。不帶 `keepInbox` 的 `cancel()` 會連同 inbox 一起清除鎖存。

`signal.aborted` 這一判別條件至關重要：它區分「中斷前已排隊的工作」——`keepInbox` 將其停放以待後續喚醒（`keepInbox` 停放約定）——與「abort 後顯式的喚醒」，後者必須在收斂後執行。

## 備選方案

**讓 `cancel()` 立即把 phase 置為 `idle`。** 不予採用：driver 仍在展開收尾，這會重疊兩個 driver。重放邏輯位於舊 driver 的 `finally`，而該 `finally` 此後不再執行——83 個測試中有 14 個失敗，多個死結。修復它需要基於身份的 phase 所有權外加輪次開啟時的完全靜止屏障，機制上嚴格更重，而且整體上只是換了個形態的鎖存。

**對每個非 idle 喚醒無條件鎖存。** 不予採用：中斷前的喚醒會在 `keepInbox` 取消後自動啟動，違反 `keepInbox` 停放約定；「停放排隊工作」測試與錯誤視窗的 steering（中途引導）測試雙雙失敗。

**透過鏈式 promise（`activityDone.then(...)`）重放。** 不予採用：重放會執行在活動自身結帳之外，`whenIdle()` 的迴圈可能在重放 driver 啟動前就 resolve；修復它需要在 send 時同步替換 `activityDone`，並相依性微任務反應順序——比同步 flag 更脆弱。

**在 subagent（子代理）配接器中等待完全靜止。** 因 issue 範圍而不予採用：修復由取消/喚醒狀態機擁有，而不是消費端。

## 影響

`running` phase 新增 `wakeRequested` 欄位；不帶 `keepInbox` 的 `cancel()` 會連同 inbox 一起清除它，且 `disposed` 取消從不鎖存——dispose（資源釋放）開始後到達的喚醒保持停放，`whenIdle()` 不會在拆除中的工作階段上等待一個完整模型輪次。落在 driver 最後一次 `hasPending` 檢查與退出之間不到一個微任務的間隙的喚醒仍會停放——沒有鎖存觸發，因為 phase 是 `running` 且未 abort；關閉該間隙需要無條件鎖存，刻意不納入範圍。在被中止的輪次與重放 driver 之間，狀態轉換會發出一次瞬態 `idle → running` 對。喚醒 send 的訊息在任何 driver 認領前被清除時，仍會打開一個已完成的空輪次，保留可觀察的喚醒邊界。
