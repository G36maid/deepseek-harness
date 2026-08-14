# Agent Note: GUI 分層與 RPC 協議——host/client 按能力提供方分層、四象限訊息模型與 fetch 載體

Status: implemented

[English](2026-07-19-gui-layering-and-rpc-protocol.md) | [简体中文](2026-07-19-gui-layering-and-rpc-protocol.zh.md) | 繁體中文

> 分工線：本篇 = 分層模型 + 通道無關的 RPC 協議；協議的 Web 實作由 HTTP 上行加 [WebSocket 下行載體](2026-08-04-websocket-downlink-carrier.md)組成，瀏覽器對象層見 [Web 用戶端架構筆記](2026-07-19-gui-web-client-architecture.md)。

## Problem

需要提供 UI 對接層，除已有 ACP（Agent Client Protocol）/stdio 基線外，還需要 Web（server）、Electron 等其他產品用戶端。我們把它們統一稱為 Client。希望具備以下能力：
- 一個 `dsh` 行程同時支持 `dsh web`（啟動）和 `dsh --profile headless`（headless），一個行程兩種模式（設計預留）
- 在 Electron 中使用與 `dsh web` 相同的 Web 技術啟動

那麼當前的工程程式碼需要穩定的分層職責模型，便於以後接入各類 client。

同時各消費端的物理通道不同（瀏覽器 HTTP／WebSocket、行程內 fetch/SSE、將來 IPC），還需要一個通道無關的訊息模型和單一約定真源，讓「加一個方法」「換一種載體」互不牽連，且 wire 上的每則訊息可類型校驗、可觀測、可對帳。

## Decision

### 分層

目錄按照如下分層：
- `packages/host/*`：包只提供 Host 側能力（代表了以現在 Harness 實體外掛程式系統為主體的 Node.js 程式碼核心工程），除此之外，還包含
    - 統一後端協議（fetch、HTTP、流式介面等）定義和支持，見本篇「訊息協議」起各節
- `packages/client/*`：包只提供 Client 側能力，每包單邊不混。這裡住三類包（兩條軸歸 [client 外掛程式裝載筆記](2026-07-23-client-plugin-loading-model.md) 所有）：
    - **純庫**（`ui-slots`、`web-react`、`ui-primitives`，外加核心包 `loader`）：普通根入口包，靜態打包進殼；前三者播種進模組表。
    - **靜態到達 entry 包**（`connection`、`runtime`、`ui-theme`、`i18n`、`hmr`）：無 `dsh.client` 鍵、無瀏覽器 bundle——殼把它們的 `src/client/` 半邊打進自己的 bundle 並向 `ctx.modules` 登記；它們與其餘單元一樣，作為 host 獨家撰寫的圖裡的 entry 受治理。
    - **fetch 到達外掛程式包**（`ui-layout`、`ui-sidebar`、`ui-conversation`、`ui-trajectory`）：雙入口——根入口是 node 半邊（空 `apply`，其存在是為了讓 host Loader 管轄生命週期、讓 web 外掛程式登錄檔發現 package.json 的 `dsh.client` 聲明）；實作住在 `src/client/` 下，經 `./client` 子路徑發布（tsdown 閉包工廠 bundle）。跨外掛程式消費 `/client` 只限類型；值層面的協作走 cordis 服務。
- `apps/` 作為對外匯出的應用入口，可以由 Client / Host 混合組裝。
    - `apps/web`（`dsh-web-frontend`）是 vite 應用：`dsh-client-web` 匯出的殼 API 之上的一層薄 `main.ts`。
    - `apps/cli`（`@deepseek-ai/dsh`）分發命令：`dsh web` = Host + webserver + 建置出的 `dsh-web-frontend` dist；`dsh --profile headless` = [直接使用核心 Agent／Session 的入口](2026-08-09-headless-direct-core-entry-point.md)，不含 Host、HTTP 或瀏覽器層。
    - 將來的 Electron 應用經由 IPC fetch 載體複用同一套 web client 包。

