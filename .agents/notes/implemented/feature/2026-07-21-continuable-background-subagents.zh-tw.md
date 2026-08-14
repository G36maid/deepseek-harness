# Agent Note: 可繼續的後臺 subagent

Status: implemented

[English](2026-07-21-continuable-background-subagents.md) | [简体中文](2026-07-21-continuable-background-subagents.zh.md) | 繁體中文

本記錄已由[可繼續的 subagent](2026-07-28-continuable-subagent-conversations.md)取代——後者以一個持久 Session 加至多一個行程內 Activation（駐留期）替換了其基於 Task 的 activation 模型、路由、取消和持久性語義。其服務放置與提供方功能策略此前已由[將 subagent 控制合併到 subagent 服務](../simplification/2026-07-26-merge-subagent-control-service.md)和[以意圖命名的 subagent 繼續執行操作](../simplification/2026-07-27-intent-named-subagent-continuation-operations.md)取代。僅持久 child 工作階段與 descriptor 的設計依據仍然有效。

## 問題

subagent 工具將每次委派視為一個獨佔的 `SubagentRun`：前臺呼叫和後臺 Task 收集結果後 dispose（資源釋放）該 run。這種所有權關係能夠限制存活 child agent（代理）的數量，並釋放其作用域服務、監聽器及提供方資源。持久化的 child 工作階段可能繼續存在，但 parent 缺少持久化目錄和工具路徑，無法發現該 child 並為其啟動另一輪次。

Task、run 和 child 工作階段具有不同的生命週期。一個 Task 表示一輪後臺執行，並且只有一個終態結果。一個 `SubagentRun` 擁有 child 的一次啟用。一個持久化 child 工作階段可以包含多個由 parent 或使用者發起的輪次。繼續執行必須保留逐 run dispose 的約定，而不能把所有歷史 child agent 都留在記憶體中。

## 決策

一個可繼續的後臺 subagent，是由一系列 Task 支撐的短期啟用共同組成的持久化 child 工作階段。child session id、transcript（文字記錄）、譜系及聲明的組合設定均保留在持久化儲存中。每次初始啟用或復原啟用都會建立新的 Task、`AgentHandle` 和 `SubagentRun`，驅動程式一個輪次、收集結果，並在 Task 進入終態前 dispose 該 run。

Task 的結果和取消邊界屬於 child 啟用，不屬於為該啟用提供第一則訊息的呼叫方。Task 訪問根據 parent session id 授權，而 Task 登錄檔仍保留當前存活的精確 parent Agent 實例，用於通知與資源清理。因此，只要 parent 仍是執行時期 owner，parent 訊息和使用者訊息便會共享同一個啟用結果：

```text
durable child Session
  activation 1: Task 1 -> SubagentRun -> AgentHandle -> dispose
  activation 2: Task 2 -> SubagentRun -> AgentHandle -> dispose
  activation 3: Task 3 -> SubagentRun -> AgentHandle -> dispose
```

前臺委派保持一次性行為。繼續執行覆蓋後臺的行程內 spawn 和 fork child。每個 `tool-subagent` 實例都會選擇 `backgroundMode: 'one-shot' | 'continuable'`；設定為可繼續模式時，所掛載提供方必須具備 `resume` 功能，而可復原的提供方仍可採用一次性後臺策略。在下述 ACP（Agent Client Protocol）後續工作完成前，ACP child 仍保持一次性行為。

`ctx.subagents` 是唯一的公開服務。普通 `start` 不感知 child 集合、Activation 與持久化：它校驗提供方功能、解析一次性描述符、分發一個 run、觀察 run 生命週期，並返回由持有方負責的 run。注入的內部繼續執行管理器負責管理穩定的 child id、可繼續描述符持久化與尋找、Activation 生命週期，以及透過 `startContinuable` 和 `followup` 進行的路由；管理器自行組合 child 之前，提供方透過私有閉包提供準備資料。按提供方綁定的 `@deepseek-ai/dsh-tool-subagent` 外掛程式及面向使用者的配接器呼叫這些意圖操作來處理可繼續後臺工作；前臺和一次性後臺委派使用普通 `start`。全域性命名的模型工具是 `@deepseek-ai/dsh-tool-subagent-control` 中的選填輕量配接器，它是否存在不會決定是否啟動可繼續工作。parent 到 child 的枚舉、一次性／可繼續模式共享的描述符身份與 `list_agents` 屬於[持久化 subagent 目錄](2026-07-22-durable-subagent-catalog-and-list-agents.md)。

