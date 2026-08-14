# Agent Note: 三條獨立序列的私有 NPM 發布

Status: implemented

[English](2026-08-10-npm-release-sequences.md) | [简体中文](2026-08-10-npm-release-sequences.zh.md) | 繁體中文

## 問題

這個倉庫有三組互不相干的可發布包，卻沒有任何發布通道把它們送上 registry。

`packages/*/*` 與 `apps/*` 組成 `@deepseek-ai/dsh` 的執行面；`vendor/*` 是九個 rescope 過的 Cordis 框架包，各自帶著上游的版本號；`native/landlock-run/packages/*` 是 Linux 平臺包，有自己的 workflow。三組的版本基線、變更節奏和建置要求都不同：dsh 隨產品迭代，vendor 只在同步上游或改動本機修改時才動，native 需要 musl 工具鏈和逐架構建置。把它們塞進一條發布管線，等於每次產品發版都要重發框架和原生二進位。

擋路的還有兩處硬門。全部 217 個 workspace manifest 都是 `private: true`，`npm publish` 直接拒絕。更隱蔽的是 933 條 dsh 兄弟包之間硬寫的 `peerDependencies: "^0.0.1"`：`pnpm pack` 只替換 `workspace:` 協議，不動語義範圍，而 `^0.0.1` 等於 `>=0.0.1 <0.0.2`——發 `0.0.2` 落不進去，發 `0.0.1-rc.1` 也落不進去（semver 規定不帶預發布段的範圍排除預發布版本）。這些條目至今沒出事，只因為版本一直停在 `0.0.1`。

`scripts/publish-npm-baseline.ts` 是本機發布指令碼：它把 pack 與 publish 放進同一個行程，需要人工在本機完成認證與重試，且把 vendor 排除在發布集之外。它不能作為 CI 發布的基礎，但其中的 tarball payload 校驗與已安裝產物探針是驗證過的零件。

## 決策

### 三條獨立序列

`packages/`、`vendor/`、`native/` 各自一條 bump 序列、各自一次發布，不共享版本號、不共享觸發、不互相等待。發 dsh 不重發 vendor，發 vendor 不重發 native。

| 序列 | 成員 | 版本基線 | tag | workflow |
|---|---|---|---|---|
| dsh | `packages/*/*` + `apps/*`（`@deepseek-ai/dsh` 與 `@deepseek-ai/dsh-web-frontend`） | 全族與 workspace 根共用一個 `0.0.x` | `dsh-v<版本>` | `release.yml` |
| vendored framework | `vendor/*` 九個包 | 每包各自一條版本線 | `vendor-<包名>-v<版本>`（每包一個） | `release-vendor.yml` |
| native | `native/landlock-run/packages/*` | 自己的 `0.0.x` | `landlock-run-v<版本>` | `landlock-run-release.yml` |

三組一律發到 npmjs.com 的 `@deepseek-ai` scope，且 access 按序列而非按 scope 區分：vendored 框架與 native 包是 `public`，dsh 族是 `restricted`（[理由](2026-08-13-public-vendor-and-native-sequences.md)）。沒有任何發布路徑傳 `--access`——一個選項無法服務等級互不相同的序列，且會覆蓋真正擁有該等級的 manifest。

### 版本由本機命令寫進倉庫，CI 只核對與上傳

每條序列有一條 bump-and-commit 命令：算出目標版本，寫進相關 manifest，跑 `pnpm install --lockfile-only`，再把 manifest 連 lockfile 一起 commit。發布版本因此在倉庫裡查得到。tag 由人工在 commit 合入 master 後打；CI 不寫倉庫，也不需要寫權限。

`release:dsh` 接受 `major`、`minor`、`patch` 或顯式版本號，把同一個版本寫進全族**以及 workspace 根**——workspace 約束要求每個成員的版本等於根版本，所以根承載族版本，而根的檢查接受預發布段。像 `0.0.1-rc.1` 這樣的預發布號先把 pack、已安裝產物探針和一次真實私有發布跑通，數字版本隨後。dist-tag 沿用 `landlock-run-release.yml` 已有的判定：版本帶預發布段就 `--tag next`，否則進 `latest`。

