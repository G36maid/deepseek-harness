# Agent Note: glob/grep 改用打包的 ripgrep 二進位直接 spawn

Status: implemented

[English](2026-08-01-packaged-ripgrep-search.md) | [简体中文](2026-08-01-packaged-ripgrep-search.zh.md) | 繁體中文

> 取代 [bash 承載的 grep/glob 發現工具](../../archived/feature/2026-07-09-bash-backed-grep-glob-discovery.md)：v1 決策中明確延期的方案——直接 spawn ripgrep——現在成為實際交付的實作。

## 問題

`glob`/`grep` 工具經由 bash 執行器 seam 執行，這使系統 `rg` 安裝成為宿主相依性。Windows 和容器映像檔的 `PATH` 默認沒有 `rg`，工具在那裡會靜默消失；部署方只能從載入期探針警告裡發現這一點。bash seam 還迫使整個模型可見參數面經過一個 shell 引號工具，因為工具與 ripgrep 之間隔著一層 shell——[bash 承載決策](../../archived/feature/2026-07-09-bash-backed-grep-glob-discovery.md) 把這種耦合記為 v1 的取捨，並把直接 spawn 列為 shell 字串域一旦被證明過於敏感時的合理後續。它確實被證明瞭：每個模型值都要經受 POSIX 單引號轉義，探針要在測試裡指令碼化，執行器自身的逾時分類還與協作式工具逾時策略已有的職責重複。

## 決策

`@deepseek-ai/dsh-tool-fs-search` 現在執行 PACKAGED（打包的）ripgrep 二進位（`@vscode/ripgrep`，一個 npm 相依性，其選填平臺包隨附二進位），經由 `ctx.subprocess` seam：`runRipgrep()` 以純 argv 向量 spawn `rgPath`，向量前綴 `--no-config`，配以 collect 模式 stdout/stderr、`graceMs` 與轉發的 `exec.signal`。`rgPath` 在首次呼叫時懶解析（行程內 memoize）：`@vscode/ripgrep` 在模組求值階段解析其平臺包，靜態匯入會把平臺包缺失/損壞（`--omit=optional`、安裝不全）變成 Loader 組合載入失敗——這正是本次改動要消除的載入期失敗模式。不再有 shell 層，執行路徑上的 shell 引號邊界隨之消失；`singleQuote` 工具與其 shell spawn 測試一並刪除。原始流使用 seam 的診斷尾部 collect 形態（無 spill 文件——工具從不讀取原始 spill 路徑；lossy stdout 讀取以 `SEARCH_RAW_OUTPUT_OVERFLOW` 失敗）。終止寬限與 stderr 尾部預算成為經校驗的 `Config` 欄位（`graceMs` 默認 3000，`stderrMaxBytes` 默認 64 KiB），不再繼承自 bash-local 的設定。註冊變為無條件——載入期 `command -v rg` 探針與條件註冊決策被刪除，連同那條 "rg not found" 警告。本包注入 `tools`、`systemPrompt` 與 `subprocess`。

退出語義仍由工具擁有：退出碼 0 為有結果的成功，1 為成功的空搜尋，其餘歸入既有 `SEARCH_*` 詞彙（無效模式、啟動失敗、訊號殺死、原始輸出溢位）。逾時是掛在工具定義上的協作式工具呼叫預算：`@deepseek-ai/dsh-tool-call-timeout-policy` 中止 `exec.signal`，subprocess seam 的終止升級提供硬終止，工具報告 `SEARCH_ABORTED`。工作目錄為工作階段 header cwd（存在時），否則為 `process.cwd()`——不再有執行器設定可供默認化，因此回退由工具自己擁有。

`fs-glob-sampling` ACP（Agent Client Protocol）快照場景改為執行真實的打包二進位，作用於一個用固定 mtime 釘住 `--sort=modified` 順序的預制工作區，取代 PATH 注入的 `rg` 替身（僅 POSIX：展示路徑攜帶 `/` 分隔符，工作階段日誌比較無法歸一化）。

## 備選方案

**保留 bash seam 與探針，僅把 `rg` 記為必需宿主相依性。** 否決：宿主相依性正是本次改動要消除的失敗模式，而讓發現工具支持 Windows 正是此舉的目的；寫進文件的相依性仍是相依性。

**讓 `rgPath` 可注入（設定欄位或環境變數覆蓋），讓測試與快照繼續使用替身二進位。** 否決：這會新增一個只有測試掛鉤會消費的公開部署面，而真實二進位本身具有足夠的確定性——透過 fixture（測試前置資料）的 mtime 即可直接釘住；打包二進位就是部署形態，測試應當拿它來測。

**改用純 JS 的 glob/搜尋引擎（如 `picomatch`/`tinyglobby`）。** 否決：[相依性替換審計](../../rejected/simplification/2026-07-26-dependency-swaps-rejected-by-nih-audit.md) 已基於「不存在 glob 引擎」的證據否決過該方向；ripgrep 語義（`--sort=modified`、VCS 剪枝、JSON 傳輸、正則方言）就是工具約定。

## 後果

- 發現工具在打包二進位覆蓋的每個平臺（darwin/linux/win32，x64/arm64）上開箱即用，無需宿主安裝；交付的 TUI/Web 工具清單把 `glob`/`grep` 變為固定成員（見 [拉平交付的工具清單](../feature/2026-07-31-even-out-shipped-tool-rosters.md)）。
- shell 字串攻擊面消失：惡意模式只是不具執行性的 argv 元素，由整合套件釘住；該套件現在也在 Windows 上執行（此前沒有系統 `rg` 時它自行跳過）。
- spawn 不受沙盒約束（普通的 `ctx.subprocess` 呼叫），因此前綴 `--no-config`：宿主的 `RIPGREP_CONFIG_PATH`（或二進位旁的 `rg.conf`）否則可注入 `--pre` 預處理器，對每個匹配文件執行任意命令。加上 `--no-config` 後，任何設定檔——因而任何預處理器——都無法觸及搜尋。
- 原始輸出溢位路徑的形態改變：舊的 bash 承載路徑繼承了 bash-local 常開的 spill，可能留下沒人讀的多 MB 暫存檔；subprocess seam 現在無 spill 收集，溢位是純粹的錯誤（`SEARCH_RAW_OUTPUT_OVERFLOW`，"narrow pattern, path, or include and retry"），不返回任何內容。
- 載入期失敗模式改變：subprocess seam 損壞現在讓首次搜尋呼叫失敗（`SEARCH_FAILED`），而非透過探針使外掛程式載入失敗；二進位缺失是帶打包路徑的啟動失敗，而不是 PATH 問題。
- 整合套件的 fixture 去掉了 Windows 無法表示的檔名（名稱含 `"`），保證套件在每個平臺都能重放。
- 重新生成 `THIRD_PARTY_NOTICES.md` 暴露了一個由新相依性帶出的潛在生成器 bug：Node 的 `fs.globSync` 返回作業系統原生分隔符，因此在 Windows 上 notices 分層中帶 `/` 後綴的 dev 區前綴永遠匹配不上，dev-only 包（測試工具、support 葉子）被錯分為執行時期。生成器現在在入口處歸一化 manifest（中繼資料清單）路徑，notices 與平臺無關。
- `@vscode/ripgrep` 相依性為執行時期層增加其 MIT 行；pnpm 11 截斷的虛擬儲存目錄名需要在 notices 生成器的元資料尋找中增加內容掃描回退。
