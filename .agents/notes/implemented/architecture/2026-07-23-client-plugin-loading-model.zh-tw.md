# Agent Note: client 外掛程式裝載——普通包、dsh.client 外掛程式與雙階段 boot

Status: implemented

[English](2026-07-23-client-plugin-loading-model.md) | [简体中文](2026-07-23-client-plugin-loading-model.zh.md) | 繁體中文

> 範圍：瀏覽器側的外掛程式裝載機件——什麼是外掛程式、程式碼怎麼到達、熱重新載入如何搭在這套模型上。裝載鏈歸本篇所有；[Web 用戶端架構筆記](2026-07-19-gui-web-client-architecture.md) 在裝載問題上以本篇為準，繼續擁有 slot、資料對象層與 React 面。

## Problem

host 側，cordis 外掛程式裝載站在 Node 的模組機制之上——require cache 與內部 ESM loader 擁有模組身份與位元組。vendored `@cordisjs/plugin-loader` 在這層基座之上實作外掛程式治理與熱重新載入，二者在唯一一道邊界相接：`Loader.internal`。

瀏覽器用戶端跑同一套 cordis 外掛程式機制，因此底下需要同樣的基座——而瀏覽器沒有 Node 模組系統。

常規前端工程在建置期消化全部相依性：單一 bundle，external 由打包器解決，執行時期無物可管。在此之上再做執行時期模組管理，正是這裡的特殊需求。client 因此拆成兩層：上層是經同一份 vendored Loader 的 cordis 外掛程式裝載，下層是模組粒度的相依性管理——`dsh-client-modules`。

下層供給四項能力：external（平臺清單）、遠端到達（同源外部 classic script 加惰性工廠登記）、版本化（內容雜湊 rev）、熱更新（invalidate/prefetch）。

外掛程式 bundle 獨立建置在 Vite 模組圖之外。若把回應文字塞進內聯 script，瀏覽器只能看到一次動態原始碼執行：網路資源、生成 bundle、TypeScript/TSX 原始碼之間沒有標準 sourcemap 鏈，效能 profile 與 stack 只能落到生成後的 `client.js`；模組系統還要持有整份原始碼文字，並把同一項到達職責拆成 fetch 與 execute 兩道傳輸邊界。

在此之上，client 與 host 外掛程式以一致的方式註冊與裝載：包聲明一次 `dsh.client`，host 把聲明掃描進 boot 圖，同一套 Loader 語義在兩側治理 entry。

第一代 client loader（`createClientLoader`）把這兩層手寫進了同一個函式。這一融合留下的是：沒有解除安裝/重載路徑（裝載一次性，style 標籤從不移除）、在三個文件間人肉抄寫且早已漂移的相依性清單、一條供跨外掛程式 import 走的模組表後門——既複製了 cordis 的服務機制，又把裝載順序變成正確性約束。下文的結構取代了它。

## Decision

### 兩類包；`dsh.client` 即外掛程式，別無他義

什麼讓一個包成為外掛程式？只有一條規則：**一個包的消費端式一旦是 cordis 相依性注入，它就是外掛程式包；在此之前它是普通包。**程式碼怎麼到達頁面不屬於分類體系——到達方式由包的類別推得，而不是反過來定義類別。

- **普通包**是模組系統自身所需的絕對基座，加上尚未轉成 DI 的庫：react 家族、cordis、`@deepseek-ai/dsh-client-modules`（模組系統本身——它永遠不可能是外掛程式，因為模組先於一切模組）、web 殼核心，以及——暫時——ui-slots、web-react、ui-primitives。普通包打進殼 bundle、播種進模組表、對 host 圖不可見。
- **外掛程式包**是其餘一切。每個都攜帶 `dsh.client` manifest（中繼資料清單）聲明（`{ platform, inject, immediately? }`）和同一種統一形態：共享 tsdown 預設產出 `lib/client.js`，`exports["./client"]` 指向該 bundle。每個都是 host 編寫的圖裡受治理的 entry。當前包括：connection、runtime、ui-theme、i18n、hmr（僅進 dev 圖）、ui-layout、ui-sidebar、ui-conversation、ui-model-selector、ui-user-questions、ui-trajectory。

