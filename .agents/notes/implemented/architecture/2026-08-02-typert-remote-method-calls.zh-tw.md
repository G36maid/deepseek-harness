# Agent Note: Typert Gateway 定向方法呼叫

Status: implemented

[English](2026-08-02-typert-remote-method-calls.md) | [简体中文](2026-08-02-typert-remote-method-calls.zh.md) | 繁體中文

## Problem

Host API Proxy 同時承擔直接方法呼叫、帶狀態互動和 Session 事件串流。三者的生命週期、路由語義和用戶端程式設計介面不同，繼續共用一個業務匯出包會讓業務 Service、傳輸協議、狀態機和用戶端類型彼此耦合。

本決策只涵蓋一次請求對應一次結果的定向方法呼叫。Permission、Approval 等帶狀態互動以及 Session 事件串流仍採用獨立設計。

直接方法呼叫的約定屬於實作該行為的業務 Service。業務開發者只需聲明哪些方法可以遠端呼叫，無需再同步維護中央 API 介面、路由表、參數轉換表、用戶端 stub 和 Zod schema。

Host 與 Browser Client 使用獨立的 TypeScript Program，因為兩邊會以不同類型合併同名 Cordis `Context`。Remote 投影不能把完整 Host 聲明匯入消費端，也不能相依性 Browser 專屬類型；未來 TUI 若複用這套程式設計介面，也只能看到 Remote 標記的方法。本期不實作 TUI 接入，但實作邊界不得阻斷這種同構複用。

## 決策

業務 Service 繼承 `TypertRemoteService`，並透過 `@Remote` 或 `@RemoteScope()` 聲明可呼叫方法；已有其他基類的 Service 可以改用 `bindTypertRemote()` 暴露同一綁定。Typert 從 Host Program 生成 Host 本機反射產物和平臺無關的 Remote 消費端投影；Client Program 繼續獨立生成自己的本機反射產物。

Remote 消費端投影同時包含 `.d.ts`、`.d.ts.map` 和 `.js`。`.d.ts` 只暴露被 Remote decorator 標記的方法，並引用業務包唯一的公共類型符號；`.d.ts.map` 把消費端 API 方法導覽回 Host 業務方法實作；`.js` 攜帶同一約定的 endpoint、參數、Context 和 Zod 資訊。Browser Client 在 assembly 層把需要的 Remote JS 貢獻集中掛到 Client Remote Service；該投影和 Remote 抽象保持平臺無關，以便未來 TUI 複用。

`@deepseek-ai/dsh-api-gateway` 位於 `packages/api/gateway`，提供對稱的兩個 face：默認入口提供 Host `ctx.typertGateway`，`/client` 入口提供消費端 `ctx.remote`。兩邊各自在本機消費由同一模型生成的 `InvocationDescriptor`，descriptor 不透過 wire 傳送。Remote 資料協議執行在 Connection 共享的 `/api` RPC channel 上；業務呼叫介面不隨 Connection 從 HTTP 遷移到 WebSocket 而改變。

`@deepseek-ai/dsh-api-remotes` 位於 `packages/api/remotes`，是 Gateway 上層的 BFF 層。其 Host 入口負責 Agent/Session 身份解析與 Typert lookup 設定；`/client` 入口選擇應用對外暴露的生成 Remote contribution。Client 入口透過 Cordis 消費共享的 `TypertClientRemote` 約定，而不匯入具體 Gateway 實作。

## 元件和 Cordis 服務

| 元件 | Cordis 服務 | 職責 |
|---|---|---|
| `@deepseek-ai/dsh-typert-protocol` | 只聲明 `ctx.typert` 的最小協議 | `TypertRemoteService`、decorator、binding 回退、descriptor、lookup/Context 和 Remote map；不相依性 compiler、Zod、Connection 或 Browser |
| Typert registry | `ctx.typert` | 分開保存當前環境 reflection、匯入的 Remote contribution、lookup provider 和 Context provider |
| Typert generator/loader | 無新增業務服務 | 從 Host/Client Program 生成三類 `lib` 產物，並把當前環境產物註冊到 `ctx.typert` |
| API Gateway 的 Host face | `ctx.typertGateway` | 關聯 Host definition 與活 Service，解碼參數、解析 receiver、呼叫方法和編碼結果 |
| Connection | `ctx.connection` | 獨佔 HTTP Server/未來 WebSocket、共享 `/api` route、RPC envelope、rpcId、序列化、trust、錯誤傳輸、Typert 攔截和舊 API Proxy 回退 |
| API Gateway 的 Client face | `ctx.remote`、`ctx.remote.<namespace>` | mount Remote contribution，把每個 namespace 實體化為可追蹤的 `remote.<namespace>` 子 Service，並把規範呼叫交給 `ctx.connection.rpc` |
| API Remotes | 無新增服務 | 負責 Host Agent/Session lookup 策略，並作為 Client 業務的唯一 facade，選擇並掛載 `/remote` contribution，同時暴露所選 API 聲明 |
| Agent/Session owning 包 | 既有領域服務 | 同時提供靜態 interface merge 與執行時期 lookup/Context provider |
| Goal 等業務包 | 既有業務 Service | 只聲明 binding、Remote 方法和唯一 DTO，並匯出生成的 `/remote` 子路徑 |

Host Gateway 不相依性 `ctx.agents`、`ctx.sessions`、`ctx.goals` 或 `ctx.webServer` 的具體實作。Client Remote 不理解物理 carrier，Connection 也不理解 Goal、Agent、lookup、`InvocationDescriptor` 或 Remote namespace。

## 業務聲明

普通直接呼叫使用 `@Remote`。現有方法的參數和結果已經是預期的 Remote 約定時，直接裝飾該方法，不為此重新命名。只有 wire 約定需要不同的請求或結果形態時，才新增 `remoteExport*` 配接器，並由 decorator 參數聲明短 API 名。方法需要哪個業務對象，就在頂層參數位置顯式聲明該對象：

