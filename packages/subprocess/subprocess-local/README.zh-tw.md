# @deepseek-ai/dsh-subprocess-local

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

[`@deepseek-ai/dsh-subprocess`](../subprocess/README.md) seam 的本機 Service Provider。`LocalSubprocessRuntime` 解析本機可執行文件，以顯式 stdio spawn 普通 detached 行程樹，並透過 `node-pty` 加平臺行程檢查實作終端機行程。該實作沒有任何設定：每項處置方式、限制、終端機尺寸、寬限期與目錄都來自呼叫方能力 seam（[`dsh-bash-local`](../../shell/bash-local/README.md)、[`dsh-lsp-stdio`](../../lsp/lsp-stdio/README.md) 和 [`dsh-terminal-bash`](../../terminal/terminal-bash/README.md)）。

## 行為

- **以適合平臺的方式傳送訊號的 detached 行程樹**：POSIX 子行程使用 `detached` spawn（擁有獨立行程組），訊號以負 pgid 傳送並以直接子行程作為回退；Windows 透過 `taskkill /PID <pid> /T /F` 終止行程樹。`terminate()`（控制代碼唯一的終止操作）先發送 SIGTERM，經過 spec 的寬限期後再發送 SIGKILL（沿用 OpenCode 的升級策略；管線與子 shell 會隨父行程一起結束），行程樹消亡後為空操作；`waitForExit()` 輪詢整棵行程樹的存活狀態，使消費端的拆卸能確認真正的完全靜止。組長行程退出後，仍然打開的管道也只獲得同樣有界的排空寬限期，因此存活的後代行程無法無限期地拖住結果不結帳。系統會容忍 ESRCH；重新指定父行程並脫離該組的 daemon 仍可能存活。
- **按流劃分的處置方式**：`'pipe'` 把原始流原樣交給呼叫方（協議分幀仍歸消費端所有）；`'inherit'` 直通父行程的描述符；收集模式（collect）在輸出超過上限後於記憶體中保留尾部（錯誤與結果通常聚集在末尾，沿用 pi/OpenCode 的理由），並在設定了 spill 上限時把完整流追加到一個私有暫存檔；省略 `spill` 則只保留用於診斷的尾部。某條流大於 spill 上限時，會丟棄已不完整的 spill，僅返回帶截斷標記的尾部；spill 文件描述符在結帳時封存，最終關閉失敗時則不公佈路徑，以免聲稱存在不完整的文件。spill 文件權限為 `0600`、名稱隨機，位於按需建立、權限為 `0700` 的每行程目錄之下。
- **憑據清除 + 顯式合併**：以 `process.env` 為基礎，移除形似憑據的變數（`*KEY*`／`*PASSWORD*`／`*SECRET*`／`*TOKEN*`）和所有環境中已有的 `DSH_*` 名稱；spec 的顯式 `env` 在該清除之後合併且不做命名空間校驗，因此有意提供的憑據或當前 `DSH_*` 事實會勝出，而過時的巢狀 harness 身份無法從環境中隱式漏入。提供的 stdin 會被寫入後關閉；否則 fd 0 指向 `/dev/null`。參見 [stdin/env Agent Note](../../../.agents/notes/implemented/architecture/2026-06-30-bash-stdin-env-trusted-plugin-api.md)與[受管環境 Agent Note](../../../.agents/notes/implemented/feature/2026-07-10-agent-session-identity-and-log-location.md)。
- **基於偏移量的讀取**：收集模式的讀取器按完整流的位元組坐標返回增量；服務自身從不持有遊標，因此消費端自有的遊標（bash 的後臺讀取路徑）與完整流重讀可以共存，結帳前後皆然。
- **可執行文件尋找**：`resolveExecutable` 檢查絕對文件，或根據平臺可執行文件擴充名在清理後的有效 PATH 中搜尋；含分隔符的相對路徑在該 seam 處被拒絕，相對 PATH 條目從宿主行程 cwd 解析。
- **終端機行程所有權**：`spawnTerminal` 分配 `node-pty`，橋接 UTF-8 終端機文字，檢查當前前臺行程組並向其傳送訊號，還會公開一項須等待的終止操作，在終止頂層 shell 前後清理後代行程。每次前臺檢查都會保留根行程樹中的精確身份；Linux 還會在 POSIX 工作階段 leader 退出後枚舉該工作階段。因此，之前觀察到的 macOS 後代以及同工作階段 Linux 成員在重新設定父行程後仍受圍欄保護，pid/start 身份則防止清理跟隨 PID 複用。上層 PTY 後端負責提示符就緒、緩衝區與面向模型的操作。
- **先終止再等待退出的 dispose（資源釋放）**：服務保留存活控制代碼，使自身的 dispose 能對每個仍在執行的行程樹執行升級並等待其退出；完全靜止與 spawn 失敗的控制代碼會在整棵行程樹或 terminal session 清理完成後離開存活集合。
- **同步宿主退出最終清理**：服務 effect 仍有效時，Node `exit` listener 會強制終止同一組存活集合中仍存在的每棵普通行程樹和可觀察 terminal session。這些僅供本機實作使用的操作會向受管 POSIX 行程組傳送 SIGKILL、在 Windows 執行 `taskkill /T /F`，並在終止 PTY root 前後同步向已捕獲及當前可觀察的 terminal 身份傳送訊號；它們不會建立 Promise 或 timer，不改變宿主退出碼與診斷，會分別包含每個目標的失敗，也不會聲稱已經完全靜止。正常 dispose 仍使用上面的須等待溫和路徑。參見[宿主退出清理決策](../../../.agents/notes/implemented/bug-fix/2026-08-11-synchronous-subprocess-exit-cleanup.md)。

