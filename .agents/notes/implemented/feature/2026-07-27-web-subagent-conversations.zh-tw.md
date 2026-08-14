# Agent Note: Web subagent 目錄與使用者繼續互動

Status: implemented

[English](2026-07-27-web-subagent-conversations.md) | [简体中文](2026-07-27-web-subagent-conversations.zh.md) | 繁體中文

## 問題

由工作階段支撐的 subagent 具有持久化身份、持久化 transcript（文字記錄）與直接 child 目錄，但普通工作階段譜系無法將它們與 fork 區分開，也無法證明其描述符 mode 與繼續執行授權。否則，綁定到 agent（代理）的通用 Host 操作可能在其直接 parent 繼續執行 owner 之外復原或驅動程式 child。

瀏覽器必須遵守[可繼續 subagent 約定](../../implemented/feature/2026-07-28-continuable-subagent-conversations.md)：一個可繼續 child 在行程內最多隻能有一項 Activation，只能透過確切的存活直接 parent 接受後續工作，並將 agent inbox 用作唯一的 FIFO。查看歷史不得建立 Activation。inbox 訊息一經接受，HTTP 呼叫方既不擁有其執行過程，也不會獲得取消控制代碼。

UI 還必須保留[持久化目錄](../../implemented/feature/2026-07-22-durable-subagent-catalog-and-list-agents.md)的成員、mode 與 diagnostic。共享服務報告採用即時優先規則的語料活動狀態，而 Web 投影會將其替換為確切 child Agent driver 的 `running` 或 `inactive` 狀態。這兩種活動狀態都不是持久化結果，也不承諾繼續執行會成功。

## 決策

Web 產品透過頁頭操作公開選中工作階段中由工作階段支撐的直接 subagent。使用者可以延遲載入展開後代目錄，並在現有對話區域中打開任一 mode。one-shot child 永久只讀。可繼續 child 只有在其確切直接 parent agent 存活時才接受使用者後續訊息；否則，其持久化 transcript 仍然可讀，並附帶復原說明。

每個打開的 child 都攜帶目錄派生地址 `{ parentSessionId, childSessionId, mode }`。選擇專用歷史與提示詞傳輸的是包含 mode 的地址，而不是譜系或粗粒度 origin 標記。歷史操作會從持久化儲存讀取工作階段，而不觸發啟用。可繼續提示詞操作會呼叫 `ctx.subagents.followup()`，並在 inbox 接受訊息時以 `{ messageId }` 成功返回；它不會對進行中的輪次執行 steering（中途引導）、公開 Activation、等待完成或返回結果。

通用 Host 領域遵守同一所有權邊界。`session.history` 與 `session.fork` 的源端會讀取已附加 Session 或檢查持久化儲存，而不獲取 Agent；history 從所檢查的確切前綴歸並冷態投影值，fork 則發布一個普通的獨立工作階段。綁定到 Agent 的通用工作階段、命令與目標路由會對由工作階段支撐的 subagent 返回 `agent-busy`；顯式 id 的 `session.create` 接納與僅針對已附加工作階段的佇列控制元件亦然。拒絕分類器接受粗粒度 `origin` 標記、工作階段自身後綴中的 `subagent/descriptor`，或 parent 對其確切的存活執行時期所有權；這些訊號只會阻止通用路徑取得所有權，絕不取代目錄 mode 或直接 parent 授權。

停止一個已尋址 child 絕不回退到 `session.cancel`。`SubagentRuntime.followup()` 只負責訊息被 inbox 接受前的准入，不授予取消控制代碼；正在執行的可繼續 child 透過專用的 `subagent.interrupt` 路由停止，遵循[當前輪次中斷約定](2026-08-06-continuable-subagent-interrupt.md)，該約定會停放並保留待處理工作，而不是將其丟棄。one-shot child 在 Web 端仍不可取消。

本決策涵蓋 Web 端發現、transcript 查看與經 parent 授權的使用者繼續互動。它不會讓 subagent 成為使用者獨立所有的對象；這類產品仍然屬於[互動式 side session](../../proposed/feature/2026-07-08-interactive-side-sessions.md)。

## 設計上下文

