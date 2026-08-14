# DeepSeek Harness 執行時期 wheel 套件

[English](https://github.com/deepseek-ai/deepseek-harness/blob/master/python/sdk-runtime/README.md) | [简体中文](https://github.com/deepseek-ai/deepseek-harness/blob/master/python/sdk-runtime/README.zh.md) | 繁體中文

Python SDK 的執行時期載體包（分發名 `deepseek-harness-runtime-bin`，模組名 `deepseek_harness_runtime`）：它定位 `deepseek-harness-sdk` 用戶端要 spawn 的內建執行時期二進位，並附帶支撐零設定執行的預設配置。

## 執行時期載體

兩種載體並存於 `src/deepseek_harness_runtime/runtime/` 之下，均由倉庫的 `scripts/build-exe-for-python-sdk.ts` 建置注入，且均被 git 忽略：

- **exe（生產）**——單文件 Node 可執行程序 `dsh-jsonrpc-agent-pkg-<platform>-<arch>`（platform：`linux`/`macos`；arch：`x64`/`arm64`）。macOS 建置還會隨附 `node-pty` 在該平臺使用的原生 `-spawn-helper` 伴隨檔案。目標機器無需安裝 Node。這是唯一隨 wheel 套件分發的載體；本包不發布 sdist。
- **node（僅限開發）**——`runtime/node/` 下的完整部署閉包（`package.json` + `node_modules/`），在系統 Node >= 22.19 上以 `node runtime/node/node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/packaged-bin.js` 執行。它是當前檢出的原始碼建置，僅用於倉庫本機的開發與驗證；不會被自動選中，也不進入分發物。

兩種載體承載相同的內容，且只定義一次：本包根目錄的 [package.json](https://github.com/deepseek-ai/deepseek-harness/blob/master/python/sdk-runtime/package.json) 是 single-exe 管線的部署根目錄——一份零程式碼的純相依性 manifest，其相依性閉包既是編譯進 exe 的外掛程式集，也是物化到 `runtime/node/` 的文件樹。往分發物裡加外掛程式，就是在那裡加一行相依性再重新建置。

exe 缺失時拋出 `FileNotFoundError`，並寫明兩種取得途徑：在 deepseek-harness 檢出中經 `scripts/build-exe-for-python-sdk.ts` 建置，或安裝 `build-exe-for-python-sdk` CI 工作流程生成的對應平臺執行時期 wheel 套件。僅限開發的 node 載體缺失時只提示建置指令碼這一條途徑。該工作流程只保留 wheel 套件，不保留獨立 exe 封存。取得策略與尋找介面刻意分離，之後可以換成按需下載而不改動任何呼叫方。

每個 wheel 套件只包含一個執行時期可執行文件。macOS wheel 套件還包含與其匹配的原生 spawn helper；缺少伴隨檔案意味著該安裝不完整，並會在啟動時硬失敗，即使所選 Cordis 組合不使用 PTY 工具也是如此。Linux wheel 套件不包含 spawn helper，因為 `node-pty` 直接使用暫存的 `pty.node` 原生外掛程式。固定標籤為 `py3-none-manylinux_2_28_x86_64`、`py3-none-manylinux_2_28_aarch64` 與 `py3-none-macosx_14_0_arm64`；macOS 標籤保守匹配內建 Node 24 可執行文件的 macOS 13.5 部署目標。本包的 `platforms.json` 統一定義倉庫發行建置器與隔離建置掛鉤使用的固定標籤和可執行檔名。建置掛鉤會拒絕 `py3-none-any`、不存在執行時期文件、存在多個執行時期文件、文件不可執行以及不支援的平臺標籤。倉庫根目錄的 `package.json` 為本包和 SDK 提供共同版本，`python-v<repository-version>` 發布標籤必須與其匹配。

## 解析 API

- `resolve_bundled_launch_args(mode=None) -> tuple[str, ...]`——啟動內建執行時期的 argv 元組：exe 模式下為 `(exe_path,)`，node 模式下為 `(node_path, bin_js_path)`。模式選擇：顯式參數 > `DSH_RUNTIME_MODE` 環境變數（`exe` | `node`）> 自動。自動解析只找生產 exe——僅限開發的 node 載體必須顯式選用，從而生產部署絕不會悄悄跑在原始碼建置上。
- `bundled_runtime_path() -> Path`——平臺 exe 路徑（僅 exe 載體，並會在 macOS 上校驗必要的 `-spawn-helper` 伴隨檔案也已安裝）。node 載體沒有單一路徑的等價物，經由上面的 argv 元組啟動。
- `bundled_default_config_path() -> Path`——檢入的預設配置（見下文）。
- `bundled_package_dir() -> Path`——已安裝檔的資料根目錄。

## 零設定設計

執行時期二進位始終要求顯式設定（`$DSH_CORDIS_CONFIG`，或作為 argv 位置參數的設定路徑），缺了就報錯結束——這一強制語義是執行時期設計的一部分，本包不會弱化它。bin（`dsh-jsonrpc-agent`）只啟動設定裡列出的外掛程式；對外服務介面（stdio JSON-RPC 伺服器）也是其中一個條目（`@deepseek-ai/dsh-sdk-jsonrpc-server`），缺了它，啟動出的 agent（代理）就沒有對外通道。本包檢入的 `runtime/cordis.yml` 包含 JSON-RPC 服務條目、agent 核心、預載的 DeepSeek 配接器、JSONL 持久化、顯式組合的語義檢查點策略、本機 bash，以及用於有界載入工作區指令的本機檔案系統提供方。持久化後端負責持久儲存，獨立的策略則選擇請求、工具分發和已完成步驟的檢查點。DeepSeek 配接器讀取 `DEEPSEEK_API_KEY` 與 `DEEPSEEK_BASE_URL`，持久化、bash 和檔案系統提供方則使用 `DSH_SESSION_ROOT` 和 `DSH_CWD`，並為手動執行提供回退值。呼叫方未使用任何顯式設定通道時，`deepseek_harness` 用戶端把該檔案路徑注入 `DSH_CORDIS_CONFIG`（注入條件見 [sdk README](https://github.com/deepseek-ai/deepseek-harness/blob/master/python/sdk/README.md)）。因此，零設定是包裝層中一次顯式、可見的參數傳遞，而不是執行時期中的隱藏回退。
