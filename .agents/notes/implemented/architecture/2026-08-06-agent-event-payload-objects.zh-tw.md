# Agent Note: Agent 作用域事件 dispatch 單個 payload 對象

Status: implemented

[English](2026-08-06-agent-event-payload-objects.md) | 繁體中文

## 問題

Agent 作用域事件歷來採用位置參數：開頭的 `agent` 主體、事件專屬欄位，以及末尾用於 waterfall（瀑布式事件）/serial 事件的 `next`。新增欄位或退役上下文類型（如 `PreStepContext` 與 `RequestFailureContext`）都會迫使跨包重寫每個監聽器和 emitter，約定也一直分散在參數清單中，而不是集中在一個具名 payload 中。

## 決策

每個 agent 作用域事件都將恰好一個 payload 對象作為其第一個參數。payload 始終攜帶主體（`agent`）、事件的欄位，以及事件有取消訊號時的取消 `signal`；`next` 仍然是 waterfall/serial 事件的最後一個參數。受影響的事件是十二個 `agent/*` 事件、`agent-loop/config-start-failed`（唯一沒有主體的事件）以及 `goal/changed`。

`PreStepContext` 與 `RequestFailureContext` 已退役；它們的欄位直接存在於 `agent/pre-step` 與 `agent/request-error` 的 payload 中。

dispatch 是融合的：`agentEvents(ctx, agent)`（以及一次性 `emitAgentEvent`）注入主體，使作用域載體鍵與 payload 的 `agent` 不可能分叉；即使某個結構上可接受的 payload 恰好攜帶 `agent` 欄位，注入的主體仍然優先。`ReactLoopAgent` 在構造函式中建置一次 dispatcher，並將每個 emit、serial 和 waterfall 都經由它路由，因此熱路徑上的 dispatch 不產生任何分配。

## 考慮過的替代方案

**保留位置簽名。** 新增欄位或退役上下文類型依舊會重寫每個監聽器和 emitter，約定也會繼續分散在參數清單中，而不是集中在一個具名 payload 中。

**在每個 dispatch 位置手工構造主體。** loop 的中間設計呼叫 `ctx.waterfall(this.carrier, …)`，傳入手工構造的 `{ agent: this, … }` payload；它避免了每次 dispatch 的分配，卻重複了主體注入，並讓作用域鍵與 payload 主體分叉。融合的 dispatcher 是每種 dispatch 模式的唯一注入點。

## 後果

監聽器簽名一次性命名完整 payload，因此擴充 payload 或退役上下文類型，對所有監聽器和 emitter 都是一次形狀變更。主體/作用域耦合由 dispatcher 在每種 dispatch 模式下強制執行，且 loop 的熱路徑保持零分配。