### vendor：誰改了誰發版，tag 就是帳本

vendor 九包加了 scope 之後與上游脫鉤，但保留各自的版本線。發布版本取「manifest 版本」與「上次發布版本」中較高的那個，再遞增 patch——這一步同時去掉上游的預發布段。首發版本：

| 包 | 上游版本 | 首發版本 |
|---|---|---|
| `@deepseek-ai/cordis` | 4.0.0-rc.7 | 4.0.1 |
| `@deepseek-ai/cordis-plugin-loader` | 1.0.0-rc.5 | 1.0.1 |
| `@deepseek-ai/cosmokit` | 1.8.1 | 1.8.2 |
| `@deepseek-ai/schemastery` | 3.18.0 | 3.18.1 |
| `@deepseek-ai/cordis-plugin-hmr` | 1.0.15 | 1.0.16 |
| `@deepseek-ai/cordis-plugin-include` | 1.0.4 | 1.0.5 |
| `@deepseek-ai/cordis-plugin-timer` | 1.1.2 | 1.1.3 |
| `@deepseek-ai/cordis-plugin-group` | 1.0.0 | 1.0.1 |
| `@deepseek-ai/cordis-plugin-logger-console` | 1.0.0 | 1.0.1 |

以「上次發布版本」為基線才扛得住重同步：本倉發過 `4.0.1` 之後上游把版本復原成 `4.0.0-rc.8`，只看 manifest 會再算出 `4.0.1` 並撞上已發版本。加 `--prerelease rc.1` 則發一次排練版：它進 `--tag next`，而且不佔用那組數字——預發布的優先級低於它所先行的正式版，所以 `4.0.1` 仍然接在 `4.0.1-rc.1` 之後。這個次序由指令碼自己算，不讀 `git tag --sort=v:refname`——git 會把預發布排在正式版之前。

只發改動過的包，而變更判據不引入新的狀態文件：**每包一個 tag，tag 就是「上次發布到哪個 commit」的記錄**。bump 對每個包取最新的 `vendor-<包名>-v*` tag，拿包目錄與它做 diff。一條路徑算命中的條件是：manifest 的 `files` 選中它，或 npm 無論如何都會發布它（`package.json`、`README*`、`LICENSE*`），或者——當該包的 `files` 選中 `lib/` 時——它是建置輸入（`src/**`、`tsconfig*.json`、建置設定）。最後那條規則的存在理由是建置產物不在 git 裡：沒有它，真實的原始碼改動會讀成「沒變化」，而下一次發布會在一個位元組已變的版本上失敗。

tag 只是 commit 指針，不是發布成功的證明。bump 會向 registry 核對「最新 tag 指向的版本是否真的存在」，不存在就明確失敗交人處理——否則一個為失敗發布而推的 tag 會被讀成「已發布」，從此永遠跳過該包。查詢私有包需要憑據，因此未鑒權的機器只報告這道核對被跳過，不失敗。

`vendor/cordis` 現在也發布 `src`。它的 exports 聲明瞭 `"./src/*"`，tarball 裡沒有這些文件就等於把消費端指向不存在的路徑；而 `files` 只選建置產物，也讓變更判據沒有任何受 git 跟蹤的路徑可匹配。

### 發布只在 GitHub 執行，由 registry 狀態決定發什麼

發布只從 GitHub Actions 執行，沒有本機發布路徑。publish 不讀 tag、不讀任何「本次發布包含什麼」的清單，而是對每個打包好的 tarball 拿版本與 registry 比對，分三態：

| 狀態 | 處置 |
|---|---|
| registry 上沒有該版本 | 發布 |
| 已有該版本，且 tarball 的 sha512 等於記錄的 `dist.integrity` | 跳過：這是同一批產物的重跑 |
| 已有該版本，但 integrity 不同 | 失敗退出，報「內容已變但版本未 bump」 |

第三態攔住「改了程式碼卻沒 bump 版本」。前兩態給出冪等——同一個 artifact 重跑 publish 不會重複發布，也不需要人工挑揀包。同一條規則還解決了「一次 vendor 發布攜帶多個 tag，而 workflow 只能從一個 ref 觸發」的矛盾：workflow 從不從觸發它的 tag 去推斷該發哪些包。

