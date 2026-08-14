# @deepseek-ai/dsh-tool-todo

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

面向模型的 `todo_write` 工具：agent（代理）的完整任務清單，每次呼叫都會整體替換。

## 功能

註冊一個工具 `todo_write(todos: [{ content, status }])` 到 `ctx.tools`。模型每次呼叫都會發送完整清單，不存在部分更新或單項編輯。每次呼叫都會向呼叫 agent 的工作階段日誌追加 `todo/write` 事件（完整清單快照），具體呼叫 `agent.session.append('todo/write', { todos })`；當前清單是最新的該類事件（重播時後寫覆蓋先寫）。

`status` 是 `pending`、`in_progress` 或 `completed` 之一。

## 單一所有者

該清單屬於呼叫工具的唯一 agent 工作階段。不存在 subagent／共享／swarm scope：非 agent 呼叫方（沒有 `exec.agent`）無處寫入清單，因此會被拒絕。這是有意設定的 scope 限制，詳見 Agent Note。

## 設定

`allowParallelInProgress` 是必填項：每個組合都必須選擇是否允許多個 todo 同時處於 `in_progress`。這是部署層的選擇而非固定規則：並行的活躍任務是否合理，取決於工具無法觀測的執行時期並行情況。可能平行展開工作的 agent 使用 `true`，`false` 則強制執行單活躍項紀律。

該開關會同時改變面向模型的指令與接受的輸入——`true` 要求模型標記每個正在推進的任務並接受任意數量；`false` 要求恰好一個，並以 `Error: invalid todos: at most one task may be in_progress (got <n>)` 拒絕標記更多的呼叫。持久日誌不變式**不**跟隨它：在允許平行時寫下的日誌，在部署收緊策略之後仍必須可重播，因此不變式對活躍數量保持沉默。

## 驗證

除 schema 的類型／必填／枚舉檢查外，`execute` 還會拒絕空或重複的 `content`，以及 `content`/`status` 之外的任何條目鍵——擴充條目形狀（id、巢狀）會明確報錯而不是被靜默壓平，保證落日誌的快照與模型自認為寫入的內容一致。同時可以有多少任務處於 `in_progress` 由部署決定（見 § 設定）：選擇 `true` 的組合允許平行工作（並行 subagent、後臺命令）同時將多個任務標記為 `in_progress`。清單的順序及及時更新由模型依照工具描述負責。

## 算繪

規範結果為 `{ todos, counts: { pending, inProgress, completed } }`；其 Native 算繪器返回精簡的更新確認。工具還會寫入完整 `todo/write` 工作階段事件。UI 訂閱事件串流，並自行算繪該持久化清單：[web 用戶端](../../client/ui-conversation)基於當前有效計畫（其後沒有更晚 `turn/start` 的最近一次 `todo/write`）顯示計畫條和專屬工具行（[展示](../../../.agents/notes/implemented/feature/2026-07-23-web-todo-display.md)、[生命週期](../../../.agents/notes/implemented/feature/2026-07-28-todo-plan-clears-on-next-turn.md)）。

## 工作階段投影

當組合掛載了 `ctx.sessionProjections`（[`@deepseek-ai/dsh-session-projection`](../../session/session-projection/README.md)）時，本包在一個注入的子外掛程式中註冊 `todos` 投影單元：`init` = `null`（尚無寫入）、`apply` = 從每個 `todo/write` 取整表，並在每個 `turn/start` 清為 `null`（當前有效計畫；`turn/end` 保留剛完成的清單；其餘事件都返回同一個狀態引用）、`view` = 恆等、`stateVersion` = 2。該鍵在本包中合併進 `SessionProjectionMap`（經 Service Definition 包的 `/types` 出口）；框架驅動該單元，載體透過歷史尾頁與 `session/projection` 推送幀提供該值。未掛載登錄檔的組合不受影響。生命週期理由見 [在下一輪次清空 todo 計畫](../../../.agents/notes/implemented/feature/2026-07-28-todo-plan-clears-on-next-turn.md)。

## 匯出形狀

函式／命名空間外掛程式：匯出 `name`/`inject`/`apply`，不提供預設匯出。意外的 `export default` 會被 Loader 的 `unwrapExports` 摺疊為預設匯出，並導致 `inject` 丟失（參見 [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)）。

## 模型體驗

### 工具 schema

#### 模型看到的內容

模型會看到生成的 [`todo_write` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-todo)。

#### Token 影響

工具可見的每個請求都有固定的 schema token 開銷。

#### KV Cache 影響

只要定義和可見性不變，前綴就保持穩定。外掛程式生命週期或 scope 限制可能會使從此 schema 起的快取複用失效。

### 工具呼叫歷史與結果

#### 模型看到的內容

每個 assistant 工具呼叫都會在參數中保留整個替換清單。成功時原樣返回 `Updated todo list: <pending> pending, <inProgress> in progress, <completed> completed.`。穩定失敗文字為 ``Error: invalid todo: `content` must be a non-empty string``、`Error: invalid todos: duplicate content "<content>"`、`Error: todo_write requires an owning agent session`，以及——仅在部署设置了 `allowParallelInProgress: false` 时——`Error: invalid todos: at most one task may be in_progress (got <n>)`。完整 `todo/write` 工作階段事件是 UI 與重播狀態，而非第二條模型訊息。

#### Token 影響

token 用量會隨模型每次提交的完整清單成長，且這些呼叫參數會保留到壓縮（compaction）。結果本身很小，且形狀固定。

#### KV Cache 影響

僅附加；新可見內容位於可複用請求前綴之後，不會使現有 KV-cache 條目失效。

## 已知限制與暫緩事項

- **僅單一所有者 scope**：清單屬於唯一呼叫 agent 工作階段；subagent／共享／swarm scope 是有意設定的限制（參見「單一所有者」一節），非 agent 呼叫方會被拒絕。
- **條目形狀有意保持最小**：`content` 加三態 `status`；整表替換不需要穩定 id、優先級或 active-form 欄位。
- **整表替換是唯一操作**：沒有部分更新，也沒有回讀工具；模型每次呼叫都必須重新發送完整清單。
