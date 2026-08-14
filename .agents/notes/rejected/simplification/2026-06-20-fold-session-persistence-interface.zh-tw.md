# Agent Note: 將持久化介面合併進 dsh-session

Status: rejected — 獨立的持久化 Service Definition 包是持久化能力 seam 預期的模組化角色拆分。將其摺疊進 `dsh-session` 雖能減少包數量，卻會犧牲更清晰的後端邊界。

[English](2026-06-20-fold-session-persistence-interface.md) | [简体中文](2026-06-20-fold-session-persistence-interface.zh.md) | 繁體中文

## 問題

`dsh-session-persistence` 是一個 Service Definition 包，其核心概念已經由 `dsh-session` 擁有：`SessionHeader`、`SessionEvent`、`SessionId`、`session/event` 與 `session/flush`。該包額外新增了抽象的 `SessionPersistence` 服務、共享寫入協調器和約定輔助工具。提供方包相依性它，為實作復原，`agent-loop`（代理循環）還需要按需尋找這個同級服務。

當持久化還是一個全新的可替換後端設計時，能力 seam 的拆分是合理的。但在可變摘要被移除之後，這個 Service Definition 包基本上只是包裝了工作階段日誌自身的儲存職責。繼續保持獨立可能帶來的儀式感多於清晰度。

## 提案

將抽象的 `SessionPersistence` 服務、協調器和持久化約定輔助工具移入 `dsh-session`。JSONL 和 SQLite 仍作為獨立的後端包，註冊由工作階段包擁有的服務。這樣既保留了後端可替換性，又刪除了一個支撐包和一條跨包邊界。

實施 PR（Pull Request）應更新[能力 seam](../../implemented/architecture/2026-06-13-capability-seams.md) 指南，補充此例外：持久化不同於 bash 或 LLM（大型語言模型），因為它的詞彙和生命週期事件本就屬於工作階段包的核心領域。

## 驗收標準

- `@deepseek-ai/dsh-session-persistence` 作為包被移除。
- `dsh-session` 匯出持久化服務類型、協調器和約定輔助工具。
- JSONL 和 SQLite 後端包直接相依性 `dsh-session`。
- `agent-loop` 的復原功能使用工作階段包擁有的服務鍵。
- [工作階段持久化](../../implemented/architecture/2026-06-14-session-persistence.md)、[共享持久化寫入協調器](../../implemented/architecture/2026-06-18-shared-persistence-write-coordinator.md)與[包文件](../../../../packages/session/session-persistence/README.md)說明後端實作為何仍保持獨立。

## 放棄了什麼

`dsh-session` 變得更重：它同時擁有記憶體日誌和持久化 Service Definition。這就是代價。如果第三方持久化後端已經形成公開生態，獨立的 Service Definition 包會是更清晰的 SDK 邊界；但在預發布階段尚無外部消費端時，這個額外的包更像是過早引入的抽象。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
