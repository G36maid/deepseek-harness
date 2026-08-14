# 開發指南

[English](development.md) | [简体中文](development.zh.md) | 繁體中文

搭建教學引導新貢獻者從準備前置條件開始，直到檢出目錄透過檢查。後面的貢獻者參考介紹倉庫版面配置、日常工作流程和 CI 組織方式。設計依據與實作細節屬於連結的 Agent Note 和指令碼。

## 搭建教學

### 前置條件

- Node.js 支援 22.19+ 與 24+。CI 覆蓋 22.19、24 和 26；見 [Node 引擎下限 Agent Note](../.agents/notes/implemented/process/2026-07-06-node-engine-floor.md)。
- 啟用了 Corepack 的 pnpm。倉庫在 `package.json` 中固定使用 `pnpm@11.7.0`；如果 `pnpm --version` 無法透過 Corepack 解析，請先執行 `corepack enable`。
- Git 2.26 或更高版本；掛鉤設定會啟用 Git 的 worktree 專屬設定擴充。
- 選填：一個 DeepSeek API key，用於 Web、headless 和 ACP（Agent Client Protocol）自動化 agent（代理）示範以及真實 API 的 e2e 測試。

### 首次搭建

在倉庫根目錄安裝相依性：

```sh
pnpm install
```

安裝過程還會透過 `scripts/install-lefthook.mjs` 設定 worktree 本機的 Lefthook 掛鉤和 `dsh-translation-pairing` Git 合併驅動。[worktree 本機掛鉤 Agent Note](../.agents/notes/implemented/process/2026-07-27-worktree-local-lefthook.md) 負責掛鉤路徑的安全約定；[自動配對合併 Agent Note](../.agents/notes/implemented/process/2026-08-08-automatic-translation-pairing-merges.md) 負責合併驅動。

如果相依性是從快取復原或 `postinstall` 被跳過而導致任一整合缺失，請手動安裝：

```sh
node scripts/install-lefthook.mjs
```

如果包裝指令碼拒絕現有 Git 設定或報告過時鎖，請遵循其診斷和所連結的 Agent Note，不要憑猜測編輯 worktree 中繼資料。移動檢出目錄後，請重新執行包裝指令碼以重新生成自有路徑。

新克隆後請先執行一次型別檢查：

```sh
pnpm run typecheck
```

`pnpm run typecheck` 成功結束即表示搭建完成。

## 貢獻者參考

### TypeScript 項目版面配置

倉庫使用相互隔離的 Host 與 Client aggregate。普通包只登記進其中一個 aggregate；Host 包進入 `tsconfig.host.json`，Client 包進入 `tsconfig.client.json`。

| 文件 | 角色 | 是否構成 program？ |
|---|---|---|
| `tsconfig.json` | solution 根：`extends` base、`files: []`、引用兩個 aggregate。它是 tsserver 發現入口，也是顯式執行整張 Project Reference 圖時的入口；經繼承的 `paths` 充當 tsx 執行 `examples/` 與 `scripts/` 時的解析設定。 | 否 |
| `tsconfig.host.json` | Host aggregate：Host 包、示例、測試、指令碼和 website，以及 `api/remotes` 的 Host 特例 project。 | 是 |
| `tsconfig.client.json` | Client aggregate：`packages/client/*` 包及其測試、`apps/web`，以及 `api/remotes` 的 Client 特例 project。 | 是 |
| `tsconfig.base.json` | 共享 compilerOptions 與原始碼 `paths` 對映。同時是各 vitest 設定讓 vite-tsconfig-paths 指向的解析門面：它沒有 `include`，因此其 `paths` 適用於任何 importer。 | 否 |
| `tsconfig.base.client.json` | 瀏覽器編譯設定（`jsx`、DOM lib、`types: []`），由 Client aggregate 和每個 `packages/client/*` 包 extends。 | 否 |

Host 與 Client 保持兩個 aggregate program，是因為兩側在相同鍵下以不同服務對 cordis `Context` 介面做聲明合併；單一 program 同時看到兩份合併會報衝突。這種衝突只存在於 `ts.Program` 內部——模組解析永遠不會觸發它——所以 solution 可以同時引用兩個 aggregate，一個 paths 門面也可以橫跨兩側。由此推出三條紀律：

