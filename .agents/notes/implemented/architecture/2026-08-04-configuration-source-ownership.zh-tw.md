# Agent Note: 設定來源的統一順序，以及被發現的文件不得決定什麼

Status: implemented

[English](2026-08-04-configuration-source-ownership.md) | [简体中文](2026-08-04-configuration-source-ownership.zh.md) | 繁體中文

## Problem

`$DSH_HOME/.env` 剛剛[變成普通環境層](2026-08-04-credentials-yaml-and-user-environment-layer.md)，這使得 harness 解析面向使用者的值時面對的是一個壓平的 `process.env`，再也說不清某個值來自哪裡。由此產生三個後果。

透過 Web 頁面存下的金鑰仍然被使用者自己 `.env` 裡更舊的金鑰遮蔽，因為憑據提供方是拿「環境」與自己的文件比較，而現在環境包含了那個文件。這次拆分本該消除的遷移死路，只是換了個位置。

endpoint 可以被項目重定向。呼叫目錄的 `.env` 和其他層一樣會被物化，而 base URL 決定已解析的 API key 發往何處——於是寫進模型可編輯工作區的 `DEEPSEEK_BASE_URL`，會把使用者自己的憑據、以及承載其程式碼的提示詞，一起發給該文件指定的任何主機。壓平的檢視表無法把這件事和運維顯式 export 同一個變數區分開。

而已交付組合裡的 `!!js process.env.X` 讓同一個值有兩條抵達路徑：一條經 entry config，一條經消費端各自的 ladder，勝負取決於層序而非這個值的語義。

## Decision

**非機密值走同一條順序。** 每個本身不是憑據的可設定值都按同一順序解析；各領域的差別只在於哪些層存在。

```text
explicit for this run     per-operation override, CLI argument
> user settings           settings.yaml
> composition             profile bundles, user patch layers, --patch overlays
> this launch's shell     inherited process environment
> discovered file         <invocation cwd>/.env, then $DSH_HOME/.env
> defaults                schema default, provider public default
```


settings 在 composition 之上，因為 [settings seam](2026-07-28-user-settings-seam.md) 就是這麼做的：外掛程式把自己的 cordis entry config 註冊為 `base` 層，使用者 section 疊加其上，而 seam 無法區分某個值是 profile 的 bundle 設的，還是它的使用者 patch 層或某個 `--patch` overlay 設的——它們都以 entry config 的形式抵達。產品 CLI（命令列介面）沒有高於已存 settings 的手段，因此需要把某欄位釘死、不被使用者已存 settings 覆蓋的部署方，應自帶 bin 或 loader 設定樹，或者乾脆不掛載 settings 提供方。composition 仍然高於環境，所以 shell 裡過時的 `DEEPSEEK_BASE_URL` 無法改寫已設定的 endpoint。

**憑據保留一條更窄的獨立順序**，本 Note 不把它並入上表：

```text
inherited process environment      (read-only, wins)
> $DSH_HOME/.credentials.yaml      (provider-managed, writable)
> <invocation cwd>/.env
> $DSH_HOME/.env
```

繼承環境優先，因為 `DEEPSEEK_API_KEY=… dsh`、CI 機密與容器 `-e` 是運維必須能按次施加、且無需改動機器狀態的那一種覆蓋；而它無法從行程內部修改，就必須*可見地*只讀。設定本應只攜帶*引用*——解析哪個名字——該名字本身遵循上面的非機密順序。

**harness 被啟動於其中的項目默認可信，且不做詢問。** 一個 checkout 可以攜帶自己的 endpoint、自己的普通變數和自己的金鑰；金鑰排在受管儲存之下，因此透過 Models 頁存下的金鑰絕不會被 checkout 中恰好帶有的那一個頂掉。`LaunchEnvironmentSnapshot.getFrom(name, sources)` 仍然只搜尋呼叫方點名的層，省略某層仍是拒絕而不是降級——該機制是為「某一層必須不可達」的那些決策準備的，而項目層今天不在其列。

**信任不延伸到改變 harness 本身。** `loadLayeredEnv` 會在載入時、且在物化任何內容之前，拒絕任何設定了下列變數的 `.env`：決定行程如何啟動的（`PATH`、`SHELL`、`NODE_OPTIONS`、`LD_PRELOAD`）、決定執行時期在執行被要求執行的程序之前先執行哪些程式碼的（`BASH_ENV`、`PERL5OPT`、`PYTHONSTARTUP`、`RUBYOPT`、`JAVA_TOOL_OPTIONS`、Git 的掛鉤命令）、決定模型可見指令從哪裡載入的（整個 `DSH_*` 命名空間、`HOME`、`XDG_*`），以及決定網路如何訪問以及如何建立信任的（proxy 與 CA 變數）。匹配不區分大小寫，因此 `https_proxy` 不是繞過手段。

