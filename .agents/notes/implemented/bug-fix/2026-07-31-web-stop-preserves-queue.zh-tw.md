# Agent Note: Web 停止操作保留待處理 Queue

Status: implemented

[English](2026-07-31-web-stop-preserves-queue.md) | [简体中文](2026-07-31-web-stop-preserves-queue.zh.md) | 繁體中文

## 問題

Web 停止按鈕呼叫 `session.cancel`，後者對映到廣義 `agent.cancel({ kind: 'user' })`。在活動輪次期間，普通 composer 提交已經被接納為可獨立尋址的 Queue 入隊項。使用者只想停止當前生成時，廣義取消卻會丟棄所有入隊項，混淆了輪次中斷與 Queue 的顯式刪除操作。

瀏覽器無法透過重發可見行修復這一損失。它不擁有這些行的即時 `InboxItemId`、喚醒策略或認領競態；重發還可能重複 Host 已認領的工作。

## 決策

`session.cancel` 是 Web Host API 面向普通工作階段的活動輪次停止操作。它會以 `agent-busy` 拒絕由工作階段支撐的 subagent；否則會呼叫 `agent.cancel({ kind: 'user' }, { keepInbox: true })`，在協作式中止當前輪次的同時保留待處理 inbox 工作。底層選項會保留 queued 和 steering 入隊項；Web Queue 投影繼續只暴露 queued 入隊項。

AgentLoop 不會啟動並行的替代輪次。它會關閉並 flush 被中斷的輪次，達到取消的完全靜止，然後透過現有 FIFO 驅動器認領下一個可喚醒的 queued 入隊項。該認領會發出 `agent/inbox/dequeue`，因此 Host 的權威 `session/queue` 快照會退役已認領行，並使剩餘隊尾保持可見。瀏覽器既不重發，也不提升任何行。忽略取消的工作會延遲這一交接，直到該工作結帳。

該對映只更改 Web 用戶端使用的 Host `session.cancel` 端點。`Agent.cancel()` 默認約定仍為廣義取消，ACP 和 TUI 保留既有取消策略，`AgentHandle.dispose()` 在拆卸期間仍會清除待處理工作。移除 Queue 行仍是用於丟棄單個待處理入隊項的顯式 Web 操作。

## 考慮過的替代方案

**停止按鈕繼續使用廣義取消。** 之所以否決：停止一次生成不應銷毀已獨立排隊的使用者意圖；Queue 已擁有顯式刪除操作。

**取消後由瀏覽器重發下一行。** 之所以否決：Host 擁有入隊項標識和認領順序。用戶端重新提交可能重複工作、重排 FIFO，或與權威出隊產生競態。

**被取消工作達到完全靜止之前啟動下一輪次。** 之所以否決：兩個輪次會並行修改同一工作階段日誌，並共享 Agent 擁有的資源。協作式取消會如實等待活動工作結帳。

**為廣義取消與保留式取消新增協議選項。** 之所以否決：在 Web 產品提供獨立的「停止並清空 Queue」互動之前，不需要此選項。現有停止按鈕只有一項策略，而逐行刪除已提供當前的丟棄控制元件。

## 驗證

AgentLoop 覆蓋會保持一個活動模型流，將兩個可喚醒輪次排隊，使用 `keepInbox` 取消，並固定驗證先中止、後完成的輪次原因，FIFO 使用者訊息順序，不存在 discard 事件，以及最終空閒狀態。無金鑰 Web 場景透過 HTTP／SSE 驅動已組裝組合：它停止一個卡住的輪次，觀察隊尾保持可見時下一個 queued 入隊項開始，再停止該輪次，並觀察最後一個 queued 入隊項完成。其可訪問性快照固定了中間的 Queue 保留狀態。

## 後果

Web 停止會保留已接納的排隊意圖，並在取消如實結帳後自動推進。不配合取消的活動工作收尾時，Queue 行可能仍保持可見；由同一 inbox 選項保留的外部 steering 可以進入下一個已接納輪次，儘管 Web 不會在 QueueDock 中渲染 steering。未來的批次清空互動需要顯式的產品操作，而不是過載停止。
