# Agent Note: CI 故障切換手冊 — 託管池 → 自有池

Status: implemented

[English](2026-07-26-ci-failover-runbook.md) | [简体中文](2026-07-26-ci-failover-runbook.zh.md) | 繁體中文

## 問題

[CI](../../../../.github/workflows/ci.yml) 中三個必需的 Linux 工作作業（`node 24 / static`、`node 24 / coverage`、`node 24 / snapshots and artifacts`）執行在託管的企業級 32 核池上；聚合它們的必需判定作業（`all checks passed`）執行在標準 `ubuntu-latest` 上；獨立的原生 Windows 作業（`windows node 24 / native complete`）執行在託管的 `dsh-windows-2025-16core` 大型執行器上。當企業池發生故障——作業無限排隊或企業標籤消失——所有開啟的Pull Request都無法合併，而"合併一個修復"這一常規復原手段本身正被那些無法執行的必需檢查死結。**適用範圍：兩個獨立開關，每個平臺一個。**`DSH_CI_FAILOVER_LINUX` 復原企業級 Linux 池故障（三個必需的 Linux 工作作業加 `all checks passed` 判定作業）；`DSH_CI_FAILOVER_WINDOWS` 復原託管 Windows 池故障（原生 Windows 作業）。Linux 池故障無需重定向原生 Windows 作業，反之亦然。判定作業的其餘必需相依性（`node-compat`、`python-sdk`、`windows`）按設計留在標準託管執行器上（可移植邊界）；若更大範圍的 GitHub 託管容量故障連標準池一並擊倒，這些相依性仍會阻塞 `all checks passed`。因此故障需要一個任何具備倉庫寫權限的回應者都能在不合併任何程式碼的情況下觸發的開關。

## 決策

三個必需的 Linux 工作作業、獨立的原生 Windows 作業，以及 `all checks passed` 判定作業（若不隨切換，即使全部工作作業透過，它仍會滯留在故障池的佇列中）——各自透過倉庫變數解析執行器池，且開關按平臺拆分，使一個平臺的故障不會重定向另一個平臺。三個 Linux 工作作業與 `all checks passed` 判定作業（其 `needs` 是必需的 Linux 工作作業，且執行在 `vm-backup` 池上）透過 `DSH_CI_FAILOVER_LINUX` 解析；原生 Windows 作業透過 `DSH_CI_FAILOVER_WINDOWS` 解析。變數不存在（正常）時它們執行在託管企業池上；由任何具備寫權限的協作者設為 `selfhosted` 時，對應作業切換到公司自有的自託管池：`DSH_CI_FAILOVER_LINUX` 下，Linux 作業與判定作業切到 `vm-backup` 池，覆蓋率與快照的並行降到共享虛擬機器上限，並跳過託管路徑的 pnpm 快取復原；`DSH_CI_FAILOVER_WINDOWS` 下，原生 Windows 作業切到 `dsh-win-ci` 池。每個開關都是寫者可管理的倉庫狀態而非一次合併，因此在所有檢查都是紅色時仍然有效。自有池的就緒狀態由 `serial / linux (self-hosted standby)` 與 `serial / windows (self-hosted standby)` 通道持續驗證——每次 master 推送都在其上執行完整的未區塊聚合流程。

`ci.yml` 只豁免一個事件不做取消（`${{ github.event_name != 'push' }}`），因此一次 master 推送不會取消上一次推送留下的、仍在執行的演練。每次演練以單閘門工作行程執行完整的未區塊聚合流程，耗時長於 master 合併的間隔；在無條件取消下，演練會在得出結論前被後續執行取代，該通道無法產出供回應者查看的就緒證據。

這項豁免比「演練總能跑完」要窄，有兩點限制。其一，GitHub 每個組只保留一個待執行條目，更新的待執行條目會頂掉更早的，繁忙時段中間的推送執行仍會以 `cancelled` 結束。其二，該表達式是針對**新觸發的執行**求值的，因此自身事件不是 `push` 的執行——例如在 master 上派發的基準測試，與演練共用 `CI-<ref>` 組——求值為 `true`，會取消正在執行中的演練。這屬於罕見的手動操作，且下一次 master 推送即可復原證據，因此不值得為它再加機制。這項豁免換來的是該通道**週期性**地得出結論，而這正是它能作為證據的前提。

