# dsh-agent-loop

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

agent（代理）的唯一具體實作外掛程式和迴圈驅動器。其包內部實作滿足 `Agent` 介面，並驅動工作階段、輪次和步驟的生命週期。

這是 harness 中唯一包含具體迴圈邏輯的包。其他所有內容要麼是抽象服務，要麼是針對擴充點的外掛程式：新行為應放入外掛程式，而不是這裡。

## 服務：`AgentLoop`（ctx 鍵：`agentLoop`）

### 公開 API

建立與復原屬於同一個受回滾保護的交易：構造私有工作階段、具體 agent 和帶作用域的上下文；等待選填 setup；進入兩個登錄檔；依次宣告 `session/created` 和 `agent/created`；寄出 `agent/session-start`；此後才啟動驅動器。Setup 作為受信任的同進程組合程式碼，接收完整的帶作用域 `Context`，並且不得驅動尚未發布的 agent。普通的類型化身份與選項輸入按只讀約定借用；seed 事件和工作階段元資料會跨越持久工作階段邊界，因此係統會對其進行驗證並建立快照。選填的 `AbortSignal` 只取消載入／setup／發布，並在返回的 handle 可見前分離。

呼叫方 fiber 與 AgentLoop 提供方共同擁有 agent。`AgentFactory.createAgent(ownerCtx, options)` 與 `resume(ownerCtx, options)` 顯式接收呼叫方所有權，而工廠為 `sessions`/`llm`/`tools`/`systemPrompt` 保留自身的相依性上下文；這樣，呼叫方可以只注入 `agents`，而不會縮減新 agent 的服務介面。呼叫方解除安裝、handle dispose（資源釋放）或提供方解除安裝都會匯合到同一個記憶化的完全靜止邊界。提供方關閉會同時等待資源 teardown，以及已經觀測到停用的公開 create/resume 包裝層，因此相依性消失後，任何 continuation 都無法繼續發布。

每個 agent 與其工作階段共享一個由呼叫方選擇的 `SessionId`，並假設它在全域性唯一；意外的 UUID 衝突不屬於受支持模型。兩個使用同一 id 的並行操作都可以進行準備，但最終的 `enter()` 呼叫會裁決發布，所有失敗方都會回滾各自的私有資源。每次 detach 都綁定到確切進入的對象，因此過時 disposer 無法移除之後出現的同 id 替代項。在同步建立通知期間請求的 detach 會等待該次分發退棧，從而保留 created/disposed 配對。Teardown 按以下順序執行：停止並排空 → 撤銷作用域 → detach agent → detach 工作階段。私有作用域清理完成後，該 id 即可複用。不具否決能力的普通 `agent/*` 通知透過 `agentEvents(ctx, agent)` 寄出；逐步驟組裝透過 `assembleContextFor(agent)` 完成。

- `ctx.agentLoop.create(id: SessionId, options?: AgentOptions, meta?: { cwd?: string }): Agent`：在確切共享的 agent／工作階段 id 下同步建立，不執行 setup，並隨呼叫方 fiber 一同 dispose。聲明式設定把 `agents[].id` 視為穩定 label，通常會先生成 `${label}-session-<uuid>`，再呼叫此邊界。應用也可以提供穩定且確切的 `sessionId`：首次使用時建立；重新掛載且持久化內容已存在時，則復原已經實體化的歷史。`resumeSessionId` 要求並載入現有的持久化 id，且與 `sessionId` 互斥。這樣，預設情況下每次重新啟動都會建立新工作階段，從而避免衝突，也無需保留第二個即時路由身份。

`AgentLoop` 還實作 `AgentFactory` 約定，並透過 `ctx.agents.setFactory(this)` 註冊自身，因此外掛程式會透過 `ctx.agents` 建立／復原 agent：

- `ctx.agents.create({ sessionId, meta?, seed?, agentOptions?, setup?, signal? }): Promise<AgentHandle>`：使用呼叫方提供的共享 id 以程式設計方式建立。它會等待尚未發布的 setup 交易，然後才返回；`meta` 攜帶 cwd／譜系／seed 邊界元資料，`seed` 則在工作階段邊界驗證並快照持久值後，重建 fork 子級的前綴。`signal` 只在此 Promise 結帳前生效。返回的 [`AgentHandle`](../agent/README.md) 擁有確切的 teardown 能力。
- `ctx.agents.resume({ resumeSessionId, agentOptions?, setup?, signal? }): Promise<AgentHandle>`：透過 `ctx.sessionPersistence` 載入持久化工作階段（參見[工作階段持久化](../../../.agents/notes/implemented/architecture/2026-06-14-session-persistence.md)），使用同一 id 註冊 agent，重建歷史，然後針對全新且尚未發布的 agent 作用域等待 setup，再執行受回滾保護的發布。輪次編號和派生歷史從已載入日誌繼續。此操作要求存在工作階段持久化後端（不會硬注入，因此非持久化 demo 仍能工作；缺少持久化時，`resume` 會以明確錯誤拒絕）。`signal` 僅用於建立。返回 `AgentHandle`。