manifest 擁有包的裝載約定：它的 `inject` 相依性邊，加選填的 `immediately` 預取標記（預設即 lazy）。負責組合的 app 只擁有名冊。

新增一個外掛程式包：聲明 `dsh.client`，經共享預設產出 `./client` bundle，把包名加進負責組合的 app 的名冊。除此之外無需任何交接。

普通包何時升格為外掛程式？升級法則，記錄在案讓遷移路徑保持誠實：**普通包在其消費端改用 cordis DI 之時升格為外掛程式包，絕不提前。**三項升格在排隊：ui-slots（現居 runtime 的 slots 機件——SlotRegistry、渲染器約定、root slot）、web-react（渲染器安裝移入自己的 `apply`）、ui-primitives（元件經 slot/服務供給之時）。在那之前它們保持普通包身份，符號匯出保持普通的靜態 import。

四條邊規則治理橫跨兩類包的 import。沒有一條相依性任何單包標記：

- **外掛程式 ↔ 外掛程式的值 import 是建置錯誤。**與兩側的 `immediately` 聲明無關——規則不得相依性一個人人可翻轉的標記。協作走 cordis inject/服務。`import type` 豁免；類型鏈分毫未動。這條規則正是 `scopeOf` 是 `SessionRuntime` 方法、`transportError` 住在 `dsh-host-apiproxy` wire 層（它的 `RpcResult` 老家，內聯安全）的原因。
- **外掛程式 → 普通包的值 import 外接為 external**，按平臺清單判定。清單是殼裡的一個常數（`platform.ts`：react 家族、cordis、ui-slots、web-react、ui-primitives），tsdown 預設（external 判定）與 `seed.ts`（模組表預熱）都 import 它。一個常數、兩個消費端——人肉同步這一漂移缺陷類死透。
- **純度閘門覆蓋每個外掛程式包。**它的三條分支：平臺 import 外接為 external；INLINE_SAFE wire 層內聯；其餘任何 workspace 洩漏即建置錯誤。正是統一的 bundle 形態讓這一覆蓋不留死角——每個外掛程式都經同一預設建置，沒有包能坐在閘門之外。
- **殼自足。**核心（boot + loading 頁）對任何外掛程式包零值 import；其狀態 store 為手寫。大聲失敗的呈現不得相依性它所報告失敗的那個系統。

### 一套模組系統，一個外掛程式治理器

瀏覽器復刻 host 側的分工。`dsh-client-modules`（`ClientModuleSystem`）坐上 host 側由 Node 內部 ESM loader 佔據的模組系統席位；同一份 vendored `@cordisjs/plugin-loader` 在兩側都坐治理席。二者的分界線一句話說盡：**模組系統擁有模組身份與位元組——程式碼怎麼到達、怎麼登記、怎麼變成匯出內容；Loader 擁有外掛程式生命週期——外掛程式何時掛載、等待什麼、如何拆除。**

`ClientModuleSystem` 是一張 lazy CJS 表。執行 bundle 只**登記**其工廠——bundle 呼叫 `window.__ModuleLoader__.load({ id, factory })`，此外什麼都不發生。模組體的一切副作用（包括 CSS 注入）都住在工廠閉包裡，在物化時執行：物化即該 id 的首次 `require`/import，此後記憶化。工廠若 require 一個已登記未物化的同伴，就遞迴物化它，因此任何地方都不存在排序。被要求 import 一個 id 時，表按固定分支順序解析：種子詞條 → 記憶化的記錄 → 靜態登記（殼自有模組，如 app-shell）→ 已登記的工廠 → 圖行外部 classic script 載入 → 大聲拋錯。最後這一拋是建置期純度閘門在執行時期的映像檔。系統還保管逐模組的簿記——名下 `<style data-plugin>` 標籤 id、觀測到的 require 邊——並暴露 HMR（熱模組替換）需要的兩個動詞：`prefetch(id)`（載入指令碼、只登記工廠；並行呼叫共享同一運送中任務）與 `invalidate(id)`（丟棄工廠與記錄，下次到達即重新載入）。

