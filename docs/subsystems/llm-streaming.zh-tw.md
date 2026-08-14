# LLM（大型語言模型）流式輸出

[English](llm-streaming.md) | [简体中文](llm-streaming.zh.md) | 繁體中文

[`packages/llm`](../../packages/llm/README.md) 提供對話與流式輸出類型：每個請求和持久歷史共用的 `Message`/`ContentBlock` 變體、完整組裝的模型請求、原始 `StreamChunk` 協議、每個配接器必須實作的配接器約定（adapter contract），以及共享的 assembler。[核心包](core.md)在每個輪次持有並記錄這些值；本頁聲明它們。

原始碼：[`packages/llm/llm/src/types.ts`](../../packages/llm/llm/src/types.ts)

<a id="content-blocks-and-messages"></a>

## 內容區塊與訊息

一段對話由 `Message` 組成；一則訊息是一個類型化**內容區塊**的陣列。塊的聯合類型從 `ContentBlockMap` 派生。

原始碼：[`packages/llm/llm/src/types.ts`](../../packages/llm/llm/src/types.ts)

```ts type-equiv
/**
 * Merge-extensible content blocks keyed by `type`. New core blocks must land
 * with adapter, UI, and compaction support.
 */
interface ContentBlockMap {
  'text': TextBlock
  'reasoning': ReasoningBlock
  'image': ImageBlock
  'tool-call': ToolCallBlock
  'tool-result': ToolResultBlock
}
```

各塊介面（完整欄位見原始碼）：`TextBlock`（`text`）、`ReasoningBlock`（thinking，區別於可見文字）、`ImageBlock`（一個持久的[圖片附件](attachment.md)）、`ToolCallBlock`（`id: CallId`、`name`、原始 JSON `arguments`），以及 `ToolResultBlock`（`toolCallId`、巢狀 `content: ContentBlock[]`、`isError?`）。`ContentBlock = ContentBlockMap[ContentBlockType]`。僅當配接器、UI、壓縮（compaction）和持久重播路徑均支持某種新模態時，才將其納入可合併擴充的 map。

原始碼：[`packages/llm/llm/src/message.ts`](../../packages/llm/llm/src/message.ts)

`Message` 是一個帶標識且不可變的角色／來源／內容值。模型生成的 assistant 訊息會在來源中記錄生成它的提供方和模型，以及選填的配接器私有重播資料：

```ts type-equiv
/** Provider/model identity and adapter-private replay data for an assistant message. */
interface AssistantProvenance {
  /** Provider route that produced the message. */
  provider: string
  /** Provider model id that produced the message. */
  model: string
  /**
   * Lossless-JSON adapter state needed to replay the provider response.
   * `LlmRuntime` exposes it to a target adapter only when that adapter instance
   * currently owns both this historical provider and the target provider.
   */
  replayState?: unknown
}
```

```ts type-equiv
/** One immutable message representation shared by delivery, durable history, and model requests. */
interface Message {
  /** Stable identity preserved across every representation boundary. */
  readonly id: MessageId
  /** Provider-neutral conversation role. */
  readonly role: 'system' | 'user' | 'assistant'
  /** Exact model-facing blocks. */
  readonly content: ContentBlock[]
  /** Required source fields supplied by the producer. */
  readonly source: MessageSource
}
```

訊息來源本身也是一個可合併擴充的和類型：

```ts type-equiv
/**
 * Where a message (or injected content) came from.
 * Merge-extensible sum type — plugins add their own `kind`s.
 */
interface MessageSourceMap {
  user: { kind: 'user' }
  plugin: { kind: 'plugin'; plugin: string } & ContextFormed
  model: ModelMessageSource
  tool: ToolMessageSource
}
```

生產方標識與呈現形式相互獨立。`kind` 回答「由誰產生」；選填的 `form` 回答「這是什麼類型的資訊」，消費端決定如何呈現。多個生產方可以共用一種 `form`，一個生產方在一次工作階段中也可以寄出多種 `form`。這些取值描述語義，並逐個增加；未聲明或無法識別的值使用文件規定的預設值，按不透明內容呈現：

```ts type-equiv
/**
 * The kind of information in producer-supplied context, declared by the
 * producer beside its provenance.
 *
 * `MessageSource.kind` answers *who produced this*; `form` answers *what kind
 * of thing it is*, and the two axes are deliberately independent — several
 * producers share one form, and one producer may emit more than one form over
 * a session.
 *
 * The vocabulary is SEMANTIC, never visual: a value states that the content is
 * a file's instructions or a catalog of available items, and a consumer decides
 * what that looks like. Colors, icons, ordering, and collapse defaults are the
 * consumer's business and must not enter this union. It grows one value at a
 * time as producers gain the structured fields their form needs; an absent or
 * unknown value is the documented default, presented as opaque content.
 */
type ContextForm =
  /** Instructions read out of workspace files the model is expected to follow. */
  | 'instructions'
  /** A catalog of items available in this session, republished as it changes. */
  | 'catalog'
  /** Current state, where a later snapshot from the same producer supersedes an earlier one. */
  | 'snapshot'
  /** A one-off account of something that just happened; it supersedes nothing. */
  | 'notice'
  /** A message another agent addressed to this one. */
  | 'relay'
  /** Material lifted out of another session's log, possibly reduced on the way in. */
  | 'recall'
```

```ts type-equiv
/** One named contribution to a `snapshot`-form context, in assembly order. */
interface ContextSnapshotSection {
  /** The contributing subsystem's name. */
  readonly name: string
  /** That contribution's model-facing text, exactly as assembled. */
  readonly text: string
}
```

