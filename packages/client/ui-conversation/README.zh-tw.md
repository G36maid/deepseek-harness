# @deepseek-ai/dsh-client-ui-conversation

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

工作階段領域：骨架（標題欄／分頁標籤／編輯器／空狀態）、聊天檢視表（分組步驟摘要流、流式尾部隔離與輪次狀態）、編輯器 dock（與輸入區一同 sticky 的工作階段統計行）、輸入區 dock（佇列行加 todo 計畫條）、詳情殼層，以及按 scope 尋址的 ConversationController。工具展示屬於 [`ui-tool`](../ui-tool/README.md)。

壓縮（compaction）在檢查點自身的訊息流位置渲染為一行摺疊標記，不替換其上方的 transcript（文字記錄）。自動壓縮使用「上下文已壓縮」標題。每個已載入對應 `compaction/summary` 事件的完成標記都會顯示被替換條目數量和估算 token 數量，並可點擊展開摘要。手動 `/compact` 開始時顯示為執行中的 `compact` 行；成功結帳後，其顯式摘要事件引用會在保持同一 React key 的前提下把該命令摺疊進檢查點行。完成的檢查點靜止時保留上下文壓縮（context compaction）圖示，僅在懸停或鍵盤聚焦時將其替換為收起／展開指示圖示。輸入被拒絕、沒有可壓縮歷史、取消和失敗時仍使用通用命令列及處理器撰寫的文字。配對絕不相依性相鄰關係，因為壓縮執行期間可能注入持久上下文。面向模型的帶框檢查點載荷絕不渲染；被引用的 `compaction/summary` 事件位於已載入視窗之外時，檢查點仍然可見但不可展開。

常駐工作階段殼會跨無工作階段與工作階段狀態切換而保留。沒有當前工作階段時，它會鎖定訊息操作，並讓整張虛線編輯器卡片成為根作用域 `conversation.hero.workspace` Workspace picker 的入口；textarea 保持只讀且支持鍵盤操作。選擇 Workspace 會連線或複用由 Host 擁有的空白工作階段，並在不替換工作階段殼的情況下打開該工作階段。根元件始終擁有同一個滾動容器與 Hero／編輯器子樹；首個工作階段到達時，彼此獨立的嚴格工作階段頁頭和主體 outlet 只填入各自區域，因此 Workspace picker、滾動主體、編輯器 seat 與 textarea 都保留原有 React 和 DOM identity。空白工作階段與活躍工作階段渲染相同的輸入區主體；InputHub 則在 Workspace 切換間攜帶草稿，並將草稿映像檔到工作階段 store。活躍階段，工作階段標題欄作為普通列 chrome，僅顯示當前工作階段標題和檢視表標籤；fork 譜系仍保留為工作階段資料，不投影到標題欄。其下滾動容器（`data-conversation-scroll`）承載流動排版的各檢視表與 sticky 編輯器棧（統計 dock＋輸入區 dock＋輸入欄）。該滾動容器無條件預留自己的捲軸槽，選用編輯器 overlay 的檢視表也仍把它保留為滾動容器，因此無論對話記錄是否滾動、無論展示哪個檢視表標籤，輸入卡片都保持同一個橫向位置（[決策](../../../.agents/notes/implemented/bug-fix/2026-08-04-composer-tab-gutter-reservation.md)）。textarea 上的滾輪會鏈式處理：限高草稿先在本機滾動，到達邊緣後再轉交給該宿主。

別的外掛程式可以經 `ctx.conversation.blocks` 讓某個工作階段的編輯器變為惰性：它設定一個攜帶自己本機化理由的 block，輸入欄就渲染同一個停用的 textarea，並把該理由作為 placeholder——複用無 Workspace 時的那套姿態。推送方向是約束而非偏好：知道某工作階段發不出訊息的外掛程式（ui-model-selection，在沒有配接器服務其路由時）本就相依性本包，因此本包讀不到它們。模型 seat 是 block 唯一保留可用的控制元件——這份約定裡的每個 block 都靠選模型來解除，把它一起鎖上會讓編輯器索要它自己攔下的那件事。block 只是提示性設計；無論用戶端停用了什麼，宿主都會拒絕一個它無法路由的提示詞。兩者同時成立時以無 Workspace 姿態為準，因為選 Workspace 是更靠前的前提。