這個決定必須放在工作流程級：取消作用於被取代的整個執行，作業級 `concurrency` 組並不能豁免其所屬作業。採用否定式寫法而非僅指名 `pull_request`，是有實質作用的：後者會連 `workflow_dispatch` 一起停止取消，而每次執行器基準測試會在 master 上的同一並行組內同時佔用 12 臺大規格執行器、最長 15 分鐘，屆時重複派發會排在演練之前，而不是替換掉已過時的測量。成本之所以可控，是因為一次 master 推送只承載 `wine-apt-cache` 和這兩條演練；其餘作業都受Pull Request門控、`workflow_dispatch` 門控或 `if: false`，並且 `scripts/ci-workflow.spec.ts` 會鎖定這個集合——按條件精確匹配，因為否定式事件判斷會包含它所排除的事件名——使新的推送可達作業無法悄悄開始累積未取消的執行。

### 自有池是什麼

`vm-backup`：一臺 64 核虛擬機器，6 個常駐 systemd 管理的執行器實例。其映像檔必須預裝 Playwright Chromium 的 Linux 系統套件；CI 會下載鎖定檔選定的瀏覽器，但絕不在這臺持久化共享主機上執行 `apt`。切換前先看 `serial / linux (self-hosted standby)` 最近一次執行：其聚合流程包含瀏覽器重播，因此綠色熱備同時驗證常規容量和這項瀏覽器先決條件。

#### Windows 池

`dsh-win-ci`：公司內部 Windows CI 伺服器（一臺 96 核 / 580 GB 機器）上 32 個常駐執行器實例（計畫任務 `GH-Runner-01`…`GH-Runner-32`）。標籤：`[self-hosted, dsh-win-ci, windows]`。映像檔必須預裝 Node 24、pnpm、Git（Git Bash 在 `PATH` 上，即 `C:\Program Files\Git\bin`——`bash` 工具按名稱 spawn `bash`）、PowerShell 7，並為符號連結支持啟用開發人員模式。切換前先看 `serial / windows (self-hosted standby)` 最近一次執行：綠色熱備驗證該池能端到端執行 `check:ci:windows-complete`。

### 切換步驟（任何具備寫權限的協作者，約 1 分鐘，無需合併）

兩個開關相互獨立：只切換發生故障的那個平臺。

1. 倉庫 **Settings → Secrets and variables → Actions → Variables → New repository variable**：名稱 `DSH_CI_FAILOVER_LINUX`（Linux 池故障）或 `DSH_CI_FAILOVER_WINDOWS`（Windows 池故障），值 `selfhosted`。
2. 重新觸發必需作業，使其重新解析執行器池。已經為託管標籤**排隊**的作業不會重定向，也無法原地 re-run，因此對於本手冊所述的無限排隊故障，應取消卡住的執行並 re-run all jobs，或推送一個新提交；“Re-run failed jobs”只有在作業真正失敗（而非仍在排隊）時纔有用。
3. 切換到此完成。Linux 故障切換狀態下工作流程還會自動：把 `DSH_COVERAGE_MAX_WORKERS` 降為 8、`DSH_SNAPSHOT_MAX_CONCURRENCY` 降為 12（按 6 個常駐實例定容：最壞情況下，6 × 8 = 48 個覆蓋率工作行程執行在 64 核虛擬機器上）（共享虛擬機器的爭搶上限），並跳過託管路徑的 pnpm 快取復原（虛擬機器的持久 store 直接提供熱安裝）。Windows 開關沒有這類並行或快取分支；它只重定向原生 Windows 作業的執行器池。

#**Dependabot 例外。**兩個開關的選擇器都刻意排除了 `dependabot[bot]`：故障切換期間，Dependabot Pull Request繼續在託管池排隊，而不是把相依套件提供的程式碼放到持久化虛擬機器上執行。故障期間 Dependabot PR 持續排隊是預期行為而非切換失敗；託管池復原後它會自行完成。

