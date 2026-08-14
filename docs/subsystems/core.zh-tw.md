# 核心

[English](core.md) | [简体中文](core.zh.md) | 繁體中文

**核心**子系統即 [`packages/core`](../../packages/core/README.md)，包含每個組合都會啟動的包：事件溯源的工作階段日誌、系統提示詞組裝、工具登錄檔、agent（代理）類型，以及驅動它們的具體迴圈。本頁說明 `agent`/`agent-loop` 這對包所聲明的內容：agent 如何被建立與擁有，以及 `Agent` 控制代碼的投遞、取消與攔截約定；本頁還說明每個子系統都遵循的兩個類型模式。該組的專屬頁面與目錄其餘部分見[子系統 README](README.md)。

## 主幹逐包速覽

一個輪次按同一條迴圈流經六個包：[`agent-loop`](../../packages/core/agent-loop) 中的 driver 認領一條排隊的提示詞，在[工作階段日誌](session.md)（`ctx.sessions`）上開啟輪次，透過 [system-prompt](system-prompt.md)（`ctx.systemPrompt`）組裝請求前綴並從日誌派生歷史，經 [LLM（大型語言模型） seam](llm-streaming.md) 流式取得模型回應，經[工具登錄檔](tools.md)（`ctx.tools`）分發工具呼叫，並把每個模型可見的事實追加回日誌，供下一步派生。迴圈搬運的對話詞彙——`Message`、`ContentBlock`、`StreamChunk`、模型請求——由 [`packages/llm`](../../packages/llm/README.md) 聲明，記錄在 [llm-streaming.md](llm-streaming.md)。

| 包 | 負責內容 | 頁面 |
|---|---|---|
| `session/` | 僅附加的 `SessionEvent` 日誌與記憶體 store——唯一真源（`ctx.sessions`） | [session.md](session.md) |
| `system-prompt/` | 提示詞段落與工具 schema 組裝（`ctx.systemPrompt`） | [system-prompt.md](system-prompt.md) |
| `tools/` | 帶作用域的工具登錄檔與受保護的執行管線（`ctx.tools`） | [tools.md](tools.md) |
| `agent/` | `Agent` 介面、即時登錄檔、發起者作用域與 `agent/*` 事件詞彙（`ctx.agents`） | 本頁 |
| `agent-loop/` | 實作公開 `Agent` 約定的具體 driver（`ctx.agentLoop`） | 本頁 |
| `scope/` | 登錄檔與迴圈用於建置按 agent 作用域的註冊原語 | [scope.md](scope.md) |

`scope/` 是這裡唯一的非服務包：一個零相依性程式庫（`createScope`/`scopeOf`/`scopeTarget`），在模組圖中位於 `session/` 與 `system-prompt/` 之下，正是為了讓它們消費它而不形成環。`agent-loop` 是公開 `Agent` 約定的唯一具體實作，放在這裡因為它是 harness 的預設產品迴圈；它在 `ctx.agents.withInitiator()` 內執行每個 driver。擴充外掛程式相依性 `agent`——包括需要發起 Agent 時——而絕不直接相依性 `agent-loop`，因此迴圈保持可替換。把這條主幹接成可執行 agent 的預設組合是 [`examples/agent-spine-demo`](../../packages/examples/agent-spine-demo/README.md)。

<a id="creation-and-ownership"></a>

## 建立與所有權

消費端透過 `ctx.agents` 建立 agent——`create()` 在一個呼叫方提供的 `SessionId` 下建置全新工作階段與 agent，`resume()` 先載入持久工作階段——或者透過迴圈的聲明式設定條目建立。程式設計式建立返回歸屬所有者的控制代碼：

原始碼：[`packages/core/agent/src/index.ts`](../../packages/core/agent/src/index.ts)

```ts type-equiv
/**
 * An owned agent plus its disposer, returned by {@link AgentRegistry.create} /
 * {@link AgentRegistry.resume}. The disposer is a CAPABILITY: among consumers,
 * only the holder can tear this agent down. The registered factory provider is
 * also a structural owner because the scoped agent depends on that provider's
 * service API; provider unload stops and drains every live handle it made.
 * `dispose()` stops the loop, awaits its exit, unregisters the agent, removes
 * its session from the store, and finally unwinds its scoped world.
 *
 * `ctx.agents.get(id)` still returns a bare {@link Agent} — the handle is
 * exposed only to the consumer owner that created it; the structural provider
 * reaches the same teardown internally. Config-created agents (the loop's own
 * startup) are owned by the loop fiber and never need a handle.
 */
interface AgentHandle {
  agent: Agent
  dispose(): Promise<void>
}
```

`CreateAgentOptions` 攜帶共享標識以及新 agent 發布前所需的一切：工作階段中繼資料（`meta`——已校驗的 `cwd`、fork 譜系、seed 邊界、來源分類、委派深度）、fork 用的選填 `seed` 重播前綴、按 agent 的 `AgentOptions`、僅建立期有效的取消 `signal`，以及 `setup`。`ResumeAgentOptions` 是持久標識的對應項：`resumeSessionId`、`agentOptions`、`signal` 與 `setup`。`setup` 回呼（`AgentSetup`）在兩個 id 都尚未發布時組裝 agent 的作用域世界——凡經 `agentCtx` 註冊的內容都先於 `agent/created` 與第一次提示詞組裝存在——並可返回一個在發布前一刻呼叫的同步 commit；setup 拒絕、commit 拋出或所有者 dispose（資源釋放）都會回滾交易，兩個 id 均不發布。

