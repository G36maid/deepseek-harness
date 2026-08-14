# Agent Note: Client Conversation 業務節點組裝與 Chat keyed snapshot

Status: implemented

[English](2026-08-09-client-conversation-node-assembly.md) | [简体中文](2026-08-09-client-conversation-node-assembly.zh.md) | 繁體中文

## 問題

Client Session 既維護傳輸視窗、連線狀態和待處理互動，也在中心化 transcript fold 中解釋 Assistant、Tool、訊息、命令、壓縮、重試及 turn tail 等業務事件。每增加一種業務節點，都要修改 Session 的 switch、歷史 replay、索引、快取和 React 分組；業務 identity、狀態演進與最終展示沒有獨立所有者。

舊鏈路還把執行中的 Assistant 和 Tool 放在 finalized flow 之外。它們結帳後才進入按日誌排序的節點清單，因此 React parent 會改變，即使業務 ID 和 `key` 不變也會重新掛載。全量歷史載入、older prepend、即時 append 與 token streaming 又分別走不同更新路徑，使引用穩定和區域性重算只能靠各處特化快取維持。

業務事件之間的關聯方式並不統一。Tool 有 call ID，Assistant 以 turn/step 關聯，Compaction 有獨立生命週期和 checkpoint，Inbox splice 則表示一個連續狀態的瞬間。把這些差異繼續塞進統一 fold，會讓任一業務變化都經過全域性查表並使無關快取失效。

## 決策

Client Runtime 提供 target-neutral 的 Conversation Node 組裝引擎，業務外掛程式註冊 Event Definition，檢視表外掛程式註冊 per-Session View Builder。`ui-conversation` 註冊第一批內建 Definition 和 `chat` builder；Session 只負責把當前連續事件視窗送入引擎並行布它的 snapshot，不再解釋具體 conversation 業務。

本 Note 保留實作後仍有價值的方案推導、逐業務適配、職責、演算法和取捨。

### 責任分層

| 層 | 長期職責 | 明確不負責 |
|---|---|---|
| Session | 維護連續 Event 視窗，區分 replace、prepend、append，調度 snapshot 通知 | 解釋 Tool、Assistant、Compaction 等業務事件 |
| Event Registry | 按 Cordis 生命週期保存唯一 `kind` 的 Definition 和唯一 fallback | 保存某個 Session 的 Context 或 State |
| Assembler | 匹配 Event，維護 Context、Location、相依性和發布髒集 | 理解業務 State 欄位或 Chat 排序 |
| Node Definition | 定義一個業務對象的 identity、State 演進、Location data 和 target Node | 建立 Context、修改別的業務 State 或掃描全部 Context |
| View Builder | 把最終 target Node 增量整理成該檢視表的 snapshot | 重新解釋原始 Session Event |
| React renderer | 按最終 Node 的 `kind` 展示 renderer-owned data，並讀取當前 Node 所屬 Location 的只讀業務 data | 配對業務 Event、掃描全域性 Nodes 或決定業務生命週期 |

Registry 註冊是 Cordis effect，Definition 解除安裝會觸發現有 Session 的低頻 registry rebuild。普通業務 Event 不改變 Registry，也不會因此重建全部業務類型。

### `ConversationNodeDefinition` 總體契約

每個 [`ConversationNodeDefinition`](../../../../packages/client/runtime/src/client/contract/conversation.ts) 獨立擁有一種業務對象從 Event 到 State 和最終 view Node 的轉換。Definition 的 `kind` 是 Registry 內唯一名稱，也是業務 ID 的命名空間。

同一個 Event 可以被多個普通 Definition 認領。例如一條 Assistant Event 同時更新 Assistant Node 和 Turn Tail；一條 Retry Event 同時更新 Retry、Assistant 和 Turn Error。Assembler 只有在全部普通 Definition 都返回 `null` 時才詢問 fallback。

Definition 不持有跨 Session 的可變業務資料。每個 Session 的 Context、State、相依性和 View Builder 都由該 Session 的 Assembler 隔離持有。

#### `kind`、業務 ID 與 Context key

`match()` 返回的 `id` 只要求在當前 Definition 內穩定。Tool 的 ID 可以是 call ID，Assistant 的 ID 可以是 `turn:step`，Inbox 的 ID 可以是 splice Event seq。

Assembler 使用 `conversationContextKey(kind, id)` 組合無碰撞 key；不同 Definition 即使返回相同 `id` 也不會共享 Context。最終 view Node 必須沿用這個 engine-owned key，不能把 `seq` 或渲染位置當 identity。

每個 `(kind, id)` 最多存在一個 start Match。第二個 start 會立即報錯；Definition 需要表達新生命週期時必須返回新 ID。

#### `match(event)`

`match(event)` 只讀取當前原始 `SessionEvent`，返回 `{ id, role: 'start' | 'update' }` 或 `null`。它拿不到 Context、歷史、Reader、Location 或 view envelope。

這項限制使單條 Event 的路由成本只隨已註冊 Definition 數量成長。Assembler 不會為了判斷一條 update 屬於誰而遍歷該 Definition 的歷史 Context。

start、result、resource、checkpoint 及業務自有終止 Event 必須攜帶或可直接推導同一 ID。若單個 Event 不能算出 ID，生產 Event 的協議負責補足關聯欄位，Client 不透過“最近一個未完成對象”猜測。