```text
export class GoalService extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'goals')
  }

  create(agent: Agent, request: CreateGoalRequest): GoalView {
    // Existing business method remains unchanged.
  }

  @Remote('create')
  remoteExportCreate(agent: Agent, request: CreateGoalRequest): CreateGoalResult {
    const view = this.create(agent, request)
    return { ref: { id: view.id, revision: view.revision } }
  }
}
```

`goals` 是傳給 `super()` 的明確 Cordis service key，並默認作為 wire namespace。只有協議 namespace 確實需要與 service key 不同時，才透過第三個參數傳入 `namespace` 選項。

需要在某類隔離 Context 中尋找 Service receiver 時使用 `@RemoteScope()`。Scope identity 不進入業務方法參數：

```text
export class ScopedGoalService extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'goals')
  }

  @RemoteScope('agent', 'create')
  remoteExportCreate(request: CreateGoalRequest): Promise<CreateGoalResult> {
    // Runs against the goals service resolved from the Agent Context.
  }
}
```

同一個 endpoint 只能選擇一種呼叫模式。需要顯式 `Agent` 參數的流程使用 `@Remote`；需要切換到 Agent Context 再解析 scoped receiver 的流程使用 `@RemoteScope('agent')`，兩者不會由 Typert 根據方法體或參數缺失自動猜測。

業務包只相依性輕量的 `@deepseek-ai/dsh-typert-protocol`。它提供 `TypertRemoteService`，以及 decorator、binding 回退、lookup、Remote Scope 和 descriptor 的聲明協議，不相依性 TypeScript compiler、Zod、HTTP 或 Client runtime。

支持協作式取消的方法會把 `signal: AbortSignal` 聲明為最後一個 Host 參數。這個保留參數不是業務值、lookup 或 JSON 欄位。生成的消費端方法將其暴露為最後一個選填參數，因此普通呼叫保持不變，而擁有取消控制權的呼叫方可以傳入 signal。

## Decorator 與顯式 Gateway facet

Decorator 只表達“該方法參與 Remote 約定”，不負責執行時期類型反射，也不向 Service constructor 注入隱藏 symbol。`@Remote('create')` 和 `@RemoteScope('agent', 'create')` 的參數是外部方法名；被裝飾成員既可以是業務方法本身，也可以是 `remoteExportCreate` 這樣的配接器。未給別名時才使用成員名作為外部方法名。繼承 `TypertRemoteService` 是 Service 加入 Gateway 的常規顯式聲明；其 public readonly `typertGateway` 欄位使執行時期實例上的綁定保持可見。

SRC 執行時期允許 decorator 在 `dsh-typert-protocol` 內部的 `WeakMap` 記錄 prototype、方法名和呼叫模式。它不向 Service 實例、prototype、constructor 或方法函式寫入自訂屬性。

LIB 的嚴格方法發現、類型解析和 descriptor 生成由 Typert compiler 完成。它接受 `TypertRemoteService` 直接 `super()` 呼叫中的字面量 service key，或顯式 binding 回退；生成過程不改寫業務原始碼，也不注入隱藏註冊元資料。

## Lookup 與 Remote Scope 註冊

Gateway 不內建 Agent、Session 或其他業務對象分支。對象所屬包同時提供靜態聲明和執行時期 provider：

```text
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertLookupMap {
    agent: TypertLookup<Agent, SessionId>
  }
}

ctx.typert.lookups.register('agent', {
  parameter: 'agent',
  wire: 'agentId',
  resolve: sessionId => resolveAgent(sessionId),
})
```

靜態聲明讓 Typert 知道 `Agent` 在 wire 上對應 `SessionId`；執行時期 provider 負責把請求中的 `agentId` 解析為當前活的 `Agent` 對象。缺少任一側時，LIB 建置或最早可解析的執行時期註冊直接失敗。

Agent、Session 等 lookup 對象只能各自佔據一個頂層參數位置。普通 JSON request 可以作為另一個完整參數傳入，但本設計不支持 `request.agent`、對象解構、對象陣列、巢狀 lookup 或從任意複雜結構中搜尋 ID。

Remote Scope 使用獨立的 merge-extensible map 和 Context provider。Agent 包註冊 `agent` provider，負責用 wire identity 找到 Agent Context，並從該 Context 解析 descriptor 指定的 service key；Gateway 不知道 Agent Context 的內部結構。

Client 側也註冊 `agent` Context binder。binder 只負責從一次呼叫所在的 Context 取得 `SessionId`；它不枚舉 Scope，也不逐個複製方法。scoped namespace 由 Cordis Service tracker 自動 rebind 到當前 Agent Context。

## InvocationDescriptor

Typert、SRC 弱解析器、Host Gateway 和 Client Remote 之間只交換一種規範描述：

```text
InvocationDescriptor {
  id: '@deepseek-ai/dsh-goal#goals/create'
  service: 'goals'
  namespace: 'goals'
  method: 'create'
  implementation: 'remoteExportCreate'
  invocation: direct | { context: 'agent', wire: 'agentId' }
  scope?: { context: 'agent', wire: 'agentId' }
  parameters: [
    { name, wire, source: json | lookup, lookup?, codec }
  ]
  cancellation?: { parameter: 'signal' }
  result: codec
  sourceLocation
}
```

`method` 是 endpoint 和 Client Remote 使用的外部短名，`implementation` 是 Host receiver 上的真實成員名；兩者相同時可省略 `implementation`。`direct` descriptor 保留原始 Service 實例作為 receiver。Context descriptor 先透過對應 Context provider 找到 scoped Context，再以 descriptor 的 service key 解析 receiver。

嚴格生成器只在 direct 方法恰好包含一個 lookup 參數、同名 `TypertContextMap` 聲明存在且兩者使用同一 wire 類型 symbol 時寫入 `scope`。`scope.wire` 必須指向該 lookup 參數；它聲明消費端可以從呼叫所在 Context 補入這個參數，不改變 Host receiver 或 endpoint。多個 lookup、缺少 Context 聲明或 wire 類型不一致時不生成 scoped 投影，其中類型不一致屬於建置錯誤。

參數順序來自方法簽名，HTTP 欄位來自參數名或 lookup 聲明。取消 descriptor 只保留最後一個 `signal` 位置，並使其不進入具名 `args`；實際 signal 由 Connection 或直接呼叫 Gateway 的呼叫方提供。Gateway 不根據請求內容推斷選填欄位、Context 類型、lookup 類型或缺失參數，也不會合成業務預設值。