```ts type-equiv
/**
 * Producer-declared {@link ContextForm} and the fields that form requires,
 * mixed into the source types that carry one.
 *
 * Discriminated by `form` so a producer cannot select a form without the
 * fields needed to present it: a `notice` must record its one-line
 * account, a `snapshot` its sections. Omitting `form` stays valid — an
 * undeclared context is the documented default.
 */
type ContextFormed =
  | { readonly form?: never }
  | { readonly form: 'instructions' }
  | { readonly form: 'catalog' }
  | {
    readonly form: 'snapshot'
    /** The named contributions this snapshot assembled, in order. */
    readonly sections: readonly ContextSnapshotSection[]
  }
  | {
    readonly form: 'notice'
    /** One-line account of what happened, shown without expanding the row. */
    readonly summary: string
  }
  | { readonly form: 'relay' }
  | { readonly form: 'recall' }
```

<a id="streamchunk--the-raw-protocol"></a>

## `StreamChunk`：原始協議

一個流式回應交錯包含多種類型的塊（文字、推理（reasoning）、多個工具呼叫）。`index` 將每個 delta 關聯到其所屬塊；`block-end` 攜帶完整組裝好的 `ContentBlock`，消費端無需自行重新組裝 delta。這是一個**封閉的**可辨識聯合類型：對 `type` 的 `switch` 以 `assertNever` 結尾，因此新增變體會在每個必須處理它的消費端處觸發編譯錯誤。

```ts type-equiv
/**
 * Raw streaming protocol emitted by adapters.
 * Block indexes correlate interleaved deltas, and `block-end` carries the
 * assembled block. Adapters emit usage before the terminal finish and nothing
 * afterward; tool arguments remain raw JSON strings. An adapter implementation
 * may throw, but `LlmRuntime.stream()` normalizes that failure to a terminal
 * `error` or `aborted` finish before exposing it to consumers.
 */
type StreamChunk =
  | { type: 'block-start'; index: number; blockType: ContentBlockType }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: CallId; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: ContentBlock }
  | { type: 'usage'; usage: TokenUsage }
  | {
    type: 'finish'
    reason: FinishReason
    /** Adapter-private lossless-JSON state for replaying a successful response. */
    replayState?: unknown
  }
```

<a id="llmfailure"></a>

## `LlmFailure`

每個拋出的失敗或最終配接器的帶內失敗都會規範化為一種可序列化、提供方無關的 payload。`providerRetryAfterMs` 是經校驗、由提供方請求的正數延遲，而不是重試決策；`ProviderRequestId` 是用於診斷的不透明品牌字串。

```ts type-equiv
/** Serializable provider or transport failure facts; policy decides whether they are retryable. */
interface LlmFailure {
  /** Human-readable provider or transport failure. */
  readonly message: string
  /** Stable provider-neutral machine-routing code. */
  readonly code: string
  /** HTTP status returned by the provider, when available. */
  readonly status?: number
  /** Provider-requested delay in milliseconds, when valid and available. */
  readonly providerRetryAfterMs?: number
  /** Opaque provider-issued request identifier for diagnostics. */
  readonly requestId?: ProviderRequestId
}
```

## 配接器約定

每個配接器必須遵守以下規則，每個消費端可以相依性它們：

- **`usage` 在 `finish` 之前，`finish` 之後不再有任何區塊。** 將兩者都推遲到提供方的流結束標記，這樣尾部的 usage-only 區塊就不會違反順序。
- **工具呼叫的 `arguments` 全程保持原始 JSON 字串。** 部區塊段透過 `argumentsDelta` 流式傳輸；如果提供方返回的是已解析的對象，配接器在 `block-end` 時重新序列化為字串。
- **兩條受支持的錯誤路徑，共用一個 `LlmFailure` 類型。** 失敗可以從 `stream()` 拋出（傳輸／協議錯誤），**或者**以 `finish {kind:'error'|'aborted', failure}` 結束流（無法在流中途拋例外的配接器用它表示提供方帶內錯誤）。`LlmError.failure` 攜帶同一個 `LlmFailure`。呼叫選定配接器後，流會保留被拋出的確切 `Error` 對象，並將不可變事實以及實際服務註冊所對應的不可變重試策略關聯到該呼叫；agent loop（代理循環）關閉失敗步驟，再把錯誤、事實、不可變的先前已重試失敗事實、實際服務策略和輪次訊號提供給 `agent/request-error`。處理該錯誤的 listener 在其 await 的修復完成後返回 `{ kind: 'retry' }`；若未復原，結構化失敗會成為輪次錯誤，並且該次嘗試不會提交正常 assistant 訊息或工具副作用。
- **一次配接器呼叫就是一次提供方嘗試。** 配接器停用庫重試。agent 層復原會打開另一個持久、帶編號的輪次；直接呼叫 `ctx.llm.stream()` 的呼叫方仍然只嘗試一次。
- **提供方停頓在傳輸層受到時限約束。** 兩個已交付的遠端配接器都暴露正數且有限的 `streamIdleTimeoutMs`，默認五分鐘。watchdog 只在 iterator `next()` 尚未完成時啟動，整個請求使用同一個穩定 signal，把自身到期對映為 `TIMEOUT`，並把更早發生的呼叫方中止保留為 `ABORTED`。
- **上下文溢位只有一個規範 code。** 兩個 DeepSeek 配接器都透過 `isContextWindowExceededError()` 對提供方的顯式細節分類並暴露 `CONTEXT_WINDOW_EXCEEDED`，無論失敗以拋出的 HTTP `LlmError` 還是帶內 finish error 到達。消費端按 code 路由，絕不相依性提供方文字。
- **空 completion 是可重試錯誤，而不是靜默的成功結果。** 兩個配接器都把沒有攜帶任何內容區塊的終止性 `stop` 結束對映為攜帶規範 `EMPTY_RESPONSE` code 的 `finish {kind:'error'}`，`dsh-llm-retry` 默認會重試它；詳見[空模型回應可重試](../../.agents/notes/implemented/bug-fix/2026-07-24-empty-model-response-is-retryable.md)。
- **每個提供方 HTTP 請求都攜帶應用歸屬頭。** 配接器傳送 `attributionHeaders()`（見下文）作為 `User-Agent` 基線，並透過協議級測試加以證明。
- **重播狀態歸配接器所有。** 成功的 `finish` 可以攜帶重建提供方原生回應所需的無損 JSON 狀態。迴圈會將其與組裝後的 assistant 訊息一起儲存。後續請求中，僅當歷史提供方與目標提供方當前註冊到完全相同的配接器實例時，`LlmRuntime` 才會傳遞該狀態。該配接器負責校驗狀態並擁有所有跨模型或跨提供方轉換；其他配接器只會收到提供方無關的內容以及提供方／模型欄位，不會收到私有狀態。

