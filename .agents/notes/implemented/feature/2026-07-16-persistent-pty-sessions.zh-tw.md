# Agent Note: 持久化 PTY 工作階段

Status: implemented

[English](2026-07-16-persistent-pty-sessions.md) | [简体中文](2026-07-16-persistent-pty-sessions.zh.md) | 繁體中文

## 問題

harness 可以執行前臺與後臺命令、編輯文件和委派工作，但無法跨工具呼叫延續一次互動式終端機對話。每次 `bash` 前景執行都會啟動一個新 shell，因此 shell 內的 cwd、匯出變數、虛擬環境啟用狀態、函式、job control 狀態和互動式子行程都會隨本次呼叫結束。

這個缺口排除了狀態駐留在終端機而不是文件中的工作流程，例如單步除錯 `gdb`、在 Python 或 Node REPL 中探索、驅動 `ed` 這類行式編輯器，或者中斷前臺命令後回到原 shell。通用的 [`ctx.jobs`](../../../../packages/jobs/README.md) 執行時期可以保留後臺操作控制代碼和輸出，但不提供互動式 stdin 或終端機語義。

現有 `bash`、`read`、`write` 和 `edit` 工具仍是有界、可審計操作的可靠預設選項。PTY 是對確實需要終端機狀態的工作的補充能力，不說明這些工具有缺陷，更不意味著要移除它們。

## 決策

選填的 `packages/terminal/` 能力家族提供由 agent（代理）擁有、持久化且面向行式互動的 PTY 工作階段。它遵循倉庫的 [能力模式](../../implemented/architecture/2026-06-13-capability-seams.md)，與現有命令和檔案系統工具並存，並且不修改 `agent-loop`。

當前實作在 Linux 和 macOS 上支持互動式 shell 與行式 REPL。全屏終端機應用、按鍵序列、BEL 觸發的控制流、行程丟失後的工作階段復原以及跨 agent 共享工作階段都明確推遲。

### 包拓撲

| 包 | 角色 | ctx key |
|---|---|---|
| `dsh-terminal` | `TerminalSessionService`、branded `TerminalSessionId`、後端登錄檔、按 owner 隔離的工作階段約定和結果類型 | `ctx.terminals` |
| `dsh-terminal-bash` | 基於 `ctx.subprocess.spawnTerminal()` 的持久 shell 後端：就緒狀態、有界終端機緩衝、沙盒解析和感知 owner 的工作階段生命週期 | 在 `ctx.terminals` 上註冊後端 |
| `dsh-tool-terminal` | 6 個面向模型的工具、後臺傳送的 task 執行時期整合、使用指引和 UI 渲染意圖 | 註冊到 `ctx.tools` |

就緒判定仍屬於 PTY 後端行為，不是第二條公共約定。終端機行程提供方只提供基底事實，例如前臺行程組，以及能否證明該組正在等待輸入；`dsh-terminal-bash` 將這些事實與提示符和靜默證據組合成統一的傳送結果。

### agent 所有權與身份

`TerminalSessionService` 在行程內保存活工作階段，但每個工作階段都由工具執行上下文傳入的確切 `Agent` 擁有。服務鑄造不透明的 `TerminalSessionId`；模型選填填的 `name` 只是顯示元資料，僅在該 owner 內唯一。所有操作都以 `sessionId` 為目標，`list`/`read`/`signal`/`kill` 會拒絕 owner 之外的呼叫方。

實作不提供外掛程式載入期 auto-start 工作階段。`terminal_open` 只在 agent 工具呼叫期間建立工作階段，此時所有權和所屬的事件溯源工作階段都已確定。未來的聲明式啟動功能必須透過尚未發布的 agent setup 組合，而不能建立全域性共享終端機。

