# dsh-agent

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

Agent 介面、登錄檔、行程本機發起方作用域，以及 `agent/*` 事件詞彙。每個外掛程式（UI、掛鉤、編排器）都面向此處定義的 `Agent` handle 程式設計；它不相依性迴圈，因此迴圈可以替換。

選填配套包 `@deepseek-ai/dsh-agent/invariant` 會向 `ctx.invariants` 註冊此包的 agent（代理）狀態轉換檢查。根 agent 服務不會隱式載入診斷。

## 服務：`AgentRegistry`（ctx 鍵：`agents`）

跟蹤即時 agent，並在非同步驅動器工作中攜帶發起呼叫的 Agent，而無需匯入具體迴圈包。

### 公開 API

帶作用域的註冊介面：`Agent.ctx` 是 agent 的作用域上下文（`dsh-scope`，鍵 = 該 agent）。透過它註冊工具／段／變數／監聽器，只對該 agent 生效，並在 dispose（資源釋放）時全部撤銷。`agentEvents(ctx, agent)` 是普通 agent 主體操作的融合分發器（一次完成載體 + 注入主體）；其通知 mode 會呼叫每個監聽器，並同時收容同步拋出和返回 Promise 的拒絕。登錄檔生命週期對複用一個穩定路由載體。`assembleContextFor(agent)` 建置按 agent 的組裝上下文（同時包含 `agent` + `scope`）。`installAgentLlmTarget(agentCtx, target)` 在提示詞組裝期間快照可變的提供方／模型／推理（reasoning）強度選擇，將路由應用到提示詞變數，並將完整目標應用到一個步驟的請求路由；如果沒有選定推理強度，則會清除繼承的推理強度，使該目標使用配接器／提供方預設值。`CreateAgentOptions.setup(agentCtx)` 和 `ResumeAgentOptions.setup(agentCtx)` 在新建或復原的 agent 尚未發布時，組合其帶作用域的世界。Setup 是受信任、僅用於組合的同進程程式碼：只有建立完成後才能驅動 agent。

`AgentOptions` 提供初始的提供方／模型路由，以及選填的正數 `maxTokens` 輸出上限。具體迴圈會解析確切模型的配接器預設值，把生效上限記錄到請求 header，並應用到每次對話模型請求；顯式 Agent 選項優先，省略時由配接器或提供方路由預設值控制。

- `ctx.agents.register(agent: Agent): () => void`：記錄一個 **已經構造完成** 的 agent。隨呼叫 fiber dispose。
- 進階有序生命週期：`enter(agent, owner): () => void` 強制 `agent.id === agent.session.id`，執行權威 ID 衝突檢查，並在不通知的情況下插入；`owner` 顯式記錄即時建立方 agent 關係（根 agent 為 `undefined`），與持久工作階段譜系無關。`announce(agent)` 恰好寄出一次 `agent/created`。建立監聽器同步請求的 detach 會延後到該次分發結束；每次 detach 都會檢查捕獲的條目對象，因此過時能力無法刪除後續使用同一 ID 的替代項。非同步工廠使用這一拆分；普通外掛程式使用 `register()`。
- `ctx.agents.get(id: SessionId): Agent | undefined`
- `ctx.agents.isOwnedBy(id: SessionId, owner: Agent): boolean`：該確切即時條目是否透過父 agent 的作用域上下文建立；執行時期所有權與持久工作階段譜系無關。
- `ctx.agents.list(): Agent[]`
- `ctx.agents.roots(): Agent[]`：在沒有所屬 agent 上下文的情況下建立的即時 agent；帶譜系的復原工作階段仍可能是執行時期根。

#### 發起方 Agent 作用域

`AgentLoop` 在發起方邊界內執行每個具體驅動器的完整生命週期。並行驅動器彼此隔離：子驅動器的 continuation 攜帶子 agent，而 `withInitiator()` 返回後，父 continuation 立即重新取得父 agent；drain 跟蹤持續到子驅動器的 Promise 結帳。建立、持久化載入和未發布 setup 位於子邊界之外，因此由父 agent 發起的 setup 會繼承父 agent，而 `agentCtx.agent` 顯式標識子 agent。

- `ctx.agents.currentInitiator(): Agent | undefined`：讀取繼承的發起方，不要求其存在。
- `ctx.agents.requireInitiator(): Agent`：讀取發起方，缺席時拋出 `no initiating agent is active`。
- `ctx.agents.withInitiator(agent, operation)`：使用一個確切 Agent 執行，並保留操作的確切同步值或 Promise。
- `ctx.agents.withoutInitiator(operation)`：對無關的行程本機工作隱藏繼承的發起方。

