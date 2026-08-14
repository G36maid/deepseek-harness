# @deepseek-ai/dsh-subagent

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

subagent seam 允許一個 agent（代理）透過具名提供方把工作委派給子 agent。呼叫方統一使用 `ctx.subagents` 服務 API；提供方決定子 agent 在當前行程、其他行程，還是透過未來的傳輸方式執行。

[subagent 家族概述](../README.md)列出了實作和麵向模型的消費端。本包負責提供方登錄檔、共享請求和結果約定、持久描述符以及可繼續子級編排。多個具名提供方可以在該約定背後共存。

## 服務 API

`SubagentRuntime` 具有以下操作：

| 成員 | 含義 |
|---|---|
| `registerProvider(provider)` | 按名稱註冊一個可信的同進程實作。註冊受 effect 作用域約束；移除註冊會阻止新的啟動，但不會撤銷已返回給呼叫方的執行。重複名稱會明確報錯。 |
| `getProvider(name)` | 返回提供方；不存在時返回 `undefined`。 |
| `list()` | 按插入順序返回提供方名稱。 |
| `start(name, request)` | 校驗普通呼叫方請求，解析其已分離的 `one-shot` 描述符，然後等待提供方發布真正的一次性子 agent。兌現時返回由持有方擁有的 `SubagentRun`；如果呼叫被拒絕，提供方已經清理所有尚未發布的啟動資源。發布後的輪次故障或基礎設施故障則透過該 run 結帳。可繼續子 agent 絕不透過此操作進入。 |
| `startContinuable(spec)` | 建立一個持久化的可繼續子 agent，並投遞其初始提示詞。子 agent 的 inbox 一接受該提示詞，呼叫就會兌現為 `{ childId, messageId }`，無需等待輪次開始，也無需等待訊息寫入工作階段日誌。在此之前發生的任何失敗都會使呼叫被拒絕，不返回任何 id，並完全回滾該子 agent。要求 `ctx.agents`、工作階段持久化以及具備 `prepareContinuable` 能力的提供方。 |
| `followup(parent, childId, content, { source, signal })` | 將來自確切線上直接父級的一條後續訊息作為子 agent 的下一個 FIFO 輪次投遞，術語與 `Agent.followup()` 一致，並返回被接受的 `MessageId`。駐留中的子 agent 由其 inbox 直接接受（喚醒處於 waiting 的 Activation）；不駐留的則從其持久化工作階段冷復原。要求 `ctx.agents`；冷復原還要求工作階段持久化。 |
| `interrupt(targetSessionId, authority)` | 憑人類出示的持久化父級地址 `{ kind: 'user', parentSessionId }`，或確切線上的祖先 Agent `{ kind: 'ancestor', agent }` 進行授權，中斷一個線上可繼續子級的當前輪次。准入判定同步完成，但取消非同步生效：該操作寄出 `Agent.cancel(cause, { keepInbox: true })` 後立即返回，不等待目標觀察到訊號。尚未領取的待處理 inbox 工作、Activation 和已發布的後代均會保留；已經領取到被中斷輪次中的工作不會重新入隊。目標不存在時視為已接受的空操作；錯誤的父級地址，或過時、指向自身、並非祖先的呼叫方，會以 `UNAUTHORIZED` 被拒絕。 |
| `reportFrom(child, content, { delivery, signal })` | 從確切線上可繼續 child 向其確切線上直接 parent 投遞一條選中訊息，並返回已接受的穩定 `MessageId`。靜默投遞會注入上下文；喚醒投遞會提交一個後續 parent 輪次。 |
| `registerContinuableSetup(contribution)` | 把一項選填部署能力組合到每個可繼續 child 尚未發布的作用域中，並支持從駐留 child 立即撤銷。 |
| `drainContinuableDescendants(parents)` | 在由 host 擁有的確切線上父級 Agent 之下關閉准入，只停止這些父級可見的可繼續後代；等待已在這些根節點下獲準的物化過程完成發布或回滾後，再按子級優先順序釋放所選的各棵樹。該截止狀態會持續到每個確切父級離開登錄檔；無關的父級樹仍線上，管理器全域性准入仍保持開放。 |
| `listChildren(parentSessionId, signal?)` | 按 `createdAt`、再按 id 的順序列出由工作階段支撐的直接 subagent，包括其 `one-shot`／`continuable` 模式、`running`／`inactive` 活動狀態、根據 origin 分類得出的一層 `hasChildren` 提示，以及每個子級的診斷資訊，且不會載入或復原它們。該操作直接讀取線上工作階段儲存和選填的工作階段持久化（沒有持久化時只枚舉線上子級），並要求已掛載 `sessionProjections` 登錄檔；不要求 `ctx.agents`、繼續執行管理器或任何查詢服務。 |
| `listDescendants(rootSessionId, signal?)` | 從同一份線上優先語料按穩定 pre-order 展平根的完整工作階段樹，並為每個 subagent 條目附加持久 `parentId` 與相對根的 `depth`。普通工作階段與一次性 child 仍作為遍歷節點，因此其下的可繼續後代仍可發現。身份、diagnostic、相依性與取消約定均沿用 `listChildren()`。 |