- `tsconfig.base.json` 永不新增 `include` 或 `files`：它們會洩漏進每個 extends 它的包項目，並收窄門面的全匹配範圍。
- 構造全倉 `ts.Program` 的指令碼顯式以 `tsconfig.host.json` 或 `tsconfig.client.json` 為種子——根 solution 永不作為種子，因為把兩個 aggregate 展平進一個 program 會撞上 `Context` 合併衝突。
- 新包只登記進一個 aggregate。包同時具有 Node loader 入口和 browser 入口並不構成拆分理由；普通 Client 外掛程式的兩份執行時期產物都在 Client 建置階段生成。

`api/remotes` 是唯一拆分 Host/Client tsconfig 的倉庫特例。它的 Host 入口必須進入 Host Typert 圖，而 Client 入口匯入 Host tsdown 才會生成的 `/remote` 聲明，因此本包根 `tsconfig.json` 只作為 solution，兩個 aggregate 和直接消費端分別引用 `tsconfig.host.json` 或 `tsconfig.client.json`。workspace `constraints` 閘門遍歷可達的 Project Reference 圖，並按各引用 project 自身的 compiler face 檢查：只有單一設定的目標可由任一 face 引用，拆分設定的目標則必須引用匹配的 leaf，不得引用 solution 根或另一側 leaf；該閘門按「兩個 leaf 設定同時存在」自動發現拆分包，所以新拆分的包會自動納入管轄。不要把該結構推廣到其他包；[`api-remotes` README](../packages/api/remotes/README.md) 說明 Host/Client 拆分與建置順序。

根建置按生成相依性排序：

```sh
tsc -b tsconfig.host.json
tsdown --env.DSH_BUILD_FACE host
tsc -b tsconfig.client.json
tsdown --env.DSH_BUILD_FACE client
pnpm run build:web
```

兩次 tsdown 都使用同一組完整 workspace 匹配，不掃描建置產物來發現 Client 包，也不維護 Host/Client 包過濾表。包內 tsdown 設定根據 `DSH_BUILD_FACE` 決定當前階段的入口：普通 Client 外掛程式在 Client 階段同時生成 Node loader 與 browser bundle；`api-remotes` 透過 `hostPhase: true` 提前生成 Host 入口，再在 Client 階段只生成 browser bundle。tsdown 只消費 `lib/types` 中由前置 tsc 發射的 JavaScript。

Typert 只在 Host tsdown 中以 `tsconfig.host.json` 為種子執行。它分析 Host 類型並生成 Host 反射產物及 Host-for-Client Remote 投影；Client tsdown 不啟動 Typert。`pnpm run typecheck` 因此先執行完整 Host lib 階段，再執行 Client tsc；`pnpm run build` 繼續執行 Client tsdown 和 Web 建置。該順序的決策記錄見 [API Remotes 生成約定建置 Note](../.agents/notes/implemented/process/2026-08-08-api-remotes-generated-contract-build.md)。

靜態分析和測試透過 base 的 `paths` 對映把工作區 import 解析到 `src`，且必須在乾淨樹上透過；消費建置產物 `lib/` 的閘門顯式聲明該相依性。生成的 Host-for-Client Remote 聲明是有意設定的例外：公共 `typecheck`、`lint` 和 `doc-typecheck` 命令會先生成這些聲明，而內部 `*:contracts-ready` 指令碼假定呼叫它的公共命令或調度器閘門已經相依性 Typert 約定生成階段或完整建置。兩個 aggregate 的設定見 [solution-root Note](../.agents/notes/implemented/process/2026-07-22-tsconfig-solution-root-two-aggregates.md)，tsc-first 發射職責見 [ts-build-config Note](../.agents/notes/implemented/process/2026-06-17-ts-build-config.md)，閘門準備約定見 [Typert Remote Agent Note](../.agents/notes/implemented/architecture/2026-08-02-typert-remote-method-calls.md)。

業務服務在 Host 使用 `@Remote` 或 `@RemoteScope` 聲明可呼叫方法；Host 建置生成 Host-for-Client 類型與執行時期貢獻，Client 的 `api-remotes` 組合載入這些貢獻並掛到 `ctx.remote` 與作用域 `agentCtx.remote` namespace。兩側的生成產物、裝配關係、SRC 開發回退和 Web 建置順序見 [API Gateway](api-gateway.md)。

