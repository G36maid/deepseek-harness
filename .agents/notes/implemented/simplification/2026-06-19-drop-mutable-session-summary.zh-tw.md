# Agent Note: 移除可變的工作階段摘要

Status: implemented

[English](2026-06-19-drop-mutable-session-summary.md) | [简体中文](2026-06-19-drop-mutable-session-summary.zh.md) | 繁體中文

## 問題

[工作階段持久化 seam](../architecture/2026-06-14-session-persistence.md) 將工作階段的日誌外元資料拆分為 `dsh-session` 擁有的兩種類型：一個不可變的 `SessionHeader`（`version`、`id`、`createdAt`、`cwd?`、`parentSession?`），在建立時一次性寫入；一個可變的 `SessionSummary`（`updatedAt`、`title?`、`firstPrompt?`），「可在不觸碰僅附加日誌的情況下更新」。二者合併為 `SessionMeta = SessionHeader & SessionSummary`，抽象的 `SessionPersistence` 服務為此多出第七個方法 `update(id, summary)`，用於重寫摘要。各後端各自實作可變儲存：JSONL 在日誌旁先寫入暫存檔再重新命名，並以盡力而為的方式原子發布一個獨立的 `.summary.json` **伴隨檔案**；SQLite 則使用 `updated_at`/`title`/`first_prompt` **列**，並在追加交易內更新其中的時間列。

摘要是為未來的工作階段選擇器設計的（透過 `updatedAt` 排序近期工作階段，用 `title`/`firstPrompt` 做預覽）。該選擇器從未實作。對整個倉庫的審計表明，`SessionSummary` 的整套相關介面都只是在維護**無用狀態**：

- `SessionPersistence.update()` **零個生產呼叫方**（所有 `.update(` 匹配都是 `createHash().update()` 或測試程式碼）。
- `firstPrompt` 在生產程式碼中**從未被讀取**。
- 工作階段標題來自持久的 `session/title` 事件，工具卡片標題來自工具 presenter；二者都不讀取可變的工作階段元資料。
- 持久化清單的消費端使用不可變 header 中的標識、建立時間、譜系和 cwd 欄位。近期排序和預覽派生自日誌，而非某個 `updatedAt` 摘要。
- 決定性的一點：活躍的 `Session.header` 類型本來就是 `SessionHeader` 而非 `SessionMeta`——摘要從未存在於活躍工作階段對象上；它只存在於持久化層，除了自身的約定測試外無人寫入、無人讀取。

## 決策

徹底刪除可變的工作階段摘要。`SessionSummary` 與 `SessionMeta` 這個名稱一並移除；後端儲存和返回的元資料僅為 `SessionHeader`。`SessionPersistence.update()` 從抽象服務和所有後端中移除。JSONL 去掉整套伴隨檔案機制（`writeSidecar`/`readSidecar`/`touchSummary`/`removeSidecars`/`sidecarPath` 以及 load/list 的覆蓋邏輯）；SQLite 去掉 `updated_at`/`title`/`first_prompt` 列以及每次追加時的 `updated_at` 更新，其 `SCHEMA_VERSION` 從 `1 → 2`。

摘要原本要提供的一切，在消費端真正需要時都**可從僅附加日誌中派生**（`firstPrompt` = 第一條 `user/message`；近期度 = 最後一個事件的 `time` 或文件 mtime），或者已經存在於不可變 header 中（`createdAt`、`cwd`）。唯一*不可*派生的是使用者*手動編輯*的標題，但它從未實作，純屬 YAGNI；如果未來真有功能需要，它可以作為獨立的日誌事件或 header 欄位回歸。

這次移除同時收窄兩個後端的公開服務約定和磁碟格式；摘要是有意為未來設計的結果，而非意外；如今原 Agent Note 描述 `SessionMeta` 之處已是 `SessionHeader`，這就是摘要消失的原因。它還為[共享持久化寫入協調器](../architecture/2026-06-18-shared-persistence-write-coordinator.md)掃清障礙：不再有可變摘要後，協調器的掛鉤介面不需要 `updateSummary` 掛鉤，JSONL 伴隨檔案與 SQLite 列之間的持久性分歧也隨之消失，使兩個後端的寫入路徑趨於一致。

## 無需遷移

這是未發布的軟體（見[根 AGENTS.md](../../../../AGENTS.md)「Pre-release stance: foundation over blast radius」一節），因此沒有需要保留的磁碟資料庫或日誌。SQLite 不遷移 v1 資料庫：`openDatabase` 守衛現在拒絕任何非當前版本的磁碟 `user_version`（`onDisk !== 0 && onDisk !== SCHEMA_VERSION`），無論版本更舊*還是*更高，因此過時的 v1 資料庫會被幹淨地拒絕，而不會按新的列集合進行不完整讀取。新建資料庫寫入當前版本號；這是唯一需要正常工作的路徑。

## 後果

未來的工作階段選擇器現在必須從日誌派生預覽/排序資訊（或重新引入一個類型化欄位），而不能直接讀取現成的摘要行。這是正確的代價：為一個尚不存在的功能維護快取，是每個後端都要承擔維護成本、每個約定測試都要承擔斷言成本的無謂負擔。這一原則——**透過的測試固定的是當前行為，不一定是正確行為；行為可能是過去妥協的產物**——現已作為獨立約定記錄在[根 AGENTS.md](../../../../AGENTS.md) 中，本次變更即為其實例。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
