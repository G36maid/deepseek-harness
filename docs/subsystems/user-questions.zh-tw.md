# 使用者互動

[English](user-questions.md) | [简体中文](user-questions.zh.md) | 繁體中文

[dsh-user-questions](../../packages/interaction/user-questions) 的使用者互動 seam。它是工具或權限外掛程式需要人類回答後 agent（代理）才能繼續時所使用的、提供方無關的詞彙。UI 介面提供活躍的 `UserQuestionProvider`；host 執行時期把請求轉發給其連線的用戶端。

原始碼：[`packages/interaction/user-questions/src/index.ts`](../../packages/interaction/user-questions/src/index.ts)

## 問題選項

`AskUserQuestionOption` 包含一個可供選擇的選項。`label` 是面向使用者的選項文字，同時也是面向模型的選中值；`description` 是選填的 UI 幫助文字。

```ts type-equiv
/** One selectable answer offered to the user. */
interface AskUserQuestionOption {
  /** User-facing label. */
  label: string
  /** Optional extra context rendered by capable UIs. */
  description?: string
}
```

## 呈現意圖

`AskUserQuestionIntent` 選填地聲明一種已知的決策類型。它按 `kind` 打標籤，因此可以增加新的意圖；不認識某個標籤的 UI 渲染通用選項清單。意圖只改變呈現方式——遵循它的 UI 回答的仍是通用 UI 會發送的那些選項標籤，因此呼叫方兩種情況下讀到的回答欄位相同。`approve` 指名肯定選項，而不相依性選項順序。`ask()` 會拒絕兩種無法由類型系統表達的情況：`approve` 未指向該問題自身的任何選項，以及為沒有 `detail` 的問題指定意圖。

```ts type-equiv
/**
 * A caller-declared presentation intent: the question IS this kind of
 * decision, so a UI that recognises the tag may present it as such instead of as a
 * generic option list. Tagged so further intents can be added; a UI that does
 * not know a tag renders the generic flow, and the answer encoding is identical
 * either way — an intent changes presentation only, never the protocol.
 */
type AskUserQuestionIntent = {
  /** A plan submitted for review: `detail` is the plan markdown `ask()` requires, and the decision approves or declines it. */
  kind: 'plan-review'
  /**
   * The option label that approves the plan; every other option declines it.
   * Named rather than positional so no UI infers the verdict from option order.
   * An `approve` naming no option of its own question is rejected at `ask()`.
   */
  approve: string
}
```

## 問題條目

`AskUserQuestionItem` 是請求中的一個問題。呼叫方提供穩定的 `id`，它會隨答案原樣返回，使批次問題仍可路由。選填的 `detail` 攜帶輔助文字；提供方會將其隨問題渲染，但不會放入選填選項標籤。

```ts type-equiv
/** One question in a user-questions request. */
interface AskUserQuestionItem {
  /** Stable caller-provided question id, echoed in the answer. */
  id: string
  /** The question to display. */
  question: string
  /** Optional supporting detail rendered with the question but kept out of option labels. */
  detail?: string
  /** Optional short heading/group label. */
  header?: string
  /** Optional choices the UI can render as a menu. */
  options?: AskUserQuestionOption[]
  /** Whether more than one option may be selected. Defaults to single-select. */
  multiSelect?: boolean
  /** Optional presentation intent for capable UIs; absent asks for the generic option list. */
  intent?: AskUserQuestionIntent
}
```

## 提問請求

`AskUserQuestionRequest` 是跨包請求。`questions` 是陣列，這樣 UI 可以在一個流程中呈現相關提示，同時保持每個回答有穩定的 id。如提供 `agent`，它必須與存活呼叫方是同一實例；只有當當前登錄檔將該實例識別為執行時期根時，互動 seam 才會接納該 agent。

```ts type-equiv
/** Request for a human answer. */
interface AskUserQuestionRequest {
  /** Questions to display. */
  questions: AskUserQuestionItem[]
  /** Exact live calling agent, when the request came from an agent tool call. */
  agent?: Agent
  /** Abort signal for the owning tool/step. */
  signal?: AbortSignal
}
```

## 回答

提供方為每個問題 id 返回一個回答項。`selected` 包含選中的選項標籤，`custom` 在使用者輸入自由文字時攜帶「其他」回答。對於單選題，`custom` 會覆蓋選中的選項，且 `selected` 為空。對於多選題，`custom` 可以補充 `selected` 中的標籤。UI 也可以使用 `selected` 為空且不含 `custom` 的回答項，在其餘問題均已完成的批次中保留被跳過的問題。

```ts type-equiv
/** Answer to one question. */
interface AskUserQuestionAnswerItem {
  /** The answered question id. */
  id: string
  /** Selected option labels. May accompany custom text for a multi-select question. */
  selected: string[]
  /** Optional free-text "Other" answer. */
  custom?: string
}
```

```ts type-equiv
/** The human's answer. */
interface AskUserQuestionAnswer {
  /** Structured answers keyed by question id. */
  answers: AskUserQuestionAnswerItem[]
}
```

## 提供方

同一上下文中只能有一個活躍的提供方。提供方註冊綁定到 effect，因此 HMR（熱模組替換）或 dispose（資源釋放）會移除當前活躍的 UI。

```ts type-equiv
/** UI-side provider for user questions. */
interface UserQuestionProvider {
  ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
}
```

## 錯誤

`UserQuestionError` 繼承 `HarnessError`，因此 `ctx.tools.execute()` 會保留 `{ name, code }`，用於面向模型的工具失敗，如 `EMPTY_QUESTIONS`、`NO_PROVIDER`、`ASK_ABORTED` 或 UI 側取消。

```ts type-equiv
/** Stable error taxonomy for user-questions failures. */
class UserQuestionError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'UserQuestionError'
  }
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxuserquestions--userquestionservice"></a>

### `ctx.userQuestions` — `UserQuestionService`

`ctx.userQuestions`: one active UI provider plus an `ask()` API.

```ts cordis-catalog
/**
 * Register the UI provider. Only one provider may be active in a context.
 *
 * @param provider UI-side implementation that collects answers.
 * @returns Disposer that unregisters this provider.
 */
registerProvider(provider: UserQuestionProvider): () => void

/**
 * Ask the active UI provider and wait for the user's answer.
 *
 * When a caller supplies an agent, human interaction is valid only for the
 * exact live runtime root. Runtime ownership, not durable session lineage,
 * decides this boundary: an owned child has no human answerer and would
 * block forever, while a lineage-bearing session resumed as a new runtime
 * root may ask normally.
 *
 * @param request Questions, owner agent, and abort signal.
 * @returns The answer chosen or typed by the human.
 * @throws {UserQuestionError} code `CALLER_NOT_LIVE` when a supplied
 *   agent is not the registry's exact live instance, or `DELEGATED_CALLER`
 *   when that live agent is owned by another agent.
 */
async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
```

Source: [`packages/interaction/user-questions/src/index.ts:51`](../../packages/interaction/user-questions/src/index.ts)
<!-- END GENERATED cordis-surface -->
