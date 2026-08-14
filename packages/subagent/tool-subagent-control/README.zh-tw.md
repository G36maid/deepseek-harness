# @deepseek-ai/dsh-tool-subagent-control

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

選填的全域性具名 `send_message`、`interrupt_agent` 與 `list_agents` 工具是 `ctx.subagents` 之上的輕量配接器。綁定提供方的 `@deepseek-ai/dsh-tool-subagent` 實例會為每種傳輸註冊不同的委派工具；這個單獨載入的包只註冊一次共享控制工具，因此多個委派工具絕不會重複註冊全域性控制工具。根外掛程式註冊 `send_message` 與 `interrupt_agent`，且只要求 `subagents`；可單獨載入的 `./list-agents` 外掛程式註冊 `list_agents`，並將 `subagents` 與 `agents` 聲明為載入時相依性。其目錄讀取在呼叫時還要求工作階段儲存與投影登錄檔，但不要求任何查詢服務。部署可保留根外掛程式工具並省略清單工具。是否載入這些工具不會決定委派工具是否啟動可繼續工作。這些工具只負責父到子的方向；單獨安裝的 [`@deepseek-ai/dsh-tool-subagent-report`](../tool-subagent-report/README.md) 負責子到父的方向。

本工具不執行生命週期路由：駐留與冷復原歸 subagent 服務所有。它將 `exec.agent` 作為授權投遞的確切線上父級傳入，並把每則訊息的來源記錄為 `{ kind: 'coordinator', senderSessionId: parent.id }`；服務會保留該來源，但絕不將其視為權限。每則訊息都會透過 `Agent.followup()` 成為 subagent 的下一個 FIFO 輪次：如果子 agent（代理）仍在工作，該訊息會等待其當前輪次結束，因此無法重定向已經在進行的工作。本工具會轉發其執行訊號，該訊號只在 inbox 接受之前掌管准入；一旦子 agent 接受訊息，已接受的輪次便無法再透過本工具取消。本次呼叫不會返回子 agent 的回覆；透過該 id 查看其 transcript（文字記錄），纔是瞭解它完成了哪些工作的真源。擁有 `report` 的子 agent 會自行把內容作為一條單獨的父級訊息發回。投遞失敗會變為出錯的工具結果，並明確說明訊息未送達。

`interrupt_agent(agent_id)` 將 `exec.agent` 作為 `ctx.subagents.interrupt()` 的確切線上 ancestor 授權傳入：目標可以是直接 child 或更深的後代，由服務——而不是本工具——依據目標 Activation 記錄的 lineage 校驗呼叫方。只有目標的當前輪次會停止（`keepInbox`）：已排隊的訊息保持暫停直到之後的 `send_message`，已發布的後代繼續執行，child 也仍可接受後續訊息。呼叫在停止請求被接受後立即返回，不等待目標完全靜止；目標不存在或已結帳是被接受的 no-op，而 self、sibling、過時與非 ancestor 呼叫方會成為出錯結果。

`list_agents` 接受一個選填的 `scope` 參數，會從呼叫它的 agent 推導根 id，並且不使用 cursor，將服務目錄投影為可繼續 child。默認的 `children` scope 讀取 `ctx.subagents.listChildren()`；`descendants` 讀取 `ctx.subagents.listDescendants()`，其單份語料的遍歷會穿過普通工作階段與一次性 child，並按穩定 pre-order 以 `parent=<id> depth=<n>` 渲染保留下來的條目。`parent` 註釋是持久化直接 parent 工作階段 id，可能指向輸出中省略的普通工作階段。對於呼叫本工具的 agent，只有 depth-1 child 條目可作為 `send_message` 候選；更深的 child 條目只能作為 `interrupt_agent` 候選。狀態來自線上 Agent 登錄檔：`running`（driver 活躍）、`idle`（駐留但處於輪次之間，可能在等待它啟動的 agent）或 `ready`（僅存於儲存，表示可復原而非終態）。服務結果還包含由工作階段支撐的一次性 subagent，以供 UI 等消費端使用；但這些條目無法接受 `send_message`，因此會從這個模型工具中排除。diagnostic 仍然可見，並在 descendants scope 中帶有位置。持久化身份和模式來自每個子 agent 的描述符，訊息送達時的鑒權和 Activation 所有權檢查仍歸服務負責。

