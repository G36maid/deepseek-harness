# Agent Note: 經由 pnpm/action-setup 提供 CI 的 pnpm

Status: implemented

[English](2026-07-26-pnpm-action-setup-for-symmetric-ci-caching.md) | [简体中文](2026-07-26-pnpm-action-setup-for-symmetric-ci-caching.zh.md) | 繁體中文

## 問題

除 `landlock-run.yml` 外，每個安裝 pnpm 的工作流程都曾用 `corepack enable` 手工提供 pnpm，其中五個還各自重複著一套手寫（hand-rolled）的快取設定——`pnpm store path --silent >> $GITHUB_OUTPUT`、再加上以 `pnpm-lock.yaml` 為快取鍵的 `actions/cache@v4`：`e2e.yml`、`docs-pages.yml`、`pi-ai-provider-e2e.yml`、`build-exe-for-python-sdk.yml`，以及 `ci.yml` 的 node-compat、serial-linux 與 benchmark 作業。與之等價、由官方維護的做法——`pnpm/action-setup@v4`（從 package.json 讀取 `packageManager`）加帶 `cache: pnpm` 的 `actions/setup-node`——當時已在倉庫內的 `landlock-run.yml` 中得到驗證，而 corepack 被從較新 Node 發行版中移除，使每一處 `corepack enable` 都成了已知的未來失效點。

## 決策

`pnpm/action-setup@v4` 是 CI 中提供 pnpm 的唯一機制：沒有任何工作流程執行 `corepack enable`。根目錄的 `@yarnpkg/cli-dist` 開發相依性另行提供 generated-project e2e 所執行的現代 Yarn CLI（命令列介面）；因此，用於套件管理員覆蓋率的 Yarn 不會沿用 runner 映像檔裡的 Yarn Classic。快取仍是疊加在 pnpm 提供機制上的按作業策略，保留三種有意採用的形態：

- **對稱快取**（既復原也保存）：帶 `cache: pnpm` 的 `actions/setup-node`——`e2e.yml`、`docs-pages.yml`、`pi-ai-provider-e2e.yml`、`build-exe-for-python-sdk.yml`，以及 `ci.yml` 的 node-compat 與兩個 benchmark 作業。larger-runner benchmark 透過條件化的 `cache:` 輸入讓 store 快取僅限 Linux；consolidated benchmark 在兩個平臺上都啟用快取。
- **只復原不上傳／生產者配對**（手寫的 `actions/cache` 步驟）：企業 runner 上的三個 PR（Pull Request）作業和基於 Wine 的必需 Windows 作業只復原不保存，把快取壓縮／上傳擋在它們的延遲敏感路徑之外——這種不對稱是 `setup-node` 的快取無法表達的。每個作業都在 action 可替換的安裝目錄之外設定 store，並解析該路徑，從而與 master 推送觸發的 serial-linux 生產者所用的路徑和精確鍵匹配；企業作業在自託管故障切換期間跳過復原，因為該 VM 的持久 store 已經預熱。
- **無快取或持久化**（不使用 store 快取 action）：獨立的原生 Windows 作業、原生 serial-windows 和 serial-macos，以及 `sandbox.yml` 均從冷 store 或 runner 本機 store 安裝。解壓縮含有大量文件的 pnpm store，成本高於在 Windows 上進行一次全新安裝；自託管熱備與故障切換作業則複用其 VM 的持久 pnpm store，不傳輸託管快取歸檔。

## 曾考慮的替代方案

- **保留手寫步驟。** 它們能用，但那是會各自漂移的設定樣板副本，而且對 corepack 的相依性是已知的未來失效點。
- **把企業作業的快取也轉換成 `cache: pnpm`。** 否決：只復原不上傳的不對稱是 `ci.yml` 註釋中有記錄的延遲決策；為統一工具而抹掉它，屬於顛倒優先級。
- **轉換 serial-linux 的 store 快取。** 實作期間否決：原提案曾把 serial-linux 計入對稱設定，但其快取步驟是企業作業只復原不上傳配對中的生產者一端——把它改成 `setup-node` 的鍵格式，等於換條路徑做了企業作業的轉換。
- **只轉換帶快取的工作流程，留下其餘出現 `corepack enable` 的位置。** 否決：提供 pnpm 與快取是可分離的關注點，在無快取作業裡留下 corepack 只會保留未來失效點和兩套並存的提供方式，毫無收益。
- **相依性 runner 映像檔自帶的 Yarn。** 否決：Corepack 移除後，託管映像檔提供的是 Yarn 1.22，而 generated-project e2e 要求 Yarn 2 或更高版本。鎖定版本的根開發相依性讓該項覆蓋率不再受 runner 映像檔內容影響。
- **用一個組合 action 包裝 action-setup + setup-node。** 暫不採納：剩餘的按作業差異（node 版本矩陣、按平臺的條件快取、只復原不上傳配對）是刻意採用的策略而非樣板——包裝層要麼不得不增加與這些差異一一對應的輸入，要麼抹平一處真實的不對稱，而兩行的組合已接近下限。

## 後果

- corepack 相依性已從 CI 中徹底消失；pnpm 在所有工作流程中都經由 pnpm 團隊的官方 action 提供，版本鎖定繼續單一來源於 `package.json` 的 `packageManager` 欄位。
- generated-project e2e 執行根目錄鎖定的 Yarn 4 CLI，既不再沿用 runner 映像檔中的 Yarn 版本，也不會因此悄然跳過。
- 已轉換泳道的快取鍵格式變更了一次；各跑一次冷執行重建快取後，命中率與舊步驟持平。內建快取鍵涵蓋平臺、架構與鎖定檔雜湊，但不含 Node 版本，因此 node-compat 的各個矩陣任務共享同一條 store 快取記錄——這是安全的，因為 pnpm store 與 Node 版本無關。
- `setup-node` 內建的 pnpm 快取只按精確鍵復原，沒有 `restore-keys` 前綴回退：`pnpm-lock.yaml` 一旦變更，已轉換泳道會從冷 store 起步，而不是利用上一條快取記錄預填充。
- `pnpm/action-setup` 每次執行都會刪除其安裝目錄，並把默認 store 放在由此產生的 `PNPM_HOME` 下。因此，需要快取配對或自託管持久化的 Linux 作業會把 `PNPM_CONFIG_STORE_DIR` 設為 `$HOME/.local/share/pnpm/store`，置於 action 目錄之外；只復原不上傳的作業與 serial-linux 會解析並共享這一穩定路徑及精確鍵。
