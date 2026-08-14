# 工具

[English](tools.md) | [简体中文](tools.zh.md) | 繁體中文

[dsh-tools](../../packages/core/tools) 的工具管線。[core.md](core.md) 介紹了核心包共用、用於編寫管線的類型 `ToolDefinition`；面向模型的 [`ToolSchema`](llm-streaming.md#the-model-request-and-result) 協定類型與模型請求一起聲明。本頁記錄 `ToolDefinition` 的每個欄位、用於建置它的類型化 schema DSL、帶守衛的執行類型和 UI 展示類型。

原始碼：[`packages/core/tools/src/index.ts`](../../packages/core/tools/src/index.ts) · [`packages/core/tools/src/schema.ts`](../../packages/core/tools/src/schema.ts) · [`packages/core/tools/src/presentation.ts`](../../packages/core/tools/src/presentation.ts)

## `ToolDefinition` — 一個已註冊的工具

由一個 `ToolSchema`（面向模型的欄位）、必需的規範輸出聲明、`execute` 函式、僅供宿主使用的調度器中繼資料、選填的最終內容回呼和選填 UI 展示函式組成。登錄檔持有這些定義，迴圈透過它們分派呼叫。登錄檔的 `schemas()` 透過顯式允許清單建置面向模型的 `ToolSchema[]`；`output`/`execute`/`finalizeContent`/`timeoutMs`/`isConcurrencySafe`/`presentCall`/`presentResult` 絕不能洩漏到模型請求中。

```ts type-equiv
/** Tool-owned canonical output contract used after the body returns a JSON value. */
interface ToolOutputDefinition {
  /** Raw supported JSON Schema enforced against every successful canonical value. */
  readonly schema: JsonSchemaNode
  /** Pure projection from validated arguments and value to Native/model content. */
  render(args: unknown, value: JsonValue): ContentBlock[]
  /** Pure replayable presentation projection, computed only for top-level calls. */
  presentationMeta?(args: unknown, value: JsonValue): JsonValue
}
```

```ts type-equiv
/** A registered tool: its schema plus the execution function. */
interface ToolDefinition extends ToolSchema {
  /** Mandatory canonical output declaration. */
  readonly output: ToolOutputDefinition
  /**
   * Run one accepted call and return only its canonical lossless-JSON value.
   * Async work must observe or forward `exec.signal` and settle only after its
   * owned work reaches quiescence. The registry preserves caller cancellation
   * through around-dispatch signal replacement and does not abandon this
   * promise, but it cannot hard-kill same-process code.
   * @param args - losslessly snapshotted, frozen model arguments.
   * @param exec - execution identity, cancellation signal, and context deferral.
   * @returns the canonical value declared by `output.schema`.
   */
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  /**
   * Synchronous last-mile transform for model-facing content. The registry
   * snapshots this callback when execution starts and invokes it exactly once
   * for every normalized outcome, including pipeline failures that bypass
   * `tools/post-execute`, immediately before lossless materialization.
   * Returning `undefined` preserves the content; every other result field
   * remains registry-owned. The callback must be total and must not throw.
   * @param exec - immutable execution identity and arguments.
   * @param result - complete normalized outcome before materialization.
   * @returns replacement content, or `undefined` to preserve it.
   */
  finalizeContent?(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): ContentBlock[] | undefined
  /**
   * Cooperative tool-call timeout budget in milliseconds. Omit for no deadline.
   * Enforced by `@deepseek-ai/dsh-tool-call-timeout-policy` (a `tools/execute` wrapper); it
   * is NEVER sent to the model — `schemas()` whitelists only name/description/
   * parameters. Declaring it asserts this tool forwards `exec.signal` to a
   * cooperative implementation that can reach quiescence when the signal aborts.
   */
  timeoutMs?: number
  /**
   * Pure synchronous classifier for overlap with sibling tool calls. Only
   * `true` opts in; omission, exceptions, non-`true` returns, and invalid
   * `defineTool` arguments are exclusive. This metadata is never model-visible.
   *
   * Opted-in executions must not mutate parent-owned state. Shared state must
   * tolerate concurrent dispatch; recorder races are permitted only when they
   * commute or fail closed. See the
   * [parallel-tool-call Agent Note](../../../../.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.md)
   * for the full contract.
   * @param args - parsed arguments; `defineTool` validates before calling.
   * @returns Whether this call may join a parallel group.
   */
  isConcurrencySafe?(args: unknown): boolean
  /**
   * Optional: how to present the PENDING state of one call in a UI, derived from
   * the call's `args` (parsed arguments, `unknown` — the tool validates/narrows
   * its own input). Returns a {@link ToolCallView} (a `card`-tagged render intent),
   * or `undefined` (or omit the method) to fall back to a generic presentation
   * (title = tool name, raw args as input). Pure and side-effect-free: a UI may
   * call it during live streaming AND a session-log replay, so it must depend
   * only on `args`.
   */
  presentCall?(args: unknown): ToolCallView | undefined
  /**
   * Optional: how to present the COMPLETED state, given the same `args` and the
   * durable result projection (`content`, failure state, and optional `meta`). Returns a
   * {@link ToolResultView}, or `undefined` (or omit the method) to keep the
   * pending title and render the raw result content. Pure and side-effect-free
   * for the same replay reason.
   */
  presentResult?(args: unknown, result: ToolResult): ToolResultView | undefined
}
```

`execute` 接收 `args: unknown`——原始的 `ToolDefinition` 自行校驗輸入。第一方工具不需要手寫校驗；它們使用 `defineTool`，由後者代為校驗並收窄參數類型、根據 `output.schema` 推導函式體返回類型，並為兩個輸出投影器提供類型約束。`finalizeContent` 特意接收不可變的執行對象而非類型化參數，因為無效輸入和外層管線失敗也會到達該回調；它可以施加工具自有的內容限制，同時保留 `isError`、規範值、結構化錯誤身份、延遲上下文與展示中繼資料。

## 統一的 JSON 值 schema DSL

外掛程式作者使用同一套詞彙描述類型化參數和類型化輸出值。`ValueSchemaSpec` 支援 `string`、`number`、`integer`、`boolean`、`null`、`array`、`object`、僅作者側可用的 `json`，以及要求恰好命中一個分支的 `oneOf`；標量 `enum` 和 `const` 值必須與節點類型匹配。顯式對象節點始終聲明 `additionalProperties: true | false`。參數定義仍是隱式的開放對象屬性對映，每個必填屬性都附帶 `required: true`。

原始碼：[`packages/core/tools/src/schema.ts`](../../packages/core/tools/src/schema.ts)

```ts type-equiv
/** One author-facing schema for any lossless JSON value root. */
type ValueSchemaSpec =
  | StringValueSchemaSpec
  | NumberValueSchemaSpec
  | IntegerValueSchemaSpec
  | BooleanValueSchemaSpec
  | NullValueSchemaSpec
  | ArrayValueSchemaSpec
  | ObjectValueSchemaSpec
  | JsonValueSchemaSpec
  | OneOfValueSchemaSpec
```

```ts type-equiv
/** One implicit parameter-root property, optionally required. */
type ParameterPropertySpec = ValueSchemaSpec & { required?: true }
```

```ts type-equiv
/**
 * Tool parameter schema. The map itself is an implicit open object root;
 * requiredness remains a per-property `required: true` annotation.
 */
type ParameterSchemaSpec = {
  [key: string]: ParameterPropertySpec
  [key: symbol]: never
}
```

`{ type: 'json' }` 推導為 `JsonValue`，並編譯成僅含註解、不施加約束的原始 schema。輸出根可以是對象、陣列、標量或 null。`InferValue<S>` 在 16 層容器內保留字面量約束與對象開放性，之後回退為 `JsonValue`，避免耗盡 TypeScript 的類型實例化棧。`InferArgs<P>` 依據逐屬性的必填標記生成必填和選填的字串鍵：

```ts type-equiv
/**
 * Infer the TypeScript value accepted by an author-facing value schema. Exact
 * inference is bounded to 16 container levels, then falls back to `JsonValue`.
 */
type InferValue<S> = InferValueAt<S, []>
```

```ts type-equiv
/** Infer the TypeScript argument object for an implicit parameter schema. */
type InferArgs<S> = InferProperties<S, []>
```

`defineTool({ name, description, parameters, output, execute, … })` 將參數推導與 `parameterSchemaSpecToJsonSchema()` 和 `validateArgs()` 綁定，並將 `execute`/`render`/`presentationMeta` 與 `InferValue<OutputSchema>` 綁定。schema 記錄只包含自有且可枚舉的字串鍵，schema 陣列是稠密的內建陣列，因此推導、編譯與校驗觀察到的是同一份聲明。精確推導保持到 16 層容器，之後放寬為 `JsonValue`；執行時期校驗仍會繼續遍歷完整 schema。`valueSchemaSpecToJsonSchema()` 透過同一套已強制執行的原始子集編譯輸出聲明。參數不匹配時拋出 `ToolArgsError`（`INVALID_ARGS`）；函式體或後置策略產生的值無效時拋出 `ToolOutputError`（`INVALID_TOOL_OUTPUT`）。兩者都經由常規工具錯誤路徑處理。原始 JSON Schema 預設保持開放；不支援的關鍵字會被拒絕，而不會在未強制執行的情況下獲準進入。

註冊是一項受信任的同行程約定。登錄檔以 readonly 輸入借用已類型化定義，要求它聲明 `output`，校驗其原始 schema，並檢查 `timeoutMs` 必須為正有限值等語義要求；`schemas()` 在建置請求時生成面向模型的投影，使執行和展示共享同一份已解析定義，而不會將回調洩漏到協定上。

## `ToolRestriction` — 單個作用域對其繼承內容的即時過濾器

`ToolRestriction` 作用於該作用域繼承來的工具：部署全域性層，加上其鏈上的每個祖先作用域。登錄檔將 readonly 名稱編譯為私有集合，對多個限制取交集，再疊加該作用域**自身**的註冊——後者不受約束，因此被委派的子 agent 會保留其回報所相依性的工具。僅 deny 的過濾器允許後續未列出的繼承工具透過，而 allow 清單則排除它們。

```ts type-equiv
/**
 * Per-scope filter over global tools. Restrictions intersect and do not affect
 * scoped registrations or the reserved Code Mode transport.
 */
interface ToolRestriction {
  /** Global tool names that stay visible; everything else is removed. */
  readonly allow?: readonly string[]
  /** Global tool names removed from visibility. */
  readonly deny?: readonly string[]
}
```

## 執行：可擴充的 waterfall（瀑布式事件）加單調策略

`ctx.tools.execute()` 接受由呼叫方擁有且包含必需 readonly `signal` 的 `ToolExecutionInput`，將其解析後的 JSON 參數一次性物化為管線擁有的 `ToolExecution`，然後讓呼叫依次經過 `tools/pre-execute`（可重排的 allow/deny/ask waterfall）→ 已註冊的單調 guard → `tools/execute`（環繞分派包裝層）→ `tools/post-execute`（檢查/替換結果）→ 選填且由定義擁有的 `finalizeContent` → `tools/result`（不可變的權威結果）。只有 `tools/execute` 檢視表可以替換必需的 signal。最終產出為 `ToolExecutionResult`。

```ts type-equiv
/** Opaque call identity that permits correlation without exposing mutable execution state. */
type ToolExecutionToken = symbol & { readonly [toolExecutionTokenBrand]: true }
```

```ts type-equiv
/**
 * Caller-supplied description of one tool call. {@link ToolRuntime.execute}
 * adds the registry-owned token to form a pipeline {@link ToolExecution};
 * callers do not choose that token.
 */
interface ToolExecutionInput {
  readonly callId: CallId
  /**
   * Root model-requested call owning this execution tree. Callers omit it for
   * a root execution; nested dispatchers propagate the enclosing value.
   */
  readonly rootCallId?: CallId
  readonly name: string
  /** Losslessly JSON-serializable parsed arguments (tools validate their own schema). */
  readonly arguments: unknown
  /** The agent on whose behalf the call runs (set by the agent loop). */
  readonly agent?: Agent
  /**
   * Opaque token of the enclosing transport execution, when one exists. Code
   * Mode sets this on SDK sub-dispatches so commit-style observers can wait for
   * the outer `run_code` outcome without receiving its live mutable execution.
   * The token also marks the call as a transport sub-dispatch rather than a
   * model-direct call: under `mode: 'code'`, only calls WITH a parent may
   * execute a native tool name — a model-direct call (no parent) is denied as
   * `UNKNOWN_TOOL` before the policy pipeline. See {@link ToolRuntime.execute}.
   */
  readonly parent?: ToolExecutionToken
  /** Required caller-owned cancellation for this invocation. */
  readonly signal: AbortSignal
}
```

工具函式體接收執行時期擴充。`deferContext()` 把上下文附著到本次執行自己的結果上——既是組合工具轉運巢狀分派上下文的通道，也可供葉子工具鑄造外掛程式來源指令——而不會在外層呼叫尚未結束時注入這些上下文。

```ts type-equiv
/**
 * Runtime context handed to a tool implementation after the registry has
 * accepted a {@link ToolExecution}. {@link deferContext} attaches context to
 * this execution's own result — a composite tool ferries nested-dispatch
 * context back to the outer result, and a leaf tool may mint a fresh
 * plugin-sourced instruction; the loop appends it only after the
 * `tool/result`.
 */
interface ToolRunContext extends ToolExecution {
  /**
   * Defer one context — typically a nested-dispatch context ferried by a
   * composite tool, or a fresh plugin-sourced instruction — until this tool's
   * final result reaches the agent loop. Contexts retain their individual
   * source and metadata and are emitted in call order.
   */
  deferContext(context: UserMessage): void
  /**
   * Mark a successful final result as terminal for the current agent turn.
   * The marker rides this execution's own result (`concludesTurn` exists only
   * on {@link ToolExecutionSuccess}); a composite that dispatches nested
   * calls forwards it from the nested result, exactly like
   * `additionalContexts`, so only an authoritative nested success can
   * conclude the enclosing run.
   */
  concludeTurn(): void
}
```

agent loop（代理循環）向登錄檔查詢每個待處理呼叫的執行模式，並據此形成獨佔屏障和捲動池平行執行：

```ts type-equiv
/**
 * Scheduling mode for one pending call. `parallel` may overlap with siblings;
 * `exclusive` runs alone and forms an ordering barrier.
 */
type ToolExecutionMode =
  | { kind: 'parallel' }
  | { kind: 'exclusive' }
```

Code Mode 的橋接層還會把每個已結帳的子分派暴露給 `tools/code-dispatch-log` waterfall，該 waterfall 可以更改持久事件所存的內容副本（程序取得的值和模型可見結果均不受影響）：

```ts type-equiv
/**
 * One settled `run_code` sub-dispatch about to be logged, as seen by the
 * `tools/code-dispatch-log` waterfall: the parent execution (session owner,
 * outer call identity), the sub-call identity, and the outcome whose durable
 * copy a listener may reshape. `content` is the RENDERED result projection
 * (what a native `tool/result` would carry) — the program itself received
 * the structured `value` (or just the error message on failure); only the
 * `tool/code-dispatch` event's copy changes.
 */
interface CodeDispatchLog {
  /** The outer `run_code` execution. */
  readonly exec: ToolExecution
  /** The calling agent (the scope routing key and the spill owner), when the outer call has one. */
  readonly agent?: Agent
  /** Deterministic sub-call id (`<parent>:code:<n>`). */
  readonly subCallId: CallId
  /** The dispatched sub-tool name. */
  readonly name: string
  /** Whether the sub-call settled as an error. */
  readonly isError: boolean
  /** The sub-call's complete model-facing content (the settle event's default payload). */
  readonly content: ContentBlock[]
}
```

```ts type-equiv
/**
 * One pending tool call inside the registry pipeline. Parsed arguments cross
 * one lossless-JSON materialization boundary before policy and are deep-frozen;
 * call identity, the caller signal, and the registry-assigned {@link token} are
 * readonly. The registry freezes the complete object before `tools/result`
 * observers run.
 */
interface ToolExecution extends ToolExecutionInput {
  /** Root model-requested call, resolved for every root and nested execution. */
  readonly rootCallId: CallId
  /** Registry-assigned identity shared with nested calls only as their opaque `parent` token. */
  readonly token: ToolExecutionToken
}
```

```ts type-equiv
/**
 * Around-dispatch view of a {@link ToolExecution}. A `tools/execute` wrapper
 * may replace the signal for its delegated lifetime, but it cannot remove it.
 * The registry fuses every replacement with the captured caller signal.
 */
interface ToolDispatchExecution extends Omit<ToolExecution, 'signal'> {
  /** Cancellation signal visible to the next wrapper or tool body. */
  signal: AbortSignal
}
```

`ToolExecutionToken` 是不透明的執行時期 `Symbol`，僅用於身份比較。策略執行前，`execute()` 會物化並凍結參數、拒絕非 JSON 輸入並分配 token。身份欄位、呼叫方必需的 signal 和選填的 parent token 均保持 readonly。`ToolDispatchExecution` 包裝層可以替換 signal 但不能移除；登錄檔會在呼叫工具函式體前重新融合調用方的 signal。最終觀察者接收凍結的執行身份。

`ToolGuard` 是感知作用域的最終預分派策略。其返回類型有意不包含 allow 結果：`undefined` 保留 waterfall 的決策，而返回的 reason 只能縮減權限，因此後續監聽器無法復原它。

```ts type-equiv
/**
 * A monotonic execution guard evaluated after every `tools/pre-execute`
 * listener and before the tool body. Returning a reason denies the call;
 * returning `undefined` leaves it unchanged. Because guards have no allow
 * result, listener ordering cannot turn a denial back into permission.
 * @param execution - the identity-protected call after extensible pre-execute policy completed.
 * @returns a final denial reason, or `undefined` to leave the call allowed.
 */
type ToolGuard = (execution: Readonly<ToolExecution>) => string | undefined
```

```ts type-equiv
/** Canonical failure detail; internal routing information remains optional. */
interface ToolFailure {
  /** Human-readable failure message without the Native `Error: ` envelope. */
  message: string
  /** Internal error class/code used by policy and durable diagnostics. */
  info?: ToolErrorInfo
}
```

```ts type-equiv
/** Successful canonical tool execution, including its Native/model projection. */
interface ToolExecutionSuccess {
  readonly isError: false
  /** Execution-local canonical value; deliberately omitted from durable events. */
  readonly value: JsonValue
  readonly content: ContentBlock[]
  readonly error?: never
  readonly meta?: JsonValue
  readonly additionalContexts?: UserMessage[]
  /** The agent loop stops after committing this successful result batch. */
  readonly concludesTurn?: true
}
```

```ts type-equiv
/** Failed canonical tool execution; failures never carry a successful value. */
interface ToolExecutionFailure {
  readonly isError: true
  readonly error: ToolFailure
  readonly value?: never
  readonly content: ContentBlock[]
  readonly meta?: JsonValue
  readonly additionalContexts?: UserMessage[]
  readonly concludesTurn?: never
}
```

```ts type-equiv
/** The discriminated, execution-local outcome of one tool call. */
type ToolExecutionResult = ToolExecutionSuccess | ToolExecutionFailure
```

結果僅承載產出。呼叫身份保留在不可變的 `ToolExecution` 上，後者伴隨結果經過每個掛鉤，並出現在持久化的 `tool/call` / `tool/result` 工作階段事件上，因此包裝層無法建立第二個相互矛盾的身份。規範的 `value` 僅存在於執行期間：迴圈只持久化 `content`、`error` 和 `meta`，`tool/code-dispatch` 則原樣儲存子呼叫算繪後的 `content` 與 `isError`。重播可以重現展示，卻無法重建規範的中間值。

成功時，登錄檔會快照並校驗函式體回傳值，將其凍結，然後呼叫純算繪器；對於直接的外層呼叫，還會呼叫選填的中繼資料投影器。登錄檔會在 `tools/result` 之前另行物化持久展示欄位；無效值、算繪器/投影器失敗或非 JSON 展示都會轉為 JSON 安全的 `isError`。因此，最終即時觀察者能看到精確的執行期值，以及可安全用於後續持久追加的欄位。

在得到最終內容之前，登錄檔會物化候選結果；若內容、結構化錯誤、附加上下文或展示中繼資料無法物化，則會轉為仍可到達 `finalizeContent` 的 JSON 安全 `isError` 結果。登錄檔恰好呼叫該回調一次，隨後在 `tools/result` 之前立即物化並凍結已接受的結果，因此即時觀察到的產出可安全用於後續持久化的 `tool/result` 追加。

每個攔截 waterfall 返回一個類型化的 **Decision**（與 `agent/*` waterfall 共享的慣用模式）。`tools/pre-execute` 監聽器接收 `(exec, next)` 並返回 `PreToolDecision`；`tools/execute` 包裝層返回 `ToolExecutionResult`；`tools/post-execute` 監聽器接收 `(exec, result, next)` 並返回 `PostToolDecision`：

```ts type-equiv
/**
 * Pre-dispatch decision. `allow` runs the call; `deny` materializes an error;
 * `ask` runs only after an approval service returns `allowed-once` and otherwise
 * denies. Input rewriting is excluded because arguments are already logged and
 * presented.
 */
type PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason?: string }
```

```ts type-equiv
/**
 * Post-dispatch decision: accept, replace one projection, attach context for the
 * next request, or block by turning corrective feedback into an error result.
 */
type PostToolDecision =
  | { kind: 'accept'; content?: ContentBlock[]; value?: never; additionalContexts?: UserMessage[] }
  | { kind: 'accept'; value: JsonValue; content?: never; additionalContexts?: UserMessage[] }
  | { kind: 'block'; feedback: ContentBlock[]; additionalContexts?: UserMessage[] }
```

呼叫 `next()` 取得預設決策，或直接返回一個決策以短路。前置策略可以 deny 或 ask；只有 `allowed-once` 才繼續執行，而未授權、缺少審批通道或服務、或無 agent 的請求都會變為拒絕。Guard 仍可施加最終拒絕。參數不可被改寫，因為歷史記錄、審計、UI 和執行必須保持一致。

後置策略可以替換內容或值，但不能同時替換兩者。替換內容會保留規範值和現有中繼資料；替換值會重新校驗並重新計算內容/中繼資料；阻止會移除值，並轉為包含糾正回饋的 `isError`。內容替換是展示策略，而非保密策略；需要隱藏程序化值的監聽器必須阻止或替換該值。`tools/result` 在歸一化後接收凍結的執行和結果；觀察者無法對其進行變換，觀察者的失敗也會被隔離。未知工具和拋出例外的工具都會變為結構化錯誤（`ToolNotFoundError` 對映為 `UNKNOWN_TOOL`），呼叫失敗但不終止當前輪次。

## 已強制執行的原始 JSON Schema 子集

subagent、工作流程、MCP 和動態註冊提供的原始 schema 使用作者側 DSL 在協定層的對應表示。`assertSupportedJsonSchema()` 接受任意 JSON 根，`validateJsonSchemaValue()` 強制執行該 schema，`JsonSchemaError` 則報告每條不受支援或格式錯誤的 schema 路徑。僅含註解的空節點表示不受約束的無損 JSON。`oneOf` 至少要求兩個分支，且一個值必須恰好匹配其中一個。仍要求對象根的消費端呼叫 `assertObjectJsonSchema()` 並攜帶 `ObjectJsonSchema`；這樣，subagent/工作流程中由呼叫方定義的結構化輸出可以繼續以對象為根，而不會限制共享詞彙。

```ts type-equiv
/** Scalar JSON values supported by `enum` and `const`. */
type JsonSchemaScalar = string | number | boolean | null
```

```ts type-equiv
/** Single-type keywords accepted by the enforced subset. */
type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
```

```ts type-equiv
/**
 * One raw JSON Schema node in the enforced subset. The optional fields express
 * the external wire schema; {@link assertSupportedJsonSchema} rejects invalid
 * combinations before a caller treats the node as trusted.
 */
interface JsonSchemaNode {
  /** Omit with no constraints for any JSON value, or use `oneOf`. */
  type?: JsonSchemaType
  /** Exactly one branch must validate; at least two branches are required. */
  oneOf?: JsonSchemaNode[]
  /** Nested property schemas (`type: 'object'` only). */
  properties?: Record<string, JsonSchemaNode>
  /** Required property names; each must appear in `properties`. */
  required?: string[]
  /** `false` rejects undeclared keys; absent/`true` follows JSON Schema's open default. */
  additionalProperties?: boolean
  /** Item schema (`type: 'array'` only); absent accepts any JSON item. */
  items?: JsonSchemaNode
  /** Allowed values for a scalar node. */
  enum?: JsonSchemaScalar[]
  /** The single allowed value for a scalar node. */
  const?: JsonSchemaScalar
  /** Annotation, ignored for validation. */
  description?: string
  /** Annotation, ignored for validation. */
  title?: string
  /** Annotation, ignored for validation but required to be lossless JSON. */
  default?: JsonValue
  /** Annotation, ignored for validation but required to be lossless JSON. */
  examples?: JsonValue
}
```

```ts type-equiv
/** A consumer-constrained object-rooted schema. */
type ObjectJsonSchema = JsonSchemaNode & { type: 'object' }
```

## 工具展示 UI 詞彙

工具希望其呼叫在 UI 中如何呈現（編輯器工具呼叫卡片、CLI（命令列介面）日誌行），提供方無關，使工具在不相依性任何用戶端協定的情況下描述自身。`presentCall`/`presentResult` 返回一個 **`card` 標籤的算繪意圖**——一個可辨識聯合類型，UI 橋接層據此分發：

- `ToolCallView`（待執行）：`{ card: 'generic', title, kind?, rawInput?, content?, locations? }`（預設卡片；`locations` 是 `{ path, line? }[]`，表示呼叫讀取/修改的文件，供編輯器跟隨）、`{ card: 'terminal', title, description?, cwd? }`（shell 命令→終端機卡片）、或 `{ card: 'diff', title, diffs, locations? }`（文件建立/修改→行內 diff 卡片；`diffs` 是 `{ path, oldText, newText }[]`，新文件時 `oldText: null`）。
- `ToolResultView`（已完成）：`{ card: 'generic', title?, content? }`、`{ card: 'terminal', title?, output?, exitCode?, signal? }`（捕獲的執行輸出 + 結束狀態；有能力的 UI 顯示結束狀態標籤，其他 UI 可以派生圍欄 ` ```console ` 回退）、`{ card: 'diff', title?, diffs }`（已完成的文件變更→要展示的變更，通常是從變更前後內容計算出帶上下文行的已應用 hunk，或在沒有前像時的整文件 diff）、`{ card: 'search', shape, title?, truncated, total, … }`（已完成的發現型搜尋→`shape: 'matches'`（grep）為按文件分組的匹配，`shape: 'paths'`（glob）為扁平路徑清單；`truncated`/`total` 報告內聯結果是否被截斷，使 UI 永不把部分結果當作完整結果呈現；該檢視表不攜帶結果文字——無 search 卡片的 UI 回退到原始結果內容）、`{ card: 'read', title?, path, offset, lines, totalLines, lang?, content? }`（已完成的文件讀取→帶行號、選填文法高亮的程式碼檢視表；`offset` 是視窗請求的 1-based 起始行，即使 `lines` 為空也保留；`lang` 是從擴充名推得的語言提示，`content` 是無讀取能力的 UI 回退時使用的去信封文字）、或 `{ card: 'web', kind: 'search' | 'fetch', title?, … }`（已完成的 web 檢索；`kind: 'search'` 攜帶結構化的 `sources`/`answer?`/`truncated`，`kind: 'fetch'` 攜帶 `url`/`statusCode`/`truncated`，不具備 `web` 能力的 UI 回退到原始結果內容——正文不會重複進檢視表）。已完成檢視表會替換待執行檢視表，因此變更工具即使與呼叫時的片段重複也要返回 diff 結果；搜尋和 web 檢索都沒有 `card` 的呼叫時對應檢視表（其 pending 狀態保持為 generic 卡片，因為結構化結果只在 `execute` 之後才存在）。

`ToolCallKind`（`'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'fetch' | 'other'`）用於為通用卡片選擇圖示。`FileLocation`（`{ path, line? }`）、`FileDiff`（`{ path, oldText, newText }`）與 `ReadFileLine`（`{ number, text }`，讀取視窗中一行帶 1-based 行號的內容）是共享的文件卡片詞彙。該設計由[算繪意圖聯合類型 Agent Note](../../.agents/notes/implemented/architecture/2026-07-02-tool-render-intent-union.md)固定；host/client 執行時期將這套中性詞彙投影為各自的檢視表。

完整的展示欄位文件見 [`packages/core/tools/src/presentation.ts`](../../packages/core/tools/src/presentation.ts)。`bash` schema 與執行器見 [shell.md](shell.md)；通用後臺控制見 [jobs.md](jobs.md)。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtools--toolruntime"></a>

### `ctx.tools` — `ToolRuntime`

Tool registry and execution pipeline. Scoped registrations shadow globals; one visibility resolver feeds presentation, lookup, and dispatch.

```ts cordis-catalog
/**
 * Present the calling scope's tools in `mode` instead of the deployment
 * default. Nearest scope on the chain wins, so a preset's standing
 * declaration covers every agent joined under it.
 *
 * Scoped only, and one declaration per scope: this is how an agent preset
 * composes Code Mode agents beside native ones in the same process, and a
 * process-global override would be the `mode` config field instead.
 * @param mode - the presentation the covered agents' models see.
 * @returns the exact disposer that restores the deployment default.
 */
presentAs(mode: ToolPresentationMode): () => void

/**
 * Register globally or in the calling agent scope. Scoped tools shadow
 * globals; duplicates within one layer and the reserved `run_code` name fail.
 * @param definition - tool schema, execution, and optional finalization/presentation callbacks.
 * @returns the exact disposer that unregisters the tool.
 */
register(definition: ToolDefinition): () => void

/**
 * Restrict global tools for the calling agent scope. Empty filters, unknown
 * names, scope-local names, and reserved transport names fail. Restrictions
 * intersect; scoped registrations remain visible.
 * @param filter - global-tool mask: `allow` (keep only) and/or `deny` (remove).
 * @returns the exact disposer that lifts this restriction.
 */
restrict(filter: ToolRestriction): () => void

/**
 * Register a monotonic guard after the extensible `tools/pre-execute`
 * waterfall. A plain-context guard applies globally; one registered through
 * `agent.ctx` applies only to that agent. Any matching guard may deny by
 * returning a reason, while no guard can force-allow a call another guard
 * denied. The exact effect disposer is returned for ordered ownership and
 * HMR cleanup.
 * @param guard - synchronous check; a returned string denies the execution.
 * @returns the exact disposer that unregisters the guard.
 */
guard(guard: ToolGuard): () => void

/**
 * Look up a tool as one scope sees it (scoped
 * shadows global; a restricted-away global reads as absent). Presenters pass
 * the calling agent so the rendered card matches the definition that
 * actually executed.
 * @param name - the tool name as registered.
 * @param scope - the viewing scope (the agent); omitted = the global view.
 * @returns the definition the scope resolves, or undefined when none is visible.
 */
get(name: string, scope?: ScopeKey): ToolDefinition | undefined

/**
 * Project visible definitions onto the allowlisted model-facing schema fields,
 * excluding execution and presentation callbacks.
 * @param scope - the viewing scope (the agent); omitted = the global view.
 * @returns one deep-cloned schema per visible tool.
 */
schemas(scope?: ScopeKey): ToolSchema[]

/**
 * Classify a pending call through the caller's visible tool definition. Only
 * an exact `true` is parallel; unknown, hidden, undeclared, invalid, or
 * throwing classifiers are exclusive.
 * @param exec - call name, parsed arguments, and optional agent scope.
 * @returns the fail-closed scheduling mode.
 */
executionMode(exec: ToolExecutionInput): ToolExecutionMode

/**
 * Execute through pre-policy, guards, around-dispatch, post-policy,
 * definition-owned content finalization, and final notification. Tool and
 * listener failures resolve as materialized error results; an invisible tool
 * reports `UNKNOWN_TOOL`. The returned outcome is the same lossless, frozen
 * snapshot final observers receive. Cancellation
 * arriving after entry and before final result materialization skips a
 * not-yet-started body with `ABORTED_BEFORE_DISPATCH` or replaces a
 * successful started outcome with `ABORTED`; already-started work is still
 * drained and may retain a tool-owned structured error.
 * @param exec - the typed same-process call input. The registry assigns its
 *   correlation token before policy begins.
 * @returns the materialized final result.
 */
async execute(exec: ToolExecutionInput): Promise<ToolExecutionResult>
```

Types: [ScopeKey](scope.md)

Source: [`packages/core/tools/src/index.ts:787`](../../packages/core/tools/src/index.ts)

<a id="tools-events"></a>

### `tools/*` events

<a id="toolschange--emit"></a>

#### `tools/change` — emit

A tool was registered or unregistered, or a scoped restriction changed (the available tool set changed — possibly for one scope only). An UNFILTERED registry-subject notification, deliberately not scope-filtered dispatch: a global change concerns every agent's next assembly, so a scoped listener subscribing here sees every change, not just its own scope's.

```ts cordis-catalog
/**
 * A tool was registered or unregistered, or a scoped restriction changed
 * (the available tool set changed — possibly for one scope only). An
 * UNFILTERED registry-subject notification, deliberately not scope-filtered
 * dispatch: a global change concerns every agent's next assembly, so a
 * scoped listener subscribing here sees every change, not just its own
 * scope's.
 * @mode emit
 */
'tools/change'(): void
```

Source: [`packages/core/tools/src/index.ts:207`](../../packages/core/tools/src/index.ts)

<a id="toolscode-dispatch-log--waterfall"></a>

#### `tools/code-dispatch-log` — waterfall

Allow a listener to replace content in the DURABLE LOG COPY of one `run_code` sub-dispatch outcome before the bridge appends its `tool/code-dispatch` event. `next()` keeps the content unchanged; a listener may return replacement blocks (e.g. the spill policy's preview + locator for an oversized text result). Only the logged copy is affected — the program already received the complete value, and the model sees neither. A throwing listener is contained: the bridge falls back to logging the original settled content. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's dispatches.

```ts cordis-catalog
/**
 * Allow a listener to replace content in the DURABLE LOG COPY of one
 * `run_code` sub-dispatch outcome before the bridge appends its
 * `tool/code-dispatch` event. `next()` keeps the
 * content unchanged; a listener may return replacement blocks (e.g. the
 * spill policy's preview + locator for an oversized text result). Only the
 * logged copy is affected — the program already received the complete
 * value, and the model sees neither. A throwing listener is contained:
 * the bridge falls back to logging the original settled content.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's dispatches.
 * @param dispatch - the parent execution, sub-call identity, and the settled content to log.
 * @mode waterfall
 */
'tools/code-dispatch-log'(this: Scoped<ToolRuntime>, dispatch: CodeDispatchLog, next: () => Promise<ContentBlock[]>): Promise<ContentBlock[]>
```

Types: [ContentBlock](llm-streaming.md) · [Scoped](scope.md)

Source: [`packages/core/tools/src/index.ts:189`](../../packages/core/tools/src/index.ts)

<a id="toolsexecute--waterfall"></a>

#### `tools/execute` — waterfall

Around-dispatch waterfall for timeout, retry, or metrics. `next()` returns a normalized result; wrappers may change only `exec.signal`, while call identity remains immutable. The registry re-fuses the original caller signal before the body, so replacement cannot detach caller cancellation; wrappers must still restore their signal and reach quiescence. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.

```ts cordis-catalog
/**
 * Around-dispatch waterfall for timeout, retry, or metrics. `next()` returns
 * a normalized result; wrappers may change only `exec.signal`, while call
 * identity remains immutable. The registry re-fuses the original caller
 * signal before the body, so replacement cannot detach caller cancellation;
 * wrappers must still restore their signal and reach quiescence.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.
 * @param exec - the allowed call about to dispatch (name, parsed arguments, caller agent, signal).
 * @mode waterfall
 */
'tools/execute'(this: Scoped<ToolRuntime>, exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult>
```

Types: [Scoped](scope.md)

Source: [`packages/core/tools/src/index.ts:163`](../../packages/core/tools/src/index.ts)

<a id="toolspost-execute--waterfall"></a>

#### `tools/post-execute` — waterfall

Accept, replace, enrich, or block a normalized dispatch result. `next()` accepts it unchanged; thrown tools still reach this waterfall as errors. Async listeners must observe `exec.signal`; after they settle, caller cancellation replaces only a successful accepted outcome with the code selected by whether the tool body was invoked. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.

```ts cordis-catalog
/**
 * Accept, replace, enrich, or block a normalized dispatch result. `next()`
 * accepts it unchanged; thrown tools still reach this waterfall as errors. Async
 * listeners must observe `exec.signal`; after they settle, caller
 * cancellation replaces only a successful accepted outcome with the code
 * selected by whether the tool body was invoked.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.
 * @param exec - the call that just ran (name, parsed arguments, caller agent).
 * @param result - the dispatch outcome a listener may accept, replace, or block.
 * @mode waterfall
 */
'tools/post-execute'(this: Scoped<ToolRuntime>, exec: ToolExecution, result: Readonly<ToolExecutionResult>, next: () => Promise<PostToolDecision>): Promise<PostToolDecision>
```

Types: [Scoped](scope.md)

Source: [`packages/core/tools/src/index.ts:175`](../../packages/core/tools/src/index.ts)

<a id="toolspre-execute--waterfall"></a>

#### `tools/pre-execute` — waterfall

Allow, deny, or ask before dispatch. `next()` delegates to allow; missing approval support turns `ask` into denial. Async gates must observe `exec.signal`; the registry rechecks cancellation after they settle but never abandons their promise. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.

```ts cordis-catalog
/**
 * Allow, deny, or ask before dispatch. `next()` delegates to allow; missing
 * approval support turns `ask` into denial. Async gates must observe
 * `exec.signal`; the registry rechecks cancellation after they settle but
 * never abandons their promise.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.
 * @param exec - the pending call (name, parsed arguments, caller agent).
 * @mode waterfall
 */
'tools/pre-execute'(this: Scoped<ToolRuntime>, exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision>
```

Types: [Scoped](scope.md)

Source: [`packages/core/tools/src/index.ts:152`](../../packages/core/tools/src/index.ts)

<a id="toolsresult--emit"></a>

#### `tools/result` — emit

Observe the frozen, lossless-JSON final outcome. Listener failures are contained. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): keyed by `exec.agent`.

```ts cordis-catalog
/**
 * Observe the frozen, lossless-JSON final outcome. Listener failures are contained.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): keyed by `exec.agent`.
 * @param exec - the execution object that traversed the pipeline.
 * @param result - a deep-frozen snapshot of the final returned result.
 * @mode emit
 */
'tools/result'(this: Scoped<ToolRuntime>, exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): undefined
```

Types: [Scoped](scope.md)

Source: [`packages/core/tools/src/index.ts:197`](../../packages/core/tools/src/index.ts)
<!-- END GENERATED cordis-surface -->