## 模型體驗

透過 Consumer 間接影響（目前是 `dsh-tool-bash` 背後的 bash 執行器家族）；行程輸出與生命週期面向模型的全部渲染歸 Consumer 所有。

#### KV Cache 影響

不會直接導致 KV Cache 失效；請求前綴變更由上述消費端負責。

## 已知限制與暫緩事項

- **Windows 行程樹支持僅為盡力而為**：終止經由 `taskkill /PID <pid> /T /F` 完成，所有結果都被就地吸收，不向外拋出（行程樹已不存在、競態、二進位缺失），存活探測則回退到直接子行程邊界。
- **終端機行程檢查僅支持 Linux／macOS**：檢查器沒有受支持的平臺實作時，終端機原語會失敗；Linux 精確探針覆蓋 x64 與 arm64，macOS 則使用 `ps` 快照。
- **守護化的終端機後代仍可能逃出可觀察邊界**：在 macOS 上，子行程如果在任何前臺檢查快照之前重新設定父行程，將無法再從 `node-pty` 根行程發現；在 Linux 上，呼叫 `setsid` 的子行程會同時離開行程樹與自有終端機工作階段。本機提供方不會新增持續行程表監視器。
- **行程內清理要求退出階段仍能執行 JavaScript**：直接 `process.exit()`、默認未捕獲例外和默認未處理 rejection 會發出 Node 同步 `exit` 事件。未安裝 handler 時，`SIGTERM`、`SIGINT` 或 `SIGHUP` 的默認 OS 處置不會發出該事件；應用只有安裝執行正常 dispose 或呼叫 `process.exit()` 的 handler 才能覆蓋這些訊號。`SIGKILL`、fatal OOM、`process.abort()`、native crash、斷電，以及任何無法執行 JavaScript 的故障，都需要外部 supervisor、容器 init 或等價的 OS 所有者負責。
- **憑據清除相依性名稱啟發式規則**：只匹配 `*KEY*`／`*PASSWORD*`／`*SECRET*`／`*TOKEN*`；名稱不同的 secret（例如 `*PASSPHRASE*`）會繼續傳遞，對誤刪變數引入白名單屬於已記錄的後續工作。
- **不會刪除已完成的 spill 文件**：有界的完整輸出復原文件（以及每個行程的私有 spill 目錄）會在 OS tmpdir 下累積，直到外部機制進行清理；超大的不完整 spill 會被丟棄並立即嘗試刪除，但清理失敗可能留下一個有界文件。

原始行程處理位於 `src/spawn.ts`；`src/index.ts` 負責服務接線。