**誰能扳動這個變數。**GitHub 的 API 允許任何具有寫權限的協作者管理倉庫變數，因此每個開關實際是寫者級而非嚴格的管理員級。在本倉庫的信任模型下這並不構成升權：runner group 接納本私有、禁 fork 倉庫的全部工作流程（這是讓 PR 引用的故障切換得以成立的刻意取捨），因此任何寫者本就可以透過推送分支工作流程觸達這臺虛擬機器。抵禦不可信程式碼的邊界是倉庫成員資格；變數只是為成員路由工作。

## 切換期間的容量

6 個常駐實例可承接正常 PR 流量（該池平時唯一的穩態負載是每次 master 推送一個序列熱備作業，故障切換時幾乎全池可用）。若仍出現排隊，用組織級註冊 token（組織 Settings → Actions → Runners → New runner）追加註冊實例。複製現有 runner 目錄時**必須排除身份文件**——`rsync -a --exclude '.runner*' --exclude '.credentials*' --exclude '_diag' --exclude '_work' <src>/ <dst>/`（通配同時排除 `.runner_migrated`/`.credentials_migrated`——GitHub 會在遷移過的執行器上寫入這些文件，它們同樣會觸發 already-configured 拒絕）——再跑 `config.sh`（原樣拷貝 `.runner`/`.credentials` 會使其以 "already configured" 拒絕），然後**啟動監聽器**：`sudo ./svc.sh install ubuntu && sudo ./svc.sh start`。僅註冊不會上線；只有啟動了服務的 runner 才會增加容量。每個約一分鐘。


### 切回

刪除 `DSH_CI_FAILOVER_LINUX` 或 `DSH_CI_FAILOVER_WINDOWS` 變數（或改為 `selfhosted` 以外的任何值），新的執行即解析回託管企業池。若故障期間追加註冊過實例，將其移除。

### 信任邊界

這些變數是寫者可管理的倉庫狀態；`pull_request` 事件本身既不能設定它們，也不能讓不同的值生效，選擇器表達式存在於工作流程定義中。需要注意：故障切換期間，`pull_request` 執行執行的是 PR merge 引用自帶的工作流程定義——抵禦不可信程式碼的邊界是倉庫成員資格（私有、禁 fork、選擇器排除 Dependabot），而非該變數。關於 runner group 策略的說明：把 runner group 綁定到 master 引用的工作流程與本故障切換機制**不相容**——五個故障切換作業是從 PR merge 引用求值的 `pull_request` 執行，master 綁定的組會讓它們持續排隊（2026-07-27 實際故障中親歷；當時將組放寬為本倉庫全部工作流程才疏通了切換）。更嚴格的執行器側策略以犧牲 PR 故障切換為代價；當前採用的形態是倉庫範圍、全工作流程的組訪問。

## 曾考慮的替代方案

**透過合併一次工作流程改動來切換池。** 否決，因為觸發切換的故障狀態恰恰是任何 PR 都無法合併的狀態：必需檢查正是失敗的那些。倉庫變數是寫者可管理的狀態，重跑即生效，無需合併。

**讓自託管池長期處於必需路徑中。** 否決，因為這是拿託管池的可用性去換自有虛擬機器的可用性，只是搬移了單點故障而非增加回退。這些變數讓託管池保持主路徑，自託管池作為一個經過驗證、一步即可啟用的熱備；按平臺拆分意味著一個平臺的故障不會重定向另一個平臺。

## 後果

從託管池故障中復原只需切換受影響平臺的變數（任何寫者可設）加一次重跑，關鍵路徑上沒有合併。代價是每個平臺都要維護第二套執行器拓撲：熱備通道在每次 master 推送時都執行它們，避免故障切換目標變得過時；而 `ci.yml` 中的並行與快取復原分支帶有一條 `selfhosted` 支路（僅 Linux），必須與託管支路保持同步。按平臺拆分開關多了一個需要管理的變數，但把每個開關的影響範圍限定在單個平臺的作業上。