LIB codec 帶有 Zod schema 和「package + 公共 subpath + export name」的規範 `typeSymbol`；SRC codec 只標記 `src-json`。Host 和消費端執行在不同 JavaScript realm 時會各自持有 Zod 實例，但這些實例由同一 Typert 模型和 symbol key 生成。

descriptor 只存在於兩端本機 registry。wire 上只有 `/api` channel、endpoint 和 `{ args }` payload；Host 用自己的 descriptor 解碼和呼叫，Client 用自己的對應 descriptor 編碼參數和驗證結果。

## Typert 執行時期 registry

```text
ctx.typert.local     当前进程自己的 Host 或 Client reflection
ctx.typert.remotes   消费端显式 mount 的对端 Remote contribution
ctx.typert.lookups   wire ID 到 Host 对象的 provider 与组合策略
ctx.typert.contexts  Host Context resolver 与 Client Context binder
```

每次註冊都返回由呼叫方 Cordis fiber 持有的 disposer。掛載 Client contribution 時，descriptor 集與具體方法會作為一項有明確所有者的操作統一註冊。Host Gateway 只快取 SRC 所認領的 endpoint 名稱集合，並在 Cordis Service 集合發生變化時整體丟棄該集合；它不保留 descriptor、Service 或提供方。呼叫時會從當前狀態解析所有活對象，因此移除 strict definition、Service 或提供方會使相應呼叫不可用，且不會留下過時的活對象。

lookup 登錄檔會在活 resolver 解除安裝後保留穩定的 wire 聲明。SRC 解析仍會把該參數歸類為 lookup，而呼叫會以 `lookup-unavailable` 失敗；系統絕不會把傳入的 ID 重新歸類為普通 JSON 業務對象。在同一個 Typert Service 的生命週期內，以不同參數、wire 或規範類型 symbol 重新註冊同一 key 會直接失敗。

業務對象包和 scoped Context 包透過 `lookups.register()` 與 `contexts.registerHost()` 擁有穩定聲明和默認 resolver；Host 組合透過 `lookups.configure()` 與 `contexts.configureHost()` 提供 effect-scoped 非同步策略。設定可以先於 provider 註冊，但沒有活 provider 時不會單獨形成可用身份；設定解除安裝後復原 provider 默認 resolver。API Remotes 為 `agent`、`session` lookup 和 `agent` Host Context 建立共享的 `agentFor()` resolver：live Agent 直接複用，普通冷工作階段自動復原，並行復原按 Session ID 去重，subagent ownership fence 則返回既有 `agent-busy`。標準 Web API Proxy 提供 Agent 預設值和 scope 設定，並讓舊方法使用該 resolver。`session` lookup 返回解析所得 Agent 的 Session，`agent` Host Context 返回其 Context，因此三種投影共用一個復原生命週期。

Registry 的 Host 根入口擁有完整 `TypertRegistryContract` interface merge；Host 與 Client 共用的 registry 實作位於無環境聲明的獨立模組。Registry `/client` 入口只引用該共享實作，不經過 Host 根入口，因此不會把 Host Cordis 聲明帶入 Client Program。

## 唯一類型、符號與 Zod

Remote Client DTS 不複製業務 DTO，也不重新聲明一個結構相同的影子類型。它只從不攜帶 Host Cordis merge 的公共純類型 subpath 引用原始符號：

```text
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CreateGoalRequest, CreateGoalResult } from '@deepseek-ai/dsh-goal/types'
```

因此 `SessionId`、Agent wire ID、request 和 result 在 Host 與 Browser Client 中都指向同一 TypeScript declaration，未來 TUI 複用時也不需要第二份類型。DTO 的跳轉定義、重新命名和引用尋找回到業務類型的唯一原始碼位置，而不是停在生成文件中的副本。

Remote 方法本身使用 declaration map 導覽。Typert 把 `InvocationModel.location` 固定在 Host 被裝飾方法的方法名 token，並在 namespace interface 的對應屬性上寫入 source-map segment。對於由配接器支撐的 endpoint，TypeScript editor 從 `ctx.remote.models.list` 取得生成 declaration 後，再沿 `typert.remote-client.d.ts.map` 跳到 Host Service 的 `remoteExportList` 遠端出口。該出口繼續顯式呼叫不改名的存量 `list()`，map 不把 decorator、class 或整個簽名誤當成方法定義位置。

Typert 為同一 symbol key 生成 wire Zod codec。Host Gateway 用它校驗輸入和編碼結果，Client Remote 用它編碼參數並校驗回應；複雜類型無法生成嚴格 codec 時，LIB 建置失敗，不降級為 `unknown` 或無校驗 JSON。

Remote 方法引用的命名業務類型必須從純類型公共 subpath 匯出。如果唯一可達入口會帶入 Host Service、Cordis `Context` merge 或 Host-only 實作，建置失敗並要求業務包提供安全的類型出口。原始值、字面量和 Typert 明確支持的簡單組合不需要額外命名。

lookup 參數不會把 `Agent` class 暴露給消費端。Remote 投影引用 lookup 聲明中的唯一 ID 類型，例如 `SessionId`；Host 內部仍以唯一的 `Agent` class symbol 完成對象解析。

## 三種產物與兩個 TypeScript Program

Host 與 Client 仍然只有兩個獨立 TypeScript Program，但 Typert 生成三種性質不同的產物：

```text
Host Program
├─ typert.host.js / typert.host.d.ts
│  Host 自身的 Service、Event、Object、schema 和 inbound Gateway 信息
└─ typert.remote-client.js / typert.remote-client.d.ts / typert.remote-client.d.ts.map
   Host Remote 对任意消费环境的 wire 投影

Client Program
└─ typert.client.js / typert.client.d.ts
   Client 自身的 Service、Event、Object 和 schema 信息
```

`remote-client` 是 Host Program 的第二個 emitter，不是第三個 Program，也不是 Client 本機 face。它不包含 Host Cordis merge、Service class、Context class 或實作程式碼，不進入 Host 本機 reflection registry。