`SubagentStartRequest.label` 是由工作階段支撐的一次性 child 所使用的選填簡短持久化顯示標籤。面向模型的委派會提供其已有的 `description`；底層呼叫方無需憑空構造展示元資料。可繼續啟動始終攜帶自身的必填標籤。`signal` 是必填項，也是一次性 `start` 的規範取消通道。發布前中止會使 `start()` 在回滾後拒絕；發布後中止會取消已返回 run 的剩餘輪次工作，但不會隱藏其 id。請求還可以選擇模型、要求結構化輸出、限制委派深度、約束子 agent 工具或設定子 agent persona。對於可繼續啟動或後續操作，呼叫方訊號只負責 inbox 接受前的尋找、物化和准入；此後，Activation 由管理器獨立擁有，因此呼叫方取消既不會取消已接受的輪次，也不會 dispose（資源釋放）子 agent。

後續操作的權限來自子 agent 持久化 header 中記錄的確切線上直接父級。冷復原會在重建前檢查該權限，並在最終無 await 的 inbox 准入區間再次檢查，因此在物化期間被註銷或替換的 parent 無法授權投遞。後續操作上的 `source` 記錄誰提供了所投遞的訊息，不授予任何權限。

同進程請求、描述符、結果和事件 payload 都是可信的類型值，並按不可變約定借用。服務不會克隆或凍結它們；序列化和不可信輸入校驗屬於真實的行程、worker、持久化和模型邊界。

## 能力

啟動時功能透過 `provider.capabilities` 聲明，因為服務必須在建立子 agent 前拒絕不受支持的一次性請求：

- `outputSchema`：強制執行結構化最終結果；
- `depthLimit`：強制執行 `maxDepth`；
- `toolFilter`：應用請求的子 agent 工具限制；
- `persona`：應用每個子 agent 獨立的 persona。

每個行程內子 agent 都透過一次 `applyChildComposition(childCtx, parent, composition)` 呼叫完成組裝：先加入父級的 agent-preset 組合，再應用子 agent 自己的 persona 和工具限制。加入父級組合正是子 agent 獲得能力的途徑：所有面向模型的行都位於 agent 平面，完全沒有加入任何組合的子 agent 抵達模型時會看到空的工具登錄檔（見 [`dsh-agent-presets`](../../preset/agent-presets/README.md)）。將父級作為參數是刻意設計：這讓“組裝子 agent 卻不做該加入”在各呼叫點無法表達，而這正是這一次呼叫所要杜絕的缺陷。未組裝 preset roster 的部署不加入任何組合、也不需要加入；其面向模型的行位於宿主組閤中，子 agent 已能透過工具登錄檔的全域性層解析到它們。

`childSessionMeta()` 把所加入的 preset id 記在子 agent 的持久化 header 上，理由與頂層工作階段記錄自己的那一個相同：preset 決定了模型所見的工具 schema 與提示段，因此冷讀子 agent 的歷史時必須重建那份組裝，而不是部署預設值。該值從父方**活著的** scope 鏈讀取，而不是從父方 header 讀取，因為在空白期切換過 preset 的父方執行在更新的那份組裝上，而它的 header 仍寫著舊的那個。