如果相關的本機檢查需要使用建置後的包產物，請先建置一次：

```sh
pnpm run build
```

`pnpm run hygiene` 包含 `publint`（用建置出的 `lib/*.js` 文件校驗包入口點）和 `verify-node-next-types`（用一個臨時的 NodeNext 消費端校驗建置出的聲明文件）。新 worktree 在 `pnpm run build` 執行之前沒有打包的 JS 和聲明文件；普通提交和推送無需建置，除非所選檢查會使用這些產物。

### 環境變數

真實的 DeepSeek 配接器和需要金鑰的 agent 示範從環境變數或倉庫根目錄一個被 gitignore 的 `.env` 文件讀取憑證：

```sh
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://... # optional
```

`DEEPSEEK_BASE_URL` 選填，預設為公開 API。請勿提交真實憑證。未設定 `DEEPSEEK_API_KEY` 時，真實 API 的 e2e 套件會自動跳過。

### Git 整合

當兩種語言的文件都使用 Git 預設文字策略且能幹淨合併時，配對合併驅動會根據已確認的祖先、當前和另一側的配對文件 blob，推匯出發生衝突的 `.i18n.yaml` 記錄。配對文件發生衝突、存在非文字合併設定或記錄無效時，它會拒絕處理並保留衝突；如果合併已經因衝突而停止，請執行 `pnpm run resolve-translation-pairing-conflicts`，該命令會暫存每份可安全生成的配對記錄；如果其他配對衝突仍需手工處理，則以非零狀態結束。[雙語文件約定](i18n/README.md#the-pairing-contract)列出該驅動接受的確切文件和狀態。

安裝指令碼在發布 worktree 設定前，會探測確切的 Node/tsx 驅動入口點。如果該執行時期之後變得不可用，不相依性 Node 的啟動器會寫入 Git 的普通文字合併結果、讓伴隨檔案保持未解決狀態，並列印復原路徑；請復原相依性後執行 `pnpm run resolve-translation-pairing-conflicts`，或執行 `git merge --abort`。如果 `pre-merge-commit` 拒絕原本能幹淨完成的合併，Git 會把完整結果留在暫存區但不建立提交；請修復失敗後執行 `git commit`，或中止合併。確切的索引與 `MERGE_HEAD` 狀態由[自動配對合併 Agent Note](../.agents/notes/implemented/process/2026-08-08-automatic-translation-pairing-merges.md#failure-contract)負責記錄。

lefthook 在 `lefthook.yml` 中設定，作為快速的本機檢查點：

- `pre-commit` 對照暫存的配對文件 blob 校驗暫存的配對記錄，使用不載入項目的 `.oxlintrc.staged.json` 設定驗證暫存文件，並透過一次有界重試應用 Oxlint 修復，在暫存文件屬於 `THIRD_PARTY_NOTICES.md` 的輸入時重新生成該文件，然後檢查暫存 diff 中的空白錯誤，並執行 vendor manifest（中繼資料清單）守衛；
- `pre-merge-commit` 在 Git 建立自動合併提交前執行同樣以索引為準的配對檢查；
- `pre-push` 執行 `pnpm run typecheck`；該命令會先完成包含 Typert 約定生成的完整 Host lib 階段，再執行 Client TypeScript 檢查。

vendor manifest 守衛檢查 `vendor/*/src` 下的改動是否連同對應的 `vendor/README.md` manifest 更新一起暫存。請在編輯 vendor 程式碼前先閱讀 `vendor/README.md`。

除限定範圍的暫存記錄校驗外，這些掛鉤有意不執行測試、快照、文件檢查、建置或 `hygiene`。貢獻者只執行一次[與改動行為相關的檢查](../AGENTS.md#run-relevant-checks-locally)；CI 負責全量覆蓋率閘門、建置產物冒煙測試，以及 Node 22.19、24 和 26 相容性矩陣。

貢獻者可以選擇執行 `pnpm run check:all`，執行全面的本機閘門集。該命令獨立於 Git 掛鉤，也不是對 agent 的指令。

### CI 閘門

keyless [CI 工作流程](../.github/workflows/ci.yml) 將獨立閘門分組到若干寬粒度 lane，並在受支援的 Node 版本上執行一組較小的相容性檢查。產物消費端在各自 lane 內等待一次 build。單獨的真實 API 工作流程按其設定的 worker 上限執行 `pnpm run test:e2e`。當前閘門和 job 清單以 [scripts/run-gates.ts](../scripts/run-gates.ts) 和工作流程文件為準。

### 日常命令

根目錄的[貢獻者說明](../AGENTS.md#commands)概述常用命令，[`package.json`](../package.json) 與 [scripts/run-gates.ts](../scripts/run-gates.ts) 則負責當前指令碼和閘門清單。請選擇覆蓋變更表面的最小檢查集。文件變更使用 `pnpm run doc-sync`；包公開行為變更還需更新所屬 README 或 JSDoc，而基於建置產物的檢查需要先執行 `pnpm run build`。

### 示範

從原始碼 checkout 執行這些示範前，請單獨執行倉庫建置：

```sh
pnpm run build
```

單次執行的 Headless coding agent 需要環境變數或倉庫根目錄 `.env` 中的 `DEEPSEEK_API_KEY`：

```sh
pnpm dsh --profile headless "summarize this workspace"
```

自指的 cordis 示範可以檢查並修改其即時外掛程式執行時期，並需要相同的憑證（預設 `web`，也可用 `acp`）：

```sh
pnpm run demo:cordis
```

ACP 自動化伺服器透過 JSON-RPC stdio 提供全新 agent 工作階段，同樣需要 `DEEPSEEK_API_KEY`：

```sh
pnpm run demo:acp
```

### TODO 標記

請使用以下三種註解標籤之一標記程式碼中的已知問題，按緊急程度排序：

- `FIXME`：應當阻塞新版本發布的問題。除非評審者明確同意該更改可以合併，否則發布版本不應包含未解決的 `FIXME`；
- `TODO`：應當儘快修復的問題，等資源到位即可處理；
- `XXX`：也許某天會修復的問題，優先級最低，不作承諾。

請選擇與緊急程度匹配的標籤，讓瀏覽程式碼的人一眼分清「發布阻塞」和「有空再說」。

### 逐字記錄類型定義（`ts type-equiv`）

[子系統](subsystems/README.md)頁面會把與原始碼等價的聲明及其原始 JSDoc 一並貼上，讓讀者看到確切類型定義和原始碼約定。為防止貼上內容在原始碼變化時漂移，請將其圍欄為 ` ```ts type-equiv `（而不是 ` ```ts `），並在 `scripts/type-equiv.manifest.json` 中登記它映像檔的原始檔和符號：

```json
{ "doc": "docs/subsystems/session.md", "symbol": "SessionEvent", "source": "packages/core/session/src/types.ts" }
```

`pnpm run verify-type-equiv`（`doc-sync` 的一環）隨後透過 TypeScript 解析器從原始碼提取該符號的聲明及其附帶的 JSDoc，並斷言程式碼塊同時匹配兩者。對於不應把實作體寫進目錄的類，請使用 ` ```ts public-api ` 並設定 `"projection": "public-api"`；閘門檢查的投影會保留公共欄位、構造函式、訪問器、方法以及類和成員的原始 JSDoc，同時省略實作體和私有或受保護成員。比對會忽略空白和非 JSDoc 註解，但要求保留每條原始 JSDoc（包括成員文件），讓讀者同時看到原始碼約定和確切類型定義。該閘門按文件、符號和投影，在主塊與 manifest 條目之間強制 1:1 對應；只有當配對 `.zh.md` 塊的完整受跟蹤圍欄序列與其無後綴兄弟文件按位元組一致且順序相同時，才會複用後者的條目。`doc-typecheck` 對可編譯圍欄應用同一派生規則，同時跳過兩種原始碼等價圍欄的編譯，並將其排除在 opt-out 比例的計算之外。當你改動一個已記錄的類型聲明或其 JSDoc 時，閘門會失敗直到你更新貼上內容；當你增刪一個主塊時，請在同一個變更裡更新 manifest。