### Task 與取消的所有權

初始後臺委派請求 `ctx.subagents` 啟動 child 並註冊其 Task。可繼續提供方只有在確認本次啟用的最終工作階段狀態已持久化後，才會返回成功的 run 結果。Task 結帳流程等待該結果，透過繼續執行管理器的結帳路徑呼叫 `run.dispose()`，然後才記錄 `JobOutcome`；`job_kill` 中止活躍 run，其結帳路徑仍會 dispose 該 run。因此，終態 Task 會留下持久化 child 工作階段，但不會留下存活的 child agent。必需的持久性檢查點若沒有已安裝的監聽器或任一監聽器失敗，run 會以穩定錯誤碼 `DURABILITY_FAILED` 拒絕，並將檢查點失敗保留為失敗原因；管理器會記錄失敗的 Task，其詳情說明最新狀態未確認已持久化，因此復原時可能不可用或已過時。

後續每個輪次都會建立另一個 Task。該輪 producer 持有的執行資源僅服務於這次啟用，不屬於 child 工作階段。它只會到達一次終態、只產生一個結果，也不會重新打開。Task 登錄檔中當前註冊的那個存活 parent agent 實例仍是其 owner：dispose 該實例會取消、等待並移除其 Task。Task API 會授權 session id 與該 owner 匹配的呼叫方，但 id 相同的替代實例不會成為通知或資源清理目標。這一設計保留 `settleRun()` 約定，並使 Task 所擁有的存活 child 數量受並行工作量限制，而不是隨歷史工作階段數量成長。

使用者介面配接器打開 child 工作階段時，只讀取持久化 transcript，不會僅為展示而復原 agent。使用者輸入透過繼續執行管理器，啟動或加入與 parent 輸入相同的 Task 啟用。由使用者啟動的 Task 會保留當前載入的精確 parent Agent 作為通知目標，`job_output` 仍是唯一結果路徑。只要 Task 尚未標記為已報告，現有完成監聽器最多注入一條主動通知；`kill`、終態讀取或終態等待都可能將其標記為已報告，並抑制這條通知。因此，僅允許在該 parent 實例保持存活時進行使用者互動。可以比 parent 存活更久、並將結論顯式合併回去的使用者自有工作階段屬於[互動式 side session](../../proposed/feature/2026-07-08-interactive-side-sessions.md)，不屬於這一由 Task 持有的生命週期。

如果沒有附加任務控制器，`JobRegistry.start()` 會拒絕 producer。因此，接受 child 輸入的使用者介面配接器必須附加任務控制器，或執行於載入了 `@deepseek-ai/dsh-tool-jobs` 的部署中；僅載入 Task 服務並不足夠。這項相依性是 parent 和使用者啟動的啟用共用 Task 結果、取消和通知路徑所付出的代價。

取消始終作用於當前完整啟用。如果使用者訊息和 parent 訊息已經加入同一個輪次，任一呼叫方發起取消都會中止該輪次、dispose 其 run，並將對應 Task 結帳為 `killed`；這些訊息沒有獨立的結果或取消權。`followup()` 要求呼叫方提供訊號；若線上 steering 正在等待請求准入時該訊號被中止，啟用自有的 controller 會被中止，以便提供方丟棄待處理訊息，並且該呼叫僅在子 agent 完全靜止後結帳。若需要獨立取消，後續訊息必須另起輪次，而不能加入當前輪次。