agent scope dispose（資源釋放）時先撤銷註冊，再等待全部所屬 PTY 完全靜止。未發布的後端 setup 同樣是受追蹤的生命週期操作：owner 或服務 dispose 會中止服務自有的 signal，等待後端結帳與回滾完成後才返回。即使後端 reject，或返回的工作階段在回滾 close 時失敗，呼叫方取消仍會原樣保留其 `AbortSignal.reason`；該清理失敗不會替換呼叫方原因，而會繼續受追蹤，留待後續 owner 或服務 dispose 處理。由 lifecycle dispose 觸發的回滾 close 失敗會使 spawn 與該 lifecycle dispose 都 reject，而 `TerminalBackendCleanupError` 讓後端在不替換呼叫方取消的前提下，為該 lifecycle dispose 保留自身的啟動清理失敗。若呼叫方取消在 dispose 開始前已經結帳，該清理失敗會繼續作為受追蹤的 owner activity 保留，直到後續 owner 或服務 dispose 消費並報告它，因此沙盒模式策略不會把清理失敗誤判為完全靜止。後端或工具外掛程式 reload 不會殘留工作階段：所有權持續存放在 `TerminalSessionService` 中，直到 agent 結束，與 [`ctx.jobs`](../../../../packages/jobs/jobs/README.md) 的服務持有記錄模式一致。服務會先同步把工作階段預留給一次活躍傳送，再返回該操作；後臺傳送同樣會在 job id 對外可見前完成預留。第二次傳送會以 `SEND_ACTIVE` 失敗，因此輸出與取消無法跨越操作所有權。

### 安全與行程邊界

註冊的 `shell` 後端只約束終端機如何啟動，不約束啟動後輸入的命令。因此 `dsh-terminal-bash` 在 spawn 前應用兩層保護：

- 它只提供終端機專用的環境覆蓋；掛載的子行程提供方先清除名稱形似憑據的環境變數，再合併這些覆蓋。
- 它要求共享的 `ctx.sandboxPolicy`。後端在 spawn 時，以部署預設值為底摺疊 owner 的有效工作階段模式；`danger-full-access` 會直接啟動 shell，受限模式則要求同一執行世界中存在 `ctx.sandbox` 提供方，並只包裝一次 shell argv。該模式與 workspace root 在 PTY 的整個生命週期中充當行程邊界。只要 owner 有任何已打開的 PTY 或尚未發布的 spawn，任何會改變生效 `sandbox/mode` 的寫入都會在提交前被拒絕，並提示先等待建立操作結帳，再關閉這些工作階段；不會改變生效模式的寫入仍然有效。這項進行中的預留從後端 setup 持續到發布完成，因此不存在降級後又出現權限更寬的終端機這一競態。`danger-full-access` 是現有的顯式無約束選擇，不另設 PTY 私有 bypass。

沙盒限制本機行程副作用，但不會讓任意 shell 輸入自動安全：網路呼叫和其他外部副作用仍由部署策略治理。工具描述會說明 PTY 工作階段比一次性工具更難審計，只應在確實需要持久狀態或互動式 stdin 時使用。

本機子行程終端機原語只使用 `node-pty` 的公開能力：子行程 PID、`data` 與 `exit` 通知、`write` 和 `kill`。它不假設能訪問原生 master fd，也不從 TypeScript 呼叫 `waitpid`。該原語下的平臺行程檢查器在 Linux 上透過 `/proc`、在 macOS 上透過 `ps` 推導前臺行程組和父子行程身份。[可移植執行環境決策](../architecture/2026-07-28-portable-execution-world-consumers.md)負責定義這種行程／消費端拆分。

### 6 個面向模型的工具

| 工具 | 用途 | 結果 |
|---|---|---|
| `terminal_open` | 從已註冊的後端類型建立按 owner 隔離的工作階段 | `{ sessionId, name, type, motd }` |
| `terminal_send` | 傳送文字、選填提交 Enter，並等待就緒或註冊一個背景工作 | 有界 viewport、等待狀態和工作階段狀態；後臺模式還返回 `jobId` |
| `terminal_read` | 從保留的 scrollback 讀取一個有界頁 | `{ text, totalLines, lineBegin, lineEnd, truncated }` |
| `terminal_signal` | 向當前前臺行程組傳送一種允許的訊號 | `{ delivered, targetPgid }` |
| `terminal_close` | 關閉一個工作階段並等待行程樹完全靜止 | `{ killed }` |
| `terminal_list` | 列出調用方的活工作階段 | 按 owner 隔離的工作階段摘要 |

UI 渲染約定精確且不攜帶位置資訊。`terminal_send` 只為前臺傳送使用 terminal 呼叫卡片和結果卡片；後臺形式使用通用 `execute` 卡片。`terminal_open`、`terminal_read`、`terminal_signal`、`terminal_close` 和 `terminal_list` 分別使用通用 `execute`、`read`、`execute`、`delete` 和 `read` 卡片。所有 PTY 工具都不寄出 `locations`。

