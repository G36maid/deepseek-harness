# @deepseek-ai/dsh-client-runtime

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

用戶端 cordis 啟動與不相依性 React 的對象服務：SlotRegistry 包裝 SlotCore 並提供 renderer 資料源；SessionRuntime 擁有 Session 對象、清單與 scope 狀態，以及供已註冊 conversation view target 共用的事件視窗與歷史分頁。WorkspaceRuntime 相依性 SessionRuntime，擁有 Workspace 對象、清單／操作、預設目標派生，以及 New Session 空工作階段複用入口（`connectWorkspace`）。執行時期把共享 Host 流分發給 Session 與 Workspace 所有者，並把每個通用 `host/remote-event` 幀交給 `ctx.remote.$dispatch`；各領域包透過 `ctx.remote.$on` 訂閱自身 owner 事件，並自行決定使哪些快取或工作階段行失效。用戶端工作階段一律由 Host 建立（一次 `session.create` 同時產生 Session、agent（代理）和 cwd）；用戶端不持有任何實體化之前的工作階段狀態——agent scope（host dsh-scope 的用戶端映像檔，以 agent/session 共用 id 為鍵）在工作階段行進入清單映像檔時建立，並隨 prune 銷毀。約定：api-contracts v3 §4。每個 `Session` 持有一個通用的 `ProjectionValueStore`，由歷史記錄尾部的 `projections` 塊播種，並經 `session/projection` 幀按 seq 高者勝更新；領域鍵（含 `todos`）經 `projections.faceOf`／`useProjection` 讀取，不經 `ConversationSnapshot`。該 store 還會透過 `SessionSummary.projectionValues` 發布一份引用穩定的完整值對映，使全域性清單消費端無需為每個工作階段建立訂閱，即可複用同一組投影。

對於每條可到達本機根 Agent 或可繼續子 Agent 的提示詞，執行時期都會取樣瀏覽器當前的 `Intl.DateTimeFormat().resolvedOptions().timeZone`，並只把該值附加到這一次 Session 或 subagent 提示詞 RPC。該值既不快取，也不包含在 Session 建立或 fork 狀態中，因此旅行與並行分頁標籤都能保留訊息本機的來源資訊。瀏覽器若無法提供非空時區，會在本機拒絕該提示詞，而不會悄然使用部署狀態代替。

`bindSettingsScope` 面向單個由領域持有的 namespace，是 Host 側 settings owner seam 的瀏覽器映像檔。它在開始非阻塞初始讀取前建立訂閱，發布 uSES 快照（狀態、分節值、組裝 `base` 層與原始 `user` 層、revision、可寫性、host／記憶體模式），使用已知最新 namespace revision 序列執行 `set` 與 `unset` 寫入，抑制過時發布，並在最新寫入被拒時從 Host 狀態復原；外掛程式釋放時，它會達到完全靜止。預設解碼器會對照該 namespace 自身的序列化 wire schema（經 dsh-client-schema-form 還原）校驗每個分節，因此領域只有在需要比該 schema 進一步收窄時才新增解碼器。回環頁面使用 Host settings API，遠端頁面則停留在記憶體模式。欄位是否被覆蓋，取決於它是否**出現**在 `user` 中——與組裝預設值相同的覆蓋仍然是覆蓋，比較值是看不出來的——而 `unset` 就是表單把某個欄位清回 `base` 的方式。namespace schema、預設值與即時服務歸領域包所有，而非把產品政策放入執行時期。

## Slot 聲明注入

`ctx.slots.inject(name, callback)` 將完整的 `SlotMap` key 作為貢獻項的相依性，適用於貢獻方外掛程式可獨立於聲明條目啟用的情形。聲明存在時，它會同步執行 `callback`，否則等待；聲明摺疊會 dispose（資源釋放）回呼 effect，重新聲明則會再次執行回呼。控制器歸呼叫方的外掛程式 fiber 所有，因此解除安裝貢獻方會取消等待或移除其活躍註冊項。直接呼叫 `slots.register()` 向未聲明 slot 註冊仍會拋出例外。