`role` 描述 State 生命週期，不描述可見性。start 可以立即生成 terminal Node；update 也可以在 start 尚未載入時先進入 pending Context。

#### `ConversationMatch`

匹配成功後，Assembler 把原始 Event、選填的 wire presentation view、`role` 和引擎計算的 `location` 組成只讀 `ConversationMatch`。

Context 的 `matches` 永遠按 Event `seq` 升序保存，而不是按網路到達或分頁攝入順序保存。歷史尾頁先出現 result、older 頁後出現 call 時，最終 Match 順序仍然是 call 在前、result 在後。

Location 可以隨 prepend 補齊邊界或 append 關閉邊界而改變。Assembler 替換受影響 Match 的只讀 Location 並 replay Context；業務不把舊 Location 副本當權威保存。

#### `ConversationNodeContext`

| 欄位 | 所有者 | Definition 可見語義 |
|---|---|---|
| `key` | Assembler | `kind + id` 的穩定最終 identity |
| `kind` / `id` | Definition + Assembler | 當前業務命名空間和業務 ID |
| `matches` | Assembler | 當前視窗已收集且按 `seq` 排序的完整業務證據 |
| `start` | Assembler | 唯一 start Match；尚未載入時為 `undefined` |
| `state` | Definition 返回、Assembler 持有 | 最近一次 `start`/`update` 回傳值；未初始化時為 `undefined` |
| `current` | Assembler | 各 target 最近一次 materialize 的 Node 或 `null` |

Context 欄位只讀，不表示業務 State 必須是深度 immutable。Definition 可以返回新對象，也可以原地修改舊對象後返回同一引用。

Assembler 只採納函式回傳值。`start()` 或 `update()` 返回 `undefined` 是契約錯誤並立即報錯；修改了對象卻不返回它同樣不成立。

Definition 可以讀取完整 `matches` 輔助構造 State 或 fallback Node，但不能增刪 Match、替換 Context 欄位或修改另一個 Context。

#### `start(context, match, reader)`

`start()` 是 State 的唯一初始化入口。Assembler 首次得到唯一 start 後呼叫它，並採用其返回 State。

當更早分頁改變 Context 的 Match 順序、Reader 前序答案或 Location 事實時，Assembler 從 `start()` 重新計算，而不是對舊 State 做方向相反的修補程式。

呼叫 `start()` 時，Context 可能已經收集 start 之後的 updates。`start()` 返回初始 State 後，Assembler 仍會從 start 之後按日誌正序逐條呼叫 `update()`，因此攝入方向不會改變最終 fold 結果。

`reader` 只在 `start()` 中可用。它允許初始化邏輯讀取嚴格位於當前 start seq 之前、指定 `kind` 的最近 active Context，但不給業務一個任意掃描引擎內部 Map 的介面。

每次重新呼叫 `start()` 都會替換上一次呼叫登記的 Reader 相依性，保證 Definition 改變查詢分支時不會保留過時邊。

#### `reader.previous(kind)`

`reader.previous(kind)` 尋找滿足 `candidate.startSeq < current.startSeq` 且 State 已初始化的最近 Context。它不會返回同 seq、未來 Context 或尚無 State 的 pending Context。

回傳值包含前序 Context 的 key、kind、id、start seq、只讀 State 和 Matches。消費者自行解釋 State；提供方只負責把自己的 State 維護正確，不需要註冊特化 query 方法。

Reader 每次查詢都記錄 `{ key, revision, windowGap }` 相依性。命中前序 Context 時，其 revision 變化會 replay 消費者；未命中且仍有 older 歷史時，window gap 會等待後續 prepend。

若視窗已經到達 Session 起點仍未命中，`undefined` 是確定答案。若 `hasMore` 為 true，Definition 看到的仍是同一個 `undefined`，但 Assembler 會記住這是暫定結果。

相依性嚴格從較早 start 指向較晚 start，因此傳遞 replay 不形成時序環。Inbox 瞬間態鏈和 Message 對 Inbox 的讀取都使用這一約束。

#### `update(context, match)`

`update()` 只處理已經由 `match()` 精確路由到當前 `(kind, id)` 的 post-start Match。它不再判斷 Event 屬於哪個 Context。

Assembler 按 `seq` 升序呼叫 `update()`。即時尾部 update 可以直接增量應用；任何非尾部證據插入、start 補齊或相依性失效都會從 `start()` 完整 replay。

沒有業務變化時，`update()` 返回原 State。存在業務變化時，它可以返回 immutable replacement，也可以原地修改並返回同一對象。

Assembler 不以 State 引用相等判斷是否需要發布或傳播。每次成功 update 都增加 Context revision、標記 dirty，並使直接或傳遞 Reader 消費者重新求值。

#### `publication(match)`

`publication()` 只決定最新 State 何時 materialize 成 view Node，不改變 `match()`、`start()` 或 `update()` 的同步執行。

| 回傳值 | 行為 |
|---|---|
| `immediate` | 請求當前 microtask 通知與 flush |
| `animation-frame` | 把多條高頻更新合併到下一幀 materialize |
| `none` | 本 Match 不主動安排 flush，State 和 dirty 標記仍被保留 |

