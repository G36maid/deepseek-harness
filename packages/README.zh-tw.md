# 包

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

npm scope 為 `@deepseek-ai/dsh-*`；Cordis `Service` 子類和函式外掛程式透過 `ctx.effect()`、`ctx.on()` 或 `ctx.waterfall()` 註冊。規則見[包](AGENTS.md)與[根規則](../AGENTS.md#conventions)。

## 層級結構

包按組置於 `packages/<group>/<pkg>/`；包名仍為 `@deepseek-ai/dsh-<pkg>`。**組 README 負責包／ctx 鍵對映。**

| 組 | 職責 | 發布預期 |
|---|---|---|
| [`core/`](core/README.md) | 產品 API 主幹：工作階段、提示詞、工具、agent（代理）服務與具體迴圈 | 產品：穩定 API |
| [`api/`](api/README.md) | Remote BFF 裝配與 Typert RPC 閘道 | 產品：穩定 API |
| [`typert/`](typert/README.md) | 類型圖生成、產物載入與執行時期登錄檔 | 產品：穩定 API |
| [`goal/`](goal/README.md) | 同工作階段 goal 的持久化與生命週期 | 產品：穩定 API |
| [`schedule/`](schedule/README.md) | 僅限工作階段內的定時後續操作 | 產品：穩定 API |
| [`feedback/`](feedback/README.md) | 人類回饋 | 產品：穩定 API |
| [`identity/`](identity/README.md) | 共享匿名身份 | 產品：穩定 API |
| [`llm/`](llm/README.md) | LLM（大型語言模型）能力系列：抽象服務 + 提供方配接器 | 產品：穩定 API |
| [`e2b/`](e2b/README.md) | E2B 提供方 | POC |
| [`subprocess/`](subprocess/README.md) | 子行程能力系列：Service Definition + 本機行程樹提供方 | 產品：穩定 API |
| [`shell/`](shell/README.md) | Bash 能力系列：執行器 seam、本機實作、面向模型的工具 | 產品：穩定 API |
| [`terminal/`](terminal/README.md) | 持久 PTY 能力系列：限定所有者範圍的工作階段、本機實作和麵向模型的工具 | 產品：穩定 API |
| [`code-runtime/`](code-runtime/README.md) | 程式碼執行能力系列：Service Definition + worker 執行緒提供方 + Code Mode Consumer | 產品：穩定 API |
| [`sandbox/`](sandbox/README.md) | 行程限制 seam；bwrap/Landlock/Seatbelt 後端 | 產品：穩定 API |
| [`fs/`](fs/README.md) | 檔案系統能力系列：seam、本機實作、面向模型的文件工具、由 bash 支援的發現工具 | 產品：穩定 API |
| [`lsp/`](lsp/README.md) | LSP 能力系列：seam、通用 stdio 提供方和 `lsp` 工具 | 產品：穩定 API |
| [`skill/`](skill/README.md) | skill（技能）能力系列：提供方登錄檔、本機提供方和麵向模型的目錄／loader | 產品：穩定 API |
| [`compaction/`](compaction/README.md) | 壓縮（compaction）能力系列：Service Definition + 基礎提供方 + 命令 Consumer | 產品：穩定 API |
| [`context/`](context/README.md) | 模型可見請求上下文，包括 workspace 指令和時間上下文 | 產品：穩定 API |
| [`subagent/`](subagent/README.md) | subagent 能力系列：提供方登錄檔約定和麵向模型的委託工具 | 產品：穩定 API |
| [`jobs/`](jobs/README.md) | 通用背景工作執行時期和麵向模型的 `job_*` 控制工具 | 產品：穩定 API |
| [`workflow/`](workflow/README.md) | 工作流程 seam、worker 執行緒引擎和麵向模型的 `workflow`/`ralph` 工具 | 產品：穩定 API |
| [`web/`](web/README.md) | Web 能力系列：seam、搜尋／取得提供方實作和麵向模型的 Web 工具 | 產品：穩定 API |
| [`attachment/`](attachment/README.md) | 持久附件標識、校驗、本機內容尋址儲存 | 產品：穩定 API |
| [`spill/`](spill/README.md) | spill 能力系列：儲存 seam、本機實作、工具結果 spill 策略 | 產品：穩定 API |
| [`todo/`](todo/README.md) | 面向模型的 `todo_write` 工具 | 產品：穩定 API |
| [`plan/`](plan/README.md) | Plan 協作狀態，提供直接進入命令與經評審的結束 | 產品：穩定 API |
| [`preset/`](preset/README.md) | 由 preset `cordis.yml` 按工作階段組裝 agent | 產品：穩定 API |
| [`guard/`](guard/README.md) | 迴圈衛生守衛：建議性重複呼叫提醒 + `tools/execute` 截止時間強制執行器 | 產品：穩定 API |
| [`bundle/`](bundle/README.md) | 可安裝的 `dsh --profile` 修補程式層 | 產品：穩定 API |
| [`extensions/`](extensions/README.md) | agent 執行時期自修改：即時外掛程式／服務檢查和模型所寫外掛程式掛載／解除安裝（[設計](../.agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md)） | 產品：穩定 API |
| [`hooks/`](hooks/README.md) | 掛鉤橋接 + 共享的 Claude Code／Codex 線協定庫 | 產品：穩定 API |
| [`session/`](session/README.md) | 持久工作階段資料平面：持久化 seam + JSONL/SQLite 後端、投影 seam、基於日誌的標題、工作階段上報 | 產品：穩定 API |
| [`session-query/`](session-query/README.md) | 工作階段檢索系列：邏輯語料庫、有界讀取、血緣、事件關係、語義過濾和 SQLite 全文搜尋 | 產品：穩定 API |
| [`settings/`](settings/README.md) | 使用者設定 seam + 基於文件的提供方 | 產品：穩定 API |
| [`credentials/`](credentials/README.md) | 憑據引用 seam + 環境變數優先於 `.env` 的提供方 | 產品：穩定 API |
| [`storage/`](storage/README.md) | 非工作階段儲存中樞 + 後端 + 領域形式 | 產品：穩定 API |
| [`workspace/`](workspace/README.md) | Workspace 實體 | 產品：穩定 API |
| [`sdk/`](sdk/README.md) | 行程外執行時期 SDK：JSON-RPC 協定、TypeScript 用戶端和伺服器外掛程式 | 產品：穩定 API |
| [`acp/`](acp/README.md) | 僅面向自動化的 ACP（Agent Client Protocol）伺服器 | 產品：穩定 API |
| [`interaction/`](interaction/README.md) | 人機協作平面：批准／互動 seam、權限預設、命令、詢問使用者的工具 | 產品：穩定 API |
| [`boot/`](boot/README.md) | 共享的 app bin 啟動粘合層 | 產品：穩定 API |
| [`host/`](host/README.md) | web GUI 宿主半側：API 閘道 + HTTP 路由伺服器 | 產品：穩定 API |
| [`client/`](client/README.md) | web GUI 瀏覽器半側：shell、協定層、對象服務、slot、`ui-*` 外掛程式 | 產品：穩定 API |
| [`examples/`](examples/README.md) | 示範組合包（agent-spine + CLI（命令列介面）/ACP/JSON-RPC bin），由葉節點載入 | 支援：示例基礎設施 |
| [`test-support/`](test-support/README.md) | 支援基礎設施（testkit、不變式、重播、Loader 冒煙測試） | 支援：相容性預期較低 |
| [`util/`](util/README.md) | 組間共享的低層零相依性工具（`Branded<B>`、Harness home／路徑輔助函式、逾時、留存） | 支援：小型、穩定、無 harness 相依性 |

新包加入現有組；新組更新其 README 和此表。

## 相依性

相依性圖由工具生成：[docs/module-graph.md](../docs/module-graph.md)（`pnpm run gen-module-graph`，CI 中有新鮮度閘門）。

**擴充外掛程式相依性 Service Definition，絕不相依性具體提供方。** `dsh-agent-loop` 可替換；UI、掛鉤和工具外掛程式使用 `dsh-agent`。包括 `dsh-agent-spine-demo` 在內的組合包可以相依性主幹外掛程式。能力會將需要獨立演進的 Service Definition／Service Provider／Consumer 角色分離；詳見[能力 seam](../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)。

包 README 覆蓋用途、API、擴充點和[模型體驗](../docs/cookbook/adding-a-package.md#4-write-the-package-readme)；列入模型無關[省略允許清單](../scripts/verify-package-readme-model-experience.ts)的包除外。它們還要包含 `## Known Limitations and Deferred Work`，或列入其[允許清單](../scripts/verify-package-readme-limitations.ts)。