Host lib 建置負責完成嚴格 Host 分析並產出 Host 本機 artifact 與 Remote 消費端 artifact；Client lib 隨後消費 Remote DTS。完整順序為：

```text
Host lib build
→ 生成 typert.host.{js,d.ts}
→ 生成各业务包 lib/typert.remote-client.{js,d.ts,d.ts.map}
→ 完成 Client lib 和 typert.client 产物
→ Vite 构建 Web
```

現有頂層 `build` 仍表現為先 `build:lib`、再 `build:web`，但 `build:lib` 內部必須先完成 Host 與 Remote artifact，再啟動 Client TypeScript 編譯。一次乾淨建置不能相依性上次殘留的 `.d.ts`。

即使主要輸入是原始檔，需要透過編譯器解析消費端 surface 的倉庫閘門也有相同的前置條件。公共 `typecheck`、`lint` 和 `doc-typecheck` 命令會先執行 Host 約定 pass。閘門調度器僅可在顯式的 Typert 約定相依性或完整建置相依性完成後使用對應的 `*:contracts-ready` 變體，使平行 lane 既不會讀取缺失的聲明，也不會針對同一輸出並行執行多個生成器。

## `/remote` 包入口

每個提供 Remote 方法的業務包匯出生成的 `/remote` 子路徑：

```text
"./remote": {
  "types": "./lib/typert.remote-client.d.ts",
  "default": "./lib/typert.remote-client.js"
}
```

消費程式碼透過業務包本身選擇能力：

```text
import goalsRemote from '@deepseek-ai/dsh-goal/remote'
```

該 import 讓 `.d.ts` 的 map augmentation 進入當前 TypeScript project，同時把同一約定的 JS descriptor 作為值交給執行時期。未 import 的業務包不會擴充當前 project 的 Remote API 類型。

業務 package 的發布文件必須包含 `lib/typert.remote-client.d.ts.map`。生成 DTS 以 `//# sourceMappingURL=typert.remote-client.d.ts.map` 引用相鄰 map；map 中的 source 從 `lib` 相對指向業務原始碼，例如 `../src/index.ts`。`/remote` export 不單獨列出 map，package `files` 負責發布它。該目標是開發期路徑：workspace 消費者經 package link 解析它，因此發布產物仍然不含 `src`，已發布的 map 只是解析不到東西。

僅需要靜態類型時可以使用 `import type {} from '@deepseek-ai/dsh-goal/remote'`；這種 import 在執行時期會被擦除，不會載入 JS，也不能觸發任何執行時期註冊。需要真實呼叫的環境必須把普通 value import 得到的 contribution 交給 Client Remote Service。

workspace 對 `/remote` 的解析必須明確指向 `lib` 生成物，不能被通用 package-to-`src` paths 規則帶回 Host 原始碼。普通業務 import 仍可按各環境既有規則解析到 SRC 或 LIB。

## 消費端嚴格 API 類型

Remote DTS 同時擴充平面 endpoint map、direct namespace interface、namespace map 和 scoped map，而不擴充全域性 Cordis `Context`：

```text
interface TypertRemoteNamespace$676f616c73 {
  create: (
    agentId: SessionId,
    request: CreateGoalRequest,
    signal?: AbortSignal,
  ) => Promise<CreateGoalResult>
}

interface TypertRemoteMap {
  'goals/create': (
    agentId: SessionId,
    request: CreateGoalRequest,
    signal?: AbortSignal,
  ) => Promise<CreateGoalResult>
}

interface TypertRemoteNamespaceMap {
  goals: TypertRemoteNamespace$676f616c73
}

interface TypertRemoteScopeMap {
  'agent:goals/create': (
    request: CreateGoalRequest,
    signal?: AbortSignal,
  ) => Promise<CreateGoalResult>
}
```

`TypertRemoteMap` 保留規範 endpoint 簽名，供協議類型和反射使用。根 Remote 類型直接讀取 `TypertRemoteNamespaceMap`，不透過 key-remapped mapped type 間接推導方法；TypeScript Language Service 無法把這種間接屬性穩定導覽到 declaration map。namespace interface 名由 namespace 的 UTF-8 bytes 編成 hex，`goals` 因而穩定得到 `TypertRemoteNamespace$676f616c73`。不同 package 對同一 namespace 生成同名 interface，依靠 module augmentation 合併各自方法，且 `TypertRemoteNamespaceMap.goals` 始終引用同一類型。

Typert 把 `TypertRemoteScopeMap` 按 Context key 投影到專用 Scope 類型。最終程式設計介面保持：

```text
ctx.remote.goals.create(agentId, request)
agentCtx.remote.goals.create(request)
```

Agent Scope 自動提供自己的 `SessionId`。因此帶 `agent` lookup 的 `@Remote` 方法可以同時生成 root 和 scoped 兩種消費端簽名；`@RemoteScope('agent')` 方法也省略獨立的 Scope identity，但只生成 scoped 簽名。根 `Context` 透過 `ctx.remote` 暴露 direct namespace，`AgentContext.remote` 則把該 direct surface 與 scoped surface 取交集。未來 TUI 複用時必須維持相同區分。

`TypertClientRemote` 保持平臺無關，Browser Client 透過 `ctx.remote` 暴露它。未來 TUI 若複用該類型，也必須透過專用 Remote 對象和 Agent Scope 使用它，不能把 Host `Context` 當成更寬的 Service 集合；未標記的 public Service 方法不會進入 Remote maps。

## Client Typert 與 API Gateway Client face

一個消費環境的 Typert 同時維護本機資訊和從其他環境匯入的 Remote 資訊，但兩者存放在不同 registry：

```text
Typert.local    当前环境自己的反射模型
Typert.remotes  已导入的 Remote contribution
```

`@deepseek-ai/dsh-api-remotes/client` 集中載入需要的 Remote contribution：

```text
import goalsRemote from '@deepseek-ai/dsh-goal/remote'
import sessionsRemote from '@deepseek-ai/dsh-session/remote'

await ctx.remote.$mount(goalsRemote)
await ctx.remote.$mount(sessionsRemote)
```

