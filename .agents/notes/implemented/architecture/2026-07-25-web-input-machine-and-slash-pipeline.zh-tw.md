# Agent Note: Web 輸入狀態機、composer slot 與 slash 管線（ui-conversation input / ui-input-trigger）

Status: implemented

[English](2026-07-25-web-input-machine-and-slash-pipeline.md) | [简体中文](2026-07-25-web-input-machine-and-slash-pipeline.zh.md) | 繁體中文

> 範圍：輸入狀態機（occurrence 表 + claim 看護 + 提交交易）、hub/facade 與傳送編排、跨外掛程式輸入改寫的三個 scoped bail 事件、`/` 與 `@` 觸發偵測與選單管線（ui-input-trigger）、composer 周邊 slot 體系。相依性[工作階段作用域 note](2026-07-25-web-client-session-scope-and-provide-channel.md)的 sctx / provide / session-maybe 與 blank 實體模型；命令知識（三型、目錄、popup）零涉——那是[命令業務面 note](2026-07-25-web-command-surfaces-and-assembly.md)的領地。

## 問題

兩個各自為政的 composer：hero（EmptyState，受控鏈直寫工作階段）與工作階段內 InputBar（普通受控 textarea），行為、draft 所有權、傳送路徑全不一致。要讓 `/` 命令、skill 引用、`@` 引用三類觸發進入輸入面，必須回答：

- 三類觸發如何分層，誰對「命令」有知識、誰零知識；
- 輸入框如何表達「命令態」——從 draft 文字推導還是顯式狀態？退格、回車、空格、整行貼上各是什麼語義；
- 提交是非同步交易（RPC 往返）——晚到結果回灌、工作階段切換、React concurrent 重放如何防禦；
- 引用 chip 在純 textarea 上如何表示，undo/剪貼簿/貼上匹配/模型序列化各歸誰；
- 跨外掛程式的輸入改寫（選單回填、引用插入、token 消費）如何做到相依性倒置；
- 無工作階段 → blank 工作階段時哪些 React 外殼必須複用，哪些嚴格工作階段輸入體允許替換。

硬約束：元件一律經 slots 掛載；呈現產物不進工作階段日誌；鍵盤路徑全程 IME 安全。

## 決策

### 輸入狀態機（`InputMachine`）

純狀態機，事件進/效果出，注入時鐘。四相 phase（plain / adjudicating / claimed / submitting）。命令態**永不從 draft 推導**，由 pick 路徑在離散時刻顯式建立；claim 由 `draft.startsWith(token)` 看護、退格破壞自動 release；claim 形狀 `{token, hint?}`（hint 供 ghost text）。

事件面（`dispatch(ev)` 單寫入口，每個事件一個 transaction）：

- `draft-changed {draft, editRange?}`——textarea 全量草稿；editRange 縮小 occurrence 平移計算，預設前後綴共掃。
- `newline {selection}`——Ctrl+Enter 換行（不經瀏覽器 execCommand：自管 undo 下瀏覽器寫入會分叉雙歷史）。
- `begin-command {claim, span}` / `insert-ref {reference, span}` / `consume-token {guard}`——三個 bail 事件的機器側；span CAS = draftRev 相等。
- `set-invalid {invalidIds}`——owner resolution 結果的樣式位（非 transaction）。
- `undo` / `redo`——自管 transaction log（容量為 100 的環形緩衝區；單字元打字按注入時鐘窗合併；提交成功清 log）。
- `paste-begin {text, selection, components?, generation?}`——貼上 + 熱快照同步匹配元件同 transaction（Undo 一次回貼上前）；打開 PasteMatchAttempt。
- `paste-upgrade {attemptId, span, reference}`——非同步匹配升級為獨立 transaction（Undo 兩段）；attempt 保持 current，insertedRange 隨升級收縮。
- `invalidate-paste`——DOM 層觀察到的 attempt 終結手勢（caret/selection 操作等）。
- `enter {mode}` / `adjudicated` / `adjudication-failed` / `submit-settled` / `release`——提交交易平面：SubmitAttempt（seq + AbortSignal）防回灌，成功 commit 清稿，失敗帶漂移守衛 rollback（回車時快照僅當 live draft 仍等於它纔回填；使用者已再輸入則只發 notice）。

