# session-query/：工作階段檢索能力家族

[English](README.md) | 繁體中文

本家族提供經過授權的即時與持久工作階段日誌檢索，且獨立於壓縮（compaction）。

| 包 | 職責 | ctx 鍵 |
|---|---|---|
| [`session-query/`](session-query/README.md) | 定義可信讀取、關係查詢和搜尋操作 | `ctx.sessionQuery` |
| [`session-query-sqlite/`](session-query-sqlite/README.md) | 使用 SQLite 全文搜尋實作工作階段查詢 | `ctx.sessionQuery` |
| [`session-log-export/`](session-log-export/README.md) | 在 Host ZIP 端點之上增加 Web `/export` 命令、共享瀏覽器下載狀態和結果彈出視窗 | `ctx.sessionLogDownload` |
| [`tool-session-query/`](tool-session-query/README.md) | 向模型公開經過工作區授權的工作階段查詢 | 註冊到 `ctx.tools` |

子系統參考——邏輯記錄、有界讀取、追蹤、篩選器、結果頁——見 [docs/subsystems/session-query.md](../../docs/subsystems/session-query.md)。
