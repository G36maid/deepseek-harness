# Agent Note（agent 決策記錄）：持久化 subagent 目錄與 list_agents

Status: implemented

[English](2026-07-22-durable-subagent-catalog-and-list-agents.md) | [简体中文](2026-07-22-durable-subagent-catalog-and-list-agents.zh.md) | 繁體中文

## 問題

可繼續的後臺 subagent 會公開穩定的 child id，並將重建資料持久化在該 child 的工作階段中，因此 `send_message` 無需任何清單查詢操作即可復原已知 child。發現功能有兩類需求不同的消費端：UI 可以同時展示一次性工作和可繼續對話，而模型只應收到適合使用 `send_message` 的 child。[可繼續 subagent](../../implemented/feature/2026-07-28-continuable-subagent-conversations.md)負責持久化 Session 與 Activation 設計；本記錄負責共享的持久化清單及面向模型的投影。

枚舉必須交叉核對不可變的工作階段譜系、描述符有效性與即時優先的工作階段語料，而不能僅為展示就載入或復原 Agent。追蹤譜系可以提供候選項，卻無法區分普通工作階段 fork 與 subagent，因此 child 日誌需要持久化分類。約定還必須定義生命週期模式、缺失或損壞的記錄、刪除、不受支持的版本，以及反覆載入大量 child 日誌會如何影響服務與工具消費端。

## 決策

**清單讀路徑已被取代。**[subagent 清單經投影單元讀取身份](../architecture/2026-08-06-subagent-list-identity-projection.md)取代了本記錄的枚舉與逐 child 讀取設計:`listChildren` 現在直接合併存活工作階段儲存與選填的工作階段持久化,並從註冊的 `subagent` projection unit 讀取每個 child 的 mode/label——不相依性工作階段查詢,也不在清單時掃描描述符;當前的清單語義(含 diagnostic 對映)以該記錄為準。本記錄仍是描述符持久化、以 mode 判別的描述符作為持久身份、直接 parent 鑒權與面向模型的 `list_agents` 投影的權威;下文基於追蹤的讀取機制是決策背景,不再是當前行為。

parent 到 child 的枚舉是一項帶消費端專用投影的服務功能。`SubagentRuntime.listChildren(parentSessionId: SessionId)`（[subagent/src/index.ts](../../../../packages/subagent/subagent/src/index.ts)）執行以下操作：

- 使用 `ctx.sessionQuery.traceSession(parentSessionId)` 取得 parent 的直接且即時優先的 child 工作階段；
- 讀取並校驗每個候選工作階段的 `subagent/descriptor` 事件，但不啟用 child；
- 默默排除不含描述符的候選；如果候選變得不可用，或其描述符損壞或版本不受支持，則排除該候選並產生對應 child 的 diagnostic；
- 公開每個由本機工作階段支撐、擁有受支持且有效描述符的 subagent；該描述符必須帶有持久化的建立 `label` 和 `mode`，而其提供方當前是否已註冊不影響公開；
- 將語料活動狀態單獨報告為 `running` 或 `inactive`，但不暗示已完成或可復原；
- 按 `createdAt` 升序、再按 child id 升序穩定返回所有結果 child。

每次普通的本機啟動都會收到帶選填、由呼叫方擁有之顯示標籤的 `one-shot` 描述符，而繼續執行管理器會持久化帶標籤、包含附加重建欄位的 `continuable` 描述符。面向模型的委派工具已經擁有簡短 `description`，會將其用於一次性顯示；workflow 等底層呼叫方無需憑空構造展示元資料。面向模型的 `list_agents` 配接器會將服務結果過濾為可繼續 child，並透過線上 Agent 登錄檔細化狀態（`running`／`idle`，以及對應僅存於儲存的 [`ready`](../bug-fix/2026-08-06-list-agents-residency-vocabulary.md)）；UI 可以消費兩種模式，並為無標籤的一次性歷史選擇基於 id 的回退展示。描述符持久化、按 id 尋找、直接 parent 鑒權和不相依性提供方的冷復原仍歸已實作的 Activation 約定負責。清單查詢消費這些事實，但不能削弱它們，也不能另行發明第二種描述符表示。

