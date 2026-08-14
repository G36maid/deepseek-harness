# 工作流程

[English](workflow.md) | [简体中文](workflow.zh.md) | 繁體中文

工作流程 seam 允許 agent（代理）執行由模型編寫、會啟動 subagent 的編排指令碼。與 [subagent](subagent.md) 一樣，它是**一項選填能力**，不屬於 agent loop，因此其類型和操作記錄在此處，而非 [core.md](core.md)。與 bash 一樣，每個上下文只允許一個引擎實作提供 `ctx.workflowEngine`；沒有命名提供方登錄檔（第二個引擎透過外掛程式設定替換第一個，而不與它同時執行）。

Service Definition：[dsh-workflow](../../packages/workflow/workflow)（`ctx.workflowEngine` + 下文詞彙）。Service Provider 是 [dsh-workflow-worker-thread](../../packages/workflow/workflow-worker-thread)（一個 `node:worker_threads` 引擎——每個 run 一個 worker，指令碼的 vm 上下文位於其中）；面向模型的 Consumer 是 [dsh-tool-workflow](../../packages/workflow/tool-workflow)。提案與設計理由見 [dynamic-workflows Agent Note](../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md)。

原始碼：瀏覽器安全詞彙位於 [`packages/workflow/workflow/src/types.ts`](../../packages/workflow/workflow/src/types.ts)，Host 請求與活躍執行控制代碼位於 [`runtime-types.ts`](../../packages/workflow/workflow/src/runtime-types.ts)。

## 啟動請求

本節定義呼叫方啟動一次執行時期提交的請求。普通工作流程工具會根據模型的 `{ script, meta, args }` 呼叫和發起呼叫的 agent 建置該請求；專用消費端還可以為本次執行選擇引擎級 `subagentProvider`，並將 `maxTotalAgents` 調低，但指令碼無法觀察或替換這兩項策略。`meta` 與 `args` 是普通 JSON 資料；引擎會用 schema 校驗 `meta`，並在任何工作開始前明確報錯並拒絕無效資料。引擎絕不會透過對指令碼文字求值來取得它們。`parent` 是必填欄位——指令碼啟動的每個子 agent 都歸屬於它，cwd、譜系與深度透過 [subagent seam](subagent.md) 傳遞。

```ts type-equiv
/**
 * What a caller asks for when starting a workflow run. `meta` and `args` are
 * plain JSON data by the seam contract. `parent` is required because every
 * `agent()` spawned by the script is attributed to that live Agent.
 */
interface WorkflowStartRequest {
  /** The plain-JS script body (top-level await allowed; ends with `return <json-value>`). */
  script: string
  /** The workflow's identity block, as plain JSON data (shape-validated by the engine). */
  meta: WorkflowMeta
  /** Optional input exposed verbatim to the script as the `args` global. */
  args?: unknown
  /** Optional engine-wide child-provider override for this run. */
  subagentProvider?: string
  /** Optional per-run total-child ceiling. */
  maxTotalAgents?: number
  /** The agent on whose behalf the run executes (parent of every child). */
  parent: Agent
  /** Cancels the run when aborted. */
  signal?: AbortSignal
}
```

## 工作流程的身份標識：`WorkflowMeta`

作為資料附在啟動請求上的身份塊（工具的 `meta` 參數；欄位詞彙與 Claude Code 動態工作流程的 meta 塊一致）。`phases` 僅用於進度展示：`phase()` 呼叫與標題匹配，供觀察者使用；不暗示任何執行結構。

```ts type-equiv
/**
 * The script's identity block, provided as plain JSON data alongside the
 * script body (the model-facing tool carries it as its `meta` parameter) and
 * validated by the engine before the body runs. `name`/`description` are
 * required; the rest is optional annotation. The field vocabulary matches the
 * Claude Code dynamic-workflows meta block.
 */
interface WorkflowMeta {
  /** Short kebab-case workflow name (display + persistence key). */
  name: string
  /** One-line description of what the workflow does. */
  description: string
  /** Optional guidance on when this workflow applies (shown in listings). */
  whenToUse?: string
  /** Optional phase declarations matched by `phase()` calls. */
  phases?: WorkflowPhase[]
}
```

## 終態結果：`WorkflowResult`

`WorkflowRun.result` 會兌現為一次執行的結果。`value` 是指令碼的物化回傳值——純宿主域 JSON 資料（指令碼無回傳值時為 `null`）——僅在 `completed` 時有意義。`stopReason` 是封閉聯合類型（由引擎定義；消費端可窮舉）：`completed` | `cancelled` | `error`。非 `completed` 的原因在 `error` 中攜帶失敗資訊，消費端將其對映為 `isError` 工具結果，而非把部分輸出當作成功上報。

