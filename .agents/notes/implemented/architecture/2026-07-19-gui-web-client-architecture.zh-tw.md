# Agent Note: Web 用戶端架構——client cordis 外掛程式樹、slot 體系與 React-free 對象層

Status: implemented

[English](2026-07-19-gui-web-client-architecture.md) | [简体中文](2026-07-19-gui-web-client-architecture.zh.md) | 繁體中文

> 分工線：通道無關的分層模型與 RPC 協議（訊息模型/類型體系/約定面/用戶端基類）見 [分層與 RPC 協議筆記](2026-07-19-gui-layering-and-rpc-protocol.md)；本篇 = 瀏覽器側：client cordis 樹如何裝載、UI 外掛程式如何經 slot 與服務組合、React-free 對象層如何以不可變快照供給 React。

## Problem

瀏覽器用戶端受兩股力塑形。其一是流式：事件驅動的對話 UI 裡，若業務狀態（事件視窗、流式累積、待答互動、連線狀態機）散落在 React 元件與全域性 store 中，每個 token 區塊都會震盪渲染樹，且換 UI 庫等於重寫業務邏輯。其二是模組化：UI 功能（版面配置、側欄、對話、主題、語言包）必須是可獨立裝載的外掛程式——按 host 下發的 manifest（中繼資料清單）在執行時期組合，而非編譯進單一 bundle——同時不放棄跨外掛程式邊界的編譯期類型安全。

## Decision

兩端都跑 cordis。host 是一棵 cordis 外掛程式樹；瀏覽器裡跑第二棵 client 側 cordis 樹，其中每一項 UI 能力都是外掛程式，由殼靜態持有的 loader 動態裝載。樹內 cordis ctx 承載一切執行時期事實（服務、store、工作階段 scope），React 是純投影：元件對框架零 import，一切經 props 注入，經 `useSyncExternalStore`（下稱 uSES）訂閱不可變快照。

```
┌─ Host ─────────────────────────┐   ┌─ Browser ─────────────────────────────────────────┐
│ sessions/agents/SessionLog     │   │ client cordis root ctx                             │
│ apiproxy: RPC + mux/host 双流  │◀─▶│  ├ vendored Loader + ctx.modules（内核，壳静态持有）│
│ webserver:                     │   │  ├ immediately entries: connection/runtime/        │
│  ├ GET /plugins/<id>/client.js │   │  │   ui-theme/i18n（fetch bundle，boot 预拉）       │
│  └ GET / 注入 __DSH_BOOT__ 图  │   │  ├ lazy entries: layout/sidebar/                   │
│                                │   │  │   conversation/trajectory（fetch bundle，按需） │
└────────────────────────────────┘   │  ├ app-shell 伪行（壳内静态注册，同一治理）        │
                                     │  └ session scope ×N（观看驱动，惰性建）            │
                                     │ React: loading 页 → settled → 整 UI 一次成型       │
                                     └────────────────────────────────────────────────────┘
```

## client cordis 樹與裝載鏈

裝載鏈——兩類包（普通包 vs dsh.client 外掛程式）、模組系統/外掛程式治理器之分、host 獨家撰寫的帶修訂號 entry 圖之上的雙階段 boot、熱重新載入——歸 [client 外掛程式裝載筆記](2026-07-23-client-plugin-loading-model.md) 所有。本篇賴以立足的事實：瀏覽器啟動與 host 相同的 vendored `@cordisjs/plugin-loader`，由 client 模組系統（`ctx.modules`，`packages/client/modules`）填上其 `internal` 約定；凡帶產品行為的單元都是 host 獨家撰寫的 `__DSH_BOOT__` 圖裡的 entry——每個生產外掛程式包（含基礎設施）都攜帶 `dsh.client` 聲明、以 fetch 到達的 `./client` tsdown 閉包 bundle 供給，`immediately` 行的差別僅在 boot 第一階段預取，而普通包（react 家族、cordis、尚未升格的庫）保持打進殼、已播種、對圖不可見；bundle 執行 `window.__ModuleLoader__.load({ id, factory })`，其 `require` 由 lazy CJS 模組表應答（種子詞條 + 已登記工廠，首次 require 時物化並記憶化——跨外掛程式值 import 是建置錯誤，協作走 cordis 服務）；外掛程式 CSS 內聯在 bundle 裡、物化時注入為 `<style data-plugin="<id>">`（CSS Modules 雜湊 + 歸屬標記 = 隔離，重載時移除）；熱重新載入已在 dev 圖落地——webserver 對自己供給的 bundle 做 stat 輪詢並廣播 `rebuilt` SSE 幀，`client-hmr` 外掛程式每幀換掉一個 fiber。settled 翻轉（`loader.await()` + 一次全 ACTIVE 掃描）依舊讓殼從 loading 頁一次切換到真 UI——settled 意味著每個 entry 已建立、每個 fiber 都到達 ACTIVE，FAILED/PENDING 的 fiber 被大聲列出；不存在部分可用模式（漸進渲染為後置工作）。

