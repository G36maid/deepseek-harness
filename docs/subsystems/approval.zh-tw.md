# 使用者審批

[English](approval.md) | [简体中文](approval.zh.md) | 繁體中文

[dsh-user-approval](../../packages/interaction/user-approval) 的使用者審批 seam 回答一個問題：這個具體操作是否可以繼續？它擁有共享的請求/結果詞彙、`ctx.approval` 分發服務、`approval/request` 應答者 waterfall（瀑布式事件）、僅記錄日誌的審計事件對，以及按工作階段的 `ask`/`never` 策略。UI 通道可以提供人類應答者；[ACP（Agent Client Protocol）自動化橋接層](../../packages/acp/acp)為其擁有的 agent（代理）提供一次性機器決策。呼叫方如 [dsh-tools](../../packages/core/tools) 和 [dsh-tool-bash](../../packages/shell/tool-bash) 消費閉合的結果，除非結果為 `allowed-once`，否則一律拒絕。

原始碼：[`packages/interaction/user-approval/src/index.ts`](../../packages/interaction/user-approval/src/index.ts)

## 標識與結果

每個請求都會獲得一個全新的 `ApprovalRequestId`。該品牌類型將 `approval/asked` 與 `approval/decided` 審計事件配對，同時不會讓審批 id 與工具呼叫 id 或 agent/工作階段 id 互換。

```ts type-equiv
/**
 * Pairs one `approval/asked` audit event with its `approval/decided`.
 * Service-issued (one fresh id per {@link ApprovalService.request} call).
 */
type ApprovalRequestId = Branded<'ApprovalRequestId'>
```

`ApprovalOutcome` 是閉合的，且失敗時拒絕。`allowed-once` 僅授權所詢問的那一個操作；呼叫方對 `rejected`、`cancelled` 和 `unavailable` 均執行拒絕。缺失、不負責該請求、拋例外或不合規的應答者會產生 `unavailable`，而非放行。

```ts type-equiv
/**
 * Closed approval outcomes: a one-shot grant, explicit rejection, withdrawn
 * request, or unavailable answerer. Callers fail closed on `unavailable`.
 */
type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
```

## 按工作階段策略

`ApprovalPolicy` 決定在互動式應答者執行之前發生什麼。`ask` 委託給組合的應答者鏈，鏈的無應答預設值為 `unavailable`；`never` 確定性地返回 `rejected`，不分發任何應答者。生效值為工作階段日誌中最後一條 `approval/policy` 事件，回退到服務設定。`setApprovalPolicy(session, policy)` 是唯一的寫入路徑，因此重播能重建覆蓋值。

```ts type-equiv
/**
 * A session's approval policy — what happens to an {@link ApprovalService}
 * ask BEFORE any interactive answerer sees it:
 *
 * - `'ask'` (the default) — delegate to the composed answerers; with none
 *   composed the chain falls through to the fail-closed `'unavailable'`.
 * - `'never'` — never prompt anyone: every ask resolves `'rejected'`
 *   deterministically. The strict headless stance (CI, unattended runs) and
 *   the policy whose outcome is knowable without asking.
 */
type ApprovalPolicy = 'ask' | 'never'
```

兩種策略都會將各自完整的當前含義貢獻給快取安全的執行時期上下文快照。帶來源的 `user/message` 是持久化且模型可見的輸入；審批狀態變化時，會在保留的歷史後追加一份新的完整快照，而不改寫請求標頭中的系統提示詞。

## 審批請求

`ApprovalRequest` 以足夠精確的方式標識 agent 和工具操作，以便路由和審計該問題。它有意省略工具參數：應答者透過 `callId` 將提示附加到已流式輸出的工具呼叫上，而非渲染另一份可能漂移的副本。