檢視表環是一個 slot：嚴格工作階段主體註冊在 `children` 表中聲明工作階段作用域的 `'conversation.view'` 清單，並透過自身的 renderSlot share 渲染活躍設定項（`only: <active id>`）；檢視表分頁標籤則從註冊選項（`id`／`order`／`label`）投影而來。聊天檢視表是該包自身的設定項；ui-trajectory 等外掛程式透過 `ctx.slots.register` 貢獻分頁標籤，每個檢視表負責自己的 chrome。

Chat 業務行是彼此獨立的登錄檔貢獻，不是封閉的內建聯合。Client 外掛程式透過 declaration merging 增加類型化 `ChatNodeDataMap` key，在 `ctx.conversationEvents` 上註冊 `ConversationNodeDefinition`，再向 `conversation.chat.node` 註冊匹配的 keyed renderer；它無須修改工作階段 fold 或中央 renderer switch。穩定事件 id、append/prepend 重播、Location data 與 renderer 約束見 [Conversation Node 實作手冊](../../../docs/cookbook/adding-a-conversation-node.md)。

工作階段頁頭會在標題旁渲染工作階段作用域的 `'conversation.session.header.actions'` 清單，並在最右側渲染獨立的 `'conversation.session.header.utilities'` 清單。工作階段上下文和譜系控制元件保留在 `actions` 中；選填的工作階段工具不會改變它們的順序或位置。編輯器鏈的 currency 包含當前對話 `session`；ui-subagent 會選取 one-shot 或 parent 不可用的已尋址工作階段，並按原因顯示只讀文案，而普通 InputBar 會讓所有已尋址 child 僅保留 Send，因為繼續執行服務不公開逐 Activation 取消操作，`session.cancel` 也會繞過其所有權。

已記錄的非使用者訊息渲染為默認摺疊的展開項，標題欄先給出執行時期為該訊息投影出的角色——注入為 `上下文注入`，召回為 `跨会话召回`——其後是該投影從持久來源讀出的生產者名稱，因此讀者無需展開即可區分 skill（技能）目錄、工作區指令文件與被召回的工作階段。來源未提供生產者名稱時只顯示角色。共享的 `DisclosureRow` 原子元件讓該上下文介面與訊息流中的其他緊湊行保持相同幾何，同時保留上下文語義：展開內容區的高度會隨內容自適應，最大為 141px，超出後滾動，且不會合成工具狀態或摘要（[歷史展開項決策](../../../.agents/notes/archived/feature/2026-07-30-web-context-injection-disclosure.md)、[生產者標籤決策](../../../.agents/notes/implemented/feature/2026-08-04-web-context-source-and-steer-marks.md)）。該內容區按生產方在持久來源上聲明的形態渲染：`instructions` 在正文之上列出它對帳過的文件，`catalog` 列出來源記錄的條目而非面向模型的正文，其餘取值——未聲明、本版本不認識、或欄位不可用——一律渲染 opaque 內容區，即按真實換行展示面向模型的文字，並把剩餘來源欄位列出。opaque 不是兜底剩餘物而是有文件的默認：復原的、fork 的、外部寫入的日誌，無論其生產方是否掛載在此處，都必須渲染得出來。持久或待處理的 steering（中途引導）氣泡沿用使用者氣泡的呈現，不加任何裝飾；transcript 中唯一的 steering 訊號是它出現在輪次中途的位置。

