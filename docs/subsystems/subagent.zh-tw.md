# Subagent

[English](subagent.md) | [简体中文](subagent.zh.md) | 繁體中文

subagent seam 讓一個 agent（代理）將工作委派給子 agent。與 [bash](shell.md) 一樣，它是**一項選填能力**，不屬於 agent loop（代理循環），因此其類型定義在此而非 [core.md](core.md) 中。它不同於其他能力 seam，因為**同一上下文中可共存多個提供方實作**，並按名稱註冊（`ctx.subagents`），而 bash 只允許一個執行器。該登錄檔遵循 [LLM（大型語言模型）配接器登錄檔](llm-streaming.md)，而非單服務的 bash 執行器。

Service Definition：[dsh-subagent](../../packages/subagent/subagent)（`ctx.subagents` + 下文詞彙）。Service Provider 是六個兄弟包：`dsh-subagent-spawn-in-process`、`-fork`、`-acp`、`-codex`、`-claude-code`、`-dsh-sdk`；面向模型的 Consumer 包括 [dsh-tool-subagent](../../packages/subagent/tool-subagent)（按提供方委派）、[dsh-tool-subagent-control](../../packages/subagent/tool-subagent-control)（選填的全域性 `send_message`、`interrupt_agent` 與 `list_agents` 控制工具）和 [dsh-tool-subagent-report](../../packages/subagent/tool-subagent-report)（選填的 child 作用域 `report` 返回通道）。同一個 `ctx.subagents` 服務透過內部啟用管理器負責可繼續子 agent 編排，並直接基於工作階段儲存和選填的工作階段持久化提供只讀的 child 與後代發現。產品提供方設計理由見 [Codex 與 Claude Code Agent Note](../../.agents/notes/implemented/feature/2026-08-04-claude-code-and-codex-subagent-backends.md)；通用 seam 的設計理由見 [subagent Agent Note](../../.agents/notes/implemented/feature/2026-06-21-subagent-capability-seam.md)、[可繼續 subagent Agent Note](../../.agents/notes/implemented/feature/2026-07-28-continuable-subagent-conversations.md)、[report 工具 Agent Note](../../.agents/notes/implemented/feature/2026-07-30-continuable-subagent-report-tool.md)、[持久化目錄 Agent Note](../../.agents/notes/implemented/feature/2026-07-22-durable-subagent-catalog-and-list-agents.md)、[清單身份投影 Agent Note](../../.agents/notes/implemented/architecture/2026-08-06-subagent-list-identity-projection.md)和[服務合併 Agent Note](../../.agents/notes/implemented/simplification/2026-07-26-merge-subagent-control-service.md)。

原始碼：[`packages/subagent/subagent/src/types.ts`](../../packages/subagent/subagent/src/types.ts)、[`packages/subagent/subagent/src/index.ts`](../../packages/subagent/subagent/src/index.ts)和 [`packages/subagent/subagent/src/continuation.ts`](../../packages/subagent/subagent/src/continuation.ts)

## 兩類能力，兩種發現方式