回呼返回一個同步 disposer 或由多個 disposer 構成的 iterable。因此，generator 可以 yield 多個 `slots.register()` 呼叫，並將它們組成一項交易：setup 失敗會回滾先前 yield 的 effect，teardown 則按逆序執行它們。聲明生命週期使用專用的單調 declaration epoch（聲明代次），因此，即使摺疊與重新聲明合併在同一次 renderer 通知中，回呼仍會重新啟動，而普通條目變更不會重新啟動它。聲明綁定的 teardown 與帳本變更同步執行，在同一 tick 內的後續註冊之前釋放執行時期資源。詳見 [slot 聲明注入決策](../../../.agents/notes/implemented/architecture/2026-08-05-slot-declaration-injection.md)。

## Workspace 與 Session 清單

Workspace 和 Session 清單各自具有單調的 `pending` → `ready` 基線階段，也有各自的刷新活動／錯誤狀態。清單請求期間到達的增量插入或更新／移除／順序幀與一元變更回顯會在其回應之上重播。每次成功的 Workspace 基線都會重新建立 Host 持久 Workspace 順序，因此重連會接納該用戶端離線期間提交的變更。`WorkspaceRuntime.insertBefore` 會立即安裝樂觀順序；只有最新一元回聲可以替換它，更新的 Host 順序幀優先於舊回聲，而最新請求被拒時會復原最近一次由 Host 確認的順序，不會復原更早且尚未提交的拖曳。已移除的 Workspace id 會保留行程本機刪除標記，避免延遲到達的 changed 幀將其復活。Workspace 新近程度只在兩條基線都 ready 後派生，且絕不改變 Workspace 清單順序。

`SessionSummary.pendingInteraction` 將阻塞 Session 的即時使用者操作分類為 `approval`、`plan-review` 或 `question`。`SessionManager` 依據穩定的請求標識跟蹤可應答請求的 requested/resolved mux 幀，即使 `Session` 對象尚未實例化也不例外；實例化前的緩衝會保留每個仍有效的請求，替換回放產生的重複項，並移除已解決的請求，因此打開 Session 時，清單狀態始終有一個對應的可應答 `PendingWait`。審批與問題並行時，第一個 pending 問題具有更高的呈現優先級，以匹配 composer 路由；只有滿足 plan-review composer 二元呈現約束的請求才會保留獨立的 `plan-review` 狀態。該狀態的作用域限定在連線代次內：斷連時清除，mux 打開時的重播只復原仍處於 pending 的請求。

`WorkspaceRuntime.delete(workspaceId)` 在一元回應成功後從用戶端投影中移除註冊記錄；對應的 `host/workspace-removed` 幀具有冪等性，並負責同步其他分頁標籤。Session 狀態與當前 Session selection 相互獨立，因此 Workspace 消失後，其已納入用戶端投影的 Session 會立即投影到 Ungrouped 下。

`WorkspaceListState.archivedSessionIds` 映像檔 Host 的登錄檔級全域性封存集合（一個按 Host 順序的 `readonly SessionId[]`，僅在成員變化時才替換；需要 O(1) 查詢的消費端自建臨時 Set）。它是全快照狀態：`workspace.list` 基線、`archiveSession` 一元回聲和 `host/archived-sessions-changed` 幀各自安裝完整集合。`WorkspaceRuntime.archiveSession(sessionId)` 透過 wire 封存；投影層在當前 selection 落入封存集合時統一清空為 New Session 檢視表狀態——一條規則同時覆蓋本機回聲、其他分頁標籤的幀、以及重連基線復原出一個離線期間被封存的 selection。在 `workspace.list` 請求進行中安裝的集合還會取代該過期基線攜帶的集合。各分組檢視表在所有位置隱藏集合成員，而工作階段行本身仍留在清單 store 中。

SlotRegistry 分別為 renderer 提供 `useSessions` 與 `useWorkspaces` 的裸 observable；web-react 建立掛鉤。Workspace 業務狀態不會進入 `SessionListState` 或條目 store。

`indexSubagentDescendants()` 從保留的清單映像檔中派生每個 parent 的後代總數與執行中後代數。它只沿不間斷的 `origin: 'subagent'` 祖先鏈追蹤，因此普通 fork 會開啟獨立的歸屬子樹；遇到環時，追蹤會停止但不會拋出例外，缺失的 parent 則會保留為無害的鍵，直至其摘要到達。

`SessionListState.jobsBySession` 按 last-wins 映像檔宿主的 `session/jobs` 幀，以工作階段為鍵，不需要 Session 實例。被清空的集合存為缺失的鍵，因此「缺失」與 `[]` 是同一種表示，消費端永遠不必偵測哨兵值。兩處清理讓它不至於比它所反映的真相活得更久：`session/subscribed` 丟棄該工作階段的映像檔，因為新一代只為非空集合發送 baseline，被留下的清單會變成幽靈；`host/session-removed` 再丟一次，因為 owner 銷毀是在 mux 流上移除記錄的，而移除幀走 host 流，兩者沒有相對順序。

