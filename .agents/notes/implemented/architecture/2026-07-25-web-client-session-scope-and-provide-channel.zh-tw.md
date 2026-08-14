# Agent Note: Web client Agent-scope 對等模型與供數通道（agents/scope / blank 複用 / provide）

Status: implemented

[English](2026-07-25-web-client-session-scope-and-provide-channel.md) | [简体中文](2026-07-25-web-client-session-scope-and-provide-channel.zh.md) | 繁體中文

> 範圍：client Agent scope（actx）與定向事件、client/host 實體化對等模型、空工作階段 blank 位與複用（`connectWorkspace`）、逐工作階段供數通道（`sessions.provide`），以及承載這些能力的 host wire 小件（summary `blank` 列、`host/session-added` 幀欄位、`host/commands-changed` 幀）。輸入狀態機與 slash 管線見[輸入狀態機 note](2026-07-25-web-input-machine-and-slash-pipeline.md)；命令業務面見[命令業務面 note](2026-07-25-web-command-surfaces-and-assembly.md)。

## 問題

web client 只有一張全域性工作階段面：slot 全部從根上下文渲染，外掛程式拿不到「當前是哪個 agent/工作階段」的語境；draft 的權威副本埋在 Session 對象裡，任何要參與輸入的外掛程式都無處下手。要支撐命令/輸入體系，平臺層必須先回答：

- 工作階段互動態（選單、popup、草稿、運送中請求）歸誰持有，雙工作階段如何結構性隔離；
- 「新工作階段」在 host 實體存在之前是什麼——client 是否必須為它憑空建立獨立生命週期；
- 工作階段 scope 元件如何「自己拿工作階段資料」，而不是層層下傳 props；
- 使用者放棄的新工作階段在 host 側留下什麼，由誰回收。

硬約束：host 是唯一真源；一切註冊走 `ctx.effect` disposer；scope 機制與 host 的 Agent scope 架構一致；模型可見 ⟺ 已入工作階段日誌。

## 決策

### 對等模型：client 與 host 同一根狀態軸

host 側 `session.create(workspaceId)` 一體產出 Session + Agent + cwd（作為不可拆分的原子整體）；client 側就是這次出生的映像檔——工作階段行進入 list mirror 的瞬間，client 為它鑄 Agent scope（actx + provide + 輸入面全套掛上）：

- 工作階段身份自出生即為 host 真身：sessionId 由 `session.create` 回應 / `host/session-added` 幀帶來，client 側一切尋址（scope tag、slot store 鍵、RPC 地址）用的都是同一個 id。
- 實體化時點 = 使用者選定 Workspace（cwd 確定）的瞬間：client 當場調 `session.create({workspaceId})`，拿到完整實體。
- 「New Session 且未選 workspace」是**純檢視表態**（一個導覽位置），不對應任何工作階段/scope 實體；選定之前 composer 整體鎖死（無 slash、無純文字）。
- 「空工作階段」就是一個日誌還空著的普通實體化工作階段；對 host 上所有 Agent-scope 外掛程式（goal/plan/skill（技能）/…）它與任何工作階段無異，slash/plan 天然全活。

### Agent scope：actx 是 client 側 cordis 世界的唯一工作階段載體

執行時期 `agents/scope.ts` 與 host `dsh-scope` 機制層一致（fiber + tag + filter 過濾；不 value-import：host 包攜帶 scoped-events 的 `Events` merge，進 client program 撞 Context merge）：

- `createScope(ctx, key)`：no-op 外掛程式 fiber + `extend({[kScope]: key, [Context.filter]: …})`——filter 直接住 actx：untagged listener 全域性可收，tagged 只收本 scope。
- 派發就是 cordis 原語，thisArg = actx 本身：`actx.bail(actx, event, req)` / `actx.emit(actx, event, payload)`。
- `Session.bindScope(actx)`：resolve 鑄 scope 時單次配對（重複綁 throw；dropScope unbind），映像檔 host `Agent.loopCtx`——Session 用它自行派發 scoped 事件。actx→Session 反向走 `sessions.sessionOf(actx)` 一跳（映像檔 host 外掛程式 `agent.session` 用法）。

