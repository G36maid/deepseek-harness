# Agent Note: 事件溯源的工作階段與派生訊息歷史

Status: implemented

[English](2026-06-11-event-sourced-sessions.md) | 繁體中文

## 問題

MVP 要求嚴格的基於事件的追蹤，以及完全可重播的工作階段（嚴格的基於事件的 trace、logging 系統，工作階段完全可重播）。

## 決策

`Session` 是一份僅附加的、類型化的 `SessionEvent` 日誌，是唯一的真源。LLM（大型語言模型）訊息歷史從日誌*派生*（`deriveMessages()`）；原始流區塊被記錄以保證 token 等級的重播保真度，而組裝後的 `assistant/message` 事件纔是派生的權威依據。重播/fork = 用已有日誌初始化一個新工作階段。

追加操作是同步的（熱路徑從不阻塞於 I/O）；`session/event` 是同步通知；持久化外掛程式緩衝延後寫入，並在每個輪次結束時觸發的 `session/flush` 檢查點處等待排空。

順序約定：agent loop（代理循環）先領取 inbox 訊息，再執行 `agent/pre-step`；僅在作出 enter 決策後纔打開 `step/start`，隨後在請求派生前追加返回的 `user/message` 批次。提供方輸出組裝並以 `assistant/message` 追加後才分派工具，因此持久日誌記錄工具實際遵循的確切訊息。回歸測試固定了這一順序。

## 曾考慮的替代方案

**可變訊息陣列 + 事件僅作通知寄出**：更簡單，但狀態與日誌可能分歧；採用事件溯源後，日誌本身即是狀態，分歧在結構上不可能發生。

## 後果

- 重播、追蹤與遙測在結構上得到保證，而非事後附加。
- 持久化仍是外掛程式關注點；記憶體儲存隨 dsh-session 一起提供。
- 事件詞彙可透過合併擴充（外掛程式可新增如壓縮（compaction）事件）；[工作階段持久化](2026-06-14-session-persistence.md)在日誌具備持久性後固定了其結構。
- 派生成本隨日誌長度成長，壓縮（dsh-compaction）是預期的緩解手段，而不是改寫日誌。
