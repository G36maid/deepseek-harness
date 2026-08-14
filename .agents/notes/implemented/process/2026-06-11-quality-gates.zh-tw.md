# Agent Note: 以機械品質閘門取代行文約定

Status: implemented

[English](2026-06-11-quality-gates.md) | [简体中文](2026-06-11-quality-gates.zh.md) | 繁體中文

本記錄中的掛鉤/CI 對稱設計已由[快速本機 Git 掛鉤](2026-07-22-fast-local-git-hooks.md)取代；CI 仍是執行完整檢查的路徑。

## 問題

本程式碼庫主要由 coding agent（代理）開發。相比行文約定，agent 遵守強制閘門的可靠性遠高得多；而當勞動由 agent 承擔時，「工作量大」不構成成本論據。早期證據：未透過型別檢查的測試被提交（vitest 不做型別檢查），僅在評審中才被發現。

## 決策

每條可機械檢查的 AGENTS.md 承諾都有一個以非零狀態退出的命令。CI 執行完整集合，而 Git 掛鉤將延遲預算留給可低成本發現的本機缺陷：

- 最嚴格的 TypeScript 設定（`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` 等）；示例、測試和指令碼透過根目錄的 no-emit `tsconfig.json` 在 CI 中進行型別檢查，而包/vendor 程式碼保持在各自 project-reference 邊界之後。
- [Oxlint](2026-07-29-oxlint-linter.md) 配合類型感知的 TypeScript 規則以及 @stylistic 和 SonarJS 相容外掛程式，強制執行統一程式碼風格和文件內重複邏輯檢查；vendor 程式碼排除在外。
- jscpd 偵測包的生產 TypeScript 程式碼與倉庫指令碼中的跨文件克隆；窄範圍的原始碼區間例外用於記錄有意為之的平行實作。
- `packages/*/*/src` 下按文件 100% 覆蓋率（v8）；不可達的防禦性守衛使用 `/* v8 ignore */ ` 並註明理由，而非刪除。
- knip（死程式碼/相依性）、publint（包的正確性）、workspace 約束（workspace 規則：private、cordis peer+dev、統一版本、ESM），以及對建置出的包聲明文件進行 NodeNext 消費端型別檢查。
- lefthook pre-commit 執行不載入項目的 Oxlint 驗證，並應用帶[一次有界重試](2026-08-09-oxlint-only-fix-workflow.md)的安全修復，拒絕已暫存的空白問題並檢查 vendor manifest（中繼資料清單）；pre-push 執行增量型別檢查。CI 在 Node 22.19/24/26 上執行完整矩陣，並對 Headless、TUI、ACP（Agent Client Protocol）、JSON-RPC、工作流程和程式碼執行時期入口路徑執行已建置應用的冒煙測試。

## 後果

- 約定不會因 agent 更替而失效；可低成本發現的 commit/push 缺陷會在本機觸發失敗，其餘違規會在 CI 的完整檢查中觸發失敗。
- 閘門本身也是需要維護的程式碼；設定變更與其他變更一樣需要評審。
- 100% 覆蓋率的壓力可能催生無斷言的測試——變異測試是計畫中的對策（見[變異測試提案](../../proposed/testing/2026-06-11-mutation-testing.md)）。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