`terminal_send({ sessionId, text, submit?, run_in_background? })` 將 `text` 視為 UTF-8 位元組，並由工具實作在解析階段把 `submit` 默認成 `true`。`submit` 為 true 時先寫入文字，再寫入平臺 Enter 序列；為 false 時只寫文字，使控制字元和 REPL 片段無需隱藏的內容啟發式即可傳送。取消會在向真實前臺行程組傳送訊號前將排隊輸入標記為已取消，因此即使非同步的寫入前檢查隨後才結帳，該輸入也無法執行。被取消的傳送會保留其預留，直至非同步前臺訊號傳送結帳，因此後續傳送不會成為該訊號的目標。`enableRunInBackground` 預設為 true；設為 false 時，schema 中會移除 `run_in_background`，呼叫方即使強行把這個未聲明參數傳入執行流程，也會被拒絕。

前臺傳送返回有界的渲染增量和兩個獨立事實：`waitReason`（`stdin_read | inferred_idle | timeout | session_exit`）與 `sessionStatus`（`running`，或攜帶退出碼或訊號的 `exited`）。`session_exit` 指 PTY 頂層 shell 行程退出，不指由 shell 消費狀態的任意前臺命令。timeout 從不意味著行程已經退出。`dsh-tool-terminal.maxResultBytes` 預設為 262144；低於 64 的值會被拒絕，以確保建立確認保留登錄檔簽發的 id；每個單文字 UTF-8 結果在加入規範化的工具或管線錯誤、等待、工作階段、分頁、截斷、通用 task 狀態包裝、策略拒絕或短路以及 post-execute 替換或阻斷後，仍受該值限制；終端機定義自有的末端 `finalizeContent` callback 會原樣保留策略刻意返回的結構化多塊內容。渲染器會為後綴預留空間並保持程式碼點邊界，而不會把後端載荷上限當作面向模型結果的最終上限。

當 `run_in_background: true` 時，`dsh-tool-terminal` 在 `ctx.jobs` 上註冊進行中的傳送，並立即返回 `jobId`。生產方把 `maxResultBytes` 寫入 task 快照，使 `job_output`、kill 返回的終態狀態和完成通知在加上通用元資料後，仍對完整結果執行同一上限。`job_output(wait: true)` 負責等待、讀取增量輸出並記錄最終結果；`job_kill` 會解析當前前臺 PGID 並行送真正的 `SIGINT`，即使應用已停用終端機 `ISIG` 也同樣如此，且後續升級仍只透過 PTY 後端擁有的 teardown 路徑進行。若 task 對外介面不存在，後臺模式必須在寫入輸入前失敗。設計不新增 PTY 專用的 `sleep` 工具或通用喚醒 API。

`terminal_read` 從最新保留行向後分頁。後端同時對保留的 scrollback 和返回頁載荷執行行數與 UTF-8 位元組上限，因此單個超長行無法繞過後端上限；工具隨後再限制包含分頁與截斷元資料的完整渲染頁。`truncated` 用於區分保留資料丟失與普通 viewport 增量。

`terminal_signal` 接受閉合集 `SIGINT | SIGTERM | SIGKILL | SIGTSTP | SIGHUP`。後端在執行時解析終端機前臺行程組。當目標組是頂層 shell 時拒絕 `SIGKILL`，並指引呼叫方使用 `terminal_close`；行程組解析失敗時操作直接失敗，而不是向猜測的 PID 傳送訊號。

### 本機就緒偵測

本機後端先識別受控 bash 啟動時寄出的私有 OSC prompt marker，並且只有在最近一個 marker 後的可列印尾部與受控 `PS1` 完全相等時才聲明 prompt 就緒；除此之外，它還執行 3 個有界 fallback 層級。在 data callback 之間保留該尾部，可以適配 marker 與 prompt 被分開交付的情況；如果回顯的輸入或輸出跟在延遲到達的先前 prompt 之後，要求尾部完全相等會拒絕該 prompt，使其無法完成當前 send。marker 在輸出到達模型前被移除，使兩個平臺上的普通 shell 命令都無需固定等待靜默閾值。尚未發布的 startup 不會把零輸出靜默視為就緒；timeout 會拒絕 spawn。若呼叫方取消在 startup 期間勝出，後端會關閉私有工作階段並原樣拋出 `AbortSignal.reason`；尚不可觀察的前臺 PGID 不會再用尋找錯誤覆蓋取消原因。所有時間參數都是經校驗的設定欄位：`pollIntervalMs`、`exactProbeAfterMs`、`idleSilenceMs`、`handoffGraceMs` 和 `timeoutMs`。

