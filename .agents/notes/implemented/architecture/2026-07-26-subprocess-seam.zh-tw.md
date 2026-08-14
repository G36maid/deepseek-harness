# Agent Note: 行程服務是 bash 執行器之下的獨立 seam（`dsh-subprocess` / `dsh-subprocess-local`）

Status: implemented

[English](2026-07-26-subprocess-seam.md) | [简体中文](2026-07-26-subprocess-seam.zh.md) | 繁體中文

## 問題

`dsh-bash-local` 原先把兩項因不同原因而變化的能力捆綁在一起：*執行一條 bash 命令*（命令預設值補全、逾時分類、對模型友好的終端機環境、bash 工具所渲染的 stdout/stderr 合併）與*執行並管理一個子行程*（detached 行程組、附帶 spill 文件的有界尾部保留輸出、憑據清除與 `DSH_*` 合併次序、SIGTERM→寬限期→SIGKILL 升級、先終止再等待退出的 dispose（資源釋放））。行程這一半（`run.ts`）約佔整個包的一半，卻沒有屬於自己的 seam：未來的非 shell 執行器（直接執行 argv 的執行器、worker supervisor）將不得不重新實作這套機制，或者探入 bash 內部；而共享的 `DSH_*`/`CollectedOutput` 詞彙則存放在一個名字承諾 shell 語義的包裡。這種捆綁還把後臺行程的存續期系在執行器的 fiber 上：重載 bash 執行器會殺死每一個存活的後臺行程。這一點不同於兄弟的[任務登錄檔](2026-07-26-job-registry-seam.md)：後者的註冊存續期刻意長於生產方 fiber。

## 決策

新的 `subprocess/` 能力家族擁有「執行並管理一個行程」；bash 家族保留「執行一條 bash 命令」，並成為前者的消費端：

- **`@deepseek-ai/dsh-subprocess`（Service Definition）**——擁有 `ctx.subprocess` 的抽象 `SubprocessRuntime`：可執行文件尋找、完全顯式的普通 spawn，以及[可移植執行環境決策](2026-07-28-portable-execution-world-consumers.md)新增的終端機原語。每條 stdio 流獨立選擇 `'pipe'`、`'inherit'` 或有界收集 `{ maxBytes, spill? }`；stdin 選擇 `'ignore'`、`'pipe'` 或 `{ data }`。`SubprocessOutcome` 只承載刻意不含逾時／取消分類的退出事實，收集輸出在結帳後仍留在控制代碼上。該 Service Definition 還擁有行程與終端機控制代碼、共享憑據清除，以及 `DSH_ENV_PREFIX`/`DshEnvironment`/`CollectedOutput`；`argv` 絕不經過 shell 解釋。
- **`@deepseek-ai/dsh-subprocess-local`（Service Provider）**——`LocalSubprocessRuntime` 建置在原 `run.ts` 管道（現為 `spawn.ts`）與 `node-pty` 之上：detached 行程組、有界收集與私有 spill 文件、可執行文件尋找、前臺／工作階段檢查，以及終止每個受管行程並等待其退出的 dispose。`terminate()` 擁有面向行程樹的 TERM→寬限→KILL，`waitForExit()` 觀察行程樹存活性，可注入的 `taskkill /T` 覆蓋 Windows。普通與終端機 spawn 都先應用 Service Definition 對 `KEY`/`PASSWORD`/`SECRET`/`TOKEN` 不區分大小寫的清除，再合併顯式 env。該 Service Provider 沒有設定；每項限制都隨 spec 到達，Bash 與 PTY 的呈現環境覆蓋仍歸各自 Consumer 所有。
- **`dsh-bash-local`（Consumer）**——`inject: ['subprocess']`；把每個解析後的 `ShellExecSpec` 對映為一個 `SubprocessSpawnSpec`（`['bash', '-c', command]`），並保留自身設定、`resolve()` 預設值補全、基於融合 deadline 的 `timedOut`/`aborted` 分類、帶 `[stderr]` 標記的後臺讀取合併及其消費遊標，以及 `onProcessDone` 子類掛鉤。`dsh-bash-sandbox` 除了重新聲明繼承來的 inject 之外沒有變化；它仍在命令字串層面做包裝，並重新進入繼承的 spawn 路徑。
- **`dsh-shell`（Service Definition）**——把遷走的詞彙從 `dsh-subprocess` 重匯出，因此沒有任何 bash Consumer 需要改動匯入；`ShellExecRequest`/`ShellExecSpec`/`ShellProcess` 與沙盒事實仍歸 bash 所有。