Figma 中的 [subagent 清單](https://www.figma.com/design/jRBBK7zBgcszdVWQ0Fh5J8/Harness?node-id=383-14602&p=f)、[層級展開](https://www.figma.com/design/jRBBK7zBgcszdVWQ0Fh5J8/Harness?node-id=383-15917&p=f)與 [child 對話](https://www.figma.com/design/jRBBK7zBgcszdVWQ0Fh5J8/Harness?node-id=388-18584&p=f)畫框是非規範性的互動與視覺參考。本記錄負責生命週期、協議與失敗語義。

| 設計意圖 | 已交付約定 |
| --- | --- |
| 工作階段頁頭可打開緊湊的 child 清單。 | 觸發器會彙總僅含 subagent 的完整後代譜系；樹按服務順序顯示每個直接目錄條目，包括已停用的 diagnostic。 |
| 選擇一行會複用對話 UI。 | 已尋址歷史絕不啟用 child；只有 parent 存活的可繼續行才保留普通輸入框。 |
| 巢狀 agent 會逐層展開。 | 每行攜帶一層 `hasChildren` 快照；展開時會立即預留已知直接後代行，隨後仍只載入該行的直接目錄，並保留其自身的 parent 地址。 |
| 條目顯示 label、狀態、token 用量與活躍耗時，同時避免側邊欄條目重複。 | mode 與 `running`／`inactive` 活動狀態會同時以文字和視覺呈現；選填 title、持久化 token 用量與活躍輪次耗時來自清單保留的投影值。緊湊耗時從一天起省略更小的單位，而懸停和無障礙名稱仍保留精確的整秒數。`SessionHeader.origin` 會移除重複的導覽條目，但不授予任何能力。 |

## 產品約定

只有當完整的直接目錄空回應與工作階段摘要投影相符，二者均表明沒有已知的 subagent 後代時，纔不顯示頁頭操作。其觸發器會統計經不間斷的 `origin: 'subagent'` 譜系可達的每個已知工作階段摘要後代，在普通 fork 處停止，並在任一計入統計的後代處於 `running` 時顯示活動仍在進行。由於普通側邊欄行會隱藏 origin 為 subagent 的工作階段，Workspace 瀏覽器會在每個可見的普通行上索引同一條不間斷譜系：任何執行中的後代都會讓該行顯示藍色活動指示器，並在懸停與無障礙文字中給出確切數量，同時不會把空閒 parent 描述為正在執行。普通 fork 會開啟單獨的聚合子樹。待處理互動優先於 parent 的執行中狀態；二者無論哪一項存在都會保持為主要狀態，而後代活動則成為懸停與無障礙狀態中的第二項。兩者均不存在時，後代活動優先於未查看的完成提醒；最後一個執行中的後代停止後，該提醒會復原。每個健康的直接目錄行都攜帶讀取時的 `hasChildren` 提示，該值只根據持久化 `origin: 'subagent'` 的直接譜系 header 派生；正常的健康與 diagnostic subagent 候選都會攜帶該標記，而普通 fork 不會。該預查不讀取任何後代事件日誌，展開後仍以描述符支撐的目錄為權威依據。當摘要在該目錄尚不存在時或在一次過時的空回應後確認已有後代時，該操作會保持可見，並且在打開它以刷新目錄之前僅顯示停用的載入行；僅由摘要支撐的行絕不會提供導覽能力。UI 會在互動前就省略已知葉子節點的展開控制元件；該提示不承諾 child 會一直是葉子。已展開的直接目錄載入期間，已知譜系會為每個直接後代預留一行停用的載入行，而不會遞迴取得後代目錄。隨後樹會呈現可繼續與 one-shot 行；one-shot 的選填 label 缺失時，回退到其工作階段 id。損壞、不受支持或不可用的候選仍以停用的 diagnostic 行顯示。

`running` 表示在 Host 取樣邊界，確切 child Agent driver 正在處理工作；`inactive` 表示該 driver 空閒或不存在。UI 不會把任一值解釋為成功、失敗、取消、完成狀態或可復原性。`subagent.list` 提供當前 driver 狀態基線，`host/session-status` 會就地更新已知活動狀態，請求內重播會阻止更早發起但尚未完成的清單回應覆蓋較新的狀態轉換，`host/session-removed` 則會使已知行復原為 `inactive`；重連時會讀取新的基線。直接 subagent 的 `host/session-added` 幀會立即把任何已載入的 parent 行翻轉為 `hasChildren: true`，並使這項正向提示不被更早發起但尚未完成的目錄回應覆蓋；受影響分支打開期間，成員、label、mode、diagnostic 與權威快照仍需要透過去抖動的 `subagent.list` 刷新來更新。訊息投遞時仍以提示詞回應為權威依據。

健康行會複用清單映像檔中保留的標準工作階段投影。token 用量數值會彙總持久化日誌中四個互不重疊的 `tokenUsage` 桶。`subagentTiming` 會在每個描述符處重設，使繼承的 fork 種子不會計入 child 總量；它會累加已完成的 `turn/start` → `turn/end` 時段，並攜帶未結束輪次同一切面的 `active.since` 和 `active.through` 邊界。該輪次保持未結束期間，現有工作階段事件會推進 `active.through`；選單不會增加單獨的計時器或日誌讀取，且僅在有已知後代處於執行狀態時才推進其本機時鐘。不足一天時，選單會以整秒格式化時間；達到一天後的視覺值最多保留兩個相鄰單位，其中月份按近似 30 天計算，年份按近似 365 天計算，而懸停資訊與無障礙名稱會保留精確的天／小時／分鐘／秒耗時。對 inactive 行，選單以 `active.through` 為被中斷未結束輪次的上界，因此過時投影絕不會借用更新的工作階段元資料，且重新打開選單絕不會讓已完成工作重新計時。這兩項指標都不蘊含持久化結果語義。

選擇一行後，系統會先記錄其確切地址，再打開常駐用戶端 `Session`。歷史分頁、事件 fold、工具渲染意圖、title 與即時 mux 歸並都會複用普通對話機制。麵包屑導覽導覽使用目錄 label，只會沿 `origin: 'subagent'` 行的父連結逐級回溯，包含第一個普通 owner，並讓普通 fork 保持單層。從已尋址 subagent 建立 fork 時，會生成具有直接源譜系的普通 fork，並將其附加到最近擁有 Workspace 的祖先。目錄是一棵 ARIA 樹，支持延遲載入式 ArrowRight／ArrowLeft 展開與摺疊、線性 ArrowUp／ArrowDown 導覽、Home／End、Escape 以及焦點復原。

one-shot 行始終會用文案替代輸入框，說明執行記錄為只讀。可繼續行僅在 `parentAvailable` 為 false 且 child 未在執行時期如此；parent 離線但仍在執行的 child 保留普通輸入框，並停用其輸入區和 Send 操作，讓獨立的 Stop 保持可達，停止後只讀替代復原。parent 線上時，即使 child 正在執行，Enter 和 Send 也會准入另一個 FIFO 輪次，而獨立的 Stop 經由 `subagent.interrupt` 路由（[中斷約定](2026-08-06-continuable-subagent-interrupt.md)）。提示詞失敗會透過普通錯誤行為保留草稿。

已尋址 child 檢視表不提供綁定到 agent 的輔助控制元件。具體而言，模型選擇器與 `/model` contribution 不會呼叫普通 `session.models` 或 `session.selectModel`；Host 也會拒絕任何意外呼叫，而不是在直接 parent 繼續執行路徑之外啟用持久化 child 歷史。

## 宿主配接器與協議約定

`@deepseek-ai/dsh-host-apiproxy` 擁有瀏覽器安全的 `subagents` 域：

- `subagent.list` 接受 `parentSessionId`，呼叫 `ctx.subagents.listChildren(parentSessionId, signal)`，返回完整有序的條目以及每個健康行的布林 `hasChildren` 快照，把每個健康行的語料活動狀態替換為其確切 Agent driver 是否正在執行，並說明當前能否從 `ctx.agents` 解析出確切 parent。
- `subagent.history` 接受包含 mode 的完整地址與普通頁參數。它對照直接目錄校驗 child 與 mode，透過 `ctx.sessionQuery.readSession()` 讀取，再次檢查直接譜系，並在不發布 agent 的情況下返回普通原始事件、渲染意圖、分頁與由 Host 計算的工作階段投影基線。
- `subagent.prompt` 只接受 `mode: 'continuable'` 地址與 `ContentBlock[]`。它要求確切的存活 parent，重新校驗目錄地址，呼叫 `ctx.subagents.followup(parent, childId, content, { source, signal })`，並返回已接受的 `MessageId`。

閘道會將 parent 缺失、目錄條目缺失或為 diagnostic、child 不可復原或未授權、請求取消以及繼續執行准入暫時不可用等失敗對映為類型化 RPC 錯誤。它不會公開描述符或提供方細節。list／prompt 競態屬於正常情況：權威依據是提示詞操作的結果，而不是更早的可用性或活動快照。

查看持久化歷史本身不會建立 mux 訂閱。當後續訊息物化冷態 child Activation 時，現有 Host 與 mux 流會發布其生命週期與事件。重新連線時，系統透過 `subagent.history` 重建已尋址視窗。

普通 `session.history` 路由對於普通工作階段和 subagent 工作階段同樣只執行觀察，但它既不攜帶目錄地址，也不授予繼續執行權限。每條需要 Agent 的普通路由都會在復原冷工作階段前經過共享所有權柵欄；`session.cancel` 與 `session.updateQueue` 會直接執行同一檢查，因為它們有意只查詢已附加的 Agent。

配接器仍位於 `dsh-host-apiproxy`；`dsh-host-webserver` 仍作為載體。瀏覽器程式碼透過現有連線包匯入約定，絕不直接訪問宿主 `ctx`，從而保持 [GUI RPC 分層](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md)。

## 用戶端對象層與呈現

不相依性 React 的執行時期負責目錄、單次並行刷新、保留的地址、可用性提示、傳輸選擇，以及每個清單行當前投影值的引用穩定對映。再次選擇已知 child 時會保留其地址，避免導覽靜默切換到普通工作階段 API。缺失的中間麵包屑導覽地址可以從已載入的祖先目錄復原，但在使用者選擇該麪包屑之前不會保留為傳輸地址，也不會建立 scope。復原的導覽會持久化包含 mode 的完整地址。

目錄透過標準 `useSessions` 快照傳遞。元件區域性狀態負責選單可見性、已展開分支與焦點。`ui-conversation` 聲明通用頁頭操作清單 slot，並透過其 composer 鏈分發當前對話快照；其中沒有 subagent 專用的接管標記。`@deepseek-ai/dsh-client-ui-subagent` 註冊目錄操作，並根據普通 owner props 選擇按原因區分的只讀編輯器。元件只接收派生 props 與回呼，絕不接收 `ctx`。

每個行程內 subagent child 都會在發布前寫入 `SessionHeader.origin: 'subagent'`。工作階段清單摘要與增量 Host 幀會投影該欄位，使分組和扁平側邊欄省略重複的 child 行，同時保留普通 fork。同一條現有的 `host/session-added` 幀還會把已載入的直接 parent 行標記為可展開，而無需引入目錄事件串流。描述符 mode 與目錄校驗仍然是導覽、繼續執行和授權的權威依據。

該包現有的 `@label` source 仍然是獨立的面向模型純文字輸入。它不會將 label 解析為地址，也不會獲得繼續執行語義。

## 默認 Web 組合

已交付的 Web 組合會在 JSONL 持久化旁掛載 SQLite 工作階段查詢，並將 spawn 與 fork 後臺委派設定為可繼續模式。它還會掛載面向模型的 `send_message` 與 `list_agents` 配接器，以保持 coordinator 對等性，但 GUI 會透過宿主 RPC 域呼叫共享的 `SubagentRuntime`，而不是呼叫模型工具。one-shot child 仍在目錄中可見且只讀。

## 備選方案

**對已尋址 child 使用普通工作階段 API。** 不予採納，因為通用歷史不攜帶目錄 mode 校驗，而綁定到 Agent 的通用控制元件會有意拒絕 subagent，不會授予直接 parent 繼續執行授權。

**將配接器放入 webserver。** 不予採納，因為目錄與繼續執行是通道無關的用戶端能力；webserver 只承載已校驗的訊息。

**新建 UI 包。** 不予採納，因為 `ui-subagent` 已經負責 Web subagent 引用，也是目錄與已尋址 child 呈現的統一 owner。

**自動復原缺失的 parent。** 不予採納，因為繼續執行要求確切的存活直接 parent。child 導覽不得改變 parent 生命週期。

**公開普通取消操作。** 不予採納，因為已獲 inbox 接受的輪次會比其准入請求存續更久，且在本決定當時，繼續執行約定未公開具備安全授權的取消控制代碼。後來的[當前輪次中斷約定](2026-08-06-continuable-subagent-interrupt.md)以專用 subagent 路由補上了這項顯式授權；回退到 `session.cancel` 仍被拒絕。

**只顯示可繼續 child。** 不予採納，因為持久化目錄有意描述由工作階段支撐的兩種 mode。one-shot transcript 即使絕不接受後續訊息，仍然有用。

**根據譜系推斷 mode 或側邊欄過濾。** 不予採納，因為普通 fork 共享 `parentSession`。由描述符支撐的目錄負責提供 mode；單獨的 `origin` 標記只是低成本的導覽分類器。

**建置預先載入的遞迴樹或專用目錄流。** 就當前規模而言不予採納。僅用於頁頭的一層可展開性預查會在不讀取後代事件的情況下保證點擊前的穩定性，而展開仍是延遲載入式權威直接 child 讀取；現有 Host 幀會更新活動狀態、復原 parent 行的可展開性，並觸發有界的成員刷新。

**讓 child 在 parent 消失後仍能獨立互動。** 不予採納，因為獨立生命週期與使用者所有權需要 side session 語義。

## 測試

- 宿主協議測試固定 schema（包括必需的布林可展開性）、id 回顯、mode 校驗、非啟用式歷史、確切 parent 強制要求、FIFO 准入回執、取消與脫敏後的失敗對映。
- 通用 Host 測試固定在不發布 Agent 的情況下讀取已附加與冷態歷史及執行 fork、冷態投影歸並、按描述符／origin／執行時期 owner 拒絕、拒絕顯式 id 接納，以及直接佇列控制柵欄。
- 用戶端對象測試固定已保留與已復原的地址、one-shot 只讀與取消拒絕、歷史路由、可繼續提示詞與中斷路由、封鎖綁定到 agent 的模型控制元件、即時活動狀態翻轉（包括運送中回應重播與 detach 回退）、subagent parent 可展開性翻轉與成員刷新。
- jsdom 測試固定後代聚合計數與活動狀態、側邊欄活動在巢狀譜系中的傳播與普通 fork 邊界、行狀態優先級、token 用量總計、精確到秒的執行中耗時與凍結後 inactive 耗時、採用自適應單位的長耗時及其精確無障礙文字、目錄缺失或為過時空目錄時由摘要支撐的根操作、已知載入行的形態、混合 mode 行、點擊前的葉子展開控制元件、diagnostic、後代延遲載入展開、直接 parent 地址、鍵盤行為與兩種只讀原因。
- 無金鑰的組裝 Web 快照包含一個具有持久化 token 用量的 inactive 可繼續 child、一個具有確定性長耗時的 inactive one-shot sibling 和一個持久化 grandchild；它會固定觸發器在一次過時的空目錄回應後仍顯示三個後代，並固定 token 用量與計時行、自適應長耗時呈現及聚合 `running` 狀態轉換，在不啟用的情況下展開、打開持久化歷史、准入一條使用者 FIFO 後續訊息、歸並 child mux 事件，並證明 one-shot 歷史仍然只讀。另一個獨立的組裝場景會在 LLM seam 處保持一個真實的 child Agent 輪次進行中，同時固定頁頭和可見空閒 owner 行中的聚合執行狀態，隨後在 teardown 期間取消該輪次。
- 導覽測試固定僅含 subagent 的麵包屑導覽導覽、從 subagent 建立 fork 時的 Workspace 歸屬，以及 `origin: 'subagent'` 側邊欄過濾，同時不隱藏普通 fork。

## 後果

- 目錄讀取可能重新掃描持久化譜系與每個直接候選的描述符日誌，但可展開性只複用該追蹤中已有的後代 header；Web 活動基線會為每個健康行增加一次 Agent 登錄檔尋找，隨後使用現有即時幀，而 token 用量與耗時會複用投影基線和推送，無需按行讀取日誌，成員刷新則保持去抖動和單次並行。
- parent 可用性、child 活動狀態與 `hasChildren` 都是快照。列出之後，發布、dispose（資源釋放）、其他傳送方或其他行程都可能搶先改變狀態；類型化提示詞失敗仍屬預期行為。
- child 可能在歷史取得與 mux 訂閱之間發布，因此現有序號歸並也涵蓋從冷態轉為存活的已尋址路徑。
- 持久化 origin 會為 child header 與清單投影新增一個有意保持弱約束的產品分類欄位；它不能變成授權捷徑。
- 除對正在執行的可繼續 child 的當前輪次 Stop（[中斷約定](2026-08-06-continuable-subagent-interrupt.md)）之外，UI 不提供 child 取消、持久化結果、Activation 身份、刪除或可獨立互動的離線 mode，其文案不得暗示這些能力已經存在。活躍輪次耗時度量的是已記錄工作，而非 Activation 駐留時間。