vendored Loader 經其 `internal` 約定消費模組系統——唯一呼叫點是 `tree.import`——並擁有一切 entry 形狀的交易：entry 建立、fiber 經 cordis 服務等待的啟用（注入的服務未就位即保持 PENDING，服務 provide 時級聯啟用）、update/refresh、拆除。治理程式碼按 vendor 政策與 host 側逐位元組相同。瀏覽器化是殼 vite 設定裡的編譯期對映：一個 `node:module` stub 別名加若干 `process.*` define，使 `ModuleLoader.fromInternal()` 返回 undefined——這正是留給殼來填的空槽。模組系統掛載為 `ctx.modules`。

### 外部指令碼到達與原始碼對映

每個圖行的 `url` 交給一個帶 `async` 的同源外部 classic `<script src>`。瀏覽器擁有網路請求與指令碼執行；`load` 或 `error` 結帳後節點立即移除，避免 HMR 累積失效節點。成功結帳還要求圖行對應的工廠 id 已出現在模組表中，否則到達失敗；登記仍不執行工廠，副作用邊界繼續落在首次物化。

共享 tsdown 預設為每個外掛程式產出 `client.js.map`，並把第一方原始碼路徑重寫成瀏覽器可識別的倉庫形狀 `/packages/<group>/<package>/src/...`。內聯進 bundle 的其他 workspace 原始碼同樣回到其 `packages/` 歸屬，相依性包路徑保持原樣；`sourcesContent` 承載原始碼，因此 host 只需在 `/plugins/<id>/client.js.map` 供給 map，無需開放原始碼路由。Vite 殼也產出 sourcemap，使殼程式碼與圖外外掛程式都能從 stack 和效能 profile 回到 TypeScript/TSX。

`rev` 繼續作為指令碼 URL 的查詢參數和內容一致性錨點，bundle 與 map 都以 `no-cache` 供給。外部指令碼的 `error` 事件不給回應狀態與正文，因此失敗診斷只報告 URL；同源 host 供給與建置期寫入的 handoff id 是身份邊界，`load` 後的工廠存在性檢查負責拒絕未登記預期 id 的產物。

### 裝載流程，端到端

從 `dsh web` 啟動到 UI 出現之間發生了什麼？三個階段：host 組合並供給一張圖，殼預取，然後 cordis 編排。

**host 側——組合這張圖。**

1. 負責組合的 app（`apps/cli`）把名冊作為普通行放進它的 `cordis.yml` 設定樹——client 外掛程式包與每個 host 外掛程式一樣是 entry 行，包括無條件掛載的 `client-hmr` 行。名冊行 import 失敗由 `assertEntriesLoaded` 捕獲；fiber reject 的行則由 `assertEntriesActivated` 報告原始 stack（[host boot 決策](2026-07-24-web-config-tree-boot-and-transport-layering.md)）。
2. `dsh-client-modules` 的 node 半（該包是雙面的：瀏覽器半就是模組表）掃描 loader entry 的 package.json `dsh.client` 聲明，組合出 `window.__DSH_BOOT__`：`{ rev, entries: [{ id, url, rev, inject?, immediately? }] }`。`inject` 邊與 `immediately` 標記都來自 manifest，永不人肉抄寫。它會拒絕沒有已建置 `./client` bundle 的已聲明外掛程式，並把它們的 package/path 行歸到一條原始碼建置要求下；畸形聲明欄位同樣會讓啟用失敗，host 檢查會從 FAILED fiber 報告這兩類錯誤。
3. 掃描是單包增量——不存在全量重掃程式碼路徑。每次 cordis `internal/plugin` 發射把該 fiber 的 entry 名標髒（無 entry 的 fiber O(1) 丟棄）；微任務 flush 把每個髒名對帳 live loader entries，包元資料（含「非 client 包」的否定結論）按名永久快取，bundle 重雜湊只經 `rebuilt(id)` 可達。啟用趟從當前 entries 灌同一髒集合併同步 flush，初掃與穩態共享一條實作。每個 bundle 的內容雜湊是其 `rev`（快取失效 + HMR diff 錨點），行集合雜湊進 `graph.rev`，每一行都作為指令碼資源供給：`/plugins/<id>/client.js?rev=…`，對應 sourcemap 位於同一路徑加 `.map`。圖類型單源在 modules 包的 `./client` 出口——webserver 對圖一無所知（它是樸素路由註冊外掛程式；bundle 路由和 index 渲染 tap 都由 modules 自己註冊）。

