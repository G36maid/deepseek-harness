# session/：持久工作階段資料平面

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

這是圍繞 `core/session` 記憶體中執行的服務建置的持久功能族：包括持久化 seam 及其儲存後端和檢查點策略、提供日誌派生全量值的投影 seam、日誌支持的標題，以及外發工作階段遙測。它們全部都是**產品**包（package）。`session-query/` 仍是同級獨立組：讀取／工具介面的消費不相依性持久化內部實作。

## 持久化

持久工作階段資料的持久化機制、語義檢查點策略以及隨產品交付的儲存後端。

| 包 | 職責 | ctx 鍵 |
|---|---|---|
| [`session-persistence/`](session-persistence/README.md) | 定義持久化服務和共享寫入協調機制 | `ctx.sessionPersistence` |
| [`session-checkpoint-policy/`](session-checkpoint-policy/README.md) | 應用語義持久性檢查點 | 包裝 `ctx.llm` 和 `ctx.tools` |
| [`session-persistence-jsonl/`](session-persistence-jsonl/README.md) | 將工作階段持久化到 JSONL 文件 | 註冊到 `ctx.sessionPersistence` |
| [`session-persistence-sqlite/`](session-persistence-sqlite/README.md) | 將工作階段持久化到 SQLite | 註冊到 `ctx.sessionPersistence` |

[工作階段持久化決策](../../.agents/notes/implemented/architecture/2026-06-14-session-persistence.md)記錄了持久化設計。

## 投影

向用戶端載體提供從日誌派生的當前逐工作階段狀態。

| 包 | 職責 | ctx 鍵 |
|---|---|---|
| [`session-projection/`](session-projection/README.md) | 定義並驅動工作階段投影單元 | `ctx.sessionProjections` |
| [`session-projection-cache/`](session-projection-cache/README.md) | 持久化並復原投影檢查點 | `ctx.sessionProjectionCache` |
| [`session-stats/`](session-stats/README.md) | 提供全日誌工作階段計數與牆鐘時間（`sessionStats` 單元） | 註冊到 `ctx.sessionProjections` |

## 標題

從工作階段日誌派生持久工作階段標題，並支持選填的模型驅動提供方。

| 包 | 職責 | ctx 鍵 |
|---|---|---|
| [`session-title/`](session-title/README.md) | 負責標題狀態、回退行為、提供方註冊與刷新 | `ctx.sessionTitle` |
| [`session-title-llm/`](session-title-llm/README.md) | 提供共享的模型標題生成能力 | — |
| [`session-title-first-prompt-llm/`](session-title-first-prompt-llm/README.md) | 根據第一條合格的人類訊息生成工作階段標題 | 註冊到 `ctx.sessionTitle` |
| [`session-title-all-prompts-llm/`](session-title-all-prompts-llm/README.md) | 根據所有合格的人類訊息生成工作階段標題 | 註冊到 `ctx.sessionTitle` |

部署可以註冊一個模型驅動提供方；未註冊時，服務仍保留確定性回退機制。

## 遙測

將工作階段活動投影為外發遙測，並將投遞委派給設定的上報後端。[遙測決策](../../.agents/notes/implemented/feature/2026-07-23-session-telemetry-otel-revival.md)記錄上報邊界；[模式決策](../../.agents/notes/implemented/feature/2026-08-05-feedback-gated-session-telemetry.md)記錄即時、回饋門控與停用投遞。

| 包 | 職責 |
|---|---|
| [`session-telemetry/`](session-telemetry/README.md) | 定義捕獲、脫敏、投影，以及即時或按需後端投遞。 |
| [`session-telemetry-otel/`](session-telemetry-otel/README.md) | 透過 OpenTelemetry 日誌以 `FULL`、`FEEDBACK_ONLY` 或 `DISABLED` 模式投遞遙測。 |

子系統參考：[persistence.md](../../docs/subsystems/persistence.md)、[session-projection.md](../../docs/subsystems/session-projection.md)、[session-title.md](../../docs/subsystems/session-title.md) 與 [session-telemetry.md](../../docs/subsystems/session-telemetry.md)。同一時間只允許一個標題提供方註冊；demo 主幹掛載回退服務，兩個模型提供方都留在默認組合之外。