Think 行默認保持摺疊，並在不展開思維鏈的情況下暴露即時推理（reasoning）吞吐：當推理塊是流式輸出尾部時，摘要從結帳後的首行切換到最新的非空行，其單行滾動區會隨每個 delta 追到行內末端。展開該行會移除移動摘要，讓完整推理進入普通頁面流，因此頁面閱讀不會與內部跟隨器爭奪滾動；結帳後復原靠左對齊的穩定首行摘要（[決策](../../../.agents/notes/implemented/feature/2026-08-02-web-thinking-tail-scroll.md)）。

聊天檢視表保留工具的訊息流位置，但委託其展示。每個已排序的 `tool-call` Conversation Node 都透過 `conversation.chat.node` 的同名 key 分發；詳情殼層則透過 `conversation.details.tool` 傳遞當前選中的呼叫。組裝後的 Web bundle 為該 Chat Node key 註冊 [`ui-tool`](../ui-tool/README.md)，由後者渲染執行時期已投影的遞迴 root/child 樹，並負責按名稱分發、通用展示和 render-intent 卡片；只有詳情席位會在該 renderer 缺席時保留 raw-result fallback。

聊天流會將跨重試輪次連續出現的模型重試節點投影為一個穩定的弱化狀態行，並用最新一次嘗試更新該行；每個重試事件仍保留在執行時期快照與工作階段日誌中。前端倒計時以用戶端收到事件的時刻為計畫延遲的起點，避免 Host 與瀏覽器的時鐘偏差；剩餘時間向上取整到秒，且下限為 1 秒。最近一次尚未完成的重試會顯示從左到右的文字漸變動畫。後續輪次事實用於區分已開始的嘗試與在退避期間取消的嘗試，Host 的 running 位只控制即時動畫；隨後該行會顯示靜態的已完成或已取消標籤。normal 策略行顯示有限重試上限；always 策略行顯示 `∞`。啟用該行會顯示最近一次重試的精確延遲和失敗訊息。用戶端執行時期會在相應重試節點到達前移除每個失敗步驟的流式輸出尾部；後續某次嘗試成功後，該狀態仍保持可見。未進入重試的終態失敗會在其輪次邊界渲染為持久的內聯狀態，展示適合顯示的持久訊息與選填錯誤碼，但不會提供 Host 無法兌現的操作；AUTH 文案絕不會回顯提供方給出的憑據片段。

審批透過本包聲明的鏈條接管編輯器：`ApprovalPanel` 註冊為按選擇器路由的 `'conversation.composer'` 設定項（ui-user-questions 模式），在審批等待未決期間取代 InputBar 佔據編輯器（琥珀色條、理由標題、來自執行中呼叫參數的配對命令列、一次性的拒絕／允許）。`contract/slots.ts` 中的 `PendingApproval` 領域面在執行時期 `PendingWait` 載體之上擁有 wire 編碼——帶審計關聯的 `ApprovalResponsePayload` 值；廣播的 `approval/resolved` 幀使等待落定並復原編輯器。執行時期 manager 會將所有審批或問題等待透過 `SessionSummary.pendingInteraction` 投影出來，未實例化的工作階段也不例外；`ui-workspace` 負責其側邊欄呈現。未決等待完全離開訊息流：問題（ui-user-questions）與審批（ApprovalPanel）都經編輯器接管作答，不再保留只讀佔位卡。編輯器底行的 Access 席位掛載 `PermissionSelect`，由 host 計算的 `permissions` 投影經標準工具包 `useProjection` 供數（key 缺席即隱藏 chip）；chip 打開 Menu 原語下拉，其中 kebab-case 預設名渲染為 Title Case 標籤；普通安全預設會立即經輸入欄注入的 `command` 回呼提交 `/permission <preset>`，而 `danger-full-access` 在介面中顯示為 `Full access`，選擇後先打開頁面內的 Modal 風險確認。使用者勾選確認項前啟用按鈕始終不可用；取消、Escape、關閉按鈕與點擊遮罩都不會提交命令。