## `ResolvedRetryPolicy`

提供方設定會在路由註冊前解析為不可變的可辨識聯合。normal mode 攜帶 `mode: 'normal'`、有限的 `maxRetries`、`retryableCodes`，以及必填的 `initialDelayMs`、`maxDelayMs` 與 `jitterRatio`；always mode 攜帶 `mode: 'always'` 和相同的必填退避欄位，但沒有有限上限。`LlmRuntime.providerRetryPolicy(provider)` 返回當前註冊的值，並在配接器省略策略時提供 normal 預設值；呼叫選定該註冊後，`llmRetryPolicyOf(stream)` 返回為該呼叫服務的註冊所捕獲的值，因此之後釋放或替換路由都無法改變進行中失敗的復原策略。選填設定輸入欄位由[生成的設定目錄](../config-catalog.md)列出。

## `AppIdentity`：應用歸屬

每個配接器都會向提供方傳送的靜態公開應用標識（[`packages/llm/llm/src/attribution.ts`](../../packages/llm/llm/src/attribution.ts)）。`attributionHeaders(identity?)` 只把它對映到標準 `User-Agent` header；該約定有意不支持 OpenRouter 特有的應用歸屬 header。默認 `APP_IDENTITY` 從包 manifest（中繼資料清單）取得版本；每個欄位都是公開產品事實——不含 secret、路徑、工作階段 id 或逐使用者標識，且任何逐請求資訊都不得影響這些值。設計理由見[強制 `User-Agent` 歸屬](../../.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md)。

```ts type-equiv
/**
 * Static public application identity sent to LLM providers.
 *
 * Every field is a public product fact, safe on every request: no secrets,
 * local paths, session ids, prompt text, or per-user identifiers belong here,
 * and nothing per-request may influence the values.
 */
interface AppIdentity {
  /** `User-Agent` product token (lowercase, hyphenated). */
  product: string
  /** Product version; sourced from package metadata, never hand-copied. */
  version: string
  /** Repository home URL of the app, used as the `User-Agent` comment. */
  url: string
}
```

<a id="tokenusage"></a>

## `TokenUsage`

逐呼叫 token 記帳。各計數**互不重疊**：`inputTokens` 只包含未快取輸入；快取輸入單獨報告，計費輸入是三者之和。若提供方把快取命中折入單一提示詞總數（如 DeepSeek 的 `prompt_tokens`），配接器會再將其扣除。`reasoningTokens` 存在時只是資訊性細節，已經包含在 `outputTokens` 中；彙總時不得重複相加。

```ts type-equiv
/**
 * Token accounting for one model call (cache fields are optional).
 *
 * Counts are DISJOINT: `inputTokens` is uncached input only; cached input is
 * reported separately as `cacheReadTokens`/`cacheWriteTokens` (billed input =
 * sum of the three). Adapters whose providers fold cache hits into a total
 * prompt count (DeepSeek's `prompt_tokens`) subtract them out.
 */
interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}
```

<a id="blockassembler"></a>

## `BlockAssembler`

`BlockAssembler`（[`packages/llm/llm/src/assembler.ts`](../../packages/llm/llm/src/assembler.ts)）是唯一的共享實作，負責把 `StreamChunk` 流摺疊回 `ContentBlock`、usage、結束原因與重播狀態。迴圈在記錄原始區塊的同時，把同一批區塊送入 assembler，再將組裝後的 assistant 內容連同生成它的提供方和模型一起儲存。需要組裝結果、又不想重新實作 fold 的消費端使用它。