為什麼名冊是 yml 行而不是掃描？因為哪些外掛程式組合進一次部署是組合決策，不是包屬性——一個在倉庫中聲明瞭 dsh.client 的包，不代表這次部署要掛載它，掃描發現無從替人做這個決定；node 半隻掃描設定樹實際掛載了的東西。

**第一階段——模組面。**殼在圖之上建起模組系統，然後平行預取每個 `immediately` 行。預取即載入外部指令碼，只登記工廠。單行預取失敗在這裡被吞下：第二階段 import 時會重試載入並擁有那次大聲失敗，因此一個壞行藏不住其他行。`immediately` 是預取標記——不是屏障，不是身份。包聲明它，登錄檔把它帶進圖行。基礎設施外掛程式（connection、runtime、ui-theme、i18n，外加 hmr）聲明它；UI 外掛程式則徑直按需到達。

**第二階段——外掛程式面。**

1. 核心掛載 vendored Loader，在任何 entry 存在之前就把模組系統注入為 `internal`。順序有講究：`tree.import` 的裸 import 兜底分支在瀏覽器裡絕不能跑到。
2. 它為圖中每一行建立 entry，外加 app-shell 偽行。裝配 entry 是核心自己追加的殼自有程式碼——向模組系統靜態登記，絕不進 host 圖——因此與其餘一切共乘同一套 entry 生命週期與狀態覆蓋。
3. 建立順序不攜帶任何語義；fiber 經服務等待啟用。
4. `settled` = 每個 entry 已建立 + `loader.await()` 完全靜止 + 一次全 ACTIVE 掃描。掃描列出每個 import 失敗、FAILED 或 PENDING 的 fiber 及其缺失的服務。它存在的理由：cordis 的 inject 等待沒有逾時——這次掃描就是大聲失敗的兜底線。
5. loading 頁的啟動狀態是經 `internal/status` 對真實 fiber 狀態的投影。settled 翻轉即一次性切換到真實 UI。

### 熱重新載入：一個驅動程式外掛程式，自行監視的 bundle

熱重新載入是一項組合決策：web 組合包無條件掛載 `client-hmr` 行（一個常規的外掛程式包），其 node 半帶來 bundle 監視與 SSE（Server-Sent Events）通道；沒有重建 watcher 改寫用戶端 bundle 時鏈路保持空閒。不應暴露它的組合可以停用該行。

重建好的 bundle 怎麼變成重載訊號？hmr 的 node 半自己觀察——沒有建置器來通知它。它從 `ctx.clientModules.clientPath(id)` 讀取圖上各行的 bundle 路徑，由 HMR 自持的單個定時器對當前圖上的每一行做 stat 輪詢。新增圖行時，順序固定為先同步取得 stat 基線，再立即呼叫 `clientModuleHost.rebuilt(id)`：在模組 host 算出圖雜湊之後、取得基線之前發生的寫入會被這次立即重雜湊捕獲；取得基線之後發生的寫入則會留下 stat 差異，供下一次輪詢捕獲。這避開了 `fs.watchFile`：它以非同步首次 stat 建立基線，可能把構造期間的重建靜默吸收進基線。監視集合的成員隨 `onGraphChanged` 更新；消失的行撤下監視，輪詢時缺失的 bundle 則讓對應行保持標髒狀態，文件重現時即使元資料相同也強制重雜湊。mtime/size 變化或行處於標髒狀態時，`clientModuleHost.rebuilt(id)` 是重雜湊的唯一入口；當 `rev` 真的變了，node 半纔在 `GET /plugins/events` 上廣播 `rebuilt` 幀——這是一條系統級 SSE 通道，連線即發全量圖，變更時發 `rebuilt` 幀，僅供呈現的 wire，永不進工作階段日誌。輪詢是刻意選擇：inotify 在 weka 網路掛載上不觸發，建置側監視器需要 `--poll` 也是同一原因；輪詢間隔是一個經校驗的設定欄位（默認 500ms），dispose（資源釋放）會清掉那一個定時器。重建 bundle 則是任意一個 tsdown watch 行程的事——`scripts/dev-web.ts` 仍作為 watch 建置入口保留，其包清單在啟動時掃描 `packages/*/*/package.json` 按 dsh.client 發現——建置器與 host 共享零協議。寫一半的 bundle 被撕裂讀取會自愈：寫入完成期間 stat 持續變化，下一個輪詢節拍會再次重雜湊並廣播最終的 rev。