從持久化儲存復原的 Task 會在尋找描述符或等待任何提供方操作之前，建立由本次啟用持有的 `AbortController`；描述符尋找、直接 parent 鑒權和描述符歸並都在該 Task producer 內部執行，因此同一訊號覆蓋它們，其失敗會將該 Task 結帳為 `failed`。對於不接受訊號的持久化呼叫，可以讓底層 I/O 執行完畢；但繼續執行管理器必須在每次這類 await 返回後重新檢查取消狀態，如已取消，之後不得開始或發布任何 child 工作。在 Agent 發布前收到中止訊號時，提供方必須先回滾其建立交易並達到完全靜止狀態，然後才讓復原呼叫以拒絕結束。Agent 發布後，提供方必須消除建立期間移交取消訊號時的競態，在返回前將同一訊號附加到存活 run；之後取消會停止 child 輪次。即使提供方的復原呼叫尚未返回 `SubagentRun`，`job_kill` 與對確切 owner 實例的 dispose 仍透過這條路徑生效。Task 結帳會等待回滾或 run dispose 完成，只有在啟用完全靜止後才記錄 `killed`。

### 活躍 run 關聯

繼續執行管理器在行程內維護 child session id 到當前 Task 的關聯，並在提供方發布後將 run 填入該關聯。它會在等待提供方 start 或 resume 之前安裝 Task 關聯，填入返回的 run，並且只在 run dispose 完成且 Task 終態發布後才移除該關聯。該關聯只用於讓 parent 傳送方和使用者傳送方找到同一次啟用；它不是持久化 child 目錄、公開的 `ManagedSubagent`、准入預留或 run 狀態機。

對於可繼續 child 的初始啟用，繼續執行管理器會在建立 Task 前分配穩定的 child session id，並將其作為 `SubagentProviderStartRequest.continuation` 傳遞；行程內 spawn 和 fork 會發布這一確切 id，而不是在內部另行分配。普通 `SubagentStartRequest` 不含 continuation 欄位。後臺工具返回規範的 `{ kind: 'background', jobId, subagentId }`，渲染為 `started subagent <childId> as job <jobId>`。child id 在多次啟用中始終指代同一個持久化對話，Job id 則只指代當前啟用。初始 Task 失敗，或行程在 child 首次 flush 之前退出，都可能留下一個 **unmaterialized child**：呼叫方持有 child id，但不存在持久化 header 和描述符。後續按 id 的操作會報告該 id 不可用（已啟動的 Task 會帶著該詳情失敗），持久化枚舉也不會列出它。

每個可繼續 child 輪次都透過這條由 Task 支撐的路徑准入。非終態 Task 是唯一受支持的存活啟用；不存在啟用時，其 run 已被 dispose，持久化 child 可以復原。在路由任何按 id 的操作之前，繼續執行管理器會同步將自身關聯與 `ctx.agents.get(childId)` 比較。如果登錄檔中的 Agent 沒有關聯，或者它與所關聯的 `run.localAgent` 不同，就屬於所有權衝突：管理器會失敗，而不會接管 idle Agent 或附加未受跟蹤的輪次。二者均不存在時，可以從持久化儲存復原；如果檢查後又有競爭方發布，仍會在 Agent 登錄檔的衝突邊界上失敗。

系統依據 Task 關聯進行路由。執行中的 Task 透過 run 選填且提供確認語義的 `SubagentRun.steer` 功能接收線上訊息。Task 不存在時，系統建立新 Task，並從持久化儲存復原 child。行程內 spawn 和 fork 會先同步要求 child 處於 `running` 狀態，並拒絕已經提交結構化捕獲的 child；隨後呼叫 `Agent.steer()`，等待該訊息專屬的准入回執。默認迴圈會為每個 steering 項目提供一份歸屬於該訊息的回執；只有在 `agent/step` 與非同步提示詞組裝成功後，系統追加該訊息、捕獲不可變的請求歷史並提交 `step/start`，回執才會解析為 `admitted`。終止型輪次策略、取消和 dispose（資源釋放）會將待處理回執解析為 `rejected`。非終止型輪次關閉可以把待處理 steering 帶入後續排隊輪次，但不會確認其准入。提供方必須在呼叫 `Agent.steer()` 前檢查存活狀態，避免其 idle 路徑在觀察到的 run 之外啟動輪次。如果尋找關聯之後、請求獲準之前，Task 結帳或終止策略率先完成，`steer()` 會拒絕，`send_message` 會報告訊息未送達，而且該次呼叫不會改用從持久化儲存復原路徑；在 Task 終態發布後重試，纔可能啟動下一次啟用。