```ts public-api
/**
 * Incrementally assembles raw {@link StreamChunk}s into complete
 * {@link ContentBlock}s and a final assistant {@link Message}.
 *
 * The agent loop feeds it while logging raw chunks for replay fidelity, then
 * reads `blocks()` / `message()` / `usage` / `finish` once the stream ends.
 *
 * Tolerant of delta-only protocols (no block-start/end); deltas arriving for
 * an index already closed by `block-end` are ignored (malformed stream) so a
 * misbehaving adapter cannot grow memory or corrupt a completed block.
 */
declare class BlockAssembler {
  /**
   * Feed one chunk into the assembly state.
   * @param chunk - the next raw chunk, in stream order.
   */
  push(chunk: StreamChunk): void;
  /**
   * Assemble all blocks seen so far, in stream order.
   * @returns one block per seen index, except that max-token truncation drops
   *   tool calls that cannot be executed safely; an open block assembles from
   *   its accumulated deltas (an unknown block type never closed by `block-end` throws).
   */
  blocks(): ContentBlock[];
  /** Usage from the `usage` chunk; undefined until one arrives. */
  get usage(): TokenUsage | undefined;
  /** Finish reason from the `finish` chunk; `{kind: 'stop'}` when the stream ended without one. */
  get finish(): FinishReason;
  /** Adapter-private replay state from the terminal finish chunk, if any. */
  get replayState(): unknown;
  /**
   * The assembled assistant message.
   * @param source - producer attribution for the assembled message.
   * @returns a frozen assistant-role message over `blocks()` (same open-block assembly rules).
   */
  message(source: MessageSource = { kind: 'plugin', plugin: 'dsh-llm/assembler' }): Message;
}
```

<a id="the-model-request-and-result"></a>

## 模型請求