### 枚舉決策

第一版消費 `ctx.sessionQuery.traceSession(parentSessionId)`，並且只考慮追蹤結果的第一層後代。目標可以存活，也可以只存在於持久化儲存中；追蹤邏輯語料不會載入或復原 Agent。工作階段查詢已經使用即時優先規則合併 `ctx.sessions` 與 `ctx.sessionPersistence`，保持不可變 header 一致性，根據 `SessionHeader.parentSession` 推導直接 child 譜系，並按 `createdAt` 升序、child id 升序排列 sibling。`listChildren()` 不會重複實作這套語料邏輯，也不會檢查繼續執行管理器的行程內 Activation map。

語料建置先於逐 child 描述符檢查。建置初始追蹤時如果發生持久化清單查詢失敗、所觀測語料中任意位置的存活／持久化 header 衝突或目標譜系無效，整個 `list_agents` 呼叫都會失敗，因為此時不存在可信的候選集。只有初始追蹤成功後的失敗才會被隔離到單個候選；因此，這項逐 child 約定中的“損壞 child”是指已載入的事件 surface 或描述符資料損壞，而不是語料級 header 衝突。

工作階段譜系涵蓋的範圍比 subagent 身份更廣：普通 `ctx.sessions.fork()` 也會建立直接 child。工作階段 header 不新增 `kind` 判別欄位；每個候選必須改為在自身後綴中恰好包含一個有效的 `subagent/descriptor` 事件。`SubagentRuntime.start()` 會在普通提供方分發前解析 `{ mode: 'one-shot', provider, label? }`，而繼續執行管理器會在初始建立 child 時為 `{ mode: 'continuable', ...composition }` 建立快照並將其作為 seed。本機行程內的一次性驅動只在初始建立期間追加已解析的描述符，從持久化儲存冷復原時不會追加其他描述符；第二個事件屬於損壞，而不是另一次 Activation 的證據。Agent 建立是一次性執行的發布邊界：拒絕表示沒有發布 child，而發布後的提示詞、輪次、取消與基礎設施結果會透過返回的 run 結帳，且不會隱藏其 id。描述符事件是已追蹤 child 屬於由工作階段支撐的 subagent 的唯一證據。缺少該事件的候選屬於普通 fork、沒有本機工作階段記錄的遠端 child 或其他非 subagent 工作階段，系統會將其排除且不產生 diagnostic。

已發布的邏輯記錄同時也是活動狀態來源：`SessionRecord.live` 表示 `running`，而 `live: false, persisted: true` 表示 `inactive`。活動狀態直接來自追蹤結果，不會導致額外載入 child 日誌。`inactive` 既不表示執行成功，也不表示可復原：它可能表示已結帳的一次性歷史，也可能表示 `send_message` 可以為其物化另一次 Activation 的可繼續 child。反過來，`running` 只表示工作階段存活：位於繼續執行管理器對應 Activation 之外的存活可繼續 Agent 仍會顯示為 `running`，但 `send_message` 會將其作為所有權衝突拒絕。child 工作階段發布前不可見，也不會新增行程內 Activation 條目作為第二個候選來源或活動狀態來源。清單查詢是一份快照，可能與發布、dispose 或後續訊息發生競態；`send_message` 仍是訊息送達時的權威操作。