省略 `publication()` 等於 `immediate`。Assistant token delta 使用 `animation-frame`，不可見 Inbox Context 使用 `none`，final、相依性 replay 和 Location 邊界會以 immediate 路徑發布最新結果。

一幀內的每條 delta 仍執行 update；合併的只是 `buildViewNode()`、View Builder 和 React snapshot 通知，不會丟失 token。

#### `buildLocationData(context, scope)`

`buildLocationData()` 讓 Definition 把 State 的只讀派生值發布到 Engine-owned Step 或 Turn，而不把另一個業務的可變 State 暴露出去。Assembler 在每次 materialize 中固定先處理 `step`、再處理 `turn`，因此 Turn 級聚合可以讀取同一輪已經更新的 Step data；全部 Location data 就緒後才呼叫 `buildViewNode()`。

Definition 分別收到 `step` 和 `turn` scope，可以在任一階段返回一個值或 `null`。回傳值必須聲明準確的 turn/step 坐標，並使用與 Definition `kind` 相同的 key；Assembler 擁有替換和移除，並拒絕另一個 Context 佔用同一 Location key。

`ConversationStepDataMap` 和 `ConversationTurnDataMap` 透過 declaration merging 約束 key 與 value。Location 只暴露穩定的 `data.get(key)` reader，消費者不能取得提供方 Context 或修改它的 State。

#### `buildViewNode(context, target)`

`buildViewNode()` 在發布階段讀取最新 Context，為指定 target 直接生成最終業務 Node。Assembler 不在它之後附加通用 activity、tail candidate 或 layout 業務層。

`null` 表示該 Context 對這個 target 尚未 materialize。普通增量路徑中，一個已經返回過非空 Node 的 Context 不能再返回 `null`；暫時隱藏必須保留同 key Node，並使用 target 自己的 visibility。

Assembler 校驗 Node `key === context.key` 且 Node `target === target`。業務可以改變 `anchorSeq`、data、Location 或 visibility，但不能在一次生命週期內改變 identity。

`current` 讓 Definition 區分“從未生成”與“已經生成後需要隱藏”。Assistant retry 和 Turn Error suppression 使用它避免非法的 Node 撤回。

一個 Definition 最多擁有一個 view target；僅維護狀態的 Definition 同時省略 `target` 與 `buildViewNode()`。即使 Chat 與 Trajectory 識別同一持久 Event 族，它們也分別註冊自己的業務 Definition；共享 Assembler 則為兩個 target 提供相同的匹配、replay、Location 與發布機制。

#### 不提供通用 `end()`

引擎不提供固定 `end()` 生命週期。單 Event 業務在 `start()` 中完成，多 Event 業務在自己的 update 中記錄完成，長期瞬間態業務則每條 Event 建立新 Context。

Step/Turn 關閉屬於外部 Location 事實，不替業務修改 State。邊界變化會 replay 並 build 受影響 Context；業務結合“自己的 State 是否完成”和“Location 是否 closed”生成正常、running 或 interrupted 表現。

ID 不複用，完成的 Context 繼續存在於當前視窗，既提供穩定渲染 identity，也可以作為後續 Reader 的前序證據。

### Location 是一級引擎事實

[`ConversationLocationIndex`](../../../../packages/client/runtime/src/client/sessions/conversation-location-index.ts) 根據 `turn/start`、`step/start`、顯式 turn/step payload、`step/end` 和 `turn/end` 建立 Event 到 Location 的對映。

Location 有 `session`、`turn`、`step` 和 `unresolved` 四種形狀。Turn/Step 各自帶 `open`、`closed` 或 `unknown` 狀態，以及已載入的 start/end Event。

每個 Turn 和 Step 還持有 reference-stable 的 Location data store。Definition 更新只替換自己擁有的 key；同一個 store identity 可以隨 append 或 prepend 獲得新值，使 Context、View Builder 和 React renderer 共享已經確定的層級業務事實，而不複製或遍歷全域性 Node 陣列。

`unresolved` 表示當前歷史視窗缺少足夠前序邊界，不等於 session-level。older prepend 補入邊界後，索引修正 Match Location，並只 replay 擁有這些 seq 的 Context。

Append 普通 Event 只繼承當前坐標；append 邊界只重算所屬 Turn。Prepend 會基於擴充後的完整連續視窗重建 Location facts，但引用穩定邏輯保留未變化 Turn/Step 對象。

Assembler 還把 reference-stable timeline 交給 View Builder。業務不重複維護 turn order、step list、last step 或邊界 Map。

## 三種事件視窗鏈路

“歷史反掃”描述 UI 從最新尾頁向 Session 起點逐頁載入的方向，不表示 Definition 逆序執行 `update()`。無論歷史 API 返回順序或頁面載入方向如何，Assembler 對每個當前視窗和每個 fresh page 都按 `seq` 升序 canonicalize。

| 場景 | 輸入範圍 | Context/State 處理 | View Builder |
|---|---|---|---|
| 初始歷史尾頁或 resync | 當前完整連續視窗 | 清空並按 `seq` 正序重建全部 Context | `replace()` |
| 載入一頁 older history | 只傳更早且去重後的 fresh Events | 保留現有 Context identity，補 Match、Location 和相依性後區域性 replay | `apply(upserts)` |
| 即時 append | 一條連續尾部 Event | 只匹配 Definitions 並精確更新命中 ID，邊界隻影響所屬 Turn | `apply(upserts)` |