`SessionRuntime.search(query, signal)` 是基於 `session.search` RPC 的無狀態單次操作。它返回經過排序的工作階段／snippet 對，但不會將查詢條件、載入狀態或錯誤狀態寫入共享 Session 清單，因此每個 UI 所有者都自行負責防抖、取消、抑制過時回應和回退呈現。`searchResultLimit` 將 `SESSION_SEARCH_RESULT_LIMIT`——即回應 schema 自身強制執行的上限——作為注入的呈現資料重新公開，使用戶端外掛程式無需複製該值。它是協定常數而非逐連線狀態，因此連線 handle 不攜帶它。

## New Session 與 blank 映像檔

`WorkspaceRuntime.connectWorkspace(workspaceId)` 解析 New Session 流程最終落入的工作階段：先在清單映像檔中複用該 workspace 的既有空工作階段（`blank && cwd == workspace.path && sessionIds.includes(id)`——host 自己的成員規則，絕不只按 cwd，避免劫持 cwd 匹配但未入帳的空白工作階段），未命中則呼叫 `session.create({workspaceId})`，返回工作階段 id 由呼叫方 open。共享的 `startSession` 操作優先使用明確指定的 Workspace，其次使用當前 Session 所屬 Workspace，再其次使用派生的最近活躍 Workspace；一個 Workspace 都沒有時則清空選擇，進入空白 New Session 頁面。`SessionSummary.blank` 映像檔主機派生的空日誌位，在用戶端只降不升：由 `session.list`／`host/session-added` 幀播種，本機首次獲 Host 接受的 `prompt()`（RPC 成功回應時——受理即證明使用者訊息已入主機日誌；首訊被拒則工作階段保持 blank、保持可複用）與任何 `running: true` 狀態幀翻為 false，每次清單重拉重新對齊。清單介面隱藏 blank 行；store 保留全部行。`SessionRuntime.create` 接受選填的、由呼叫方預先分配的 SessionId，失敗時拋出 `SessionCreateError`（攜帶 `requestedSessionId`）。

`Session.composerPhase` 把任何可見的非命令 Chat Node 視為對話內容，因此用戶端外掛程式可以在不打開輪次的情況下投影持久使用者輸入，而僅包含通用命令列的視窗仍保持 Host blank 狀態。清單隱藏和空白工作階段複用仍遵循 Host blank 位。缺少外掛程式輸入 Node 的歷史視窗會復原該空白狀態，直到載入更早頁面後該 Node 復原。

## 待處理佇列投影

`ConversationSnapshot.queue` 是 Host 提供的 `agent.inbox.nextTurn` 權威瞬態快照；待處理的 next-step steering（中途引導）不進入此投影。每行攜帶其 `MessageId`、所有內容區塊均為文字時的完整可編輯文字，以及扁平化預覽。Host 根據持久 `agent/inbox/spliced` 變更派生完整 `session/queue` 快照，並在重連時傳送基線；面向單則訊息的 `agent/inbox/inserted`、`claimed` 與 `discarded` 通知不用於重建該投影。`Session.updateQueue()` 經 Host 側 `Inbox.splice()` 傳送編輯／移除操作，用戶端不做樂觀變更，因此下一份 Host 快照是唯一可見的提交結果，claim 競態則可能呈現 `queue-item-not-found`。

## Conversation 組裝

每個 `Session` 都把連續事件視窗交給 `ConversationNodeAssembler`。外掛程式註冊業務 Definition，把單個事件對映為穩定的 `{kind, id}`，在唯一 start 事件處建立 State，摺疊有關聯的 update，再為已註冊的檢視表目標構造最終節點。Assembler 負責 Context 索引、只讀前序 Context 查詢，以及引用穩定的 Turn/Step Location 索引。即時 append 只對每個 Definition 求值一次，並且只更新命中的 Context；載入更早分頁時保留已有 Context 與節點身份，只匹配新 prepend 的事件，並重放前序相依性或 Location 事實發生變化的 Context。完整替換僅用於 open、resync 和 gap repair。

