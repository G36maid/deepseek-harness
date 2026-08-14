# e2b/ — E2B 遠端執行時期家族

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

這是一個實驗性提供方組合 POC，把一個檔案系統／行程執行環境放進 E2B Linux 沙盒。E2B 只提供沙盒生命週期與兩個基礎 OS 配接器；提供方無關的消費端在其上建置更高層能力。

| 包（package） | ctx 鍵 | 職責 |
|---|---|---|
| [`e2b`](e2b/README.md)（`@deepseek-ai/dsh-e2b`） | `ctx.e2b` | 建立一個沙盒，準備其工作目錄與執行時期目錄，公開共享 SDK 控制代碼，並在逾時或資源釋放時將其刪除 |
| [`fs-e2b`](fs-e2b/README.md)（`@deepseek-ai/dsh-fs-e2b`） | `ctx.fs` | 透過 E2B Filesystem API 實作檔案系統 seam |
| [`subprocess-e2b`](subprocess-e2b/README.md)（`@deepseek-ai/dsh-subprocess-e2b`） | `ctx.subprocess` | 透過 E2B Commands 與 PTY API 實作可執行文件尋找、受管行程組與 stdio、遠端 spill 文件及終端機工作階段 |

現有的 [`dsh-bash-local`](../shell/bash-local/README.md)、[`dsh-terminal-bash`](../terminal/terminal-bash/README.md) 和 [`dsh-lsp-stdio`](../lsp/lsp-stdio/README.md) 無需 E2B 專用 fork。它們把執行環境中的所有操作委託給 `ctx.fs` 和 `ctx.subprocess`，因此掛載這兩個 E2B 配接器後，它們所有涉及可變狀態的工作都發生在同一個沙盒內。

該邊界不會遷移 harness 行程、Cordis 對象、模型呼叫、agent（代理）／工作階段狀態、工作階段持久化、skill（技能）、更高層協定狀態或 E2B SDK 緩衝。[可移植執行世界決策](../../.agents/notes/implemented/architecture/2026-07-28-portable-execution-world-consumers.md)同時界定通用組合和此 POC 邊界。