### 初始歷史尾頁與邏輯反掃

1. `Session.open()` 拉取最新 tail page，並把連續 History Entries 交給 `replaceWindow(entries, hasMore)`。
2. `replaceWindow` 清空舊 Context、start-seq 索引、seq 反向索引、Reader 相依性和輸入 Map。
3. 全部 entries 按 Event `seq` 升序排序並寫入當前視窗。
4. LocationIndex 對這個視窗重建 Turn/Step facts。
5. Assembler 按升序 Event 逐條呼叫每個普通 Definition 的 `match(event)`。
6. 每個命中結果按 `(kind, id)` 取得或建立 Context，並把 Match 插入該 Context 的有序陣列。
7. 遇到 start 時執行 `start()`；已有 State 的尾部 update 直接執行 `update()`。
8. 當前頁只含 result/resource 而缺 start 時，Context 仍會按 ID 建立並收集 Matches，但 State 保持 `undefined`。
9. 全部 Event 匹配後，Assembler 複查 Reader 相依性，使同一視窗內較早瞬間態先穩定、較晚消費者再讀取它。
10. 所有 Context 標記 dirty，下一次 flush 先按 Step→Turn 完整重建 Location data，再對每個 target 呼叫 `buildViewNode()`。
11. 某些業務在缺 start 時返回 `null`；Compaction、Command、Tool result 或 Turn Error 等可根據充分 update 證據構造 fallback Node。
12. 每個 View Builder 收到完整 Node 集和 timeline，透過 `replace()` 建立初始 snapshot。

這條鏈路“從最新頁開始”只發生在分頁選擇層。頁面內部 State 始終正序計算，因此同一個視窗不會因為掃描方向不同產生不同業務結果。

缺 start 的 Context 不是錯誤。它是等待 older 頁補齊的 pending 聚合容器；是否提前可見由該 Definition 的 `buildViewNode()` 決定。

若當前頁中的同 ID update 在日誌順序上真的早於 start，而不是僅僅先被載入，補齊 start 後 replay 會報協議錯誤。到達順序可以反向，業務日誌順序不能反向。

### 新 older 分頁的 prepend

1. `Session.loadOlder()` 以當前 `baseSeq` 拉取緊鄰前頁，並先驗證頁尾與當前視窗連續。
2. Session 把 raw Event/view 陣列 prepend 到自己的視窗，只把這一頁傳給 `assembler.prepend(entries, hasMore)`。
3. Assembler 按 seq 去掉與當前視窗重疊的 Events，再把 fresh page 內部升序排列。
4. 已存在的 Context、State、current Nodes 和 View Builder 實例不清空。
5. LocationIndex 用擴充後的完整輸入重建 facts，並報告 Location identity 真正變化的 seq。
6. 擁有這些 seq 的 Context 更新 Match Location，並從 start replay；無關 Context 不參與 Location replay。
7. fresh Events 逐條執行 Definition matcher，並按穩定 ID 插入已有或新 Context 的有序 Matches。
8. 新頁補出 pending Context 的 start 時，該 Context 從 start 初始化，再正序應用已經收集的所有 updates。
9. 新頁建立更近的 Reader predecessor、改變 predecessor revision 或消除 window gap 時，消費者從 `start()` 重算。
10. Reader 相依性沿 start seq 向後傳遞 replay；同一傳播批次不會把 Event 逆序應用。
11. `hasMore` 從 true 變為 false 的空頁也會複查相依性，把暫定 `undefined` 收斂為確定不存在。
12. flush 只為 dirty Context 重新發布 Step/Turn Location data 和 target Node，並把非空結果作為 `upserts` 交給 View Builder `apply()`。

Prepend 保留已有 Context key 和 current Node identity。新頁可以在 Chat `order` 前部增加 key，也可以修正既有 Node 的 anchor、Location、visibility 或 data，但不會為無關業務重新建立 Context。

Chat Builder 遇到結構變化時會從 keyed store 重算可見 `order` 和 Location 二級索引；這是檢視表索引計算，不會重新執行全部業務 Definition 或替換未變化 Node value。

Reader gap 修復是 prepend 與普通 append 最大的演算法差異。新頁不僅可能建立可見歷史 Node，也可能改變後續 Inbox 瞬間態以及相依性它的 Message 分類。

### 正向即時 append

1. Session 只接受緊鄰當前 tail seq 的 live Event；重疊 seq 去重，出現 gap 時先走 tail-page repair。
2. 非邊界 Event 增量寫入當前 Turn/Step 坐標；邊界 Event 更新所屬 Turn 的 Location facts。
3. Assembler 對這一個 Event 的每個普通 Definition 呼叫一次 `match()`，不會遍歷任何 Definition 的 Context 集合。
4. 每個命中結果透過 `(kind, id)` 直接定位一個 Context。
5. 新 ID 建立 Context；已有 ID 的正常尾部 update 直接呼叫一次 `update()`。
6. start 或任何需要插入非尾部位置的證據會走完整 `replayContext()`，保持同一正序語義。
7. Context revision 變化後，只沿已登記 Reader 相依性 replay 消費者。
8. Location close 會更新所屬 Turn 中受影響 Match 的 Location，並 replay 這些 Context，使未完成 Assistant、Tool 或 Retry 得到 interrupted/cancelled 語氣。
9. Assembler 彙總所有命中 Definition 的 publication urgency；`immediate` 高於 `animation-frame`，後者高於 `none`。
10. Session 把 immediate 交給 microtask notifier，把 animation-frame 交給 RAF notifier。
11. flush 先為 dirty Context 更新 Step/Turn Location data，再呼叫 `buildViewNode()`，最後把本輪 upserts 和最新 timeline 交給 View Builder。
12. React 訂閱的新 snapshot 複用穩定 Context key；同一 Tool running→settled 或 Assistant streaming→final 不跨父節點移動。