與 host dsh-scope 的有意分歧三條：

- filter 住 actx 自身而非獨立 carrier：host 包裝層護的是「業務 Agent subject 與 scope key 不漂移」（host 事件首參注入 Agent 本體），client 事件 payload 只帶 id、無 subject 可護。
- key 用品牌 `SessionId` 值比較而非對象身份：host 裡 agent.id === 工作階段 id（1:1 同軸），agent 身份直接複用 `SessionId` 品牌，client scope 的身份即 wire id。
- client 是 **Agent 身份** scope 而非活對象 scope：cold 工作階段期 host Agent 對象已 dispose（資源釋放）而 client actx 存活（視野內）——身份軸嚴格對等、對象冷熱有意不同步。

id→ctx 換乘只許三類位置（業務提供方永不換乘）：

- slot inject 工廠：ctx 不進渲染層，slot 框架交給元件的身份就是 sessionId，經服務 map 換回對象/controller。
- root 協調服務自尋址：從投影的 sessionId 經 `sessions.scope(id)` 找回 actx。
- root untagged listener：按 payload 的 sessionId 查自有 store。

### scope 生命週期：掛靠 list mirror，出生即視野、死亡即 prune

Session 實例與 scope 同生命週期，存活資格 = host listed（一個判據，mint 與 prune 共用）：

- 出生 = 工作階段行進入 client 視野（list 基線拉取 / `create()` 本機回聲 / `host/session-added` 幀），lazy 首次 resolve 鑄 scope（resolution 純函式、渲染安全）。
- prune 一次同拆三樣：Session 實例、scope fiber（級聯掛在 actx 上的一切消費端）、工作階段鍵控 slot store。暫存工作階段（= `list.current`）例外：被移除仍在臺上時保留凍結只讀檢視表，stage 移走才拆。
- 重開 = lazy 重建實例 + `open()` 拉 history（host 工作階段日誌是持久真相）。
- 殘留 TODO：approval/question 幀不進 history，跨 prune 不可復原（manager 級 pendingBuffers 只覆蓋「從未實例化」視窗）。

### blank 位：空工作階段的可見投影、轉正與複用

「實體化但無首條提示詞」的工作階段經 summary 派生位 `blank` 治理（派生列而非 header 欄位，SessionHeader 保持不可變）：

- host 判據：`session.events.length === 0`（零日誌事件 = 尚無使用者訊息）。live 工作階段 `summarize()` 記憶體直讀；cold 工作階段恆 `false`——lazy-create 約定保證 never-appended 工作階段根本不進 `persistence.list()`（JSONL/SQLite 兩後端均已實證真 lazy），blank 從不落盤。
- wire 承載兩處：`SessionSummary.blank` 必填列；`host/session-added` 幀必填 `blank` 欄位（建立時恆 true，供別的 tab 按同一空工作階段狀態入映像檔）。
- client 映像檔只降不升（單調），三來源翻轉，全部複用既有 wire 訊號：
  - 傳送方本機：首次 `prompt()` 的**成功回應**翻 false（受理即證明使用者訊息已入 host 日誌——此點翻轉是確證而非樂觀；`onEngaged` 同步更新清單映像檔，當前 `New Session` 行原地轉為普通標題，不新增清單行）。首條提示詞被拒則工作階段保持 blank：與 host 權威對齊、繼續顯示為 `New Session`、在仍為該工作區成員時保持 connectWorkspace 複用資格。
  - 其他端：`host/session-status (running:true)` 幀翻轉——blank 工作階段從不 running，首次 running 必然已非 blank；
  - 重連對齊：`session.list` 的 summary.blank 是權威，錯過幀的端下次拉取自然對齊；過時的 blank:true 不能把已轉正的工作階段重新標回 blank。
