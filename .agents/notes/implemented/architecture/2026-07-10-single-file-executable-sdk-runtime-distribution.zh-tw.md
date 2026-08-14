# Agent Note: 單文件可執行的 SDK 執行時期分發（single-exe）

Status: implemented

[English](2026-07-10-single-file-executable-sdk-runtime-distribution.md) | [简体中文](2026-07-10-single-file-executable-sdk-runtime-distribution.zh.md) | 繁體中文

## 問題

DeepSeek Harness 需要為 Python 庫專門提供一種無需安裝 Node、可直接在目標平臺執行的 SDK 分發形態：一個單文件可執行程序（下稱 exe），透過 stdio 提供 JSON-RPC 對外服務介面（`HarnessSdkJsonRpcServer`，Python SDK 的對端），且實際啟動的外掛程式與設定完全由 exe 外部輸入的 `cordis.yml` 決定。

- 與 Python SDK 通訊的 JSON-RPC 協議已經過驗證
- 需要提供一種讓 `cordis.yml` 載入所有外掛程式（ES 模組）的標準方式
- 分發物要自帶 Node 執行時期，並支持本機原始碼連結的除錯模式

## 決策

### 打包路線：@yao-pkg/pkg 的 `--sea` 模式

exe 使用 [@yao-pkg/pkg](https://github.com/yao-pkg/pkg)（vercel/pkg 歸檔後的活躍維護 fork）的 **`--sea`（enhanced SEA）模式**打包。相比 Node 原生 SEA，pkg 在其上增加 `/snapshot` 虛擬檔案系統（VFS）與執行時期模組掛鉤，將 ESM 入口原樣交給 Node 默認的 ESM loader，不相依性任何 ESM→CJS 轉譯。
> 實測（macos-arm64、node24 建置目標、pkg 6.21.0）：VFS 內裸包名 ESM 動態 `import()`（含頂層 `await`）、CJS 互操作、`node:sqlite`、集合外包名明確報錯、VFS 外磁碟 ESM `import()` 全部透過，`import.meta.url` 原樣為 `file:///snapshot/...`。

`--sea` 要求建置目標 ≥ node22，exe 統一以 node24 為建置目標；每次 pkg 呼叫只打包一個建置目標，多平臺各呼叫一次。

術語提醒：pkg 的 `/snapshot` VFS 與本倉庫測試體系的「快照」（ACP（Agent Client Protocol）重播預期輸出、`$DSH_SNAPSHOT`）無關，本文用「VFS」指前者。

### 對外服務介面也是外掛程式：sdk/server + examples/jsonrpc-demo 兩個包

確定性協議實作（`server.ts` / `transport.ts`）按 `acp/acp` + `examples/acp-demo` 的既有模式落為兩包——對外服務介面本身也是外掛程式：

- [`packages/sdk/server`](../../../../packages/sdk/server/README.md)（`@deepseek-ai/dsh-sdk-jsonrpc-server`）：純協議外掛程式；執行 `apply` 時，在行程 stdio 上掛載 `HarnessSdkJsonRpcServer` 與按行分隔的 JSON-RPC 傳輸層，資源釋放走 `ctx.effect()`。是否提供服務由 `cordis.yml` 決定；未掛載該外掛程式的設定會啟動一個不提供此服務的合法行程。協議級退出歸外掛程式所有（應答並確保 `shutdown` 回應傳送完畢後，對根執行時期執行 dispose（資源釋放），讓待處理的持久化操作完成，再呼叫 `exit(0)`；HMR（熱模組替換）式解除安裝只停止服務，不退出行程）。
- [`packages/examples/jsonrpc-demo`](../../../../packages/examples/jsonrpc-demo/README.md)（`@deepseek-ai/dsh-sdk-jsonrpc-demo`）：輕量應用入口——`installFailLoud` + `loadEnv` + 設定發現 + [`dsh-app-boot`](../../../../packages/boot/app-boot/src/index.ts) 的 `boot()`；`boot()` 完成後入口即完成，伺服器由 `cordis.yml` 中的 `dsh-sdk-jsonrpc-server` 條目啟動。它只相依性 `app-boot`。行程級退出歸 `bin` 所有（stdin EOF/SIGTERM → dispose 後返回 0，SIGINT → 130）。

設定發現有兩個通道，均缺失時立即報錯：優先使用 `DSH_CORDIS_CONFIG` 環境變數（SDK 用戶端約定），其次使用 argv 位置參數；沒有默認路徑或內建回退——「實際啟動的外掛程式由外部 `cordis.yml` 決定」是硬語義。

### 外掛程式解析：VFS 裝載真實包樹，閉包 manifest（中繼資料清單）就是部署根目錄

exe 的 VFS 內是**建置產物形態的真實包樹**（各包的 `lib/` + 真實 `node_modules`）。打包專用 JSON-RPC 入口會向 app-boot 的根 Include 提供自身已安裝 harness 的基準位置：相對外掛程式說明符從外部設定目錄解析，裸包名則從 VFS 解析，因此位於另一個 Node 項目內的設定無法遮蔽已打包的外掛程式集合。普通開發 bin 仍由設定項目提供裸包。打包入口中的裸包名從該入口在 VFS 內的位置沿 `node_modules` 向上解析，自然落在 VFS 內。封閉集不需要白名單程式碼——VFS 中安裝了什麼，集合中就有什麼；`import()` 集合外的名稱會失敗。

部署根目錄是 [`python/sdk-runtime/package.json`](../../../../python/sdk-runtime/package.json)（`dsh-jsonrpc-agent-pkg`，pnpm 工作區成員、零程式碼純相依性 manifest），也是「exe 安裝哪些外掛程式」與「Python 執行時期分發什麼」的統一真源。向 exe 新增外掛程式，就是在 manifest 中增加一行相依性後重新打包。[`scripts/verify-runtime-closure.ts`](../../../../scripts/verify-runtime-closure.ts) 遍歷該 manifest 覆蓋的全部工作區包，要求每個非選填的工作區對等相依性（peer dependency）都顯式列在執行時期根目錄，並報告“引用包 → 缺失對等相依性”的完整鏈路；`pnpm run hygiene`、CI 靜態檢查與 single-exe 建置都會在打包前執行該閘門。部署還會依據各包的 `files` 欄位打包，因此 tsdown 拆出的共享區塊必須被 `files` 覆蓋。

### 建置管線與產物

[`scripts/build-exe-for-python-sdk.ts`](../../../../scripts/build-exe-for-python-sdk.ts)：執行時期閉包校驗 → `pnpm run build` →（清空後）`pnpm --filter dsh-jsonrpc-agent-pkg deploy --legacy --prod --config.node-linker=hoisted --config.auto-install-peers=false --config.link-workspace-packages=true` **直接寫入** `python/sdk-runtime/src/deepseek_harness_runtime/runtime/node/` → 復原被 legacy deploy 提升回源 manifest 的 `node_modules` 下的任何直接工作區包，同時省略其包內相依性樹，並拒絕剩餘的 manifest 缺口 → 將暫存相依性中的每個符號連結替換為目標文件內容，刪除套件管理員的 `.bin` 連結，並在仍有任何符號連結時失敗 → 注入 pkg 設定（`bin` 指向閉包內的 `node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/packaged-bin.js`；`assets` 使用全量 glob，因為動態 `import()` 對 pkg 靜態分析不可見，必須顯式打入全部內容）→ 暫存目標平臺的 `node-pty` addon → 每個建置目標呼叫一次 `pkg --sea` → 可執行文件 `dsh-jsonrpc-agent-pkg-<platform>-<arch>` 寫入 `dist-exe/`，並拷回執行時期目錄。Linux 安裝會從原始碼建置 `pty.node`；CI 會在打包前進入匹配架構的 manylinux 2.28 容器重新建置該 addon，而 `--legacy` 部署會省略這一副作用目錄，因此建置器會把它從根安裝目錄複製到暫存閉包。macOS 使用對應目標的預建置產物，並在可執行文件旁生成所需的 `-spawn-helper`。CI 將這些產物作為測試中間輸入，只保留對應平臺的 wheel 套件。四個部署標志都有實測依據：未啟用 `inject-workspace-packages` 時必須使用 `--legacy`；`hoisted` 為 pkg 提供穩定的單實例版面配置，再由顯式物化步驟消除符號連結；關閉對等相依性自動安裝可防止未聲明的對等相依性擴大閉包；`link-workspace-packages` 選擇直接工作區相依性。[`pnpm-workspace.yaml`](../../../../pnpm-workspace.yaml) 將傳遞的 `@deepseek-ai/cosmokit` 與 `@deepseek-ai/schemastery` semver 請求覆蓋到固定的 vendor 原始碼，使 legacy deploy 不會從登錄檔解析這些未發布名稱。

CI 使用 [`.github/workflows/build-exe-for-python-sdk.yml`](../../../../.github/workflows/build-exe-for-python-sdk.yml)：[必需的 Python 執行時期Pull Request驗證](../testing/2026-08-12-required-python-runtime-pull-request-ci.md)呼叫它建置 linux-x64，手動派發 `workflow_dispatch` 或 PR（Pull Request）的 `build-exe` 標籤可以顯式選擇建置目標，[公開發布工作流程](../process/2026-08-11-python-publication-workflow.md)則呼叫它建置全部目標。linux-x64、linux-arm64（`ubuntu-24.04-arm`）和 macos-arm64 三個平臺分別進行原生建置，並快取 `~/.pkg-cache`；macOS 的 ad-hoc 簽名由 pkg 處理。每個平臺都使用 mock SSE（Server-Sent Events）模型，分別透過預設配置和自訂 `cordis.yml` 驅動 SDK，再透過 NDJSON JSON-RPC 直接驅動 exe，校驗 JSONL 與最終回應；最後把發布形態的 wheel 套件安裝到乾淨的 venv 中，並在不傳 `runtime_bin` 的情況下執行。Linux 還會檢查可執行文件和原生 addon 各自的 GLIBC 相依性，並在 manylinux 2.28 容器中執行；macOS 則驗證可執行文件的部署目標符合 wheel 套件標籤。完整建置三個目標時保留 4 個產物，每個產物只含一個發布文件：平臺無關的 SDK wheel 套件與 3 個原生執行時期 wheel 套件；手動選擇部分目標時保留 SDK wheel 與所選執行時期 wheel。裸 exe 與原始碼包只作為測試中間輸入。[`.gitlab-ci.yml`](../../../../.gitlab-ci.yml) 只接受版本與根目錄 `package.json` 匹配的 `python-v<repository-version>` 標籤管線，建置一個 SDK wheel 套件和 3 個原生執行時期 wheel 套件，再由單個序列任務校驗並將這 4 個文件發布到項目的 PyPI 登錄檔。Windows 不在目標範圍內。

### Python SDK 分發：雙載體，exe 用於生產，`node` 用於開發

Python SDK 位於 [`python/`](../../../../python/README.md)：`python/sdk` 是用戶端，`python/sdk-runtime` 是執行時期載體包。執行時期包的資料目錄包含檢入的默認 `runtime/cordis.yml`、建置注入的平臺 exe 與選填 helper，以及建置注入的 `runtime/node/` 閉包樹。`resolve_bundled_launch_args()` 的自動解析**只尋找 exe**；`node` 載體僅在顯式設定 `DSH_RUNTIME_MODE=node` 時啟用（執行 `runtime/node/node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/packaged-bin.js`，需要系統 Node ≥22.19），定位為本倉庫成員的開發驗證通道，不隨 wheel 套件分發。

[`scripts/build-python-release.py`](../../../../scripts/build-python-release.py) 從倉庫根目錄的 `package.json` 讀取權威的 `X.Y.Z` 或預發布版本，把預發布版本轉換為 PEP 440 寫法，並以該 wheel 套件版本暫存兩個包，讓 `deepseek-harness-sdk` 精確相依性匹配版本的 `deepseek-harness-runtime-bin`。選填的 `python-v<repository-version>` 發布標籤只是一項一致性斷言，與倉庫版本不同時會被拒絕；原始碼 `pyproject.toml` 中的開發佔位版本從不決定發布版本。暫存過程還會把倉庫授權條款放入兩個 wheel 套件，並把第三方聲明放入內建執行時期 wheel 套件。SDK 是 `py3-none-any` wheel 套件；每個只提供 wheel 套件的執行時期包都包含一個 exe，macOS wheel 套件還包含與其架構匹配的 helper。執行時期 wheel 套件使用 `py3-none-manylinux_2_28_x86_64`、`py3-none-manylinux_2_28_aarch64`，或針對 Node 24 可執行文件 macOS 13.5 部署目標而保守選擇的 `py3-none-macosx_14_0_arm64` 標籤；Hatch 掛鉤拒絕 sdist、通用標籤、混合平臺載荷、helper 缺失或多餘，以及不支持的平臺。

exe「必須顯式設定」的硬語義不變；零設定體驗由包裝層復原：呼叫方沒有提供 `cordis`、沒有顯式指定執行時期，且環境中沒有 `DSH_CORDIS_CONFIG` 時，用戶端將檢入的默認 `cordis.yml`（`agent-core` + 預載的 `llm-deepseek` + JSONL 持久化 + `bash-local` + `dsh-sdk-jsonrpc-server` 對外服務條目，並透過 `!!js` 使用環境變數兜底）顯式注入 `DSH_CORDIS_CONFIG`。

### 命名血統

`@deepseek-ai/dsh-sdk-jsonrpc-demo`（包）→ `dsh-jsonrpc-agent`（`bin`）→ `dsh-jsonrpc-agent-pkg`（閉包 manifest；沒有作用域前綴，刻意避開 `constraints` 對 `@deepseek-ai/dsh-*` 的包形狀規則）→ `dsh-jsonrpc-agent-pkg-<platform>-<arch>`（exe 產物）。協議欄位 `serverInfo.name` 保持為 `deepseek-harness-sdk-runtime`（協議穩定值）；Python 分發包名為 `deepseek-harness-sdk` / `deepseek-harness-runtime-bin`，匯入模組名仍為 `deepseek_harness` / `deepseek_harness_runtime`。

## 工作執行緒外掛程式

exe 內支持 `dsh-workflow-worker-thread` 與 `dsh-code-runtime-worker-thread`。兩個後端建置後的宿主都透過 `fileURLToPath()` 轉換相鄰 `lib/worker.cjs` 的 URL，再將所得檔案系統字串傳給 `Worker`；pkg 的 Worker 掛鉤可以用這種形式解析 VFS 內文件。該掛鉤會把 VFS 內的工作執行緒文件作為 CommonJS 編譯，所以工作執行緒入口採用 CommonJS。工作流程引擎在未建置的原始碼執行中仍保留 `data:` URL 引導程序，只有建置後的相鄰入口使用檔案系統字串。自訂設定的可執行文件冒煙測試會載入兩個後端，實際呼叫 `run_code` 與不啟動 agent（代理）的 `workflow`，並要求兩個工作執行緒都從 pkg 的 VFS 內返回 `42`。

## 測試

驗證面分三層。機制層：`--sea` 鏈路的實測結論內嵌在「決策」各節（VFS 內 ESM 動態 `import()`、單一 Cordis 實例、明確報錯的設定鏈路、`node:sqlite`、macOS ad-hoc 簽名可執行）。SDK 層：完整的無金鑰 pytest 套件以 mock 執行時期對端覆蓋用戶端協議、子行程清理、絕對 `cwd` 傳遞、雙載體啟動與載體解析；根 CI 在 Python 3.10 上執行全部用例。端到端層：每個平臺建置都透過默認 SDK 路徑、自訂設定、倉庫內建的獨立 minimal 組合和直接二進位協議，對 mock 端點完成一個輪次，並校驗最終文字與 JSONL。minimal 執行會斷言其精確系統提示詞與雙工具目錄，跨呼叫保留 Bash 狀態，並呼叫編輯器。自訂設定還會透過打包進 VFS 的真實工作執行緒文件執行 `run_code` 和不啟動 agent 的 `workflow`。同一建置任務還會經 Python SDK 執行一組檢入的 exe 專用快照：無金鑰指令碼化模型掛載一個會註冊工具的 Cordis 外掛程式，從 `run_code` 呼叫該工具，執行一個直接 spawn 的 subagent 和一個會透過 spawn 啟動第二個 subagent 的工作流程，隨後解除安裝該外掛程式。該 fixture（測試前置資料）會顯式停用組合包中未使用的 Bash 和本機 skill（技能）發現，使其工具集不相依性倉庫外部狀態；比較時會規範化 SDK 結果與通知流，以及父工作階段和兩個子工作階段 JSONL 日誌中不透明的訊息、agent、工作流程執行與工作階段 ID。該 harness 與 ACP 的 `pnpm run test:snapshot` 保持獨立，因為二者的協議和建置產物不同。隨後把平臺 wheel 套件安裝進乾淨的 venv，並在不傳 `runtime_bin` 的情況下執行。


手工驅動注意：`bin` 將 stdin EOF 視為「用戶端已離開」並立即 dispose，生命週期較短的管道會中止進行中的輪次——管道驅動必須保持 stdin 打開，直到輪次結束。

## 曾考慮的替代方案

**裸用 Node 原生 SEA。** 注入的主指令碼必須是 CJS 單文件，blob 內沒有檔案系統與模組解析，因此動態 `import()` 無法解析裸包名；只能把外掛程式靜態編譯進主指令碼並手工註冊。這會繞過標準模組解析並硬編碼外掛程式集合，與「設定決定一切」相悖。最終路線實際是「官方 SEA 基礎 + pkg 的 VFS/模組掛鉤層」；否決的是裸用方式，而不是 SEA 本身。

**pkg 標準模式。** PoC 證明該模式不可行，而非權衡後放棄：它透過 esbuild 將 ESM 轉為 CJS + V8 位元組碼，但執行時期 VM 編譯沒有接入動態 `import()` 回呼，任何 `import()` 都會拋出 `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`，`--options experimental-require-module` 也無效；此外，它相依性社區修補程式版 Node 二進位（macos-arm64 沒有預編譯版本，現場從原始碼編譯約需 10 分鐘）。該模式不適用於本倉庫架構。

**每包 ESM→CJS 預打包進 VFS。** 保持真實解析語義、只降級模組格式的折中；`--sea` 直接透過實測，這層建置複雜度無需引入。

**讓 jsonrpc-agent 承擔完整閉包相依性。** 應用入口將聲明 53 個以上自身並不 `import()` 的相依性，使「打包 manifest」偽裝成真實相依性關係，還會迫使 `constraints` 為其增加 `cordis-in-dependencies` 與 `files` 萬用字元兩個例外。將閉包 manifest 放在 Python 側的 manifest 包後，`constraints` 不需要任何例外，`bin` 也能保持與 acp-agent 同構的正常包形狀。

**開放外掛程式集（從磁碟載入使用者外掛程式）。** 交付的集合是封閉的；PoC 同時證實，可以透過 `ctx.baseUrl` 相對路徑通道從 VFS 外的磁碟 `import()` ESM。該能力列為後續演進，屆時還需解決外部外掛程式與 exe 內 Cordis 實例的共享問題。

## 後果

**買到的**：目標平臺零相依性的單文件分發；外掛程式語義與原始碼執行嚴格一致（同一棵真實包樹，無轉譯、無登錄檔）；對外服務介面、外掛程式集與設定全部收斂到 `cordis.yml` 和一份相依性 manifest 這兩個真源；exe 與 `node` 雙載體使用同一棵樹和相同語義，開發驗證無需等待打包；官方 Node 二進位消除了修補程式版二進位的供應鏈顧慮。

**付出的**：產物約 174MB，且原始碼原樣進入 blob（沒有位元組碼混淆；閉源分發訴求需要另行評估）；pkg 的 VFS/模組掛鉤層仍由社區維護（建置指令碼釘死 `@yao-pkg/pkg@6.21.0`，升級需要顯式改動）；`--sea` 每個建置目標呼叫一次（與 CI 每個平臺一個任務相匹配，本機多平臺建置序列執行）。