subagent 服務將 `sessionQuery` 保持為選填相依性，因此沒有該服務時仍可執行 start 和 follow-up。其公開的 `listChildren(parentSessionId: SessionId)` 方法只在被呼叫時才會解析這個選填服務，並動態載入選填的工作階段查詢執行時期；因此，普通 subagent 匯入、start 和 follow-up 都不會觸發該包求值。清單查詢直接由 `SubagentRuntime` 負責：它解釋查詢返回的譜系、事件和存活狀態，無需解析基於 Activation 的繼續執行管理器，也不會查詢 Agent 註冊資訊、Activation 或提供方；因此，僅包含工作階段、`subagents` 和 `sessionQuery` 的部署即使缺少 `agents` 也能執行清單查詢。如果查詢服務缺失，該方法會在載入執行時期或執行查詢工作前拋出 `SubagentError`，並攜帶穩定錯誤碼 `SUBAGENT_CONTROL_SESSION_QUERY_UNAVAILABLE`。`@deepseek-ai/dsh-tool-subagent-control` 匯出可分別載入的工具外掛程式：`send_message` 配接器只要求 `subagents`，而 `list_agents` 配接器在載入時同時要求 `subagents` 和 `sessionQuery`。因此，部署可以在既不安裝也不載入工作階段查詢的情況下使用 `send_message`；清單工具 fiber 會在必需服務可用前保持未啟用狀態，而其他直接服務消費端會收到同一項明確的呼叫時約定。這一段的相依性姿態——選填 `sessionQuery`、其錯誤碼與清單工具的載入要求——同屬被取代的讀路徑：現行錯誤碼（`SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE`、`SUBAGENT_CONTROL_SESSION_STORE_UNAVAILABLE`）與收窄後的載入要求以[取代記錄](../architecture/2026-08-06-subagent-list-identity-projection.md)為準。

`listChildren(parentSessionId, signal?)` 會把呼叫方的取消訊號轉發給 `traceSession()` 和條件性精確 `readEvent()` 操作。`listEvents()` 不接受取消參數，因此清單查詢路徑會在等待該操作的前後，以及每個候選處理完成後檢查訊號。如果取消訊號觸發後有查詢操作以拒絕結帳，服務會將結果歸一化為 `SubagentError`，並攜帶穩定錯誤碼 `CANCELLED`；後端中止錯誤或可對映為 diagnostic 的查詢錯誤均不會逃逸，也不會使呼叫以成功的部分清單返回。

這條描述符讀取路徑是正確性基線，並不聲稱工作量只與直接 child 數量呈線性關係。令 D 為直接 child 候選數量，C 為每次持久化清單查詢所掃描的持久化工作階段數量，L_i 為候選 i 的完整日誌大小。一次語料追蹤後，每個候選都會執行 `sessionQuery.listEvents(childId)`。沒有描述符的候選會被排除；含有多個描述符的候選會直接產生 diagnostic，無需再次讀取；只有恰好含有一個描述符的候選才會透過 `sessionQuery.readEvent({ sessionId: childId, seq })` 再次載入。此次讀取返回的不可變工作階段 header 必須與追蹤時觀測到的相同，包括直接 parent 關係，並且讀取目標仍必須是先前定位的描述符事件；任何不一致均視為該 child 損壞。對於只存在於持久化儲存中的最壞情況，每次精確讀取都會重複執行 `persistence.list()`、載入完整 child 日誌並克隆其中的事件，因此忽略常數因子後的工作量為 O(D × C + Σ L_i)；恰好含有一個描述符的候選承擔兩次這類成本，其他候選只承擔一次。存活候選同樣會對其完整日誌取得一份分離的記憶體快照；讀取其描述符時則會取得兩份。工作階段查詢透過持久化 seam 的非變更 `inspect()` 讀取解析持久化候選：它返回有效的已儲存前綴，既不修復撕裂的尾部，也不關閉中斷的 turn，因此清單查詢是儲存只讀操作；修復仍是復原路徑的職責。第一版接受這些重複讀取，將其作為無索引的正確性基線，但部署必須將語料總量和 child 日誌大小，而不僅是直接 child 數量，視為容量約束。清單查詢不會建立 Agent，也不會追加任何目錄、描述符或修復事件。對模型隱藏的描述符始終位於對話 surface 之外，並且會在壓縮後保留，因此經過壓縮和未經壓縮的 child 必須枚舉出相同結果。

