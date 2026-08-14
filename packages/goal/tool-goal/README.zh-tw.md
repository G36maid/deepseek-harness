# @deepseek-ai/dsh-tool-goal

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

[`ctx.goals`](../goal/README.md) 的面向模型控制 API：`get_goal`、`create_goal` 和 `update_goal`。[goal 工具 Agent Note](../../../.agents/notes/implemented/feature/2026-07-19-model-facing-goal-tools.md) 負責權限拆分與 Codex 風格使用者體驗。

## 工具

- `get_goal()` 返回當前 goal 或 `null`，包括比較並設定 id／revision、持久 phase、Goal Round 的已准入數／上限、任何 blocker reason，以及當前行程本機續行啟用狀態。
- `create_goal(objective, max_goal_rounds?)` 根據人類直接發起的頂層輪次建立一個 goal。模型可以推斷長期執行的 goal 意圖，而無需精確命令短語；非人類輪次和 subagent 會在執行時被拒絕。
- `update_goal(goal_id, revision, action, objective?, max_goal_rounds?, blocked_reason?)` 支持 `edit`、`pause`、`resume`、`complete` 和 `blocked`。替換值只屬於 `edit`；`blocked_reason` 只有在 action 為 `blocked` 時才必填，並以穩定程式碼 `model-reported` 持久化。嚴格 schema 下的空字串和零填儲值視為省略，而有意義的值仍限定到各自 action。

所有呼叫都互斥，因此模型排序的批次能觀察到更早變更及其新 revision。UI 用戶端會收到純通用卡片：`get_goal` 使用 read，變更使用 other。變更卡片選擇第一個有意義的 action 值，否則顯示 goal id，因此已接受的填儲值絕不會產生空輸入。

3 個規範值都與已經渲染給 Native 呼叫方的緊湊 JSON 一致：`{ goal: null }` 或 `{ goal: { id, revision, objective, phase, roundsStarted, maxGoalRounds, blockedReason? }, activation }`。因此，程式設計消費端無需解析渲染後的 JSON，即可收到相同領域結構。

自主 Goal Round 成功報告 `complete` 或 `blocked` 時，會用 `concludeTurn()` 標記該次工具執行，使物理輪次在該步驟後停止。人類直接變更絕不會導致這種停止：assistant 可以確認變更，迴圈仍可接收並行的人類 steering（中途引導）。

## 權限

執行要求完全相同的活躍 `exec.agent`、其繼承的 `AgentRegistry` initiator、running 狀態與開放輪次。create、edit、pause 和 resume 還要求執行時期根 agent（代理）的當前輪次中存在已接受的 `{ kind: 'user' }` 訊息或 steering 事件。持久 fork 譜系不會降低已復原根 agent 的等級；活躍 subagent 所有權會降低。

`{ kind: 'user' }` 是宿主證明。`Agent.followup()` 與 `steer()` 會在呼叫方省略 source 時分配該值，因此外掛程式、調度器與其他非人類生產方必須傳入自己的 source，不能繼承使用者權限。

complete 與 blocked 還接受完全一致的當前 Goal Round：來源為 goal 的 `user/message`，其 id、revision 和 Round 編號與摺疊後的當前 goal 相等。在達到 `blockedAfterConsecutiveRounds` 前，Goal Round 的 blocked 呼叫會被機械拒絕；模型判斷同一條件是否確實持續，並必須在 `blocked_reason` 中說明。人類直接授權可以立即停止 goal。

## 設定

```yaml
- id: tool-goal
  name: '@deepseek-ai/dsh-tool-goal'
  config:
    blockedAfterConsecutiveRounds: 3
```

該值必須是正的安全整數。它既提供模型自行報告阻塞的硬下限，也決定模型指引中指明的數值。

## 模型體驗

### 系統提示詞

#### 模型看到的內容

固定 goal 策略說明何種使用者語義意圖值得建立 goal，要求更新前先精確讀取 ref，解釋工作階段 resume／fork 後如何重新啟用續行，並限制完成／阻塞聲明。設定的閾值會插入該指引。

##### Goal 策略

```markdown
Use goal tools for one long-running completion objective in the current session. create_goal may infer goal intent from a direct human request in any language; do not create a goal for routine single-turn work. Call get_goal before update_goal and copy its exact goal_id and revision. After session resume or fork, an active goal is disarmed: when a human asks to continue or resume in any wording or language, use update_goal action resume to rearm it. Mark complete only when the objective is actually achieved. Mark blocked only after the same blocking condition persists for at least 3 consecutive goal rounds, and report that concrete condition in blocked_reason; difficulty, uncertainty, or useful remaining work is not blocked.
```

#### Token 影響

此外掛程式的提示詞註冊位於請求範圍內時，每次請求都會產生少量固定輸入成本。

#### KV Cache 影響

外掛程式範圍、設定閾值和指引文字不變時，前綴保持穩定。啟用、dispose（資源釋放）或設定變更可能使此提示詞章節的複用失效。

### 工具 schema 與結果

#### 模型看到的內容

生成的 [`get_goal`、`create_goal` 和 `update_goal` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-goal)。成功結果是緊湊 JSON。變更會追加 goal 領域的持久 `goal/change` 事件，而不會將模型上下文加入佇列。結果中的 `activation` 是即時觀察值，絕不會成為重播權限依據。

#### Token 影響

固定 schema 成本，加上每次呼叫的一條緊湊結果。持久變更不會增加單獨的模型可見上下文。

#### KV Cache 影響

schema 的定義與可見性不變時，前綴保持穩定。呼叫和結果會追加到可複用請求前綴之後，不會使更早條目失效。

## 已知限制與暫緩事項

- **語義意圖仍由模型判斷**：執行只能證明當前輪次包含一條人類直接傳送的訊息，無法證明請求是否足夠重大而值得建立 goal。
- **阻塞條件是否相同仍由模型判斷**：執行時期強制統計互不重複的已准入 Goal Round，而不判斷障礙在語義上是否等價；獨立評估器的實作暫緩。
- **不負責調度或直接面向人類呈現**：這些工具只變更狀態；同工作階段驅動器與 [`dsh-command-goal`](../command-goal/README.md) 是同一領域的獨立消費端。
- **Goal Round 權限需要驅動器**：除非續行驅動器准入 goal 來源的使用者輪次，否則自主 `complete`／`blocked` 路徑不會啟用；只掛載這個包不會建立這些輪次。
- **提示詞註冊與過濾相互獨立**：某個範圍可能隱藏工具，卻保留指引，除非部署將兩項註冊限定在同一範圍。