瀏覽器側，驅動程式外掛程式每幀重載一個外掛程式，序列執行：

1. `invalidate`——丟棄過時的工廠與記錄。工廠還活著會讓下一步變成 no-op。
2. `prefetch`——載入外部指令碼並登記新工廠，舊 fiber 此刻仍在服役。
3. `registry.delete`——先於任何 fiber 操作。裸做 fiber dispose 會觸發 vendored Loader 的自 dispose 分支，把 entry 永久停用。
4. 排空舊 fiber 的各 disposer。
5. 移除名下的 `<style data-plugin>` 標籤。
6. `entry.refresh()`——重新 import，物化新工廠。CSS 在這裡重新注入，沿用同一批穩定標籤 id。
7. `fiber.await()`——讓失敗大聲重拋。

每個外掛程式都共享同一套語義；`immediately` 行的重載與 lazy 行分毫不差。相依性級聯不花一行 client 程式碼：fiber 的啟用紀元串接著它各服務提供方的 uid，因此換掉提供方的 fiber，每個相依性方都會經 cordis 本身重新裝載。重載 connection 或 runtime 會級聯整個 UI——正確，雖然重。

支持邊界，如實陳述。重載粒度刻意做粗：全新 fiber、全新元件、React 狀態丟失、資料層不動——react-refresh 級的狀態保留與「重執行 bundle 即重跑工廠」相衝突，屬刻意不做。普通包（react 家族、殼核心、尚未升格的庫）不是 entry：改它們意味著殼重建加整頁刷新。v1 不做回滾：import 失敗讓 entry 失去 fiber，下一個 rebuilt 幀從頭重試；apply 失敗留下 FAILED fiber 交給狀態投影；兩者都大聲記錄。自我重載可行——運送中的重載在舊 bundle 的閉包裡跑完，新的 apply 再開一條新 SSE 通道——但空窗期到達的幀會丟失，下次重建會再次通知。一處已知的僅限 dev 競態：rebuilt 幀與仍運送中的 boot 到達重疊時共享那次到達的任務，可能物化重建前的位元組；下一幀自愈。

## 包盤點（現狀 → 長期）

| 包 | 角色 | 現狀 | 長期 |
|---|---|---|---|
| react 家族 / cordis | 平臺單例 | 打進殼，已播種 | 永為普通包（絕對基座） |
| vendored `@cordisjs/plugin-loader` | entry 治理（兩側同一份程式碼） | 編譯期瀏覽器化，核心掛載 | 不動（vendor 政策） |
| `dsh-client-modules` | client 模組系統 | lazy CJS 模組表；雙階段 boot | 永為普通包（模組先於模組） |
| `dsh-client-web` | 殼核心 + AppRoot + app-shell 裝配 | 自足（手寫狀態 store，零外掛程式值 import） | 持續縮小 |
| `dsh-client-ui-slots` | slot 登錄檔核心 | 普通包，已播種 | 升格為外掛程式；接收 runtime 的 slots 機件 |
| `dsh-client-web-react` | ctx↔React 膠水 | 普通包，已播種 | 升格為外掛程式；渲染器安裝移入其 apply |
| `dsh-client-ui-primitives` | 基礎元件 | 普通包，已播種 | 升格為外掛程式（元件經 slot/服務供給） |
| `dsh-client-connection` | wire 層 | 外掛程式（dsh.client + bundle），聲明 `immediately` | 傳輸替換（Electron IPC 載體） |
| `dsh-client-runtime` | 工作階段對象層 + slots 服務 + store 引擎 | 外掛程式，聲明 `immediately` | 持續縮向純工作階段對象層 |
| `dsh-client-ui-theme` | 主題 token/服務 | 外掛程式，聲明 `immediately`，外加 `./styles/*` 原始碼通道 | Theme Registry（另行裁定） |
| `dsh-client-i18n` | I18nService | 外掛程式，聲明 `immediately` | 按部署組合語言包 |
| `dsh-client-hmr` | 熱重新載入驅動程式 | 外掛程式，聲明 `immediately` | 回滾；重連握手 |
| ui-layout / ui-sidebar / ui-conversation / ui-trajectory | UI 功能 | 外掛程式，按需到達 | conversation 域拆分；trajectory 真實現 |