繼續執行管理器不會序列化兩個透過其外部路徑同時爭搶已停止 child 的呼叫方，也不會為結果產生與 dispose 之間的階段單獨建立 settling 狀態。在 producer 首次 await 之前同步安裝的關聯，使本行程內每個 child 只准入一次啟用——resume 載入期間競爭的 `followup` 會觀察到待處理的啟用並顯式失敗——而繞開該關聯的發布仍會在 Agent 登錄檔相同工作階段的衝突邊界上失敗。傳送也可能因與啟動、取消、完成或清理髮生競態而失敗。這些限制是明確的，而非隱藏在更大的生命週期抽象之後。

### 面向模型的 `send_message`

模型獲得一個由 `SubagentRuntime.followup()` 支撐的 `send_message(subagent_id, message)` 工具，與 `Agent` 上的意圖動詞一致。該服務操作負責在 steering 與復原之間編排；它不同於 run 的 `SubagentRun.steer?()`，後者只能向已活躍的 run 傳送訊息。工具本身不執行生命週期路由。該工具將後續訊息的來源標記為 `{ kind: 'coordinator', senderSessionId: parent.id }`，並轉發 `{ source, signal }`；服務要求在一個選項對象中同時提供這兩項資訊。來源會貫穿線上 steering 和 cold resume 兩條路徑，而取消只控制尚未完成的線上投遞等待，因為 cold resume Task 會立即返回，並自行負責後續取消。child 模型收到的仍是普通的 user role 內容，而持久化的來源資訊可防止模型生成的後續訊息被歸類為直接使用者輸入。使用者配接器則提供 `{ kind: 'user' }` 及其互動訊號。該工具位於單獨載入的 `@deepseek-ai/dsh-tool-subagent-control` 包中，因此按提供方綁定的 `@deepseek-ai/dsh-tool-subagent` 實例可以繼續為 spawn、fork 或 ACP 註冊不同的委派工具，而不會重複註冊全域性控制工具。

- 如果 child 存在執行中的 Task 並支持線上訊息，服務會呼叫 `run.steer(message, source)` 並返回現有 job id；它不會建立新 Task。
- 如果 child 沒有執行中的 Task，`send_message` 會建立新 Task，使用該訊息從持久化儲存復原工作階段，並返回新的 job id。
- 如果活躍提供方無法接收線上訊息、帶確認語義的 steering 在准入競態中失敗，或 Task 關聯之外存在存活 child，`send_message` 會失敗，而不會靜默啟動、復原或接管未受跟蹤的輪次。

服務結果將路由標識為 `steered` 並攜帶現有 job id，或標識為 `started` 並攜帶新的 job id。失敗結果會明確說明訊息未送達。面向模型的工具會呈現這些差異，讓呼叫方能夠觀察由時序決定的實際路由。

傳送到現有 run 的訊息沒有獨立結果，其效果體現在當前 Task 的最終結果中。啟動的後續輪次具有新 Task 的結果，並使用現有 `job_output` 讀取路徑。subagent 層不會再注入第二份完成通知。

使用者輸入使用同一個 `followup` 操作。UI 可以展示 child transcript 和當前 Task 狀態，取消操作則以已載入 parent 作為呼叫方訪問 Task 服務。工具 schema 與 UI 配接器消費同一個服務約定，不建立彼此獨立的執行路徑。

### 持久化 child handle 與從持久化儲存復原

繼續執行管理器在建立 Task 前，透過 seam 的 `snapshotSubagentDescriptor()`（基於 [`snapshotJsonValue`](../../../../packages/core/session/src/json.ts) 建置）對每項描述符輸入建立快照；這一邊界與 Agent 訊息現有的分離式無損 JSON 邊界一致。作用於 child 作用域的 setup contribution——由行程內驅動程式前置安裝的一次性 `agent/prompt-submit` 監聽器——會在下游 prompt admission 能夠阻止請求或拋出例外之前追加一個對模型隱藏的 `subagent/descriptor` 事件。admission 獲準後才會開啟 child 的初始輪次；admission 被拒絕時，描述符會作為輪次前的僅日誌事實保留，並由該 activation 最終的必需檢查點持久化。該事件不攜帶 `surfaceOp`，不進入模型歷史，並在壓縮替換 surface 歷史時繼續保留。只有在載入已知 child id 對應的 child 工作階段後，能在該 child 自身的後綴中（`seedLength` 之後，因此 fork seed 不會洩露祖先的描述符）得到受支持的描述符，且工作階段 header 將呼叫方標識為直接 parent 時，該 id 纔可復原。