類型宇宙在聚合層拆分——`tsconfig.host.json` 是 host program、`tsconfig.client.json` 是 client program，二者由 solution 根 `tsconfig.json` 引用，因為兩側都在相同鍵（`sessions`、`loader`）上對 cordis `Context` 做聲明合併且服務不同；client 包經純類型子路徑（`@deepseek-ai/dsh-session/types` 等）消費協議詞彙，host 側的聲明合併不會搭車進入 client program。

## slot 體系：頁面怎麼拼

slot 體繫有自己的筆記——[slot 體系標準](2026-07-22-slot-type-chain-implementation.md)——本文整體移交給它。此處只留一段定位摘要：殼只渲染 `'root'`；外掛程式用單獨一次 `register` 呼叫組合 UI——佔用 slot、聲明並授權子 slot（`children` spec 對象）、聲明 store、注入業務面；元件 props 分四份額自動推導到達（`PropsRuntime<K>` / `PropsRenderSlots<S>` / `PropsStore<H>` / inject），各有唯一真源。`SlotMap` 聲明合併仍是類型權威，entry 只攜帶 owner 份額（「誰注入的，類型歸誰」）；每個被渲染的註冊項都在 per-entry 錯誤邊界之內。

實作的家：登錄檔核心與 props 份額類型在 `packages/client/ui-slots`，出口元件/渲染器/uSES 橋在 `packages/client/web-react`。

## 服務與 scope 尋址

服務是外掛程式對其他外掛程式的唯一 API（UI 元件與注入面都不是 API；無人呼叫的外掛程式不掛服務——ui-trajectory 即最小外掛程式樣板：無 ctx 服務，只做檢視表 slot 註冊）。名冊：`ctx.connection`（api client + 流控制代碼）、`ctx.slots`（登錄檔包裝層，發 `slots/changed`，渲染入口，渲染器安裝約定）、`ctx.sessions`（清單 store、當前工作階段狀態、scope 樹）、`ctx.loader`、`ctx.theme`、`ctx.i18n`、`ctx.layout`（跨外掛程式檢視表導覽）、`ctx.conversation`（send/cancel/startSession）。過去住在服務 store 裡的觀看態（面板寬、選中、草稿）現按 [slot 體系標準](2026-07-22-slot-type-chain-implementation.md) 住 entry 聲明的 store。

slot 之外不存在第二種元件註冊模型——原檢視表環與工具環都已溶解進來。工作階段檢視表即 ui-conversation 聲明的 `'conversation.view'` list slot entry，tab 元資料隨註冊 options（`id`/`order`/`label`）走，per-view chrome 住檢視表元件自身。最終 Chat 業務 Node 透過 keyed/session `'conversation.chat.node'` slot 分發；ui-tool 擁有其中的 `tool-call` entry，遞迴渲染傳入的 `subCalls`，並聲明 keyed/session `'tool.call.toolview'` 子 slot。key 空間仍在執行時期開放（SlotMap 聲明 slot、從不聲明 key），root 與任意深度的後代都按 `entryKey: toolName` 分發，以 `GenericToolCard` 兜底。業務包透過 `ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: '<tool>' }, Row))` 註冊原子檢視表；聲明本身就是載入與重載相依性（[決策](2026-08-05-slot-declaration-injection.md)）。ui-conversation 還透過 `'conversation.details.tool'` 委託 selected call 的詳情正文，使 ui-tool 的 card model 保持為唯一展示所有者，同時避免 conversation 匯入 Tool 元件。與 target 無關的事件登錄檔和檢視表登錄檔是資料組裝 seam，不是平行元件登錄檔（[決策](2026-08-09-client-conversation-node-assembly.md)）。