該作用域攜帶 `Agent` 本身，並且只在行程內有效。環境中的身份既不是存活證明，也不是授權；在服務、worker、行程、持久化和 wire 邊界，顯式 Agent 欄位仍是權威來源。Teardown 會拒絕新邊界，允許注入的相依性方和返回 Promise 的邊界 drain，然後停用底層 `AsyncLocalStorage`；未返回的工作仍歸將其分離的子系統所有。如果某個邊界繼承的非同步鏈開始解除安裝一個擁有它的 Cordis fiber，該巢狀邊界鏈會從 drain 中釋放，使解除安裝不會等待自身；其 continuation 會在 teardown 後觀察到已 dispose 的服務。詳細邊界與 teardown 約定由[發起方作用域決策](../../../.agents/notes/implemented/architecture/2026-07-15-agent-initiator-scope.md)擁有。

#### 工廠 API（建立）

Agent *建立* 由實作 `AgentFactory` 的外掛程式（`dsh-agent-loop`）提供，並透過 `setFactory` 註冊。這樣，建立功能留在 `dsh-agent` 介面上，消費端（UI、ACP（Agent Client Protocol）橋接層）可以面向 `ctx.agents` 程式設計，而不相依性具體迴圈包。登錄檔會把已經 traced 的 Service 規範化為具體目標，並透過呼叫方上下文重新 trace 每次呼叫；這既避免巢狀 Cordis shadow，也會把顯式、綁定呼叫方的 `ownerCtx` 傳給普通工廠。

- `ctx.agents.setFactory(factory: AgentFactory): () => void`：註冊建立工廠（迴圈在構造時呼叫）。第二個工廠會導致拋出；dispose 時清空槽位。
- `ctx.agents.create(options: CreateAgentOptions): Promise<AgentHandle>`：建立工作階段和 agent，在不發布的情況下等待選填 setup，然後透過最終的 `SessionStore.enter()` 與 `AgentRegistry.enter()` 檢查發布。不支持並行建立同一 ID：多個操作可以進行準備，但只有一個能進入；每個失敗方都會回滾其私有作用域／工作階段／驅動器。選填且只用於建立的 `signal` 會取消未發布的 setup，並在返回 handle 前分離；之後的取消使用 `handle.dispose()` 或 `agent.cancel()`。發布包含在回滾範圍內，回滾期間每條已交付建立邊都會成對處理。未註冊工廠時拒絕。
- `ctx.agents.resume(options: ResumeAgentOptions): Promise<AgentHandle>`：載入持久化工作階段（[工作階段持久化](../../../.agents/notes/implemented/architecture/2026-06-14-session-persistence.md)），建立新的未發布 agent 作用域，等待選填 setup，並使用相同的最終進入發布序列。其選填 `signal` 同樣只用於建立。未註冊工廠或未設定工作階段持久化時拒絕。

`AgentHandle = { agent: Agent; dispose(): Promise<void> }`。Disposer 是一項 **消費端能力**；僅持有裸登錄檔條目的觀察方不能 teardown agent。呼叫方 fiber 和已註冊工廠提供方是結構化共同擁有者：呼叫方解除安裝會強制結構化所有權，而工廠解除安裝必須停止舊實例，因為它們的作用域相依性範圍屬於該提供方。任意擁有者呼叫 `dispose()` 都會到達同一個記憶化完全靜止邊界：它停止迴圈，等待迴圈退出，註銷 agent，從儲存中移除其工作階段，最後撤銷其作用域世界。`ctx.agents.get(id)` 仍返回裸 `Agent`；ACP 橋接層與行程內 subagent 後端持有消費端 handle，而設定建立的 agent 已由迴圈 fiber 擁有。

### 即時事件

