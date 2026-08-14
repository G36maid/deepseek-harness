# @deepseek-ai/dsh-pwsh-sandbox

[English](README.md) | 繁體中文

沙盒消費型的 [`ctx.shell` 執行器 seam](../shell/) 的 PowerShell 實作：每條命令以 `pwsh -NoLogo -NoProfile -NonInteractive -Command <command>` 執行，**經 `ctx.sandbox` 隔離**，選定模式、強制完整性、拒絕事實都蓋在每次結帳的結果上。它是 [`@deepseek-ai/dsh-bash-sandbox`](../bash-sandbox/) 的 pwsh 孿生，按 [pwsh 執行器與工具決策](../../../.agents/notes/implemented/feature/2026-08-01-pwsh-tool-and-executor.md) 逐呼叫映像檔——隔離實體本身是平臺無關的：Windows 上沙盒 seam 解析到 ACL 受限權杖 runner 鏈（[`@deepseek-ai/dsh-sandbox-windows-acl`](../../sandbox/sandbox-windows-acl/)），Linux/macOS 上解析到 bwrap/Landlock/Seatbelt。

執行器繼承 [`@deepseek-ai/dsh-pwsh-local`](../pwsh-local/) 的行程機制，並消費其 argv 級 seam（`argv()` / `runArgv()` / `startArgv()` / `onProcessDone()`）把精確的 pwsh 呼叫經 provider 包裝。沙盒策略（模式 + 工作區根目錄）不是本包的設定：每次呼叫由 `ctx.sandboxPolicy` 隨行（工具層傳呼叫工作階段解析後的策略；直接呼叫回退到部署策略）。

## 行為

- `danger-full-access`：命令經本機執行器原樣執行；結果攜帶 `sandbox: { mode, denied: false }`。
- 受限模式（`read-only`、`workspace-write`）：pwsh argv 由 `ctx.sandbox.confine()` 包裝；runner 啟動失敗按 fail-closed 拋 `SANDBOX_UNAVAILABLE`（前臺拋錯、後臺記 `runnerFailed` 事實），被拒絕的寫按所選後端的 `denialSignatures` 分類為 `sandbox.denied`。

## 模型體驗

### 隔離生效，拒絕以命令失敗呈現

#### 模型看到什麼

受限命令自身的 stderr（Windows ACL runner 下如 `Access to the path '...' is denied.`）；工具層把分類後的拒絕轉成標準權限拒絕面，與 bash 工具完全一致。

#### Token 影響

除命令 stderr 與工具層標準拒絕面外，無額外模型可見文字。

#### KV Cache 影響

無直接影響；拒絕呈現面屬於工具層。

## 已知限制與後續工作

- **Windows 上讀不受限**（ACL runner 只限寫）；讀邊界文件在 `@deepseek-ai/dsh-sandbox-windows-acl`。
- **Windows workspace-write 的臨時權限按每個活躍的工作階段/工作區對私有**；無 agent（代理）的呼叫每次都獲得一個新的私有目錄。環境臨時根目錄絕不會被授權，runner 會在 spawn 前將 TMP/TEMP 重寫為該私有目錄。
- **Windows read-only 不授予任何顯式可寫根目錄，但仍為部分強制執行**，因為受限權杖必須保留 Everyone。DACL 向 Everyone 授予寫訪問的對象——包括以相容方式打開的 NUL 設備——仍構成環境權限來源；PowerShell 的 `> $null` 重定向仍可工作，且不會打開 NUL。