`AgentFactory` 是登錄檔背後的建立介面：迴圈經 `ctx.agents.setFactory()` 註冊其工廠，因此消費端使用 `ctx.agents` 時無需相依性具體迴圈包。確切的 `create`/`resume` 簽名及回滾約定見下方[生成區塊](#ctxagents--agentregistry)。

<a id="the-agent-handle"></a>

## Agent 控制代碼

`Agent` 是每個外掛程式（UI、掛鉤、orchestrator）面向程式設計的 surface；`ctx.agents.get(id)` 返回它，[發起者作用域](#initiating-agent)攜帶它。具體實作為 dsh-agent-loop 包內部細節；迴圈外沒有任何元件相依性它。統一的 `send` 方法直接暴露 target 與 wakeup 路由；`followup`、`steer` 與 `inject` 是固定預設的別名方法。

原始碼：[`packages/core/agent/src/types.ts`](../../packages/core/agent/src/types.ts)

```ts type-equiv
/** Public live-agent handle. */
interface Agent {
  /** The single identity shared with {@link session}. */
  readonly id: SessionId
  /** The provider route and model this agent's requests use. */
  readonly options: AgentOptions
  /** The live session this agent drives; its log is the durable source of truth. */
  readonly session: Session
  /** The agent-owned projection of durable pending work. */
  readonly inbox: Inbox
  /** The current lifecycle state, mirrored on every `agent/status` transition. */
  readonly status: AgentStatus
  /** Agent-scoped context; its contributions are agent-local, unwind on disposal, and reject registration afterward. */
  readonly ctx: Context

  /**
   * Clear queued and steering work — unless `keepInbox` — and abort the active
   * turn or between-turn task. The first cause wins for that activity. With no
   * active activity, cancellation is a no-op and does not arm later work.
   * @param cause - the stable caller intent carried by the active operation signal.
   * @param options - cancellation options; `keepInbox` preserves pending work.
   */
  cancel(cause: AgentCancelCause, options?: CancelOptions): void

  /**
   * Resolve after the current whole-agent activity reaches quiescence. This
   * follows replacement work started before the observed driver retires,
   * but does not identify the settlement of any particular message.
   * @returns fulfillment after no active driver or maintenance task remains.
   */
  whenIdle(): Promise<void>

  /**
   * Run one non-turn maintenance task from the true idle phase. The task starts
   * synchronously after claiming that phase; later waking input remains in the
   * inbox until the task settles, while public status stays `idle`.
   * `whenIdle()` follows both the task and any waking work released behind it.
   * @param task - operation whose fulfillment or rejection is preserved, with a signal aborted by {@link cancel}.
   * @throws synchronously when turn-driving or another maintenance task already owns the agent.
   * @returns the task promise.
   */
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>

  /**
   * Route identified input to an inbox boundary and optionally wake the driver.
   * Waking input submitted after active cancellation is queued for the next
   * turn and runs when the aborted activity converges to idle; a `disposed`
   * cancel leaves it parked. A wake submitted while already idle always opens
   * its turn boundary, even when its message is cleared before the driver
   * claims ([cancel-convergence wake latch](../../../../.agents/notes/implemented/bug-fix/2026-08-07-cancel-convergence-wake-latch.md)).
   * @param message - identified content and the source that supplied it.
   * @param target - the preferred next-turn or next-step inbox boundary.
   * @param wakeup - whether delivery may wake the driver.
   */
  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void

  /**
   * Queue an ordinary follow-up turn and wake the driver. The item becomes the
   * sole ordinary message of its own turn.
   * @param message - identified prompt content and the source that supplied it.
   */
  followup(message: UserMessage): void

  /**
   * Submit steering for the nearest step. An idle driver starts a turn;
   * a running driver consumes it at its next step boundary.
   * A rejected step leaves steering parked in the inbox until the next
   * wake; cancellation or disposal may discard pending steering.
   * @param message - identified steering content and the source that supplied it.
   */
  steer(message: UserMessage): void

  /**
   * Queue model-facing context for the next pre-step without waking the
   * driver. A running driver claims it at the nearest later step boundary;
   * idle drivers leave it pending until follow-up or steering
   * wakes them. It may miss a request whose pre-step already claimed its
   * batch. Cancellation or disposal may discard pending context.
   * @param message - identified injected context and the source that supplied it.
   */
  inject(message: UserMessage): void
}
```

```ts type-equiv
/**
 * An agent's lifecycle state, emitted on every transition as `agent/status`:
 * `idle` means no driver is active; `running` begins when waking input starts
 * cancellable pre-step processing and lasts while the driver drains,
 * closes, or checkpoints turns. Disposal removes the agent from its registry;
 * it is not a third observable status.
 */
type AgentStatus = 'idle' | 'running'
```

`running` 描述整個驅動器的排空區間，可能跨越連續的排隊輪次；它不能證明某個輪次仍然打開。dispose 會把 agent 從登錄檔移除並行出 `agent/disposed`；它不是一個終態 status 值。`followup()` 不返回控制代碼：其 `MessageId` 標識的是持久的 inbox 插入、認領與丟棄事實，而非之後的助手輸出或輪次結束。`whenIdle()` 觀察的是整個 agent，因此只有當呼叫方明確擁有從回執到空閒的這段區間時，才能把它稱為一次 run（[決策](../../.agents/notes/implemented/architecture/2026-07-30-followup-enqueue-and-owned-runs.md)）。

```ts type-equiv
/** Merge-extensible agent creation options. Persona belongs to system-prompt sections. */
interface AgentOptions {
  /** Provider route (must have a registered adapter at call time). */
  provider?: string
  /** Model id interpreted by the selected provider adapter. */
  model?: string
  /** Maximum output tokens for each conversation-model request. */
  maxTokens?: number
}
```

在 `agent/request` 之後，分發要求 `provider` 與 `model` 都存在。提供 `maxTokens` 時，它必須是正安全整數，並限制每次對話模型請求的輸出；省略時，系統會在寫入請求 header 前填入確切模型的配接器預設值，否則提供方行為保持不變。agent 作用域的 `deployment:persona` 提示詞段落可以遮蔽全域性預設 persona。

inbox 即投遞詞彙——agent 以持久投影形式擁有的兩條有序待處理訊息清單：

```ts type-equiv
/** One of the two ordered pending-message lists owned by an agent. */
type InboxTarget = 'next-turn' | 'next-step'
```

每個待處理入隊項就是其 `UserMessage`；`MessageId` 是唯一標識。`Inbox.append`、`prepend`、`replace`、`remove`、`clear`、`splice` 與 `claim` 會記錄規範化的持久 `agent/inbox/spliced` 變更，並拒絕重複的待處理 id。`replace(messageId, newMessage)` 與 `remove(messageId)` 透過 `MessageId` 跨兩份清單定位待處理訊息；替換可以改變標識，並先將舊訊息作為 discarded 發布，再將新訊息作為 inserted 發布。普通刪除和 `clear()` 都表示取消。`claim(target)` 透過純刪除 splice 移除擬進入步驟的批次——全部 `next-step` 輸入，外加輪次邊界上的一條 `next-turn` 訊息——且不寄出 discarded 通知；迴圈另行逐條寄出 claimed 通知。UI 投影等整體佇列消費端透過持久 splice 重建 `nextTurn` 與 `nextStep`，而跟蹤單則訊息的消費端使用精確的 `agent/inbox/inserted`、`claimed` 與 `discarded` 通知。

取消：

```ts type-equiv
/** Options for {@link Agent.cancel}. */
interface CancelOptions {
  /**
   * Preserve queued and steering inbox items instead of discarding them. The
   * active turn is still aborted, but un-started and pending work survives for a
   * later turn and no canceled inbox splice is logged.
   */
  keepInbox?: boolean | undefined
}
```

```ts type-equiv
/** Why an active agent driver was cancelled. */
type AgentCancelCause =
  | { readonly kind: 'user' }
  | { readonly kind: 'parent' }
  | { readonly kind: 'hook'; readonly reason: string }
  | { readonly kind: 'disposed' }
```

cause 是由 TypeScript 強制約束的同行程輸入。活躍的取消持有者會將它複製到僅執行時期的 `AbortSignal.reason`；signal 不授予協作監聽器任何分類權限。持久 `turn/end` 保留粗粒度 `{ kind: 'aborted' }` 結果；若需記錄誰請求了取消，應使用單獨的持久事件，而不是讓終態結果承擔額外含義。

[事件分類](../architecture.md#events)負責 `agent/*` 生命週期、檢查點與 waterfall（瀑布式事件）約定。輪次和步驟邊界是持久工作階段事件，而不是 agent emit。

<a id="initiating-agent"></a>

## 發起 Agent

`ctx.agents` 攜帶的行程本機 initiator 就是上面的確切 `Agent`，不是單獨的 frame 或複製的標識。環境中存在該值既不能證明存活，也不代表授權；[initiator 作用域決策](../../.agents/notes/implemented/architecture/2026-07-15-agent-initiator-scope.md)定義其生命週期和作用域規則。

## 攔截決策

pre-step 決策使用與持久 user-role 輸入相同、帶標識的 `UserMessage` 類型。進入步驟的批次具有權威性，並保留每則訊息的 `id` 和 `source`。掛鉤橋接層把其原生決策欄位對映到這一類型化結果上。

原始碼：[`packages/core/agent/src/types.ts`](../../packages/core/agent/src/types.ts)

`agent/pre-step` 接收一個 payload，攜帶獨佔的已領取批次（`messages`）、擬進入步驟的坐標（`turn`、`step`）與當前輪次的取消 `signal`。首次提案在已打開的輪次內、任何步驟開始前執行；工具 continuation 可以在步驟之間提交空的已領取批次：

它返回 `PreStepDecision`。reject 不會打開步驟。enter 提供在 `step/start` 後追加的完整訊息批次；最終決策省略的已領取消息保持已刪除，而領取後插入的輸入仍留待後續處理：

```ts type-equiv
/** Whether and with which messages the loop enters a proposed step. */
type PreStepDecision =
  | { kind: 'reject' }
  | { kind: 'enter'; messages: UserMessage[] }
```

`agent/request-error` 在失敗的模型步驟關閉之後、其輪次關閉之前執行。listener 可以在失敗輪次的 signal 仍然存活時修復持久狀態或 await 策略工作。處理該錯誤的 listener 返回 `{ kind: 'retry' }` 且不呼叫 `next()`；預設的 `undefined` 會讓失敗保持終態。

```ts type-equiv
/** Action returned by a listener that owns model-request recovery. */
type RequestErrorAction = { kind: 'retry' } | undefined
```

`agent/pre-step` 是請求推導前唯一的序列監聽器鏈。`agent/turn-stopping` 在輪次沒有工具或 steering（中途引導）後續時執行，先於最後一次 steering 排空。

`agent/session-start` 攜帶 `SessionStartSource`（工作階段生命週期為何開始；橋接層據此匹配其 SessionStart）：

```ts type-equiv
/** Why a session lifecycle began; seeded creates are `startup`, while persisted loads are `resume`. */
type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact'
```

## 工作階段

`Session` 是一份類型化 `SessionEvent` 的**僅附加日誌**——唯一的真源。LLM 訊息歷史從日誌*派生*（`deriveMessages()`），而非單獨儲存。每個條目攜帶單調的 `seq`、`time` 與按 `type` 判別的 `data` payload；surface 變體還可以在 `sourceEventSeqs` 中列出被引用的較早事件，並攜帶 `surfaceOp`。

`SessionEvent` 信封的確切條件欄位、十二種事件變體（`turn/start`、`turn/end`、`step/start`、`step/end`、`user/message`、`assistant/chunk`、`assistant/message`、`tool/call`、`tool/result`、`steering/message`、`todo/write`、`request/header`）、`deriveMessages()` 投影規則、`TurnTrigger`/`TurnEndReason` 原因以及執行封閉和獨立事件規則都在 **[session.md](session.md)** 中。日誌如何持久化——`SessionPersistence` 介面、JSONL/SQLite 後端、`session/flush` 檢查點、當機復原與 `SessionHeader`——則在 **[persistence.md](persistence.md)** 中。

## `ToolDefinition`

唯一屬於核心的管線編寫類型：每個已註冊工具*是什麼*——一個面向模型的 `ToolSchema` 加上一個 `execute` 函式，以及選填的最終內容回呼與 UI 回呼。工具作者很少手動構造它（`defineTool` DSL 會使用類型化參數建置），但它是登錄檔儲存並由迴圈用於分發的約定。

其完整欄位、`defineTool`/`ValueSchemaSpec`/`ParameterSchemaSpec` 類型化 schema DSL、`ToolExecution`/`ToolExecutionResult` waterfall 類型，以及工具展示 UI 類型都在 **[tools.md](tools.md)** 中。

## 全倉通用類型模式

兩個模式在每個子系統中反覆出現，只在此處記錄一次。

<a id="the-map--derived-union-pattern"></a>

### `…Map → derived-union` 模式

harness 中幾乎所有可擴充的和類型都遵循同一模式：一個以判別標籤為鍵的介面（`…Map`），聯合類型由 `keyof` 派生。外掛程式透過**聲明合併**新增變體——無需修改擁有該類型的包。

```ts ignore-check
// The pattern, schematically:
interface ThingMap {
  'a': { kind: 'a'; /* … */ }
  'b': { kind: 'b'; /* … */ }
}
type ThingKind = keyof ThingMap          // 'a' | 'b'
type Thing = ThingMap[keyof ThingMap]    // the discriminated union

// A plugin extends it without touching the source package:
declare module '@deepseek-ai/dsh-llm' {
  interface ThingMap {
    'c': { kind: 'c'; /* … */ }
  }
}
```

六個規範 map 使用此模式；外掛程式作者擴充它們：

| Map | 包 | 派生 | 目錄 |
|---|---|---|---|
| `ContentBlockMap` | dsh-llm | `ContentBlock` | [llm-streaming.md](llm-streaming.md#content-blocks-and-messages) |
| `MessageSourceMap` | dsh-llm | `MessageSource` | [llm-streaming.md](llm-streaming.md#content-blocks-and-messages) |
| `FinishReasonMap` | dsh-llm | `FinishReason` | [llm-streaming.md](llm-streaming.md#the-model-request-and-result) |
| `TurnTriggerMap` | dsh-session | `TurnTrigger` | [session.md](session.md) |
| `TurnEndReasonMap` | dsh-session | `TurnEndReason` | [session.md](session.md) |
| `SessionEventMap` | dsh-session | `SessionEvent` | [session.md](session.md) |

消費端最常 `switch` 的兩個大型判別聯合類型是：**`StreamChunk`**（流式協定）和 **`SessionEvent`**（日誌條目）。按倉庫約定，對標籤做 `switch`——不要鏈式 `if`——這樣每個分支都能窄化類型，拼錯的標籤會編譯失敗。

<a id="branded-ids"></a>

### 品牌化 ID

在包之間傳遞的 ID 都經過**品牌化**——結構上是字串，但在類型層面不可互換（不能把 `SessionId` 傳給需要 `CallId` 的位置）。每種類型透過各自的工廠構造；比較、日誌記錄和 JSON 行為與普通字串相同。

`Branded<B>` 原語位於獨立的純類型包 [dsh-brand](../../packages/util/brand) 中（沒有執行時期程式碼，也不相依性 harness 包），因此任何包都能品牌化其擁有的 id，而無需相依性無關的能力包。

原始碼：[`packages/util/brand/src/index.ts`](../../packages/util/brand/src/index.ts)

```ts type-equiv
/** A string carrying a compile-time-only brand `B`. */
type Branded<B extends string> = string & { readonly [BRAND]: B }
```

兩個核心 ID 是 `CallId`（關聯工具呼叫及其結果；dsh-llm）和 `SessionId`（活躍 agent 與持久工作階段共享的標識；dsh-session）。能力包也會品牌化各自的 id，例如 [jobs.md](jobs.md) 中的 `JobId`。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxagentdefaultmodel--agentdefaultmodelconfig"></a>

### `ctx.agentDefaultModel` — `AgentDefaultModelConfig`

Owns the default model selection independently of any Host or transport. The composition entry remains usable without a settings provider; when one is mounted, its user layer is read live.

```ts cordis-catalog
/**
 * Read the current default model selection.
 * @returns a detached provider, model, and optional reasoning selection.
 */
currentSelection(): ModelSelection

/**
 * Save the complete default model selection. A deployment without a settings
 * provider keeps its composition entry.
 * @param next - resolved selection accepted by an entry point.
 * @returns fulfillment after the optional settings write settles.
 */
async saveSelection(next: ModelSelection): Promise<void>
```

Source: [`packages/core/agent-default-model/src/index.ts:64`](../../packages/core/agent-default-model/src/index.ts)

<a id="ctxagentloop--agentloop"></a>

### `ctx.agentLoop` — `AgentLoop`

Concrete agent factory and driver service.

```ts cordis-catalog
/**
 * Create an agent and session under one caller-supplied identity, owned by
 * the accessing fiber. Constructor-driven config calls mint a fresh combined
 * id before entering this boundary.
 * @param id - shared agent/session identity.
 * @param options - concrete loop options.
 * @param meta - optional fresh-session workspace metadata.
 * @returns the published running agent.
 */
create(id: SessionId, options: AgentOptions = {}, meta: Pick<SessionHeader, 'cwd'> = {}): Agent

/**
 * Create an owned agent on a caller-supplied session id.
 * @param ownerCtx - caller context that structurally owns the lifecycle.
 * @param options - identities, session seed/metadata, loop options, setup, and cancellation.
 * @returns the published handle.
 */
async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle>

/**
 * Resume an owned agent from the configured persistence service.
 * @param ownerCtx - caller context that owns load, setup, and the live lifecycle.
 * @param options - persisted identity, loop options, setup, and cancellation.
 * @returns the published handle.
 */
async resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle>
```

Types: [SessionHeader](persistence.md)

Source: [`packages/core/agent-loop/src/index.ts:296`](../../packages/core/agent-loop/src/index.ts)

<a id="ctxagentpresets--agentpresets"></a>

### `ctx.agentPresets` — `AgentPresets`

Registry over the deployment's agent presets.

Discovery is unmemoized: `list()` and `resolve()` re-read the roots on every call so a preset authored while the process runs is visible immediately, and a preset deleted underneath a picker disappears from the next read.

```ts cordis-catalog
/**
 * Every preset the configured roots currently supply.
 * @returns the presets, first-root-wins per id.
 */
async list(): Promise<AgentPreset[]>

/**
 * Resolve one preset by id.
 *
 * A broken preset resolves — deleting one, reading one, and reporting one
 * all need the row — and the mounting paths refuse it AFTER resolution
 * through {@link resolveMountable}.
 * @param id - the preset id, or `undefined` for {@link defaultId}.
 * @returns the resolved preset.
 * @throws when no configured root supplies that id.
 */
async resolve(id?: string): Promise<AgentPreset>

/**
 * Compose one agent from a preset: ensure the preset's standing mount, then
 * parent the agent's scope key to it so the mount's registrations and
 * listeners cover this agent.
 *
 * Call from the agent factory's `setup(agentCtx)`; a rejection there rolls
 * the agent creation back, so a broken preset never yields a half-composed
 * session.
 * @param agentCtx - the agent's scope context.
 * @param id - the preset id, or `undefined` for {@link defaultId}.
 * @returns the preset that was composed, for the caller to record.
 * @throws when the preset is unknown or its composition is unusable.
 */
async mount(agentCtx: Context, id?: string): Promise<AgentPreset>

/**
 * Join one agent to the SAME standing composition another already runs on.
 *
 * This is how a child agent inherits its parent's capabilities. It is a bind,
 * not a mount: the parent's generation is already composed, so the child gets
 * that exact instance — the same plugin objects, the same tool registrations,
 * the same prompt sections. Re-resolving the parent's preset by id instead
 * would re-read the roster, and a composition file edited since the parent
 * started would hand the child a DIFFERENT generation than the one its
 * parent's history was produced under (and a preset deleted since would fail
 * the child outright while its parent keeps running).
 *
 * Synchronous, and with no composition failure mode of its own — it reads no
 * roster, mounts nothing, and touches no file — which is what lets a child
 * creation window use it: the two in-process subagent drivers compose their
 * children inside a synchronous `setup`. It still rejects a caller error, as
 * the `@throws` below record.
 *
 * A parent that joined no preset — a rosterless deployment — yields no join
 * and no error: there, the model-facing rows sit in the host composition and
 * the child already sees them through the global layer.
 * @param agentCtx - the joining agent's scope context.
 * @param parentCtx - the scope context of the agent whose composition to join.
 * @returns the preset id joined, or undefined when the parent joined none.
 * @throws when `agentCtx` carries no scope, or has already joined a preset.
 */
composeFrom(agentCtx: Context, parentCtx: Context): string | undefined

/**
 * The preset one live agent runs on.
 *
 * Read from the live scope chain rather than from the session, so it answers
 * for an agent whose session has not recorded a preset yet — a child agent
 * whose durable header is being built from its parent's composition.
 * @param agentCtx - the agent's scope context.
 * @returns the preset id, or undefined when the agent joined none.
 */
composedPreset(agentCtx: Context): string | undefined

/**
 * Read one preset's composition text.
 * @param id - the preset id.
 * @returns the composition exactly as stored.
 * @throws when no configured root supplies that id.
 */
async read(id: string): Promise<string>

/**
 * Create a locally authored preset by copying an existing one whole.
 *
 * Copy is the only authoring write. Composition text never crosses this
 * seam: the source is named by id and its directory is copied as it stands,
 * so the copy is exactly as loadable as its source and authoring grants no
 * capability the roster did not already carry. The copy is NOT mounted to
 * validate — a source that mounts today yields a copy that mounts today.
 * @param from - the preset the copy starts from; shipped presets are the
 * primary source, so any trust is accepted.
 * @param id - the new preset's id, which becomes its directory name.
 * @param name - display name for the copy; absent falls back to the id.
 * @throws when the source is unknown, the id is unusable or already taken,
 * or the deployment configures no writable root.
 */
async copy(from: string, id: string, name?: string): Promise<void>

/**
 * Delete a locally authored preset.
 * @param id - the preset id.
 * @throws when the preset is unknown or ships with the deployment.
 */
async remove(id: string): Promise<void>

/**
 * One agent's instance of a service its preset mounted.
 *
 * A preset publishes services behind `isolate` realms, which are invisible
 * outside the group that declares them — including to the host. This is how a
 * caller holding the agent reads one anyway: a request that is ABOUT a
 * session but arrives from outside it, which is every browser RPC.
 *
 * Read addressing only. A host row that `inject`s a service cannot use this,
 * because injection resolves before any session exists and has no agent to
 * key by; such a service belongs on the host plane instead.
 * @param agent - the agent whose composition to look inside.
 * @param name - the service name as the preset's rows resolve it.
 * @returns the agent's instance, or undefined when its preset mounts none.
 */
serviceFor<K extends string & keyof Context>(agent: { ctx: Context }, name: K): Context[K] | undefined

/**
 * Re-link one agent to a different preset's standing composition.
 *
 * Only valid while the agent has produced nothing: swapping tools mid
 * conversation would leave logged tool calls the new composition cannot
 * make. The CALLER owns that check — this method does not read session
 * history.
 *
 * The swap is a parent re-link, not an unmount: standing mounts are shared
 * and permanent, so the old composition stays for its other agents and the
 * new one is ensured BEFORE the link moves. An unknown or unusable preset
 * therefore throws with the agent exactly as it was — there is no torn-down
 * state to restore. The re-link runs through the binding this roster kept
 * from the agent's mount — dsh-scope's only re-link authority. An agent
 * that never composed one has nothing to re-link: the switch is then the
 * agent's first bind, exactly a mount.
 * @param agentCtx - the agent's scope context.
 * @param id - the preset to compose the agent from instead.
 * @returns the preset now installed.
 * @throws when the preset is unknown or its composition is unusable.
 */
async recompose(agentCtx: Context, id: string): Promise<AgentPreset>

/**
 * The standing scope key of one preset, for a host reader with no agent.
 *
 * A cold transcript read resolves tool presenters against the composition
 * the session recorded, and the standing mount makes that possible without
 * resuming anything: ensuring the mount composes plugins but starts no
 * agent, no session, and no turn.
 * @param id - the preset id, or `undefined` for {@link defaultId}.
 * @returns the standing scope key readers pass as a registry view scope.
 * @throws when the preset is unknown or its composition is unusable.
 */
async standingKeyFor(id?: string): Promise<ScopeKey>
```

Types: [ScopeKey](scope.md)

Source: [`packages/preset/agent-presets/src/index.ts:82`](../../packages/preset/agent-presets/src/index.ts)

<a id="ctxagents--agentregistry"></a>

### `ctx.agents` — `AgentRegistry`

Agent service (`ctx.agents`): tracks live agents and carries the initiating Agent through one process-local asynchronous driver chain. Agent *creation* is provided by whichever plugin implements the AgentFactory (`@deepseek-ai/dsh-agent-loop`), registered via setFactory.

Initiator methods provide same-process causal attribution only. Ambient presence is neither liveness proof nor authorization; subjects and owners remain explicit, as does identity at worker, process, persistence, and wire boundaries. Returned Promise boundaries drain during teardown, except a nested lineage that starts an owning-fiber unload is excluded from its own drain.

```ts cordis-catalog
/**
 * Read the Agent that initiated the inherited asynchronous driver chain.
 * Use this optional form for logging, tracing, metrics, or host attribution
 * that also supports agentless calls. When a parent creates a child, setup
 * reports the causal parent while `agentCtx.agent` identifies the child.
 * @returns the inherited Agent, or `undefined` outside an initiator boundary
 *   and inside an explicit clearing boundary.
 * @throws when this service instance has been disposed.
 */
currentInitiator(): Agent | undefined

/**
 * Read the initiating Agent and fail when no initiator boundary is active.
 * Use this for private helpers contractually below a driver, or for a
 * deployment-owned outbound request whose contract forbids agentless calls.
 * Generic or direct-call paths use optional lookup or explicit request fields.
 * @returns the inherited Agent.
 * @throws when no initiator is active or this service instance has been disposed.
 */
requireInitiator(): Agent

/**
 * Run an operation with one exact Agent as its process-local initiator. The
 * exact synchronous value or Promise returned by the operation is preserved.
 * Custom drivers and test harnesses wrap their complete returned foreground
 * lifetime.
 * A queue or wire receiver may establish this boundary only after validating
 * explicit identity and resolving the exact live Agent; this method does neither.
 * Detached work remains owned by the subsystem that starts it.
 * @param agent - initiating Agent to inherit; presence is neither liveness proof nor authorization.
 * @param operation - synchronous or asynchronous operation to invoke.
 * @returns the exact value returned by `operation`.
 * @throws when the initiator scope is closing/disposed, or when `operation` throws.
 */
withInitiator<T>(agent: Agent, operation: () => T): T

/**
 * Run an operation inside a boundary that hides any inherited initiating
 * Agent. The exact synchronous value or Promise is preserved.
 * Use this while creating lazy shared timers, queue pumps, pool maintenance,
 * watchers, or exporters so they do not inherit the first Agent that happens
 * to initialize them. It clears only initiator attribution, not explicit
 * fields, and does not own or drain detached resources.
 * @param operation - synchronous or asynchronous operation to invoke without an initiator.
 * @returns the exact value returned by `operation`.
 * @throws when the initiator scope is closing/disposed, or when `operation` throws.
 */
withoutInitiator<T>(operation: () => T): T

/**
 * Register the agent-creation factory (the loop calls this on construction,
 * effect-scoped). A traced Cordis service is canonicalized to its concrete
 * target; each create/resume call is then traced through that caller's
 * context so ownership follows the caller without stacking proxy layers.
 * Throws if a factory is already registered. Returns the disposer; on
 * dispose the factory slot is cleared.
 * @param factory - the loop-owned factory {@link create}/{@link resume} delegate to.
 * @returns the disposer that clears the factory slot. The exact
 *   Cordis effect disposer (single-shot): composite (generator) effects may
 *   yield it directly — exact identity nests the teardown in order.
 */
setFactory(factory: AgentFactory): () => void

/**
 * Create and publish a new agent through the registered factory.
 * Distinct from {@link register} (which records an already-constructed
 * agent): this constructs the agent and its session. Rejects if no factory is
 * registered or creation/setup fails. The resolved {@link AgentHandle} lets
 * the owner tear down exactly this agent.
 * @param options - shared identity, session seed/metadata, and agent options.
 * @returns the handle after setup, rollback-covered publication, and loop start complete.
 */
async create(options: CreateAgentOptions): Promise<AgentHandle>

/**
 * Load a persisted session and resume an agent on it through the registered
 * factory. Rejects if no factory is registered; the factory rejects if
 * session persistence is not configured or persistence/setup fails.
 * @param options - persisted identity, configuration, and optional setup.
 * @returns the handle after setup, rollback-covered publication, and loop start complete.
 */
async resume(options: ResumeAgentOptions): Promise<AgentHandle>

/**
 * Register a live agent. Throws if an agent with the same id is already
 * registered. Emits `agent/created` on registration and `agent/disposed`
 * when the calling fiber is disposed — both with the agent's scope carrier
 * (`scopeTarget(agent, agent)`): the subject is the agent in hand, so the
 * emits are scope-filtered regardless of which context invoked `register`
 * (calling through `agent.ctx` scopes EFFECTS; dispatch scoping always
 * requires passing the carrier). Returns the disposer.
 * @param agent - the already-constructed agent to record in the store.
 * @returns the EXACT Cordis effect disposer (single-shot; a repeat call
 *   returns undefined without awaiting an in-flight teardown). Exact
 *   identity is load-bearing: a composite (generator) effect that owns a
 *   teardown ORDER — the agent factory's lifecycle chain — must yield THIS
 *   function so Cordis nests the unregistration at that yield position;
 *   yielding a wrapper would leave it disposing as a concurrent sibling on
 *   owner unload, unregistering the agent (and emitting `agent/disposed`)
 *   while its final turn is still draining.
 */
register(agent: Agent): () => void

/**
 * Insert an already-constructed agent without announcing it. This is the
 * advanced ordered-lifecycle primitive used by the async agent factory: it
 * first completes setup while the agent is unpublished, then assigns the
 * returned detach closure into its pre-installed composite teardown before
 * calling {@link announce}. Ordinary callers use {@link register}.
 * @param agent - the prepared, unpublished agent.
 * @param owner - live agent whose scoped context created this agent, or
 *   undefined for a top-level runtime root. This is runtime ownership, not
 *   the resumed session's durable parent lineage.
 * @returns an idempotent closure that removes this exact entry and emits
 *   `agent/disposed` with listener failures contained. When called from a
 *   synchronous `agent/created` listener, removal and disposal wait until
 *   that creation dispatch unwinds.
 */
enter(agent: Agent, owner: Agent | undefined): () => void

/**
 * Announce an agent previously inserted with {@link enter}.
 * @param agent - the live inserted agent to announce.
 * @throws if `agent` is not the exact live registry entry for its id, or its
 *   creation announcement already began (including a reentrant call from a
 *   creation listener).
 */
announce(agent: Agent): void

/**
 * Look up a live agent.
 * @param id - the shared agent/session id to look up.
 * @returns the agent, or undefined when no live agent has that id.
 */
get(id: SessionId): Agent | undefined

/**
 * Test whether a live agent was created through one exact parent agent's
 * scoped context. Runtime ownership is independent of durable session
 * lineage and remains unambiguous when unrelated providers reuse an id.
 * @param id - the candidate child agent's shared agent/session id.
 * @param owner - the expected runtime creator agent.
 * @returns true only while the exact child entry is live under that owner.
 */
isOwnedBy(id: SessionId, owner: Agent): boolean

/**
 * All live agents, in registration order.
 * @returns a fresh array; mutating it does not affect the registry.
 */
list(): Agent[]

/**
 * All live top-level agents in registration order. A top-level agent was
 * created without an owning agent context; durable session lineage does not
 * affect this runtime relation, so a resumed fork may still be a root.
 * @returns a fresh array; mutating it does not affect the registry.
 */
roots(): Agent[]
```

Source: [`packages/core/agent/src/index.ts:256`](../../packages/core/agent/src/index.ts)

<a id="agent-events"></a>

### `agent/*` events

<a id="agentcreated--emit"></a>

#### `agent/created` — emit

A fully configured agent and live session were published. Setup is composition-only; `agent/session-start` is the first startup-driving extension point. Synchronous listener failure vetoes publication, while returned-promise rejection is reported. Detach requested during dispatch waits until every creation listener has observed the stable entry.

```ts cordis-catalog
/**
 * A fully configured agent and live session were published. Setup is
 * composition-only; `agent/session-start` is the first startup-driving extension point.
 * Synchronous listener failure vetoes publication, while returned-promise
 * rejection is reported. Detach requested during dispatch waits until every
 * creation listener has observed the stable entry.
 * @param payload.agent - the newly registered agent with its live session and completed setup.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/created'(this: Scoped<Agent>, payload: { agent: Agent }): void
```

Types: [Scoped](scope.md)

Source: [`packages/core/agent/src/runtime-types.ts:159`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentdisposed--emit"></a>

#### `agent/disposed` — emit

An agent left the registry; AgentLoop emits this after driver quiescence and scoped-registration unwind, but before session detachment. Custom registry users own their driver-ordering contract.

```ts cordis-catalog
/**
 * An agent left the registry; AgentLoop emits this after driver quiescence
 * and scoped-registration unwind, but before session detachment. Custom
 * registry users own their driver-ordering contract.
 * @param payload.agent - the exact agent removed from the registry.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/disposed'(this: Scoped<Agent>, payload: { agent: Agent }): void
```

Types: [Scoped](scope.md)

Source: [`packages/core/agent/src/runtime-types.ts:168`](../../packages/core/agent/src/runtime-types.ts)

<a id="agenterror--emit"></a>

#### `agent/error` — emit

A step or turn errored. The machine reports a failure here even when the error has no in-turn position for a durable record.

```ts cordis-catalog
/**
 * A step or turn errored. The machine reports a failure here even when
 * the error has no in-turn position for a durable record.
 * @param payload.agent - the agent whose turn errored.
 * @param payload.turn - the turn in which the failure surfaced.
 * @param payload.step - the step at which the failure surfaced.
 * @param payload.error - the failure, verbatim.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/error'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; step: number; error: unknown }): void
```

Types: [Scoped](scope.md)

Source: [`packages/core/agent/src/runtime-types.ts:290`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentinboxclaimed--emit"></a>

#### `agent/inbox/claimed` — emit

One message left the inbox inside its open turn. If the proposed step is rejected, the claimed message ends here: it is neither discarded nor re-emitted as a user/message, and the turn closes without a step.

```ts cordis-catalog
/**
 * One message left the inbox inside its open turn. If the proposed step
 * is rejected, the claimed message ends here: it is neither discarded nor
 * re-emitted as a user/message, and the turn closes without a step.
 * @param payload.agent - the agent whose inbox changed.
 * @param payload.message - the claimed message.
 * @param payload.turn - the owning turn.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/inbox/claimed'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage; turn: number }): void
```

Types: [Scoped](scope.md) · [UserMessage](session.md)

Source: [`packages/core/agent/src/runtime-types.ts:197`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentinboxdiscarded--emit"></a>

#### `agent/inbox/discarded` — emit

One message was discarded from the live inbox.

```ts cordis-catalog
/**
 * One message was discarded from the live inbox.
 * @param payload.agent - the agent whose inbox changed.
 * @param payload.message - the discarded message.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/inbox/discarded'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage }): void
```

Types: [Scoped](scope.md) · [UserMessage](session.md)

Source: [`packages/core/agent/src/runtime-types.ts:205`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentinboxinserted--emit"></a>

#### `agent/inbox/inserted` — emit

One message entered the live inbox.

```ts cordis-catalog
/**
 * One message entered the live inbox.
 * @param payload.agent - the agent whose inbox changed.
 * @param payload.message - the inserted message.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/inbox/inserted'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage }): void
```

Types: [Scoped](scope.md) · [UserMessage](session.md)

Source: [`packages/core/agent/src/runtime-types.ts:186`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentpre-step--waterfall"></a>

#### `agent/pre-step` — waterfall

Reject a proposed step or replace the messages that enter it. Calling `next()` preserves the current messages.

```ts cordis-catalog
/**
 * Reject a proposed step or replace the messages that enter it. Calling
 * `next()` preserves the current messages.
 * @param payload.agent - the agent proposing the step.
 * @param payload.messages - messages removed from the inbox for this step.
 * @param payload.turn - the turn that will own the step.
 * @param payload.step - the step proposed by the loop.
 * @param payload.signal - the current turn's cancellation signal.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode waterfall
 */
'agent/pre-step'(this: Scoped<Agent>, payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal }, next: () => Promise<PreStepDecision>): Promise<PreStepDecision>
```

Types: [Scoped](scope.md) · [UserMessage](session.md)

Source: [`packages/core/agent/src/runtime-types.ts:231`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentrequest--waterfall"></a>

#### `agent/request` — waterfall

Replace the frozen call configuration. `await next()` yields the config the machine would use (agent options on the first request, the logged header afterwards); return a replacement to switch. Model-visible content must use logged channels; this waterfall cannot mutate messages.

```ts cordis-catalog
/**
 * Replace the frozen call configuration. `await next()` yields the config
 * the machine would use (agent options on the first request, the logged
 * header afterwards); return a replacement to switch. Model-visible
 * content must use logged channels; this waterfall cannot mutate messages.
 * @param payload.agent - the agent making the model call.
 * @param payload.turn - the open turn number.
 * @param payload.step - the step whose request this is.
 * @param payload.signal - the current turn's explicit abort signal.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode waterfall
*/
'agent/request'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; step: number; signal: AbortSignal }, next: () => Promise<LlmCallConfig>): Promise<LlmCallConfig>
```

Types: [LlmCallConfig](llm-streaming.md) · [Scoped](scope.md)

Source: [`packages/core/agent/src/runtime-types.ts:244`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentrequest-error--waterfall"></a>

#### `agent/request-error` — waterfall

Handle one failed model-request attempt before the loop retries or closes its step. A listener returns `{ kind: 'retry' }` without calling `next()` when it owns recovery, or calls `next()` to delegate. The default `undefined` leaves the failure terminal.

```ts cordis-catalog
/**
 * Handle one failed model-request attempt before the loop retries or closes
 * its step. A listener returns `{ kind: 'retry' }` without calling `next()`
 * when it owns recovery, or calls `next()` to delegate. The default
 * `undefined` leaves the failure terminal.
 * @param payload.agent - the agent whose request failed.
 * @param payload.turn - the turn containing the failed request.
 * @param payload.step - the step containing the failed request attempt.
 * @param payload.provider - the provider selected for the failed request.
 * @param payload.failure - serializable facts normalized at the final adapter boundary.
 * @param payload.retryPolicy - the policy of the adapter registration that served the failed request.
 * @param payload.signal - the turn abort signal.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode waterfall
 */
'agent/request-error'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; step: number; provider: string; failure: LlmFailure; retryPolicy: ResolvedRetryPolicy | undefined; signal: AbortSignal }, next: () => Promise<RequestErrorAction>): Promise<RequestErrorAction>
```

Types: [LlmFailure](llm-streaming.md) · [ResolvedRetryPolicy](llm-streaming.md) · [Scoped](scope.md)

Source: [`packages/core/agent/src/runtime-types.ts:260`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentsession-start--emit"></a>

#### `agent/session-start` — emit

The session lifecycle began, once before the first turn. Use `agent.inject()` to seed model-facing context. This is a notification, not a veto; disposal requested by a lifecycle owner is rechecked before the driver starts.

```ts cordis-catalog
/**
 * The session lifecycle began, once before the first turn. Use
 * `agent.inject()` to seed model-facing context. This is a notification, not
 * a veto; disposal requested by a lifecycle owner is rechecked before the
 * driver starts.
 * @param payload.agent - the agent whose session lifecycle began.
 * @param payload.source - why the session started (fresh startup, resume, …).
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/session-start'(this: Scoped<Agent>, payload: { agent: Agent; source: SessionStartSource }): void
```

Types: [Scoped](scope.md)

Source: [`packages/core/agent/src/runtime-types.ts:217`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentstatus--emit"></a>

#### `agent/status` — emit

Agent status changed (`idle` ⇄ `running`). A waking delivery enters `running` synchronously after reserving cancellation; `idle` means no driver remains scheduled or active.

```ts cordis-catalog
/**
 * Agent status changed (`idle` ⇄ `running`). A waking delivery enters
 * `running` synchronously after reserving cancellation; `idle` means no
 * driver remains scheduled or active.
 * @param payload.agent - the agent whose status flipped.
 * @param payload.status - the status just entered (the transition's destination).
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/status'(this: Scoped<Agent>, payload: { agent: Agent; status: AgentStatus }): void
```

Types: [Scoped](scope.md)

Source: [`packages/core/agent/src/runtime-types.ts:178`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentturn-stopping--serial"></a>

#### `agent/turn-stopping` — serial

The turn is about to close: the model owes no response (no live tool calls, no fresh steering). Awaited before the boundary commits — a listener that objects steers (`agent.steer(...)`) and the machine re-reads its inbox: fresh steering runs another step, none closes the turn. Data decides, so listener order cannot change the outcome. The inverse control (stop a tool loop early) is data too: a tool result carrying `concludesTurn` ends the turn at its step. The conclusion never short-circuits already-submitted next-step work: same-step `additionalContexts` or racing steering still runs, and the turn closes only when that inbox drains.

```ts cordis-catalog
/**
 * The turn is about to close: the model owes no response (no live tool
 * calls, no fresh steering). Awaited before the boundary commits — a
 * listener that objects steers (`agent.steer(...)`) and the machine
 * re-reads its inbox: fresh steering runs another step, none closes the
 * turn. Data decides, so listener order cannot change the outcome. The
 * inverse control (stop a tool loop early) is data too: a tool result
 * carrying `concludesTurn` ends the turn at its step. The conclusion
 * never short-circuits already-submitted next-step work: same-step
 * `additionalContexts` or racing steering still runs, and the turn
 * closes only when that inbox drains.
 * @param payload.agent - the agent whose turn is at its stop boundary.
 * @param payload.turn - the turn about to close.
 * @param payload.signal - the current turn's explicit abort signal.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode serial
 */
'agent/turn-stopping'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; signal: AbortSignal }): Promise<void> | void
```

Types: [Scoped](scope.md)

Source: [`packages/core/agent/src/runtime-types.ts:278`](../../packages/core/agent/src/runtime-types.ts)

<a id="agent-loop-events"></a>

### `agent-loop/*` events

<a id="agent-loopconfig-start-failed--emit"></a>

#### `agent-loop/config-start-failed` — emit

A declarative agent entry failed before it could publish a live agent. Consumers that buffer work for the configured identity use this transient signal to reject that work instead of waiting forever. Normal factory teardown suppresses failures from the cancelled startup attempt.

```ts cordis-catalog
/**
 * A declarative agent entry failed before it could publish a live agent.
 * Consumers that buffer work for the configured identity use this
 * transient signal to reject that work instead of waiting forever. Normal
 * factory teardown suppresses failures from the cancelled startup attempt.
 * @param payload.sessionId - exact shared agent/session identity that failed startup.
 * @param payload.error - persistence, setup, or publication failure.
 * @mode emit
 */
'agent-loop/config-start-failed'(payload: { sessionId: SessionId; error: unknown }): void
```

Source: [`packages/core/agent-loop/src/index.ts:183`](../../packages/core/agent-loop/src/index.ts)

<a id="agent-preset-events"></a>

### `agent-preset/*` events

<a id="agent-presetselected--emit"></a>

#### `agent-preset/selected` — emit

One session committed a different agent preset to its durable log. Consumers invalidate only state derived from that session's composition.

```ts cordis-catalog
/**
 * One session committed a different agent preset to its durable log.
 * Consumers invalidate only state derived from that session's composition.
 * @mode emit
 * @param sessionId - the session whose composition changed.
 * @param agentPreset - the preset recorded by the committed selection.
 */
'agent-preset/selected'(sessionId: SessionId, agentPreset: string): void
```

Source: [`packages/preset/agent-presets/src/types.ts:13`](../../packages/preset/agent-presets/src/types.ts)
<!-- END GENERATED cordis-surface -->
