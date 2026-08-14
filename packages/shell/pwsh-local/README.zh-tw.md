# @deepseek-ai/dsh-pwsh-local

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

`@deepseek-ai/dsh-shell` 執行器 seam 的本機 PowerShell Service Provider，基於 [`@deepseek-ai/dsh-subprocess`](../../subprocess/subprocess/README.md) 服務：`PwshLocalExecutor` 每次呼叫以受管行程的方式透過 `ctx.subprocess` spawn `pwsh -NoLogo -NoProfile -NonInteractive -Command <command>`，並負責所有 PowerShell 相關事項——可執行文件解析、命令默認化與上限、逾時/取消分類、面向模型的終端機環境，以及後臺讀取的 stdout/stderr 合併。行程組機制（有界 spill 輸出、憑據清理、終止升級、dispose（資源釋放））屬於 subprocess 服務。

命令字串作為單個 argv 元素傳給 `-Command`：由 PowerShell 自己解析文字，不存在中間 shell，因此沒有需要轉義的 shell 引號層（這裡不存在與 `bash -c` 字串域對應的層）。原生 Win32 路徑（`C:\...`）原樣透過。

包根匯出默認與具名 `PwshLocalExecutor` 外掛程式、其 `Config`、純函式 `resolvePwshPath`/`candidatePwshPaths` 輔助函式，以及執行器注入每次 spawn 的 `ENV_OVERRIDES`/`ENCODING_PREAMBLE` 常數。

## 設定

```yaml
- id: bash
  name: '@deepseek-ai/dsh-pwsh-local'
  config:
    cwd: C:\path\to\workspace   # default: process.cwd()
    timeoutMs: 120000           # default foreground timeout
    maxTimeoutMs: 600000        # cap for per-call overrides
    maxOutputBytes: 64000       # per-stream in-memory cap; overflow spills to disk
    maxSpillBytes: 67108864     # per-stream full-output spill cap
    graceMs: 3000               # kill escalation and post-exit pipe-drain grace
    pwshPath: C:\Program Files\PowerShell\7\pwsh.exe  # explicit executable; else well-known locations, then PATH
```

## 行為

這是 `dsh-bash-local` 的 Windows 對應實作，有意逐次呼叫保持語義一致：

- **每次呼叫新建行程，無 shell 狀態**——每次呼叫都是全新的非互動 `pwsh -Command`（確定性；不載入 profile 文件）。`-NoLogo -NoProfile -NonInteractive` 關閉啟動橫幅、profile 載入與會幹擾工具輸出的提示符。
- **組裝條目是一層，而不是最終值**——當組裝中存在 settings 提供方時，本執行器以上面的條目為 base 註冊該能力的 [`bash` 命名空間](../shell/README.md)，因此 `settings.yaml` 中的使用者段會疊加其上，下一條命令即按新預算執行。該命名空間與 POSIX 家族共用，因為一個宿主只組裝一個 `ctx.shell` 提供方；在任一平臺寫下的文件在另一平臺仍能解析。schema 無法判定的值（正有限、`graceMs` 的定時器上界）會在寫入時被拒絕，執行中的執行器保持它最後一份可用的段。
- **UTF-8 輸出固定**——每條命令都先以 UTF-8 設定 `[Console]::OutputEncoding` 與 `$OutputEncoding`，因此 Windows PowerShell 5.1 兜底（或任何控制台內碼表非 UTF-8 的主機）不會破壞非 ASCII 輸出：subprocess 收集器以 UTF-8 解碼位元組。輸入編碼保持宿主默認；pwsh 7 預設為 UTF-8，不受影響。
- **可執行文件解析**——`resolvePwshPath` 優先顯式 `pwshPath`，然後在 Windows 上依次探測 PowerShell 7 安裝位置、每個 PATH 條目（Microsoft Store 安裝；剝離兩端引號）以及作為殘留兜底的 Windows PowerShell 5.1，逐一用 lstat 探測檢查（接受真實文件或連結形態的重解析點：Store 的 app execution alias 對其目標 stat 會因 ACL 失敗，但 lstat 能看到別名本身）；其他平臺回退為透過 PATH 解析的裸 `pwsh`。解析是 `(configured, env, platform)` 的純函式；它在構造時執行，此後僅當儲存的 `pwshPath` 與當前可執行文件所依據的值不同纔再次執行，因此無關的設定變更絕不會重新探測檔案系統。
- **受管行程組之上的設定預算**——`resolve()` 從設定填充 `workdir`/`timeoutMs`/`stdoutMaxBytes`，每次 spawn 都向服務提供顯式位元組上限、spill 上限與 `graceMs`。該寬限期須為正有限值，且不得大於 [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md)，這樣 Node 就能用一個定時器表示它。行程樹終止（Windows 用 taskkill，POSIX 用行程組訊號）、退出後管道排空寬限、保尾截斷與有界 spill 文件是 [`dsh-subprocess-local`](../../subprocess/subprocess-local/README.md) 的機制。前臺 `ShellExecRequest.stdoutMaxBytes` 可為單個受信呼叫方提高 stdout 捕獲預算；stderr 與後臺執行仍使用 `maxOutputBytes`。
- **逾時與取消分類**——`run()` 透過一個 deadline 融合按設定上限擷取的逾時與呼叫方訊號；只有執行器自身逾時報告 `timedOut`，上游取消報告 `aborted`，自我終止的命令兩者都不報告（見 [timeout 庫 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md)）。Windows 將強制終止報告為退出碼 1 且無訊號，因此帶訊號標記的事實（`signal`、`killed` 狀態）在那裡僅限 POSIX；逾時/取消分類與平臺無關。
- **面向模型的終端機環境**——`NO_COLOR=1 PAGER=cat GIT_PAGER=cat`（沒有 `TERM=dumb`：那是 POSIX 概念；現代 PowerShell 渲染器遵循 `NO_COLOR`），作為普通 env 在服務的憑據清理與 `DSH_*` 通道規則之下合併；顯式呼叫方條目仍然優先。
- **後臺行程**——`start()` 立即返回存活的 `ShellProcess` 控制代碼，不設逾時；控制代碼的 `readOutput()` 把服務基於偏移的 stdout/stderr 讀取合併為一條按分段標記、透過消費遊標推進的增量。仍在執行的行程屬於 subprocess 服務，因此它跨執行器重載存活，並隨服務 dispose（被終止並 join）。一切任務相關職責（job id、所有權、輪詢、通知）都在通用 [`ctx.jobs` 執行時期](../../jobs/jobs/README.md) 中，由工具層把控制代碼註冊進去——本執行器從不接觸工作階段或登錄檔。

