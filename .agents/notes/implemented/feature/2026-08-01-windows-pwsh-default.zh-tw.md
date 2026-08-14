# Agent Note: Windows 默認改用 pwsh

Status: implemented

[English](2026-08-01-windows-pwsh-default.md) | [简体中文](2026-08-01-windows-pwsh-default.zh.md) | 繁體中文

## 問題

harness 交付的執行畫像在每個平臺都是 bash 優先。Windows 主機必須安裝 bash 墊片（WSL 或 Git-Bash），或退回到僅 POSIX 的 `dsh-bash-local` 行為（硬編碼 `bash -c` argv、行程組語義）；面向模型的 bash 工具教的是 bash 方言。Windows 原生基礎已隨 [pwsh 執行器與工具決策](2026-08-01-pwsh-tool-and-executor.md) 交付——`ctx.shell` seam 的 PowerShell 實作與對等的 `pwsh` 工具——但交付組合在 Windows 上仍然掛載 bash 棧，沒有墊片的 Windows 主機跑不了交付的 shell。

## 決策

啟動交付 profile（`dsh web`、`dsh --profile headless`、一次性任務）的 Windows 主機默認獲得 PowerShell 棧；POSIX 主機不變。

- **base patch 在自身行上按平臺門控兩個 shell 棧**（[loader `disabled` 插值](../architecture/2026-08-11-loader-entry-disabled-interpolation.md) note 記錄了該機制與平臺層摺疊）：`bash-sandbox`/`tool-bash` 攜帶 `disabled: !!js process.platform === 'win32'`（bash 沒有 Windows runner），它們的孿生行 `pwsh-sandbox`/`tool-pwsh` 以取反的表達式僅在 win32 掛載——同一份 patch 文件，每個宿主恰好掛載一個 shell 棧。受限 pwsh 棧執行在 ACL 受限權杖 runner 之上，權限面與 POSIX 完全一致（[Windows ACL 受限權杖沙盒](2026-08-08-windows-acl-restricted-token-sandbox.md) note 擁有該清單）。覆蓋交付默認是組合決策：偏好 bash 棧或不限權 pwsh 執行器的 Windows 主機透過其 profile 或 home 的 `cordis.patch.yml` 覆蓋這些行（bash 復原配方必須完整：停用 `pwsh-sandbox`/`tool-pwsh` 並重新啟用 `bash-sandbox`/`tool-bash`——兩個執行器家族註冊同一個 `bash` 服務，配方不完整會在載入時 fail loud）——組合設定是唯一的覆蓋通道。獨立的 `windows.cordis.patch.yml` 層與啟動器的 `apps/cli/src/windows-shell.ts` 注入已刪除；該層只因條目元資料是靜態的而存在。
- **冷啟動的模組解析已復原。** profiles 重構把 pwsh 包從 `apps/cli` 的相依性閉包中刪掉了，`healProfilesModuleFallback` 因此從未把它們連結進 `$DSH_HOME/profiles/node_modules`，新 Windows 主機解析不到 pwsh 行。`apps/cli` 與 `dsh-base` 聲明 `dsh-pwsh-sandbox`/`dsh-tool-pwsh`，執行器的相依性鏈提供 `dsh-pwsh-local`；按倉庫慣例，base bundle 把每個行外掛程式都列為相依性。

pwsh GUI 渲染已隨 [pwsh UI 呈現與 bash 對齊決策](2026-08-05-pwsh-ui-bash-parity.md) 先行交付；[pwsh 工具與 bash 對齊決策](2026-08-02-pwsh-tool-bash-parity.md) 交付了工具表面。本決策不改變任何 POSIX 行為。

## 備選方案

**在 `dsh-bash-local` 內部讓 Windows 默認 pwsh（一個執行器，方言開關）。** 否決，理由與執行器決策否決模式開關相同：執行器的身份就是它 spawn 的 shell，而按平臺門控的組合是部署選擇，不是執行器設定。

**從 `apps/cli` 程式碼而非 bundle 資料文件交付平臺層。** 否決：patch 應放在它替換的行旁邊、屬於擁有這些行的 bundle，讓交付清單作為組合資料保持可見、轉儲帶有出處；啟動器只貢獻 win32 門控。

**在 Windows 沒有隔離 runner 時保留 `permission`/`ui-permission`。** 最初交付時否決：`dsh-permission-presets` 硬性要求 `ctx.shell.sandboxMode`，並在不限權執行器上載入時 fail loud。後續的 ACL runner 消除了該前提，因此當前清單保留這兩行。

**在 Windows 沒有 OS runner 時保留 fs 路徑規則限制。** 最初交付時否決：不限權 shell 可以繞過僅限 fs 的路徑規則。當前 ACL runner 用同一策略約束 shell 與 fs 提供方，因此這項被否決的半邊界已不是當前交付形態。

**交付 `DSH_WINDOWS_SHELL` 環境變數逃生門。** 否決：決定性的行為變更應集中在組合設定中，而組合設定已能按行 id 覆蓋平臺層；第二條覆蓋通道會分裂清單決策的單一事實來源。

## 後果

- 執行交付版 `dsh` 表面的 Windows 主機無需設定即獲得受限 `pwsh` 作為 shell 工具、PowerShell 作為 `ctx.shell` 執行器；那裡的模型可見清單中沒有 `bash`。在 Web 表面，shell 工具行來自工作階段的預設（[loader `disabled` 插值](../architecture/2026-08-11-loader-entry-disabled-interpolation.md) note 擁有 one-plane 機制）：每個 shipped 預設聲明 `tool-pwsh`（以 `process.platform !== 'win32'` 門控）及其孿生行 `tool-bash`（取反表達式），因此預設層每臺宿主恰好暴露一個 shell 工具。
- Windows 命令與 fs 操作共用沙盒策略、權限切換器和 approval 服務。ACL runner 限制寫入，但報告 `enforcement: 'partial'`；顯式的 `danger-full-access` 仍是獲準的繞過方式，而非平臺默認。
- POSIX 主機如常掛載 bash 棧；pwsh 行以其自身的門控表達式處於停用狀態——同一份共享 patch 文件列出兩個棧，每個行自己決定掛載。
- 偏好 bash 棧的 Windows 主機（例如 PATH 上有 WSL/Git-Bash 時）透過其 profile 或 home 的 `cordis.patch.yml` 覆蓋交付行——停用 `pwsh-sandbox`/`tool-pwsh` 並重新啟用 `bash-sandbox`/`tool-bash`（兩個執行器註冊同一個 `bash` 服務，配方不完整會在載入時 fail loud）——組合設定是唯一的覆蓋通道。

## 驗證

- 單元：`apps/cli/tests/windows-shell.spec.ts` 透過啟動所用的 patch 演算法組合真實交付的 bundle 層（從應用安裝解析的 dsh-base + dsh-web-app），固定每個平臺的有效清單——win32 pwsh 清單、POSIX bash 清單與 base-only profile——外加預設級 shell 工具門控（`tool-bash`/`tool-pwsh`）與冷啟動解析閉包；`packages/bundle/base/tests/base.spec.ts` 固定四個 shell 行的對稱 `!!js` 平臺門控，並斷言不再交付獨立的平臺 patch。
- Keyless：`dsh --profile <name> --dump-config` 在同一份共享 patch 層中顯示兩個棧，每個行以自己的 `disabled` 表達式在掛載時決定清單。
- 真實組合冒煙在 win32 上啟動 web profile，pwsh 棧掛載成功（即本筆記描述的確切清單）。