Client 業務包只引用 `@deepseek-ai/dsh-api-remotes/client`，不直接相依性 API Gateway 或各業務 `/remote` 執行時期入口。API Remotes 消費共享的 `TypertClientRemote` 約定和 Cordis `ctx.remote` 服務，再重新匯出聲明，使所選 Remote map 進入業務編譯；新增或移除整套 Client 能力只修改這一處 assembly。

`ctx.remote.$mount()` 把 contribution 註冊到 `Typert.remotes`，安裝它的 namespace Service 和具體方法，並在它們就緒後才 resolve。呼叫該方法的 Cordis fiber 持有 disposer。endpoint 重複、同一 namespace/method 模式衝突或 descriptor 與現有類型身份衝突時直接失敗。

Client Remote Service 把 `@Remote` descriptor 實體化為 `remote.<namespace>` 子 Service 上的真實函式。函式按 descriptor 的位置參數順序構造具名 `args`，執行 Client strict codec，然後呼叫 `ctx.connection.rpc.call('/api', endpoint, { args }, signal)`。對於支持取消的 descriptor，生成的函式接受最後一個選填 signal，並將其與 contribution 的掛載生命週期合併；因此解除安裝會取消所有正在進行的 carrier 呼叫，而呼叫方也可以單獨取消一次呼叫。

帶 `scope` 的 direct descriptor 和 `@RemoteScope` descriptor 都不為每個 Agent Scope 複製函式。Client Remote Service 為每個 namespace 建立一個註冊為 `remote.<namespace>` 的 Cordis 子 Service，並在其上實體化 direct 與 scoped 變體。透過 `agentCtx.remote.goals` 取得方法時，accessor 會在返回可呼叫控制代碼前捕獲當前 Agent Context。方法再透過對應 Context binder 從該 Context 取得 identity。direct scoped 投影用 identity 替代 `scope.wire` 指定的 lookup 位置，Remote Scope descriptor 則把 identity 寫入 receiver 的獨立 wire 欄位；兩者都發起同一種 `/api` 呼叫。

```text
root ctx.remote.goals.create(agentId, request)
  → direct descriptor
  → ctx.connection.rpc.call('/api', 'goals/create', { args })

agentCtx.remote.goals.create(request)
  → remote.goals accessor 捕获 agent Context
  → agent binder 从 caller Context 取得 agentId
  → 用 agentId 补入同一 direct descriptor 的 lookup 参数
  → ctx.connection.rpc.call('/api', 'goals/create', { args })
```

根 `Context` 只 merge direct `TypertClientRemote` surface；`AgentContext` 把該屬性替換為 `TypertClientRemote` 與 `TypertRemoteScopeApi<'agent'>` 的交叉，因而 scoped-only 方法不會暴露給 root 程式碼。若呼叫方繞過類型從 Root 動態呼叫 scoped-only 方法，binder 明確報錯。若 Client 已有名為 `remote.<namespace>` 的 Cordis service，或兩個 contribution 衝突佔用同一 namespace/method，mount 直接失敗，不覆蓋現有服務。

生成的 Remote JS 只包含 descriptor、symbol key 和 codec，不打包 Host Service 實作。Client Remote Service 據此建立真實函式，因此執行時期不相依性 JavaScript Proxy；Proxy 可以作為實作選擇，但不會成為類型或反射來源。

## 跨環境同構約束

Remote API 是消費端能力，不等同於 Browser API。已交付的執行時期實作 Browser Client contribution 掛載、Connection RPC 呼叫和 Agent Scope 關聯。

Remote DTS、Remote JS、`TypertClientRemote`、`InvocationDescriptor`、Remote RPC 資料協議和 Context binder 不得相依性 DOM、Browser module loader 或 HTTP。Browser Client 透過 Connection 把 descriptor 實體化的方法編碼為 `/api` RPC 呼叫。

未來 TUI 可以在不改變業務 decorator、Remote maps 和 API 呼叫形狀的前提下接入同一呼叫抽象。屆時 TUI 可見的 API 仍只能由 `@Remote` 和 `@RemoteScope` 生成，不能因為它與 Host 同進程就繞過 Remote 限制直接暴露 Service 方法。

TUI 的 runtime 掛載、carrier、Agent Scope 關聯和 SRC 啟動接線均仍延後，不在本決策之內。

Web 本身相依性 `lib/client.js` 等建置產物，因此啟動 Web 前要求完整 `build:lib`。Host Remote 約定變化後，開發者需重新執行 lib build，再啟動或重新啟動 Web；系統不實作 Remote contract 的增量 watch。

## SRC 與 LIB 執行模式

SRC 面向本機原始碼啟動。`@Remote` 和 `@RemoteScope()` 的 WeakMap 記錄給出方法名和呼叫模式，執行時期從 JavaScript 函式簽名讀取順序參數名，並結合已註冊 lookup/Context provider 生成弱 descriptor。

例如 `@Remote('create') remoteExportCreate(agent, request, signal)` 解析為外部方法 `create`、實作成員 `remoteExportCreate`、兩個頂層業務參數和一個取消注入點；lookup 註冊把 `agent` 改寫為 wire 欄位 `agentId`，`request` 按同名 JSON 參數傳遞，最後一個 `signal` 則留在 payload 之外。SRC 不啟動 `ts.Program`，不使用 preload、loader hook、原始碼生成或模組改寫，也不檢查普通 JSON 對象的內部結構。

SRC 無法明確解析的簽名會在首次呼叫解析其 descriptor 時失敗；Service 掛載只記錄 decorator 標記，不檢查 JavaScript 簽名。SRC 不會猜測對象解構、預設參數造成的歧義、rest 參數、巢狀 lookup 或複雜類型。

LIB 面向 CI、發布和 Web 前置建置。Typert 掃描完整 Host project，檢查 Remote decorator、顯式 binding、service key、endpoint 衝突、lookup/Context 聲明、公共符號可達性、JSON codec、結果 codec，以及保留的最後一個 `signal` 參數是否具有全域性 `AbortSignal` 類型，並生成嚴格 descriptor。