```
apps/*  (applications: apps/web = vite app, apps/cli = bin dispatch)
  │ consume
  ▼
packages/host/*                      packages/client/*
  apiproxy   front layer: protocol     pure libs: ui-slots / web-react / ui-primitives
  runtime    assembly / host entity    dsh.client plugins ×8 (node half = empty apply,
  webserver  Web HTTP carriage                              client half = src/client/)
  │ ctx.plugin(...)                      ▲ import only apiproxy's /api /client subpaths
  ▼                                      │ (type-only + the client base class)
harness core packages ──────────────────┘ (types reach the browser via import type)
```

方向紀律（每條都由包 deps 可核）：

- `runtime → apiproxy` 單向；apiproxy 僅相依性類型定義。
- client 側包**永不 import** host 側包的執行時期（只喫 `/api`、`/client` 兩個瀏覽器安全子路徑）。
- `webserver` 不相依性 `runtime`：它提供 `{ fetch }` 特定實作 ——「webserver ← runtime」只是執行時期注入關係，不是包相依性。
- client 側跨包 import 外掛程式包一律走 `/client` 子路徑，且外掛程式包之間只限類型 import——跨外掛程式值 import 在 tsdown 純度閘門處即建置錯誤（值層面的協作走 cordis 服務；邊規則歸 [client 外掛程式裝載筆記](2026-07-23-client-plugin-loading-model.md) 所有）。

TypeScript 以 solution 根引用的**兩個聚合 program** 檢查（`tsconfig.json` = solution；`tsconfig.host.json` = host 側 + 測試，排除 `packages/client`；`tsconfig.client.json` = client 各包及其測試）：兩側在相同鍵（`sessions`、`loader`）下以不同服務合併 cordis `Context` 介面，單一 program 會同時看到兩份聲明合併而報衝突。共享葉子包（session/llm/tools/apiproxy 等）只建置一次，由兩個 program 共同引用（[拓撲](../process/2026-07-22-tsconfig-solution-root-two-aggregates.md)）。

協議側：TS interface（`packages/host/apiproxy/src/api/`，零 Node 相依性，瀏覽器可 import）；wire 訊息統一為**雙向模型**——每條邏輯訊息按「誰發起 × request/response」分類（兩軸四格，後文稱四象限），與物理通道解耦；用戶端統一繼承 `AbstractApiClient`（協議不變數全在基類，平臺差異只是 `doFetch` 傳輸切面）。

#### 分層角色

| 層 | 包 | 職責 | 關鍵紀律 |
|---|---|---|---|
| 前置層 | `dsh-host-apiproxy` | TS/zod 定義 (api/)+ fetch 抽象 (fetch/：handler + 用戶端基類) | 做簡單、每個消費端都要；Node/瀏覽器皆可 import；協議內容見下文「訊息協議」起各節；client 不得經 ctx 繞開 api |
| 裝配層 | `dsh-host-runtime` | 外掛程式組合 + ApiProxy 整合 + web UI 外掛程式掛載（覆蓋八個 dsh.client 包的記憶體 Loader 樹）；host 級設定歸屬地（defaults/persistenceRoot，將來使用者 profile） | 裝什麼外掛程式、給什麼預設值只在這裡定；殼不得改裝配 |
| 承載層 | `dsh-host-webserver` | Web HTTP 與 upgrade：靜態服務 + `/api/*`→handler 轉發 + WebSocket upgrade route + close 語義；外掛程式 bundle 端點 + `__DSH_BOOT__` manifest（中繼資料清單）注入（由 web 外掛程式登錄檔供給） | Web（瀏覽器訪問）專用；零 workspace 相依性（登錄檔經結構注入到達）；Electron 不複用它 |
| client 庫 | `dsh-client-ui-slots` / `dsh-client-web-react` / `dsh-client-ui-primitives` | slot 登錄檔核心 / ctx↔React 膠合 / 純 React 原子元件 | 元件零 cordis 執行時期相依性；由殼播種進 loader 模組表 |
| client 外掛程式 | `dsh-client-connection` / `dsh-client-runtime` / `dsh-client-ui-theme` / `dsh-client-i18n` / `dsh-client-ui-layout` / `dsh-client-ui-sidebar` / `dsh-client-ui-conversation` / `dsh-client-ui-trajectory` | 瀏覽器側 cordis 外掛程式樹（wire 消費端、核心服務、主題、i18n、版面配置、側欄、對話、軌跡）——見 Web 用戶端架構筆記 | 雙入口（node 半邊=空 apply；實作在 `src/client/`）；消費面唯一經 ApiProxy |
| 應用 | `@deepseek-ai/dsh`（apps/cli）+ `dsh-web-frontend`（apps/web，vite 應用） | bin 粗分發 + 每個應用一個拼裝模組（web.ts / headless.ts）；vite 應用是 `dsh-client-web` 殼表面之上的薄 main | 各應用使用動態 import，因此不會互相載入；dist 定位等 workspace 知識留在 app |

