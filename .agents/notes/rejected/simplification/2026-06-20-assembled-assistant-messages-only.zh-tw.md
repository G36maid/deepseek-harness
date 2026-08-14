# Agent Note: 僅持久化組裝後的 assistant 訊息，不儲存流式區塊

Status: rejected — 高保真區塊重播、失敗流的部分輸出與快照重播目前相依性持久化的 `assistant/chunk` 事件。只有具備無資訊損失的重播或產物替代方案後，才能刪除區塊。

[English](2026-06-20-assembled-assistant-messages-only.md) | [简体中文](2026-06-20-assembled-assistant-messages-only.zh.md) | 繁體中文

## 問題

當前的規範工作階段日誌會持久化模型流式輸出的每一個 `assistant/chunk`。[工作階段持久化 Agent Note](../../implemented/architecture/2026-06-14-session-persistence.md)選擇這一方案是為了 token 級重播保真度和連續的 `seq`，但其代價日益成長：JSONL fixture（測試前置資料）被大量微小的增量記錄佔據，快照場景透過對區塊事件分組來回放模型，ACP（Agent Client Protocol）載入時從區塊重建先前的 assistant 輸出，而任何未來的日誌讀取方都必須區分持久的訊息歷史與 token 級追蹤。

對於成功組裝出完整內容的步驟，agent loop（代理循環）已經追加了一條 `assistant/message`。這正是 `deriveMessages()` 用來構造下一次模型請求的事件。換言之，正常的可復原工作階段狀態無需區塊即已具備；區塊是即時渲染和確定性測試的產物，不是必需的工作階段歷史。失敗或中止的流則不同：部分 assistant 輸出可能僅以區塊形式存在，而空的 max-token 步驟可能根本不產生 `assistant/message`。

## 提案

停止在規範工作階段日誌中儲存 `assistant/chunk`。持久日誌保留 `assistant/message`、`tool/call`、`tool/result`、`usage`（如保留）以及輪次邊界。即時 UI 仍可透過一個明確設計為瞬態的流事件接收 token 增量。快照重播應將其模型指令碼移入顯式的 fixture 伴隨檔案，或從記錄的配接器產物中派生，而非將規範的使用者工作階段當作 token 磁帶。需要失敗流部分輸出的場景必須在重播 fixture 中記錄該輸出。

ACP `session/load` 可以將先前的 assistant 訊息作為完整內容區塊重播，而非模擬原始的 token 流。載入後的 transcript（文字記錄）無需重現每一個歷史 delta；它必須展示相同的已完成 assistant 內容，並基於有效的提供方歷史繼續執行。

## 驗收標準

- `SessionEventMap` 移除 `assistant/chunk`，或在需要過渡性即時事件時將其標記為非持久化。
- [工作階段持久化文件](../../../../packages/session/session-persistence/README.md)不再要求逐字儲存每個流式區塊。
- `llm-replay` 和 ACP 快照使用顯式的重播 fixture 格式或伴隨檔案來儲存模型區塊。
- `session/load` 從 `assistant/message` 渲染已完成的 assistant 訊息。
- 儲存的日誌大幅縮小，且刪除區塊後仍保持 `seq` 連續，不留下序號缺口。
- 工作階段格式版本與已記錄的 fixture 一並刷新；按預發布格式策略拒絕非當前版本的儲存日誌。

## 放棄了什麼

規範的使用者工作階段不再能重建舊輪次的精確 token 流。它也會丟失失敗或中止流的部分 assistant 輸出，除非另有事件或 fixture 記錄。對於當前的復原、載入和快照約定而言，這是過大的資訊損失。需要精確確定性流的測試應當直接擁有該 fixture，前提是生產工作階段日誌為使用者可見的復原保留了足夠的保真度。

## 相關

本 Agent Note 取代 [工作階段持久化](../../implemented/architecture/2026-06-14-session-persistence.md) 中關於區塊持久化的決策，並影響 [ACP 快照測試](../../implemented/testing/2026-06-19-acp-snapshot-tests.md)——其當前的重播外掛程式從 `assistant/chunk` 事件派生指令碼。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
