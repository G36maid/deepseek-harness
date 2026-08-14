# Agent Note: PowerShell 執行器與 pwsh 工具

Status: implemented

[English](2026-08-01-pwsh-tool-and-executor.md) | [简体中文](2026-08-01-pwsh-tool-and-executor.zh.md) | 繁體中文

## 問題

harness 在每個平臺只說一種 shell 方言：`bash`。Windows 主機只能透過 WSL 或 Git-Bash 墊片執行它，而交付的 `dsh-bash-local` 執行器僅限 POSIX（硬編碼 `bash`，行程組語義是 POSIX 的）。Windows 路線圖——讓主機默認 `pwsh`，之後再做 pwsh TUI/GUI 渲染——沒有執行基礎：既沒有 bash 執行器 seam 的 PowerShell 實作，也沒有教模型 PowerShell 方言的面向模型工具。bash 工具也大於 Windows 優先畫像的嚴格所需——尤其持久 PTY 孿生是 `pwsh` 工具至今仍不背負的 bash 形狀表面。最初的最小畫像也沒有背景工作與沙盒升級：後臺隨 [parity 決策](2026-08-02-pwsh-tool-bash-parity.md) 到來，沙盒面（拒絕渲染加 `sandbox_permissions` 升級）隨 [Windows ACL sandbox 決策](2026-08-08-windows-acl-restricted-token-sandbox.md) 到來——最小工具當初按 danger-full-access 的 Windows 姿態裁剪，這一前提在 sandbox PR（Pull Request）於 Windows 上重新啟用隔離與審批時終結。

## 決策

在 `packages/shell/` 下新增兩個包：

- **`@deepseek-ai/dsh-pwsh-local`** —— `ctx.shell` 執行器 seam 的本機實作，基於 `ctx.subprocess`，逐呼叫映像檔 `dsh-bash-local`：`resolve()` 從設定默認化並設上限，`run()` 透過一個 deadline 融合設定夾取的逾時與呼叫方訊號，`start()` 返回消費式後臺控制代碼，其行程歸屬於 subprocess 服務。命令字串作為單個 argv 參數傳給 `pwsh -NoLogo -NoProfile -NonInteractive -Command`，由 PowerShell 解析，不存在 shell 引號層。可執行文件解析（`resolvePwshPath`）是 `(configured, env, platform)` 的純函式：先顯式設定，再在 Windows 上探測 PowerShell 7 安裝位置、PATH 條目（剝離引號）與 Windows PowerShell 5.1，否則返回裸命令名 `pwsh`，交由行程啟動時按 PATH 解析。
- **`@deepseek-ai/dsh-tool-pwsh`** —— 基於 `ctx.shell` 的面向模型工具，約定是 PowerShell 方言，逐呼叫映像檔 `dsh-tool-bash`：經通用任務執行時期執行前臺與 `run_in_background`，經共享 [`dsh-shell-env`](../feature/2026-08-02-pwsh-tool-bash-parity.md) 登錄檔管理 `DSH_*` 環境，bash 的 marker/截斷渲染機制（乾淨退出不產生 marker），以及——自 Windows ACL sandbox 決策以來——沙盒拒絕渲染與 `sandbox_permissions` 升級面，外加工具描述中的 Windows 專屬 ConstrainedLanguage 與命名管道約定。parity 決策取代了本 Agent Note 的最小畫像工具描述。

Windows vitest 覆蓋率刻意不屬本次改動：倉庫的 Windows CI 通道負責建置/靜態閘門，單元覆蓋在 Linux 上執行，兩個包的套件在那裡以真實 `pwsh` 執行（GitHub 託管 runner 預裝）或缺失時自行跳過。vitest 的 `windowsUnsupportedPackages` 排除從 `packages/shell/*` 收窄為真正需要 bash 的包，使 pwsh 套件也能在 Windows 開發機上原生執行。

本決策之後的路線圖——讓 Windows 主機默認 `pwsh`（關閉 bash）與 pwsh TUI/GUI 渲染——已另行記錄為 [Windows 默認 pwsh 決策](2026-08-01-windows-pwsh-default.md)。

## 備選方案

**給 `dsh-bash-local` 增加 pwsh 模式。** 否決：執行器的身份就是它 spawn 的 shell；在一個包內塞第二種方言會翻倍設定面（`shell` 開關）與測試矩陣，且兩種方言的怪癖（Windows 上的訊號資訊、引號域）應各自歸入自己包的文件。

**給 `dsh-tool-bash` 增加方言參數。** 否決：模型可見約定本身就是方言（路徑、變數、退出事實都不同），因此方言參數要麼讓 schema 隨條件變化，要麼逼一個工具教兩種方言；獨立的孿生讓模型約定保持誠實——並以映像檔而非共享實作的方式攜帶共享表面（後臺、沙盒、渲染）。

**現在就接入交付的 CLI（命令列介面）組合。** 否決：在 Windows 默認決策落地前把 `tool-pwsh` + `pwsh-local` 掛進 `base.cordis.yml` 會改變交付清單；本改動交付能力與接線點（`apps/cli` 相依性、tsconfig 工程），不切換任何默認。

## 後果

- bash 執行器 seam 有了第二個、Windows 原生的實作，請求/規範約定一致，因此 `tool-pwsh` 之外的面向模型消費端（掛鉤橋、行程內外掛程式）無需方言墊片即可執行 PowerShell。
- `tool-pwsh` 是模型可見的 Windows 優先 shell 工具：在前臺、後臺與沙盒化工作上與 bash 工具行為可互換——包括經 `ctx.approval` 的同輪次 `sandbox_permissions` 升級——提示詞指導精確陳述 marker 約定、沙盒拒絕/升級詞彙，以及 ConstrainedLanguage 與命名管道邊界。
- Windows 語義在平臺差異處不同：強制終止報告退出碼 1 且無訊號（因此 `signal`/`killed` 狀態資訊僅限 POSIX），PowerShell 輸出 CRLF，測試做歸一化。
- CLI 增加兩個 workspace 相依性與兩個 tsconfig 工程，但不掛載任一外掛程式——組合決策留給 Windows 默認提案。