LIB 執行時期只載入 `lib` 中的 definition，不啟動 TypeScript compiler。Host Gateway 後續的 Service 關聯、lookup、Context 解析、呼叫和回應編碼不區分 descriptor 來自 SRC 弱解析還是 LIB 嚴格生成。

CI 和發布執行 LIB。全倉 coverage 全部切換到 LIB 是獨立後續工作，不阻塞本次直接方法呼叫實作。

## Host Gateway 解析

Host Gateway 向 Connection 註冊一個 `/api` interceptor，不維護第二份 endpoint 登錄檔。ownership matcher 會先檢查當前 Typert local 登錄檔，再查詢一份可失效的集合；該集合透過掃描當前 Cordis Service 中的 `typertGateway` binding 與 SRC Remote 標記生成。Cordis Service 發生變化時會整體丟棄該集合，因此 Typert definition 與業務 Service 可以按任意順序到達，同時既不會讓舊 API Proxy 的 `/api` 流量在每次請求時重新掃描所有 Service，也不會因任意請求路徑而擴大快取。

每次呼叫都會重新從當前狀態解析 descriptor、receiver、lookup 提供方與 Context 提供方。當前 strict descriptor 優先於 SRC。strict endpoint 一旦出現，即使隨後撤回對應 descriptor，`TypertLocalRegistry.hasSeen()` 仍會在登錄檔剩餘生命週期內保持對它的認領並禁止回退 SRC；重新註冊 strict descriptor 即可復原呼叫。移除 Service 或提供方會讓呼叫明確失敗；Gateway 既不保留失效對象，也不會以原始 lookup ID 呼叫方法。

普通 `@Remote` 呼叫保留原始 Service 實例作為 receiver。lookup 成功後，Gateway 按 descriptor 的參數順序呼叫 `implementation ?? method` 指定的成員；若 descriptor 聲明取消，則在這些參數之後追加 carrier signal。

`@RemoteScope('agent')` 呼叫先由 Agent Context provider 解析 wire identity，再從該 Context 讀取 descriptor 的 service key 並呼叫 scoped receiver。業務方法不會收到隱藏 Context 參數或 Agent ID。

```text
ctx.typertGateway.invoke({ namespace, method, args, signal })
→ 查找本地 InvocationDescriptor 与 live receiver
→ 按参数 descriptor 读取具名 wire 字段
→ codec 解码普通值或 lookup ID
→ lookup provider 把 ID 解析为活对象
→ direct 使用原 Service；context 先解析 scoped Context 和 Service
→ cancellation descriptor 存在时把 signal 追加到业务参数末尾
→ Reflect.apply(receiver[implementation ?? method], receiver, orderedArgs)
→ result codec 编码业务结果
```

`ctx.typertGateway.invoke()` 是 carrier-independent 的 Host 入口。它不建立 rpcId、RPC envelope 或 HTTP response；它只返回編碼結果，或產生由 Connection RPC adapter 對映的 Gateway 錯誤。

## 共享 `/api` 呼叫鏈

Connection 在 HTTP Server 上持有唯一 `/api` route。Gateway 把同步 endpoint ownership 判斷和 Remote RPC handler 掛到 Connection：

```text
ctx.connection.rpc.intercept(
  '/api',
  endpoint => ownsRemoteEndpoint(endpoint),
  (endpoint, payload, signal) => {
    const { namespace, method } = parseEndpoint(endpoint)
    const { args } = parsePayload(payload)
    return ctx.typertGateway.invoke({ namespace, method, args, signal })
  },
)
```

Host registry 中存在 strict descriptor、記錄過已撤回的 strict descriptor，或 active SRC Service binding 上存在匹配的 `@Remote` 標記時，Gateway 認領該 endpoint。endpoint 一旦被認領，即使 payload 解碼、descriptor 解析或呼叫失敗也繼續由 Gateway 返回錯誤；只有不屬於 Remote 的 endpoint 才進入舊 API Proxy 回退。

Connection Host half 把一個複合 FetchHandler 交給 HTTP bridge。bridge 建立標準 `Request` 後，該 handler 再選擇 Gateway RPC FetchHandler 或 API Proxy FetchHandler；兩條路徑複用同一 request/response envelope、rpcId、序列化、trust、transport error 和 `RpcError`。當前物理對映是：

```text
POST /api/<namespace>/<method>
```

Remote payload 使用具名 JSON 對象，不使用位置陣列，也不傳送 `InvocationDescriptor`。普通 Goal 呼叫的 payload slot 是：

```json
{
  "args": {
    "agentId": "session-1",
    "request": {
      "objective": "finish the migration"
    }
  }
}
```

完整鏈路為：

```text
ctx.remote.goals.create(sessionId, request, signal?)
→ Client InvocationDescriptor 编码 { args: { agentId, request } }
→ Client 合并 caller signal 与 contribution mount lifetime
→ ctx.connection.rpc.call('/api', 'goals/create', { args }, signal)
→ Connection 创建 rpcId 和既有 client-request envelope
→ 当前 carrier 发送 POST /api/goals/create
→ Connection Host half 执行共享 trust，再由 bridge 创建标准 Request
→ 复合 FetchHandler 判断 endpoint ownership 并选择目标 FetchHandler
→ Typert interceptor 调用 ctx.typertGateway.invoke(..., request.signal)
→ Host InvocationDescriptor 解码、lookup、receiver 解析并把 signal 注入 Reflect.apply
→ result codec 编码
→ Connection 写入既有 RPC result 并回送相同 rpcId
→ Client result codec 验证并返回 CreateGoalResult
```

Remote 不定義第二層 `{ ok, value/error }` response。成功值和 Gateway 錯誤直接使用既有 RPC response 的 `result`。adapter 把普通 Gateway 與業務呼叫失敗轉換為既有 `RpcError` envelope，並統一使用 `code: 'internal'`；resolver 透過 `TypertLookupFailure` 攜帶的既有 RPC error 則原樣返回，使冷復原失敗和 ownership fence 保持穩定錯誤碼。Gateway 的結構化錯誤分類僅在行程內保留，診斷資訊則透過 message 跨 Connection 傳遞。