## Consequences

wire 兩側跑著同一份治理實作；瀏覽器特有層只包含一套模組系統和一個重載外掛程式。外掛程式包只有一種形態，純度閘門因此覆蓋全部外掛程式。相依性邊與啟動檔位都與其所有者——manifest——同住，負責組合的 app 只握名冊。各漂移缺陷類被結構性關死：共享清單人肉同步、裝載順序耦合、跨外掛程式 import、名冊/檔位雙重記帳。瀏覽器原生指令碼裝載使外掛程式網路資源、生成 bundle 與 TypeScript/TSX 原始碼保持標準對映，模組系統也只保留一個可替換的 `loadBundle` 掛鉤。

接受的代價：vendored Loader 在瀏覽器裡背著閒置機件（EntryTree 持久化是 no-op，分組/隔離未用）；開發期每次修改外掛程式都要付一次 bundle 重建加 fiber 重掛；圖中 `inject` 行僅是資訊性說明——啟用的真相在服務層——因此不匹配會在 settled 掃描時浮出，而不是在圖校驗時被攔下；三個尚未升格的庫在各自的 DI 轉換落地之前保持靜態 import 匯出；每個 bundle 多出一份 sourcemap 產物，外部指令碼失敗也只能給出粗粒度的 URL 診斷，不能像顯式 fetch 那樣報告 HTTP 狀態。

名冊：住在 web 組合包的設定樹裡（`packages/bundle/web-app/cordis.patch.yml`）；`mountWebPlugins` 與 `CLIENT_PACKAGES` 常數已消失，重組一次部署等於換 yml/overlay。圖的組合器從 webserver 側的登錄檔遷進 `dsh-client-modules` 的 node 半（該包按本 note 的升級法則升格為雙面——其消費端現經 cordis DI 到達），傳輸拆分同輪落地：webserver 變為樸素路由註冊外掛程式，`/api/*` 綁定遷到 connection 的 node 半、走升格後的 `api-gateway` 外掛程式（`dsh-host-apiproxy` 提供 `ctx.apiProxy`），dev 的 bundle 監視與 SSE（Server-Sent Events）通道遷到 hmr 的 node 半。

## Alternatives considered

| Rejected | One-line reason |
|---|---|
| 兩軸分類體系（entry × 到達），基礎設施包不帶 dsh.client | 抹掉了 manifest 相依性邊（inject 洩漏給組合方）、把外掛程式形態拆成兩種、讓純度閘門對一半外掛程式失明 |
| 繼續把手寫 loader 演化成治理器 | 重新實作 vendored Loader 已擁有的 entry/fiber 生命週期；HMR 將與 host 側毫無共享骨架 |
| 在瀏覽器複用 `@cordisjs/plugin-hmr` | 約 80% 在解決瀏覽器沒有的問題（fs 監聽、深度圖著色、Node 的雙快取）；只按形狀抄用其重載骨架 |
| 模組聯邦（module federation） | 獨立建置的遠端 bundle 恰是 vite 聯邦不支持的形態 |
| import map | 早已排除；DI require 表是終局機制 |
| 現在就徹底 ctx 化（react 與庫全走服務，不設模組表） | 模組軸上的極端形態；擱置——升級法則讓包一次一個地走向它 |
| 凍結表 + 到達即實例化 | 要求按到達時刻排序；lazy CJS 登記讓遞迴 `require` 自行定序，且與樸素拉取器的階段拆分相合 |
| fetch 回應文字後注入內聯 `<script>` | 模組系統必須緩衝整份原始碼並維護 fetch/execute 兩條路徑；動態原始碼執行也切斷瀏覽器網路資源、sourcemap 與 profile 的原生關聯 |
| 建置器推送重建通道（編排器在 `onSuccess` 裡 POST `/plugins/rebuilt`） | 把重載耦合到一個欽定的建置器行程和第二套 wire 協議；webserver 本就握有每個 bundle 路徑，stat 輪詢（每次 stat 變化即重雜湊）已兜住當年為推送辯護的撕裂寫競態 |