設定驅動的 `ctx.agentLoop.create()` 路徑讓迴圈 fiber 擁有其 agent（該路徑會丟棄 handle）。對於以程式設計方式建立的 agent，handle 持有者是唯一面向消費端的 teardown 能力；AgentLoop 提供方解除安裝是一條獨立的結構性 teardown 邊，而不是向應用程式碼公開的另一個 handle。

### 注入的服務

`agents`、`sessions`、`llm`、`tools`、`systemPrompt`：全部 5 個介面服務。

### 不變數配套入口

選填的 `@deepseek-ai/dsh-agent-loop/invariant` 配套入口會向 `ctx.invariants` 註冊請求重建。迴圈會把每個確切的凍結請求記錄在 `dsh-llm` 擁有的行程本機身份集合中；隨後，配套入口要求存在即時工作階段，並根據日誌獨立重建訊息邊界和摺疊後的請求 header。即使呼叫方凍結直接的一次性呼叫，或為其附加工作階段 id，這類呼叫仍不屬於該約定。

### 設定（Schemastery）

```ts
interface Config {
  maxParallelToolCalls?: number // default 10; 1 is serial
  agents: Array<{
    id: string                 // required
    provider?: string
    model?: string
    maxTokens?: number         // positive per-request output-token cap
    resumeSessionId?: string   // load this persisted session instead of creating one
    cwd?: string               // optional workspace cwd for the fresh session
  }>
}
```

透過設定建立的 agent 會自動啟動。模型呼叫同時需要 `provider` 和 `model`；`agent/request` 可以在分發前補齊缺失的這一對值。選填的正數 `maxTokens` 會為每次對話請求提供初始輸出上限，並記錄在請求 header 中。`maxParallelToolCalls` 限制每個 agent 針對平行安全呼叫使用的滾動池，預設值為 `10`；它同時也是 `agent-loop` Settings 段的全部內容，因此疊加在該條目之上的使用者層無需重新啟動即可限制下一組工具呼叫，而非正整數的值會在寫入時被拒絕，而不是到那一組時才失敗。`agents` 刻意不在該段中——它在服務啟動時被消費一次，所以儲存的改動只會看起來生效。`cwd` 僅應用於全新工作階段，而 `resumeSessionId` 保留持久化元資料。透過設定建立的 agent 使用部署 persona；程式設計式 setup 可以按 agent 遮蔽它。該外掛程式為每個 agent 提供 `provider`、`model` 和 `cwd` 提示詞變數；harness 身份與部署 persona 屬於 `dsh-system-prompt`。

### 包內部具體驅動器

具體 `ReactLoopAgent`、其 inbox 與執行控制均為包內部實作。包根只匯出外掛程式／服務／設定約定，包匯出對映不提供 `./src/*` 逃逸路徑；生命週期擁有方透過 `ctx.agents` 建立 agent，而不是點名、構造或啟動驅動器內部元件。一個準備完成的工作階段只能由一個具體驅動器認領；所有可觀測行為都透過工作階段事件和 `agent/*` 事件分類體系發生。

統一的 `send()` 原語按（`target` × `wakeup`）路由內容與來源；`followup`/`steer`/`inject` 是它的固定預設別名。`followup()` 追加到 `next-turn` FIFO 並喚醒驅動器，`steer()` 追加到 `next-step` inbox 並喚醒驅動器，`inject()` 則追加到同一個 `next-step` inbox，但不喚醒驅動器。在輪次邊界，驅動器會先打開持久輪次，再原子領取待處理的 next-step 輸入和一條排隊提示詞；在步驟之間則只領取 next-step 輸入。領取操作透過僅執行刪除的 splice 移除整批訊息，並為每則訊息各發出一次 `agent/inbox/claimed { message, turn }`。隨後 `agent/pre-step` 返回拒絕結果，或返回將進入擬議步驟的完整訊息。拒絕後，已領取批次保持已刪除，並關閉不含步驟的輪次；領取後插入的輸入仍等待後續處理，而空閒注入會一直等待，直到 follow-up 或 steering 喚醒驅動器。

每次 inbox 變更都會在修改即時投影之前，先發布一條規範化的 `agent/inbox/spliced` 事件。因此，插入、編輯、移除、領取與取消都透過同一組標準 splice 坐標重播。普通刪除攜帶 `outcome: 'canceled'` 並行出 `agent/inbox/discarded { message }`；領取使用不帶 outcome 的純刪除，隨後由迴圈寄出 `agent/inbox/claimed`。每次插入都會發出 `agent/inbox/inserted { message }`。`MessageId` 在兩個待處理清單之間保持唯一，持久事件的同步觀察方可以從 splice 前投影重建被移除的值。

