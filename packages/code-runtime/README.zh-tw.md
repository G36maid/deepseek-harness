# code-runtime/ — 程式碼執行能力家族

[English](README.md) | 繁體中文

程式碼執行能力 seam（參見[能力 seam](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)）：執行時期 Service Definition，用於對宿主提供的非同步綁定執行模型編寫的程序，並捕獲它列印和返回的內容；可替換的提供方；以及工具登錄檔的 [Code Mode](../core/tools/README.md) Consumer（`tools: { mode: code }`，即 `run_code` 工具和按所載入執行時期 `language` 生成的 SDK）。設計見 [Code Mode Agent Note](../../.agents/notes/implemented/feature/2026-06-15-code-mode.md)。這些全是**產品**包。

| 包 | 職責 | ctx key |
|---|---|---|
| [`code-runtime/`](code-runtime/README.md) | Service Definition 與共享詞彙 | `ctx.codeRuntime` |
| [`code-runtime-worker/`](code-runtime-worker-thread/README.md) | Worker 執行緒後端 | 註冊 `ctx.codeRuntime` |

提供方在不改變Consumer的情況下註冊該服務。子 README 負責語言、隔離和執行預算細節。

子系統參考——執行請求/結果、綁定命名空間、失敗分類體系——見 [docs/subsystems/code-runtime.md](../../docs/subsystems/code-runtime.md)。