Append 的業務匹配成本是 Definition 數量加實際命中的 Context 更新，不隨歷史 Context 數量成長。Reader 消費者和 Location 關閉會增加與真實相依性或所屬 Turn 成比例的 replay。

Chat `order` 的結構性變化仍可能重排當前可見 key；純 data 更新只替換 keyed store 中一個 Node，並 touch 所屬 Location 索引。這裡保證的是無關業務不 refold、Node identity 不替換，而不是宣稱所有檢視表索引操作都是常數複雜度。

### Replace、prepend 與 append 的一致性

三條鏈路最終都遵守同一不變數：Context Matches 按 seq 排序，State 從唯一 start 正序 fold，Reader 只看嚴格前序 active Context，Location data 按 Step→Turn 發布，Node key 只由 kind 和 ID 決定。

`replaceWindow` 是初始打開、resync、gap repair 和 registry 變化的低頻完整替換，不用於實作普通 load older。`prepend` 與 `append` 都保留現有 Builder 和 Context identity。

分頁頁寬、歷史載入次數和 RAF 合批隻影響何時得到更多證據或何時發布，不改變視窗證據相同時的最終 Context State 與 Node。

## 內建業務如何使用 Definition

### 匹配、ID 與 State

| 業務 / `kind` | 穩定 ID | start Match | update Matches | State 與跨 Context 讀取 |
|---|---|---|---|---|
| Next-turn Inbox / `inbox-next-turn` | splice Event seq | 每條目標為 next-turn 的 `agent/inbox/spliced` | 無 | 從 `reader.previous(ownKind)` 的 pending/claimed 瞬間態應用當前 splice |
| Next-step Inbox / `inbox-next-step` | splice Event seq | 每條目標為 next-step 的 `agent/inbox/spliced` | 無 | 同樣形成逐指令瞬間態，claimed 集合供 Message 讀取 |
| Message / `input-message` | message ID | append-surface `user/message` | 無 | 根據 source 生成 context message，或讀取最近 next-step Inbox 判斷 user/steering |
| Assistant / `assistant-step` | `turn:step` | `step/start` | `assistant/chunk`、final `assistant/message`、同 step Retry | 聚合 blocks、usage、首 token 時間、final 和 retry 隱藏狀態，並行布同 key Step data |
| Tool / `tool-call` | root call ID | root `tool/call` | root result、Code Dispatch start/result | 聚合 root、children 和 parent Map；Dispatch Event 用 `rootCallId` 精確路由 |
| Command / `command` | command ID | `command/run` | `command/done`、帶 source command ID 的 compact lifecycle/checkpoint | 聚合 command outcome 和手動壓縮證據 |
| Automatic Compaction / `compaction` | compaction ID | 無 source command ID 的 `compaction/start` | summary、end、replacement checkpoint | 聚合 summary/checkpoint；checkpoint 足夠時可在缺 start 下 fallback |
| Retry / `model-retry` | retry ID | attempt 1 的 `llm/retry` | 後續 `llm/retry` 與 `llm/retry-started` | 聚合約一 RetryId 的 attempts 與 scheduled/started 狀態 |
| Turn Error / `turn-error` | turn number | `turn/start` | error `turn/end` 與該 turn Retry Events | 聚合 terminal failure，並用 Retry 證據決定隱藏 |
| Turn Tail / `turn-tail` | turn number | `turn/start` | Assistant、Retry、`step/end`、`turn/end` | 保存 turn end，讀取各 Step 的 Assistant data，發布 Turn data；完整 Matches 用於選擇視覺尾部 anchor |
| Deliverables / `deliverables` | turn number | `turn/start` | 該 Turn 的 Tool call/result | 聚合成功 mutation paths 並行布 Turn data，不生成 view Node |
| Unknown fallback / `unknown-surface` | Event seq | 未被普通 Definition 認領的 append-surface Event | 無 | 保存原始 type/data 作為 JSON fallback |

### Chat Node 與歷史/即時特性