在 Linux 上，檢查器從 `/proc/<shellPid>/stat` 讀取 shell 的終端機前臺 PGID，枚舉該行程組中的每個行程與執行緒，並檢查它們當前的 syscall。Tier 1 只有觀察到 stdin 等待才返回正結果：直接 `read(0)`、獲準讀取且含 fd 0 的 `select`/`pselect6` 或 `poll`/`ppoll` 參數，或者含 fd 0 的 epoll interest list。終端機輸入前就已存在的等待並不代表寫入後就緒：必須先觀察到同一 PGID 脫離該等待，之後再次進入等待才能使該次 send 完成；前臺 PGID 發生變化則構成新的證據。無法讀取的行程記憶體和未識別的 syscall 都是 miss，絕不作為正向猜測。架構表只包含對應 Linux UAPI 定義的 syscall number；不支持的架構跳過 Tier 1。

macOS 沒有精確 syscall 層。任何前臺行程組輸出靜默都會返回 `inferred_idle`，包括 Python 和 `gdb`；從 `ps` 推導的終端機 PGID 只用於傳送訊號，不作為「只有 shell 才能 idle」的證明。純行程檢查邏輯可注入，並在 Linux 上經過單元測試，同時由 macOS CI job 驅動真實 PTY 和行程表路徑。

Tier 2 在持續 `idleSilenceMs` 沒有輸出後返回 `inferred_idle`，因此 sleep 或網路阻塞的命令可能看似 ready。如果此前已經見過 prompt marker，Tier 2 會再等待 `handoffGraceMs`，使恰好落在靜默邊界上的 bash 前臺交接仍然以精確的 `stdin_read` 歸因結束，而不是退到較弱的推斷；該寬限是由部署方擁有的設定欄位，並被校驗為至少覆蓋一個 `pollIntervalMs`——短於輪詢週期的寬限裝不下一次就緒輪詢，因此不可能改變任何結果。它只約束見過 marker 的 send，代價是這一種情況的互動返回延遲，而不是每一次 send。Tier 3 在 `timeoutMs` 後返回 `timeout`，避免前臺工具呼叫無限佔住 agent。結果保留這些區別；呼叫方可以透過 `ctx.jobs` 等待、向前臺組發信號，或從另一個工作階段排查。

一次 send 在任一層級 settle 之後，`TerminalSendOperation.append` 就不再接受輸出，此後子行程的輸出不會再進入那個已 settle 的 operation；它仍然會進入 scrollback，以及此時恰好處於活躍狀態的任何 send。因此，等待自己所啟動的 operation 上出現標記的測試，必須把 `idleSilenceMs` 與 `timeoutMs` 設得高於子行程自身的啟動耗時；否則在負載較高的 macOS runner 上，解釋器啟動會在標記列印之前就結束這次 send。

`node-pty` data 通知進入同一個終端機 parser。parser 的 carry state 會處理跨 callback 的控制序列和位於 callback 末尾的回車；因此，即使 CRLF 被拆開，也只會生成一個換行，而不會產生改變分頁的空行。實作會規範化行式輸出，但不承諾正確操作全屏應用。

### 模型可見輸出與持久性

現有持久化 `tool/call` 與 `tool/result` 事件是模型傳送文字和返回給模型的渲染輸出的真源。`terminal_open` 透過已記錄的工具結果返回 MOTD；前臺 `send`/`read`/`list`/`signal`/`close` 結果走同一路徑記錄。PTY 包不會把原始位元組流重複寫入自訂工作階段事件。

後臺傳送複用現有後臺任務完成通知和 `job_output` 結果路徑，因此進入後續模型請求的任何輸出同樣持久化。原始終端位元組只作為有界的行程內狀態存在，既不持久化也不可復原。未來的 opt-in transcript（文字記錄）sink 必須擁有獨立的保留、憑證和隱私約定。

### 行程樹 teardown