如果實測規模日後需要索引，該索引屬於派生狀態：工作階段 header 和 child 描述符仍是權威資訊，重建或損壞回退必須復現相同結果。索引不能成為第二個鑒權來源，也不能讓尚未發布的 child 變得可見。

### `list_agents` 約定

`SubagentRuntime.listChildren(parentSessionId: SessionId)` 返回 `Promise<SubagentListEntry[]>`，其中的單個數組不會將 child 與 diagnostic 分開，而是保留追蹤結果中的候選順序。`SubagentListEntry` 是一個由只讀 `kind` 判別的封閉聯合類型：

- `kind: 'child'` 攜帶只讀的 `id: SessionId`、`mode: 'one-shot' | 'continuable'` 和 `activity: 'running' | 'inactive'`；可繼續 child 攜帶 `label: string`，一次性 child 則攜帶 `label?: string`；
- `kind: 'diagnostic'` 攜帶只讀的 `id: SessionId` 和 `reason: 'corrupt' | 'unsupported' | 'unavailable'`。

有效描述符產生一個 child 條目，逐 child 檢查失敗產生一個 diagnostic 條目，缺少描述符的候選不產生條目。`mode` 是持久化建立策略；`activity` 是行程本機語料快照。活動狀態既不是 `AgentStatus`、管理器內部的 Activation 狀態，也不是持久化結果，結果不公開內部 `createdAt` 排序鍵。成功完成、失敗、取消和停止原因等精確 Activation 狀態與持久化結果需要單獨的持久化啟用記錄，不在本功能範圍內。

面向模型的 `list_agents` 工具接受一個選填的 `scope: 'children' | 'descendants'` 參數，從當前執行 Agent 推導根 id，並在執行或渲染前透過顯式的 request-to-spec 步驟解析請求（`undefined` → `children`）。解析後的 `children` scope 呼叫 `SubagentRuntime.listChildren(rootSessionId)`，`descendants` scope 則呼叫 `SubagentRuntime.listDescendants(rootSessionId)`。其內部輸出投影中的 `id` 與 `parent` 會一直保持為品牌化的 `SessionId` 值，直到工具 JSON 邊界。它保留 diagnostic，丟棄 `one-shot` child 條目，狀態取自線上 Agent 登錄檔——driver 活躍為 `running`，駐留但處於輪次之間為 `idle`，沒有線上 Agent 時為 `ready`（可復原而非終態）——然後按穩定目錄順序渲染 `<id> [<status>] — <label>` 或 `<id> [diagnostic: <reason>]`。`descendants` scope 從一份即時優先語料按穩定 pre-order 展平完整樹，遍歷普通與一次性中間節點以發現更深的可繼續 agent，依據枚舉生命週期重新校驗每個冷候選，並為每個條目附加 `parentId`／`depth`。工具會在 label 之前插入 ` parent=<id> depth=<n>`；`parent` 是持久化直接 parent 工作階段 id，可能指向被省略的普通工作階段。對於當前呼叫方，只有 depth-1 child 條目可作為 `send_message` 候選，更深的 child 條目則可供 `interrupt_agent` 選擇（[中斷約定](2026-08-06-continuable-subagent-interrupt.md)）。發現結果只是提示——follow-up 權限仍僅屬於確切直接 parent，中斷權限仍由服務的線上 lineage 檢查決定。空投影渲染為 `(no subagents)`。