可繼續建立對應選填的 `SubagentProvider.prepareContinuable?()` 方法：方法是否存在就是能力檢查，因此服務會在沒有該方法的提供方上拒絕已設定的可繼續啟動，而具備該方法的提供方仍可服務普通一次性委派。該方法只返回已分離的 `ContinuableCreateSpec`（`{ seed? }`）。它只是資料，不攜帶任何能力：不包含 Agent、`AgentHandle`、提示詞投遞、結果、dispose 或復原操作。準備完成後，身份預留、組合、Agent 建立、提示詞投遞、冷復原、所有權和 dispose 均由繼續執行管理器負責。一次性 `SubagentRun` 表示一次可 dispose 的前臺委派，只有一個結果，且沒有冷復原操作。服務可以針對不同的同級子 agent 並行呼叫同一提供方：每次啟動或準備都擁有各自的可變狀態和取消路徑，一項操作的失敗、結果或清理不得使另一項操作結帳或釋放。提供方可以在內部按自身容量排隊，但不得改變這項獨立性約定。

## 持久化描述符

該 Service Definition 擁有版本化的 `subagent/descriptor` 工作階段事件詞彙（`src/descriptor.ts`）：`snapshotSubagentDescriptor()` 會在提供方工作之前校驗並分離記錄，`foldSubagentDescriptor()` 則會在從已載入子 agent 日誌中復原描述符之前，校驗當前版本的完整 payload。每次由本機工作階段支撐的啟動都會追加一個帶有提供方名稱與生命週期 `mode` 的描述符。`one-shot` 描述符可以攜帶呼叫方擁有的選填持久化顯示 `label`；`continuable` 描述符要求其持久化建立標籤，並另外記錄已解析的子 agent `agentOptions.provider`／`model`，以及用於從持久化儲存復原的選填 `persona`／`toolFilter`。這些是顯式欄位，絕不是可透過合併擴充的 `AgentOptions` 對象，因此無關的擴充值不會破壞繼續執行。描述符省略 `subagentDepth`（持久化 header 的 `delegationDepth` 是單調下界）和 `outputSchema`（單次 Activation 的結果約定）。該事件只進入日誌：不含 `surfaceOp`，不進入模型歷史，並由僅附加日誌跨壓縮（compaction）保留。格式錯誤的當前版本 payload 屬於損壞；本執行時期無法對不受支持的版本進行分類。

## 委派深度

該 seam 擁有 Service Provider 和 Consumer 共享的深度詞彙：`AgentOptions.subagentDepth` 聲明、`assertSubagentMaxDepth` 和 `delegationDepthOf(agent)`。持久化的 `SessionHeader.delegationDepth` 具有權威性且單調：執行時期選項可以增大委派深度，但絕不能將其降到這個下界以下，因此復原後的子 agent 不會被重新計為頂層。

`inheritsParentContext` 只用於描述，不能強制執行。它僅說明子 agent 是否能看到父級已完成的對話歷史（`fork` 可以；`spawn` 和各行程外一次性提供方不可以），不表示是否繼承工具、服務或權限。

## 委派策略

兩條行程內委派路徑都會透過共享的子 agent 輔助函式，在委派邊界固定子 agent 的權限範圍。`captureDelegatedPolicyOverrides(parent)` 會為父工作階段的顯式沙盒覆蓋項（`sandboxPolicy.overrideOf()`）建立快照，並在審批能力已組合時將子 agent 的審批策略固定為 `'never'`，無論父級自身採用何種策略。這樣，被委派的子 agent 只能在繼承的沙盒範圍內行動，每次審批請求（例如 `sandbox_permissions` 升權）都會被確定性拒絕，而不會等待無人處理的提示（這兩個服務都是選填的 `ctx.get` 消費端）。`appendDelegatedPolicyOverrides()` 則在未發布的設定階段、在任何 fork 種子之後，把每個值作為一條 `source: 'delegation'` 的 `sandbox/mode` 或 `approval/policy` 事件寫入子 agent 自己的日誌。因此，新捕獲的策略會覆蓋種子中的過時狀態，而子 agent 的生效策略始終可以僅憑其日誌重建。沙盒的部署預設值絕不複製：未切換的父級不會記錄 `sandbox/mode`，其子 agent 會動態跟隨部署預設值。可繼續啟動會在第一次 await 前捕獲策略，並且只為全新物化寫入這些委派事件；冷復原只會重放已持久化的委派事件，不會重新捕獲父級策略，因此建立之後的父級切換絕不會追溯性地改變持久化子 agent。每個行程內子 agent 還會收到一條作用域內的執行時期上下文聲明（`subagent:delegation`），告知其權限範圍已固定，需要更寬訪問的任務應以上報限制收尾，而不是重試。參見[一次性](../../../.agents/notes/implemented/feature/2026-07-25-subagent-policy-inheritance.md)與[可繼續](../../../.agents/notes/implemented/feature/2026-08-10-continuable-subagent-policy-inheritance.md)兩篇委派策略 Agent Note。