**scope 尋址**與 host 側 agent（代理）scope 慣例同構：服務是 root 單例，方法不收 sessionId——它們讀呼叫方 ctx 上的 scope 標（`scopeOf(ctx)`）。在工作階段 scope 內，`ctx.conversation.send('hi', 'queue')` 自動打到該工作階段；跨工作階段呼叫換 ctx 定向（`ctx.sessions.scope(id)!.conversation.send(...)`）；從 root ctx 直接調 scoped 方法即 throw。client 工作階段 scope 的鑄造方式與 host agent scope 相同（no-op 外掛程式 fiber + scope 鍵 extend），首次觀看時惰性建，只有工作階段被移除且無人觀看才拆——僅 host 工作階段死亡不拆 scope（凍結為只讀視窗）。

## 資料對象層（`packages/client/runtime/src/client/sessions/`）

幀從這裡進、快照從這裡出、Conversation assembler 坐在中間——React-free（零 React import，grep 可斷言）：

```
mux/host frames (ConnectionController pump, injected sinks)
        │
        ▼
SessionManager.handleMuxEnvelope / handleHostEnvelope
        │ session frames target existing instances (requested waits buffer)
        ▼
Session.handleMuxEnvelope ──► contiguous Event window
        │                        │ replace / prepend / append
        │                        ▼
        │                ConversationNodeAssembler
        │                  Definitions -> Contexts -> view builders
        ▼
Notifier 微任务合批 ──► ConversationSnapshot 缓存 ──uSES──► 组件
```

- **Session**（session.ts）：懶建、常駐——建成後在後臺持續喫幀，切走切回秒顯。操作面：`prompt`/`cancel`（RPC 透傳；失敗落進快照的 `promptError`）、`open`（拉尾頁 history，冪等）、`loadOlder`（向上翻頁，防重入）、`resync`（重連 = 清視窗重跑 open）。訂閱面：`subscribe`/`getSnapshot`（恆返快取引用）——`implements ObservableSnapshot<ConversationSnapshot>`，構造時掛 `useSelector = bindSnapshotSelector(this)`，Session 本身就是 uSES 源。幀分發是一個 switch：`session/event` 幀按 seq 去重（唯一去重鍵），open 運送中時緩衝，否則追加 + 增量投影；open/縫合按 seq 合併 live 緩衝並去重，`subscribed.lastSeq` 超出視窗尾則回補一次。
- **ConversationSnapshot**（conversation.ts）：頂層不可變快照約定。`chat` 包含結構化 `order`、identity 穩定的 keyed Node reader、Turn/Step index 和 timeline；`nodes`、`partial`、`runningCalls`、`turnTimings`、`turnEnds` 是未遷移 Trajectory 消費端使用的相容 slice。pending interaction、queue、running、removed、open state、paging 和 prompt error 仍是 Session 資訊。**引用紀律**（memo 與 uSES 的前提）：未變化的子結構和 Node value 保持引用；單個業務更新只替換對應 key 的 value，除非它的順序或 Location 發生變化。React 仍只訂閱 Session 這一處 observable source，並由框架提供的 `useSession(selector)` 隔離 Node 與 Location 聚合更新。
- **SessionManager**（manager.ts）：實例簇 + 幀總入口 + 工作階段清單。帶 sessionId 的幀只投已存在實例（mux 廣播不得把每個工作階段都實例化）；例外是審批/問答 `requested` 幀——它們不落 history、open 無法回補，故緩衝進 `pendingBuffers`，實例化時重播。
- **Notifier**（notifier.ts）：兩條通知通道，按變更來源取用。`markDirty()`（默認；幀驅動程式一律用它）按微任務合批——N 次變更、一次通知、一次重渲染；flush 先重建快照快取再通知。`notifyNow()`（僅使用者手勢的直接回響）同 tick 重建並通知——受控輸入的回響若延到微任務，DOM 會回滾、遊標跳尾。幀驅動程式程式碼用 notifyNow 會讓合批塌回逐幀渲染；禁。
- **ConversationNodeAssembler**（`runtime/src/client/conversation/`）：Session 擁有的增量引擎在原始事件上執行各自獨立註冊的 Definition。`match(event)` 無須掃描 Context 即選填出 `(kind, id)`；start/update 構造 Definition state；引擎計算的 Location 攜帶 Turn/Step 關閉資訊；向前查詢 Context 時記錄相依性，並由後續 prepend 修復；`buildViewNode(target)` 只物化 dirty Context。Chat builder 保留結構順序和 per-key value identity，`useSession` selector 負責消費隔離，Assistant token 發布則合併到每個 animation frame 一次。[Conversation Node 決策](2026-08-09-client-conversation-node-assembly.md)擁有組裝邊界，[Tool 展示所有權](2026-08-08-client-tool-presentation-ownership.md)擁有 Tool 遞迴渲染。
- **ConnectionController**（在 `packages/client/connection`）：開 mux/host 雙流、for-await 泵入，代際圍欄之內指數退避重連（500ms 翻倍至 10s 封頂、抖動、無限重試）；sinks 單向注入（Controller 不認識 Session）。重連 = 重建：`onConnected` → 清單刷新 + 各已打開工作階段 resync。對象層只面向 `IApiClient`；Web 承載以 HTTP POST 載兩個 client→server 象限、以[每邏輯流一條 WebSocket](2026-08-04-websocket-downlink-carrier.md)載兩個 server→client 象限，用戶端類族歸分層筆記屬地。