在已被取代的追蹤讀路徑中，diagnostic 使用三種固定原因。格式錯誤的事件 surface、精確載入 child 時發現的 header 衝突、讀取結果中的不可變 header 與追蹤到的候選不一致或不再指向請求的直接 parent、讀取目標不再是先前定位的描述符事件、格式錯誤的描述符內容和多個描述符事件對映為 `corrupt`。未知描述符版本對映為 `unsupported`。逐 child 讀取產生的 `SESSION_QUERY_SESSION_NOT_FOUND`、`SESSION_QUERY_EVENT_NOT_FOUND` 和 `SESSION_QUERY_PERSISTENCE_FAILED` 對映為 `unavailable`。這項階段邊界是有意為之：初始追蹤期間發生持久化故障會讓操作失敗，而同一故障如果始於候選讀取期間，可能會讓每個受影響的 child 分別產生一條相同的 `unavailable` diagnostic；第一版既不合併這些 diagnostic，也不會把它們提升為全域性失敗。缺少描述符則作為非 subagent 排除，且不產生 diagnostic。設定錯誤、視窗錯誤和未識別的失敗不屬於 child diagnostic，會作為操作失敗繼續向上傳播。每條 diagnostic 都標識 child id 及原因，不暴露對模型隱藏的描述符內容；系統會排除該候選，而其他健康的 sibling 仍然可見。系統絕不會讀取不屬於追蹤結果直接後代的工作階段，也不會為它們產生 diagnostic。

diagnostic 是瞬時查詢結果，不屬於工作階段事件或目錄狀態。推導 diagnostic 時，除了產生該結果的 `listEvents()` 或條件性 `readEvent()` 操作外，不會執行額外載入。

第一版不提供 child 刪除操作。如果後續產品行為會刪除 child 工作階段，持久化清單會自然移除已刪除的 child；任何未來的派生索引都必須移除或 tombstone 同一條目，避免 `list_agents` 保留過時狀態。

## 已考慮的替代方案

**將清單查詢並入啟用 RFC。** 按 id 持久化描述符和從持久化儲存復原無需 parent 到 child 的枚舉。保持查詢獨立，可讓 `send_message` 落地時不必同時承擔清單狀態、掃描效能或刪除行為。

**直接透過 `SessionPersistence.list()` 重建譜系。** 這種做法會重複實作工作階段查詢中的即時優先語料合併、不可變 header 一致性檢查、直接 child 追蹤和確定性排序。清單查詢應使用現有可信查詢服務，只增加 subagent 特有的描述符校驗與渲染。

**列出每個已追蹤的 child 工作階段。** `parentSession` 能證明譜系，卻不能證明 child 是 subagent：普通工作階段 fork 也使用這個 header 欄位。清單查詢還必須讀取並校驗描述符。

**為 `SessionHeader` 新增 `kind` 判別欄位。** header 仍不會攜帶校驗或復原可繼續 subagent 所需的重建資料，因此清單查詢無論如何都必須讀取描述符。將描述符作為唯一的 subagent 判別資訊，可避免引入第二個分類來源。

**使用存活的 Agent 登錄檔作為目錄。** 系統會在 Activation 結帳後有意 dispose 它，而且登錄檔狀態會在重新啟動時消失，因此無法支持持久化發現。

**使用行程內 Activation map 作為第二個目錄。** 這種做法能公開管理器駐留狀態，卻會讓工作階段發現查詢與物化及結帳耦合，引入另一套排序時鐘，並讓同一個 child 在其生命週期內改變候選來源。第一版只列出已經發布的邏輯工作階段，並將 `SessionRecord.live` 視為其快照狀態。

**讓清單查詢經過基於 Activation 的繼續執行管理器。** 管理器負責駐留狀態並要求 `agents`，而清單查詢只解釋工作階段查詢事實。讓讀取經過該管理器會強制引入無關的執行時期服務，並使發現能力隨 Activation 控制一同消失，因此清單查詢直接由 `SubagentRuntime` 負責。

**按當前提供方可用性過濾。** 提供方註冊狀態屬於行程本機狀態，即使描述符仍然持久存在，該狀態也可能發生變化。即使繼續執行不相依性提供方，過濾仍可能隱藏持久化或存活 child。因此，清單查詢根據描述符確立持久化身份，而 `send_message` 在訊息送達時執行權威的鑒權與駐留狀態檢查。

**持久化 parent 工作階段目錄事件。** 直接 child header 已經提供持久化枚舉種子，child 描述符則是重建的權威資訊。第二份 parent 日誌會重複狀態，並造成跨工作階段順序和過時條目行為，卻無助於按 id 復原。