三條序列都按這套判定，native 也在內：它透過自己的指令碼發布，而不是 shell 迴圈——一串裸 `npm publish` 無法重試，registry 對「重發已存在的版本」的回答是永久失敗，因此中途失敗一次就沒有前路了。

registry 的兩個行為決定了「怎麼嘗試一次發布」。寫入之間至少間隔兩秒並帶退避重試，因為連續背靠背發多個包會超出 registry 自身的處理速度，換來 `E409 Failed to save packument`。而每次重試都先重查 registry：報出來的失敗可能對應一次其實已經落地的寫入，所以「該版本現在存在且 integrity 與本 tarball 相同」算作已發布，而不是又一個待放置的版本。

### workspace 內部引用走 `workspace:` 協議

所有指向 workspace 成員的引用都用 `workspace:^`，由 `pnpm pack` 替換成匹配目標版本的範圍：兄弟包的 `peerDependencies` 跟隨族版本，指向 vendored 包的引用跟隨那個包自己的版本線。Landlock 平臺包保留 `workspace:*`（發布成精確版本），因為平臺包與它的入口必須版本完全一致。

`scripts/check-workspace-constraints.ts` 要求這個協議，所以新包無法再引入硬寫的範圍；同理，invariant companion 規則要求 `@deepseek-ai/dsh-invariants` 用 `workspace:^`。

### 發布族對象

這個領域裡的實體是**發布族**：一組共享版本基線與 tag 命名、可整體發布的包。新增一族等於加一個子類和一條 workflow lane，不改核心。

| 對象 | 職責 |
|---|---|
| `ReleaseFamily` | 一族的身份：成員發現、版本基線、tag 前綴、打包 payload 規則、已安裝入口 |
| `ReleaseMember` | 一個可發布包：目錄、包名、版本、manifest |
| `publishOrder` | 按執行時期相依性的拓撲序，同層按包名排；遇到環是報錯而不是隨意定序 |
| `pack` | 把整族打進一個目錄並記錄上傳順序 |
| `verify` | 族的版本基線；發布時還要求本次執行來自該族的 tag、且成員可發布 |
| `verify-packed-install` | 把一個或多個 pack 目錄的 tarball 裝進一次性 consumer，並驅動已安裝的可執行入口 |
| `publish` | 上面那三態 |
| `process` / `tarball` | 啟動命令、讀取打包 tarball 的唯一正家，其中的入口守衛讓每個指令碼都可被 import |

dsh 族套用倉庫的發布 payload 策略（拒絕原始碼與聲明對映）。vendored 族保留上游 payload，因為那些 manifest 匯出 `./src/*`，去掉 `src` 會發出一個匯出對映指向不存在文件的包。

### workflow 形狀：一次性 pack 全部，再統一 publish

`pack` job 一趟遍歷整個發布集，把每個成員打進同一個目錄，寫出上傳順序，整個目錄作為一份 artifact 上傳；`publish` job 下載那一份 artifact，按順序逐個發布。發布集是一個整體——絕不會出現一半的包已經上了 registry、另一半還在建置。

`pack` 無憑據，在每個 pull request 和每次 master push 上跑，所以一個 pull request 就能證明發布集仍能完整打出來。`publish` 是手動 dispatch，掛在 `npm-publish` environment 後面等人工審批，且既不建置也不重建——它上傳的就是 pack 產出的位元組。pack 的 run 按 ref 分組，並行的 pull request 不會互相頂掉；全域性分組落在 publish job 上，因為 dist-tag 是共享的 registry 狀態。

dsh 的驗證會一並安裝 vendored 族的 pack 產物。harness 的包把 vendored 框架聲明成 peer，而那些包屬於另一條序列，無憑據的 job 無法從私有 registry 取到——所以 `release.yml` 為驗證而打包 vendored 族，發布的仍只有自己那一份。

驗證還會打一份 Landlock entry 的 tarball——`dsh-sandbox-local` 把它聲明為普通 `dependencies`——同時略去選填相依性。那些選填項背後的平臺包需要 musl 工具鏈且每個架構各建置一次，單臺 runner 產不出來；而裝不到它們的消費端也必須能起，這正是「選填」在這裡的含義。因此驗證按目錄內容讀取 tarball，而不是讀發布順序：一個目錄可能只裝著為滿足跨序列相依性而打出來的包，任何發布順序都不描述它。