`TodoDock` 以 `order: 0` 佔用 `'conversation.input.dock'` 清單 slot（位於 Goal 與 Queue 之前），作為計畫條讀取 host 計算的 `todos` 投影（當前計畫：其後沒有更晚 `turn/start` 的最近一次 `todo/write`）並渲染 `TodoPanel`。面板接收純清單，清單為空時自我隱藏；清單非空時默認摺疊，表頭顯示標題及以 `·` 連線的各狀態計數（如 `1 已完成 · 2 进行中 · 1 待处理`，省略零計數）。dock adapter 擁有 selection，因此面板保持為 props 的純函式。輸入區 composer 鏈隱藏的一切也會隱藏整個 dock。`todo_write` 工具行屬於 [`ui-tool`](../ui-tool/README.md)。

`QueueDock` 是 `order: 20` 的末端 input-dock 條目。佇列為空時隱藏；只有一個待處理項時直接渲染該行；存在兩個或更多待處理項時，默認收起為 `"<n> 条排队消息"` 表頭，其按鈕可展開或收起完整清單。表頭暴露 `aria-expanded` 和 `aria-controls`；展開後的清單以 180px 為高度上限，並可滾動。存在進行中的編輯或變更時，清單行會保持可見；佇列清空後，下一次出現佇列時會復原默認收起狀態。普通工作階段中的每條可見行仍是單行預覽，並提供針對精確單次入隊項的編輯、刪除和嚴格 steering 操作；已尋址 subagent 則保留只讀行，因為其繼續執行傳輸不提供 Queue 變更。如果嚴格 steering 輸給已關閉的視窗，原單次入隊項會留在 Queue 中正常投遞；如果驅動器已經認領該項，正常投遞就已開始。這兩種已收斂的競態都不顯示失敗，傳輸和未知錯誤仍會顯示。

Host 帶 placement 的 `session/queue` 快照也會攜帶待處理 steering。QueueDock 會將其過濾掉，ChatView 則把它投影為工作階段流末尾帶複製操作的使用者樣式氣泡；非使用者來源的 next-step 項（注入上下文）改以 `context` placement 廣播，領取前不在任何介面渲染。與所有使用者樣式氣泡一樣，這裡不顯示 fork。Host 會等攜帶該 steering 的持久 `user/message` 進入 mux 流之後再退役 steering。用戶端執行時期接納該即時事件時，會在發布快照前退役第一個匹配的當前 steering 單次入隊項；歷史事件無法隱藏後來複用同一 `MessageId` 的單次入隊項。氣泡交接時因而不會產生空檔或重複，會立即從持久節點復原複製操作與時鐘——steering 氣泡與 user 氣泡一樣不帶分支操作（[決策](../../../.agents/notes/implemented/simplification/2026-08-06-user-bubbles-drop-the-branch-action.md)）——並能在重連後從同一權威復原。

鍵盤訊息提交會根據所尋址工作階段的執行狀態和 steering 能力解析投遞方式。空閒時，Enter 和 Cmd/Ctrl+Enter 都執行普通 Queue 傳送。主工作階段執行期間，由 Host settings 支撐的 `ui-conversation.busyEnter` General Settings 偏好會把普通 Enter 分配為 `Queue`（預設值）或 `Steer`，Cmd/Ctrl+Enter 則執行另一種行為；本機 settings 提供方將其存入 `$DSH_HOME/settings.yaml`，因此該選擇會跟隨同一個使用者 home 跨越 Web 埠。Shift+Enter 仍然換行。草稿為空時，Cmd/Ctrl+Enter 改為按 FIFO 順序把仍在排隊的訊息全部插話進執行中的輪次（把 dock 的逐條嚴格 steer 操作應用於整個佇列）；空草稿 + 普通 Enter 仍是無操作。這個整佇列手勢可用時，文字方塊 placeholder 會提示該手勢；owner 提供的 placeholder 仍然優先。已尋址 subagent 即使正在執行，也會讓這兩個手勢都使用其僅支持 Queue 的繼續執行傳輸。該偏好隻影響支持 steering 的繁忙態手勢對，傳送按鈕與非鍵盤提交操作仍使用 Queue。Composer Steer 複用現有盡力而為的 `session.prompt(mode: 'steer')` 約定：如果當前 next-step 視窗在接納前關閉，AgentLoop 會把訊息接納為下一條喚醒 Queue 輪次，不顯示失敗，也不會丟失草稿交易。該持久化邊界由[Host settings 支撐的偏好決策](../../../.agents/notes/implemented/bug-fix/2026-08-06-host-backed-web-preferences.md)擁有。