## 一次性所有權與生命週期

`provider.start(request): Promise<SubagentRun>` 是所有權轉移邊界；委派工具也會在其由 Task 支撐的一次性後臺路徑中使用它。兌現前，提供方擁有設定過程，並且在任何失敗路徑上都必須取消、回滾並使尚未發布的資源完全靜止。兌現後，run 的所有權轉移給呼叫方；呼叫方必須在每條路徑上呼叫 `dispose()`。剩餘提示詞和輪次工作屬於 `SubagentRun.result`。

`SubagentRun.result` 兌現為 `{ output, structured?, stopReason }`。子 agent 級失敗會以非 `completed` 原因兌現；只有 seam 無法表示的基礎設施故障纔可以拒絕。`dispose()` 是冪等的，會取消剩餘工作，並等待結果結帳以及子 agent 資源完全靜止。result 的拒絕只透過 `result` 本身報告；只有獨立的資源釋放失敗，才會使 `dispose()` 被拒絕。`output` 與 `subagent/end` 事件的 `lastAssistantMessage` 使用匯出的 `AssistantOutputFold`／`finalAssistantOutput` 輔助函式選取子 agent 最後一條非空 assistant 訊息；若沒有這類訊息，則選取其累積的 assistant 文字。子 agent 兩種輸出均未產生時，`output` 為 `[]`，該事件欄位預設（結果約定歸 [`SubagentResult.output`](../../../docs/subsystems/subagent.md#the-terminal-result-subagentresult) 所有）。

本機執行會在 `start()` 兌現前發布普通的子 agent／工作階段，把該共享工作階段 id 作為 `SubagentRun.id` 返回，以 `SubagentRun.localAgent` 公開準確的子 agent，把 `request.parent.session.id` 記錄到子 agent 的 `parentSession` header，並在其初始輪次內追加已解析的描述符。遠端提供方則生成 parent 作用域的生命週期 id，並返回 `localAgent: undefined`；由於沒有本機 child 工作階段，其一次性執行不會進入基於追蹤的枚舉結果。

## 可繼續子 agent 與 Activation

每個可繼續子 agent 都有一個持久化 Session，並且同一時刻至多有一個行程內 **Activation**。Activation 表示重建後的子 agent 的一次駐留時段，不是請求、結果、取消或 Task 的邊界。Agent inbox 是唯一的輪次佇列，因此駐留歸繼續執行管理器，所有輪次排序與執行歸 agent loop（代理循環）。任何可繼續路徑都不會建立 Task 或中間的承載結果的包裝層。

管理器根據 Agent 的完全靜止狀態和所擁有的子級集合推導三種內部駐留狀態，而不維護第二套狀態機：running 表示存在正在進行的准入、尚未結束的輪次，或會喚醒 Agent 的 inbox 工作；waiting 表示 Agent 已完全靜止，但仍擁有至少一個尚未 dispose 的子級；settled 表示 Agent 已完全靜止且所有擁有的子級均已 dispose，此時管理器會 dispose `AgentHandle` 並移除 Activation。每條後續訊息都使用 `Agent.followup()` 並成為一個 FIFO 輪次，且不會對當前輪次進行 steering（中途引導）。路由只取決於駐留狀態：running 入隊、waiting 喚醒同一 Agent，無 Activation 時則冷復原一個新的。

管理器預留子 agent 身份、解析持久化描述符，透過私有的 activation-owner 作用域呼叫 `ctx.agents.create()`（冷復原時為 `ctx.agents.resume()`），把返回的 `AgentHandle` 安裝到 Activation 中，建立任何可繼續父級所有權，然後提交提示詞。冷復原絕不透過提供方分發，因為持久化工作階段已持有初始前綴，摺疊後的描述符即是全部重建輸入。

### 結帳投遞

當一個駐留 Activation 結帳時，管理器會在父級自身的輪次流中告知該子級持久化的直接父級：這個子級已經產出它將產出的全部內容。對於每個已經向呼叫方返回過 id 的子級，管理器都會無條件投遞結帳通知，不考慮該子級是否呼叫過 `report`。最需要說明結局的終止情形，包括達到 token 上限、模型失敗、取消或拆卸，恰恰是子級根本沒有機會選擇的那些情形。在第一則訊息被接受之前就回滾的物化保持靜默，因為那位呼叫方已被告知該子級未建立。訊息會攜帶該 epoch 的終止原因、它產出過的最終 assistant 內容，以及持久化來源 `{ kind: 'subagent-settled', form: 'notice', senderSessionId: <child-id> }`——與子級自撰的 `subagent-report` 是不同的來源 kind，因此 transcript（文字記錄）絕不會把執行時期寫下的話算到子級頭上。

有兩條順序規則讓這條投遞可靠而非僥倖，它們也正是這件事屬於管理器而非外部 `subagent/end` listener 的原因。第一，傳送發生在子級所有權釋放**之前**，此時父級仍然計入該子級，因此在結構上不可能被判定為已結帳。第二，如果父級本身也是駐留 Activation，該訊息會採用與 report 相同的喚醒准入記帳。這樣，從同步傳送訊息到負責准入該訊息的 microtask 執行之間的視窗，不會被誤判為完全靜止——`Agent.status` 會把上下文維護摺疊成 `idle`，而維護期間的喚醒傳送只會預置一次延後喚醒。缺少其中任一條規則，父級都可能在通知仍留在 inbox 時被 dispose，而 `cancel()` 會清空該 inbox，於是通知被靜默丟失。

空閒父級會以一個普通的後續輪次收到該通知。繁忙父級則被 steer 到其最近的 step 邊界，因此同時結帳的多個子級只消耗一個 step，而不是各自一個輪次；採用 steer 而非 inject 還意味著：即便驅動程式在狀態讀取與傳送之間退出，該訊息仍會被認領。如果父級所在的譜系已經開始排空，該通知會透過 inject 投遞，且完全不會喚醒父級。對已經完全靜止的父級呼叫 `Agent.followup()` 會開啟新輪次，而 `cancel()` 不會預先阻止之後開啟的輪次；因此在拆卸期間喚醒父級，會讓宿主即將 dispose 的 Agent 多執行一次模型請求，而且樹的每一層各一次，因為每層自己的通知又會喚醒上一層。被 inject 的訊息會送達仍在學取自身 inbox 的父級，而無論如何日誌都會記錄這份記帳；但它不會比該父級自身的 dispose 活得更久：`AgentHandle.dispose()` 是一次 `keepInbox: false` 的 cancel，會持久地取消尚未被認領的通知。因此 resume 後的父級沒有待處理通知可讀：`list_agents` 只告訴它有哪些子級、各自是線上還是僅存於儲存；結局本身留在子級自己的 Session 裡，一次 `send_message` 會透過 resume 該子級把它取回。已離開登錄檔的父級不算錯誤：通知被丟棄，子級自身的 Session 仍是持久記錄。投遞絕不會阻塞或使拆卸失敗——傳送被拒只會記錄日誌，因為為了重試一條通知而保留子級，會把它的整條祖先鏈永久釘在 `waiting` 上。

受繼續執行管理的父級 Activation 會在子 agent 能夠執行之前，把每個子 agent 的工作階段 id 記錄到 `ownedChildren` 集合中，並且只有在每個所擁有的子 agent Activation 完成 `AgentHandle` dispose 之後才會 dispose（子先於父）。拆卸會先自頂向下傳播 Agent 取消，再等待緩慢的後代，而 handle 釋放仍保持 child-first。頂層及其他非繼續執行的 Agent 沒有 Activation，處於該等待圖之外。最終結帳會在 dispose handle 前等待 best-effort 的 `ctx.sessions.flush(child.session)`。監聽器拒絕會被記錄，但不會使 Activation 失敗，因為監聽器參與本身不能標識持久化後端；因此復原時的持久化狀態仍可能缺失或過時。

## 生命週期事件

服務會為每次一次性執行以及每個已駐留的可繼續 Activation 時段寄出一對 `subagent/start`/`subagent/end`，因此可繼續子 agent 可用與一次性執行相同的詞彙觀察，且不會暴露管理器是物化、喚醒還是冷復原了它們。對於一次性啟動，它會在同步的 `subagent/start` 之前附加結果觀察器，因此即使子 agent 已經結帳，也仍會先產生 `subagent/start`，再產生 `subagent/end`；在駐留前失敗的可繼續時段不會發出這對生命週期事件中的任何一個。這對事件共享由服務生成的 `runId`；`local` 標志根據提供方返回的確切 `localAgent` 是否存在取得快照（可繼續子級恆為 true），因此觀察器不會根據可複用的提供方名稱或工作階段名稱推斷執行身份或本機性。`provider` 欄位包含子 agent 初次建立時記錄的提供方名稱，不表示該提供方當前仍在註冊：已接受的一次性 run 可在提供方移除後才結帳；冷復原時段會從描述符讀取初始提供方名稱，不會呼叫或註冊該提供方。

執行事件受執行委派的父級作用域約束。每個監聽器都獨立隔離：同步拋出或返回的 promise 被拒絕時，只會記錄日誌，不會阻塞同級監聽器或改變執行。

提供方新增和移除還會發出 `subagent/provider-added` 與 `subagent/provider-removed`。面向模型的工具等消費端使用這些事件，因為 Cordis 可能並行載入同級外掛程式；設定順序不能證明註冊順序。

可繼續子級不會建立 `SubagentRun` 或 Task。繼續執行管理器為每個駐留子工作階段直接擁有一個僅存在於當前行程的 Activation 和一個留存的 `AgentHandle`，使用 Agent inbox 作為唯一 FIFO，並從持久化描述符冷復原。父到子投遞由確切線上的直接父級身份授權。上報則由確切線上的子級身份授權；管理器根據持久化的 `parentSession` 推導接收方，`MessageSource` 記錄傳送方，但不授予權限。中斷權限被刻意設計得比投遞權限更寬：人類出示持久化直接 parent 地址，因此即使 parent Agent 離線，線上 child 仍可被停止；Activation 物化時記錄的任何確切線上 ancestor 也可以停止其後代，因為停止一個輪次是冪等的，且不投遞任何內容。

當 `ctx.sessionProjections` 可用時，服務會註冊兩個投影單元。`subagentTiming` 會在每個描述符處重設，使 fork 種子中的祖先工作不會計入 child 總量，隨後累加 `turn/start` → `turn/end` 活躍時間，並為未結束的輪次保留同一切面的 `active.since` 和 `active.through` 邊界；在該輪次保持未結束期間，`active.through` 會跟隨最近摺疊的事件，從而為 inactive 消費端提供保守的崩潰上界，又不會混入更新的工作階段元資料。`subagent` 以同樣的 last-wins 重設紀律從 `subagent/descriptor` 事件摺疊持久化身份——模式與建立標籤——因此 fork 種子中的祖先描述符只在 child 自身的描述符覆蓋之前有效；畸形或版本無法識別的載荷摺疊為可序列化的 `null` 哨兵——與沒有描述符的日誌不可區分，且能完好透過每個 JSON 推送幀，讓消費端以之替換掉手中的過時身份而非繼續保留該身份——絕不拋錯。

`registerContinuableSetup()` 允許選填包新增子級作用域能力，而無需讓繼續執行管理器知道這些能力的名稱。貢獻會在 Activation 發布前同步安裝，在設定失敗時一並回滾，並隨子級作用域釋放。新授權須等到下一個 Activation，移除貢獻則會立即撤銷每個駐留安裝項。

## 收集模型

面向模型的工具默認同步收集：先等待子 agent 結果，再 dispose 執行，然後才返回。一次性後臺委派會在工具中註冊普通 Task，其通用狀態、收集和取消工具負責後續互動，並將模型提供的 `description` 持久化為選填顯示標籤。可繼續後臺委派會呼叫 `ctx.subagents.startContinuable()`，只返回持久化子 agent id；子 agent 自 inbox 接受起就擁有自己的輪次，因此沒有 Task、也沒有結果 promise——呼叫方透過 `send_message` 後續操作工具傳送後續工作，`interrupt()` 只停止當前輪次而不 dispose 子 agent，而持久化子 agent 工作階段仍是子 agent 詳細輸出的來源。只有 `ctx.agents` 可用時，繼續執行管理器才會存在，而工作階段持久化按每項繼續執行操作解析。與此獨立，`listChildren()` 枚舉線上工作階段儲存與選填工作階段持久化的線上優先合併——持久化缺席時僅枚舉線上 child，因為那時冷 child 本就無法復原——並由已註冊的 `subagent` 投影單元供給每個 child 的持久化模式與標籤：線上 child 取登錄檔的水位快照；冷 child 先取選填投影快取的持久化行，且僅當其 `seq` 門證明該值摺疊自 child 自身後綴（fork 種子之後——自有描述符一經追加即不可變）才直接採用，否則經一次有界並行的持久化 inspect 再經登錄檔摺疊，且 inspect 結果必須仍指向枚舉時的生命週期（同 id 被重新發布的工作階段降級為 `corrupt` diagnostic）。快取讀取拋出例外時，不會據此作出分類判斷，因為快取只是派生資料；靜默落到該權威重摺。分類結果完全以投影摺疊為準；清單操作本身不解析描述符。取得身份值即產出 child 行；已定局而摺疊未產出身份的候選是 `corrupt` diagnostic，inspect 失敗是瞬時的 `unavailable`（下次清單重試），執行中而暫無身份值的候選整行省略（描述符尚未追加的建立視窗）。它不查詢繼續執行管理器、Agent 註冊資訊、Activation 或提供方。每個 child 行都會根據合併結果中攜帶持久化 `origin: 'subagent'` 的 header 派生讀取時的 `hasChildren` 提示；它不會讀取後代事件日誌，展開後仍以描述符支撐的 child 目錄為權威依據。UI 等服務消費端可以保留兩種模式，並為無標籤的一次性 child 選擇回退展示；面向模型的 `list_agents` 工具只投影 `continuable` 條目，透過線上 Agent 登錄檔細化狀態，並把僅存於儲存的狀態對映為可復原而非終態的 `ready`（`running`／`idle`／`ready`），並在 `descendants` scope 下遍歷 `listDescendants()`。清單操作會把呼叫方的取消訊號轉發到每次持久化讀取，在這些 await 前後檢查取消，並將每次偵測到的中止報告為 `SubagentError` 錯誤碼 `CANCELLED`；投影登錄檔未掛載則以 `SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE` 響亮失敗，工作階段儲存缺失則以 `SUBAGENT_CONTROL_SESSION_STORE_UNAVAILABLE` 響亮失敗。完整約定見[後臺 subagent 任務 Agent Note](../../../.agents/notes/implemented/feature/2026-07-08-background-subagent-tasks.md)、[可繼續後臺 subagent Agent Note](../../../.agents/notes/implemented/feature/2026-07-21-continuable-background-subagents.md)、[持久化目錄 Agent Note](../../../.agents/notes/implemented/feature/2026-07-22-durable-subagent-catalog-and-list-agents.md)、[服務合併 Agent Note](../../../.agents/notes/implemented/simplification/2026-07-26-merge-subagent-control-service.md)、[能力 seam Agent Note](../../../.agents/notes/implemented/feature/2026-06-21-subagent-capability-seam.md)和 `src/types.ts`。

可繼續 Activation 會等待 best-effort 的最終工作階段 flush，但不會把 listener 參與視為持久性確認。一次性執行保留盡力執行的工作階段檢查點，因此已完成的一次性 child 只有在其工作階段確實進入持久化儲存時，纔可在 dispose 後繼續被發現；如果該檢查點缺失，服務不會根據 Task 歷史虛構目錄條目。

## 模型體驗

### 結帳通知

#### 模型看到的內容

一條使用者角色的父級訊息，開頭是結果本身——`Background subagent <child-id> finished and will do no further work unless you send it more.`，或子級被停止、耗盡額度、拒絕任務或失敗時的對應句子——隨後是 `Its closing message:` 與子級的最終 assistant 內容；若子級沒有產出內容，則是 `It left no closing message.`。這是本服務面向父級的唯一直接貢獻；委派 schema、父級延續與發現以及子級作用域的 `report` 分別歸 `dsh-tool-subagent`、`dsh-tool-subagent-control` 和 `dsh-tool-subagent-report` 所有。

#### Token 影響

父級請求中，每個已結帳的 Activation 一條通知，長度取決於子級的最終訊息。如果子級既上報又結帳，父級請求會同時承擔上報訊息和結帳通知兩部分 token 開銷。

#### KV Cache 影響

在父級中僅附加：通知位於其可複用請求前綴之後。到達空閒父級會啟動一次獨立的模型請求，到達繁忙父級則不會。

### 子級委派範圍聲明

#### 模型看到的內容

每個行程內子 agent 的執行時期上下文快照都攜帶下方的 `subagent:delegation` 聲明，位於沙盒策略與審批策略語句之後。

##### 委派範圍聲明

```markdown
You are a delegated subagent: your permission scope was fixed when you were started and cannot be widened from inside this session — operations that require approval are rejected automatically. When the job needs access beyond that scope, do not retry the denied operation; state the limitation in your reply so the delegating agent can handle it.
```

#### Token 影響

每個子 agent 的執行時期上下文快照中一條固定聲明；父級請求中沒有任何新增。

#### KV Cache 影響

子級內部前綴穩定：該聲明在子 agent 生命週期內絕不變化，因此只寫入第一份執行時期上下文快照一次。父級側不會直接使快取失效；具名工具消費端共同負責請求前綴的任何變化。

## 已知限制與暫緩事項

- **ACP 子 agent 仍為一次性，且無法透過追蹤枚舉**：ACP 執行在 parent 工作階段語料中沒有本機 child 工作階段。ACP 的 `prepareContinuable` 需要在提供方專用描述符資料中持久化遠端工作階段 id，以及逐子 agent 的繼續執行能力聲明，因為 ACP 的 `loadSession` 支持按子 agent 協商，而不是透過方法是否存在來確定。遠端提供方還需要一份獨立的 Activation 所有權約定，具備等效的經認證控制和子先於父的完全靜止保證，才能支持可繼續子 agent。
- **無 host-user 繼續執行**：`followup()` 要求確切線上直接父級。只有 `interrupt()` 接受持久化 parent 地址形式的使用者授權，因為停止一個輪次是冪等的且不投遞任何內容；未來 host 配接器需要具體的經認證互動，才能讓該 seam 獲得使用者投遞能力。
- **不對當前輪次進行 steering**：可繼續訊息和喚醒式 report 會排入後續輪次，均不會重定向正在進行的輪次。
- **取消收斂期間存在喚醒缺口**：中斷訊號寄出後、活動 driver 進入 idle 前被接受的喚醒型 follow-up 會保持排隊，直到另一條喚醒傳送到達。Issue #1838 負責 agent-loop 的喚醒鎖存；普通工作階段取消也受此影響。
- **駐留僅限行程內**：Activation inbox 與所有權圖不會在兩個 harness 行程之間協調；對單個持久化儲存的並行訪問仍然需要持久化郵箱和跨行程租約協議。
- **不重播已接受但未記錄的訊息**：只有寫入子 agent 工作階段日誌的訊息才能連同提供該訊息的來源一起重建。崩潰可能丟失從未寫入日誌、已被接受的初始提示詞或後續訊息；此後一條經授權的訊息可以冷復原該子 agent，但丟失的訊息不會自動重播。
- **沒有持久化的上報 mailbox**：上報需要線上直接父級，提供的是接受標識，不保證恰好一次投遞，也不提供已讀回執。
- **生命週期事件只供觀察**：影響執行的 `subagent/end` 延續或決策介面仍需等待具體消費端。