#### 命名規則

`packages/host/*` 與 `packages/client/*` 下的包名**必須含目錄組前綴**：host/runtime → `dsh-host-runtime`、client/runtime → `dsh-client-runtime`。目錄名不重複組前綴（host/ 已表達）。因此包名尾段 ≠ 目錄名，tsconfig.base.json 的 `dsh-*` 通配（按目錄名解析）命不中——**這兩組的每包需顯式 paths 條目**，且 client 各包的 `/client` 子路徑要單列條目，使原始碼級解析與 exports map 一致。

#### 怎麼接入一個新應用（操作清單）

1. **選 fetch 偽造方式**：瀏覽器同源 HTTP / 行程內 `host.handler.fetch` 注入 / 自寫傳輸切面子類（如將來 Electron IPC，見下文「子類表」）。
2. **在 `apps/` 下寫拼裝模組**：`startHost()` + 用戶端子類 + 該應用私有的訊號/列印/退出語義；混合體不建包，拼裝寫在 app 裡。
3. **需要 HTTP 承載才 import `dsh-host-webserver`**，否則零埠。

現有兩個應用保持這一區分：Web 應用掛載 Host、載體與瀏覽器組合，而 `dsh --profile headless` 掛載直接使用核心服務的 runner，不包含 Host、HTTP 或埠。ACP 類協議橋不遵循 client 載體清單：它把 core 暴露給外部生態，直接透過 `ctx.plugin(入口插件)` 掛載，不使用 fetch。

## 訊息協議

以下各節是前置層（`dsh-host-apiproxy`）承載的協議本體。wire 上只有四種訊息（四象限）——右列的 Web 承載只是示例，換載體（行程內/IPC）時四象限不變：

```
                 client 发起                      server 发起
  request   ① ClientRequest                 ③ ServerRequest
            （POST /api/<method> body）      （WebSocket message：session 事件、审批/问答 requested）
  response  ② ServerResponse                ④ ClientResponse
            （该 POST 的 HTTP 应答体）        （POST /api/respond body，回填 ③ 的 rpcId）
```

### wire 全形：四具名判別 union（`api/rpc.ts`）

| 類型 | 判別 tag | 欄位 | rpcId 歸屬 | Web 承載 |
|---|---|---|---|---|
| `ClientRequest` | `'client-request'` | `rpcId` `method` `payload` | client mint | `POST /api/<method>` body |
| `ServerResponse` | `'server-response'` | `rpcId` `result` | 回填 ① | 該 POST 的應答體（恆 HTTP 200） |
| `ServerRequest` | `'server-request'` | `rpcId` `method` `payload` | server mint | WebSocket text message |
| `ClientResponse` | `'client-response'` | `rpcId` `result` | 回填 ③ | `POST /api/respond` body |

`RpcMessage = ClientRequest | ServerResponse | ServerRequest | ClientResponse`，`switch (message.type)` 窄化。

**rpcId 紀律**（`RpcId` 是 branded string，構造函式 `RpcId()`）：

- 誰發起誰 mint；應答一律回填對應 request 的 rpcId，**絕不 mint 新 id**。
- server-request 分兩類，靜態按 `method`（=幀 type）區分，**不設第三種 kind**：可應答幀（`approval/requested`、`question/requested`）的 rpcId 是穩定邏輯請求 id（受理時 mint 一次、基線重播原樣複用、client 以它回填應答）；純推送幀（`session/event` 等）的 rpcId 標識該次推送（每次新 mint）。
- 業務程式碼不 mint：unary 的 mint 收口在用戶端基類 `callUnary`，幀的 mint 收口在 host 側。

