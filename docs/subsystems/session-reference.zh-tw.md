# 工作階段引用

[English](session-reference.md) | [简体中文](session-reference.zh.md) | 繁體中文

結構化的跨工作階段引用請求與準備後的訊息上下文。[包約定](../../packages/context/session-reference) 定義規範 URI、當前表層投影、標籤安全的 JSON 與位元組保留、穩定錯誤和不可信的模型提示詞。宿主配接器使用這些類型，而不會把各自 UI 的提及文法傳入 agent（代理）核心。

來源：[`packages/context/session-reference/src/types.ts`](../../packages/context/session-reference/src/types.ts)

## 輸入與候選項

`SessionReferenceInput` 是與宿主無關的選擇。id 具有權威性；label 是隨快照攜帶的顯示中繼資料。

```ts type-equiv
/** One source session selected by a host. */
interface SessionReferenceInput {
  /** Opaque source session identity. */
  sessionId: SessionId
  /** Optional user-facing mention label. */
  label?: string
}
```

`SessionReferenceCandidate` 是面向宿主的發現輸出。存在最新工作階段標題時，它的 label 使用該標題；篩選仍只搜尋 session id 和 cwd，絕不搜尋 transcript（文字記錄）。

```ts type-equiv
/** One host-facing candidate from exact session metadata. */
interface SessionReferenceCandidate {
  /** Opaque source session identity. */
  sessionId: SessionId
  /** Latest log-backed title, falling back to the opaque session id. */
  label: string
  /** Source session working directory, when recorded. */
  cwd?: string
  /** Source session creation time in Unix epoch milliseconds. */
  createdAt: number
}
```

## 準備後的訊息

準備程序保留可讀的當前訊息內容，並最多返回一個聚合上下文。

```ts type-equiv
/** Direct message content and optional referenced-session context. */
interface PreparedReferencedMessage {
  /** Readable message content after host mention tokens are removed. */
  content: ContentBlock[]
  /** Aggregated untrusted snapshot, absent when the message has no references. */
  additionalContext?: UserMessage
}
```

## 錯誤

`SessionReferenceError.code` 區分無效設定或輸入、自引用、數量限制、源讀取失敗、預算失敗和取消。宿主協定會把這些 code 對映到各自的錯誤封裝，無需檢查提示詞位元組。

```ts type-equiv
/** Stable failure codes exposed to host adapters. */
type SessionReferenceErrorCode =
  | 'SESSION_REFERENCE_INVALID_CONFIG'
  | 'SESSION_REFERENCE_INVALID_REFERENCE'
  | 'SESSION_REFERENCE_SELF_REFERENCE'
  | 'SESSION_REFERENCE_TOO_MANY'
  | 'SESSION_REFERENCE_READ_FAILED'
  | 'SESSION_REFERENCE_BUDGET_EXCEEDED'
  | 'SESSION_REFERENCE_CANCELLED'
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsessionreferenceresolver--sessionreferenceresolver"></a>

### `ctx.sessionReferenceResolver` — `SessionReferenceResolver`

Exact-read consumer that prepares immutable cross-session message context.

```ts cordis-catalog
/**
 * List reference candidates, ranked by working-directory affinity.
 * @param agent - target agent; self is excluded and its cwd drives ranking.
 * @param query - optional case-insensitive session-id/cwd/title substring.
 * @param limit - optional positive result cap.
 * @param signal - optional cancellation boundary for host autocomplete teardown.
 * @returns candidates labeled by latest title or, when absent, session id.
 */
async listCandidates( agent: Agent, query: string = '', limit: number = this.config.candidateLimit, signal?: AbortSignal, ): Promise<SessionReferenceCandidate[]>

/**
 * Snapshot all references before enqueue and return one aggregated durable context.
 * @param agent - target agent; references to it are rejected.
 * @param content - already host-normalized readable message content.
 * @param references - structured source sessions in mention order.
 * @param signal - optional cancellation boundary for host request teardown.
 * @returns detached content and optional referenced-session context.
 */
async prepare( agent: Agent, content: ContentBlock[], references: SessionReferenceInput[], signal?: AbortSignal, ): Promise<PreparedReferencedMessage>
```

Types: [Agent](core.md) · [ContentBlock](llm-streaming.md)

Source: [`packages/context/session-reference/src/index.ts:70`](../../packages/context/session-reference/src/index.ts)
<!-- END GENERATED cordis-surface -->
