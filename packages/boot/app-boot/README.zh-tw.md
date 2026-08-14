# `@deepseek-ai/dsh-app-boot`

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

供 app bin（[`dsh`](../../../apps/cli/README.md) 與 [`dsh-acp-demo`](../../examples/acp-demo/README.md)）共用的啟動粘合層：每個 bin 都是在這些輔助函式之上建置的精簡自執行組合，並以自身診斷前綴參數化。這樣，Loader 故障行為只由一處負責，不會在已發布產物之間逐漸分化。

| 匯出 | 職責 |
|---|---|
| `resolveConfigPath(path, snapshotMode, cwd?)` | 生成絕對設定路徑；當 `snapshotMode === 'replay'` 時，把 basename 為 `cordis.yml`/`.yaml` 的文件替換為同級 `cordis.snapshot.yml` |
| `loadEnv(binName, dir?, warn?)` | 載入已被 git 忽略的 `.env`（Node `process.loadEnvFile`）；文件不存在不影響啟動，文件無法載入時輸出一行帶標籤的警告（默認寫入 stderr） |
| `loadLayeredEnv(binName, cwd?, warn?)` | 建置產品 CLI（命令列介面）凍結的「繼承環境 > 項目 `.env` > 使用者 `.env`」快照，拒絕文件中的 bootstrap-only 變數，並在不替換繼承值的前提下物化其餘文件值 |
| `installFailLoud(binName, proc?, release?)` | 將啟動期或後續未處理的 Loader 拒絕轉換為一行帶標籤的 stderr 訊息並執行 `exit(1)`；兩者之間會等待選填的 `release` 清理掛鉤（以 `FAIL_LOUD_RELEASE_TIMEOUT_MS` 為上限），使持有終端機的介面能在退出前復原終端機；返回解除安裝函式 |
| `FAIL_LOUD_RELEASE_TIMEOUT_MS` | `installFailLoud` 等待其 `release` 回呼的時長；卡死的 disposer 只會延遲致命退出，而不會取消它 |
| `assertEntriesLoaded(ctx, binName)` | 樹結帳後，如果其中存在已啟用但沒有 fiber 的條目，則拋出例外，並以 Cordis 啟動故障的形式報告每個未解析外掛程式的名稱 |
| `assertEntriesActivated(ctx, binName)` | 先執行 `assertEntriesLoaded` 檢查，再在 Loader 結帳後等待每個已啟用設定項；拋出的錯誤包含每個失敗外掛程式的原始錯誤堆疊，或每個等待中外掛程式尚未解析的服務 |
| `loadOptionalPatches(binName, file)` | 解析一份選填的 patch 清單文件（即 profile 的 `cordis.patch.yml`）：其頂層是一個 YAML 陣列，內容為 include 的 `PatchOptions`（按 id 定位的設定覆蓋、`insert` 清單，允許 `!!js`）；文件不存在時返回 `undefined`，文件不可讀、不可解析或內容不是陣列時拋出例外 |
| `loadOverlayPatches(binName, file)` | 解析必需的頂層 YAML 陣列，其中包含與上文相同的 include `PatchOptions` 條目；文件缺失也會拋出例外，因為該文件是呼叫方指名的 |
| `mountRootInclude(ctx, absoluteConfigPath, patches?, bareModuleBaseUrl?)` | 註冊靜態匯入的 `cordis:include` 與 `cordis:group` builtin，掛載 include，並保留使用者 patch 層 HMR（熱模組替換）使用的確切根設定項；選填模組基準會把裸包名錨定到已安裝宿主，而相對名稱仍以設定目錄為基準 |
| `watchUserPatches(ctx, options)` | 向現有 Cordis HMR 服務註冊指名的 patch 文件；每次新增、變更或移除都會透過呼叫方的 `compose` 閉包（應用自有層圍繞當前使用者層）以交易方式重新組合完整 patch 清單，並返回非同步 disposer |
| `resolveProfileDir` / `initProfile` / `loadProfile` / `readProfileManifest` / `writeProfileManifest` / `resolveBundleDir` / `composeEntries` / `healProfilesModuleFallback` / `PROFILE_TEMPLATES` / `DEFAULT_PROFILE_BUNDLES` / `PROFILES_DIR` / `PROFILE_PATCH_FILENAME` | Profile 機制（見 [Profile](#profiles)） |
| `boot(binName, absoluteConfigPath, patches?, prepare?, bareModuleBaseUrl?)` | 建立根上下文，向 Loader `!!js` 設定表達式暴露 `dshHomePath(...segments)` 並安裝 Loader，在設定樹條目掛載前執行選填的宿主準備操作（`prepare` 可以使用 Loader，也可以提供由啟動器擁有的上下文插槽），再掛載並等待 include 樹結帳，斷言所有條目均已載入並激活，最後返回根上下文——失敗時 dispose（資源釋放）部分構造的上下文，並以帶標籤的錯誤 reject；選填模組基準與 `mountRootInclude` 的解析語義相同 |
| `renderConfigDump(binName, absoluteConfigPath, layers, warn?)` | 使用 include 自己的解析器和修補程式演算法（`entryListSchema`/`applyEntryPatches`）離線合成基礎設定與帶標籤的覆蓋層，使結果與 `boot()` 掛載的內容一致，再渲染為 YAML，並原樣保留 `!!js` 表達式；每段來源於同一文件且由相同修補程式層修改的連續行之前都有一條 `# ==` 註釋，標明該文件和這些修補程式層，輸出仍是一份可載入的文件；未匹配到行的修補程式連同其層標籤交給 `warn`（默認：一行 stderr），讀取、解析或欄位驗證失敗則拋出 |
| `addHarnessSourceSection(ctx, sourceRoot)` | 新增全域性 `harness:source` 提示詞段落（順序緊隨 harness 身份、位於 persona 之前），告知 agent（代理）DSH 實作程式碼 checkout 的磁碟路徑，同時提醒它不得據此推斷當前工作目錄，而應使用 `pwd`；如果已啟動樹沒有此項服務，則不執行操作並返回 `undefined`。這裡的服務是 `systemPrompt`；該段落註冊到它的 fiber，因此開發環境 HMR 重新載入系統提示詞後，它會消失直至下次啟動 |
| `HARNESS_SOURCE_SECTION` | `'harness:source'` 段落名稱，供 `addHarnessSourceSection` 註冊使用 |

Loader 結帳會在匯入或生命週期失敗時返回拒絕結果，並攜帶失敗的設定項與階段；`boot()` 會 dispose 部分構造的上下文，並用 bin 名稱包裝該失敗。結帳後遺留的設定項由獨立審計處理：`assertEntriesLoaded` 將已啟用卻沒有 fiber 的設定項轉換為 rejection 並列出每個未解析外掛程式；`assertEntriesActivated` 會顯式等待每個失敗的 fiber，把原始錯誤堆疊寫入啟動 rejection，並列出每個等待中設定項尚未解析的服務。拋出錯誤前，審計會透過一個行程級檢查點標記這些 rejection 的確切原因，從而讓 `installFailLoud` 將 Loader 的重複通知合併為一次，而所有無關的未處理 rejection 仍然致命。

Loader 並行掛載各個條目，因此當其他環節失敗時，某個介面可能已經持有終端機：此時不經過整棵樹自身的拆卸就退出，會把 raw 模式、bracketed paste 和鍵盤協議殘留在使用者的 shell 上，而尚未返回的終端機查詢回應會在下一個提示符處顯示為字面文字。設定樹失敗會經 `boot()` 結帳：它先 dispose 部分建置的上下文（從而執行該介面自身的 shutdown），再拋出帶標籤的 rejection。對於 `boot()` 看不到的 rejection（外掛程式遊離的非同步工作在掛載期間或掛載完成後失敗），持有終端機的 bin 會傳入 `release`，在提交退出前 dispose 整棵樹；`dsh` 在 `boot()` 的 `prepare` 回呼中捕獲根上下文，而不是取其回傳值，使該回調覆蓋整個掛載視窗。release 執行期間，處理函式保持註冊並處於鎖定狀態：被報告的始終是第一個 rejection，後續拒絕（包括拆卸自身產生的拒絕）會被忽略，而不會變成未捕獲錯誤、在拆卸中途殺死行程。

`cordis:group` 與 `cordis:include` 一並註冊，使一份組裝能把一個提供方與它的消費端放進同一個 `isolate` realm。兩者都透過宿主的模組管線載入，而非被包含樹自身的說明符解析，這正是讓本工作區之外的組裝——放在 harness home 下的 agent preset——能夠使用 group 行的原因。

設定中的裸外掛程式 specifier（`@deepseek-ai/dsh-*`、npm 包）透過 Cordis Loader 的內部模組 loader 解析。預設情況下，它們從設定目錄解析；封閉執行時期會向 `boot` 或 `mountRootInclude` 傳入 `bareModuleBaseUrl`，使已安裝檔樹保持權威，即使設定位於另一個 Node 項目中也不受遮蔽。相對 specifier 始終以設定目錄為基準解析。倉庫 bin 會安裝 Loader 的選填對等相依性（peer dependency） `node-addon-require-builtin`；外部呼叫方必須提供該元件，或者把外掛程式安裝到普通 Node import 解析可以找到的位置。建置後的 `dsh-app-boot` 產物內嵌靜態掛載的 Include 實作，但仍將 Loader 保持為外部相依性，因此 include 樹與宿主會綁定到同一個 Loader peer。`pnpm dsh` 原始碼路徑還會將 manifest（中繼資料清單）聲明的 workspace 包對映到其 TypeScript 原始碼；其設定閘門要求每個隨附的原始／Web 裸外掛程式都出現在解析所用 manifest 的 `dependencies` 中。

此包不包含 loader 掛鉤，也不提供開發模式介面。[`dsh` 應用](../../../apps/cli/README.md) 持有自己的 Node 原始碼啟動掛鉤，並在啟動序列中使用這些 helper；建置後的消費端仍使用普通 Node 包解析。

## Profiles

profile 是位於 `$DSH_HOME/profiles/<name>` 下的目錄（harness home 由 [`resolveDshHome`](../../util/home-paths/README.md) 解析：先取 `$DSH_HOME`，否則取 `~/.dsh`），其中包含一個 `package.json`（樹外外掛程式 `dependencies`，加上 profile manifest `dsh.profile` 及其有序的 `bundles` 層清單）和使用者自己的 `cordis.patch.yml`。組合包是在 manifest 中聲明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 的 npm 包；`loadProfile` 以雙錨點解析每個 `dsh.profile.bundles` 名稱（先從 dsh 安裝目錄，再從 profile 目錄），列出的包若沒有組合包聲明則明確報錯。`composeEntries` 透過 include 自己的 `applyEntryPatches` 在空條目清單之上應用各 patch 層，因此組合、標志推導和設定 dump 絕不會與實際啟動內容發生偏離。`healProfilesModuleFallback` 維護扁平的 `$DSH_HOME/profiles/node_modules` 目錄（安裝目錄的應用與各組合包相依性的每個包對應一個符號連結），使任意 profile 中的裸外掛程式名都能經 Node 常規的逐級向上尋找解析，而無需由 pnpm 管理隨安裝內建的包。`PROFILE_TEMPLATES`（`web`、`headless`）在首次使用時自動初始化；其他名稱在 `initProfile` 建立之前都會明確報錯（即 `dsh plugin` 路徑）。`loadProfile` 會將與安裝自有組合包元組完全一致的清單規範化為隨發行版交付的範本，同時保留 manifest 中其他所有欄位；一旦條目有任何額外、缺失或重排，該清單就歸使用者所有並保持不變。

使用者級的機器本機偏好同樣位於 harness home 中：

- **`.env`**：產品 CLI 的普通環境層；呼叫目錄的文件優先於 harness home 的文件，兩者都低於繼承環境。`loadLayeredEnv` 記錄每個值的來源，按不區分大小寫的方式拒絕 [bootstrap-only 文件變數](../../../.agents/notes/implemented/architecture/2026-08-04-configuration-source-ownership.md#decision)，並把其餘值物化進 `process.env`，供 Loader 表達式和第三方庫使用。受管憑據另存於 [`.credentials.yaml`](../../credentials/credentials-local/README.md)；留在任一 `.env` 中的憑據仍是低優先級後備值。
- **`cordis.patch.yml`**（home 級）與 **`profiles/<name>/cordis.patch.yml`**：使用者 patch 層，應用在所有組合包層之後（先應用逐 profile 的文件，再應用 home 級文件，因此後者優先級更高）：按 id 定位的 patch 會替換對應條目的整個 `config`（未改欄位也要重述），`insert` 會新增條目，`!!js` 表達式則在掛載時插值。如果 patch 指定的條目 id 不在組合後的樹中，則輸出一條 stderr 警告。空文件或僅含註釋的文件會拋出例外（其解析結果為空，而不是清單）；如需停用該層，請使用 `[]`。

每次 profile 啟動都由 `watchUserPatches` 持續應用 `cordis.patch.yml` 的變更（一次性 surface 經由有界關閉 dispose 監視器）。即使該文件或其直接父目錄不存在，監視器仍會監視確切路徑；它會序列處理突發變更，並按呼叫方的層次順序重新組合使用者 patch（組合包層在下、overlay 在上）。讀取失敗、解析失敗或 Loader 候選被拒時，最後一個可用樹會繼續執行；HMR 服務記錄錯誤後廣播 `hmr/config-update-failed(filename, Error)`，並隔離觀察方的失敗。上下文 dispose 時會關閉 watcher，並等待進行中的刷新結束。

## 模型體驗

模型透過此包載入的外掛程式樹間接受到影響；該樹決定最終應用中的提示詞、schema、訊息和模型配接器。唯一貢獻模型可見文字的匯出 `addHarnessSourceSection`，也只有在消費端啟動後呼叫它時才會產生影響。

#### KV Cache 影響

`boot()` 不會直接使快取失效；消費端呼叫 `addHarnessSourceSection` 時，會在系統提示詞靠前位置、逐請求內容之前新增一行短文字，因此不會使跨輪次快取失效。請求前綴的其他任何變化均由相應的具名消費端負責。

## 已知限制與暫緩事項

- **裸包 specifier 相依性 Loader 內部機制**：生產 bin 需要 Loader 的選填原生輔助元件；沒有該輔助元件的行程內呼叫方必須使用可解析的相對／file specifier，或提供自己的模組解析掛鉤。
- **快照重播替換僅識別特定 basename**：只有以 `cordis.yml` 或 `cordis.yaml` 結尾的設定會對映到同級 `cordis.snapshot.yml`；自訂設定名稱需要呼叫方自行選擇。
- **環境發現以啟動為界**：`loadLayeredEnv` 只讀取一次呼叫目錄與 harness home 中的 `.env`；它不搜尋父目錄，也不跟隨之後選擇的 workspace。`loadEnv` 仍是非產品 bin 使用的單目錄 helper。
- **使用者 patch 會替換匹配到的整個設定**：按 id 定位的 patch 不做深度合併，因此 profile 覆蓋必須重述需要保留的組合包欄位。