逐工作階段 UI 狀態中的選擇與活躍檢視表位於已聲明的聊天 store（`stores.ts` `createChatStore`）中；InputHub 擁有輸入區狀態機，並將草稿映像檔到該 store 以便持久化。apply 將同一個 store handle 傳給嚴格限定於工作階段的子樹、聊天檢視表和詳情註冊，因此每個工作階段內共享一個實例，框架擁有其生命週期。元件保持純粹：框架標準工具包提供 `useSession`／`sessionId`、全域性 `useSessions`／`useWorkspaces`，以及輸入狀態機的 `useInput`／`inputActions`；store 表層與 inject factory 提供其餘狀態和回呼。

圖片經貼上與整頁拖放進入：輸入欄綁定 document 級拖拽監聽（composer-bar slot 為 `kind: 'single'`，同一時刻至多一個 bar 綁定），文件拖拽懸停視窗時顯示 `DropOverlay` 原子元件——純文字拖拽不受影響，鎖定或忙碌的 composer 顯示停用遮罩並拒絕 drop。兩種手勢共用一條對宿主 `imageLimits` 投影的加入預檢（數量、單圖位元組、總位元組）：會突破上限的加入整批拒收，立刻彈出點名上限的橫幅，完全不進入附件欄。仍然到達的宿主側拒絕按 `attachment-error` 原因對映為產品文案（`image-labels.ts` 的 `attachmentErrorText`）；使用者無法解決的原因摺疊為一條帶原因碼的傳送失敗文案，非附件錯誤碼保留開發者可讀的原文加錯誤碼。

輸入欄為 `'conversation.input.plan'`（位於本機 access 模式控制元件右側）和 `'conversation.input.model'`（渲染在 pending 指示器與傳送／停止控制元件之前）聲明工作階段作用域的單實例 seat，並為 overlay、dock、left 和 right 輸入擴充聲明清單 slot。各功能包擁有相應控制元件及其狀態；ui-conversation 提供放置位置、`locked` owner prop 和標準 slot share。前置加號按鈕是 Command launcher，而非附件入口：它要求當前工作階段的 `InputTriggerController` 基於 textarea 當前 selection，只打開 `/` trigger 的 `command` source，同時 ui-input-trigger 既有的 `MenuView` 仍是唯一的浮層選單與 pick 路徑。不引入 File 行、file input、上傳協議或第二套選單元件。當 `plan` 投影的有效目標為 plan mode 時，InputBar 將文字方塊 placeholder 切換為 plan 任務措辭，經本包註冊的 `conversation` locale 命名空間（`placeholder.plan` / `hint.plan` 鍵）本機化，並與已認領 `/plan` 命令的提示逐字共用同一份文案（經標準套件 `useProjection` 讀取的 host 摺疊值；owner 提供的 placeholder 優先）。另一個工作階段檢視表活躍時，待處理的 composer 接管仍保持掛載，使被阻塞的 agent（代理）仍能收到回答；沒有待處理互動時，活躍工作階段的 composer 歸 Chat 所有。composer bar slot 本身為 `session-maybe`：沒有當前工作階段時，同一個 bar 會讓訊息操作保持不可互動（machine face 均缺席、`disabled` owner prop），整張虛線卡片可經指針打開現有 Workspace picker，只讀 textarea 也可透過 Enter 或 Space 打開。停用控制元件會把指針事件交給卡片，卡片也會攔下 `pointerdown`，避免已打開 picker 的外點關閉與重新打開發生競態。它不會換入一棵平行樹，因此選擇 Workspace 時 textarea DOM 不會被銷毀；嚴格工作階段作用域的控制元件 seat 在工作階段存在之前保持為空。