版本化描述符的可繼續分支（[descriptor.ts](../../../../packages/subagent/subagent/src/descriptor.ts) 中的 `SUBAGENT_DESCRIPTOR_VERSION`）攜帶 `mode: 'continuable'`、subagent 提供方名稱、已解析的 child `agentOptions.provider` 和 `agentOptions.model`，以及選填的 `persona` 與 `toolFilter`。它不會對可透過聲明合併擴充的 `AgentOptions` 對象建立快照：與此無關的擴充值不會僅因無法表示為 JSON 而導致繼續執行失敗。描述符會特意省略 `subagentDepth`；從持久化儲存復原時，系統相依性持久化 header 中的 `delegationDepth`，而不根據描述符重建深度。`outputSchema` 屬於單次啟用的結果約定，不屬於持久化 child 組合設定。child header 仍是 child id、`cwd`、`parentSession`、`seedLength` 和 `delegationDepth` 的權威資訊，持久化 child transcript 則負責保存 fork seed 和後續歷史。[`delegationDepthOf()`](../../../../packages/subagent/subagent/src/index.ts) 會在 header 值和執行時期值中取最大值，因此重建後的執行時期選項可以加深持久化值，但絕不能降低它，復原後的 child 無法重新獲得頂層委派預算。

從持久化儲存復原不能相依性 `SubagentRun` 的選填方法，因為該 run 已被 dispose，並且行程重新啟動後不會保留。run 表示一次可 dispose 的啟用，只暴露作用於當前啟用的操作。`SubagentRun.steer?()` 這一名稱明確指代提供確認語義且僅適用於線上訊息的功能，以免該功能與服務編排或面向模型的工具混淆。

內部繼續執行管理器的復原路徑會載入已知 child 工作階段、歸並其描述符、根據持久化的 `parentSession` 鑒權，並在其建立的 Task 內部執行。它透過私有服務閉包傳遞完全解析的 `SubagentProviderResumeRequest`，其中包含由 Task 持有的取消訊號；該閉包只負責在檢查提供方功能後進行分發，並執行 `start` 所使用的普通 run 生命週期觀察。選中的 `SubagentProvider.resume?()` 負責傳輸相關的重建（行程內：在當前載入的 parent 作用域下執行 `parent.ctx.agents.resume`），並返回一個新 run。提供方是否存在該方法本身就是繼續執行功能，無需額外功能標志。`SubagentRuntime.followup()` 在關聯 run 的 `steer?()` 操作與該持久化復原路徑之間做出選擇。私有的提供方分發與提供方本身都不會枚舉持久化 child 或關聯 Task。

後臺工具會在呼叫 `JobRegistry.start()` 前校驗描述符輸入並建立快照。同步校驗失敗會拒絕工具呼叫，且不會建立 Task。除此之外，工具會立即返回 child id 和 Job id，不等待 child 發布或描述符持久化完成。行程內可繼續提供方會在 child 進入 idle 後、讀取結果之前執行最終的 `SessionStore.flush()`；返回 `true` 表示至少有一個持久性監聽器參與，返回 `false` 表示必需的檢查點失敗，而拒絕則攜帶監聽器失敗。此操作會在 child 仍存活時重試迴圈中失敗的檢查點。如果最終確認失敗，提供方會拒絕而不返回未經確認的輸出，繼續執行管理器會 dispose 該 run，已經建立的 Task 會結帳為 `failed`，其詳情包含持久性診斷。最終確認期間發生取消時，尚未發布的啟用結果由取消操作接管；即使 child 輪次已記錄為完成，或之後的檢查點失敗，也不能取代 Task 的 `killed` 結果。前臺一次性執行仍保留迴圈僅盡力執行檢查點的行為。行程內 spawn 和 fork 會在當前已載入的 parent 作用域下重建組合設定。復原 fork 時只載入 child 自己的持久化 transcript，其中已經包含初始建立時捕獲的已完成輪次前綴；系統絕不會再次 fork parent 更新後的歷史。復原 parent 不會立即復原其 child。