子行程終端機控制代碼擁有頂層終端機行程及其工作階段。關閉時，它按父 PID 以子行程優先順序捕獲傳遞後代、傳送 `SIGTERM` 並等待，然後重新掃描關停期間 fork 出的子行程，向二者並集傳送 `SIGKILL`，並在停止頂層行程前驗證每個非殭屍後代都已離開行程表。身份匹配的 Linux 殭屍行程已無可執行工作，因此視為完全靜止。每個捕獲的 PID 都包含行程啟動身份，避免 PID 複用把升級訊號發給無關行程。

teardown 獨立報告頂層行程退出與存活行程清理。PTY 工作階段不會只因 shell 退出就聲稱成功：它會呼叫 `SubprocessTerminalHandle.terminate()` 並等待整個工作階段完全靜止，若清理失敗則向外傳播並列出存活者。失敗的 close 不會永久快取：登錄檔與本機工作階段各自僅在關閉圍欄仍指向該次失敗嘗試時才將其清除，因此後續的顯式 close 或生命週期 close 會重試，且不會幹擾較新的並行嘗試。即使某個 close 失敗，服務 dispose 仍會清空其後端、預留與 owner detacher 登錄檔。

### 組合與推行

示例組合保持 opt-in，並採用安全預設值：

```yaml
plugins:
  '@deepseek-ai/dsh-sandbox-local':
  '@deepseek-ai/dsh-sandbox-policy':
    config:
      mode: workspace-write
      workspaceRoot: .
  '@deepseek-ai/dsh-terminal':
  '@deepseek-ai/dsh-subprocess-local':
  '@deepseek-ai/dsh-terminal-bash':
    config:
      scrollbackLines: 10000
      scrollbackMaxBytes: 4194304
      maxReadBytes: 262144
      pollIntervalMs: 50
      exactProbeAfterMs: 150
      idleSilenceMs: 3000
      handoffGraceMs: 500
      timeoutMs: 30000
      disposeGraceMs: 3000
  '@deepseek-ai/dsh-tool-terminal':
    config:
      enableRunInBackground: true
      maxResultBytes: 262144
```

包提供簡潔的工具指引，說明持久狀態、owner 隔離、不確定的 idle 結果、清理，以及無需互動時優先使用現有一次性工具。已發布的基礎示例不掛載 PTY：PTY 僅透過專用組合 opt-in，而 ACP（Agent Client Protocol）與 headless 快照 overlay 會對其進行驗證。`dsh-tool-terminal` 實例一旦啟用，6 個工具和 `run_in_background` 就會預設啟用；部署可透過設定僅停用後臺參數。

### 推遲的工作

- 全屏 TUI 支持、命名按鍵序列、BEL 中斷、終端機 resize 工具和 alternate-screen 快照需要另行驗證面向模型的約定。
- 聲明式 per-agent 啟動需要 agent-setup 組合點；仍然禁止外掛程式載入期全域性工作階段。
- harness 行程丟失後的工作階段復原需要行程外 owner 和版本化協議。
- 網路出口策略與外部副作用回滾超出 PTY 範圍，繼續作為獨立安全工作。
- Windows/ConPTY 支持需要具備 Windows 原生行程所有權與訊號語義的後端。

## 備選方案

**用 PTY 替換 `bash`、檔案系統工具或 task 工具。**拒絕。一次性工具擁有更強的校驗、審批、沙盒、輸出上限和重播約定。PTY 只服務互動式狀態。

**給 `bash` 增加持久模式。**拒絕。按就緒而不是行程退出返回、跨呼叫保留行程樹、暴露互動式 stdin 會形成不同的所有權和失敗約定。

**要求從 `node-pty` 取得原生 master fd。**拒絕。它的公共 API 不暴露 master fd。本機子行程終端機配接器改為從受支持的 OS 行程元資料推導前臺組與子孫行程，並把不可讀元資料視為 detector miss。

**向根 PID 所屬 POSIX 工作階段的全部成員傳送訊號。**拒絕。`node-pty` 可能暴露屬於啟動器工作階段的 helper PID，因此按 SID 清理可能向無關的 harness 或桌面行程傳送訊號。帶 PID 啟動身份校驗的子孫行程樹範圍更窄，其安全邊界由結構保證。

**發布可替換登錄檔 `TerminalIdleDetector`。**拒絕。基底專用的前臺事實來自掛載的終端機行程原語，提示符／靜默就緒判定則仍是 `dsh-terminal-bash` 內部的一項私有策略。替換檔案系統／子行程執行環境就是所需擴充點。