**要求每次底層啟動都提供顯示標籤。** 這會保證 UI 文字一致，卻會把展示關注點引入 workflow、傳輸、測試和程序化啟動約定。底層請求保持標籤選填；高層委派與繼續執行 API 在本就擁有該概念時提供標籤，UI 消費端則為無標籤的一次性 child 選擇回退展示。

**某個 child 無法載入時讓整次清單查詢失敗。** 這種做法不會讓損壞問題被忽略，但一個損壞的 sibling 會讓每個健康 child 都不再可見。逐 child diagnostic 在保持每次排除明確可見的同時，也保留了發現能力。

**分別返回 child 和 diagnostic 陣列。** 分離的陣列會引入兩個排序域，或者要求公開另一個排序鍵才能重建候選順序。一個帶判別欄位的條目陣列既能保留追蹤順序，也能保證 child 與 diagnostic 欄位的類型安全。

**透過會觸發修復的 `load()` 路徑讀取候選。** 複用復原路徑的 `load()` 語義可以讓發現提前持久化地關閉中斷尾部，但會把清單查詢變成變更操作，並使其失敗模式與寫協調耦合。工作階段查詢的語料讀取本就使用非變更的 `inspect()` 約定，因此清單查詢保持儲存只讀，尾部修復留給真正需要它的復原路徑。

**立即為查詢分頁或設定上限（暫緩）。** 這可以限制一次結果的大小，但會使模型發現成為有狀態操作，而且除非模型繼續跟隨 cursor，否則可能隱藏更早的 child。第一版沒有 cursor、分頁參數或候選數量上限設定，而是返回經穩定排序的完整集合；如果實測規模需要限制，服務級限制仍留待後續決策。

## 測試

- `packages/subagent/subagent/tests/service.spec.ts` 固定兩種模式下的描述符 v2 解析，並證明無標籤的底層啟動會在分發給提供方之前解析出一次性描述符。`packages/subagent/subagent-in-process-driver/tests/subagent-in-process-driver.spec.ts` 證明本機驅動會在初始輪次內追加該描述符，在取消落入工廠到 run 的交接視窗時返回已發布 id，並讓結果與控制代碼釋放失敗保留在獨立通道中。委派工具測試固定其現有顯示說明的傳遞，並保留相互獨立的結果與 dispose diagnostic。
- `packages/subagent/subagent/tests/list-children.spec.ts` 針對由工作階段儲存、JSONL 持久化、spawn/fork 提供方、subagent 服務與投影登錄檔構成的真實組合——不含查詢服務——以無金鑰方式釘住現行讀取路徑：無持久化時的僅存活清單；零 children 也響亮報 `SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE` 與 `SUBAGENT_CONTROL_SESSION_STORE_UNAVAILABLE`；三級階梯（存活 child 從不檢查、冷 child 恰好檢查一次，以及快取命中、key 缺席、服務缺席、行中毒四個第二級用例）；多描述符 last-wins 取末者；載荷格式錯誤與未知版本診斷為 `corrupt`；冷檢查失敗成一條 `unavailable` diagnostic 並在下次清單重試；fork seed 中的祖先描述符按該身份列出；外部 unit 摺疊失敗在存活與冷兩條路徑上按 child 收納為 `corrupt`；按 `createdAt` 再按 id 排序且不列普通 fork；提供方缺失時不排除 child；壓縮與未壓縮的孿生 child 清單結果一致；持久化清單失敗使整次枚舉失敗；取消穩定歸一化為 `CANCELLED`；帶類型的穩定錯誤碼；以及後代清單的迭代式穩定 pre-order、穿過普通與一次性中間節點、帶位置 diagnostic、生命週期複驗與取消。一個伴隨規格(已隨查詢式讀取路徑一起退役)曾在匯入普通 subagent surface 時拒絕對選填 session-query 執行時期的 eager 求值。
- `packages/subagent/tool-subagent-control/tests/list-agents.spec.ts` 固定 `list_agents` 的 schema（一個選填 `scope` 枚舉）、只保留可繼續 child 且排除健康的一次性 sibling、同時保留 diagnostic 的投影、由登錄檔推導的 child／diagnostic／空結果文字形式、帶持久化 label 的已結束 child 端到端清單、descendants scope 在線上 waiting 分支上的 pre-order parent/depth 註釋、兩個 scope 的取消訊號轉發、無呼叫 agent 時的拒絕、要求 `agents` 但不再注入 `sessionQuery` 的載入約定，以及 HMR dispose。
- 無金鑰 ACP 快照場景 `subagent-list-agents`（examples/acp-agent）使用僅限快照的 `subagent/end` 標記為第二個 parent 輪次設定邊界，隨後針對 subagent 服務、投影登錄檔和 JSONL 持久化真實執行 `list_agents`，渲染 `<id> [ready] — <label>`。
- 無金鑰快照場景 `subagent-diagnostic`（examples/headless-agent）釘住現行清單的模型可見診斷分類，包括無描述符的定局 child 以 `corrupt` diagnostic 出現。
- 無金鑰 ACP 快照場景 `subagent-published-run-failure` 會發布一個真實的一次性 child，注入相互獨立的 run result 與 handle dispose 失敗，並在 parent 工具結果中保留兩項 diagnostic。