- 清單紀律：store 保留全部行；Workspace browser 的分組、平鋪、搜尋和計數共用同一可見投影——所有非 blank 工作階段都顯示，blank 工作階段只顯示 `session.id === sessions.current` 的一條，並強制標題為 `New Session`。切換 Workspace 後，舊 blank 實體仍在映像檔中但從清單隱藏，目標 Workspace 的 current blank 顯示；因此使用者可見面全域性至多一條 blank 行。
- 殘留帳零 GC：刷新後 blank 工作階段帶位回來，下次同 workspace 且仍為成員時複用，普通單端路徑使每個 workspace 至多保留一個；host 重新啟動後 blank 無盤痕自然蒸發；多 tab 競態多出的空殼只會成為非 current 隱藏行，後續複用消化，不做協調。

### connectWorkspace：New Session 的唯一入口

`workspaces.connectWorkspace(workspaceId): Promise<SessionId>`（歸屬 WorkspaceRuntime——它同時持有 workspace 規範 path 與 sessions 引用）：

- 複用臂：list mirror 中找 `blank && cwd == workspace.path && sessionIds.includes(id)`——host 自己的成員規則，絕不只按 cwd。沒有帳戶槽位的 cwd 匹配（CLI（命令列介面）/TUI 在 host cwd 建立的工作階段，或已刪除/重建的註冊）會打開一個任何分組表面都無法顯示在該工作區下的工作階段，因此落到新建臂（見[成員複用修復](../bug-fix/2026-08-05-workspace-blank-session-reuse-membership.md)）；命中直接返回該 id，不新建。
- 新建臂：未命中則 `session.create({workspaceId})`，返回新 id。
- 未知 workspaceId fail loud（不靜默建立到別處）。
- 解析保證（兩臂同約定）：promise resolve 時返回的 id 已在 list store 且 `sessions.binding(id)` 同步可解析——`SessionRuntime.create` 在 RPC 成功後同步投影清單再 resolve，使 draft 搬運方可以在 open 之前往新 scope 的 machine 寫文字，不等 notifier flush。
- 呼叫方拿 id 自行 `sessions.open`；首條提示詞傳送就是普通 `session.prompt`——工作階段本來就在，失敗即普通提示詞失敗，draft 文字還在 machine 裡，重試即再次傳送。
- 全域性 New Session 按鈕默認取 `recentWorkspaceId`：先比較各 Workspace 內 Session 的最新 `updatedAt`，無 Session 時回退 Workspace `createdAt`，同值保持 Host 順序；只有完全沒有 Workspace 時才 `sessions.clear()` 進入無工作階段檢視表。Workspace 分組內的建立動作仍顯式命中該 Workspace。
- 執行時期啟動時訂閱首次完整基線：若已有復原成功的 current 工作階段則保持不動，否則自動 `connectWorkspace(recentWorkspaceId)` 並 open 返回的 blank 工作階段。該策略只結帳一次；之後使用者主動 clear 不會再次被自動選擇覆蓋，連線失敗則等下一次基線投影重試。
- blank Hero 中改選 Workspace 也走 `connectWorkspace`；若目標 id 與當前 id 不同，先把當前 input machine 的非空 draft 搬到目標 scope，再 `sessions.open(nextId)`。舊 blank 實體不刪除，只因不再 current 而從清單隱藏。

### 逐工作階段供數：`sessions.provide` 標準件通道

工作階段 slot 元件「自己拿工作階段資料」的唯一供數路徑。外掛程式以靜態描述符 `sessions.provide({hooks, props, resolve})` 聲明固定鍵表（重名 key 註冊時 throw），`resolve(binding)` 在確定會話下物化值並隨 scope 拆；web-react `standardKit` 統一迴圈把 hooks 格綁成 `use<Name>` 選擇器掛鉤（`observableHook`→uSES，防 tearing）、props 格原樣透傳。

slot scope 是閉集 `root | session-maybe | session`：