**新增 PTY 專用 `sleep` 工具。**拒絕。`ctx.jobs` 已經擁有有界等待、取消、完成通知和麵向模型的收集。第二套通用喚醒機制會跨越 agent loop（代理循環）邊界並重複該約定。

**包含 TUI sequence 與 BEL 處理。**拒絕。源 prototype 將這些路徑視為 timing-sensitive，且仍記錄未解決的 alternate-screen 和互動失敗。行式 PTY 已能證明核心價值，無需把未經驗證的行為放進基礎層。

**立即採用行程外 daemon。**初始的行程內能力不採用，因為當前長駐的執行入口已能維持 Cordis 上下文。跨行程復原或多用戶端附加會讓 daemon 變得合理，但兩者都已推遲。

## 驗證

- 逐文件覆蓋測試鎖定了 owner 隔離、並行預留、寫入前檢查期間的取消、未發布 spawn 的取消與等待式 teardown、沙盒模式變更拒絕、可重試的生命週期清理、就緒層級、對寫入前 stdin 等待與延遲到達的先前 prompt 的拒絕、設定化交接寬限把 idle fallback 頂過一次輪詢以及低於 `pollIntervalMs` 時的拒絕、sanitizer carry state、完整 UTF-8 結果上限、task 整合、schema 和精確 render intent。
- 子行程 fixture（測試前置資料）覆蓋非 leader 與非主線程的 stdin 等待、殭屍行程完全靜止、不可讀行程狀態、受支持的 syscall 表、不支持的架構和誤報拒絕；同一單元測試套件透過注入覆蓋 macOS 檢查器邏輯。
- 真實 `node-pty` 與 PTY 消費端測試共同在受支持宿主上覆蓋 shell 狀態、共享沙盒策略、環境清洗、raw mode 前臺 `SIGINT`、忽略 `SIGTERM` 的後代行程，以及 dispose 返回後立即完全靜止。
- Loader 驅動的 `cordis.yml` 測試掛載真實三包組合。ACP 與 headless 快照透過 opt-in overlay 固定 6 個 schema、有界結果和錯誤；TUI 快照固定 terminal 與 generic 卡片展示。
- 包約定、架構圖、子系統頁面、生成目錄和 website API 描述同一個已發布介面。

## 後果

**無需削弱一次性工具即可獲得持久終端機狀態。**Shell 與 REPL 狀態可以跨工具呼叫保留，而 `bash`、`read`、`write` 和 `edit` 繼續擁有更窄的校驗、審批與重播約定。

**Linux Tier 1 之外的 idle 都是啟發式結果。**輸出靜默無法區分 prompt、sleep 和網路 I/O。類型化結果保留不確定性，有界 timeout、task 等待與訊號讓模型仍能掌握控制權。

**精確歸因與推斷歸因的邊界是延遲取捨，不是可消除的競態。**歸因取決於核心在靜默上限到達之前還是之後發布前臺交接，因此任何固定寬限都是一次調度上的賭注。`handoffGraceMs` 把這個賭注交給部署設定：調大它可以在慢速或高負載主機上換到精確的 `stdin_read` 歸因，代價是見過 prompt marker 之後的互動返回延遲；調小則相反。不應相依性勝負結果的測試使用不會出現在輸入回顯中的 token，斷言下一次 send 中由子行程產生的輸出，而不是斷言歸因路徑。

**持久狀態可能偏離模型認知。**模型可能忘記 cwd 或活躍 REPL。工作階段摘要和保留輸出有助復原，但任何提示詞都無法讓狀態持久化變成確定行為。

**daemonized 後代行程可能離開本機提供方捕獲的行程樹。**在 teardown 前 reparent 的行程無法再從 `node-pty` 根行程發現。本機終端機原語接受這個清理缺口，不冒險按 SID 向無關行程傳送訊號。

**Shell 可以造成外部副作用。**工作階段沙盒和環境清洗降低本機暴露，但無法復原 push、API 呼叫或訊息傳送。無法容忍這些副作用的部署必須省略 PTY 或增加網路策略。

**行程丟失會銷毀終端機狀態。**行程內工作階段無法跨 harness crash 或 restart 存活，原始 scrollback 也不持久化。重要工作必須提交到文件或其他持久系統。

**`node-pty` 是 `dsh-subprocess-local` 的原生相依性。**安裝、支持的 Node 版本、prebuild 可用性和平臺行為都需要在每個支持 OS 上執行建置產物冒煙測試。