| 業務 | `publication()` | Chat 產物 | 歷史分頁與執行時期行為 |
|---|---|---|---|
| Inbox | `none` | 不生成 Node | prepend 補前序 splice 時沿 Reader 鏈重算瞬間態 |
| Message | 默認 immediate | `user`、`steering` 或 `context` | window gap 修復可讓同一 message key 重新分類 |
| Assistant | chunk 為 RAF，final immediate，純 usage/finish 為 none | 同 key `assistant-step`，狀態為 running/settled/interrupted | 缺 `step/start` 可先用 Matches fallback；Location close 生成中斷表現 |
| Tool | 默認 immediate | 一個遞迴 `tool-call` root，包含全部 `subCalls` | result-only 歷史視窗可 fallback；running→settled 保持 key |
| Command | 默認 immediate | 普通 `command` 或整合 `manual-compaction` | checkpoint 到達可改變 anchor，但不改變 Context key |
| Compaction | 默認 immediate | `compaction` marker | checkpoint 可先展示，older 補 start 後正序 replay |
| Retry | 默認 immediate | 一個 `model-retry` Node 內含 attempts | 多次 retry 更新同一 key；Location close 把最後 scheduled 表現為 cancelled |
| Turn Error | 默認 immediate | `turn-error` visible/hidden | 缺 start 可從 error end fallback；Retry 到達後保留 key 並隱藏 |
| Turn Tail | 僅 `turn/end` immediate，其餘 none | 獨立 `turn-tail` footer | 從 Step Assistant data 計算 closing/metrics，並透過同 turn Matches 決定 anchor |
| Deliverables | 默認 immediate | 不生成 Node | Tool 結帳增量更新所屬 Turn data，Turn Tail 擴充槽讀取 produced files |
| Fallback | 默認 immediate | `unknown` JSON row | 只兜底 append surface，普通業務已認領但暫不可見時不會重複生成 |

Inbox 展示了“每條 Event 都是一個 start-only 瞬間態 Context”，不是所有業務都需要 start/update 配對。它透過 Reader 與前一個同 kind Context 形成連續 fold，而非給整個 Inbox 人工製造生命週期 ID。

Assistant、Turn Tail 和 Turn Error 展示了同一 Event 被多個 Definition 獨立認領。每個 Definition 只更新自己的 State，最終分別生成原子 Chat Node。

Assistant、Turn Tail 和 Deliverables 展示了 Location data 的分層組合。Assistant 負責寫好每個 Step 的 `assistant-step` data；Turn Tail 從這些 Step values 計算 `turn-tail` data；Deliverables 獨立維護同一 Turn 的 `deliverables` data。消費者只讀取聲明合併後的 key，不掃描其他業務 Node，也不取得提供方的 Context State。

Tool 和 Command 展示了多 Event 聚合：生產者提供共同 ID，Context 在業務內部構樹或整合 Compaction，不把配對工作推給 Chat Builder。

Compaction 和歷史 Tool result 展示了缺 start 時的業務 fallback。引擎不統一規定“沒有 start 就不渲染”；Definition 根據當前 Matches 是否足夠自行決定。

Retry 展示了業務 State 與 Location 的分工。scheduled/started 屬於 Retry State；Step/Turn 是否關閉屬於引擎 Location；`buildViewNode()` 組合兩者得到 cancelled 視覺狀態。

Unknown fallback 展示了 Registry ownership：fallback 只處理沒有任何普通 matcher 認領的 append surface Event，不會因為普通 Context 暫時返回 `null` 而誤生成第二個 Node。

## View Builder 與 React identity

[`ConversationViewRegistry`](../../../../packages/client/runtime/src/client/conversation/view-registry.ts) 為每個 target 建立獨立的 per-Session builder。Registry 保存 factory，不共享某個 Session 的排序或快取。

Assembler 低頻完整替換時呼叫 `replace({ nodes, timeline })`；普通 prepend/append flush 呼叫 `apply({ upserts, timeline })`。Builder 只接收 Definition 已構造完成的 target Nodes。

[`ChatSnapshotBuilder`](../../../../packages/client/ui-conversation/src/client/conversation-nodes/chat-snapshot-builder.ts) 維護 `order`、keyed `nodes` store、turn/step `locations` index、`timeline`，以及由 StatsLine 使用並映像檔到頂層公共相容欄位的 `legacy` slice。

Chat 結構變化只由新 key、`anchorSeq`、visibility 或 Location identity 變化觸發。普通內容變化不重建 `order`；keyed Node store 只替換該 key 的 value。

Builder 遇到結構變化時從 store 的當前 values 計算 visible order，並按未變化引用複用索引陣列。Prepend 可以增加前部歷史 key，append 可以增加尾部或按業務 anchor 落位，既有 key 不因排序變化而重新命名。

[`ChatView`](../../../../packages/client/ui-conversation/src/client/chat/ChatView.tsx) 只遍歷 `order`。每個 [`ChatNodeSeat`](../../../../packages/client/ui-conversation/src/client/chat/ChatNodeSeat.tsx) 以 Context key 固定在同一個父清單中，並按 `node.kind` 分發 `'conversation.chat.node'` keyed slot。

[`ChatNodeDataMap`](../../../../packages/client/ui-conversation/src/client/contract/chat-nodes.ts) 是 declaration-merged 的 renderer payload registry。每個業務模組分別註冊自己的 Definition 和 keyed renderer；`registerConversationNodes()` 與 `registerChatNodeRenderers()` 只負責裝配這些獨立貢獻，不透過 closed union 或中心 switch 解釋業務。內建實作仍位於 `ui-conversation`，但該類型和註冊邊界允許業務遷入獨立 package 而不修改 Chat dispatcher。

`conversation.view` 的 Chat entry 在聲明 `conversation.chat.node` child slot 時統一註冊 `ChatNodeTurnDataInjected`。`ChatNodeSeat` 只把穩定 Node key 作為 `hookContext` 傳給 slot；Slot renderer 用官方 standard props 中的 `useSession` 和該 key 構造 `useTurnData(businessKey)`，因此每個 keyed Chat renderer 都能讀取自己 Node 所屬 Turn 的強類型只讀 data，Assistant renderer 不擁有特殊注入權限。