一次模型呼叫是一個完全組裝好的 `GenerateOptions`。配接器以原始 [`StreamChunk`](#streamchunk--the-raw-protocol) 流作答；消費端用 [`BlockAssembler`](#blockassembler) 組裝它。

原始碼：[`packages/llm/llm/src/types.ts`](../../packages/llm/llm/src/types.ts)

提供方與模型發現使用小型、提供方無關的描述符。模型目錄僅供參考：路由仍以已註冊提供方為鍵，配接器也可以接受未列出的模型 id。

註冊配接器會返回一個控制代碼：既是釋放器，也帶有原子的路由替換——路由集合由使用者設定決定的外掛程式正需要它。

```ts type-equiv
/**
 * What {@link LlmRuntime.registerAdapter} returns: the disposer, plus an
 * atomic route replacement for the same adapter instance.
 */
interface AdapterRegistrationHandle {
  /** Release every route this registration currently holds. */
  (): void
  /**
   * Replace this registration's routes with `providers`, keeping the same
   * adapter instance. The candidate set is validated in full first — a
   * conflict with another adapter, an invalid name, or bad provider metadata
   * throws and leaves the current routes untouched — and the swap itself is
   * one synchronous section, so no request can observe a gap. An empty array
   * is legal here (a settings section that emptied holds zero routes while
   * staying registered), unlike an empty initial registration.
   *
   * Throws `LlmError` with code `REGISTRATION_DISPOSED` once the registration
   * has been released: its routes are gone and its disposer has already run,
   * so anything registered afterwards would have no owner left to release it.
   * @param providers - the complete next route set for this registration.
   */
  replace(providers: string[]): void
}
```

```ts type-equiv
/** Display metadata for one registered provider route. */
interface LlmProviderInfo {
  /** Provider route key used by {@link GenerateOptions.provider}. */
  id: string
  /** Human-readable provider name for selectors and diagnostics. */
  name: string
}
```

配接器外掛程式還會透過 `registerConfigurableProviders()` 聲明哪些路由*可以*執行，並指明每條路由的使用者設定分節，使設定介面能在任何路由註冊之前就呈現休眠的提供方。

```ts type-equiv
/**
 * One provider route an adapter plugin can activate through configuration,
 * whether or not the route is currently registered. Configuration surfaces
 * merge this directory with `listProviders()` to offer every configurable
 * provider alongside its live/dormant state.
 */
interface LlmConfigurableProvider {
  /** Provider route key this entry activates when configured. */
  provider: string
  /** Human-readable provider name for configuration surfaces. */
  displayName: string
  /** User-settings namespace whose section configures this provider. */
  settingsNs: string
  /**
   * Path from that namespace's section root to this provider's profile
   * object; empty when the whole section is the profile.
   */
  settingsPath: readonly string[]
  /**
   * Whether the owning adapter knows this route only because configuration
   * declared it — a gateway or self-hosted server it ships nothing about.
   * Absent means the adapter draws no such distinction; false means it does
   * and this route is one of its own. Only the adapter can answer: a stored
   * profile is how a user-added route AND a corrected shipped one both look
   * from outside.
   */
  declared?: boolean
}
```

```ts type-equiv
/** One adapter-discovered model; catalog membership is advisory, not request validation. */
interface LlmModelInfo {
  /** Provider route that owns this model entry. */
  provider: string
  /** Model id passed to {@link GenerateOptions.model}. */
  id: string
  /** Human-readable model name for selectors. */
  name: string
  /** Optional user-facing distinction from otherwise similar models. */
  description?: string
  /** Accepted request modalities; absent means unknown, while an explicit omission is negative capability. */
  inputModalities?: readonly ModelModality[]
}
```

對正確性敏感的元資料與參考目錄分開解析，並歸服務該確切路由的配接器所有。上下文容量、配接器呼叫預設值和推理選項共用同一個確切模型結果，消費端因而無需重複執行權威模型解析。

```ts type-equiv
/** Provider-owned context capacity for one exact provider/model route. */
interface LlmModelContext {
  /** Maximum combined request and response context in tokens. */
  contextWindow: number
}
```

推理強度是另一項針對確切路由的能力。核心為識別符號新增品牌類型，但不枚舉其值；有序集合、展示名稱和選填的部署預設值均由各配接器持有。

```ts type-equiv
/** Adapter-owned identifier for one model's selectable reasoning effort. */
type ReasoningEffortId = Branded<'ReasoningEffortId'>
```

```ts type-equiv
/** Display metadata for one adapter-owned reasoning effort. */
interface LlmReasoningEffortInfo {
  /** Opaque stable value accepted by {@link GenerateOptions.reasoningEffort}. */
  id: ReasoningEffortId
  /** Human-readable effort name for selectors and diagnostics. */
  name: string
  /** Optional user-facing distinction from otherwise similar efforts. */
  description?: string
}
```

```ts type-equiv
/** Selectable reasoning efforts for one exact provider/model route. */
interface LlmModelReasoningInfo {
  /** Supported efforts in adapter-preferred display order. */
  efforts: readonly LlmReasoningEffortInfo[]
  /**
   * Adapter-configured default materialized into requests when callers omit
   * an effort. Absence preserves the provider's own default.
   */
  defaultEffort?: ReasoningEffortId
}
```

```ts type-equiv
/** Exact-route model metadata resolved by its owning adapter. */
interface LlmResolvedModelInfo extends LlmModelInfo {
  /** Provider-owned context capacity when known. */
  context?: LlmModelContext
  /** Adapter-configured per-request output cap materialized when callers omit one. */
  defaultMaxTokens?: number
  /** Adapter-owned selectable reasoning levels when exposed. */
  reasoning?: LlmModelReasoningInfo
}
```

```ts type-equiv
/** A single model request, fully assembled. */
interface GenerateOptions {
  /** Registered provider route selecting the adapter instance. */
  provider: string
  model: string
  /** Adapter-owned reasoning effort selected for this exact model. */
  reasoningEffort?: ReasoningEffortId
  /**
   * Ordered conversation messages, exactly as the provider sees them (after
   * the `system` slot). A loop-built request assembles them as
   * the derived history (dsh-agent-loop); a hand-built one-shot passes any list.
   */
  messages: Message[]
  /** System prompt text (adapters map to the provider's system slot). */
  system?: string
  /** Tool schemas (adapters map to the provider's `tools` field). */
  tools?: ToolSchema[]
  temperature?: number
  maxTokens?: number
  /**
   * Stop sequences: generation halts as soon as the model produces any one of
   * these strings (adapters map to the provider's stop field, e.g. OpenAI
   * `stop`). The stop string itself is not included in the output.
   */
  stop?: string[]
  signal?: AbortSignal
  /**
   * Session identity stamped by the loop for request routing. Replay uses it
   * to separate cursors; adapters may map it to model-hidden transport metadata.
   */
  sessionId?: Branded<'SessionId'>
  /**
   * Provider-neutral classification for an auxiliary model call. Adapters may
   * map the purpose to model-hidden transport metadata or purpose-specific
   * generation policy. Ordinary conversation requests leave it unset.
   */
  purpose?: 'compaction' | 'session-title'
}
```

模型回應為何停止由可合併擴充的原因表示。提供方終態失敗攜帶流式約定的 [`LlmFailure`](#llmfailure)：

```ts type-equiv
/**
 * Why a model response stopped.
 * Merge-extensible so adapters can surface provider-specific reasons.
 */
interface FinishReasonMap {
  'stop': { kind: 'stop' }
  'tool-calls': { kind: 'tool-calls' }
  'max-tokens': { kind: 'max-tokens' }
  'aborted': { kind: 'aborted'; failure: LlmFailure }
  'error': { kind: 'error'; failure: LlmFailure }
}
```

`FinishReason = FinishReasonMap[keyof FinishReasonMap]`。`TokenUsage`（逐呼叫計量，含不相交的快取欄位）詳見[下文](#tokenusage)。

`GenerateOptions.tools` 攜帶 `ToolSchema`——工具的 JSON Schema 描述，傳送給模型。它聲明在 dsh-llm（而非 dsh-tools）中，正是因為它是迴圈每一步組裝請求的一部分：

```ts type-equiv
/**
 * JSON-schema description of a tool, as sent to the model.
 *
 * Declared here (not in dsh-tools) because it is part of {@link GenerateOptions};
 * dsh-tools' ToolDefinition and dsh-system-prompt's PromptAssembly both import
 * it from this package.
 */
interface ToolSchema {
  name: string
  description: string
  /** JSON Schema object for the arguments. */
  parameters: Record<string, unknown>
}
```

面向模型的 `ToolSchema` 是協議類型；產出它的已註冊 `ToolDefinition`（schema + `execute`）在 [tools.md](tools.md) 中。

介面正在起草的提供方既沒有路由也沒有 catalog，因此詢問被單獨描述：請求攜帶使用者正在編輯的草稿，回覆是介面可以採納的候選，而不是它必須服務的 catalog。

```ts type-equiv
/**
 * One interrogation of a provider endpoint that configuration has not stored
 * yet. Configuration surfaces send the draft a user is still editing, so the
 * request carries the endpoint and credential directly instead of naming a
 * route: a provider being added has no route to name.
 */
interface LlmModelDiscoveryRequest {
  /**
   * Route the draft is editing, when it edits an existing one. A route whose
   * adapter already knows its models answers from that knowledge instead of
   * asking the endpoint — the adapter's own registry is the better answer, and
   * it costs no network call.
   */
  provider?: string
  /**
   * Endpoint to interrogate. Optional because a route the adapter already
   * describes needs none; a route it does not must supply one.
   */
  baseURL?: string
  /** Wire protocol the endpoint speaks, when the draft names one. */
  api?: string
  /** Credential for this interrogation alone; the harness never stores it. */
  apiKey?: string
  /** Caller cancellation; implementations must settle promptly after it aborts. */
  signal?: AbortSignal
}
```

```ts type-equiv
/**
 * One model an endpoint reports about itself. Every field but the id is
 * optional because most provider listings disclose an id and nothing else;
 * a surface adopting one of these still owes the capacities its adapter needs.
 */
interface LlmDiscoveredModel {
  /** Model id the endpoint accepts. */
  id: string
  /** Human-readable name when the endpoint supplies one. */
  name?: string
  /** Maximum combined request and response context, when disclosed. */
  contextWindow?: number
  /** Maximum output tokens, when disclosed. */
  maxTokens?: number
}
```

### 請求信封：`LlmCallConfig` 與記錄的 header

迴圈從已記錄狀態建置每個請求。`EpochHeader` 記錄呼叫設定，標記由配接器預設值提供的欄位，並透過完整的 `request/header` 快照記錄渲染後的提示詞以及權威返回工具順序（由 `toolOrder` 設定；未設定時按字典序）。結合派生歷史，請求便可由工作階段日誌重建。見 [session.md](session.md#the-request-header-event-requestheader) 與[可重建性 Agent Note](../../.agents/notes/implemented/architecture/2026-07-05-reconstructable-requests.md)。

`agent/request` 接收凍結的呼叫設定種子，並可返回替代值以切換提供方、模型、推理強度或採樣參數。waterfall（瀑布式事件）開始前，迴圈會移除標記為配接器預設值的值，使確切模型準備過程填入所選路由的當前值；未帶標記的顯式設定仍保留在提議中。waterfall 結束後，準備過程會在輪次訊號控制下拒絕顯式指定但不受支持的推理強度 ID（不自動調整），並記錄生效設定以及由配接器預設值提供的欄位。準備完成的呼叫直至分派完成始終持有同一項配接器註冊。到達 `llm/stream` 的請求會被深度凍結，因此變更會拋例外；請求還攜帶行程本機迴圈標識，使觀察者不會把單獨記錄的凍結輔助呼叫誤認成對話請求。

在協議中，迴圈建置的請求先讀取 `system` slot（渲染後的提示詞組裝），再讀取派生歷史。已記錄的請求快照會以最新的 `user/message`（輪次首步）或上一步的工具結果（後續步驟）結尾。開發不變式針對每個迴圈建置的請求精確重算此等式。

FIXME(call-config-shape)：重新審視其餘哪些欄位出於快取目的確實屬於 epoch 層級（`model` 和模型持有的推理強度已明確屬於；取樣標量目前出於謹慎保留在此）。

```ts type-equiv
/**
 * Provider, model, reasoning effort, and sampling scalars of one conversation's
 * requests. Every field maps 1:1 onto the same-named `GenerateOptions` field;
 * the loop builds requests from the logged header rather than accepting these
 * per call.
 */
interface LlmCallConfig {
  provider: string
  model: string
  reasoningEffort?: ReasoningEffortId
  temperature?: number
  maxTokens?: number
  stop?: string[]
}
```

```ts type-equiv
/**
 * Effective config fields supplied by exact-model adapter resolution rather
 * than by the caller's request proposal.
 */
interface LlmCallConfigAdapterDefaults {
  reasoningEffort?: true
  maxTokens?: true
}
```

## 服務與提供方約定

`LlmAdapter` 是提供方約定：建立子類、實作 `stream()`，再用 `ctx.llm.registerAdapter(providers, adapter)` 註冊一個配接器實例。`GenerateOptions.provider` 選擇已註冊配接器；`GenerateOptions.model` 會傳給該配接器，無需在生命週期啟動時註冊。重複提供方路由會原子失敗。選填的 `providerRetryPolicy()` 會按路由捕獲並填入 normal 預設值，`providerInfo()` 與非同步 `listModels()` 方法則為 `LlmRuntime.listProviders()` / `listModels()` 提供分離的 selector 元資料。該目錄僅供參考，不是請求白名單：配接器仍是權威，並可接受未列出的模型 id。單次非同步 `resolveModel()` 查詢返回確切模型身份，以及選填的對正確性敏感的上下文容量、配接器設定的 `defaultMaxTokens`、由模型持有的有序推理強度 ID 和選填的部署預設值；欄位缺失表示元資料不可用或保留提供方持有的行為，而不表示目錄成員關係無效。解析器會接收選填的取消訊號，並且必須在訊號中止後迅速完成結帳。`LlmRuntime.resolveModelInfo()` 會校驗聚合結果並返回分離值。在最終配接器邊界，`resolveCallConfig()` 僅在 `maxTokens` 缺失時填入輸出預設值，並校驗和填入推理強度，因此直接呼叫也無法繞過任何一項已設定行為；直接分派會在等待解析前捕獲一項配接器註冊。agent loop 則使用 `prepareCall()`，使模型解析、請求標頭持久記錄和分派全程使用同一項註冊，保留來自同一次查詢的分離上下文元資料，並報告配接器填入的設定欄位。配接器尋找發生在 `llm/stream` waterfall 的終端機 continuation，因此 listener 可以在尋找前短路呼叫，或路由一個可變的一次性請求。AgentLoop 在外層 waterfall 返迴流控制代碼時觀察到一次請求嘗試；這個有限邊界不能證明惰性終端機配接器已構造完成或開始提供方 I/O。`block-start` / `block-end` 的 `index` 關聯與 assembler 共同意味著配接器只需 emit 格式正確的區塊——塊重組不是每個配接器各自的問題。`ctx.llm.stream()` 與 `llm/stream` waterfall 在一個輪次中的位置見 [architecture.md](../architecture.md#turn-flow)。

```ts type-equiv
/** One model call whose config and adapter registration were resolved together. */
interface PreparedLlmCall {
  /** Detached, deep-frozen config with any adapter-owned default materialized. */
  readonly config: LlmCallConfig
  /** Immutable retry policy captured with the adapter registration. */
  readonly retryPolicy: ResolvedRetryPolicy
  /** Detached context metadata resolved with the registration-bound call. */
  readonly context?: LlmModelContext
  /** Config fields materialized by the captured adapter rather than proposed by the caller. */
  readonly adapterDefaults: LlmCallConfigAdapterDefaults
  /**
   * Dispatch this call once through the registration captured during
   * preparation. The request's call-config fields must match {@link config};
   * reuse or mismatch fails with `INVALID_PREPARED_CALL`.
   * @param options - fully assembled request carrying the prepared config.
   * @returns the chunk stream, including the `llm/stream` waterfall.
   */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}
```

```ts public-api
/**
 * Provider-wire adapter for the harness message and stream vocabulary. Register implementations
 * with `ctx.llm.registerAdapter(providers, adapter)`. Every provider HTTP request must include
 * `attributionHeaders()`; prove the headers are added in the wire request or library header hook. The direct-fetch
 * DeepSeek and library-backed pi-ai adapters meet this contract through different internals.
 */
declare abstract class LlmAdapter {
  /**
   * Describe one provider route owned by this adapter.
   * @param provider - a route passed to `registerAdapter()` for this instance.
   * @returns detached display metadata whose id must equal `provider`.
   */
  providerInfo(provider: string): LlmProviderInfo;
  /**
   * Return the provider-owned retry policy captured with this route.
   * @param _provider - a route passed to `registerAdapter()` for this instance.
   * @returns a resolved policy, or `undefined` to use the normal defaults.
   */
  providerRetryPolicy(_provider: string): ResolvedRetryPolicy | undefined;
  /**
   * List models this adapter can currently advertise for one owned provider.
   * The result is advisory: an adapter may accept unlisted model ids, and
   * consumers must not turn absence into request rejection.
   * @param _provider - one provider route owned by this adapter.
   * @returns discoverable models in adapter-preferred order.
   */
  listModels(_provider: string): Promise<readonly LlmModelInfo[]>;
  /**
   * Resolve all metadata available for one exact model. This query is
   * independent of the advisory catalog and does not validate request routing.
   * @param provider - one provider route owned by this adapter.
   * @param model - exact model id passed to {@link GenerateOptions.model}.
   * @param _signal - cancellation for this exact-model lookup; asynchronous
   *   implementations must settle promptly after it aborts.
   * @returns provider/model identity plus any context, call-default, and reasoning metadata.
   */
  resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo>;
  /**
   * Stream one model call as raw chunks. The only required method.
   * @param options - the fully-assembled request; implementations must honor `options.signal`.
   * @returns the chunk stream, obeying the adapter contract documented on `StreamChunk`.
   */
  abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
```

`ContentBlockType`（帶 `index` 關聯的塊所攜帶的鍵集合）從上文的 [`ContentBlockMap`](#content-blocks-and-messages) 派生。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxllm--llmruntime"></a>

### `ctx.llm` — `LlmRuntime`

The abstract `llm` service: an adapter registry plus a streaming model-call API, interceptable via the `llm/stream` waterfall.

```ts cordis-catalog
/**
 * Register an adapter for the given provider routes. Throws `LlmError` with code
 * `DUPLICATE_ADAPTER` if any provider already has an adapter (all-or-nothing).
 * Disposed with the fiber.
 * @param providers - every provider route this adapter should serve.
 * @param adapter - the adapter that streams calls for those providers.
 * @returns the disposer, carrying {@link AdapterRegistrationHandle.replace}.
 */
registerAdapter(providers: string[], adapter: LlmAdapter): AdapterRegistrationHandle

/**
 * Describe provider routes with a registered adapter.
 * @returns detached provider metadata in registration order.
 */
listProviders(): LlmProviderInfo[]

/**
 * Declare provider routes an adapter plugin can activate through
 * configuration. Registration is all-or-nothing: an empty list, invalid
 * entry, or a provider already declared by any registration throws
 * `LlmError` without registering the rest. Disposed with the fiber.
 * @param entries - every configurable provider this plugin owns.
 * @returns a handle that withdraws all of them, and can atomically replace them.
 */
registerConfigurableProviders(entries: readonly LlmConfigurableProvider[]): DirectoryRegistrationHandle

/**
 * List every declared configurable provider, registered or dormant.
 * @returns detached directory entries in declaration order.
 */
listConfigurableProviders(): LlmConfigurableProvider[]

/**
 * Offer to interrogate provider endpoints on behalf of the settings
 * namespace this plugin owns. The namespace is the key because that is what
 * a configuration surface already holds from the configurable-provider
 * directory, and because a provider being *added* has no route to name yet.
 * Disposed with the fiber.
 * @param settingsNs - the namespace whose profiles this discovery serves.
 * @param discover - interrogates one endpoint; must honor `request.signal`.
 * @returns the disposer that withdraws the offer.
 */
registerModelDiscovery( settingsNs: string, discover: (request: LlmModelDiscoveryRequest) => Promise<readonly LlmDiscoveredModel[]>, ): () => void

/**
 * Interrogate one provider endpoint for the models it advertises. The
 * request describes a draft, not a stored route, so nothing here reads or
 * writes settings or credentials — the caller owns both, and the reply is
 * candidate metadata a surface may offer for adoption.
 * @param settingsNs - namespace whose registered discovery serves this draft.
 * @param request - the endpoint, protocol, and one-shot credential to use.
 * @returns the advertised models, deduplicated in endpoint order.
 */
async discoverModels( settingsNs: string, request: LlmModelDiscoveryRequest, ): Promise<LlmDiscoveredModel[]>

/**
 * Resolve the retry policy captured when one provider route was registered.
 * @param provider - registered provider route to inspect.
 * @returns the provider-owned policy, with normal defaults already resolved.
 */
providerRetryPolicy(provider: string): ResolvedRetryPolicy

/**
 * Discover models advertised by one registered provider. Catalog membership
 * is advisory and never changes routing or request validation.
 * @param provider - registered provider route to inspect.
 * @returns detached model metadata in adapter-preferred order.
 */
async listModels(provider: string): Promise<LlmModelInfo[]>

/**
 * Resolve and validate all metadata from the adapter that owns one exact
 * route. The result is detached from adapter-owned objects; catalog
 * membership remains advisory and does not control request routing.
 * @param provider - registered provider route to inspect.
 * @param model - exact model id passed to the adapter.
 * @param signal - optional cancellation for adapter-owned asynchronous lookup.
 * @returns exact model identity plus available context and reasoning metadata.
 */
async resolveModelInfo( provider: string, model: string, signal?: AbortSignal, ): Promise<LlmResolvedModelInfo>

/**
 * Validate a conversation call config against its exact model capability and
 * materialize adapter-configured defaults. Unsupported explicit efforts
 * reject before provider I/O; no clamping or aliasing is performed. This
 * standalone query does not bind a later dispatch; use {@link prepareCall}
 * when logging and streaming must share one adapter registration.
 * @param config - provider/model route and optional request controls.
 * @param signal - optional cancellation for adapter-owned capability lookup.
 * @returns a detached config only when a default must be materialized.
 */
async resolveCallConfig(config: LlmCallConfig, signal?: AbortSignal): Promise<LlmCallConfig>

/**
 * Resolve one call under its current adapter registration. The returned
 * one-shot handle keeps that registration across header logging and dispatch,
 * so HMR cannot combine one adapter's capability result with another adapter.
 * @param config - provider/model route and optional request controls.
 * @param signal - optional cancellation for adapter-owned capability lookup.
 * @returns a prepared config and its registration-bound stream entry point.
 */
async prepareCall(config: LlmCallConfig, signal?: AbortSignal): Promise<PreparedLlmCall>

/**
 * Stream one model call as raw chunks (token-level deltas). Replay state is
 * retained only when the same adapter instance owns its historical provider
 * and the target provider. Final adapter selection remains fixed through
 * asynchronous exact-model resolution and dispatch. Adapter selection,
 * dispatch, and iteration failures become terminal `error` or `aborted`
 * finish chunks; middleware, nested-call, cleanup, and consumer failures
 * remain thrown.
 * @param options - the full request; `options.provider` selects the adapter.
 * @returns the chunk stream, possibly wrapped by `llm/stream` listeners.
 */
stream(options: GenerateOptions): AsyncIterable<StreamChunk>
```

Source: [`packages/llm/llm/src/index.ts:284`](../../packages/llm/llm/src/index.ts)

<a id="llm-events"></a>

### `llm/*` events

<a id="llmadapters-updated--emit"></a>

#### `llm/adapters-updated` — emit

The provider topology changed: an adapter registered or unregistered routes, or the configurable-provider directory gained or lost entries. This payload-free registry notification fires at each commit point (including registration disposal); consumers re-read `listProviders()`, `listModels()`, or `listConfigurableProviders()` for the new state. Observer failures are contained and cannot veto the registry mutation.

```ts cordis-catalog
/**
 * The provider topology changed: an adapter registered or unregistered
 * routes, or the configurable-provider directory gained or lost entries.
 * This payload-free registry notification fires at each commit point
 * (including registration disposal); consumers re-read `listProviders()`,
 * `listModels()`, or `listConfigurableProviders()` for the new state.
 * Observer failures are contained and cannot veto the registry mutation.
 * @mode emit
 */
'llm/adapters-updated'(): void
```

Source: [`packages/llm/llm/src/types.ts:23`](../../packages/llm/llm/src/types.ts)

<a id="llmstream--waterfall"></a>

#### `llm/stream` — waterfall

Waterfall around every streaming model call (retry, replay, routing). Bound to the LlmRuntime; call `next()` to reach the resolved adapter's stream, or yield your own chunks to short-circuit.

```ts cordis-catalog
/**
 * Waterfall around every streaming model call (retry, replay, routing).
 * Bound to the {@link LlmRuntime}; call `next()` to reach the resolved
 * adapter's stream, or yield your own chunks to short-circuit.
 * @param options - the full request. A LOOP-built request carries the
 *   process-local {@link markAgentLoopRequest} identity and arrives deep-frozen
 *   (mutation throws): its content is a pure function of the session log (the
 *   reconstructability Agent Note), so listeners read it, never rewrite it.
 *   Hand-built calls do not carry that marker; their messages already obey
 *   the immutable creation contract.
 * @mode waterfall
 */
'llm/stream'(this: LlmRuntime, options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>
```

Source: [`packages/llm/llm/src/index.ts:64`](../../packages/llm/llm/src/index.ts)
<!-- END GENERATED cordis-surface -->