- `root` 只拿全域性標準件，不接收工作階段身份或供數。
- `session-maybe` 以**收養（adoption）身份語義**跟隨 current 工作階段（唯一行為——不存在「永久保持實例」模式）：空態出生的化身在**第一個**工作階段到來時保持 React 實例（空殼收養它——不重掛，DOM 存活）；此後行為與嚴格工作階段 entry 完全一致——切到不同工作階段重掛，跌回無工作階段也重掛為嶄新的空態化身（之後再次收養）。因此元件本機的逐工作階段狀態**由構造保證**隨切換清零；需要活過切換的狀態必須住工作階段綁定的源（machine、store、hooks）。無工作階段時 `sessionId`、`useSession`/`useInput` 的選擇結果及 `inputActions` 均可預設。根部無 key 的 `SessionMaybeProvider` 透過訂閱執行時期的原子 `currentProvide` 投影驅動程式這條更新——選擇移動和提供方名冊變化經同一 source 發布，current id 不變時的名冊變化也會重發已掛載 bundle，而不是把 entry 困在過期的掛鉤/prop 形狀上——`SessionMaybeProvideInfo` 靠靜態鍵表在無工作階段時仍保留完整掛鉤/prop 形狀；逐 entry 的收養記帳（化身計數 key）住在 renderer 的 `SessionMaybeEntry`。
- `session` 保證 `sessionId`、所有掛鉤 source 與 props 均存在；每個嚴格 entry 的錯誤邊界以 `sessionId` 為 key，切換工作階段會重建該 entry 及其工作階段 store。

`conversation` 是 `session-maybe` 的常駐外殼：`ConversationRoot`、HeroShell、Workspace picker、root 持有的 scrollport 與 composer stack，以及 overlay chain 的 fallback 外框，在無工作階段 → blank 工作階段的切換中保持 React 實例。兩個嚴格 session entry 只填入固定區域，不改變該樹的父級：`conversation.session.header` 在 scrollport 上方承載 breadcrumb／tab／action，`conversation.session` 在其內部承載 view ring 與 draft mirror；二者共享同一個 session scope chat store。composer bar（`conversation.composer.bar`）本身即為 `session-maybe`：無 session 時，其 machine faces 和訊息動作保持惰性，整張虛線卡片可經指針打開現有 Workspace picker，只讀 textarea 也可透過 Enter 或 Space 打開。session 出現後同一實例（含 textarea）轉為 live；其餘輸入 slot 保持嚴格 `session`，在此之前不派發任何內容。blank → engaging/active 的 InputBar 不因 phase 翻轉而重建。

- 執行時期內建第一條：`'session'` 掛鉤——`useSession` 本身走同一機制，無特判。
- Concurrent 紀律：渲染平面只從 hooks 格讀（uSES 一致性保證）；props 格回呼只在事件 handler 空間用；描述符解析 render-safe（冪等快取、廢棄渲染殘留由 prune 收屍）。
- 第三方元件值零相依性，類型一行 type-only import（declaration merging 進 `SessionStandardProps` / `SessionMaybeStandardProps`）。

### 佇列只讀映像檔

- 佇列語義：running 不鎖輸入；普通訊息經 `session.prompt {mode:'queue'}` 排隊，命令永不排隊。

### host wire 小件

- summary `blank` 列與 `host/session-added` 幀 `blank` 欄位（見上文 blank 位）。
- SSE（Server-Sent Events）幀 `host/commands-changed`（純失效訊號）；client 路由為類型事件 `commands/changed` 與 `connection/reset`（連線代建立後廣播，wire 派生快取一律視舊態為過時）。 該 commands 幀及其類型化 client 事件後來被「`commands/change` 經 `ctx.remote.$on` 原樣轉發」取代（[轉發的 Remote 事件](2026-08-10-remote-event-delivery.md)）；`connection/reset` 不變；本條陳述的「失效而非差分」契約依然成立。
- `command.list/execute`、`skill.list` 一律 `sessionId` 單址（工作階段恆有 Agent，`agentFor` 的復原語義現成）；命令面敘述見[命令業務面 note](2026-07-25-web-command-surfaces-and-assembly.md)。
- `session.create` 請求形狀：workspaceId/cwd 二選一 + 選填呼叫方預分配 sessionId（同 id 同 cwd 重試冪等，異 cwd 報 `session-conflict`）。