`dsh-agent` 聲明即時 `agent/*` 協調詞彙，使外掛程式不必相依性具體迴圈。確切簽名、分發 mode、作用域篩選規則與 payload 約定位於 [core.md](../../../docs/subsystems/core.md#cordis-surface) 的生成區塊；[架構輪次流](../../../docs/architecture.md#turn-flow) 展示它們與持久工作階段事件的相對順序。

生命週期邊有兩個重要的本機注意事項。`agent/created` 在作用域 setup 之後、工作階段與 agent 登錄檔條目都存在之後執行。Setup 是受信任、僅用於組合的程式碼；緊隨其後且不可 veto 的 `agent/session-start` 通知是第一個受支持的啟動注入點。`agent/disposed` 始終表示確切 agent 已離開登錄檔。AgentLoop 在其驅動器完全靜止後寄出該事件，而有序 teardown 此時可能仍在分離工作階段並撤銷作用域；直接註冊的自訂 agent 自行擁有任何更強的驅動器順序約定。

大多數攔截點都是協作式 waterfall（瀑布式事件）。`agent/pre-step` 接收一個 payload，攜帶主體 `agent`、獨佔的已領取 `UserMessage[]` 以及擬進入的 `turn`、`step` 與取消 `signal`；當工具已經要求繼續請求時，該批次可以為空。agent 作用域輪次擴充點在 payload 中攜帶顯式 `AbortSignal`；其餘輪次作用域擴充點透過其請求值接收它。監聽器可以配合訊號，但不得將它保留為控制另一輪次的權限。`agent/request-error` 是失敗模型請求的復原 waterfall：它接收請求坐標、規範化失敗事實、可用時提供服務的註冊項重試策略以及訊號。擁有復原權的監聽器返回 `{ kind: 'retry' }` 且不呼叫 `next()`。`agent/turn-stopping` 在本可完成的輪次關閉前執行。訊號生命週期由[顯式取消決策](../../../.agents/notes/implemented/architecture/2026-07-16-explicit-turn-cancellation.md)擁有；作用域分發與終止結帳由 [agent 作用域 runtime 設計 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-12-agent-scope-runtime-design.md#three-execution-boundaries-are-deliberately-one-way)擁有。

`PreStepDecision` 要麼是 `{ kind: 'reject' }`，要麼是 `{ kind: 'enter', messages }`。enter 分支是擬進入步驟的完整、帶標識且凍結的批次。包裝下游 enter 的監聽器會保留該批次，除非有意替換它；新增訊息遵循 waterfall 的自然返回順序。領取操作已經把候選訊息從 inbox 刪除，因此 reject 不會保留它們；領取後插入的訊息仍等待後續邊界。

inbox 的即時通知刻意採用逐訊息的最小載荷：`agent/inbox/inserted { message }`、`agent/inbox/claimed { message, turn }` 與 `agent/inbox/discarded { message }`。它們補充持久 `agent/inbox/spliced` 投影，但不引入另一層生命週期封套。

輪次和步驟邊界以及模型 token 流是持久 `session/event` 事實，而不是映像檔的 `agent/*` 通知。消費端從工作階段事件流讀取 `turn/*`、`step/*` 和 `assistant/chunk`；工具策略與結果觀測屬於 [`dsh-tools`](../tools/README.md) 記錄的完整管線。

`foldConsumedWork(events)` 把這條事件串流讀回來，回答僅憑輪次序列無法回答的那個問題：一份日誌消費掉的工作最終怎樣了。它返回能夠為已消費工作作出交代的最新 `turn/end`——即進入過模型 step 的輪次，或者認領了 inbox 輸入、但在進入 step 之前失敗、被停下或被拒絕的輪次——並額外給出「已接受的工作此後是否被從 inbox 中取消且從未執行」。兩項事實都來自日誌，因此無論由哪個所有者發起取消，讀出來都一樣。沒有取走任何輸入、或認領批次被改寫清空後正常結束的無 step 輪次不描述工作，會被跳過；認領過輸入、以 `blocked` 結束的輪次則是一份交代，因為拒絕把這些輸入一並丟棄了。

### Agent 介面（`types.ts`）

每個外掛程式面向的 handle：

- `agent.inbox`：agent 所擁有的持久 `agent/inbox/spliced` 事件投影。`nextTurn` 與 `nextStep` 暴露待處理的 `UserMessage` 值。`append`、`prepend`、`replace`、`remove`、`clear`、`splice` 與 `claim` 用於變更佇列；`replace(messageId, newMessage)` 與 `remove(messageId)` 透過 `MessageId` 跨兩份清單定位待處理訊息。替換可以改變標識，並先將舊訊息作為 discarded 發布，再將新訊息作為 inserted 發布。普通刪除和 `clear()` 都是持久取消，並行出 `agent/inbox/discarded`。`claim(target)` 透過純刪除 splice 移除下一個候選批次，隨後由迴圈寄出 `agent/inbox/claimed`。`MessageId` 是唯一的入隊項標識，在訊息待處理期間必須保持唯一。
- `agent.followup(message)`：將一條普通 `next-turn` 訊息排隊並喚醒驅動器。它不返回完成 handle；訊息 id 標識 inbox 的插入、領取與丟棄事實，而不標識之後的輸出或 `turn/end`。
- `agent.steer(message)`：將會喚醒的 `next-step` steering（中途引導）輸入排隊。agent 空閒時會同步啟動一個輪次；驅動器執行期間收到的後續 steering 會在下一個步驟邊界被消費。
- `agent.inject(message)`：將不會喚醒的 `next-step` 上下文排隊。執行中的驅動器會在最近的後續 pre-step 邊界領取它；idle 驅動器則會讓它保持待處理，直至 `followup()` 或 `steer()` 喚醒驅動器。若某次請求的 pre-step 已經領取完批次，它可能趕不上該請求。
- `agent.cancel(cause, options?)`：取消活躍驅動器，並在未設定 `options.keepInbox` 時持久取消全部待處理 inbox 工作。空閒取消是空操作。
- `agent.whenIdle()`：觀察整個 agent 達到完全靜止，包括當前驅動器退役前調度的替代工作。它不結帳任何特定訊息。
- `agent.session`、`agent.status`、`agent.options`、`agent.id`、`agent.ctx`

`running` 描述驅動器範圍的 drain 區間，而不是輪次仍打開的證明；它可以覆蓋輪次關閉、持久性檢查點和連續的排隊輪次。只有擁有完整區間的呼叫方纔能將其概括為一次執行的結果（[決策](../../../.agents/notes/implemented/architecture/2026-07-30-followup-enqueue-and-owned-runs.md)）。

### 擴充點

- Agent 建立：`AgentLoop.create()` 是具體設定路徑實作（位於 `dsh-agent-loop`），程序化消費端則透過 `ctx.agents.create()`/`ctx.agents.resume()` 建立或復原有所有權的 agent。替換迴圈時，應實作 `Agent` 並透過 `ctx.agents.register()` 註冊。
- 事件監聽器：全部 `agent/*` 事件都在此處聲明，不需要相依性迴圈包。
- subagent 委派不是 `Agent` 方法；提供方透過工廠 API 建立或驅動普通 handle，因此委派傳輸留在覈心 agent 介面之外。

## 模型體驗

### 使用者、steering 與注入訊息

#### 模型看到的內容

`send`、`steer` 與 `inject` 會向所屬工作階段提供輸入。`agent/pre-step` 和其他已聲明事件讓外掛程式能夠拒絕擬進入的步驟或新增持久請求材料；此介面本身不貢獻固定文案。

#### Token 影響

已接受內容成為保留歷史，或成為每次請求都會重複的工作階段前綴；被阻止內容不貢獻請求 token。大小取決於呼叫方與外掛程式。

#### KV Cache 影響

已接受歷史與 steering 只追加；被阻止的提交不傳送請求。工作階段前綴在迴圈實例內保持穩定，而新建或復原的實例可能建立不同前綴。

### Agent 作用域的請求組合

#### 模型看到的內容

透過 `agent.ctx` 進行的註冊可以遮蔽提示詞段或工具，也可以在未發布 setup 期間安裝僅適用於該 agent 的攔截器。

#### Token 影響

此包自身不增加 token；帶作用域貢獻隻影響該 agent，並在 dispose 時消失。

#### KV Cache 影響

只要 agent 的作用域註冊不變，前綴就保持穩定。改變提示詞段、工具定義或請求監聽器的 setup 或 reload，可能從第一個受影響的請求 token 起使複用失效。

## 已知限制與暫緩事項

- **發起方作用域只存在於行程內**：worker、子行程、HTTP、持久佇列和重新啟動必須顯式傳遞所需身份。
- **環境身份可能比存活狀態更久**：消費端在生命週期敏感工作前，仍要檢查 `agent.status`、取消狀態和所屬能力約定。
- **委派以外的 agent 間通道**：共享狀態、流式子輸出和後臺／輪詢語義仍在當前同步 `ctx.subagents` seam 之外。
- **`agent/session-start` 不能為啟動設定閘門**：它仍是同步且不可 veto 的通知；必須在發布前完成的非同步組合屬於工廠的 `setup(agentCtx)` 交易。
- **`cancel()` 默認清空 inbox**：它會中止正在處理的輪次以及排隊和 steering 工作；`cancel(cause, { keepInbox: true })` 只中止輪次並保留待處理項。仍不存在只中止步驟、同時讓正在處理的輪次繼續執行的操作（[停止 API Agent Note](../../../.agents/notes/implemented/simplification/2026-06-20-public-agent-stop-api.md)）。
- **每條附加 `UserMessage` 恰好攜帶一個 `MessageSource`**：多個外掛程式合併到一次工具呼叫上的貢獻會歸入同一來源，因此該訊息無法列出多個生產者。
- **`SessionStartSource` 預留 `'clear'`/`'compact'`，但還沒有寄出方**：在驅動子系統落地前，只會出現 `'startup'`/`'resume'`（`TODO(compaction)`）。
