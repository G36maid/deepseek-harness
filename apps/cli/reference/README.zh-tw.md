# `dsh` CLI（命令列介面）行為參考

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

本參考定義 profile 啟動、web 別名、外掛程式管理和設定 dump 等命令模式。argv 由 [`src/args.ts`](../src/args.ts) 統一解析一次，[`src/bin.ts`](../src/bin.ts) 只會動態匯入選中的執行器。

## Profile 啟動

`dsh --profile <name>` 啟動位於 `$DSH_HOME/profiles/<name>` 的 profile。生效設定樹以空根節點為起點，依次疊加 profile manifest（中繼資料清單）的 `dsh.profile.bundles` 清單中指定的各組合包 patch、profile 自身的 `cordis.patch.yml`、home 級的 `$DSH_HOME/cordis.patch.yml`（這是各 profile 共享的機器本機偏好，因此優先於逐 profile 設定層），以及按 argv 順序指定的各個 `--patch <path>` 覆蓋層。對同一設定行，後應用的層優先。patch 會替換目標行的整個 `config` 值，而不是深度合併其中的鍵；patch 也可以插入新行。設定解析、schema 校驗、模組解析或外掛程式啟動失敗時，系統會報告錯誤並以非零狀態退出。收到 SIGINT 或 SIGTERM 時，掛載的根節點會先 dispose（資源釋放）再退出。

組合包名稱先從 dsh 安裝目錄解析，再從 profile 目錄解析。因此，內建組合包（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-headless`）始終來自當前執行的 `dsh` 所屬的安裝；樹外組合包則來自 profile 中由 pnpm 管理的 `node_modules`。patch 行中的裸外掛程式 `name` 會從 profile 目錄開始，按照 Node 的模組解析規則逐級向父目錄尋找，直至由 dsh 維護的安裝後備目錄 `$DSH_HOME/profiles/node_modules`。該目錄為 dsh 安裝中的應用和組合包所相依性的每個包各維護一個符號連結，並在每次啟動時修復這些連結。

`web` 和 `headless` profile 首次使用時會從隨附範本自動初始化（`web`：base + web-app；`headless`：base + headless）。其他缺失的 profile 會顯式報錯，並提示執行 `dsh plugin --profile <name> add <package>`。

### 應用參數

啟動器自身的 flag 必須寫在最前面，並在遇到第一個無法識別的 token 時結束；從該 token 開始的所有內容都會透過 `ctx.cmdlineArgs` 原樣交給已啟動的 profile，注入該 profile 的任意應用外掛程式都可以解析這些內容（[`dsh-cmdline`](../../../packages/boot/cmdline/README.md)）。因此，`dsh --profile web --port 8080` 會將 `--port` 交給 web 應用；`dsh --profile web --help` 只列印該應用的幫助資訊，不啟動應用；`dsh --help` 沒有可供交付參數的 profile，因此會列印啟動器自身的幫助資訊。`-V`/`--version` 位於應用參數邊界之前時，會列印啟動器的版本。

每套組合只會掛載一次。普通外掛程式注入 `cmdlineArgs`，解析所屬應用的參數，並將解析結果作為服務提供。每個從 flag 取值的設定行都會注入該服務；Loader 會等到服務啟用後，再對該行的設定求值（`port: !!js ctx.webStartup.port ?? 3080`），因此 flag 的優先級高於設定行中寫明的值。要維持這一優先級，設定行必須保留該表達式；如果使用者 patch 用字面量替換整個 `config`，也會隨之移除執行時期讀取。幫助參數和被拒絕的參數都會請求退出：參數被拒絕時以非零狀態退出，顯示幫助時以 0 退出；相依性該提供方服務的設定行不會啟用。線上編輯 `cordis.patch.yml` 時，系統會根據仍在執行的服務重新計算表達式，因此不會重設當前正在使用的埠。

啟動器的 flag 必須寫在應用參數之前，且啟動器的解析器會消耗掉一個 `--`：必須以字面量 `--` 送達應用的參數需要寫成 `-- --`。如果應用的第一個參數恰好等於 `web` 或 `plugin`，會選擇對應的子命令。`ctx.cmdlineArgs.get()` 是共享的不可變讀取：多個外掛程式可以解析同一份快照，沒有讀取方的 profile 則會忽略自己的應用參數。

隨附的應用接受以下命令列參數：

| Profile | 參數 |
|---|---|
| `web` | `--host`、`--port`、可重複的 `--trusted-host` |
| `headless` | 任務文字，作為位置參數 |

一次性任務（`dsh --profile headless "run the tests"`）透過核心登錄檔建立一個全新的持久化 Agent（代理），提交任務、等待完全靜止並對工作階段執行 flush，再從其持久化事件區間中推導最後一個非空 assistant 文字與最終 `turn/end` 原因。它在 stdout 列印文字，並在原因為 `completed` 時以 0 退出，否則以 1 退出。沒有任務的呼叫是該應用的用法錯誤。隨附 headless profile 不掛載 ApiProxy、Host、HTTP 伺服器、Web 執行時期或瀏覽器用戶端；成功執行不會向 stderr 寫入任何內容，也不會打開監聽埠。

可在不啟動的情況下檢查組合出的設定樹：

```sh
dsh --profile web --dump-default-config
dsh --profile web --patch ./extra.yml --dump-config
```

`--dump-default-config` 只列印組合包各層；`--dump-config` 額外加上 profile 的 `cordis.patch.yml`、home 級的 `$DSH_HOME/cordis.patch.yml` 和 `--patch` overlay。兩者都會列印註釋，標明每行由哪個文件提供，以及哪些 overlay 修改過它；`!!js` 表達式保持未求值，找不到目標的 patch 會報告到 stderr。dump 操作不會執行應用的命令列參數提供方，因此展示的是解析任何應用參數之前的組合設定樹；如果呼叫中包含應用參數，dump 會拒絕該呼叫。

## 外掛程式管理

`dsh plugin --profile <name> <args...>` 在 profile 缺失時先初始化它（有隨附範本的用範本，其他名稱只裝 `@deepseek-ai/dsh-base`），然後以 profile 目錄為工作目錄，把 `<args...>` 轉發給 `pnpm`：`add`、`remove`、`why`、`update` 及其他所有 pnpm 子命令都照常可用；pnpm 必須在 PATH 上。相對路徑 spec（`.`、`../plugin` 及其 `file:`/`link:` 形式）會先錨定到呼叫目錄，因此在外掛程式 checkout 中執行 `add .` 安裝的是該 checkout，而不是 profile。每次成功執行後，系統都會根據當前安裝狀態更新 `dsh.profile.bundles`：如果某項相依性解析到的包在 manifest 中聲明瞭 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`，該相依性就會加入設定層棧；如果某項相依性在 `update` 後獲得該聲明，也會隨即啟用。沒有組合包聲明的相依性仍作為普通相依性保留，並顯示一次性警告；已移除的相依性則從設定層棧中刪除。