## React 面（`packages/client/web-react`）

膠水包就是整條 ctx↔React 邊界；元件保持零框架相依性。

- 快照 store 引擎**住 runtime 包**（zustand vanilla + 草稿式更新，預設 `flush: 'sync'`，選填 `'raf'` 合批，選填整值 localStorage 持久化，dev 深凍結——全部從 `runtime` 的 `./client` 主出口匯出，無子路徑）：store 產物是裸的可觀察源，不帶任何掛鉤成員。外掛程式只經 [slot 體系標準](2026-07-22-slot-type-chain-implementation.md) 的 `defineStore` 聲明觸及引擎。web-react 在綁定處（`bindSnapshotSelector`，按源快取）從 React 消費的唯一資料約定合成每個掛鉤：`ObservableSnapshot<T>`（`getSnapshot`/`subscribe`）——Session 對象與快照 store 同構滿足它。業務外掛程式包只相依性 runtime 與 ui-slots；web-react 是僅殼可用的膠水。
- `bindSnapshotSelector(source)`：把一個源綁定為經 uSES-with-selector 的帶類型 selector 掛鉤。uSES 約定四條按構造成立：getSnapshot 恆返快取引用；subscribe 是綁定期閉包（引用永穩）；純 CSR 不傳 server snapshot；相等性預設 `Object.is`，按呼叫選填 `shallowEqual`。
- `useInvoke(fn)`：把非同步動作包成引用恆定的觸發器加 pending 標志；pending 走每個掛鉤的外部 store 經 uSES 讀出（渲染路徑零 setState），並行呼叫計數，invoke 引用永不變。
- 相等性協議，全鏈一致：生產端結構共享；消費端以 `Object.is` 或 `shallowEqual` 短路；`React.memo` 淺比較。深比較全鏈禁止。

## 目錄形態

Client 包位於 `packages/client/*`，`apps/web` 是殼 boot 匯出之上的薄 Vite 應用。外掛程式包的瀏覽器半邊在 `src/client/` 下；**一切建置產物落 `lib/`**——node 半邊為 `lib/index.js`/`lib/invariant.js`，瀏覽器 bundle 為 `lib/client.js`（共享 tsdown client 預設兩者皆出；無 `dist/` 目錄，`exports["./client"]` 指向 `./lib/client.js`）。`ui-slots`、web-react 與 runtime 構成基礎設施方向；功能外掛程式透過服務與 slot 協作，不匯入展示實作。