Definition 作者只根據當前事件完成匹配，為每條關聯事件提供穩定業務 id，並保證 update 能按日誌 `seq` 重播；renderer 只消費最終 Node data 與受限 Location value，不掃描 Session 或 Chat 集合。完整註冊和分頁路徑見 [Conversation Node 實作手冊](../../../docs/cookbook/adding-a-conversation-node.md)。

`ui-conversation` 註冊內建 Chat Definition 與 keyed Chat snapshot builder。append 來源的 user、assistant 和 Tool result 構成人類可見記錄；僅供模型使用的 replacement 副本不進入 Chat，compaction 檢查點除外，它會成為獨立標記，並在更早分頁補齊 summary 溯源後更新。持久 inbox splice Context 能把 next-step 使用者訊息判定為 steering，無須讓 inbox 狀態成為 Session 特例。上下文訊息保留生產者 provenance 與 form。StatsLine 讀取 `ConversationSnapshot.chat.legacy.nodes`；Session 則把該 legacy slice 映像檔到頂層 `nodes`、`partial` 和 `runningCalls` 公共相容欄位，無須執行第二套業務 fold。`ui-trajectory` 在同一個 Session 視窗上註冊獨立 Definition 與 target builder；它保留現有的 stage-oriented view model，既不消費 Chat 相容欄位，也不執行另一套 history fold。

Chat builder 為每個 Session 保留一個 mutable keyed store。內容更新只通知受影響的 node key；結構變化才重建順序和 Location 成員關係；prepend 只增加行，不替換既有 keyed value。每個 Assistant chunk 都會更新 Definition State，但最多每個 animation frame 請求一次物化；final message 與 Turn/Step 關閉會立即發布。參見 [Client Tool 展示所有權決策](../../../.agents/notes/implemented/architecture/2026-08-08-client-tool-presentation-ownership.md)。

## Trajectory 請求資料

Trajectory Definition 組裝出一條按時間順序排列、以用途為判別欄位的提供方請求流。助手請求始終攜帶數值型 `turn` 與 `step`；壓縮請求攜帶 `step: 0`，其 `turn` 所有者可以是 `null`。這個 null 所有者表示手動壓縮獨立執行在兩個輪次之間，並不表示它屬於任一相鄰輪次。`session/end-seed` 邊界會在邊界時刻將未匹配的壓縮請求以錯誤狀態結束，錯誤固定為 `Compaction was interrupted before completion.`；後續 start 會投影為獨立請求，而不會覆蓋這項殘留的未匹配請求。

## Code Mode 子呼叫樹

每個 `ToolCallBlock` 都透過 `subCalls` 按啟動順序遞迴擁有自己的子呼叫。Chat 的 Tool Definition 按 call id 關聯 root call 與 result，把 Code Dispatch 的 start/settlement 記錄摺疊進該 root Context，並投影為一棵 keyed 遞迴樹；child call 不會成為獨立 Chat root。start 落在已載入視窗之外時，其 settlement 仍以 `callTime: null` 算繪。一次 child 更新只複製其祖先鏈，因此未變化的 sibling 保持對象身份。會引入環或超過固定 256 層深度上限的邊會被消費，但不會修改樹。Trajectory 的 Tool Definition 為自己的 target 獨立組裝同一種巢狀資料契約。

## Session 標題投影

`SessionManager` 獨立於清單和 Session 實例到達情況，保留最近一次透過驗證的 `session/title` 控制快照。seq 更高的事件會替換舊快照，標題時間戳計入清單新近程度；訂閱基線會先丟棄 seq 超過其 `lastSeq` 的任何已保留標題，再接收選填的摺疊標題。顯式移除 Session 也會清除已保留標題。因此，面向用戶端的 `SessionSummary.title` 只包含實際的持久化標題；`displayTitle` 始終存在，並依次回退到 cwd basename 和 Session id。冷態持久化工作階段會保持該回退值，直到打開或復原工作階段，促使主機摺疊並投影由日誌支撐的標題。`ISession.rename` 用 unary 回應中的 `{title, seq}` 直接結帳 `title` 投影格，遵循同一 seq 高者勝規則——清單行和所有 `useProjection('title')` 讀者在推送幀到達前即更新；推送幀隨後重放同一 seq 時為無操作。

## 模型重試投影