每個載入 bash 執行器的組合都同時載入 `@deepseek-ai/dsh-subprocess-local`：CLI（命令列介面）、各示例、Python 捆綁執行時期以及各內聯測試設定。

後臺行程的存續期從執行器移到了服務：執行器不再保有存活行程集合，於是重載執行器後，後臺工作會繼續執行且仍可讀取，而組合拆除（服務的 dispose）仍是先終止再等待退出的邊界。一條行為約定隨之挪動：後臺 spawn 失敗不再能在管道內部被緩衝成偽造的 stderr（對一個從未真正執行的行程，服務會 reject `done`，且不緩衝任何內容），因此執行器把 `spawn failed: …` 提示注入恰好一個 `readOutput()` 增量。

基於已觀察到的流與生命週期需求，具備條件的行程消費端隨後遷到該 seam：LSP 使用管道化協議流加收集式 stderr 尾部；ACP（Agent Client Protocol）後端使用管道化 ndjson、繼承式 stderr 和消費端擁有的 stdin-EOF dispose 階梯；PTY 使用 `spawnTerminal()`，同時保留就緒與終端機策略。`dsh-subagent-subprocess` 與 LSP 私有行程樹輔助函式均被刪除。MCP 傳輸 spawn 和刻意保持輕相依性的 test-support 啟動器因所有權或執行形狀仍留在外部；適用的生產呼叫方共享憑據清除。

## 曾考慮的替代方案

**把行程管道留在 `dsh-bash-local` 裡（維持現狀）。**否決的理由與[任務登錄檔拆分](2026-07-26-job-registry-seam.md)得以落地的理由相同：這條邊界既穩定，也早已記錄在程式碼裡（`run.ts` 的模組文件曾寫明「this layer reacts to an abort signal; the executor owns deadlines and classifies causes」），而若繼續將它保持私有，未來每個非 shell 執行器就只能要麼 fork 這套機制，要麼為非 bash 工作去相依性一個以 bash 命名的包。本次變更對使用者可見的動因正是這一拆分。

**保留最初只支持批次的介面，讓流式消費端繼續各自實作。**否決：已觀察到的 LSP、ACP 與 PTY 形狀表明，這會繼續保留重複的私有行程樹訊號與環境清除。Node 形狀的處置方式覆蓋這些消費端，又不緩衝管道化流。

**用單個 `stdio: 'pipe' | 'inherit' | 'collect'` 模式統一全部流。**否決：真實消費端按流混用模式——LSP 使用 pipe/pipe/collect，ACP 使用 pipe/pipe/inherit，Bash 使用 data/collect/collect。

**把每一次行程啟動都路由到 `ctx.subprocess`。**否決：MCP SDK 擁有其傳輸 spawn，support 啟動器則刻意獨立於產品 seam。PTY 分配遷到 `spawnTerminal()`，因為這項底層專用原語歸提供方而非消費端所有。

**改把 `run_in_background`/任務語義放進 subprocess 能力 seam。**否決：那條邊界已經存在。`ctx.jobs` 擁有 id、所有權與通知，bash 工具則把 `ShellProcess` 適配成任務掛鉤。subprocess seam 位於 bash 執行器*之下*，而不是與任務登錄檔並列。

**把 `ENV_OVERRIDES`（TERM=dumb、PAGER=cat 等）移入服務。**否決：通用行程服務不得把終端機呈現策略強加給非終端機消費端；對環境中憑據形態名稱與 `DSH_*` 名稱的清除是安全與身份不變式，予以保留，但終端機友好性是 bash 工具自己的選擇，經 spec 的顯式 env 表達，而呼叫方自己的條目依舊優先。

## 後果

換來的是：「執行並管理一個行程」成為 Bash、LSP、PTY 與 ACP 消費端共用的可替換能力；容器化或遠端行程後端可以直接接入，而無需改變各領域語義；行程樹訊號、升級終止、有界收集、終端機機制與憑據清除各自只剩一份實作；後臺行程也能在執行器重載後存活，與任務登錄檔的存續期模型一致。行程與終端機管道透過 `dsh-subprocess-local` 測試；消費端測試套件只需針對真實服務固定各自擁有的行為。

代價是：多出一對包，而且凡載入消費端之處都多一行組合設定；缺少 subprocess 提供方時，消費端會按標準服務注入行為保持掛起。每個後端都要實作可執行文件尋找、三種 stdio 模式、行程樹生命週期和一個終端機原語。遷移詞彙的重匯出讓 `dsh-shell` 的匯入繼續可用，但也意味著兩個包命名同一批類型；行程 seam 是所有者。spawn 失敗提示經由 Bash 的消費式讀取遊標變為單次交付，不再是可重複讀取的 stderr 緩衝內容。
