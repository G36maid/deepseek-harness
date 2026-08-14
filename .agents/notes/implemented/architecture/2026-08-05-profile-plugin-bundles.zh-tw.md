# Agent Note: profile 外掛程式組合包取代固定的表層 overlay

Status: implemented

[English](2026-08-05-profile-plugin-bundles.md) | [简体中文](2026-08-05-profile-plugin-bundles.zh.md) | 繁體中文

## Problem

`dsh` 啟動器硬編碼了自己的組合：`base.cordis.yml` + `web.cordis.yml` 隨 `apps/cli` 一起交付，三種各自訂製的入口模式（`--config`、`web`、`-p`）各帶一套層棧，外加一個全域性的個人 overlay（`$DSH_HOME/config.yaml`）。想把樹外外掛程式（一個 TUI、一個提供方擴充包）裝進已交付的表層，只能修改倉庫；第三方包也沒有任何位置可以貢獻默認組合。

## Decision

一切都變成 **profile**：即目錄 `$DSH_HOME/profiles/<name>`，其中包含一個 `package.json`（pnpm 管理的樹外外掛程式 `dependencies`，加上 profile manifest `dsh.profile` 及其有序的 `bundles` 層清單）和一份使用者 `cordis.patch.yml`。**組合包**（bundle）是聲明瞭 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 的 npm 包；兩種 manifest 分別位於互不相同的 `dsh.profile` / `dsh.bundle` 鍵下，因此一份 package.json 能說明自己扮演哪種角色。設定樹在空的根之上組合：按 `dsh.profile.bundles` 順序應用每個組合包的 patch，然後是使用者層與 `--patch` overlay——啟動與 `--dump-config` 共享同一條 `applyEntryPatches` 路徑。隨後，[應用持有命令列的決策](2026-08-06-app-owned-command-line.md)又把呼叫期取值從啟動器派生的 patch 遷移到了啟動服務。

隨附的組合包是 `@deepseek-ai/dsh-base`（共享核心設定行）、`@deepseek-ai/dsh-web-app`（瀏覽器 Host 設定行與 Web 執行時期粘合層）和 `@deepseek-ai/dsh-headless`（直接疊加在 base 上且不含 web-app 的一次性 runner）。通用的 `dsh --profile <name>` 把剩餘參數交給該 profile 的命令列啟動行：Web 持有自己的 flag ，headless 則持有任務位置參數。patch overlay 使用啟動器持有的 `--patch`。`dsh plugin --profile <name> <args...>` 是一層薄薄的 pnpm 轉發器，負責初始化 profile，並依據已安裝檔的組合包聲明調和 `dsh.profile.bundles`；沒有組合包聲明的包保持為普通相依性。[Headless 作為直接 core 入口](2026-08-09-headless-direct-core-entry-point.md)負責 headless 組合約定。

解析在構造上就是雙錨點的：`dsh.profile.bundles` 中的名稱先從 dsh 安裝目錄解析，再從 profile 目錄解析——因此內建組合包始終來自與執行中 `dsh` 相同的安裝，pnpm 從不管理它們——而 patch 行中的裸外掛程式名稱經 profile 目錄的 Node 父目錄逐級尋找，落到受維護的扁平回退目錄 `$DSH_HOME/profiles/node_modules`（安裝目錄的應用與各組合包所相依性的每個包各一個符號連結，每次啟動時修復）。

兩項配套重構：webserver 內建的靜態 dist 服務改為單一所有者的**回退席位**（`registerFallback`／`applyIndexTaps`），SPA 伺服器提取到 `@deepseek-ai/dsh-host-frontend-static`，使 web 組合包以組合的方式持有自己的 dist，而不是靠啟動器程式碼；[dsh CLI 個人設定決策](../feature/2026-07-20-dsh-cli-personal-config.md)的個人 overlay 機制（`loadPersonalPatches`、`$DSH_HOME/config.yaml`）改為面向逐 profile 與 home 級的 `cordis.patch.yml` 層（`loadOptionalPatches`、接受檔名的 `watchUserPatches`），取代該筆記的各入口模式與文件位置，同時保留其 Harness home 根目錄、patch 語義與響亮失敗的解析。

## Alternatives considered

- **相依性掃描加部分 `patchOrder`**（最初的草案）：掃描 `dependencies` 找出組合包、未列出者按字母序排列，會產生兩個真源和一條隱式決勝規則；一份顯式有序的 `dsh.profile.bundles` 清單更小、完全確定。在 profile 內直接 `pnpm add` 只會安裝一個庫，不啟用任何 patch——行為顯式，沒有暗中掃描。
- **內建組合包使用 `link:` 條目**：pnpm 無法對指向安裝目錄的 `link:` 做版本管理、安裝或更新，它會把機器路徑嵌進使用者文件，並且在安裝目錄移動後失效。雙錨點解析加上每次啟動修復的符號連結回退提供了同樣的保證（「組合包來自安裝目錄」），且沒有這些繁文縟節。
- **在組合包 manifest 中放一個啟動前 `context` 模組**承載啟動期取值（dist 路徑、flag 事實）：否決，改用純外掛程式——粘合邏輯就是普通設定行和由應用持有的啟動服務，因此組合始終可完整 dump，manifest 保持純資料。啟動器提供的宿主 slot（`ctx.cmdlineArgs`、`ctx.appExit` 與環境快照）在任何設定樹條目掛載之前，於 `boot()` 的 `prepare` 掛鉤中提供。
- **組合包的傳遞式自動應用**：只有直接列在 `dsh.profile.bundles` 中的條目才貢獻層；想重新匯出另一個組合包 patch 的元組合包，必須在自己的 patch 文件中顯式完成。

## Consequences

- 新的組合表層（TUI、提供方擴充包）以普通 npm 包形式交付，可按 profile 安裝；倉庫不再需要為每種部署形態各留一行。
- `apps/cli` 收縮為 argv 解析、profile 機制的消費端和 pnpm 轉發器；`AppCLIEntry` 與各表層專屬的啟動路徑全部移除。
- 無金鑰 web e2e 腳手架以與生產相同的空根形態啟動相同的組合包層，包括 profiles 模組回退，因此測試與產品之間的組合漂移會響亮失敗。
- 後端不拒絕磁碟上的任何舊格式（發布前姿態）：`$DSH_HOME/config.yaml` 只是不再被讀取。