聊天統計行的 token 帳目來自經標準套件 `useProjection` 讀取的通用 token-meter 投影 `tokenUsage`：計費輸入為未快取輸入、快取讀取與快取寫入之和；快取命中率以快取讀取除以該總量。輪次與步驟計數、LLM（大型語言模型）與工具牆鐘時間、以及延遲／吞吐分組都來自全日誌的 `sessionStats` 投影（Host 端從步邊界、首 token chunk、工具配對與已組裝訊息折算），因此分頁與壓縮都無法改變統計條的任何數字；未組合該單元的裝配回退為對可見節點做視窗折算，其欄位與投影一一對應。統計條把每個有完整記錄的步驟的 TTFT（首 token 延遲）取平均，並用取樣到的輸出 token 數除以其解碼時長之和，得到經 `conversation` locale 命名空間本機化的延遲／吞吐分組（中文為 `首 token 平均 … · … tok/s`）；缺少某個 timing 邊界或 usage 取樣的步驟會直接退出這些數字，而不是讓它們失真；壓縮（compaction）使已載入視窗不再包含 assistant 節點時，持久計數、token 與上下文分組仍保持可見。輪次計數、步驟計數、耗時、快取與 token 各項的標籤也使用同一命名空間。每個已結帳輪次還會在其 assistant footer 的 `用时` 之後追加 hover 才顯示的 `首 token {s}秒 · {tps} tok/s` 標籤——即該輪次首個步驟的 TTFT 與輪次聚合的解碼吞吐——僅當該輪次的 timing 位於已載入視窗內才顯示（視窗是日誌的連續後綴，因此視窗內的輪次必然帶著它的全部步驟），未記錄的數字會各自省略。未組合 token-meter 的部署會整組省略 token 分組；統計行過長時以省略號截斷，僅在內容真的被裁切時由延遲 hover tooltip 承載完整文字。上下文佔用率渲染為 composer 尾部的 ContextMeter：模型座位之後的一枚 14px 佔用圓環，由 `contextPressure` 供數，僅當分子與路由容量都已知時才渲染；點擊彈出的面板把「已用百分比」標題與 `~已用 / 容量` 數字，與來自 `contextBreakdown` 投影、帶 `~` 前綴的啟發式組成明細行（系統提示詞、工具、對話訊息）及分色分段進度列並列。圓環與標題讀取 `projectedTokens`——把提供方樣本沿此後表層的增減推進到當下——因此壓縮會立刻反映出來，而不必再等一整輪；組成明細行仍是純啟發式，因此加起來依然不等於標題數字（[原理](../../llm/token-meter/README.md)）。佔用率是刻意為之的近似值：分子與容量是兩個相互獨立的「後寫覆蓋」投影欄位，並非同一次請求的原子觀測。

`src/client/` 按領域組織。`contract/` 是 slot 聲明、組合 props 與跨領域類型的共享表層；`skeleton/`、`chat/`、`input/`、`queue/` 和 `settings/` 保持內部實作，`apply.ts` 是它們的組裝點。`/client` 匯出表層只包含 loader entry、service class 和 contract 類型；元件與 store factory 經 slot 註冊抵達頁面。