### 簽名窄形與載體補全

域介面簽名只感知窄形：`RpcRequest<P> = { rpcId, payload }`、`RpcResponse<T> = { rpcId, result: RpcResult<T> }`。載體層把窄形補全為全形（補 `type` tag 與 `method`），方向不靠通道推斷。`RpcResult<T> = { ok: true; value } | { ok: false; error: RpcError }`——方法不 throw 業務錯誤。

### RpcReceipt：載體回執

`ClientResponse` 的 HTTP 應答體是 `RpcReceipt = { accepted: true } | { accepted: false; reason: 'not-pending' | 'bad-response' }`——載體層回執，**不是** RpcMessage（response 不再有 response）；遲到/重複應答收 `not-pending`，邏輯收斂點是 `*/resolved` 幀。

## 類型體系：函式簽名即真源

### RpcMethodMap 與派生泛型（`api/rpc-map.ts`）

方法的參數/返回結構**只住在介面方法簽名裡**；map 登記方法本身；其餘一切位置（handler、client、store、測試）引用派生泛型，禁止複寫字面量或另起平鋪具名類型：

```ts ignore-check
export interface RpcMethodMap {
  'session.list': SessionsApi['list']        // map key 即 wire 路径段
  // …其余方法同形登记，全集见 api/rpc-map.ts
}
// 派生泛型（穿透窄形取业务类型；实际声明带 K extends keyof RpcMethodMap 约束）
export type RequestPayload<K> = Parameters<RpcMethodMap[K]>[0]['payload']
export type ResponseValue<K> =
  Awaited<ReturnType<RpcMethodMap[K]>> extends RpcResponse<infer T> ? T : never
```

流方法（`events.mux`/`events.host`）不進 map（不是 unary）；`respond` 不進 map（是 client-response 不是方法呼叫）。

### 錯誤模型（`RpcErrorDetailsMap`）

錯誤碼示例一行：

| code | details | 何時 |
|---|---|---|
| `bad-request` | `{ issues: ZodIssue[] }` | wire/payload zod 校驗失敗 |

碼全集見 `api/rpc.ts` 的 `RpcErrorDetailsMap`。`RpcError` 是 map 展開的分散式 union：`code` 判別、`switch` 後 `details` 自動窄化；**details 必填**——新碼=map 加一行+錯誤 schema 加一支，漏填是編譯錯誤。transport 故障（斷網、host 沒起）由載體拋例外，與業務錯誤兩層不混。

### zod 雙向校驗與錨定

- **兩級 parse**：全形 schema 一次（type/rpcId/method 結構 + handler 校驗 path==method）→ 業務 payload 按 method/幀型分派二次 parse；拒收 = `bad-request`。
- **錨定**：schema 統一 `satisfies z.ZodType<Wire<T>>`（`api/rpc.schema.ts`）。`Wire<T>` 是深度「| undefined」寬化——倉庫開 `exactOptionalPropertyTypes` 而 zod `.optional()` 輸出 `T | undefined`，直接錨原類型全線不可用；JSON wire 上缺席與 undefined 同形，寬化不損失校驗語義。透傳寬分支（`SessionEvent`/`ContentBlock`/幀 union/`RpcError`）與 brand id schema 用顯式 cast + 註釋。
- brand cast 單點：每個 schema 文件的 id cast 收口一處（`rpcIdSchema` 是 rpc.schema.ts 唯一 cast 點）。

## 約定面（ApiProxy）

根介面 `ApiProxy = { sessions, host, events, respond }`（`api/index.ts`）。新 client-request 域 = 新的一對文件（`<域>.ts` + `<域>.schema.ts`）+ 根介面一個欄位 + map 加行。

### unary 方法表

方法示例一行（表結構即讀法）：

| method key | 請求 payload | 返回 value | 語義 |
|---|---|---|---|
| `session.list` | `{ cursor?: string }`（cursor 留座不實作） | `{ items: SessionSummary[] }` | 已持久化 session，updatedAt 倒序；v1 不建索引 |