多域外掛程式包的 client 半邊還按未來包邊界再拆——ui-conversation 即樣板：

```
src/client/
  contract/    shared slot and cross-domain types
  service.ts   cross-domain orchestration
  skeleton/    conversation shell and details host
  conversation-nodes/ independently registered business Definitions and Chat builder
  chat/        ordered conversation view
  input/       composer state machine
  queue/       queued-message presentation
  settings/    conversation settings rows
  apply.ts     cross-domain assembly point
  index.ts     public contract surface
```

各領域實作文件不 import 兄弟領域；共享面統一經過 `contract/`。`scripts/verify-client-domain-graph.ts` 把守分層（contract=0、domain=1、apply/index=2；import 只准指向不高於自身的層級；兄弟領域相依性會失敗）。Tool 展示已經拆為獨立 `ui-tool` 包，只透過 ui-conversation 聲明的 slot 到達 chat 與 details。

## 怎麼開發

- **新 UI 功能** = 新外掛程式包：package.json 聲明 `dsh.client`（+ `inject` 拓撲），瀏覽器半邊寫在 `src/client/`（apply 掛服務/建 store、註冊 slot），無 host 邏輯時 node 半邊保持空 apply，用共享預設建置。把外掛程式加進 host 設定；manifest 與裝載隨之自動跟上。
- **新 slot**：見 [slot 體系標準筆記](2026-07-22-slot-type-chain-implementation.md)——約定合併進 `SlotMap`，在父 entry 的 `children` 裡聲明，經自動注入的 `renderSlot` prop 渲染。永不全域性匯出元件。
- **消費新幀類型**：純傳輸 session frame → Session 分發 switch；host 級 frame → Manager 路由表；已記錄的 conversation 業務事件 → Definition 加 keyed view renderer，不增加 Session 業務分支。
- **狀態住哪**：業務資料（事件、流式、待答）→ 永遠對象層；父知道的 → renderSlot 現場的 owner props；單元件私有（滾動、搜尋詞、展開集）→ 元件狀態；跨 entry 共享或跨重掛載存活（選中、草稿、面板寬）→ entry 聲明的 store（[slot 體系標準](2026-07-22-slot-type-chain-implementation.md)）。
- **通知通道**：幀驅動程式/非同步 = `markDirty` 合批；受控輸入需要同 tick 的使用者手勢直接回響 = `notifyNow`。

## Consequences

token 流不再震盪渲染樹：Assistant chunk 只更新一個業務 Context，每 animation frame 最多發布一次對應 keyed Node；無關行的 selector 結果保持原引用，因此不會重渲染。UI 功能以獨立外掛程式的粒度裝載、失敗、停用——一個崩潰的 slot 註冊項只黑一張卡，一個裝載失敗的 bundle 在 UI 切入之前大聲報錯。接受的代價：loader/模組表機件是團隊端到端自持的訂製基建；一次成型啟動（無漸進渲染）用首屏粒度換裝配簡單；雙類型 program 讓「這個文件歸哪個聚合」成為開發者偶爾要回答的問題。

## Alternatives considered

| Rejected | One-line reason |
|---|---|
| 靜態連結的單 SPA bundle | 外掛程式必須由 host 在執行時期按設定組合；單體把每個 UI 功能重新耦回一次建置 |
| window 全域性變數 / import map 供共享相依性 | DI require 表讓共享顯式、大聲失敗、可替換；全域性變數靜默洩漏身份與版本 |
| 業務資料進 zustand 切片 | 事件視窗/累積器是行為狀態機，不是扁平切片；對象層保住快照粒度與合批的可控性 |
| Tool 行使用平行的字串鍵元件登錄檔 | ui-tool 的 keyed 子 slot 透過唯一的 slot 註冊模型承載執行時期開放的 Tool 名稱集合（[toolview 溶解](2026-07-23-toolview-dissolution.md)） |
| 首個 web 用戶端交付就做漸進/Suspense 啟動 | 一次成型嚴格更簡單；loader 的按外掛程式狀態面已保留，漸進點亮日後可落地而無需重構 |