```ts type-equiv
/**
 * The outcome resolved by a live workflow run. `value` is
 * the script's materialized return value (plain host-realm JSON data; `null`
 * when the script returned `undefined`) — meaningful only for `completed`.
 * A non-`completed` reason carries the failure in `error`; the consumer maps
 * it to an `isError` tool result rather than reporting partial output.
 */
interface WorkflowResult {
  /** The script's return value (host JSON data; `null` for no return). */
  value: unknown
  /** Why the run settled. */
  stopReason: WorkflowStopReason
  /** The failure message (present iff `stopReason` is not `completed`). */
  error?: string
  /**
   * How many `agent()` calls the run accepted over its whole lifetime. On a
   * graceful settlement this is the script-side count (calls still queued for
   * a concurrency slot included); on a termination path (grace force-settle,
   * worker death) it degrades to the host-observed count — calls queued
   * inside a terminated script are unknowable then.
   */
  agentsStarted: number
}
```

## 活躍執行：`WorkflowRun`

指令碼執行期間消費端持有的控制代碼。消費端會等待 `result`，可以在執行期間呼叫 `cancel`，並且必須在每條路徑上呼叫 `dispose`（資源釋放）。`result` 不會被拒絕：指令碼失敗會兌現為 `stopReason: 'error'`。執行被取消後，即使指令碼本身永不結帳，結果也會在引擎規定的有界寬限期內結帳；引擎會強制將其結帳為 `cancelled`，隨後 worker-thread 引擎會終止指令碼所在的 worker。因此，等待 `result` 的消費端不會在取消後無限期掛起。`dispose()` 會執行取消、等待有界結帳並等待子 agent 完全靜止，不會因指令碼卡死而掛起。

```ts type-equiv
/**
 * Holder-owned live workflow. `result` never rejects; consumers may cancel
 * and must call idempotent `dispose()` to await script and child quiescence.
 */
interface WorkflowRun {
  readonly id: WorkflowRunId
  /** The validated meta block available before the script body runs. */
  readonly meta: WorkflowMeta
  readonly result: Promise<WorkflowResult>
  /** Cancel the run and its children. */
  cancel(reason?: string): void
  /** Cancel if needed and await bounded settlement and cleanup. */
  dispose(): Promise<void>
}
```

## 失敗紀律：`WorkflowError.fatal`

指令碼內部的掛鉤誤用：錯誤參數、未知或延遲的 `agent()` 選項、超出[結構化輸出子集](../../packages/core/tools/README.md)的 schema、超出上限、seam 啟動失敗、取消，都會拋出 `fatal: true` 的 `WorkflowError`。`parallel()`/`pipeline()` 組合器對 fatal 錯誤直接重新拋出，而非將該項對映為 `null`：一個拼寫錯誤的選項必須明確報錯並終止指令碼，絕不能消融為看似普通子 agent 失敗的結果。逐項的 `null` 保留給子執行失敗（非 `completed` 的 stop reason）和階段內的普通指令碼錯誤。

## 事件

