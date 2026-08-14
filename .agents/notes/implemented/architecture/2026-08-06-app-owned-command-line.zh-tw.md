# Agent Note: 應用透過 `ctx.cmdlineArgs` 持有自己的命令列

Status: implemented

[English](2026-08-06-app-owned-command-line.md) | [简体中文](2026-08-06-app-owned-command-line.zh.md) | 繁體中文

## 問題

profile 落地之後，組合可以安裝，命令列卻不能。`apps/cli` 仍然聲明著 Web flag 家族（`--host`、`--port`、`--dev`、`--workspace-root`、`--trusted-host`）和一次性任務位置參數，再為自己硬編碼的行 id（`webserver`、`api-gateway`、`connection`、`web-runtime`）派生 patch。像 [turtle-ui](https://github.com/deepseek-harness/turtle-ui) 這樣的樹外應用能貢獻行，卻無處接受一個 flag：`dsh --profile tui --resume <session>` 沒有地方可供解析，而 `dsh --profile web --help` 列印的是啟動器的 help，而不是 web 應用的 help。

## 決策

啟動器只解析屬於自己的部分（`--profile`、`--patch`、設定 dump），並把**自己 flag 之後的一切**原樣交給引導起來的設定樹。切分按位置進行：啟動器不認識的第一個 token 就是應用參數的起點（依靠 commander 的 `passThroughOptions` + `allowUnknownOption` + `helpOption(false)`）。裸的 `dsh -h` 沒有可交付的應用，仍然列印啟動器自己的 help。

新包 `@deepseek-ai/dsh-cmdline` 持有這次交接。啟動器在任何條目掛載之前呼叫 `provideCmdline(ctx, host)`，提供 `ctx.cmdlineArgs`（其全部介面就是 `get(): readonly string[]`）與 `ctx.appExit`。任何普通應用外掛程式都可以注入 `cmdlineArgs`，用自己的 commander program 呼叫 `parseCmdline(ctx, program)`，再在 program 自己的 action 中把解析出的取值作為應用自有服務提供出去。它的 Loader 行不攜帶啟動器標記或特殊類型，啟動器也不會檢查組閤中的所有者。多個外掛程式可以讀取同一份不可變快照；沒有讀取方的 profile 會忽略自己的應用參數。由提供方設定的行注入其服務，並在惰性設定表達式中直接讀取它（`port: !!js ctx.webStartup.port ?? 3080`），因此 flag 勝過寫在它旁邊的值，也沒有任何東西被寫回任何一行。

boot 只掛載一次整套組合。Cordis 讓每一行等待其注入啟用；Loader 隨後在啟用前一刻，基於已注入就緒的外掛程式上下文插值該行的 `!!js`。Include 會保留巢狀的行表達式，直到目標行到達這一時點。`--help` 會讓提供方服務保持缺失，因此相依性行永不啟用；活動 patch 重載會針對仍然線上的服務再次插值，所以已經服務中的埠不會被悄悄重設。

已交付的各應用把自己的 flag 搬進了組合包：`dsh-web-app` 持有 Web 家族，`dsh-headless` 持有任務位置參數，缺少任務時按用法錯誤拒絕。`apps/cli/src/web.ts` 已刪除；`runProfile` 不再知道任何 flag 目標行 id。在樹外，turtle-ui 以同樣的方式獲得了 `--resume <session>` / `--session <id>`，這纔是這套設計的真正驗證：一個已安裝的外掛程式加上了一個 flag，啟動器毫無改動。

還有兩條後果。Loader 會並行掛載兄弟行，因此一行可能已經啟用，而另一行仍在掛載，或整次 boot 正在回滾；所以 Web 組合包只會在自身的 Loader 設定樹結帳後公佈 URL。另外，Web 組合包的執行時期外掛程式也持有 harness 原始碼提示詞段，因此 `dsh web` 與 `dsh --profile web` 無需 Web 專用啟動器設定即可按完全相同的方式啟動。

## 為什麼由 Loader 持有順序

三條框架事實塑造了這套機制：

- **profile 的各行位於根 include 的 `patches` 選項內部。** Include 聲明瞭 `EntryGroup.key` 樹載體標記（與 Group 相同），因此 Loader 讓它的設定——條目與 patch 清單，包括 Include 自己的 `path`——保持字面值，而不是在 Include 上下文中遞迴求值巢狀的 `!!js` 節點；每個表達式都在其目標行的 fiber 中解析。
- **Cordis 只在所有聲明的注入都已啟用後才啟用 fiber。** 每次啟用前一刻，Cordis 會基於 fiber 自身上下文執行 `internal/config` waterfall；Cordis 快照注入服務之後，Loader 的監聽器再插值原始設定。
- **提供方替換與 HMR 必須保持相同契約。** fiber 重新啟用時會重跑 waterfall，HMR 會把原始設定帶給替換 fiber，而待處理行可以接受選項變更，不會針對缺失服務提前求值表達式。

這樣，相依性順序仍由負責它的 Cordis 啟用與 Loader 插值流程處理。各行保留自己的 `inject` 和設定，Loader 只掛載一次組合，啟動器只提供 argv 與行程生命週期服務。

## 曾考慮的替代方案

- **把解析出的取值寫進每一行**（逐行一次設定更新，外加交還給啟動器的一層 patch，使重載無法復原它）：它能工作，但這意味著 patch 在應用與啟動器之間來回傳遞、同一件事有兩套機制，以及一套其正確性相依性 Loader 重新啟動內部細節的回收重建。維護者否決了這次往返；供各行讀取的服務取代了這一切。
- **透過清空行的 `inject` 來放行**：孤立測試可行，在真實 web 樹上失敗，因為清空 `inject` 恰恰會丟失外掛程式的靜態注入。在外掛程式真的去讀它聲明過的服務之前，這個失敗是靜默的。
- **由啟動器管理兩趟掛載**：它可以讓提供方先於讀取行啟用，但會重複組合、把順序變成啟動器職責，還掩蓋了 Loader 的缺陷——巢狀表達式在 include 上下文而不是目標行的注入上下文中求值。
- **由啟動器在 boot 之前執行每個組合包的命令函式**（完全不經過 Cordis）：嚴格早於「先 boot 再 help」，但這會讓應用啟動成為設定樹之外的第二套外掛程式協議。使用注入 `cmdlineArgs` 的普通提供方只保留一套協議，並且仍可 dump、可 patch。
- **由啟動器強制指定命令列所有者**：拒絕零個或多個讀取方可以裁決 `-h` 等重疊項，但 `get()` 是不可變讀取，普通組合也可能需要多個應用自有服務。因此外掛程式共享該快照，並透過普通組合持有各自解析器的互動。
- **`instanceof CommanderError`**：樹外外掛程式會帶來自己的一份 commander 副本，類身份因此不同，已經列印出來的 `--help` 會被重新拋成致命的載入失敗。改為按結構識別 commander 的控制流錯誤。

## 後果

- 應用的 flag、help 文字和用法錯誤與它們所設定的行放在一起；給已安裝的外掛程式加一個 flag 不需要改動啟動器。
- 啟動器完全不識別任何應用行：telemetry 行仍是它唯一的組合探測（用於環境開關），SIGTERM 在所有 surface 上以 0 退出，每次啟動都監視使用者 patch 層，一次性 runner 像任何應用一樣經 `ctx.appExit` 退出。
- `--help` 會讓所有相依性提供方服務的行保持待處理並請求有邊界的退出；無關行可能在拆除前並行啟用。
- 應用自有服務沒有靜態聲明的提供方：交付了消費行卻缺少對應提供方的組合包會在結帳時失敗，報出指向該服務的待處理條目，而不是在載入時失敗。
- 使用者 patch 若整體替換某行的 `config`，會連同其中的表達式一起丟掉，該行上 flag 的優先級也隨之消失。
- 啟動器的 flag 必須寫在應用參數之前；如果應用的第一個參數恰好等於 `web` 或 `plugin`，會選擇對應的子命令；`-V`／`--version` 在該邊界之前仍歸啟動器持有；而且啟動器的解析器會消耗掉一個 `--`，因此要給應用傳一個字面量 `--` 需要寫成 `-- --`。
- `--dump-config` 從不執行應用命令列提供方，因此它在任何應用參數被解析之前列印組合，並拒絕攜帶應用參數的呼叫。