```ts type-equiv
/**
 * Readonly same-process permission question. `callId` links to an already
 * presented tool call, so arguments are not duplicated here.
 */
interface ApprovalRequest {
  /**
   * The agent on whose behalf the question is asked. Routes the question (a
   * UI answerer only answers for agents it owns) and receives the audit
   * events on its session log.
   */
  readonly agent: Agent
  /** The tool the question is about (presentation and audit). */
  readonly toolName: string
  /**
   * The exact tool call being decided, when the asker has one — lets a UI
   * attach the prompt to the tool call it already streamed.
   */
  readonly callId?: CallId
  /** The asker's human-readable explanation of WHY it is asking. */
  readonly reason?: string
  /**
   * Aborting withdraws the question: the request settles `'cancelled'`
   * immediately and a late answer from a still-pending answerer is discarded.
   */
  readonly signal?: AbortSignal
}
```

## 分發與審計

`ctx.approval.request(req)` 要求發起請求的工作階段處於一個尚未結束的輪次內。它追加 `approval/asked`，取得一個結果，追加對應的 `approval/decided`，然後以該結果完成。`never` 策略在服務內部、waterfall 分發之前強制執行，因此即使後來以 `prepend` 註冊的應答者也無法繞過它。應答者在負責處理該請求時返回結果，否則呼叫 `next()` 委託；第一個應答佔據唯一的決策槽位。

審計事件僅寫入日誌，不進入模型 transcript（文字記錄）。模型可見的行為是呼叫方派生的工具結果與當前執行時期上下文快照。服務 dispose（資源釋放）時會移除其上下文貢獻；應答者監聽器獨立地透過 effect 綁定到其所屬外掛程式。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxapproval--approvalservice"></a>

### `ctx.approval` — `ApprovalService`

Approval service that applies session policy before answerers and logs every ask/outcome pair to the requesting session. It exposes deterministic policy changes to the model through the runtime-context snapshot and switch notices.

```ts cordis-catalog
/**
 * Switch one live agent's policy and queue the transition for its next model
 * step. Session initialization uses {@link setApprovalPolicy} directly
 * because there is no previously visible policy to change.
 * @param agent - the live agent whose policy is changing.
 * @param policy - the new effective policy.
 */
setPolicy(agent: Agent, policy: ApprovalPolicy): void

/**
 * Ask the composed answerers to decide one readonly same-process request.
 * The service borrows the request, agent, session, and live signal directly.
 * The request requires an open turn because the audit pair must be enclosed
 * by the durable log's commit/replay boundary; an idle ask rejects before
 * appending anything. The answerer phase always produces an outcome: an
 * aborted signal yields `'cancelled'`, a missing or throwing answerer yields
 * `'unavailable'` (fail closed), and a rogue non-vocabulary return value is
 * normalized to `'unavailable'`. A failure that prevents either audit append
 * from committing still rejects because returning an unlogged decision would
 * violate the pair. Session contains post-commit observer failures, so an
 * authoritative append cannot reject the request or suppress its matching
 * audit event.
 * @param req - the pending decision (agent, tool identity, reason, signal).
 * @returns the closed outcome; `'allowed-once'` is the only grant.
 * @throws when no turn is open or either audit event fails before the session
 *   append commit point.
 */
async request(req: ApprovalRequest): Promise<ApprovalOutcome>

/**
 * Read the session override without applying the configured default.
 * @param session - session whose log supplies the override.
 * @returns the last logged policy, or `undefined` without one.
 */
overrideOf(session: Session): ApprovalPolicy | undefined
```

Types: [Agent](core.md) · [Session](session.md)

Source: [`packages/interaction/user-approval/src/index.ts:192`](../../packages/interaction/user-approval/src/index.ts)

<a id="approval-events"></a>

### `approval/*` events

<a id="approvalrequest--waterfall"></a>

#### `approval/request` — waterfall

Ask composed answerers for one decision. Return an outcome to claim the request or call `next()`; failure yields the fail-closed default. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.

```ts cordis-catalog
/**
 * Ask composed answerers for one decision. Return an outcome to claim the
 * request or call `next()`; failure yields the fail-closed default.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @param req - the pending decision (agent, tool identity, reason, signal).
 * @mode waterfall
 */
'approval/request'(this: Scoped<ApprovalService>, req: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>
```

Types: [Scoped](scope.md)

Source: [`packages/interaction/user-approval/src/index.ts:30`](../../packages/interaction/user-approval/src/index.ts)
<!-- END GENERATED cordis-surface -->