Gateway 不處理逐方法權限、呼叫者身份、冪等或長連線狀態。它只把 Connection 的協作式取消傳播給顯式支持取消的業務方法。Typert endpoint 使用 Connection 的 trusted-host 策略；未認領 endpoint 保留舊 API Proxy 的 trust 和 privileged-method 策略。Connection/WebSocket 遷移後續獨立完成。

## Connection 與協議邊界

Client Remote Service 負責 Remote contribution、namespace Service 實體化、Scope 綁定以及位置參數與 descriptor 的對應。Gateway 負責 Host descriptor、endpoint ownership、lookup、Context 和業務呼叫。Connection 把 `/api`、endpoint 和 `{ args }` 作為一個 RPC 呼叫傳送到目標並返回既有 RPC result；它不理解 Goal、Agent、lookup、descriptor 或 Client Remote 類型。

Gateway 只向 Connection 註冊 ownership matcher 和 RPC handler，不註冊 HTTP route。Connection 把共享 `/api` route 掛到 HTTP Server，並把一個複合 FetchHandler 交給 bridge；該 handler 將已認領 endpoint 分發給 Gateway，未認領 endpoint 則交給 API Proxy。未來 Connection transport 可以保留相同順序，而不改變 Remote payload、業務 decorator、生成的 DTS、Remote API 類型或 Agent Scope 程式設計介面。

## 包邊界

- `@deepseek-ai/dsh-typert-protocol`：輕量 decorator、binding、lookup、Remote Scope 和 descriptor 協議。
- Typert generator：分析 Host/Client Program，生成本機 face 和 Remote 消費端投影，並生成規範 symbol/Zod 資訊。
- Typert runtime：分別保存當前環境的 local reflection 與匯入的 Remote contribution。
- `@deepseek-ai/dsh-api-gateway`：默認入口關聯 Host definition 與 Service，認領 Remote endpoint，執行 lookup、Context receiver 解析、呼叫和結果編碼，並向 Connection 註冊 `/api` interceptor；`/client` 入口掛載 Remote contribution，建立嚴格 Remote namespace Service 和方法，並把呼叫交給 `ctx.connection.rpc`。兩個入口共享 Remote 協議，但不互相匯入各自的 Cordis interface merge。
- `@deepseek-ai/dsh-api-remotes`：BFF 層；負責 Host Agent/Session resolver，選擇 Client `/remote` contribution，並透過共享的 `TypertClientRemote` 約定向業務包暴露合併後的 Remote 類型。
- Connection：擁有唯一 HTTP Server/未來 WebSocket carrier、共享 `/api` route 與複合 FetchHandler、API Proxy 回退、RPC envelope、rpcId、序列化、trust 和錯誤傳輸。
- Agent/Session 等業務對象包：擁有 lookup、Context provider、唯一 ID 類型和純類型公共出口。
- API Proxy Host 組合：向 API Remotes 提供 Web Agent 預設值和 scope 設定，並讓舊方法使用同一個 `agentFor()`。
- 業務 Service 包：聲明 binding、Remote 方法及其 request/result 類型，並匯出生成的 `/remote` 子路徑。

## 已交付範圍與後續工作

已交付的縱向鏈路是 `@deepseek-ai/dsh-goal/remote → Browser Client Remote → Connection RPC /api → Host Gateway → GoalService.remoteExportCreate()`。同一個帶 Agent lookup 的 direct descriptor 同時支持 `ctx.remote.goals.create(agentId, request)` 與 `agentCtx.remote.goals.create(request)`。普通冷工作階段在 lookup 時透過 `agentFor()` 復原，subagent-owned identity 保持既有 `agent-busy` fence；`@RemoteScope('agent')` 仍是獨立的 scoped receiver 模式。

Connection 提供共享 channel interceptor 與當前 HTTP carrier 對映。WebSocket 遷移、TUI runtime 與 carrier、TUI Agent Scope 接線、Permission/Approval 狀態機、Session 事件串流、呼叫授權、重試、冪等及跨版本協議相容均不屬於本決策。

包拓撲為 `api/remotes → api/gateway → client/connection → host/webserver`。Connection 與 WebServer 在本次變更中保留既有路徑；後續將它們移到 `api/connection` 和 `api/webserver` 只會改變包位置，不會改變這些服務邊界。舊 API Proxy 同樣保留在 `host/apiproxy` 下，作為尚未遷移到 Remote 的方法的回退路徑。

## Alternatives considered

**繼續使用中央 API Proxy 包。** 該方案要求業務方法、Host 路由和 Client 介面在多個位置重複聲明，也會繼續把直接呼叫、帶狀態互動和事件串流綁在同一生命週期中，因此不採用。

**讓 decorator 在執行時期完成嚴格反射。** JavaScript decorator 無法復原擦除後的 TypeScript 類型、公共符號身份和完整 Zod codec；向 constructor 注入 compiler 私有 symbol 又會隱藏業務類的真實相依性，因此嚴格資訊由 Typert compiler 生成。

**SRC 啟動時使用 preload、loader hook 或完整 `ts.Program`。** 這能複用 LIB 分析，但增加所有原始碼啟動入口的要求。SRC 只需要可用的弱 descriptor，因此採用 decorator 標記、函式參數名和顯式 provider；嚴格檢查留給 LIB 約定 pass。

**手寫 Client interface。** 手寫介面不能保證只包含 Remote 標記的方法，也會與 Host 簽名、lookup ID 和 Zod schema 漂移，因此 Client 類型從 Host Program 自動投影。

**使用 TypeScript language-service/compiler plugin 讓 Client 直接理解 decorator。** 這會讓編輯器、Vite、tsc、tsx 和發布消費者都相依性額外外掛程式，接入面過大，因此生成普通 `.d.ts` 和標準 declaration map。

**把完整 Host DTS 匯入 Client 或 TUI。** 該方案會帶入 Host Service 和 Cordis interface merge，並向消費端暴露未標記方法。Remote DTS 只引用純類型公共符號並擴充專用 Remote maps。

**只生成 Remote DTS，不生成 JS。** 類型可以成立，但執行時期無法枚舉 endpoint、codec 和 Context 模式，只能相依性 Proxy 或另一份手寫登錄檔，因此同一次 Host 投影同時生成 Remote JS contribution。