## 影響

- 工作階段追蹤會觀察完整的邏輯語料，隨後描述符校驗會讀取每個直接 child 的日誌一次，並對恰好含有一個描述符的候選讀取兩次。對於只存在於持久化儲存中的最壞情況，工作量為 O(D × C + Σ L_i)，而不只是 O(D)，因為每次精確讀取都會重新掃描持久化儲存，並載入和克隆候選的完整日誌。後續的派生索引必須保持相同的鑒權、逐 child diagnostic 和回退行為。
- 語料建置是一個全有或全無的信任邊界：一處存活／持久化 header 衝突就會導致初始追蹤失敗，並隱藏原本健康的 sibling。只有初始追蹤成功後，逐 child 隔離才會生效。
- 撕裂的 child 尾部會被呈現而非修復：非變更的 `inspect()` 讀取返回有效的已儲存前綴，因此寫入中途被打斷的 child 在復原路徑的修復載入將其關閉之前，可能以較短的日誌形式出現在清單中。
- 沒有刪除操作，因此只要 child 工作階段仍保留在持久化儲存中，它們就會繼續出現在清單裡，但存活 Agent 資源仍由駐留 Activation 數量限制。
- 服務會返回每個直接且由工作階段支撐的 subagent 和 diagnostic，不設 cursor 或候選數量上限。穩定排序可使結果確定；模型投影避免了一次性 child 帶來的上下文成長，但可繼續 child 的數量仍無上限。
- `running` 和 `inactive` 是行程本機語料快照，而非結果或訊息送達承諾。另一個行程可能在當前行程將某個持久化 child 報告為 `inactive` 時啟用它；跨行程準確性需要共享租約。
- 持久化生命週期模式是一次發布前的描述符格式變更：版本 2 會將舊版版本 1 描述符拒絕為不受支持。現在，每次由本機工作階段支撐的啟動都會產生一個小型日誌事件，使 UI 和其他服務消費端無需重放模型可見的工具結果即可對一次性歷史進行分類。
- 一次性工作階段持久化仍為盡力執行。一次性 child 在存活期間可見，dispose 後只有在其工作階段檢查點到達持久化儲存時纔可繼續被發現；目錄參與不會像可繼續啟用那樣增加必需的最終 flush，也不會把持久化失敗變為 run 失敗。可繼續啟動無需提前 flush 描述符，因為描述符會隨建立 seed 一同攜帶，並且每條 Activation dispose 路徑都會執行必需的最終檢查點，包括提示詞准入受阻之後。
- 遠端 ACP 一次性執行仍不在目錄中，因為它們不會發布可供 `traceSession()` 發現的本機 child 工作階段。若要枚舉這些執行，需要單獨的持久化本機記錄，不能假裝遠端生命週期 id 就是工作階段 id。