其餘方法（`session.create`/`session.history`/`session.rename`/`session.prompt`/`session.cancel`/`host.describe`）的參數與返回不在此複寫——簽名即真源，見 `api/sessions.ts`、`api/host.ts` 與 `RpcMethodMap`。

### 幀（server→client，具名 union）

兩條邏輯流：mux 流（`/api/events.mux`，全 session 聚合）與 host 流（`/api/events.host`，host 級事件）。瀏覽器透過每流一條下行 WebSocket 消費，行程內 fetch 載體以 SSE 保持同構；物理邊界見 [WebSocket 下行載體](2026-08-04-websocket-downlink-carrier.md)。幀示例一行：

| 幀 type | 載荷 | 何時發 |
|---|---|---|
| `session/event` | `{ sessionId; event: SessionEvent }` | 核心透傳：core 事件原樣過，`assistant/chunk` 即 token 流，無獨立 delta 幀 |

其餘幀型不在此複寫，union 全集見 `api/events.ts` 的 `MuxFrame`/`HostFrame`。語義上須知三點：`session/subscribed` 的 lastSeq 供 history 競態偵測；`approval/question` 的 requested 幀可應答（rpcId 穩定）、resolved 幀是收斂面；`host/agent-error` 是無 turn 位置 live 失敗的唯一齣口。

**透傳紀律**：wire 上的事件/訊息/內容區塊就是 core 類型（`SessionEvent`/`ContentBlock`），不造第二套 DTO；類型經 `import type` 相依性鏈直達瀏覽器。`SessionEventMap` merge-extensible：client 對未知 type documented-default（忽略），事件 schema 留「合法信封+未知類型」分支——信封仍嚴格，不是欄位級 passthrough。

### 工作階段語義（impl 側承諾）

- **歷史 = 事件重播**：一套 fold（client 側），歷史分頁與 live 增量同一條程式碼路徑；server 不做物化快照第二套。history **頁邊界對齊訊息邊界**（絕不從訊息中間截斷；區塊隨定稿訊息歸組），尾頁含進行中 partial 的區塊。
- **提示詞關聯**：提示詞的 rpcId 經 MessageSource（`'user-rpc'`）透傳進 `user/message` 事件，client 以此把樂觀回顯轉正。
- **重連 = 重建**：不做續傳 cursor（`mux` 的 `since` 簽名留座、傳了忽略）；斷線重開流 + 重拉 history；`subscribed.lastSeq` 與 history 尾 seq 比對，有縫再補拉一次。
- **冷工作階段處理遵循所有權**：`session.history` 與 `session.fork` 的源端讀取會在不獲取 Agent 的情況下檢查持久化儲存，而綁定到 Agent 的普通工作階段方法（如 `prompt`）則透過運送中表去重後復原工作階段。由工作階段支撐的 subagent 會拒絕這條通用復原路徑，且附加狀態不對用戶端暴露（`running` 已經覆蓋）。
- **審批/問答**：requested 幀受理時 mint 穩定 rpcId；先到先贏，host 記憶體 pending 表（keyed by rpcId）是唯一裁判；mux 重開後在 subscribed 幀後重播仍 pending 的 requested 幀（rpcId 原樣複用，刷新復原）。審計事件 `approval/asked`/`decided` 照舊走 durable 日誌——幀=live 控制面，事件=durable 審計。**現狀**：約定與幀類型已 shipped，host 側 pending 表/wire answerer 未實作（`api-proxy.ts` 的 `respond` 是 stub，恆回 `not-pending`）；PendingCard v1 只展示。
- **不設協議版本**：client 與 host 綁定發布，`host.describe` 無 protocolVersion 欄位；出現獨立發布的 client 時再引入。
- **預留方法紀律**：map 只含已實作方法，未知 method 在信封 parse 即 fail loud（`bad-request`），不設 not-implemented 兜底碼。預留清單（實作時把簽名抄進域介面+map 加行+schema 加對即升格）：`session.fork`、`prompt.mode` 加 `'inject'`、`task.list`、`host.listModels`、describe 加 `hostInstanceId`。（`session.rename` 已從本清單畢業：追加 user 來源的 `session/title` 事件。）

## 用戶端載體：AbstractApiClient 類體系（`fetch/client.ts`）