效果面（shell 執行）：`adjudicate`（調 InputTriggerController.adjudicate）、`begin-submit`（claim.submit 交易）、`default-sink`（普通訊息，hub 編排）、`notice`。

occurrence 表與 chip 三投影：

- 每顆引用在 draft 中佔一個 `U+FFFC`；表項 `{occurrenceId, source, ref, offset, label, clipboardText, invalid?}`；同名 chip 因 occurrenceId 獨立。
- 一切編輯同 transaction 更新 draft 與表：區間平移；與佔位符相交的刪除/替換作用於整顆。
- 單字元佔位使鍵盤原子性大半原生成立（caret 無內部位；Backspace/方向鍵/Shift 擴選原生即整顆）；滑鼠點 chip 由 backdrop 命中 → 整顆 setSelectionRange。
- 視覺投影 = label：backdrop 在佔位符 offset 渲染 chip（textarea 字形不可見），invalid 走失效樣式。
- 剪貼簿/持久化投影 = clipboardText：copy/cut 把選區內佔位符展開；draft 持久化 mirror 寫同一投影（chat store 裡永遠是普通文字，刷新 seed 語義 = 全選複製→重開→貼上，chip 跨刷新降級為文字）。
- 模型投影 = submit 時經 source `codec.serialize` 逐顆生成（歸 submit attempt 的 signal 與過時守衛；owner 缺失/失敗/取消則不傳送，不降級為 `/name`）。

### 跨外掛程式輸入改寫：三個 scoped bail 事件

約定聲明在 ui-input-trigger（相依性最底層），生產者經 `sctx.bail(sctx, ...)` 派發，唯一消費側是 hub 建 shell 時掛在 sctx 上的三個 listener；返回 `true` ⟺ 機器過 phase + CAS 守衛並實際改寫（寄出事件 ≠ 修改成功，Space 是否 `preventDefault` 以回傳值為準）：

- `slash/input-begin-command` `{claim, span}`——選單 pick / Space 裁決出的命令 claim 回填（InputTriggerController 派發）。
- `slash/input-insert-reference` `{reference, span}`——引用 chip 插入（InputTriggerController 派發）。
- `slash/input-consume-token` `{guard: span | bare-token}`——業務成功後消費命令 token（下游命令面派發）。

不事件化的呼叫（登錄檔登記 → 顯式呼叫 → await）：Input 自身的 draft/submit、Enter 非同步裁決、reference serializer、非同步 paste matcher。`@mode bail` 已入 JSDoc parser 與 cordis catalog 閘門（scripts/jsdoc.ts）。

### slash 管線（ui-input-trigger：root `InputTriggerService` + 每工作階段 `InputTriggerController`）

對「命令」零知識的觸發/選單/pick 管線：

