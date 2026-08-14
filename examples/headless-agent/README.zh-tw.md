# headless-agent

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

本目錄負責 headless coding agent（代理）的重播和真實模型測試組裝：DeepSeek V4 + 本機 bash 與檔案系統工具 + subagent 委託 + 工作流程與全新 agent Ralph 迭代 + `todo_write` + JSONL 持久化。本目錄顯式掛載共享 agent 主幹、一個根 agent、持久化和檢查點策略；它不是第二個產品入口。

## 執行

```sh
# repo root .env (gitignored) or exported env:
#   DEEPSEEK_API_KEY=sk-…
#   DEEPSEEK_BASE_URL=https://…   # optional; defaults to the public API
pnpm dsh --profile headless "fix the failing test in this workspace"
```

產品命令是 [`dsh --profile headless`](../../apps/cli/README.md)：它接受一項非空任務，建立並持久化新工作階段，列印最終 assistant 文字，然後結束。

快照套件透過 [`tests/fixtures/headless-driver.ts`](tests/fixtures/headless-driver.ts) 執行本目錄的設定。這個未匯出且僅供測試使用的行程會在結果記錄之前，以 JSONL 寄出規範工作階段事件。該事件串流屬於測試基礎設施，不是受支援的 CLI（命令列介面）輸出格式。子工作階段只透過父工作階段的工具事件和結果對外顯示。

## E2B POC overlay

[`e2b.cordis.yml`](e2b.cordis.yml) 使用一個共享 E2B 沙盒替換本機檔案系統與子行程提供方，同時保留 `dsh-bash-local` 和相同的面向模型工具。請在 git 忽略的根目錄 `.env` 中，將 `E2B_API_KEY` 與 `DEEPSEEK_API_KEY` 放在一起，然後執行憑據門控的實機組合測試；它在同一個沙盒中驅動 FS、Bash、PTY 和 LSP，並證明沙盒最終被刪除：

```sh
pnpm exec vitest run --config vitest.e2e.config.ts packages/e2b/e2b/tests/composition.e2e.ts
```

該 overlay 會在沙盒中建立相同的絕對 cwd，但不會上傳或掛載宿主工作區。文件與 Bash 變更只存在於 E2B；Cordis、模型呼叫、agent／工作階段狀態、工作階段日誌、skill（技能）和 SDK 緩衝仍在宿主上。該組合會在逾時和資源釋放時終止其沙盒。它是提供方組合 POC，而不是完整 harness 遷移或工作區同步功能。

## 進階設定

[`advanced.cordis.yml`](advanced.cordis.yml) 在測試組裝中新增 Code Mode 和 Cordis 工具。