```sh
dsh plugin --profile tui add github:deepseek-harness/turtle-ui
dsh plugin --profile tui remove turtle-ui
dsh --profile tui
```

隨原始碼發布的 Git 託管外掛程式會在安裝期間透過 `prepare` 指令碼建置，而 pnpm ≥10 默認會阻止該指令碼，直到使用方明確允許。首次執行 `add` 會失敗，並顯示 pnpm 的 `allowBuilds` 提示；dsh 還會提示應修改該 profile 的 `pnpm-workspace.yaml`。將輸出的鍵複製到該文件後，重新執行命令即可。安裝已經建置好的 tarball 或本機 checkout 時，無需加入 `allowBuilds`。

## Web 別名

`dsh web` 是 `--profile web` 的硬編碼別名；寫在它之後的 flag 屬於 web 應用，由組合包中的普通提供方解析。`--host` 和 `--port` 覆蓋承載它們的那些行的組合取值，可重複的 `--trusted-host` 透過 `ctx.webRuntime.trustedHosts` 提供本次呼叫的 authority（部署表達式會拼接自己的 authority），用戶端外掛程式 HMR（熱模組替換）接收器始終掛載，在單獨執行的 `pnpm run dev:web` watcher 重建用戶端 bundle 之前保持空閒。

```sh
dsh web
dsh web --patch ./extra.cordis.yml
dsh web --dump-config
dsh web --help
```

生產 Web 執行器需要已建置的包和前端產物（`pnpm run build`）。默認服務地址是 `http://127.0.0.1:3080`。CLI 目前有意不支持 `--host 0.0.0.0`，並會以用法錯誤退出；`--trusted-host` 可新增 `/api` 瀏覽器信任圍欄接受的具名 authority。

行程關閉時，外掛程式樹最多有 5 秒完成 dispose。首次收到 `SIGINT` 或 `SIGTERM` 時會開始優雅排空：`SIGTERM` 是監督行程寄出的常規停止請求，在所有執行模式下都以 0 退出；`SIGINT` 則報告 130。第二次收到訊號時會立即強制退出。如果一次性執行在正常結束時已經卡在 dispose 階段，第一次按下 `Ctrl+C` 就會直接升級為強制退出，而不會被忽略。