### 本次帶出的倉庫改動

| 項 | 內容 |
|---|---|
| 發布集 manifest | 去掉 `private: true`；按序列補 `publishConfig.access` 與帶各自 `directory` 的 `repository` |
| 發布集邊界 | `packages/*/*`、`apps/*`、`vendor/*` 的全部成員 |
| 相依性協議 | workspace 內部引用為 `workspace:^`，由 `check-workspace-constraints.ts` 與 invariant companion 規則強制 |
| 根 `AGENTS.md` | 「vendored 包是 `private: true`」這條約定不再成立 |
| `vendor/README.md` | 記錄「`src` 加入 `cordis` 的 `files`」這條本機修改 |
| native 三包 | `publishConfig.access: public`，且其 workflow 不傳 `--access` |

### 與先前提案的關係

本 Note 取代 [以產物為先的 NPM 基線發布](../../proposed/process/2026-08-04-artifact-first-npm-baseline-publication.md) 中的版本方案與發布集邊界：那篇的 `<base>-<时间戳>-<短 SHA>` 預發布版本與 `dev-<base>` dist-tag 不再採用，vendor 也不排除在發布集之外。兩篇一致的部分保留：pack 與 publish 分離、publish 只消費已驗證的 tarball、payload 與安裝後探針作為發布門。

## 曾考慮的替代方案

**`<base>-<时间戳>-<短 SHA>` 版本號。** 曾計畫用於持續 dev 發布。它與「把發布版本留在倉庫裡」衝突：版本內嵌 commit SHA，而把版本寫回會產生新的 commit，於是 SHA 只能指向被發布的父 commit，這條鏈要靠約定解釋。改用數字版本後，`0.0.1-rc.1` 這類預發布號已經覆蓋「先驗證再正式發」。

**用 `vendor/published.json` 帳本記錄每包的已發版本與 commit。** 這是 tag 方案之前的設計。它新增一份必須與 registry 不漂移的狀態文件；per-package tag 提供同樣的 commit 指針，而 tag 本來就要打，不引入第二處狀態。

**事件級 tag（`vendor-r1`、`vendor-r2`）。** 為「一次發布事件攜帶多個包版本」準備。既然由 registry 決定發什麼，workflow 就不再從 tag 推斷集合，per-package tag 夠用，而且每個 tag 攜帶的是它自己那個包的真實版本。

**把九個 vendored 包統一到一條 `4.0.x` 版本線。** 省掉變更偵測，但 cosmokit 會從 `1.8.1` 跳到 `4.0.1`、丟失上游血緣；九包內部的上游範圍（`^1.8.1` 之類）會立刻失配，必須改寫 vendored manifest。

**每次 vendor 發布把九包全部 patch+1，不做變更偵測。** 機制最少，代價是內容與上一版逐位元組相同的包也拿到新版本號。tag 把變更偵測的成本壓到「讀一個 tag、跑一次 diff」，不值得為省這點讓版本號虛漲。

**只按版本號判斷「是否已發布」，不比對內容。** 參照流程根本不查 registry：publish 逐個上傳，重複版本由 npm 拒絕。只按版本號跳過會漏掉「改了程式碼沒 bump」，而這是唯一會安靜地把舊位元組留在 registry 上的錯誤。代價是引入一次 registry 查詢和對建置可復現性的相依性。

**只做打包後安裝驗證，不起本機 registry。** 參照流程是把 tarball 解包成一棵樹、用普通 Node 驅動，這繞過了版本範圍解析。曾提議在 CI 裡起本機 registry 補這一層，被否：產物正確性已由既有測試覆蓋，發布路徑由 master 的排練覆蓋，而 pull request 只需證明發布集能打出來。用 `file:` 說明符安裝依然會對每個內部相依性走一遍範圍解析。