- 服務只有 source 登錄檔（`InputTriggerSource{trigger: '/'|'@', name, order?, candidates, onPick, matchSpace?, matchEnter?}`；(trigger,name) 唯一；選填 `order` 對 roster 排序——越小越靠前、默認 0、同值保持註冊序——排序後的 roster 同時是組序與輪詢序）與 `sessionOf(sctx)`。實作 match 掛鉤即參與空格/回車裁決的聲明；管線按 roster 序輪詢，首個非 undefined 應答勝出，無人認領落 default sink。matchSpace 同步（空格在擊鍵中觸發，只許熱快取）；matchEnter 非同步（可 await 源自身預熱，預熱失敗即 reject）。
- controller 持有唯一權威 hit（含 span；選單關閉後為 Space 保留）、每工作階段 menu store、候選 fetch generation、鍵盤仲裁（combobox 模式：焦點始終在 textarea，↑↓/Enter/Escape 攔截且全程過 IME composition 守衛，唯一例外 Shift+Enter 無條件先行），以及 pick 編排（outcome → 自派 bail 事件）。`toggleSource(name, syntheticHit)` 是 chrome launcher 路徑：它基於呼叫方的 textarea selection，只 seed 對應的已註冊 source，並行布 `launcher = name` 直至關閉；普通的鍵入式 tracking 會清除 launcher 並復原完整的 trigger roster。兩條路徑渲染同一個 MenuView，並執行同一條 `onPick` 鏈。`dismiss()` 動詞支撐 MenuView 注入的 `onDismiss`（指針落在選單與所在 composer 卡片之外即關閉選單；MenuView 還經 `slash.menu` locale 命名空間本機化組標題，並經 ui-primitives 的 `useAnchoredMaxHeight` 把高度收斂到 composer 上方的視口空間）；每個工作階段作用域出生時對 source roster 做一次 `warm(projection)`，projection 在該 scope 內只有穩定的 sessionId，無 published/能力躍遷；scope disposer 拆除 controller。
- 觸發偵測詞邊界（`user@host`、URL `/` 永不觸發）、守衛分檔（plain：`/` 到處 + `@` 行內 / claimed：`/` 抑制、`@` 活 / frozen：全無）為凍結純核。

### hub / facade：常駐外殼與嚴格工作階段輸入體

- hub（trigger/decoration 登錄檔 + 傳送編排）對 slash/command 服務是選填 `ctx.get()` 相依性：無 ui-input-trigger/命令面時輸入正常收發，優雅降級。
- 每個實體工作階段只有一個 `SessionInputShell`（facade），隨工作階段作用域建立和拆除；無工作階段時不造 input machine。`ConversationRoot` 自身是 `session-maybe` 常駐外殼，持有 HeroShell、Workspace picker、composer stack 與 chain fallback 外框。它始終擁有同一個 scrollport 與 composer seat；工作階段出現後，彼此獨立的嚴格工作階段 header 和 body outlet 只填入這些固定區域。
- composer bar 是一個無條件渲染的 `session-maybe` slot entry：無工作階段時同一個 InputBar 以惰性態渲染（machine face 缺席、`disabled` owner prop），`connectWorkspace` 返回 blank 工作階段後同一實例轉為 live——textarea DOM 在無工作階段 → blank 切換及其後每次 phase 翻轉中都不重建；`ConversationRoot`、Hero 與版面配置骨架全程保持。
- ConversationRoot 的 Hero 判據是 `sessionId === undefined || (composerPhase === 'blank' && (openState === 'open' || summaryBlank === true))`：summary 已證實為空的工作階段在任何 open state 下都保持 Hero，未經證實的工作階段則在 loading 期間進入 settling。首次 submit 同步進入 engaging，失敗也保留 composer 與錯誤上下文，不退回 blank Hero；sidebar 的 blank 位只在提示詞成功受理後翻 false。
- 傳送統一在 hub defaultSink：樂觀清稿後只走 `session.prompt` 且固定 `mode:'queue'`（Web UI 無 steer 入口；host 線纜上的 `mode:'steer'` 不經此 machine）；失敗且 live draft 仍為空纔回填，使用者已經繼續輸入則不覆蓋。不存在 Draft materialize 或 attach 交易。
- blank Hero 改選 Workspace 時，外殼呼叫 `connectWorkspace`；目標工作階段不同時把非空 draft 從當前 shell 搬到目標 shell，再 open 新 id，舊 blank 工作階段留存但不再 current。
- Notifier 雙位約定：`dirty`（快照新鮮度，`ensureFresh` 拉取可清）與 `notifyPending`（通知欠帳，只有 flush 清）各自獨立——拉取不得吞推送，對象層推訂閱者（watchTransaction）相依性這一保證。

### 純文字引用：text outcome 與 lexicon 裝飾

skill/@subagent 引用不走佔位符 + occurrence 身份鏈——純文字引用決策：pick 直接把 `/name ` `@name ` 原文插進 draft，chip 視覺純派生：