**讓 `/remote` 的頂層 import 偷偷註冊全域性狀態。** ESM 求值時未必已有目標 Cordis Context，多個 Context、HMR 和 dispose 也無法明確歸屬，因此普通 value import 只返回 contribution，由環境 assembly 的 Client Remote Service 顯式掛載。

**為 Remote 新建獨立 transport、HTTP route 或 `/api2` channel。** 這會複製或拆分 Connection 的 Server ownership、rpcId、序列化、trust、錯誤和未來 WebSocket 生命週期。共享 `/api` interceptor 保留唯一物理 route，並讓 Connection 繼續以 API Proxy 作為回退 FetchHandler。

## 驗證

- Goal Service 直接裝飾業務簽名已經符合 Remote 約定的變更類方法，僅保留 `remoteExportCreate(...)` 把 `GoalView` 適配為 `CreateGoalResult`，無需第二條路由、第二份 codec 或 Client 方法清單。
- 一次乾淨的 `build:lib` 會在 Client 編譯前生成 Host 與消費端 Remote 產物，包括業務包 `/remote` 下的 JS、DTS 和 declaration map。
- `clean` 後，單獨執行 `typecheck`、`lint` 或 `doc-typecheck` 都會重新生成 Remote 約定；pre-push 掛鉤使用同一個已包含約定準備步驟的 typecheck，CI 中的原始碼消費端則等待一次共享的約定 pass。
- 匯入 `@deepseek-ai/dsh-goal/remote` 會加入嚴格的 `ctx.remote.goals.create(...)` 類型，並可透過 declaration 導覽到 `remoteExportCreate`；不匯入時不會出現該 namespace。
- 掛載同一次 import 得到的 JS contribution 會提供 endpoint、參數、結果、lookup、Context 和 Zod 反射，並在無需手寫 stub 的情況下實體化呼叫。
- Root 與 Agent-scoped 呼叫會經過真實的共享 `/api` carrier，將 `agentId` 解析為活 Agent，呼叫原始 Goal receiver，並透過既有 RPC envelope 返回。
- Agent 與 Session lookup 會共享同一次並行冷復原；普通冷工作階段得到復原後的對象，冷態或 live subagent identity 均在業務呼叫前返回 `agent-busy`。
- Remote 產物與 map 僅包含已標記的方法，不相依性 Browser，從而為未來 TUI 保留相同的消費端邊界。
- 生命週期測試會撤回並重新掛載 descriptor、Service、lookup、Context 提供方和 Client namespace；相依性不可用時，呼叫會失敗，且不會使用過時呼叫或回退原始 ID。
- 取消測試覆蓋嚴格生成、SRC 末位參數名識別、Client signal 合併、Connection 到 Gateway 的傳播，以及 Host 在 wire `args` 之外的注入。
- 未認領 endpoint 繼續使用既有 API Proxy 路徑，其 trust、privileged-method、Permission/Approval 與 Session 事件串流行為保持不變。

## 後果

Remote API 類型相依性生成的 `lib` 聲明，建置與閘門編排必須在對 Host 和 Client 消費端進行編譯或語義分析之前完成 Host 約定 pass；順序錯誤會使乾淨環境中的命令相依性過時產物。

原始碼導覽相依性 Remote package 同時發布 declaration map 和 map 指向的 `src`。package `files` 漏掉任一側時類型仍可編譯，但消費端跳轉會停在生成 DTS，因此 workspace manifest 校驗必須把兩者作為同一發布約定。

SRC 弱 descriptor 不驗證普通 JSON 內部結構。Host Remote 簽名變化後，Web 和嚴格類型消費端必須重新執行 lib build，因為系統沒有增量 contract watcher。

公共類型唯一性要求業務 DTO 具有純類型出口，可能暴露現有包中 Host 類型與實作入口混雜的問題。建置會拒絕這些邊界，而不是複製類型掩蓋問題。

類型 import 與執行時期 contribution 是兩種不同效果。`import type {}` 只擴充靜態 Remote surface；真實呼叫環境遺漏 value contribution 時，Client Remote Service 必須以明確的「Remote 未掛載」錯誤失敗。

Browser 與 Host 各自持有 Zod 實例，不能相依性對象 identity 跨 realm 比較；一致性只由規範 symbol key、同一生成模型和 wire 行為保證。

消費端可以匯入 Host 當前未掛載的 Remote contract。類型表示「該協議能力已被消費端選擇」，不保證目標行程當前存在對應 Service；執行時期 endpoint 不可用必須明確失敗。

Connection 的通用 channel API 必須同時適合當前 HTTP carrier 和後續 WebSocket carrier。若 Client Remote 或 Gateway 暴露 `fetch`、HTTP request 或 route handle，WebSocket 遷移會再次穿透 Remote 層，因此這些物理對象必須留在 Connection 內部。

Remote endpoint 使用 Connection 的 `trusted-host` authority。系統默認接受 loopback；LAN 呼叫方必須透過顯式 trusted-host 設定接入，但本層不增加逐方法呼叫方授權，因此每個 trusted host 都能呼叫已掛載的 Remote endpoint。

`hasSeen()` 優先保障 strict definition 的安全性，而非 SRC 可用性。strict descriptor 撤回時（例如 HMR 期間），Gateway 會繼續認領 endpoint 並報告不可用，而不會回退到弱 SRC descriptor。重新註冊即可復原；只有重新啟動 Typert 登錄檔才會忘記歷史 strict definition。

支持取消的 Remote 簽名會接收 Connection 請求的 `AbortSignal`，因此 HTTP 斷連或 Client 側 abort 能在不進入 JSON 協議的情況下傳遞到正在進行的業務工作。取消仍是協作式的：沒有保留末位參數的方法會繼續執行；收到 signal 的方法必須將它傳給自身支持取消的操作，或自行觀測它。

lookup 設定當前以 key 為粒度，因此每個 `agent` 或 `session` 參數都採用同一套冷復原策略。需要 live-only 語義的特定 Remote 必須等待顯式的逐參數或逐 endpoint 策略，不能靠業務實作猜測對象是否剛被復原。