Host 所屬的 LLM（大型語言模型）retry invariant 會在持久追加邊界驗證按提供方路由的 `llm/retry` 與 `llm/retry-started` 記錄，包括標識、順序、計時器、整數、狀態、提供方延遲和非空診斷欄位約定。用戶端的 Retry、Assistant 與 Turn Error Definition 把這些記錄和 Assistant、Turn／Step 事件一起摺疊：失敗步驟的流式輸出片段會被移除，並在 retry 事件的序列位置插入一條持久重試提示。該提示在匹配的 started 記錄到達前為 `scheduled`；如果所屬 Step 或 Turn 先關閉，則標記為 `cancelled`，started 記錄到達後則標記為 `started`。normal mode 提示攜帶其有限上限；always mode 提示保持顯式無界。沒有重試的終態 `turn/end` 錯誤會從持久訊息與選填錯誤碼投影出一個 `turn-error` 節點；AUTH 投影會把可能回顯憑據片段的提供方文案替換為 `API key is invalid`，原始診斷仍保留在工作階段日誌中。進入重試的失敗只保留該次嘗試的重試提示。視窗重建與歷史重播使用同一組 Definition，因此刷新既不會讓已丟棄的區塊重新出現，也不會丟失終態失敗回饋。可見但尚未定稿的輸出會在終態錯誤旁凍結為中斷的 Assistant 節點。

reason 為 `max-tokens` 的 `turn/end` 會在該輪位置投影出一個 `turn-max-tokens` 節點：一條 warning 樣式的本機化提示，說明回答在單次請求的輸出 token 上限處停止，已截斷的輸出保留在對話流中，並提示傳送“繼續”可在新一輪接著輸出。事件本身不攜帶 token 數量，提示因此不顯示任何數字。視窗重建與歷史重播使用同一 Definition 重建該節點，刷新和復原後結束原因保持一致。

## 工作階段 fork

`ISessions.fork({sessionId, atSeq?, increaseTitle?})` 只在子工作階段摘要已能在本機尋址後才完成；該摘要攜帶源工作階段的譜系和 cwd，且 `blank: false`，由呼叫方決定是否打開。`increaseTitle: true` 會在 client 端根據源工作階段的持久化標題重新命名子工作階段：尾部 `(N)` 或 `（N）` 遞增並保留括號樣式，其餘標題追加 ` (1)`；源工作階段沒有持久化標題時跳過改名，改名失敗時拒絕 promise 但保留已建立的子工作階段。該選項不會進入 Host fork 請求。即使回應為 `workspace-attach-failed`，其中仍會標識 Host 已發布的子工作階段，因此 `SessionManager` 會先將這一部分成功對帳，再讓 `SessionForkError` 到達呼叫方，避免重試建立重複的子工作階段。

## 工作階段模型選擇

每個常駐 `Session` 都擁有一個 `modelSelection` 快照，其中包含當前模型選擇、按提供方分組的目錄、逐提供方失敗記錄，以及 `idle`／`loading`／`ready`／`selecting`／`error` 狀態。歷史記錄會建立或刷新當前模型選擇，打開選擇器會刷新目錄；選擇失敗會保留上一次模型選擇和可用分組。目錄與選擇操作共用單調遞增的代次，因此較舊回應無法覆蓋較新的模型選擇。重連重建會復原 Host 報告的模型選擇，同時不替換未變化的選擇子結構。

## 模型體驗

無，因為工作階段對象層會選擇後續 Host 請求使用的提供方／模型路由，但不新增任何模型可見內容。

#### KV Cache 影響

更改模型選擇可能改變提供方側的快取複用，或使其失效；該包本身不會改變提示詞前綴。

## 已知限制與暫緩事項

- **`loader.unload` 是 stub**：它會拋出 not-implemented；用戶端沒有從 fiber dispose 到註冊與樣式移除的解除安裝鏈。
- **scope 拆卸由階段驅動，目前只能有一個佔用者**：已 staged 的工作階段精確跟隨 `list.current`（staging 就是打開訊號：事件視窗打開 ⟺ 工作階段位於 stage）；在 staged 狀態下被移除的工作階段，其 scope 會凍結保留，直到 stage 轉向其他工作階段，而非直到真實觀察者數量降為零。解析（`binding()`／`scope()`）只是純尋址，可安全用於算繪；算繪層經 `currentProvideInfo` observable 讀取當前 bundle。並行 pane 落地時，staged 狀態可以擴充為多 pane 清單。
- **外掛程式 bundle 從該包匯入值時必須使用 `/client` 子路徑**：裸包名不在 loader externals 表中，會內聯第二個模組實例；其私有 scope-tag Symbol 永遠無法匹配。
