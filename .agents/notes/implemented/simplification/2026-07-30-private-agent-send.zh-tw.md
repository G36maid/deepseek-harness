# Agent Note: 將 agent 路由保留為私有實作

Status: implemented

[English](2026-07-30-private-agent-send.md) | [简体中文](2026-07-30-private-agent-send.zh.md) | 繁體中文

## 問題

公開的 `Agent.send()` 方法暴露了具體迴圈實作的路由矩陣，但生產呼叫方只使用語義明確的 `followup()`、`steer()` 和 `inject()` 操作。第四種組合，即 `next-turn` 配合 `wakeup: false`，除測試外沒有消費端。將這項潛在能力保留為公開介面，還會迫使其他 `Agent` 實作和測試替身接受實作層的路由策略。

## 決策

`Agent` 將 `followup()`、`steer()` 和 `inject()` 作為完整的交付約定公開。`ReactLoopAgent` 保留私有的 `send()` 輔助方法，供這三個方法共用路由機制；`dsh-agent` 不再匯出 `SendTarget` 和 `SendOptions`。

公開介面無法在不喚醒驅動程式器的情況下讓一個輪次入隊。`followup()` 始終請求執行，`steer()` 請求最近的步驟，`inject()` 則提供面向模型的上下文而不請求執行。本決策部分取代[統一交付決策](../architecture/2026-07-22-unified-send-and-coalesced-user-messages.md)中關於公開介面的內容，同時保留其內部路由與統一的 `user/message` 表示。

## 曾考慮的替代方案

**讓路由矩陣保持公開。** 這會保留未使用的無喚醒排隊組合，但也會暴露機制而非呼叫方意圖，並要求每個替代驅動程式器都支持該機制。

**新增公開的無喚醒排隊方法。** 使用具名方法會比原始路由標志更清晰，但目前沒有生產工作流程需要讓工作持續處於等待狀態，直到無關的交付將其喚醒。

## 後果

外掛程式從三種語義操作中選擇，不再自行構造路由選項。其他驅動程式器和結構型測試替身只需實作更小的約定，Cordis API 目錄也不再列出 `send`、`SendTarget` 或 `SendOptions`。

只有出現明確的消費端並定義顯式的生命週期語義後，才能復原已移除的無喚醒排隊能力。`cancel({ keepInbox: true })` 仍會保留已透過受支持交付路徑進入待處理狀態的工作。