## 考慮過的替代方案

| 棄案 | 一行理由 |
|---|---|
| client-local Intent + materialize（published CAS / pendingPrompt attach 交易 / before-create 鏈） | client 被迫模擬 host 缺失的前半段生命，養出 published CAS、attach 交易、部分發布一坨狀態機 |
| host 預留 ID（draft Map） | host 只認了個號，狀態機原封留在 client |
| host draft Session（有 Session 無 Agent） | 每個查 Agent 的 host 面都要為 draft 分叉；core 要新增 `attachAgent` API + header cwd 後寫 |
| 無 cwd 先綁 Agent（ungrouped） | header.cwd readonly「created in」不變性被推翻 + launch-dir 副作用產品坑 |
| React Context 層層傳工作階段語境 | 外掛程式在 host/client 兩側應是一個心智模型；scope 機制與 host dsh-scope 同構 |
| `scopeTarget` carrier + 融合派發器（映像檔 host `agentEvents`） | host 包裝層護的是「業務 Agent subject 與 scope key 不漂移」，client 事件無 subject 可護；filter 住 actx + cordis 原語覆蓋全部需求 |
| Session 不持 ctx（對象層 cordis-free） | 只為篩選單測不引 cordis 而生的紅線，代價是 contribute 兩跳回呼 + 可變公有欄位；host Agent 本就持 loopCtx |
| Session 實例常駐（resident-instance） | host 工作階段日誌即持久真相；常駐僅為身份便利，與 scope 生命週期錯位是複雜度之源 |
| 元件收 wiring 回呼包（inject→props 兩層下傳） | 標準件通道讓元件自取；公共 API 收斂為 hooks + 穩定 props |
| Hero 無工作階段檢視表與工作階段 Conversation 整支互換 | 即使外層 layout 不變，Hero、picker 與 composer 子樹仍會一起重建，介面產生整塊抖動 |
| 讓 InputBar 自身變成 `session-maybe` | 輸入狀態機、鍵盤命令面與動作都被迫接受預設值；只替換 disabled 輸入體能把選填性留在外殼邊界 |
| 專用「轉正」幀 | `session-status(running:true)` 語義蘊含轉正（blank 工作階段從不 running），加幀是 wire 多一型換零資訊 |

## 後果

- 外掛程式獲得與 host 同構的工作階段上下文：逐工作階段狀態掛 actx、隨 scope fiber 一次拆裝，洩漏結構性不可能；雙工作階段隔離由 scope filter 結構性保證。
- client 對象層收斂為 wire 映像檔：工作階段身份、生命週期、能力判別全部以 host 實體為準——輸入體系（下一層）面對的永遠是「有真 Agent 的工作階段」，slash/skill 等提供方一律以 sessionId 直接尋址。
- 空工作階段治理零專用機制：狀態靠一個派生位，可見性靠統一清單投影（僅 current blank 以 `New Session` 展示），回收靠 lazy persistence 的既有約定（重新啟動蒸發），常規上限靠同 Workspace 複用。
- 代價：id→ctx 換乘紀律、provide 的 Concurrent 紀律都是約定而非類型強制，靠 review 與測試釘住。單一狀態軸仍會在 Session 存在前隱藏 machine face；這段時間內，常駐卡片會把啟用操作轉到 Workspace picker（[決策](../feature/2026-08-07-workspace-picker-composer-entry.md)）。
- 已知欠帳：approval/question 跨 prune 復原（TODO）；模型選擇以 live-mutation 形狀回歸（host `selectModel` 三件套現成，其 client 消費端尚未建置）。