## 模型體驗

### 工具 schema

#### 模型看到的內容

已生成的 [schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-subagent-control)：`send_message` 包含 `subagent_id` 和 `message`，說明訊息會成為 subagent 的下一個輪次、本次呼叫不會返回 subagent 的回答，以及失敗即表示訊息未送達；`interrupt_agent` 包含 `agent_id`，說明只有當前輪次會停止、已排隊訊息保持暫停、後代繼續執行，以及接受先於實際停止；`list_agents` 包含選填的 `scope` 枚舉。

#### Token 影響

每個父級請求付款固定的 schema 成本。

#### KV Cache 影響

前綴保持穩定；schema 不會在執行時期改變。

### 中斷結果

#### 模型看到的內容

接受時返回 `interrupt requested for agent <agent_id>`。未授權的呼叫方——self、sibling、過時或非 ancestor——會成為指明拒絕原因的出錯結果；目標不存在或已結帳仍渲染接受行。

#### Token 影響

每次呼叫產生一條簡短確認訊息；被中斷輪次的中止只在 child 自己的 transcript 中可見。

#### KV Cache 影響

僅附加；每個結果都位於可複用請求前綴之後。

### 投遞結果

#### 模型看到的內容

接受時返回 `message queued as the next turn for subagent <subagent_id>`；規範輸出攜帶被接受的 `messageId`。失敗，包括未授權或未知的子 agent、缺少描述符而無法復原的子 agent，或准入被拒絕，都會成為出錯的結果，其訊息說明該訊息未送達。

#### Token 影響

每次呼叫產生一條簡短確認訊息；子 agent 的回應絕不會透過本次呼叫返回。單獨授予的 `report` 可以把選定內容追加到父級歷史中。

#### KV Cache 影響

僅附加；新增可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

### 清單結果

#### 模型看到的內容

按穩定目錄順序，每個可繼續 child 佔一行：渲染為 `<id> [<status>] — <label>`（`running` 表示 driver 活躍，`idle` 表示駐留但處於輪次之間，`ready` 表示僅存於儲存；可復原而非終態，也不表示有結果等待收集——處於該狀態的直接 child 可透過 `send_message` 復原），另為無法讀取的候選項渲染 `<id> [diagnostic: <reason>]`（`corrupt`、`unsupported` 或 `unavailable`）。`descendants` scope 會在每行 label 破折號之前插入 ` parent=<id> depth=<n>`，按 pre-order 排列。一次性 child 會被有意排除；`(no subagents)` 表示投影后沒有留下可繼續 child 或 diagnostic。診斷資訊絕不會暴露描述符內容。

#### Token 影響

隨所列可繼續 child 數量線性成長——`descendants` scope 下為整棵樹；沒有 cursor 或上限，因此長期存活且有許多持久化 child 的 parent 每次呼叫都會承擔完整清單成本。

#### KV Cache 影響

僅附加；每個結果都位於可複用請求前綴之後。

## 已知限制與暫緩事項

- **已排隊的訊息沒有獨立結果**：接受時只返回其 inbox `messageId`；subagent 的工作會落入持久化子 agent 工作階段，絕不會透過本工具收集。獲得 `report` 的子 agent 可以單獨發回選定內容，但該訊息不是本次呼叫的結果。
- **不對當前輪次進行 steering（中途引導）**：每則訊息都會開啟後續 FIFO 輪次，因此在子 agent 工作時傳送的訊息只會在其當前輪次結束後執行，無法將其重定向。
- **清單是快照，而非投遞承諾**：它可能與發布、dispose（資源釋放）或後續訊息發生競態，另一個行程也可能啟用當前行程報告為 `ready` 的 child；跨行程準確性需要共享租約。`interrupt_agent` 自己執行權威的線上 lineage 檢查，因此過期的發現結果不會授予權限。
- **沒有分頁或刪除**：系統返回完整且穩定排序的集合；只要 child 工作階段仍在持久化儲存中，它就會繼續出現在清單中，服務級上限或刪除操作留待後續產品決策。