## 模型體驗

間接地，經由 `dsh-tool-pwsh` 呈現本執行器的有界 stdout/stderr 尾部、後臺行程增量（經通用任務執行時期）、spill 檔案路徑與基礎設施失敗。

#### KV Cache 影響

不會直接導致 KV Cache 失效；請求前綴的任何變更由具名消費端負責。

## 已知限制與暫緩事項

- **自身不設沙盒**——本執行器始終以 harness 行程的權限執行命令；需要隔離的部署應組合啟用沙盒的 bash 執行器或策略。
- **無持久 shell 或 PTY**——每次呼叫都是全新的 `pwsh -Command`。
- **命令字串是 PowerShell 文字**——`-Command` 域沒有 shell 引號層，但面向模型的命令由 PowerShell 自己解析，因此 PowerShell 文法錯誤是命令失敗，而非啟動失敗。
- **後臺 spawn 失敗提示只投遞一次**——subprocess 服務不會為從未執行的行程緩衝輸出，因此執行器只把 `spawn failed: …` 注入一次 `readOutput()` 增量；丟棄該增量的讀取方無法復原它。
- **Windows 終止不報告訊號**——被強制終止的行程以退出碼 1、`signal: null` 結束，因此基於訊號的狀態分類（POSIX `killed`）在 Windows 上不適用；`kill()` 發起的停止仍會直接標記為 `killed`。
- **編碼 preamble 位於命令之前**——PowerShell 要求 `param(...)`、`#requires` 與 `using namespace`/`using assembly` 語句位於指令碼最頂部，因此以其中一種開頭的命令無法在 UTF-8 輸出 preamble 下執行。`param(...)` 指令碼可包進 `& { … }`（param 塊可以合法地位於指令碼塊開頭）；`using` 語句與 `#requires` 在命令內沒有變通辦法（`#requires` 在 `-Command` 中無論位置如何都不生效）——此類指令碼請改從文件執行。
- **Windows PowerShell 5.1 下的非 ASCII stdin 可能被錯誤解碼**——preamble 只固定輸出編碼；`[Console]::InputEncoding` 保持主機默認，因為在重定向 stdin 下設定它會拋出例外。pwsh 7 默認 UTF-8，不受影響。

清理啟發式與 spill 保留的注意事項見 [`dsh-subprocess-local`](../../subprocess/subprocess-local/README.md)，相關機制由其負責。
