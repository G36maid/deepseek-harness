# guard/ — 迴圈衛生 guard 家族

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

行為 guard 外掛程式監視 agent loop（代理循環）中的無效模式，並強制執行單次呼叫預算。guard 是核心服務和擴充點的自包含消費端，而非可替換能力。

| 包 | 職責 | ctx key |
|---|---|---|
| [`repeat-tool-reminder/`](repeat-tool-reminder/README.md) | 針對重複工具呼叫的建議性提醒 | 監聽工具和 agent 事件 |
| [`timeout-policy/`](timeout-policy/README.md) | 以部署策略形式設定單次工具呼叫截止時間 | 註冊 `tools/execute` 監聽器 |

提醒作為 `additionalContexts` 隨 `tools/post-execute` 決策傳遞，並作為來源於外掛程式的 `user/message` 事件追加記錄（[工具](../../docs/subsystems/tools.md)）；跨 `dsh-timeout`、能力終止與本策略層的逾時拆分記錄在[逾時庫 Agent Note](../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md)。
