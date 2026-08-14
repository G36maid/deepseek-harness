# schedule/：僅限 Session 內的提醒

[English](README.md) | 繁體中文

Schedule 家族負責管理提醒，其持久狀態保存在原 Session 日誌中。行程內 owner 只會在該 Session 擁有 live 根 Agent 時等待；cold Session 再次 live 後會復原逾期工作，但這不意味著存在外部通知渠道。

| 包 | 職責 | ctx 鍵 |
|---|---|---|
| `schedule/` | 版本化 Schedule 事件與 fold、面向模型的建立／列出／刪除工具，以及 live 根 Agent timer owner | 無 |

本包有意不公開 Schedule service 或可變資料庫。工具與 runtime 向 Session stream 追加事件；到期工作透過 Agent 的普通 follow-up 佇列進入同一對話。

有關持久記錄、轉換、檢視表與交付約定，請參閱[僅限 Session 內的 Schedule](../../docs/subsystems/schedule.md)。