提供方透過一個靜態描述符公佈其**啟動時**功能，服務會在單次 run 存在之前即行檢查；如果請求相依性提供方不具備的功能，會被明確拒絕（`SubagentError('UNSUPPORTED_CAPABILITY')`），絕不會被接受後靜默忽略。這些 flag 僅描述單次 [`start()`](#the-provider-contract-subagentprovider) 路徑，即由提供方組合子 agent 的路徑。**可繼續**子 agent 由繼續執行管理器自行組合，因此它們由唯一一個選填方法把關，方法存在即為能力，並以 TypeScript 的類型收窄作為發現機制：[`SubagentProvider.prepareContinuable`](#the-provider-contract-subagentprovider)。

```ts type-equiv
/**
 * Which START-TIME features a provider supports. Checked by the service before delegating to
 * {@link SubagentProvider.start}: a request that needs a capability the chosen provider lacks
 * is rejected with a typed error rather than accepted-then-ignored (the "fail loud, no silent
 * degradation" rule). These flags describe the ONE-SHOT
 * {@link SubagentProvider.start} path, where the provider composes the child;
 * continuable children are composed by the continuation manager itself and are
 * gated by {@link SubagentProvider.prepareContinuable} instead. Each flag
 * corresponds one-to-one to a {@link SubagentStartRequest} option: `depthLimit`
 * to `maxDepth`; the other names match.
 */
interface SubagentCapabilities {
  readonly outputSchema: boolean
  readonly depthLimit: boolean
  readonly toolFilter: boolean
  readonly persona: boolean
}
```

## 單次啟動請求

工具層根據模型輸入和自身設定建置此請求；服務在 `start` 之前針對指定提供方進行校驗。必填的 `parent` 提供工作階段 cwd、譜系與委派深度。選填的 output schema、depth、工具過濾器和 persona 需要對應的能力 flag 匹配。不支援的 schema 在啟動時即失敗；行程內後端將 filter 和 persona 的作用域限定在子 agent 建立階段，並透過強制 capture 工具實作所支援的 object-rooted schema。

```ts type-equiv
/**
 * What a caller asks for when starting a ONE-SHOT subagent. The tool layer
 * builds this from the model's `{ description, prompt }` plus its own config;
 * the service validates {@link SubagentCapabilities} against the named provider
 * and resolves the durable descriptor before dispatching to
 * {@link SubagentProvider.start}.
 */
interface SubagentStartRequest {
  /** Optional short display label persisted with a session-backed child. */
  readonly label?: string
  /** Content delivered as the child's user message. */
  readonly prompt: ContentBlock[]
  /**
   * The spawning agent. In-process providers derive workspace, lineage, and
   * delegation depth from its durable session state. ACP reads only its cwd,
   * and only when no deployment `cwd` override is configured.
   */
  readonly parent: Agent
  /**
   * Cancellation signal from the spawning context (the tool's `exec.signal`).
   * This is the canonical cancellation channel both before and after startup:
   * a provider rejects `start()` after cleaning partial resources when it
   * fires before the run is published, and cancels the published run's
   * remaining turn work when it fires afterward.
   */
  readonly signal: AbortSignal
  readonly agentOptions?: AgentOptions
  /**
   * Object-rooted JSON Schema within `assertObjectJsonSchema`'s enforced subset. Start rejects
   * unsupported schemas or providers without the capability. Data must be plain host-realm JSON;
   * a successful child returns the matching value as {@link SubagentResult.structured}.
   */
  readonly outputSchema?: ObjectJsonSchema
  /**
   * Optional absolute delegation-depth cap for the child being started: its
   * computed depth must be less than or equal to this non-negative safe
   * integer. Requires {@link SubagentCapabilities.depthLimit}; rejected at
   * start otherwise.
   */
  readonly maxDepth?: number
  /**
   * Optional child tool scoping. Requires {@link SubagentCapabilities.toolFilter};
   * rejected at start otherwise. In-process backends apply it as a scoped
   * `tools.restrict()` in the child's creation window: the named tools vanish
   * from the child's prompt AND refuse to execute (one visibility), with loud
   * unknown-name validation.
   */
  readonly toolFilter?: ToolRestriction
  /**
   * Optional per-child persona. Requires {@link SubagentCapabilities.persona};
   * rejected at start otherwise. In-process backends register it as a scoped
   * `deployment:persona` section on the child, SHADOWING the deployment's
   * persona for this child alone — same template semantics as the deployment
   * persona (strict `{{…}}` interpolation against the registered variables).
   */
  readonly persona?: string
}
```

`signal` 是就緒前後唯一的取消通道。[subagent 組合控制 Agent Note](../../.agents/notes/implemented/feature/2026-07-12-subagent-persona-tool-filter-and-depth.md)規定 persona、live 全域性工具過濾、絕對深度以及「可見性而非權限」的設計理由。

面向呼叫方的請求不攜帶目錄格式細節或繼續執行狀態。`SubagentRuntime.start()` 會在能力檢查後解析分離的一次性描述符，再將以下面向提供方的請求傳給所選傳輸；可繼續子 agent 絕不會到達 `SubagentProvider.start()`：

```ts type-equiv
/**
 * Provider-facing one-shot request after {@link SubagentRuntime.start} resolves
 * the durable child descriptor.
 */
interface ResolvedSubagentStartRequest extends SubagentStartRequest {
  /** Detached descriptor a session-backed provider persists in the child log. */
  readonly descriptor: SubagentDescriptorData
}
```

## 可繼續子 agent 與啟用

**可繼續後臺 subagent** 是一份持久化子 agent 工作階段（Session），至多關聯一個行程內的 **Activation（啟用）**，即被重建的子 Agent 處於駐留狀態的時段。Activation 不是請求、結果、取消或 Task：它可以執行多個 FIFO 輪次，並在其建立的後代仍在執行期間保持駐留。繼續執行管理器負責 activation 准入、直接父級鑒權、即時所有權圖、冷復原（cold resume）與子級優先釋放；agent loop 負責一切輪次排序與執行。任何可繼續路徑都不會建立 Task，也不會建立承載中間結果的包裝層。

```text
persisted Session
  -> optional live Activation
       -> one retained AgentHandle
       -> Agent inbox as the only turn FIFO
       -> zero or more owned child Activations
```

`SubagentRuntime.startContinuable()` 會預留穩定的子 agent id，對版本化的 `subagent/descriptor` payload 建立快照，向指定提供方索取其分離的 `ContinuableCreateSpec`，透過私有的 activation-owner 作用域建立子 Agent，建立任何可繼續父級的所有權，並提交初始提示詞。當收件箱（inbox）准入產出訊息 id 時，它以 `{ childId, messageId }` resolve——無需等待輪次開始，也無需等待訊息進入工作階段日誌。在該准入之前的任何失敗都會以兩個 id 都不返回的方式 reject，並 dispose（資源釋放）任何已建立的 handle，回滾 Activation 與父級所有權。

`SubagentRuntime.followup()` 是唯一的繼續執行訊息操作，其路由僅取決於 Activation 的駐留狀態：

| Activation 狀態 | `followup` |
|---|---|
| `running` | 在同一 Activation 中入隊 |
| `waiting` | 喚醒同一 Activation |
| 無 Activation | 冷復原一個新的 Activation |

`running` 表示 Agent 擁有活躍的准入或輪次，或正在喚醒收件箱工作；`waiting` 表示它已完全靜止，但仍擁有至少一個尚未完成 dispose 的子 Activation；`settled` 表示已完全靜止且其擁有的每個子級都已 dispose，此時管理器會 dispose [`AgentHandle`](core.md#creation-and-ownership) 並移除該 Activation。管理器根據 Agent 的完全靜止狀態與其擁有的子級集合推導這些內部條件，而非維護第二套執行狀態機。

Agent 收件箱是唯一的佇列。每條繼續執行訊息都會成為一個 `Agent.followup()` FIFO 輪次，因此已接受的訊息共享同一個可觀測順序，且後續訊息無法改變已在進行中的輪次。投遞成功會返回被接受的 `MessageId`；既有的 `agent/inbox/inserted`、`agent/inbox/claimed` 與 `agent/inbox/discarded` 事件仍是訊息生命週期的觀測點，繼續執行層不定義任何 subagent 專屬的投遞路由。

後續操作的權限來自確切的線上 Agent 工具上下文。已驗證的 Agent 必須是持久化子 agent 在 `SessionHeader.parentSession` 中記錄的直接父級。`MessageSource` 與 `senderSessionId` 記錄誰提供了已准入的訊息，但不授予任何權限；選填的面向模型工具使用 `CoordinatorMessageSource`。

對於這兩種操作，呼叫方 signal 僅在收件箱接受之前掌管尋找、物化與准入。此後管理器獨立掌管該 Activation：之後的呼叫方取消既不會取消已接受的輪次，也不會 dispose 子 agent，並且該 seam 不對外暴露任何 steering（中途引導）操作。

`SubagentRuntime.interrupt(targetSessionId, authority)` 是唯一的公開停止操作：它同步完成鑒權，對線上目標寄出 `Agent.cancel(cause, { keepInbox: true })`，然後不等待完全靜止即返回。Activation、其尚未領取的待處理 inbox 工作與已發布的後代均不受影響；已被領取進入中斷輪次的工作不會重新入隊。被中斷的 driver 進入 idle 後，一次喚醒傳送會復原被暫停的 FIFO 佇列。不存在的目標——未知、一次性或已結帳——以及未綁定管理器的組合是被接受的 no-op。對線上目標，錯誤的 parent 地址或不在其線上祖先鏈中的呼叫方會以 `UNAUTHORIZED` 拒絕；過時的 ancestor 對象和指向自身的 ancestor 請求會在尋找目標前拒絕。

```ts type-equiv
/**
 * Authority under which one interrupt request is admitted. `user` carries the
 * durable direct-parent address a human client presented; `ancestor` carries
 * the exact live Agent object whose recorded lineage must contain the caller.
 */
type SubagentInterruptAuthority =
  | { readonly kind: 'user'; readonly parentSessionId: SessionId }
  | { readonly kind: 'ancestor'; readonly agent: Agent }
```

每個 Activation 都擁有自己的 `AgentHandle` 和一個 `ownedChildren: Set<SessionId>`；由於一份工作階段至多有一個存活 Activation，子工作階段 id 無需另一個執行時期化身引用即可標識存活的子 agent。啟動子 agent 或提交源自 parent 的工作，會在子 agent 能夠執行之前將其註冊到受繼續執行管理的父級集合中；只要該集合非空，該父級就無法 settle。頂層或其他非繼續執行的 Agent 沒有 Activation，處於 waiting 圖之外。只有當子 Agent 已完全靜止、該子 agent 的每個子級都已 dispose、best-effort 的最終工作階段 flush 結帳完畢，且子 agent 的 `AgentHandle` 完成 dispose 之後，才會釋放子 agent。

最終結帳會等待 `ctx.sessions.flush(session)`，但會忽略其參與布林值，因為任意 listener 都無法證明某個持久化後端已儲存該狀態。rejection 會被記錄，但不會使 Activation 失敗；管理器仍會 dispose 該 handle 並釋放所有權，此後持久化的子 agent 狀態在後續復原時可能缺失或過時。管理器解除安裝會呼叫內部的管理器全域性 drain，關閉准入並 dispose 每片線上森林；`drainContinuableDescendants(parents)` 只關閉由 host 確切擁有的線上 Agent 之下的准入，並 dispose 其可繼續後代，而無關森林保持線上。兩者都會等待各自作用域內已獲準的物化過程，自頂向下傳播取消，按 child-first 順序釋放 handle，並且即使個別分支失敗也會等待所有選中分支。持久化子工作階段不受該行程內拆卸的影響。

```ts type-equiv
/** Attribution for a model coordinator's follow-up to one of its children. */
interface CoordinatorMessageSource {
  readonly kind: 'coordinator'
  /** A message another agent addressed to this one (`relay` context form). */
  readonly form: 'relay'
  /** Session id of the agent whose tool call produced the follow-up. */
  readonly senderSessionId: SessionId
}
```

```ts type-equiv
/** Options for following up with one continuable child. */
interface SubagentFollowupOptions {
  /** Durable attribution retained on the delivered message; it grants no authority. */
  readonly source: MessageSource
  /** Caller cancellation, owning the operation only until inbox acceptance. */
  readonly signal: AbortSignal
}
```

```ts type-equiv
/** Identities returned once a continuable child accepted its initial prompt. */
interface ContinuableStart {
  /** The durable child session id, stable across activations. */
  readonly childId: SessionId
  /** The accepted initial prompt's inbox message id. */
  readonly messageId: MessageId
}
```

選填的可繼續 child 設定貢獻可以在 child 基礎組合完成後、Activation 發布前安裝限定在作用域內的能力。該登錄檔按順序執行且具有交易性：設定失敗或被撤銷時會回滾未發布的 Activation；child 作用域 dispose 時會釋放所有安裝；新註冊項在下一個 Activation 生效；移除註冊項時則會立即撤銷每個駐留中的安裝。

`SubagentRuntime.reportFrom()` 透過該擴充點實作報告，無需新增第二條佇列或承載結果的 child 包裝層。呼叫由確切的線上 child Agent 授權，呼叫方不能指定接收方。管理器從 child 的持久化 `parentSession` 中推導唯一接收方，要求該 parent Agent 必須線上，將選中內容封裝為一條 `subagent-report` 使用者訊息，並返回該訊息的穩定 `MessageId`。靜默投遞使用 `Agent.inject()`，不產生 inbox 條目實例或 parent 輪次；喚醒投遞使用 `Agent.followup()`，會產生一個普通的後續 parent 輪次。兩種模式都不會結束 child 輪次，最終回答也不會隱式報告。

```ts type-equiv
/** Durable attribution for a continuable child's explicit parent report. */
interface SubagentReportMessageSource {
  readonly kind: 'subagent-report'
  /** A message another agent addressed to this one (`relay` context form). */
  readonly form: 'relay'
  /** Session id of the reporting child. */
  readonly senderSessionId: SessionId
}
```

```ts type-equiv
/** Deployment scheduling policy for accepted child reports. */
type SubagentReportDelivery = 'quiet' | 'wakeup'
```

上報是 child 自己的選擇，因此管理器還保有一份屬於自己的記帳：當駐留 Activation 結帳時，它會向該 child 持久化的直接 parent 投遞一條通知，說明該 epoch 如何結束，並攜帶其最終 assistant 內容。對每個呼叫方拿到過 id 的 child，這條投遞都是無條件的；它發生在會讓 parent 被判定為已結帳的所有權釋放之前，並透過與上報相同的喚醒准入記帳到達駐留 parent。若 parent 自身所在的譜系已在拆卸中，這條通知會以不喚醒的方式送達，因為喚醒一個靜息 Agent 是開啟一個輪次，而不是排隊等待工作。其來源資訊使用一個獨立的 kind，因此 transcript（文字記錄）絕不會把執行時期的記帳呈現為 child 自己寫下的內容。

```ts type-equiv
/**
 * Durable attribution for the runtime's own account of a continuable child
 * settling. Deliberately a different kind from
 * {@link SubagentReportMessageSource}: a report is content the child chose,
 * while this message is the manager stating what became of the child, and a
 * transcript that merged them would credit the child with words it never wrote.
 */
interface SubagentSettledMessageSource {
  readonly kind: 'subagent-settled'
  /** A runtime account shown without expanding the row (`notice` context form). */
  readonly form: 'notice'
  /** One-line account of how the child ended. */
  readonly summary: string
  /** Session id of the child that settled. */
  readonly senderSessionId: SessionId
}
```

```ts type-equiv
/** Options for one continuable child's report to its direct parent. */
interface SubagentReportOptions {
  /** Already-resolved parent scheduling policy. */
  readonly delivery: SubagentReportDelivery
  /** Caller cancellation, owning authorization and admission until acceptance. */
  readonly signal: AbortSignal
}
```

提供方只參與準備初始建立 spec，`spawn` 與 `fork` 在此有所不同。其返回的 spec 只攜帶分離的、提供方專屬的建立輸入——目前是選填的父級歷史種子——不含 Agent、`AgentHandle`、提示詞投遞、結果、dispose 或復原操作。冷復原根本不經由提供方分發：管理器摺疊通用描述符，透過同一個 activation-owner 作用域呼叫 `ctx.agents.resume()`，並提交等待中的輪次。

```ts type-equiv
/**
 * What the continuation manager asks a provider for while materializing one
 * continuable child's FIRST activation. The manager has already reserved the
 * durable child identity and owns every later operation, so this request
 * carries only what distinguishes a fresh child from one seeded with parent
 * history.
 */
interface ContinuableCreateRequest {
  /** The reserved durable child session id, for provider diagnostics. */
  readonly sessionId: SessionId
  /** The delegating parent agent whose history a seeding provider reads. */
  readonly parent: Agent
  /**
   * Caller cancellation, which owns preparation only until the manager accepts
   * the initial prompt into the child's inbox.
   */
  readonly signal: AbortSignal
}
```

```ts type-equiv
/**
 * A provider's detached contribution to one continuable child's creation. This
 * is DATA, never a capability: it carries no Agent, `AgentHandle`, prompt
 * delivery, result, disposal, or resume operation, because the continuation
 * manager owns the child's whole lifecycle after preparation.
 */
interface ContinuableCreateSpec {
  /**
   * Completed-turn prefix of the parent's log to seed the child session with,
   * or absent for a fresh child. Same durable contract as
   * `CreateAgentOptions.seed`: contiguous from seq 0, lossless JSON, balanced.
   */
  readonly seed?: readonly SessionEvent[]
}
```

描述符（[descriptor.ts](../../packages/subagent/subagent/src/descriptor.ts) 中的 `SubagentDescriptorData`）是每個由工作階段支撐的 subagent 所使用、按模式判別的持久化身份。兩種模式都攜帶提供方名稱。`one-shot` 描述符可以攜帶呼叫方擁有的選填顯示 `label`；`continuable` 描述符要求以委派 `description` 作為持久化建立標籤，並另外對已解析的子 agent `agentOptions.provider`／`model` 與選填的 `persona`／`toolFilter` 建立快照，用於冷復原。它絕不會對可合併擴充的 `AgentOptions` 對象建立快照，因此無關的擴充值不會破壞繼續執行，後續新增組合設定輸入則是一次有意的版本更改。描述符省略 `subagentDepth`（冷復原以持久化 header 中的 `delegationDepth` 作為單調下界）和 `outputSchema`（單次執行或 Activation 的結果約定，而非持久化身份）。

本機一次性提供方會在子 agent 的初始輪次內、首次請求前追加描述符。繼續執行管理器會在任何提供方提供的譜系之後、初始提示詞獲準之前追加描述符；`header.seedLength` 仍是 fork 譜系邊界：復原時的描述符權威讀取子 agent 自身的後綴，而供清單使用的身份投影以 last-wins 摺疊 `subagent/descriptor`，子 agent 自己的描述符會覆蓋 fork seed 中祖先的描述符。該事件只進入日誌：不含 `surfaceOp`，絕不進入模型歷史，並由僅附加日誌跨壓縮保留。格式錯誤的當前版本描述符屬於損壞；本執行時期無法對不受支援的版本進行分類。

## 持久化枚舉：`listChildren()`、`listDescendants()` 與其條目

`SubagentRuntime.listChildren(parentSessionId)` 從 `ctx.sessions.list()` 與選填 `ctx.sessionPersistence.list()` 的即時優先合併中枚舉 parent 直接且由工作階段支撐的 subagent——不經查詢服務，也不會載入或復原任何 Agent。候選是持久 header 攜帶 `origin: 'subagent'` 的直接 child；該標記只負責枚舉分類與粗粒度的通用路由拒絕，不能證明描述符有效、child 可復原或操作已獲授權——身份由投影摺疊負責，復原由 Activation 約定負責。每行的 `mode`／`label` 是已註冊 `subagent` projection unit 的值，經三級階梯供值：存活 child 由登錄檔水位快取供值（零日誌讀取）；冷 child 先讀選填的投影 checkpoint 快取（`cachedSnapshot`——過 own-suffix seq 門的身份即定值，own descriptor 一經追加不可變）；否則在一次 `persistence.inspect()` 讀取上經登錄檔摺疊（有界並行，每次清單重新計算）。該快取是純選填加速層：服務缺席、行裡是 `null` 哨兵或 key 缺席、seq 門不過、讀取出錯，都靜默落到權威重摺。摺疊規則是 `subagent/descriptor` last-wins 且沒有失敗通道：子 agent 自己的描述符覆蓋 fork seed 中祖先的描述符，格式錯誤或版本不認識的載荷摺疊為可序列化的 `null` 哨兵，視同無值。結果是按 `createdAt`、再按 id 排序的 `SubagentListEntry[]`：取到身份即生成帶有 `mode: 'one-shot' | 'continuable'` 和 `activity: 'running' | 'inactive'` 的 `child` 條目；可繼續條目始終攜帶 `label`，一次性條目則只在啟動呼叫方提供展示中繼資料時攜帶該欄位。已定局而摺疊無身份的候選生成 `corrupt` diagnostic——缺失、格式錯誤與版本不認識的描述符有意不再細分（`unsupported` 仍保留在類型中但從不產出）；執行中而無身份的候選被省略（描述符落盤前的建立視窗）；冷檢查失敗生成一條 `unavailable` diagnostic 並在下次清單自然重試，因此一個損壞的 sibling 不會隱藏健康 child。`hasChildren` 標記存在持久 subagent origin 的直接後代，讀取自同一份合併材料。活動狀態只表示邏輯記錄是否在 `ctx.sessions` 中存活，而不表示結果或可復原性。缺少持久化時，枚舉退化為僅存活枚舉而不是報錯——此時冷 child 本就無法復原。缺少 `ctx.sessionProjections` 登錄檔時，`listChildren()` 拋出攜帶錯誤碼 `SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE` 的 `SubagentError`，缺少工作階段儲存時則拋出 `SUBAGENT_CONTROL_SESSION_STORE_UNAVAILABLE`，兩者都在任何讀取之前檢查，因此零 child 的部署同樣確定失敗；清單工具在外掛程式載入時要求 `ctx.subagents` 與 `ctx.agents`。UI 等服務消費端可以展示兩種模式，並為無標籤的一次性 child 選擇回退展示；面向模型的 `list_agents` 配接器（[dsh-tool-subagent-control](../../packages/subagent/tool-subagent-control) 中可單獨載入的 `/list-agents` 外掛程式）則只保留可繼續條目，並透過線上 Agent 登錄檔將狀態細化為自己的 `running`／`idle`／`ready` 詞彙，其中 `ready` 把僅存於儲存的 child 命名為可復原而非終態。枚舉不會查詢繼續執行管理器的 Activation map、Agent 登錄檔或提供方可用性；`send_message` 仍是訊息送達時的權威操作，清單中的執行中可繼續 child 仍可能因所有權衝突而拒絕投遞。讀路徑的設計理由見[清單身份投影 Agent Note](../../.agents/notes/implemented/architecture/2026-08-06-subagent-list-identity-projection.md)。

`SubagentRuntime.listDescendants(rootSessionId)` 將同一份即時優先語料與基於投影的解釋應用到根的完整後代樹，並按穩定 pre-order 輸出。普通工作階段和一次性 child 仍作為遍歷節點，因此其下的可繼續後代仍可發現；只有 `origin: 'subagent'` 的候選會生成條目。每個返回的 child 或 diagnostic 都從枚舉所得的持久 header 附加樹位置；冷檢查在提供身份前還會重新校驗完整生命週期：

```ts type-equiv
/**
 * One entry of a descendant listing: the interpreted subagent facts plus its
 * position in the complete session tree. `parentId` is the durable direct
 * parent from the enumerated header, and `depth` counts edges from the root.
 */
type SubagentDescendantListEntry = SubagentListEntry & {
  /** Durable direct parent of this candidate in the enumerated tree. */
  readonly parentId: SessionId
  /** Edge distance from the requested root; direct children are `1`. */
  readonly depth: number
}
```


## 終態結果：`SubagentResult`

單次 run 的最終產出，由 `SubagentRun.result` resolve。`structured` 僅在請求了 `outputSchema` 且成功滿足時才存在；請求 schema 不保證一定能得到它，當子 agent 失敗或結束時未產出有效 capture 時，提供方可能返回 `stopReason: 'error'`。非 `completed` 的 `stopReason` 意味著 `output` 可能不完整——消費端將其對映為 `isError` 的工具結果，而非將部分輸出報告為成功。

```ts type-equiv
/**
 * The terminal outcome of a subagent run, resolved by {@link SubagentRun.result}.
 */
interface SubagentResult {
  /**
   * The child's final assistant output is the content of its last non-empty
   * assistant message. Empty-content messages, including usage-only messages,
   * are skipped. Without a non-empty message, the output is its accumulated
   * assistant text stream, or `[]` when the child produced neither.
   */
  readonly output: ContentBlock[]
  /**
   * The structured result after a requested `outputSchema` was successfully
   * satisfied. Requesting a schema does not guarantee presence: a provider can
   * end with `stopReason: 'error'` when the child fails or finishes without a
   * valid capture. The structured value is validated against the requested
   * output schema by the provider; `unknown` here because the seam is
   * schema-agnostic.
   */
  readonly structured?: unknown
  /** Why the run ended. A non-`completed` reason means `output` may be partial. */
  readonly stopReason: SubagentStopReason
}
```

`SubagentStopReason` 是一個[可合併擴充的派生聯合類型](core.md#the-map--derived-union-pattern)——後端可以新增變體，因此消費端應對已知 case 分支處理，將未知的終態原因視為失敗：

```ts type-equiv
/**
 * Why a subagent run ended. Merge-extensible (a backend may add variants);
 * consumers branch on the known cases and fall through `default`. The known
 * cases mirror the harness turn-end vocabulary so the tool layer can map a
 * non-`completed` result to an `isError` tool result.
 */
interface SubagentStopReasonMap {
  /** The child finished its turn normally. */
  completed: 'completed'
  /** Cancelled through the request signal or disposal. */
  aborted: 'aborted'
  /** Model or transport failure. */
  error: 'error'
  /** The child hit its token ceiling before finishing. */
  'max-tokens': 'max-tokens'
  /** The child declined the task. */
  refusal: 'refusal'
}
```

## 單次 run：`SubagentRun`

`SubagentRun` 是消費端持有的、指向一個已發布單次子 agent 的控制代碼——一次可 dispose 的前臺委派，只有一個結果，絕不是持久化子 agent handle。發布後的提示詞提交、輪次工作與基礎設施故障歸 `result` 所有。消費端 await 該結果並始終 dispose 該 run，直至完全靜止。子 agent 失敗時以非 completed 的 stop reason resolve；只有無法表示的基礎設施故障才會 reject。run 沒有 steering，也沒有復原：可繼續對話根本沒有 run，因為繼續執行管理器直接持有它們的 `AgentHandle`，並透過子 agent 自己的收件箱為每個輪次排序。

```ts type-equiv
/**
 * ONE-SHOT child handle returned after publication. Prompt submission, turn
 * work, and infrastructure faults after that boundary belong to {@link result}.
 * Consumers await that result and must always {@link dispose} to cancel
 * remaining work and reach quiescence. A run is one disposable foreground
 * delegation with one result; continuable conversations have no run — the
 * continuation manager holds their `AgentHandle` directly and orders every
 * turn through the child's own inbox.
 */
interface SubagentRun {
  /**
   * Parent-scoped run id. For a local run, this MUST equal the published child
   * session id, whose `parentSession` records `request.parent.session.id`; a
   * remote provider mints an id unique in the parent namespace.
   */
  readonly id: SessionId
  /**
   * The exact published in-process child, or `undefined` for a remote run.
   * When present, its id is {@link id}; the provider retains no ownership
   * implication beyond the run's ordinary {@link dispose} contract.
   */
  readonly localAgent: Agent | undefined
  /**
   * Resolves with the child's terminal {@link SubagentResult} when the run
   * settles. Does NOT reject on a child-level failure — a model/transport
   * failure resolves with `stopReason: 'error'` so the consumer maps it to an
   * `isError` tool result. Rejects on an infrastructure fault the seam cannot
   * represent as a stop reason.
   */
  readonly result: Promise<SubagentResult>
  /**
   * Cancel remaining work, reach child quiescence, and release resources.
   * Idempotent.
   */
  dispose(): Promise<void>
}
```

本機單次 run 必須在 `start()` fulfill 之前發布一個普通子 agent／工作階段，將該子工作階段 id 作為 `SubagentRun.id` 返回，以 `localAgent` 暴露確切的子 agent，在子 agent 的 `parentSession` header 中記錄 `request.parent.session.id`，並在子 agent 的初始輪次內、首次請求前追加已解析的描述符。執行時期所有權可以把子 agent 放在 parent、提供方或 root 作用域下。遠端提供方則返回 parent 作用域的生命週期 id 與 `localAgent: undefined`；由於沒有本機 child Session，它不會出現在持久化枚舉結果中。

<a id="the-provider-contract-subagentprovider"></a>

## 提供方約定：`SubagentProvider`

每個提供方都是一個具名的子 agent 傳輸層，多個提供方可以共存。服務在 `start()` 之前校驗請求的啟動時能力，並拒絕在沒有 `prepareContinuable` 的提供方上發起可繼續 start。`inheritsParentContext` 僅描述對話種子注入（`fork`：true；`spawn` 和 `acp`：false），使消費端能生成準確的面向模型措辭，而不暗示繼承了工具、服務或權限。

```ts type-equiv
/**
 * One registered transport for running child agents. Providers are trusted
 * same-process implementations; callers treat descriptors and returned values
 * as borrowed immutable data. The service may call one provider concurrently
 * for distinct children. Providers isolate operation-local mutable state; a
 * shared capacity controller may delay an operation but must not couple its
 * settlement or cleanup to a sibling.
 */
interface SubagentProvider {
  /** Unique registry name (e.g. `spawn`, `fork`, `acp`). */
  readonly name: string
  /** The start-time features this provider supports (see {@link SubagentCapabilities}). */
  readonly capabilities: SubagentCapabilities
  /**
   * Whether the child sees the parent's completed-turn prefix. This is descriptive, not a
   * service-validated start capability: the model-facing tool derives truthful wording from it.
   * It says nothing about tool registration, injected services, or authority inheritance.
   */
  readonly inheritsParentContext: boolean
  /**
   * Establish a ONE-SHOT child and return its handle after publication.
   * The service has already validated that every requested start-time
   * capability is supported and resolved `request.descriptor`, so a
   * session-backed implementation appends that descriptor inside the child's
   * initial turn. Before fulfillment, the provider owns setup and cleans any
   * unpublished partial resources before rejecting. Ownership transfers on
   * fulfillment; subsequent turn or infrastructure failure settles through
   * the returned run. Distinct starts may overlap; cancellation, failure,
   * result settlement, and disposal remain independent for each run.
   */
  start(request: ResolvedSubagentStartRequest): Promise<SubagentRun>
  /**
   * OPTIONAL (continuable-creation capability): contribute the detached
   * creation inputs that distinguish this provider's continuable children —
   * only whether the child session is seeded with parent history. Method
   * presence IS the capability: the service rejects continuable starts on
   * providers without it, while a provider that has it may still serve
   * ordinary one-shot delegations.
   *
   * This is the provider's ONLY participation in a continuable child. The
   * continuation manager owns identity reservation, composition, Agent
   * creation, prompt delivery, cold resume, ownership, and disposal, so a
   * provider never sees the child's Agent, handle, turns, or teardown.
   * Distinct preparations may overlap; each follows its own signal and returns
   * data belonging only to `request.sessionId`.
   */
  prepareContinuable?(request: ContinuableCreateRequest): Promise<ContinuableCreateSpec>
}
```

提供方的 `start()` 會以已發布的 run fulfill。服務鑄造唯一的 `runId`，從提供方確切的 `localAgent` 快照 `local`，觀察結果，emit `subagent/start`，並返回同一個 run；`start()` rejection 意味著未發布資源已清理，且不會 emit 生命週期事件對，而發布後的結果 rejection 會結束已經 emit 的事件對。每個可繼續 Activation 都會為其駐留紀元 emit 相同的僅觀察事件對，因此一次冷復原就是一段擁有自己 `runId` 的新紀元。配對的 `subagent/end` 攜帶相同標識與最終輸出或基礎設施失敗。兩個事件都僅用於觀察，且會隔離各自的 listener 例外。其中的 `provider` 欄位標明瞭啟動 run 或 Activation 時段的提供方，並不聲明該 edge 寄出時提供方仍處於註冊狀態。

## 行程內後端：深度與種子

spawn 和 fork 後端透過 `parent.ctx` 建立一個普通的單次 agent，將取消訊號傳入核心建立流程，並透過 `AgentHandle` 進行 dispose；而可繼續子 agent 則由繼續執行管理器透過其自己的 activation-owner 作用域建立。移除提供方會阻止新的 start，但不會撤銷已接受的 run。每個子 agent 獲得一個新的扁平作用域，而非繼承父級註冊。深度與 fork 種子注入複用既有的 agent 和工作階段詞彙：

- **委派深度**由持久 `SessionHeader.delegationDepth` 與可合併擴充的執行時期欄位 `AgentOptions.subagentDepth` 共同表示；缺失表示頂層深度為零，存在的較大值具有權威性。兩個欄位都歸該 seam 所有——迴圈既不設定也不讀取它們——因此行程內子 agent 會持久保存 parent 深度 + 1，冷復原無法降低深度，而且每次 start 都會拒絕超出安全整數域、或高於已定義絕對 `request.maxDepth` 上限的派生深度。
- **Fork 種子注入**使用 [`CreateAgentOptions.seed`](core.md#creation-and-ownership)（一個 `SessionEvent[]` 前綴，經由 `AgentLoop.createAgent` → `ctx.sessions.prepare({ seed })` 傳遞，與 `ctx.agents.resume()` 使用的原語相同）。fork 後端傳入父級日誌的一段*平衡的已完成輪次前綴*——父級事件直到並包括其最後一個 `turn/end`——因此種子從 0 連續，[invariants](../../packages/runtime-diagnostics/invariants) 重播可以接受它（進行中的、未平衡的輪次被排除在外）。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsubagents--subagentruntime"></a>

### `ctx.subagents` — `SubagentRuntime`

Named provider registry with one-shot runs, durable discovery, and continuable-child operations.

```ts cordis-catalog
/**
 * Establish one durable continuable child and deliver its initial prompt.
 * Resolves when the child's inbox accepts that prompt, without waiting for the
 * turn to start or for the message to reach the Session log; any earlier
 * failure rejects with no ids and rolls back the child entirely.
 * @param spec - provider, delegation request, and caller cancellation.
 * @returns the durable child id and the accepted prompt's message id.
 * @throws when continuation services are unavailable or materialization fails.
 */
async startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>

/**
 * Deliver one later message to a continuable child as its next FIFO turn. A
 * resident child's Agent inbox accepts it directly (waking a `waiting`
 * Activation), while an absent one is cold-resumed from its persisted
 * Session. The Agent inbox is the only queue, so every accepted message has
 * one observable order.
 * @param parent - the exact live direct parent authorizing this delivery.
 * @param childId - durable child session id.
 * @param content - user-role content to deliver.
 * @param options - the message source fields and caller cancellation, which stops the
 *   operation only before inbox acceptance.
 * @returns the accepted message's inbox id.
 * @throws when continuation services are unavailable, parent authority is
 *   rejected, or the message was not admitted.
 */
async followup( parent: Agent, childId: SessionId, content: ContentBlock[], options: SubagentFollowupOptions, ): Promise<MessageId>

/**
 * Interrupt one live continuable child's current turn under a human parent
 * address or an exact live ancestor Agent. Fire-and-return: the cancel
 * signal is issued before this returns, but the target may keep running
 * until it observes the signal. Unclaimed pending inbox work, the Activation,
 * and published descendants are preserved; claimed work is not requeued.
 * Once the interrupted driver is idle, a waking send resumes the parked FIFO
 * queue. An absent target — including a one-shot or unknown id —
 * is an accepted no-op, as is a manager-less composition, which cannot own a
 * live Activation.
 * @param targetSessionId - the durable child session id to interrupt.
 * @param authority - the human parent address or exact live ancestor Agent.
 * @throws {SubagentError} `UNAUTHORIZED` when the authority does not own the
 *   live target.
 */
interrupt(targetSessionId: SessionId, authority: SubagentInterruptAuthority): void

/**
 * Deliver selected content from one live continuable child to its durable
 * direct parent. The child is the authority credential; callers cannot name a
 * recipient. Reporting does not conclude the child's turn or Activation.
 * @param child - exact live reporting child.
 * @param content - selected model-facing content.
 * @param options - parent scheduling and pre-acceptance cancellation.
 * @returns the stable identity of the parent-accepted message.
 * @throws when continuation services are unavailable, sender authorization
 *   fails, or the direct parent is not live.
 */
async reportFrom( child: Agent, content: ContentBlock[], options: SubagentReportOptions, ): Promise<MessageId>

/**
 * Compose one deployment capability into every continuable child's
 * unpublished creation context on fresh creation and cold resume. Grants wait
 * for the next Activation; removing the contribution revokes every resident
 * installation immediately.
 * @param contribution - synchronous child-scope installer.
 * @returns the exact Cordis effect disposer.
 */
registerContinuableSetup(contribution: ContinuableSetupContribution): () => void

/**
 * Close continuable admission below exact live parent Agents, stop only their
 * visible descendant Activations synchronously, then await admitted scoped
 * materializations and release those forests child-first. The scoped cutoff
 * lasts until each exact parent leaves the registry; unrelated parent trees
 * remain live.
 * @param parents - exact host-owned parent Agents entering teardown.
 * @returns once every retained descendant Activation released its `AgentHandle`.
 * @throws an aggregate error after all branches settle when any failed.
 */
async drainContinuableDescendants(parents: readonly Agent[]): Promise<void>

/**
 * Enumerate the parent's direct session-backed subagents without loading or
 * resuming an Agent and without any query service: the listing merges the live
 * session store with optional session persistence (live-preferred) and
 * serves each child's durable mode/label from the registered `subagent`
 * projection unit down a three-rung ladder — the registry's watermark
 * snapshot for a live child; for a cold one, a durable projection-cache
 * row when the optional cache serves an own-suffix identity (its `seq`
 * gate proves the value postdates the fork seed, where a child's own
 * descriptor is immutable once appended), else one persistence inspection
 * folded through the registry. The
 * projection fold is the single classification authority; per-child
 * diagnostics relay a fold that served no identity or a failed inspection,
 * never a list-time descriptor parse. Absent persistence, enumeration is
 * live-only (a cold child cannot be resumed then either, so its absence is
 * capability absence, not an error). This service consults no Agent
 * registrations, Activations, or providers.
 *
 * Every persistence read receives `signal`, and the listing rechecks
 * cancellation around each of those awaits. Read rejections that settle
 * after an abort become a stable `SubagentError` with code `CANCELLED`.
 * @param parentSessionId - parent session whose direct children are listed.
 * @param signal - caller-owned cancellation forwarded to persistence reads
 *   and observed around every read await.
 * @returns children and per-child diagnostics ordered by `createdAt`, then id.
 * @throws {@link SubagentError} when the projection registry or the session
 *   store is not mounted, or the caller cancels the listing.
 */
listChildren(parentSessionId: SessionId, signal?: AbortSignal): Promise<SubagentListEntry[]>

/**
 * Enumerate the root's complete session-backed subagent tree in stable
 * pre-order from one live-preferred corpus, without loading or resuming an
 * Agent. Ordinary sessions and one-shot children remain traversal nodes so
 * continuable descendants below them are discovered; each returned entry
 * adds its durable `parentId` and root-relative `depth`. Identity resolution,
 * diagnostics, optional persistence, and cancellation follow the same
 * projection-backed contract as {@link listChildren}.
 * @param rootSessionId - session whose complete descendant tree is listed.
 * @param signal - caller-owned cancellation forwarded to persistence reads
 *   and observed around every read await.
 * @returns children and per-candidate diagnostics with tree position, in
 *   stable pre-order.
 * @throws {@link SubagentError} under the same conditions as {@link listChildren}.
 */
listDescendants(rootSessionId: SessionId, signal?: AbortSignal): Promise<SubagentDescendantListEntry[]>

/**
 * Register a provider under its name. Registration is effect-scoped and HMR
 * safe; removing a provider blocks new starts but does not revoke runs that
 * were already returned to their holders.
 * @param provider - the trusted provider implementation.
 * @returns the exact Cordis effect disposer.
 */
registerProvider(provider: SubagentProvider): () => void

/**
 * Look up a provider by name.
 * @param name - the provider name.
 * @returns the provider, or undefined when absent.
 */
getProvider(name: string): SubagentProvider | undefined

/**
 * List registered provider names in insertion order.
 * @returns the registered names.
 */
list(): string[]

/**
 * Establish a published child on the named provider. Capability and semantic
 * checks run before delegation. Provider ownership lasts until its promise
 * fulfills; a rejection therefore has no run for the caller to dispose and
 * emits no run lifecycle events. Post-publication turn and infrastructure
 * failures settle through the returned run.
 * @param name - the provider to use.
 * @param request - child label, prompt, parent, signal, and optional capabilities.
 * @returns the published holder-owned run.
 */
async start(name: string, request: SubagentStartRequest): Promise<SubagentRun>
```

Types: [Agent](core.md) · [ContentBlock](llm-streaming.md) · [MessageId](llm-streaming.md) · [SessionId](core.md)

Source: [`packages/subagent/subagent/src/index.ts:171`](../../packages/subagent/subagent/src/index.ts)

<a id="subagent-events"></a>

### `subagent/*` events

<a id="subagentend--emit"></a>

#### `subagent/end` — emit

A published child settled. Scope-filtered dispatch uses the same delegating parent carrier as `subagent/start`, so the lifecycle pair reaches the same scoped audience.

```ts cordis-catalog
/**
 * A published child settled. Scope-filtered dispatch uses the same delegating
 * parent carrier as `subagent/start`, so the lifecycle pair reaches the
 * same scoped audience.
 * @param info - the run identity and terminal outcome.
 * @dshScopeScan unsupported
 * @mode emit
 */
'subagent/end'(this: Scoped<SubagentRuntime>, info: SubagentRunEndInfo): void
```

Types: [Scoped](scope.md)

Source: [`packages/subagent/subagent/src/index.ts:166`](../../packages/subagent/subagent/src/index.ts)

<a id="subagentprovider-added--emit"></a>

#### `subagent/provider-added` — emit

A provider became resolvable in the registry.

```ts cordis-catalog
/**
 * A provider became resolvable in the registry.
 * @param provider - the registered provider.
 * @mode emit
 */
'subagent/provider-added'(provider: SubagentProvider): void
```

Source: [`packages/subagent/subagent/src/index.ts:140`](../../packages/subagent/subagent/src/index.ts)

<a id="subagentprovider-removed--emit"></a>

#### `subagent/provider-removed` — emit

A provider left the registry. Accepted runs remain holder-owned.

```ts cordis-catalog
/**
 * A provider left the registry. Accepted runs remain holder-owned.
 * @param name - the provider name that no longer resolves.
 * @mode emit
 */
'subagent/provider-removed'(name: string): void
```

Source: [`packages/subagent/subagent/src/index.ts:146`](../../packages/subagent/subagent/src/index.ts)

<a id="subagentstart--emit"></a>

#### `subagent/start` — emit

A provider established a published child. For in-process providers, `ctx.agents.get(info.id)` resolves during this notification. Scope-filtered dispatch keys the carrier by the delegating parent, so a parent-scoped listener observes only its own delegations. Paired with `subagent/end`.

```ts cordis-catalog
/**
 * A provider established a published child. For in-process providers,
 * `ctx.agents.get(info.id)` resolves during this notification.
 * Scope-filtered dispatch keys the carrier by the delegating parent, so a
 * parent-scoped listener observes only its own delegations. Paired with
 * `subagent/end`.
 * @param info - the provider and published child identity.
 * @dshScopeScan unsupported
 * @mode emit
 */
'subagent/start'(this: Scoped<SubagentRuntime>, info: SubagentRunInfo): void
```

Types: [Scoped](scope.md)

Source: [`packages/subagent/subagent/src/index.ts:157`](../../packages/subagent/subagent/src/index.ts)
<!-- END GENERATED cordis-surface -->
