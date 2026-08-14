# feedback/：記錄的人類回饋

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

回饋家族公開兩份刻意分離的契約：寫入權威 Session 日誌的不可變評價，以及掛在單條 assistant 訊息上的可編輯本機伴隨記錄（sidecar）回饋。兩者都不會進入模型對話。

| 包 | 職責 | ctx 鍵 |
|---|---|---|
| `command-feedback/` | 與觸發方式無關的 `feedback/record` 事件，以及面向使用者的 `/feedback` 生產方 | 無 |
| `message-feedback/` | 綁定生命週期的逐訊息評分／備注伴隨記錄，以及 Host `messageFeedback.list/put/delete` Remote 契約 | `messageFeedback` |

command feedback 評價僅寫入日誌：它絕不會進入模型上下文或派生歷史。掛載後，[`dsh-session-telemetry-otel`](../session/session-telemetry-otel) 會觀察 `feedback/record`，以釋放待處理的遙測前綴，或在遙測已停用時警告回饋將留在本機；採集本身與該策略相互獨立。

message feedback 不是 Session 事件或投影。它只保留在 storage-domain 伴隨記錄中，不觸發任何遙測交接。服務隨附 Host Remote 契約；用戶端 Remote 聚合掛載與 UI 消費端由各自邊界負責，並保持延後。
