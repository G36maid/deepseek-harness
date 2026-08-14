# @deepseek-ai/dsh-bash-local

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

`@deepseek-ai/dsh-shell` 執行器 seam 的本機 Service Provider，建置在 [`@deepseek-ai/dsh-subprocess`](../../subprocess/subprocess/README.md) 服務之上：`LocalBashExecutor` 每次呼叫都透過 `ctx.subprocess` 把 `bash -c <command>` 作為受管行程組 spawn，並負責所有 Bash 層職責（命令預設值補全與上限、逾時與取消分類、適合模型的終端機環境，以及後臺讀取時面向模型的 stdout/stderr 合併）。以 spill 文件兜底的有界輸出、憑據清除、kill 升級和 dispose（資源釋放）等行程組機制則由 subprocess 服務負責。

包根目錄匯出預設與具名的 `LocalBashExecutor` 外掛程式及其 `Config`。

## 設定

```yaml
- id: bash
  name: '@deepseek-ai/dsh-bash-local'
  config:
    cwd: /path/to/workspace   # default: process.cwd()
    timeoutMs: 120000          # default foreground timeout
    maxTimeoutMs: 600000       # cap for per-call overrides
    maxOutputBytes: 64000      # per-stream in-memory cap; overflow spills to disk
    maxSpillBytes: 67108864    # per-stream full-output spill cap
    graceMs: 3000              # kill escalation and post-exit pipe-drain grace
```

## 行為

- **每次呼叫都 spawn，不保留 shell 狀態**：每次呼叫都啟動新的非登入 `bash -c`，且不讀取 rc 文件。
- **組裝條目是一層，而不是最終值**：當組裝中存在 settings 提供方時，本執行器以上面的條目為 base 註冊該能力的 [`bash` 命名空間](../shell/README.md)，因此 `settings.yaml` 中的使用者段會疊加其上，下一條命令即按新預算執行。schema 無法判定的值（正有限、`graceMs` 的定時器上界）會在寫入時被拒絕，執行中的執行器保持它最後一份可用的段；沒有提供方、或提供方脫離之後，執行的就是組裝條目。
- **在受管行程組之上應用設定預算**：`resolve()` 從設定補全 `workdir`／`timeoutMs`／`stdoutMaxBytes`，每次 spawn 都向服務傳入顯式的位元組上限、spill 上限與 `graceMs`。該寬限期須為正有限值，且不得大於 [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md)，這樣 Node 就能用一個定時器表示它。行程組終止、結束後管道排空、尾部保留與有界 spill 文件是 [`dsh-subprocess-local`](../../subprocess/subprocess-local/README.md) 的機制。前臺 `ShellExecRequest.stdoutMaxBytes` 可為某個受信任呼叫方提高單次 stdout 捕獲預算；stderr 和後臺執行仍使用 `maxOutputBytes`。
- **逾時與取消分類**：`run()` 透過同一個 deadline 把經設定鉗位的逾時與呼叫方的訊號融合；只有執行器自身的逾時報告 `timedOut`，上游取消報告 `aborted`，自身因訊號終止的命令兩者皆不報告（見[逾時庫 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md)）。
- **適合模型的終端機環境**：`NO_COLOR=1 TERM=dumb PAGER=cat GIT_PAGER=cat` 防止分頁器與 ANSI 顏色破壞結果。這些值作為普通 env 合併，遵循服務的憑據清除與 `DSH_*` 通道規則；呼叫方的顯式條目依舊優先。詳見 [stdin/env Agent Note](../../../.agents/notes/implemented/architecture/2026-06-30-bash-stdin-env-trusted-plugin-api.md) 與 [受管環境 Agent Note](../../../.agents/notes/implemented/feature/2026-07-10-agent-session-identity-and-log-location.md)。
- **後臺行程**：`start()` 會立即返回活動的 `ShellProcess` 控制代碼且不應用逾時；`readOutput()` 把基於偏移量的 stdout/stderr 讀取合併為一條消費式增量，並在存在 stderr 時將其置於 `[stderr]` 標記下。執行中的行程屬於 subprocess 服務，可在執行器重載後存活，並在服務 dispose 時被終止且等待結束。job id、所有權、輪詢和通知屬於通用 [`ctx.jobs` 執行時期](../../jobs/jobs/README.md)，工具層會在其中註冊該控制代碼。

## 模型體驗

透過 `dsh-tool-bash` 間接影響；該工具會算繪此執行器有界的 stdout/stderr 尾部、後臺行程增量、spill 檔案路徑與基礎設施失敗。

#### KV Cache 影響

不會直接導致 KV Cache 失效；請求前綴變更由具名消費端負責。

## 已知限制與暫緩事項

- **自身不提供隔離**：此執行器始終以 harness 行程的權限執行命令；需要隔離的部署可以組合 [`dsh-bash-sandbox`](../bash-sandbox/README.md)，每次呼叫的 allow/deny/ask 策略則屬於 `tools/pre-execute`。
- **沒有持久 shell 或 PTY**：每次呼叫都啟動新的非登入 `bash -c`；僅持久化 cwd 與互動式終端機工作階段均繼續暫緩，直到真實工作流程需要它們。
- **僅支援 POSIX**：`bash` 二進位已硬編碼，底層服務的行程組語義也是 POSIX 的；不支援 Windows。
- **後臺 spawn 失敗提示只交付一次**：subprocess 服務不會為從未真正執行的行程緩衝任何輸出，因此執行器把 `spawn failed: …` 注入恰好一個 `readOutput()` 增量；丟棄了該增量的讀取方無法再復原它。

憑據清除啟發式規則與 spill 保留的注意事項隨 [`dsh-subprocess-local`](../../subprocess/subprocess-local/README.md) 記錄；這些機制歸它所有。