**協議不變數住基類，平臺差異是兩個切面**：抽象方法 `doFetch(url, init)`（傳輸）+ 可覆寫 `onEnvelope`（觀測）。

### IApiClient：caller 檢視表

與 `ApiProxy` 同域樹，但 unary 方法**收業務 payload 直傳**——載體 mint rpcId 並包信封，業務程式碼永不 mint；需要本次呼叫 rpcId 的從返回的 `RpcResponse` 回顯裡讀。`ApiProxy` 是 impl 側實作的窄形簽名約定，`IApiClient` 是 client 側消費的 payload 直傳檢視表，`AbstractApiClient` 橋接兩者。方法逐 key 從 `RpcMethodMap` 派生——map 加行即機械更新。

### 基類持有的協議路徑

| 路徑 | 內容 |
|---|---|
| `callUnary` | mint → tap → POST 全形 → `serverResponseSchema` parse → **rpcId 回顯校驗**（不符即 throw）→ tap → 吐窄形 |
| `readSse` | streaming fetch（非 EventSource）、`\n\n` 分幀、`data:` 拼接、ServerRequest 全形 parse、tap、吐窄形 `RpcRequest<帧>` |
| `respond` | client-response 透傳（rpcId 是回填，此處不 mint）；應答體 `rpcReceiptSchema` parse |
| unary 時限 | 普通 unary 呼叫使用 `AbortSignal.timeout`（默認 30s，構造參數可調）；由使用者掌控節奏的 `host.pickDirectory` 和 `command.execute` 不設該時限，但保留呼叫方／連線取消；流不設時限 |
| `resolveBase` | 瀏覽器=同源 origin；無 location 環境（Node）=`http://dsh.internal` 假 authority |

### 實例級 envelope 觀測切面

四象限全形均過 `onEnvelope`；基類實作是**實例持有的微任務合批緩衝**（幀風暴不逐幀驚擾消費端；模組級狀態會跨實例/測試洩漏，故實例持有）。觀測者經 `subscribeEnvelopes(listener)` 訂閱（收整批 `readonly RpcMessage[]`，返回退訂函式）；listener 拋例外被隔離（觀測不得反噬載體）。無訂閱者時零緩衝成本。當前沒有任何現役消費端訂閱——該切面是 wire 診斷的預留位（已退役的 RPC 除錯面板是它的首個消費端，將來的診斷消費端接入時不動載體）。

### 子類表（傳輸承載）

| 子類 | 所在包 | doFetch | 用途 |
|---|---|---|---|
| `InProcessApiClient` | apiproxy 本包 | 注入的 `{ fetch }` handler | **同構點**：`new InProcessApiClient(toFetchHandler(api))` 全程不過網路但真跑 wire 序列化/zod/SSE 幀；載體測試與呼叫方可以在不打開埠的情況下執行這套協議，而產品 `dsh --profile headless` 直接驅動程式 core |
| `WebApiClient` | dsh-client-connection | `globalThis.fetch` 上行 + 每邏輯流一條同源 WebSocket 下行 | 瀏覽器用戶端；物理邊界見 [WebSocket 下行載體](2026-08-04-websocket-downlink-carrier.md) |
| `FixtureApiClient` | dsh-client-connection | 不用（協議層覆寫） | 無 server 的 UI 開發（`?fixture`）：覆寫 `callUnary`/`openMux`/`openHost`/`respond` 虛方法，自己就是假 server（幀 rpcId 由它 mint，語義自洽） |
| IPC 橋子類（假想示例——尚無此形態） | Electron 殼 | IPC 序列化往返 | 只需換 doFetch，約定/基類零改 |

## 怎麼擴充（操作清單）

**加一個 unary 方法（5 步）**：①域介面加方法簽名（參數/返回內聯，這是唯一真源）；②`RpcMethodMap` 加一行；③`<域>.schema.ts` 加 request/value schema 對（錨 `Wire<RequestPayload<'…'>>`）；④handler `UNARY_ROUTES` 加一行（handler 的 Web 承載見 Web 用戶端架構筆記）；⑤impl 實作（回顯 `request.rpcId`）。client 側 `IApiClient`/`AbstractApiClient` 的域方法表同步加一行透傳。