Slot-level contextual Hook 與 entry-owned `inject.hooks` 是兩條獨立路徑。後者繼續只綁定 registration-owned Observable；前者按穩定 slot inject face 快取定義，並按穩定 render occurrence 綁定 factory 和 Hook。`useTurnData()` 內部 selector 只返回當前 Node 的 `turn.data.get(key)`，無關 Session publication 會被 selector equality 截斷。

標準 `useSession` 仍屬於所有 session-scoped slot renderer 的公開能力，`useTurnData()` 是收窄常見讀取方式而不是權限沙盒。全視窗統計或任意對象索引仍可顯式使用 Session snapshot；它們不能偽裝成“當前 Node 的 Turn data”。

Assistant streaming 到 final、Tool running 到 settled 只更新同一個 Seat 的 data 和必要的排序屬性，不再從末尾 running container 移入 finalized flow，因此元件內部 State 不因結帳自動歸零。

業務主動把已發布 Node 改成 hidden 時，它會退出 visible order，復原 visible 時會重新 mount。這是明確的業務撤顯語義，與 running→settled 的穩定 Seat 保證不同。

具體 Tool renderer 仍由 [`ui-tool ownership decision`](2026-08-08-client-tool-presentation-ownership.md) 約束。Tool Definition 只交付遞迴 root/subcall data，`ui-tool` 再按 Tool name keyed slot 分發具體表現。

Trajectory 針對與 Chat 相同的 Assembler 和 Session 事件視窗註冊自己的 target 與業務 Definition。它的 target builder 保留 stage-oriented read model，既不消費 Chat Builder 的 legacy slice，也不執行獨立 history fold。Chat Builder 為 StatsLine 和頂層公共相容欄位保留 legacy slice；target 專屬 Definition 不改變共享的 Context、Reader 或 Location 契約。

target 專屬 Trajectory Definition、保留的 stage model、Steering 適配、複雜度上界與表現層熱點由 [Trajectory Context 組裝決策](2026-08-11-trajectory-conversation-context-assembly.md)負責。

## 執行時期與渲染鏈路

```text
Session Event window
  -> ConversationNodeAssembler
       -> Definition.match(event) -> (kind, id, start/update)
       -> Context matches + State + Location
       -> Definition.buildLocationData(step -> turn)
            -> StepLocation.data / TurnLocation.data
       -> Definition.buildViewNode() for its declared target
  -> target View Builder
       -> chat: ChatSnapshotBuilder -> ChatView -> keyed ChatNodeSeat
       -> trajectory: TrajectorySnapshotBuilder -> stages/layout/table
```

## 驗證

Runtime tests 固定 Definition 生命週期註冊、exact-ID append、update-before-start 收集與 start 後正序 replay、prepend identity、Reader window-gap 修復、傳遞相依性、Location closure、Step→Turn data phase order、Location data replacement、publication cadence、非法撤回和 per-target Builder。

Conversation tests 覆蓋全部內建 Chat Definition、Assistant Step data、Turn Tail 與 Deliverables Turn data、Chat 排序和結構共享、selector isolation、Assistant/Tool running-to-settled identity、nested Code Dispatch、steering、Compaction、Retry、interruption、load-older anchoring 和 slot dispatch。Trajectory tests 則覆蓋它獨立註冊的 Message、Assistant、Tool、Compaction、Request-header 與 boundary Definition，以及繼續保留的 stage-oriented view model。

Slot type/runtime tests 固定父註冊必須提供聲明的 common inject、`hookContext` 類型、不同 Node context 的 Hook 隔離、factory/Hook identity 穩定，以及無關 Session publication 不重渲染業務 renderer。原 entry-owned Observable Hook 測試繼續固定未使用 contextual factory 的路徑。

Assembled Web snapshot、GUI 和瀏覽器場景覆蓋真實 plugin graph。瀏覽器證據比較 Assistant streaming→settled、Bash running→settled 以及 Code Mode root + nested subcalls 與 master 的版面配置。

歷史鏈路驗證同時覆蓋完整 replace、非重疊 prepend、重疊 seq 去重、空頁 `hasMore` 收斂和 live append。相同 Event 視窗透過不同攝入路徑得到相同業務 State 與最終 Node。

## 考慮過的替代方案

**保留中心化 Session transcript fold，只抽 helper。** 拒絕：業務 identity、歷史 replay 和 cache invalidation 仍屬於一個閉合 switch，移動函式不會產生獨立所有權。

**讓 React renderer 自己掃描 Session Event。** 拒絕：每種 view 都會重複匹配和生命週期 State，React 會成為業務權威，paging 與 streaming 也會重算無關元件樹。

**把全域性 Nodes 或 Location 索引傳給每個業務 renderer。** 拒絕：業務元件會自行掃描和推斷當前 Turn/Step，訂閱範圍隨視窗成長。Definition 把聚合值發布到 Engine-owned Location，renderer 只讀取自己 Node 的 Location data。

**每個新 Event 都呼叫同 Definition 的全部 Context。** 拒絕：append 成本隨歷史成長，`update()` 也會同時承擔匹配與轉換。無 Context 的 `match(event)` 先算出 ID，隨後只更新一個 Context。