完成的一輪會物化一個有序的 `turn-tail` Conversation Node。它由引擎維護的 `TurnLocation` 提供收尾 Assistant 和 Turn data；renderer 在該 Node 的 IconActions 之前渲染 `conversation.chat.turnTail` chain，並派發包含 Turn、收尾 seq 和 `openFile` 的 `TurnTailOwnerProps`。本包只擁有空位；`@deepseek-ai/dsh-client-ui-deliverables` 把改寫工具的 `locations` 累積到 Turn data，並擁有產物行、chip 上限和文案，因此把該外掛程式從 cordis.yml 中組合掉即可關閉該互動面，空位以零成本渲染為空。收尾正文經由同一個開關參與其中：chat 檢視表向選填的 `chatFileMentions` service（ctx.get；由同一外掛程式提供）索取收尾訊息的行內程式碼詞表，並把結果接進 MarkdownText 的 `fileMentions` seam——service 缺席時正文保持死文字。

## 模型體驗

無。工作階段 UI 在瀏覽器中渲染工作階段歷史與流；這裡沒有任何內容進入模型請求。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **統計行的回退折算只覆蓋視窗內訊息流**：未組合 `sessionStats` 投影單元的裝配中，所有數字由快照的 assistant `timing` 與工具 call/result 配對折算，落在已載入事件視窗之外的節點（更早的歷史）不計入，數字隨載入頁數成長。
- **詳情面板沒有入口**：`ChatViewInjected.openDetails` 雖已實作卻無人呼叫，因此以原始形式顯示已選擇呼叫的那部分在組裝後的應用中不可達。沒有 Input/Output/Metadata 切換、Prev/Next 步進，也沒有 trajectory 深連結。
- **assistant 逐訊息分頁是預留 slot**：設計中已有圖稿，尚未實作。已定稿的內容 IconActions 行（複製／時鐘／分支）只掛在每個已結束輪次中最後一條帶 text 內容的 assistant 下；輪次中間的敘述、純 Think 節點，以及仍在產出步驟的輪次裡的所有節點都不帶 chrome。除非該訊息同時也是已完成輪次的最後一個 transcript 節點，否則分支保持停用；啟用後，它會 fork 到該輪次末尾，在 client 端遞增繼承標題並打開子工作階段。fork 或改名失敗時源工作階段保持選中（[決策](../../../.agents/notes/implemented/bug-fix/2026-08-02-message-fork-actions-require-completed-turn-tail.md)）。
- **已傳送的 user 訊息無法編輯**：user 氣泡保留時鐘和複製；分支只存在於 assistant 回答之下（[決策](../../../.agents/notes/implemented/simplification/2026-08-06-user-bubbles-drop-the-branch-action.md)）。編輯功能要與其背後的能力一起回歸：既需要針對已定稿 user 訊息的 client 變更，也需要 host 側對已經消費過它的輪次給出行為（[決策](../../../.agents/notes/implemented/simplification/2026-07-31-drop-user-message-edit-stub.md)）。
- **others 工具行的閃光圖示是手繪近似版本**：無法在本機匯出設計字形的向量幾何；等到存在精確匯出後再將其提升到 ui-primitives。
- **審批面板的「始終允許此類」暫緩**：持久授權需要授權儲存設計；今天只能回答允許一次／拒絕。
- **TodoPanel 將過長條目截成單行省略號**：figma 條沒有換行或展開入口，完整文字無法在行內讀完。
- **Queue 編輯僅支持文字**：包含非文字塊的行仍顯示扁平化預覽，但由於內聯編輯器無法保留這些塊，其編輯控制元件會被停用。文字行進入編輯模式後，刪除和嚴格 steering 操作會被保存和取消取代；Enter 保存，Escape 取消。
- **Queue 嚴格 steering 會保留完整訊息**：agent 執行期間，steering 操作會以原子方式把所尋址的 Queue 單次入隊項轉移到當前 next-step 視窗。包含混合內容的行仍可使用此操作，因為它會轉發不可變訊息，而非文字投影。帶 placement 的 Host 快照會在工作階段流末尾渲染待處理 steering，直到已消費的 `user/message` 摺疊進持久 transcript（文字記錄），因此立即展示、重連和重播共享同一個線性權威。