`workflow/*` 事件（`workflow/start`、`workflow/phase`、`workflow/log`、`workflow/agent-start`、`workflow/agent-end`、`workflow/end`，見[事件目錄](#cordis-surface)）是**僅供觀察**的 emit，攜帶資料快照：每個 payload 以 `WorkflowRunInfo`（id + meta）開頭，而非活躍的 `WorkflowRun`，因此訂閱者無法獲得 `cancel`/`dispose`；`workflow/end` 刻意省略 result value（觀察結果的監聽器不得收到呼叫方 result 的可變別名）。每次 emit 對每個監聽器隔離：訂閱者拋出的例外會被記錄到日誌中而不會傳播，也不會阻止後續註冊的監聽器收到事件；每個監聽器收到自己的 payload 克隆，因此修改它既不會損壞引擎也不會影響其他監聽器。這種隔離方式與 `subagent/start`/`subagent/end` 一致。

## 持久 Chat 記錄

頂層 `dsh-tool-workflow` 消費端把展示事實投影到呼叫它的父 Session，同時不改變執行所有權。執行接受後寫 `tool-workflow/run-start`，以 `runId + seq` 配對成員開始與結束，並且只在結果已取得且 dispose 完全靜止後寫 `tool-workflow/run-end`。巢狀 transport 呼叫不寫記錄。第一次 append 失敗會停用本執行後續寫入，因此日誌保持為空或合法連續前綴，工具結果不變。

`dsh-tool-workflow/invariant` 會在即時提交前和 Session 載入時校驗同一協議：每個執行只有一個 start，成員序號為正且唯一，成員 end 必須配對，仍有開放成員時不能結束執行，執行結束後不能繼續更新。日誌尾部缺少成員 end 或 run end 是有效的中斷證據，不是損壞。

`dsh-client-ui-workflow-run` 透過 Conversation Node 引擎把四類事件摺疊為一個 `workflow-run` Chat 節點，以 run-start 序號錨定在原工作流程工具節點之後。階段組只來自真正開始過的成員，並保留精確字串，包括欄位預設與 `''` 的區別。Location 關閉時，缺失終點會顯示為已中斷。[介面包 README](../../packages/client/ui-workflow-run/README.md)負責定義 disclosure、狀態與同父本機導覽行為。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxworkflowengine--workflowengine-abstract-seam"></a>

### `ctx.workflowEngine` — `WorkflowEngine` (abstract seam)

Workflow Service Definition contract. Invalid requests throw before publication; a live run is holder-owned, its result never rejects, cancellation and disposal are bounded, and disposal waits for child cleanup within that bound. Lifecycle listener failures are contained, and `workflow/end` fires exactly once as the result settles.

```ts cordis-catalog
/**
 * Parse and execute a workflow script.
 * @param request - the script, its `args`, the parent agent, and an
 *   optional cancel signal.
 * @returns the live run; its `result` resolves when the script settles.
 */
abstract start(request: WorkflowStartRequest): WorkflowRun
```

Source: [`packages/workflow/workflow/src/index.ts:157`](../../packages/workflow/workflow/src/index.ts)

<a id="workflow-events"></a>

### `workflow/*` events

<a id="workflowagent-end--emit"></a>

#### `workflow/agent-end` — emit

One `agent()` call settled (clean result, child failure, or run cancellation). Paired with Events['workflow/agent-start'] by `agent.seq`, exactly once per started call on every stop path — on an engine termination path (a worker killed past its grace) the end is engine-synthesized with outcome `'cancelled'`.

```ts cordis-catalog
/**
 * One `agent()` call settled (clean result, child failure, or run
 * cancellation). Paired with {@link Events['workflow/agent-start']} by
 * `agent.seq`, exactly once per started call on every stop path — on an
 * engine termination path (a worker killed past its grace) the end is
 * engine-synthesized with outcome `'cancelled'`.
 * @param info - the run's identity snapshot.
 * @param agent - the call identity plus its outcome.
 * @mode emit
 */
'workflow/agent-end'(info: WorkflowRunInfo, agent: WorkflowAgentEndInfo): void
```

Source: [`packages/workflow/workflow/src/index.ts:79`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowagent-start--emit"></a>

#### `workflow/agent-start` — emit

One `agent()` call established a published child run. Paired with Events['workflow/agent-end'] by `agent.seq`. A call that never receives a published run from the provider emits neither event in this pair.

```ts cordis-catalog
/**
 * One `agent()` call established a published child run. Paired with
 * {@link Events['workflow/agent-end']} by `agent.seq`. A call that never
 * receives a published run from the provider emits neither
 * event in this pair.
 * @param info - the run's identity snapshot.
 * @param agent - the call's sequence number, label, phase, and child id.
 * @mode emit
 */
'workflow/agent-start'(info: WorkflowRunInfo, agent: WorkflowAgentInfo): void
```

Source: [`packages/workflow/workflow/src/index.ts:68`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowend--emit"></a>

#### `workflow/end` — emit

A workflow run settled (any stop reason). Fired when WorkflowRun.result resolves. Paired with Events['workflow/start'].

```ts cordis-catalog
/**
 * A workflow run settled (any stop reason). Fired when
 * {@link WorkflowRun.result} resolves. Paired with
 * {@link Events['workflow/start']}.
 * @param info - the run's identity snapshot.
 * @param result - the outcome data (stop reason, error, agent count) —
 *   deliberately WITHOUT the result value (see {@link WorkflowResultInfo}).
 * @mode emit
 */
'workflow/end'(info: WorkflowRunInfo, result: WorkflowResultInfo): void
```

Source: [`packages/workflow/workflow/src/index.ts:89`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowlog--emit"></a>

#### `workflow/log` — emit

The script emitted a narration line (a `log(message)` call).

```ts cordis-catalog
/**
 * The script emitted a narration line (a `log(message)` call).
 * @param info - the run's identity snapshot.
 * @param message - the logged message, verbatim.
 * @mode emit
 */
'workflow/log'(info: WorkflowRunInfo, message: string): void
```

Source: [`packages/workflow/workflow/src/index.ts:58`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowphase--emit"></a>

#### `workflow/phase` — emit

The script entered a phase (a `phase(title)` call) — progress grouping for observers; no execution semantics.

```ts cordis-catalog
/**
 * The script entered a phase (a `phase(title)` call) — progress grouping
 * for observers; no execution semantics.
 * @param info - the run's identity snapshot.
 * @param title - the phase title, verbatim.
 * @mode emit
 */
'workflow/phase'(info: WorkflowRunInfo, title: string): void
```

Source: [`packages/workflow/workflow/src/index.ts:51`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowstart--emit"></a>

#### `workflow/start` — emit

A workflow run started — the script's meta block validated, the body about to execute. Paired with Events['workflow/end'].

```ts cordis-catalog
/**
 * A workflow run started — the script's meta block validated, the body
 * about to execute. Paired with {@link Events['workflow/end']}.
 * @param info - the run's identity snapshot (id + meta).
 * @mode emit
 */
'workflow/start'(info: WorkflowRunInfo): void
```

Source: [`packages/workflow/workflow/src/index.ts:43`](../../packages/workflow/workflow/src/index.ts)
<!-- END GENERATED cordis-surface -->