**讓 Definition 的 matcher 讀取 Context 或掃描歷史。** 拒絕：匹配將相依性攝入方向，result-first 歷史頁無法獨立算出歸屬，即時 append 也退化成開放對象尋找。

**為歷史反掃定義逆向 State fold。** 拒絕：每個業務都要維護互為逆運算的兩套邏輯，刪除、非可逆聚合和跨 Context 相依性很難保持一致。統一 Matches 後從 start 正序 replay 只有一套業務語義。

**把 Inbox 做成引擎一級公民或一個視窗級 Context。** 拒絕：Inbox 是普通業務狀態，不應汙染通用引擎；逐 splice 瞬間態加嚴格前序 Reader 同時支持 prepend、append 和 Message 查詢。

**給跨業務查詢註冊特化 query method。** 拒絕：消費者仍要相依性提供方 API，新增關係會擴張中心介面。Reader 暴露指定 kind 的只讀前序 Context，由提供方寫好 State、消費者讀懂 State。

**讓 Location data 消費者直接讀取提供方 Context State。** 拒絕：消費者會相依性另一個業務的可變內部形狀，也無法表達值屬於哪個 Turn/Step。declaration-merged data map 只公開提供方選擇發布的只讀值和 Engine-owned 坐標。

**增加通用 `end()`、prepared 或 window reset 生命週期。** 拒絕：不同業務完成條件不同，分頁缺口也不是業務生命週期。業務 Event 更新 State，Location close 觸發 replay/build，Reader dependency 負責補頁失效。

**在同一個 Event Definition 內透過 `buildViewNode(target)` 為 Chat 與 Trajectory 分支。** 拒絕：兩種檢視表需要不同的業務 State 與中間記錄，共用 Definition 會迫使每個 package 攜帶另一邊的條件與 payload。target 自有的 Definition 把這些選擇留在本機，同時複用 Assembler 的攝入與生命週期約定。

**在最終業務 Node 上再疊一層通用 layout model。** 拒絕：activity、tail candidacy 和 layout enum 會把當前 Chat 的業務語義重新集中到引擎。最終 Node 直接攜帶 renderer 所需 data，只共享 identity、排序和 Location 事實。

**只在 Assistant renderer 註冊 Turn data Hook。** 拒絕：訪問當前 Node Location 是 `conversation.chat.node` slot 的公共能力，不屬於某個業務 renderer。父 Chat entry 註冊一次 common inject，所有 keyed renderer 共享同一強類型約定。

**把 running Assistant 或 Tool 保留在獨立 tail container。** 拒絕：結帳時會跨 React parent 移動，穩定業務 key 也無法阻止 remount。統一 keyed order 允許 data 和排序位置改變，但不改變 Seat identity。

## 後果

新增業務節點可以區域性註冊自己的 matcher、State 轉換、選填 Location data、最終 target Node 和 renderer，不再修改 Session 的業務 switch。`ChatNodeDataMap` 和 Location data maps 允許業務 package 透過 declaration merging 合入強類型 data；所有相關 Event 仍須暴露可單 Event 推導的穩定 ID。

Host 業務 package 把自己的持久 Event 成員 declaration-merge 到 `@deepseek-ai/dsh-session/types`，Client Definition 則透過對應業務 package 的 `/types` 子路徑進行 type-only import。增強實際聲明介面而不是重匯出 barrel，使 Host 和 Client 的獨立 TypeScript Program 都能獲得相同的 Event narrowing，同時不把 Host runtime 帶入 Client 圖。

初始尾頁、older prepend 和 live append 共享一套 Context 不變數。缺 start、Reader window gap、Location unknown 以及高頻 delta 都是引擎明確表達的狀態，不需要業務另建方向相關 cache。

Append 不掃描歷史 Context；prepend 只 replay Match、Location 或 Reader 答案真正受影響的 Context。Chat 結構變化仍可能重算 visible order 和索引，但不會重跑無關業務 fold 或替換未變化 Node identity。

State 更新與發布頻率分離後，Assistant 每條 delta 都被 fold，同時每 animation frame 最多 materialize 一次。step/turn close 和 final 可立即發布最新 State。

Step/Turn 成為業務間共享聚合的穩定宿主。Turn Tail 和 Deliverables 不再相依性 renderer 掃描全域性 Nodes；Slot-level `useTurnData()` 把常見讀取限制到當前 Node 所屬 Turn，並透過 selector equality 隔離無關更新。

代價是 Runtime 新增 Registry、Assembler、Location data、相依性重放和 per-target Builder 契約，UI Slots 也新增 parent-owned common inject 與 per-occurrence `hookContext`。Definition 作者必須理解穩定 ID、唯一 start、正序 replay、Step→Turn 發布順序、只讀 Reader 和 Node 不撤回規則。

`useTurnData()` 不撤銷 session-scoped renderer 的標準 `useSession`，因此該邊界依靠 API 引導和測試，而不是能力隔離。Registry 變化仍是低頻完整 rebuild；Chat Builder 繼續為 StatsLine 和頂層公共欄位維護 legacy slice，Trajectory 則在共享 Session 視窗上擁有 target 專屬 Definition 與 Builder。內建 Definition 分別留在所屬 UI package；這些相容邊界不把業務解釋權交還給 Session。