**按入口閉包挑一部分包發。** 從 `@deepseek-ai/dsh` 與 `@deepseek-ai/dsh-web-frontend` 沿 `dependencies` 爬得到 156 個包，比全量少 61 個。但本倉的外掛程式是 `cordis.yml` 按名字掛載的、不是被 import 的：`vendor/cordis-plugin-group` 與 `vendor/cordis-plugin-logger-console` 落在相依性閉包之外，卻是執行時期必需。照程式碼相依性挑的失敗形態是「消費端裝完起不來」，而且要額外持續證明「沒漏任何掛載項」。私有 scope 下多出來的包對組織外不可見。`python/`、根 `examples/`、`docs/` 與 `website/` 不是成員。

**在 `scripts/publish-npm-baseline.ts` 上擴充。** 它是本機發布指令碼，把 pack 與 publish 放在同一行程，與「無憑據 pack、受保護 publish」的分離相反。它驗證過的零件——payload 校驗與已安裝產物探針——被搬運複用，以免 `pnpm run duplication` 判重複。

**一個 workflow 用 `family` 輸入選擇序列。** 兩套版本模型塞進一個文件，會讓 concurrency 組、tag 前綴、排練觸發條件全部分叉成條件表達式。一族一個文件更短也更好讀。

**在發布期改寫相依性範圍。** 與協議相比，改寫邏輯只在 CI 執行過，本機 `pnpm install` 看不出它是否正確，而且每次發布都要重來一遍。

**在 CI 裡執行 bump 並把版本推回倉庫。** 需要給 workflow 倉庫寫權限，且發布分支上的版本 commit 會與人的 commit 競爭。bump 與 commit 留在本機，CI 只核對與上傳。

## 後果

發布指令碼是帶入口守衛的可 import 模組，其判斷都有單測覆蓋：tag 命名、發布順序與環報告、版本基線運算、payload 變更判據，以及各族的 payload 策略。第一版帶過的兩個缺陷——publish 命令在 import 時執行了 pack 命令、變更判據對 `vendor/cordis` 的原始碼改動失明——正是這類測試在對應接縫上能抓住的。

一個 pull request 會為兩條序列跑完整的 pack（無憑據），並把打包好的 dsh tarball 裝進一次性 consumer，用普通 Node 驅動 `dsh --version`。這個探針刻意只有一條命令：它證明 `files` 選出了完整 payload、發布出去的範圍可解析，不涉及任何互動行為。

代價：

- **tag 可能與 registry 漂移。** 為失敗發布而推的 tag 由 bump 的 registry 核對攔下，但只在有憑據的地方；未鑒權的機器只報告這道核對被跳過。
- **變更判據相依性 tag 可見。** shallow clone 或未拉 tag 會把 vendored 族的判據退化成「全部首發」。`fetch-depth: 0` 是前提，不是最佳化。
- **協議改寫觸及 1504 處相依性聲明。** 它不改變本機解析（pnpm 本來就從 workspace 解析），但改變了發布出去的範圍寫法。
- **私有包需要憑據才能安裝。** 任何消費端——CI、沙盒 e2e、外部使用者——都要持有 scope 憑據，Landlock 三包也在其中；它們從未發布過，所以沒有切斷既有的匿名安裝路徑。
- **`repository` 指向的組織與執行 workflow 的組織不同。** 用 token 發布不受影響；npm provenance（OIDC）要求二者一致，屆時要麼把 `repository` 改指過去，要麼從它指向的組織發布。
- **位元組可復現性是假定的，沒有實測。** 「integrity 相同則跳過」這一態建立在「同一 commit 兩次 pack 得到相同位元組」之上。目前沒有任何東西測量過它：若建置嵌入了絕對路徑或時間，重跑會誤報失敗。在第一次可能被重跑的發布之前實測，若不成立就退到比對 tarball 內逐文件內容雜湊。
- **用較舊的 artifact 重跑 publish 會把 `latest` 拉回舊版。** 發布是按版本決定的，所以在較新版本之後重發較舊的一批，會讓穩定 dist-tag 再次指向舊版。排練用的是預發布版本，它永遠不佔 `latest`。
- **首發是一次大步。** 九個 vendored 包與整個 dsh 集一次寄出，任何 payload 缺陷都會集中在同一次發布裡暴露——這正是先用預發布版本把完整鏈路走一遍的理由。