TODO（ACP 繼續執行）：將遠端 ACP session id 作為提供方專用描述符資料持久化，並實作 `AcpProvider.resume?()`，依次執行 spawn、initialize、`loadSession` 和 prompt。初始 ACP run 必須檢查 `initialize.agentCapabilities.loadSession`，復原後的每個行程必須使用同一個持久化後端；`loadSession` 重播的歷史訊息不得計入新啟用的輸出。由於 ACP 的載入支持是按 child 協商的，不能僅根據提供方是否存在該方法來確定，因此該後續工作還必須定義 start 結果如何聲明單個 child 支持繼續執行，之後才能將 ACP child 寫入持久化目錄。

### 結果與通知所有權

每次可繼續 child 啟用都恰好擁有一個 Task 和一個 `JobOutcome`，無論第一則訊息由 parent 還是使用者提供。只要 Task 尚未標記為已報告，通用 Task 報告約定最多會向保留的 parent owner 注入一條主動完成通知；讀取、等待和取消都可能抑制該通知。傳送到執行中啟用的訊息會加入該啟用，不會建立第二個 Task 或第二份結果。child transcript 是面向使用者的詳細記錄；Task 輸出是面向 parent 的最終結果。

Task 記錄和活躍 run 關聯都位於行程內。持久化使 child 工作階段可在重新啟動後復原，但不會復原中斷的 Task、其結果或通知。持久化 Task 復原屬於另一個問題。

## 已考慮的替代方案

**在 Task 結帳後保留所有後臺 child。** 這是 Codex 風格的常駐工作階段模型：傳送後續訊息成本較低，但歷史 child 會持續佔用 agent 作用域、工作階段記憶體、監聽器和提供方資源，直至顯式常駐數量上限或淘汰策略將其移除。逐啟用 dispose 使用持久化作為繼續執行邊界，同時保留當前的資源上限。

**允許使用者輪次不使用 Task。** parent 訊息加入此類輪次後，沒有對應的 Task 結果或完成通知；UI 取消對 parent 所傳訊息的影響也不明確。讓每次啟用都擁有一個 Task，可使完成與取消成為 child 輪次的屬性，而不是初始呼叫方的屬性。

**在 child 工作階段整個生命週期內複用一個 Task。** 終態 Task 無法自然地再次進入執行狀態，一個結果也無法表示多個輪次。每次啟用建立新 Task 可以保留通用 Task 約定。

**為每則訊息建立 Task。** 傳送到現有 run 的訊息會加入已有輪次，不產生獨立的最終結果；為這類訊息建立 Task，會重複當前 Task，或報告一個它並不擁有的結果。只有啟動新啟用的訊息才會建立 Task。

**拆分 `send_message` 與 `follow_up`。** 兩個獨立的投遞操作會向模型暴露實作狀態差異，卻無法消除 child 已停止時的競態。單一操作採用 Claude Code 模型：向執行中的工作傳送訊息，或復原一個由新 Task 支撐的生命週期。

**在已 dispose 的 run 上保留 `resume?()`。** 如果僅為呼叫 `resume()` 而保留已 dispose 的 `SubagentRun`，舊 run 會同時充當持久化 child handle，而且行程重新啟動後無法重建該對象。由服務分發、提供方重建，可明確表達持久化邊界。

**將控制編排放在 `SubagentRuntime` 上。** 這一服務放置方案即[服務合併決策](../simplification/2026-07-26-merge-subagent-control-service.md)；[意圖操作細化](../simplification/2026-07-27-intent-named-subagent-continuation-operations.md)將提供方 start／resume 分發的複用限制在服務內部，同時將選填的 Task 與持久化工作隔離在注入的內部管理器中。

**增加顯式啟用階段。** 公開的 `starting`／`running`／`settling` 狀態可以準確描述准入和清理，但會引入實作本身並不需要的生命週期協議。同步安裝關聯無需暴露這些階段，即可消除行程內重複的 cold resume。

## 測試