**加一個幀型（3 步）**：①`MuxFrame`/`HostFrame` union 加一支（可應答幀須註明 rpcId 穩定語義）；②幀 schema 加一支；③消費端的 fold/路由 documented-default 已兜底未知型，按需加顯式分支。

**加一個錯誤碼（2 步）**：①`RpcErrorDetailsMap` 加一行（details 必填）；②`rpcErrorSchema` discriminatedUnion 加一支。

**接一種新載體**：繼承 `AbstractApiClient` 只實作 `doFetch`；需要攔截協議層（如 fixture（測試前置資料））再覆寫 `callUnary`/`openMux`/`openHost` 虛方法。約定與基類零改。

**升格一個預留方法**：把預留簽名抄進域介面 → map 加行 → schema 加對 → UNARY_ROUTES 加行 → impl 實作。

## Consequences

所有 client 使用同一約定：加一個 unary 方法是從單一簽名出發的五步機械改動，換載體只動一個 `doFetch` 子類，wire 上每則訊息可 zod 校驗、可經 envelope tap 觀測、可按 rpcId 對帳。普通 unary 呼叫仍受時限約束，而 `host.pickDirectory` 與 `command.execute` 可保持掛起，直到操作完成或呼叫方／連線取消到來；若由使用者掌控節奏的操作不自行結束，請求可能一直掛起，這是為避免把合理的操作時長視為傳輸失敗而接受的代價。其餘接受的代價：兩組包需要顯式 tsconfig paths 條目；預留方法（fork/inject/task.list/listModels/hostInstanceId）在真實消費端出現前保持休眠。

## Alternatives considered

| 放棄項 | 一句話理由 |
|---|---|
| 按產品分包（web 一族、electron 一族） | 產品共享的是 host/client 兩側能力，而不是某個應用實作；能力提供方分層讓新應用零新包 |
| 混合體建包（如 headless 獨立包） | 混合體只有一個消費端（它自己的 app），建包是無主抽象；拼裝寫在 app 裡可讀可棄 |
| 消費型 client 直連 ctx（省 apiproxy 一層） | client 需要 wire 校驗、觀測與多 client 一致性。直接 headless 是沒有 client 邊界的本機入口，使用公開的 Agent／Session seam，而不是 client 命令面 |
| webserver 相依性 runtime（省 handler 注入） | 結構 typing 注入讓 webserver 可被 sidecar/測試複用且零 workspace 相依性；包相依性會把裝配知識拖進承載層 |
| 包名不帶組前綴（沿用 dsh-<尾段>） | `dsh-runtime`/`dsh-web-ui` 在扁平 npm 命名空間裡失去歸屬資訊；代價只是每包一條顯式 paths |
| 複用倉內 JSON-RPC 2.0（dsh-sdk-jsonrpc-server） | 數字錯誤碼退化成單碼兜底、約定雙份人肉對齊、命名無 convention 自然漂移 |
| 三信封模型（Request/Response/Frame 各一信封，簽名不感知方向） | rpcId 是邏輯層關聯，幀與應答的方向語義靠通道推斷在換載體時即失效 |
| 具名 Request/Response 類型對為真源（map 登記類型對） | 平鋪具名類型是同一事實的第二個名字；簽名 infer 反推讓加方法只改一處 |
| REST 風格路徑 | 消費端是自家 client，無第三方 REST 體驗訴求；RPC 直映方法表更機械 |
| DTO 層（wire 專用第二套結構） | core 類型 type-only 直達瀏覽器零成本；DTO 是永久的雙向同步稅 |
| cursor 續傳（mux since 實裝） | 重連=重建（opencode 同款）覆蓋 v1 全部需求；簽名留座，實裝等真實消費端 |
| createApiClient 工廠函式（原實作） | 平臺差異（傳輸/觀測）是繼承切面不是參數；類體系讓 fixture 在協議層替換而不是包一層假信封 |
| 對 `command.execute` 應用 30 秒傳輸時限 | 命令耗時屬於操作本身，而非傳輸健康預算；該時限會終止本應繼續執行的長時處理器，呼叫方／連線取消已提供所需的停止路徑 |