這條界線在於：它們無需任何使用者動作、在任何輪次開始之前、且在權限策略與沙盒之外就生效。`DSH_PERMISSION_MODE` 會關掉讓「信任項目」根本成立的那道審批，而 `BASH_ENV` 會在 bash 工具每次寄出 `bash -c` 時執行項目指定的文件——項目的程式碼在 agent（代理）的策略下執行是約定，項目改寫那份策略不是。一個變數一個變數地枚舉是必輸的遊戲，所以整個 `DSH_*` 命名空間被拒絕而不是隻拒絕一份經審查的子集，也所以這份清單是按變數*做什麼*而不是按哪個執行時期擁有它來組織的。不設逃生門：逃生門本身總得從某處讀取，而任何被發現的文件能設定的東西，就是那個漏洞本身。

**`packages/util/launch-environment` 擁有該快照**，刻意做成 utility 而不是三包能力 seam。快照在 Cordis 啟動前就凍結，並由啟動器一次性注入，因此不存在需要切換的執行時期實作；消費端需要的只是類型和純函式，而 `util/` 包能提供這些且不必相依性 UI 包。`launchEnvironmentOf(ctx)` 返回啟動器的快照，或者返回只含繼承環境的那一層——SDK 宿主或裸 `cordis.yml` 從未發現過任何文件，它那唯一一層確實就是它被啟動時的環境，因此同樣的受信查詢在那裡原樣繼續工作。

**`verify-config-source-ownership`** 僅作為一道窄閘門，檢查已交付 Cordis 設定中從環境內聯 `apiKey`/`baseURL`/`headers` 的普通單行寫法。刪除這些內聯正是「部署層」得以成立的原因——已交付設定樹對 `baseURL` 保持沉默之後，「有值」就意味著「人或部署設過它」。實際解析由配接器負責；該閘門不聲稱覆蓋倉庫範圍內的 `process.env` 訪問。

## Consequences

- Web 憑據表單現在能壓過使用者 `.env` 裡更舊的金鑰；只有在啟動 shell 裡 export 的金鑰才會讓它變成只讀，診斷資訊也會這麼說。
- 含 `DSH_*`、`PATH` 或 proxy 變數的 `.env` 會導致啟動失敗而不是被應用。把開關放在倉庫 `.env` 裡的開發者需要改放到 shell——這是一次刻意且響亮的破壞。
- composition 不再會被過時的 shell endpoint 覆蓋。但它仍然會被使用者已存的 `settings.yaml` 覆蓋，這是 settings seam 的分層方式，本 Note 不改變它；產品 CLI 沒有高於它的標志，因此需要壓過已存 settings 的部署方要自帶 bin 或 loader 設定樹。
- 未解決的：各層仍然會被物化進 `process.env`，因此普通項目變數繼續按子行程清洗規則抵達子行程。bootstrap 變數完全不能來自文件；環境包將其餘變數仍可抵達子行程這一點記錄為一項限制。
- Exa 與 Perplexity 仍在載入時捕獲金鑰，而不是經憑據 seam。它們不再讀裸 `process.env`——改為經受信層解析——但把它們改造成按請求解析憑據是另一件事。

## Alternatives considered

**按「來源由誰書寫」把憑據並入非機密順序。** 嘗試過並放棄：它讀起來很順，但 settings seam 已經把 composition 固定在使用者 section *之下*，因此「由部署方寫入」根本不是該 seam 能表達的一層；而把 `.credentials.yaml` 抬到啟動環境之上，會奪走 CI、容器和一次性 `DEEPSEEK_API_KEY=…` 所相依性的那唯一一種覆蓋。兩條各自說明優先順序的規則，好過一條兩邊都描述不準的規則。

**在項目被顯式信任之前，不給它路由與憑據能力。** 作為產品立場被否決：checkout 默認可信，不詢問，也不儲存信任記錄。殘留風險是真實的、值得寫明——克隆一個攜帶 `.env`、其中指定了另一個 endpoint 或金鑰的倉庫，會讓該工作階段經由它——處理它的地方是日後的 project trust 閘門，而不是一條讓常見情形都要走儀式的規則。

**審查出一份 `.env` 可設定的 `DSH_*` 白名單。** 否決：每新增一個開關都要重新審查，而遺漏的失敗模式是靜默的。拒絕整個命名空間是 fail safe。

**把 bootstrap 變數排在 process 層之下，而不是拒絕它。** 否決：`PATH` 和 `NODE_OPTIONS` 沒有有意義的「輸了之後」行為——把它寫進 `.env` 的使用者認為它生效，而靜默忽略正是本決策要消除的那種「我的設定沒有效果」。

**把快照做成三包能力 seam（`environment` / `environment-local` / 消費端）。** 作為過早拆分而否決：生產方在 Cordis 存在之前就執行，也沒有第二個實作需要選擇。倉庫規則是不要預先拆分。

**不再把各層物化進 `process.env`。** 延後而非否決：它能讓項目變數徹底進不了子行程，但會靜默破壞任何讀 `!!js process.env.X` 的使用者 patch 層。快照已經是 harness 解析一切的依據，因此這件事以後落地也不改變任何 ladder。
