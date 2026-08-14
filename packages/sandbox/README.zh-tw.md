# sandbox/：行程沙盒能力家族

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

本家族將逐工作階段限制策略應用於行程執行。它覆蓋與宿主共享檔案系統和核心的子行程；隔離環境會替換完整的能力實作，而不是在此註冊。

| 包 | 職責 | ctx key |
|---|---|---|
| [`sandbox/`](sandbox/README.md) | 定義行程沙盒服務和共享升權詞彙 | `ctx.sandbox` |
| [`sandbox-local/`](sandbox-local/README.md) | 提供本機平臺限制後端 | 註冊到 `ctx.sandbox` |
| [`sandbox-policy/`](sandbox-policy/README.md) | 解析持久的逐工作階段沙盒策略 | `ctx.sandboxPolicy` |

[沙盒決策](../../.agents/notes/implemented/feature/2026-07-06-sandbox.md)記錄了能力邊界，[檔案系統整合決策](../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md)記錄了跨家族策略的使用方式。

子系統參考——模式與強制執行、按呼叫策略、包裝 argv 方言、故障關閉錯誤——見 [docs/subsystems/sandbox.md](../../docs/subsystems/sandbox.md)；邊界與跨家族階段見[沙盒](../../.agents/notes/implemented/feature/2026-07-06-sandbox.md)與[跨家族 fs 沙盒](../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md) Agent Note。