- `packages/subagent/subagent-in-process-driver/tests/subagent-in-process-driver.spec.ts` 固定可繼續執行的持久性邊界：缺少 flush 監聽器、flush 監聽器已脫離或監聽器持續失敗時，均會以 `DURABILITY_FAILED` 拒絕；迴圈檢查點的瞬時失敗可在最終確認成功後繼續完成，發生取消時最終檢查點無論成功還是失敗都由取消優先決定結果，resume 同樣會確認持久性，而前景執行仍採用盡力而為策略。`packages/subagent/subagent/tests/continuation.spec.ts` 以無金鑰方式驅動程式真實棧（agent loop、JSONL 持久化、spawn／fork 提供方、Task 服務和 `ctx.subagents`）：初始及復原後的啟用都會建立新 Task，並在進入終態前 dispose 各自的 run；描述符事件位於輪次前、對模型隱藏、帶版本、在服務分配的 child id 下持久化，並在初始 prompt admission 阻止請求或拋出例外時仍保留；取消、steering、cold follow-up、授權、所有權衝突與 resume 競態保留上述約定。
- `packages/subagent/tool-subagent-control/tests/tool-subagent-control.spec.ts` 固定 `send_message` 的 schema、coordinator 來源標記、兩種路由渲染、未送達失敗、無 agent 時的拒絕，以及 HMR（熱模組替換）dispose。
- `packages/subagent/tool-subagent/tests/tool-subagent.spec.ts` 覆蓋設定的後臺路由：可繼續模式要求提供方可復原，並在不要求 `send_message` 的情況下返回兩個 id；即使提供方可以復原，一次性模式仍保持普通的 Task 確認訊息；它還固定 Task 服務整合及面向模型的 Task 控制工具。
- 無金鑰 ACP 快照場景 `subagent-continuable`（examples/acp-agent）固定模型可見的 transcript：雙 id 確認訊息、最終持久性確認失敗（該失敗透過 `job_output` 呈現，且不包含未經確認的 child 輸出），以及一次 `send_message` 後續操作——其已啟動的 Task 會帶著「id 不可用」失敗。

## 影響

- 每次完成結帳後的後續輪次都需要承擔持久化載入和作用域 setup 成本；作為交換，存活 child 的數量受並行工作量限制，而不是隨歷史工作階段數量成長。持久化不可用或儲存的組合設定無法重建時，可繼續 child 的建立會明確失敗。
- 兩個呼叫方仍可能透過繼續執行管理器外部的路徑爭搶已停止的 child。Agent 登錄檔會阻止相同工作階段的重複發布；失敗的 Task 會失敗，且其訊息不會送達。訊息也可能與取消、終態狀態發布或 run dispose 發生競態。准入不承諾原子或恰好執行一次；在行程內同步安裝的關聯無需公開生命週期狀態機，即可透過 `followup` 消除重複的 cold resume。
- 透過普通 Agent API 驅動程式可繼續 child 會繞過其 Task 關聯。`ctx.subagents` 會將該存活 child 視為所有權衝突並拒絕；配接器必須在不載入 Agent 的情況下展示持久化 transcript，並透過 `SubagentRuntime.followup()` 提交使用者輸入。
- 活躍 run 關聯只能協調一個執行時期。多個行程同時復原時不會序列化；此類部署需要持久化層的租約或 compare-and-set 操作。
- 使用者互動要求作為 owner 的那個精確 parent Agent 實例保持存活，因為 dispose owner 會取消並移除其 Task。使用者互動還要求附加任務控制器。若要單獨與 child 互動，後續必須將 Task 訪問所有權與持久化通知目標分離。
- 後臺工具會在 child 發布和描述符持久化之前返回 child id 和 Job id。啟動失敗、最終持久性確認失敗，或行程在 child 首次 flush 之前退出，都會使 Task 失敗，並可能留下 unmaterialized 或過時的 child id；按 id 的控制操作會將缺失狀態報告為不可用，而不會追溯修改工具確認訊息。
- 將顯式組合欄位持久化到 child 日誌後，其無損 JSON 與相容性約定便成為復原約定的一部分。後續如需支持其他組合設定輸入，必須明確更改描述符版本，不能隱式持久化可透過聲明合併擴充的 `AgentOptions` 欄位。
- Task 記錄和活躍 run 關聯位於行程內，而 child 工作階段具有持久性。重新啟動會復原工作階段，但不會復原進行中的工作或其 Task 通知。