- PickOutcome 增 `{text}` arm；新 scoped bail 事件 `slash/input-insert-text` `{text, span}`（與另三個同約定：draftRev CAS、返回 true ⟺ 實際改寫）；facade.insertText 走 setDraft 拼接，機器零改動。
- source 選填 `lexicon?(session)` 掛鉤：同步熱快照名錄，`undefined` = 資料未熱——零裝飾、永不觸發 fetch（渲染路徑保持同步無副作用）；配對的選填 `subscribeLexicon?(session, listener)` 掛鉤是名錄在 warm 之後仍會變化（目錄 settle、子代生滅）時的失效通道。controller 把各名錄聚合進自己的 `lexicon` 快照 store（每次 source 通知重拉）；scope 出生後才註冊的 source 由服務廣播給活 controller，補 warm 並並入名錄。
- `decorations.scanTextRefs`：詞邊界掃描 draft（行首/空白後的 `/name`、`@name`，`x/name` 永不命中）對照名錄，命中即 `.textRef` mark（backdrop 純 range 高亮，同 hlToken）；編輯破壞匹配形狀下次掃描自然消失。
- 傳送即原文（不再 `<skill>` 序列化）；氣泡側 MessageItem 雙形狀裝飾（legacy `<skill>` 標籤 + 純文字 token）。
- 舊 occurrence/paste/serialize 鏈全部保留在盤未刪（additive；刪除另成將來一刀）。裝飾回應性：InputBar 以 uSES 訂閱 shell 的 lexicon source，scope 出生預熱後才 settle 的名錄會直接點亮已有 draft token，無需選單互動或無關重渲染。

### 每工作階段供數貢獻與鍵盤私面

- ui-conversation（hub 兼貢獻者）經 `sessions.provide` 供 `'input'` hook（機器狀態 + queue overlay）+ `inputActions` prop（`setDraft`/`submit`，穩定 void 回呼）。
- 公私分界：公共 provide 只放 React 語彙成員；鍵盤/DOM 命令面（track/arbitrate/space/undo/redo/paste/dismissPopup/bindMirror——同步回傳值、disposer 語義）是 InputBar 獨佔，走 InputBar entry 自己的 inject 包內私遞，不出外掛程式邊界。

### slot 體系

`conversation` 本身是 session-maybe；其工作階段內容與 composer 輸入 slot 嚴格限定為工作階段，Hero Workspace picker 保持 root。root 註冊把 header outlet 渲染在常駐 scrollport 上方，把 body outlet 渲染在其內部、常駐 composer seat 之前。子 slot 均由 ui-conversation 的 conversation 註冊聲明：

- `conversation.session.header`（single）——常駐 scrollport 上方嚴格工作階段的 breadcrumb、view tab 與 header action。
- `conversation.session`（single）——常駐 scrollport 內嚴格工作階段的 view ring 與 draft mirror。header 和 body 共享同一個工作階段作用域 chat store；工作階段 id 切換時各自重建。
- `conversation.composer.bar`（single）——InputBar 本體的 slot：InputBar 是真 slot entry（自有 slot 自註冊），composer chain fallback 的內容；不做 chain entry——chain 單選舉會在 takeover 時解除安裝它，破壞 textarea DOM 存活。
- `conversation.input.overlay`——輸入卡內浮層錨點；註冊者 inject 按 slot sessionId 解析各自每工作階段 controller。
- `conversation.input.dock`——輸入上方堆疊條（QueueDock 的佇列只讀清單落此），order 定序。
- `conversation.composer.dock`——composer 上沿統計帶。
- `conversation.input.left` / `conversation.input.right`——工具行左右區。
- `conversation.input.plan` / `conversation.input.model`（single）——工具行兩具名控制位；bar 只傳 `locked`（owner props），空到 owning 外掛程式註冊為止，無佔位 fallback。plan seat 未啟用時保持為空，因為入口歸共享 Command source 所有；有效 plan 目標會渲染 warn 狀態的 `Plan ×` 狀態按鈕，其唯一動作是 `/plan off`。
- `conversation.hero.workspace`（root scope）——無工作階段 / blank Hero 共用的 Workspace picker；pick 經 `connectWorkspace` 複用或建立目標 blank 工作階段，必要時搬運 draft 後切 current。

