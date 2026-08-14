# Agent Note: 在 bash seam 上支持 stdin 與額外 env

Status: implemented

[English](2026-06-30-bash-stdin-env-trusted-plugin-api.md) | [简体中文](2026-06-30-bash-stdin-env-trusted-plugin-api.zh.md) | 繁體中文

## 問題

掛鉤子系統以 Claude Code 和 Codex 的方式執行外部掛鉤命令：掛鉤是一條 shell 命令，透過 **stdin 上的 JSON** 接收事件載荷，並從若干**環境變數**（`CLAUDE_PROJECT_DIR`、`CLAUDE_PLUGIN_ROOT`、`PLUGIN_ROOT`……）讀取上下文。harness 已經在 `ctx.shell` 能力 seam 後面有一個完善的命令執行器（[dsh-shell](../../../../packages/shell/shell) → [dsh-bash-local](../../../../packages/shell/bash-local)），具備行程組終止、輸出截斷/spill 處理和憑證擦除功能。複用它來執行掛鉤意味著掛鉤橋接層無需重新實作子行程底層機制——但該 seam 此前無法寫入 stdin 或設定額外 env。本次變更新增這兩個輸入。

`stdin` 和 `env` 不構成新的模型能力，因為普通 shell 文法已經能提供兩者。環境憑證由 `dsh-bash-local` 的子環境擦除機制保護，而非靠隱藏這些 Service Definition 欄位；模型工具參數是靜態 JSON，不會展開 shell 變數。因此這些欄位服務於受信的行程內呼叫方（如掛鉤橋接層），它們需要傳遞結構化輸入和 `CLAUDE_*` 變數，而不必將其嵌入模型可見的 shell 文字。環境變數規則見 [defensive-patterns.md](../../../../docs/defensive-patterns.md)。

## 決策

在 `ShellExecRequest`（模型/外掛程式側請求）和 `ShellExecSpec`（`run`/`start` 所作用的已解析 spec）上**同時**新增 `stdin?: string` 與 `env?: Record<string, string>`，並在 `dsh-bash-local` 中貫穿它們：`resolve()` 原樣傳遞，`run()`/`start()` 將其傳給 `runBash`，後者把位元組寫入子行程的 stdin 並合併額外 env。

三個有意為之的選擇：

1. **模型側工具不暴露 `stdin` 和 `env`。** Shell 文法已覆蓋這些需求，重複參數只會增加介面面而不帶來權限隔離。工具僅從聲明的模型參數、signal 和 owner 建置請求；受信的行程內呼叫方可以直接設定請求欄位。harness 自有變數使用[託管環境決策](../feature/2026-07-10-agent-session-identity-and-log-location.md)規定的獨立 `dshEnv` 通道，因此普通 `env` 無法替換它們。

2. **`env` 在憑證擦除之後合併，因此呼叫方顯式設定的條目即使具有憑證形態的名稱也會勝出。** 後續的託管命名空間決策負責管理 `DSH_*`：這類環境條目會被移除，受信的 `dshEnv` 最後合併，因此普通 `env` 條目永遠無法頂掉託管值。完整順序為 `scrub(process.env, including DSH_*)` → `ENV_OVERRIDES` → 普通 `env` → `dshEnv`。

3. **`stdin`/`env` 在已解析 spec 上是 required-absent-OK（普通 optional），而非像 `owner` 那樣 required-but-nullable。** `owner` 之所以是 required-but-nullable，是因為*靜默*缺失的 owner 會產生一個無主、跨工作階段可讀的任務——一個安全隱患，顯式的 `undefined` 可以防範。`stdin`/`env` 沒有這種風險：缺失意味著「無 stdin / 無額外 env」，這是安全的常規情況（所有模型驅動的呼叫都如此）。因此它們保持普通 optional，與 `signal` 一致。

`dsh-bash-local` 僅在有位元組需要寫入時才建立 stdin 管道；否則 fd 0 仍為 `/dev/null`，保持先前行為。它寫入位元組後關閉管道。子行程未讀取即退出時產生的 `EPIPE` 被忽略，因為命令退出碼和輸出決定結果。

## 曾考慮的替代方案

**可設定的環境祕密擦除。** 否決，屬於推測性需求。受信呼叫方可以在擦除之後顯式提供所需值，無需削弱默認的環境保護。

## 後果

掛鉤橋接層透過既有的 bash seam 傳遞 JSON 載荷和掛鉤特定變數，保留其行程組終止、截斷和 spill 行為。面向模型的行為不變，bash 工具仍是模型呼叫請求建置的唯一所有者。相關詞彙定義見 [bash 資料結構參考](../../../../docs/subsystems/shell.md)。
