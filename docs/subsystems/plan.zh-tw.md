# 計畫模式

[English](plan.md) | [简体中文](plan.zh.md) | 繁體中文

計畫模式是 [dsh-plan-mode](../../packages/plan/plan-mode) 擁有的、記錄到日誌的逐 agent（代理）協作狀態（`ctx.planMode`，`PlanModeController`）：激活期間，每個模型請求都會包含一段部署持有的指引。計畫模式是**軟性指引**。[沙盒模式](sandbox.md)與[審批策略](approval.md)分別強制限制；兩者都不讀寫計畫狀態，因此部署需要分別設定它們。該包是選填項，agent loop（代理循環）不相依性它。它貢獻 `plan:policy` 提示詞段落，並註冊 `exit_plan_mode` 工具和 `/plan` 命令。[設計說明](../../.agents/notes/implemented/simplification/2026-07-22-plan-specific-collaboration-state.md)負責決策依據；[包 README](../../packages/plan/plan-mode/README.md)負責模型體驗與限制細節。

原始碼：[`packages/plan/plan-mode/src/index.ts`](../../packages/plan/plan-mode/src/index.ts)

## 已記錄狀態與復原

`plan/mode`（`{ active: boolean }`）是僅記日誌、整值替換的[工作階段事件](session.md)：持久且可重播，絕不進入模型 transcript（文字記錄）。`foldPlanMode(events, end?)` 返回前綴中最後一條已記錄值，沒有時返回 `false`：生效狀態始終是工作階段日誌的純摺疊，因此復原、fork 與壓縮（compaction）無需即時映像檔即可將其復原，UI 透過 `session/event` 觀察已提交的切換。完整事件聲明見[持久化日誌事件目錄](../persistence-catalog.md)。

## 待生效選擇與 pre-step 追加

由於每個工作階段事件都位於輪次之內，使用者選擇會保持待生效狀態，直到下一個被接受的輪內 pre-step 在派生請求之前追加該選擇，無論該 pre-step 位於哪個輪次。選擇不會強制續行，因此在某輪最後一個被接受的 pre-step 之後作出的選擇會在之後的輪次追加。`set(agent, active)` 記錄待生效選擇（目標值與已記錄或已在等待的狀態相同時不做任何事），`get(agent)` 返回 `{ active: boolean; pending?: boolean }`：用於組裝當前步驟的已記錄狀態，以及等待追加的已選狀態。

agent 執行時期，唯一的追加點是前置（prepend）註冊的 `agent/pre-step` 監聽器。它會觀察每個候選請求步驟，包括第 1 輪第 1 步和請求復原重試；它先呼叫下游監聽器，只在下游接受該步驟後追加。提示詞准入發生在輪次開啟之前，無法追加 `plan/mode`，因此在提示詞處作出的選擇由它開啟的輪次內第一個被接受的 pre-step 追加。追加失敗不能阻塞輪次，且該選擇會繼續等待之後被接受的輪內 pre-step。追加使用者選擇時還會記錄一條外掛程式來源的 `user/message` 通知，但僅當最後記錄的請求標頭描述的是另一種狀態時才記錄，因此模型恰好在上下文變化時收到通知，且絕不重複。在某輪最後一個被接受的 pre-step 之後作出的選擇只存在於行程內；如果行程在另一個被接受的輪內 pre-step 之前退出，該選擇會丟失（[README 限制](../../packages/plan/plan-mode/README.md#known-limitations-and-deferred-work)）。

## 設定

```ts type-equiv
/** Deployment-owned plan guidance. */
interface PlanModeConfig {
  /** Guidance rendered as the `plan:policy` prompt section while plan mode is active. */
  section: string
}
```

`section` 缺失、為空白或不是字串，以及任何未知鍵，都會在外掛程式載入時失敗，而不是被忽略。計畫模式激活期間，確切的 `section` 文字以 order 50 渲染為 `plan:policy` [系統提示詞段落](system-prompt.md)；未啟用的計畫模式不貢獻任何文字。

## 退出工具與 `/plan` 命令

[`exit_plan_mode`](../tool-catalog.md#deepseek-aidsh-plan-mode) 在計畫模式未啟用時仍保持註冊，因此進入或離開計畫模式只改變提示詞段落，絕不改變請求的工具目錄；在計畫模式之外執行會失敗。在計畫模式中，它要求一份以 `#` 標題開頭的完整 markdown 計畫，並透過[使用者互動 seam](user-questions.md) 呈交評審。批准返回 `{ approved: true }`，並記錄一個靜默（不敘述）的待生效退出，由下一個被接受的輪內 pre-step 追加。因此，計畫指引在 assistant 當前這批工具呼叫的剩餘部分繼續生效，而工具結果本身會報告這次轉換。「繼續規劃」則是一次攜帶使用者回饋的失敗呼叫，模型據此修訂並再次呈交；評審期間互動通道缺失或服務重載同樣使呼叫失敗，而不是靜默離開計畫模式。

當 [`ctx.commands`](commands.md) 被組合時，外掛程式註冊 `/plan [off|message]`：單獨的 `/plan` 選擇計畫模式；任何其他非空訊息先選擇計畫模式，再透過 `agent.steer()` 提交該文字，使其在計畫指引下成為下一步驟的普通已記錄使用者訊息；確切參數 `off` 選擇未啟用，這還會在待生效條目被追加並對請求可見之前將其取消。

## 服務

`ctx.planMode` 擁有已記錄的計畫狀態，在步驟開始時應用並敘述選中的狀態，還擁有 `plan:policy` 段落、`/plan` 命令和穩定註冊的退出工具；`get`/`set` 簽名見生成的[服務目錄](#ctxplanmode--planmodecontroller)。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxplanmode--planmodecontroller"></a>

### `ctx.planMode` — `PlanModeController`

`ctx.planMode`: owns logged plan state, applies and narrates selected state at step start, the `plan:policy` section, the `/plan` command, and the stable exit tool. UIs observe committed flips through `session/event`; there is no live mirror.

```ts cordis-catalog
/**
 * Read the logged plan state and any selected state awaiting the next
 * accepted in-turn pre-step.
 *
 * @param agent The agent to read.
 * @returns Current logged state plus a pending selection, when present.
 */
get(agent: Agent): { active: boolean; pending?: boolean }

/**
 * Select whether plan mode should be active. Between turns the method
 * appends the change immediately because no in-turn pre-step will run until
 * another prompt starts a turn. The open-turn fold is the idle signal:
 * agent status stays `running` through post-turn checkpointing, when no
 * further in-turn pre-step runs. During an open turn the selection remains
 * pending until the next accepted in-turn pre-step. Repeated selection of
 * the current or already-pending state is a no-op.
 *
 * @param agent The agent to switch.
 * @param active Whether plan mode should be active.
 * @returns what happened: `committed` (logged now), `queued` (awaiting the
 * next accepted in-turn pre-step), `cancelled` (an opposite pending selection
 * was cleared; the logged state already matches), or `noop` (already in that
 * state).
 */
set(agent: Agent, active: boolean): 'committed' | 'queued' | 'cancelled' | 'noop'
```

Types: [Agent](core.md)

Source: [`packages/plan/plan-mode/src/index.ts:184`](../../packages/plan/plan-mode/src/index.ts)
<!-- END GENERATED cordis-surface -->