### 測試紀律

狀態機全部行為由純 JS 單測覆蓋（事件序列進、斷言狀態與效果，零瀏覽器 DOM）；互動矩陣逐行投影測試。這一要求正是純核 + 服務殼分層的成因。

## 曾考慮的替代方案

| 棄案 | 一行理由 |
|---|---|
| ActiveCommand 中間態 / registerMode 模式登錄檔 / 從 draft 推導命令態 | claim 由 pick 路徑顯式建立——無表、無推導 |
| bindTarget/bindDraft 對象直連 | 反向耦合 + root 單例跨工作階段誤配；scoped bail 事件保相依性倒置且路由結構性正確 |
| 統一 slash/input-apply 或全事件化 | 三個獨立 payload 覆蓋跨外掛程式改寫；非同步鏈路保持基於登錄檔的顯式呼叫 |
| contenteditable / 富文字樹 | 相容性差；textarea + U+FFFC + occurrence 表覆蓋全部互動約定 |
| draft 雙持久化 {text, occurrences} | mirror 寫剪貼簿投影零新概念；chip 跨刷新降級可接受 |
| 原生 textarea undo 棧 | 受控 + 程序化寫入下不可靠；貼上兩段 undo 語義只能自管 |
| InputBar 收 16 員 wiring 回呼包 | 消費矩陣實證 11 員 InputBar 獨佔、1 員死成員；標準件通道讓元件自取，鍵盤麵包內私遞 |
| 空格裁決也認領即執行型命令 | 誤觸發防線：空格後整行是普通提示詞；不可逆副作用只留顯式入口 |
| 通用 tokenPattern 裝飾機制 | 結構化 occurrence 記錄取代模式掃描 |
| 佔位 select 常駐工具行 | 具名 slot 在註冊前保持為空；佔位件與真實現衝突時是兩個真源 |
| 始終可見的 Plan 開／關切換 | 入口已歸共享 Command source 所有；第二個入口會把狀態 seat 變成冗餘的 mode chrome |
| 第二套加號選單元件／controller，或在 Command 上方增加 Add/File 分組 | 這會重複非同步候選、鍵盤高亮、焦點保留與 pick 狀態；加號控制元件只是既有 MenuView 按 source 過濾的 launcher，且此 scope 沒有文件能力 |
| 引用一律走 U+FFFC chip（純文字引用決策所取代的舊線） | 純文字 + 派生裝飾零身份狀態；原文即模型投影，undo/剪貼簿免特判；chip 鏈保留給需要不可分原子性的場景 |

## 後果

- 一個常駐 conversation 外殼承接無工作階段/blank/active：無工作階段 → blank 保持 ConversationRoot、Hero、root scope Workspace picker、scrollport、composer seat、InputBar 與 textarea；只有嚴格工作階段 header 和 body outlet 開始承載內容。同一 blank 工作階段 → engaging/active 也保持 InputBar 與 textarea。EmptyState 與受控 intent 鏈（`sessions.updateIntent`/`updatePendingPrompt`/`workspaces.sendSession`）隨最後消費端一並刪除。
- 輸入面對命令零知識 + 選填相依性：無命令包時純輸入可用；`@` 引用與 skill 引用免費複用同一選單/pick 管線。代價是空格/回車裁決是逐 source 輪詢協議，其應答語義（同步/非同步、undefined 含義）為凍結約定。
- 提交交易化（attempt seq + 漂移守衛）使晚到結果回灌、工作階段切換、concurrent 重放三類缺陷結構性不可能，由矩陣測試釘住。
- 已知欠帳：chip 跨刷新保真（可複用貼上匹配）未立項；subagent 引用的模型表示待業務立項。