所有模式都將執行命令時所在的目錄作為默認 workspace 根目錄，以 65,536 位元組渲染預算載入適用的 `AGENTS.md` 或 `CLAUDE.md` 指令，並使用記憶體 SQLite 工作階段內容索引。每次啟動 profile 時，系統都會監視 profile 與 home 兩個 `cordis.patch.yml` 設定層的有效變更，並以交易方式重新應用；一次性執行模式透過有界關閉流程退出，該流程會先 dispose 監視器。

新工作階段默認使用 `workspace-write` 權限預設。Bash 和檔案系統修改僅限於工作階段 workspace 與平臺臨時根目錄；讀取、網路訪問和行程可見性不受限制。`DSH_PERMISSION_MODE` 更改行程後備值。General settings 中儲存的權限影響後續 Web 工作階段，不改變已打開的工作階段。

`DSH_TOOLS_MODE` 為行程選擇 `native`、`code` 或 `both`；其他值會導致啟動失敗。隨附的 `minimal` agent preset 會保留該部署的呈現方式，將完整系統提示詞固定為 `You are a helpful software engineer assistant.`，並且僅組合持久 `bash` 和 `str_replace_editor`。建立 Web 工作階段時請選擇極簡模式；該 agent 不包含任何其他提示詞段落或面向模型的外掛程式，而共享的瀏覽器、workspace、持久化、沙盒與權限宿主保持不變。

## 共享部署行為

基礎組合包掛載原生 DeepSeek 配接器、settings 與憑據提供方、穩定的 `web_search` 和已停用的工作階段遙測。提供方憑據依次從繼承環境、`$DSH_HOME/.credentials.yaml`、呼叫目錄的 `.env` 和 `$DSH_HOME/.env` 解析；受管文件從不物化進 `process.env`，而兩個 `.env` 文件都是普通啟動環境層。搜尋使用 `DEEPSEEK_API_KEY` 並接受 `DEEPSEEK_SEARCH_BASE_URL`；只有 patch 層插入提供方並啟用 `web_fetch` 後，該工具纔可用。

工作階段遙測默認留在本機。`DSH_TELEMETRY_MODE=FULL` 將每條已投影工作階段事件作為 OTLP/HTTP 日誌流式傳送，`DSH_TELEMETRY_MODE=FEEDBACK_ONLY` 則僅在記錄回饋時上傳工作階段日誌後綴。`DSH_TELEMETRY_OTLP_URL` 選擇其他 collector。任何非空的 `DSH_TELEMETRY_DISABLED` 都是具有最終效力的遙測強制關閉開關。隨附基礎設定沒有遙測脫敏規則，因此顯式啟用的匯出可能包含訊息文字、工具參數和結果，以及 workspace 路徑；相關部署決策見[預設關閉 Agent Note](../../../.agents/notes/implemented/feature/2026-08-10-telemetry-default-off.md)。

透過 `dsh plugin --profile <name> add <package-or-git-spec>` 安裝外部外掛程式組合包。安裝的包擁有其相依性，並貢獻其聲明的 `cordis.patch.yml` 層。CLI 還隨附 `@deepseek-ai/dsh-mcp-client` 作為供 patch 層使用的相依性，但默認不啟用 MCP 伺服器，因為每條伺服器命令都是 agent（代理）沙盒之外的受信任可執行程式碼。

## 原始碼執行

請在倉庫根目錄中，於全新 checkout 之後及產物需要更新時單獨執行 `pnpm run build`，然後使用 `pnpm dsh <args...>`。`package.json` 中的指令碼不會建置，而是透過 `node --import tsx/esm` 啟動 `apps/cli/src/bin.ts`，並轉發所有參數。Typert Host 產物缺失時，profile 啟動會因不含建置指引的模組解析錯誤而失敗。這些 Host 產物存在後，如果前端或 Client plugin 組合包缺失，啟動會失敗並提示執行 `pnpm run build`。啟動器不會檢查產物是否為最新，因此已有的過時組合包可能繼續執行舊版瀏覽器程式碼，直至重新建置。該行程會繼承啟動環境；當支持環境代理的 Node 版本必須遵循 `HTTP_PROXY` 和 `HTTPS_PROXY` 時，請設定 `NODE_USE_ENV_PROXY=1`。安裝形式會直接啟動建置後的 `apps/cli/lib/bin.js`，不會重新建置倉庫。