### 迴圈生命週期（`agent.ts`）

驅動器在其整個生命週期內擁有一個 agent，並在 `ctx.agents.withInitiator(agent, ...)` 內執行。包私有的編排入口點會復原確切的 Agent，一次性派生 `agent.session`，並讓操作區域性的輔助函式捕獲它，而不是透過淺層介面繼續傳遞具體驅動器或每次操作的 `Session`。如果顯式 `Session` 正是輔助函式的實際介面，該輔助函式會保留它；建立、持久化載入、未發布 setup、服務、worker、行程、持久化和 wire 協議則繼續保留各自的顯式身份。[agent 服務](../agent/README.md#initiating-agent-scope)規定傳播、teardown 和分離工作規則。

每次提供方呼叫成功結束時，都會恰好追加一個 `assistant/message` 完成錨點，包括無內容呼叫和以 `max-tokens` 結束的呼叫。該錨點原樣記錄組裝後的內容，在 `sourceEventSeqs` 中列出確切的區塊 seq（流沒有區塊時為 `[]`），並在用量可用時包含用量；空內容不會進入派生訊息歷史。

在 `agent/request` 返回提供方／模型呼叫設定後，迴圈會呼叫 `ctx.llm.prepareCall()`，在活躍輪次訊號的控制下校驗由配接器負責的欄位，並填入設定的推理（reasoning）強度和輸出 token 預設值。準備完成的呼叫會在這次非同步解析、`request/header` 日誌記錄和最終分派期間保留同一項確切的配接器註冊，因此 HMR（熱模組替換）不會把某個配接器的能力解析結果與另一配接器的請求混用。請求 header 會記錄生效設定以及哪些欄位來自適配器。下一次 waterfall（瀑布式事件）前，迴圈會從提議中移除這些帶標記欄位，使當前精確路由重新填入自身預設值；未帶標記的顯式設定會跨步驟和路由變化保留。沒有已註冊配接器的路由會保留原定設定，使 `llm/stream` 監聽器可以接管並短路該請求；最終分派仍會以 `NO_ADAPTER` 拒絕未得到處理的路由。新迴圈實例在復原時會遵循同一套配接器預設值標記規則。

外掛程式失敗會結束當前輪次，而不是結束迴圈。最終配接器選擇、分發與迭代失敗會以終止錯誤或中止結束的形式由 `ctx.llm` 傳來，並進入 `agent/request-error`；middleware、結果處理、工具及其他擴充失敗仍會拋出並直接關閉輪次。復原邏輯會接收請求坐標、不可變的提供方事實、準備完成的配接器註冊所捕獲的不可變重試策略以及輪次訊號；middleware 接管未準備路由時，該策略缺失。處理失敗的監聽器返回 `{ kind: 'retry' }`；未被處理的失敗是終態。AgentLoop 為當前准入操作或輪次擁有一個取消訊號。有效的 `cancel(cause)` 在未設定 `keepInbox` 時清除待處理工作，並以協作方式中止該訊號；空閒取消是空操作。abort 觸發後、活動收斂到空閒前到達的喚醒輸入會被鎖存（`wakeRequested`），並在 driver 自身的收斂邊界重放，無需再發一條喚醒 send 即可執行；`disposed` 取消從不鎖存，而 agent 已處於空閒時傳送的喚醒總是打開自己的 turn 邊界（即使訊息已被清除，狀態也會顯示瞬態 `idle → running → idle` 對）。持久 `turn/end` 為 `user` 和 `parent` 記錄 `aborted`，dispose 則記錄 `disposed`；未分發的模型工具呼叫會收到合成的 `tool/call` 與 `ABORTED_BEFORE_DISPATCH` 結果對。取消原因隻影響報告方式，不影響如何處理在取消後完成終結的結果上下文。dispose 會等待忽略訊號的工作完成，然後才從登錄檔移除。[顯式取消決策](../../../.agents/notes/implemented/architecture/2026-07-16-explicit-turn-cancellation.md)與[取消收斂視窗喚醒鎖存](../../../.agents/notes/implemented/bug-fix/2026-08-07-cancel-convergence-wake-latch.md)規定生命週期與競態約定。

在步驟內，獨佔呼叫形成屏障；平行安全呼叫使用有界滾動池，並在啟動前重新分類。只有分發和呼叫主體的執行會發生重疊。策略、持久結果和結果上下文仍保持模型順序。中止會阻止啟動新的呼叫，等待已啟動呼叫的結果處理完畢，並保留其完成終結後的結果上下文，不區分取消原因。內部調度器故障會停止新的分發，等待已啟動的分發，然後在不虛構工具結果的情況下到達輪次錯誤邊界。

### 外掛程式負責的內容

超出「呼叫模型、執行工具、重複」的所有內容，都屬於監聽事件分類體系的外掛程式：
- 掛鉤與策略：相關的 `agent/*` 檢查點，加上受守衛保護的 `tools/pre-execute` → `tools/execute` → `tools/post-execute` → 定義擁有的 `finalizeContent` → `tools/result` 管線；確切事件簽名與 mode 位於 [core.md](../../../docs/subsystems/core.md#cordis-surface) 與 [tools.md](../../../docs/subsystems/tools.md#cordis-surface) 的生成區塊
- 壓縮（compaction）：在 `agent/pre-step` 上觀測壓力；在 `agent/request-error` 上進行規範的溢位修復
- 模型請求復原：`dsh-llm-retry` 在 `agent/request-error` 上記錄並等待針對確切提供方設定的 normal 或無界退避，寄出不進入表層的 `llm/retry` 狀態，然後返回重試動作
- 沙盒、權限、計畫模式：使用 `tools/pre-execute` 提供可擴充的拒絕／詢問，使用 `tools.guard()` 提供單調擁有方策略，使用 `tools/post-execute` 處理結果決定，並使用 `tools/result` 進行最終觀測
- subagent：在迴圈外部實作為 `ctx.subagents` 提供方；行程內提供方使用 `ctx.agents.create()` 建立 agent，並透過其擁有的 `AgentHandle` 執行 teardown，而通用的 [`ctx.jobs`](../../jobs/jobs/) 與 [`dsh-tool-subagent`](../../subagent/tool-subagent/) 負責後臺收集。
- 持久化：`session/event` 發生後立即安排延後寫入；`session/flush` 是顯式觀測屏障
- UI：`session/event`（assistant token 流、邊界、工具活動）+ `agent/*` 控制事件（`agent/status`、`agent/created`/`agent/disposed`）

## 模型體驗

### 完整對話請求

#### 模型看到的內容

每個步驟中，迴圈會發送針對該 agent 呈現的系統提示詞、可見工具 schema 和工作階段派生訊息。它提供 `provider`、`model` 與 `cwd` 變數值，但不新增固定文案。

#### Token 影響

每個步驟都會再次計入系統文字與 schema。逐 agent 作用域決定貢獻，而權威組裝 waterfall 可以改變最終請求，並使其監聽器負責保持協議連貫。

#### KV Cache 影響

只有在同一提供方和模型路由下，且系統文字、schema 與此前歷史都保持逐位元組一致時，請求 token 序列才保持僅附加。攜帶 token 的組裝改寫或組合變更可能從第一個改變的請求 token 起使複用失效。

### 保留的訊息歷史

#### 模型看到的內容

已接納的 user 訊息、assistant 訊息、工具呼叫與結果、注入上下文和 steering（中途引導）都會記錄，並在後續步驟中傳送。原始流區塊、生命週期邊界和其他僅寫入日誌的事件會被排除。

#### Token 影響

輸入會隨每條表層訊息成長，直到壓縮替換遮蔽較舊節點；包含多個步驟的工具輪次會在每個步驟重新發送累積的歷史。

#### KV Cache 影響

普通歷史成長僅附加，並保留可複用條目。表層替換或壓縮會從第一個被遮蔽的歷史 token 起使複用失效。

### 取消後未分發的呼叫

#### 模型看到的內容

如果後續請求重播一個中止的步驟，取消所阻止分發的每個工具呼叫都有錯誤碼 `ABORTED_BEFORE_DISPATCH`，結果文字為 `Error: tool call aborted before dispatch`。

#### Token 影響

每個跳過的呼叫都會在歷史中保留一個固定錯誤結果，直到壓縮將其遮蔽。

#### KV Cache 影響

僅附加；每個合成結果都位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **分類是一元的**：安全性取決於比較同級呼叫或資源的呼叫必須保持獨佔（參見[設計原理](../../../.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.md)）。
- **設定 label 默認對應新工作階段**：省略 `sessionId` 時，每次啟動都會建立新的 `${id}-session-<uuid>`；如需確切的復原或建立行為，必須顯式提供穩定的 `sessionId`，而 `resumeSessionId` 要求已有持久化歷史。
- **設定 agent 沒有逐 agent persona 欄位或 setup 掛鉤**：它們使用部署 persona；只有程式設計式 `ctx.agents.create()` / `resume()` 工廠選項支持帶作用域的 persona／工具組合。
- **沒有內建輪次預算**：工具呼叫或 steering 會讓當前輪次繼續；限制失控輪次的策略必須從既有生命週期擴充點（如 `agent/turn-stopping`）執行取消。
