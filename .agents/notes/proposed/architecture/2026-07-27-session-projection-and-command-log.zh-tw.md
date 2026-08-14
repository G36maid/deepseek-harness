# Agent Note: 工作階段投影與命令生命週期日誌記錄

Status: proposed

[English](2026-07-27-session-projection-and-command-log.md) | [简体中文](2026-07-27-session-projection-and-command-log.zh.md) | 繁體中文

## 問題

三個運送中的 web 功能——todo（#497）、goal（#527）、plan mode（#587）——都要從工作階段日誌推導按工作階段的狀態並呈現到瀏覽器用戶端，而三者各自發明瞭一套同樣的機制：

- **用戶端核心類吸收每一個領域。** 三者都往用戶端執行時期的 `Session` 類裡新增私有欄位、拉取編排和事件 switch 分支，並經 `ConversationSnapshot` 投出各自的值。僅 plan 一家就加了七個私有欄位和三層柵欄（請求版本、事件版本、最新活值快取）；goal 加了寫 revision 柵欄外加一個合併式重取迴圈；todo 加了一個投影（projection）欄位和一條事件 case 分支。再來第四個領域，就要第四次改動核心類。
- **三條基線通道。** todo 搭在歷史尾頁的 `todos` 欄位上——由 **api-proxy 內部**的 `backscanTodos` 計算，業務摺疊（fold）邏輯寄居在載體裡；plan 加了一個專用的 `session.planMode` 一元 RPC；goal 加了 `goals.get`。同一個問題，三種協定格式（wire format）。
- **命令結果不可復原。** `/goal`、`/plan` 以及其餘所有斜槓命令都只在 `command.execute` RPC 回應裡返回結果，以一條轉瞬即逝的 composer 通知呈現在發起命令的分頁標籤上。工作階段日誌裡什麼也留不下：刷新、另開分頁標籤、復原或 fork 都會丟掉「該命令曾經執行過」的記錄。領域*狀態*變更是持久的（goal 提交 `goal/change` 元資料，plan 提交 `plan/mode`），但命令呼叫本身及其結論不是。

底層缺口是架構性的：用戶端沒有一個 seam 讓外掛程式在工作階段 scope 內觀察工作階段事件並維護自己的派生狀態；host 側也沒有統一的方式把日誌派生狀態的當前值交給用戶端——而該狀態的歷史可能已被分頁擠出用戶端視窗之外。

## 提案

先立四件基礎設施，之後各領域都退化為純貢獻方。

### 全量值事件規則

攜帶狀態的日誌事件必須攜帶變更後的完整狀態，絕不攜帶裸增量。三個領域現狀已然合規：`todo/write` 是整錶快照，`plan/mode` 是一個完整布林值，`goal/change` 元資料是完整的 `GoalSnapshot`（或一個全量值清除墓碑）。該規則讓每個領域的狀態轉移始終足夠廉價（框架逐事件驅動它），讓值在協議層自描述，並讓任何消費端都可以把最近推送的值當作最終值——靠 seq 比較獲得亂序免疫，且自愈：漏掉的更新會被下一次更新糾正。

### host 側投影登錄檔（`dsh-session-projection`，新包）

一個輕量的 Service Definition 包：merge-extensible 類型表、登錄檔服務、邊界上的 zod 校驗。能力 seam 的角色如下：領域 host 外掛程式提供投影單元，載體消費這些單元，兩側互不相識。

領域註冊的是一個**狀態驅動計算單元（state-driven computation unit）**——三個純函式外加若干聲明——絕不是一個不透明的 getter。驅動它是框架的職責（訂閱、水位線（watermark）、快取，以及後續的檢查點機制），領域只負責數學本身。投影服務於所有業務領域（工作階段標題、plan、goal、權限、todos）；命令只是其中一條觸發路徑，在本約定中沒有任何特殊地位。

```ts ignore-check
export interface SessionProjectionMap {}   // the single type table for the whole chain

export interface ProjectionDefinition<K extends keyof SessionProjectionMap, S> {
  key: K
  schema: ZodType<SessionProjectionMap[K]>  // validates the payload before it leaves the host
  /** State for the empty log. */
  init(): S
  /** Pure transition: previous state + one event → next state. The framework drives it; domains hold no subscriptions. */
  apply(state: S, event: SessionEvent): S
  /** State → wire payload (the read-side projection). */
  view(state: S): SessionProjectionMap[K]
  /** State must be plain JSON (persisted-cache precondition); bump to invalidate persisted rows. */
  stateVersion: number
}

declare module 'cordis' {
  interface Context { sessionProjections: SessionProjectionRegistry }
}
```

- 值就是協議層的 JSON 載荷；同一張類型表經 `import type` 端到端貫通（host 側單元、協議塊、React 掛鉤）——沒有第二張 DTO 表，也沒有獨立的用戶端「views」表。值如何*渲染*是 slot 體系的事，永遠不歸投影層管。
- **host 是投影唯一的計算地點。** 框架主動驅動（eager drive）每個已註冊的單元：每個已提交的工作階段事件都經過 `apply`；對某事件不感興趣的單元返回同一個狀態引用，而引用未變（`Object.is`）就不產生任何下游工作。用戶端從不摺疊領域事件——它們收到的是成品值（基線塊 + 下文的推送幀）。這消除了雙重實作陷阱（plan 的雙事件摺疊只在 host 寫一遍），也消除了一切用戶端側領域程式碼。
- **狀態永遠靠計算得出，絕不入日誌。** 日誌只存事件；單元的狀態住在框架的按工作階段水位線快取裡（每單元一份 `{state, observedSeq}`），並在後續階段進入 domain-KV 儲存 seam 上的**持久投影快取（persisted projection cache）**：形如 `(sessionId, key, ver, seq, val)` 的行（`ver` = 單元的 `stateVersion`，`seq` = 水位線，`val` = 狀態 JSON）。一行永遠不會是錯的，至多是過時的——其 `seq` 精確說明過時到哪。冷讀與活讀共用同一套讀取配方：取快取狀態（或 `init()`），只對超出其水位線的事件做正向 `apply`，再對結果做 `view`。冷清單（跨全部 workspace 列出每個工作階段的標題）變成一次索引讀，至多外加一小段尾部重播；session-persistence seam 在同一後續階段為這段尾部補一個按 seq 起讀的原語。寫入策略：節流（次數/間隔，可設定）外加兩個強制點——`turn/end` 與 detach（由活轉冷的時刻）。兩次寫入之間崩潰的代價是尾部重播更長一些，絕不會是值出錯。
- 領域的輸入事件集由領域自己選擇：todos 只摺疊 `todo/write`；plan 摺疊 `plan/mode` 外加它自己的 `/plan` `command/run` 記錄（見 plan 一節）；goal 摺疊 `goal/change` 元資料；工作階段標題摺疊其標題事件（順帶下線專設的 `session/title` 幀與用戶端的標題快照表——這是該 seam 收編的第四個手工投影）。
- 註冊是 effect（disposer 隨 fiber 走）：外掛程式解除安裝後其 key 從後續回應中消失，用戶端將其讀作能力缺失——HMR（熱模組替換）語義隨之自動成立。key 重複直接 throw。領域外掛程式在 `ctx.inject(['sessionProjections'], …)` 下註冊，因此不帶登錄檔的 headless 組裝完全不受影響。
- 該包擁有 `./invariant`（每個被服務的 key 都有一條存活的註冊）。

### 已交付的消費端：subagent 身份單元

登錄檔的兩處既有讀法已經服務於本 RFC 協議計畫之外的一個已交付消費端：[subagent 清單經投影單元讀取身份](../../implemented/architecture/2026-08-06-subagent-list-identity-projection.md)註冊了 `subagent` 單元——從 `subagent/descriptor` 按 last-wins 摺疊出的持久化 mode/label 身份——`SubagentRuntime.listChildren` 對 live child 經 `snapshot()` 讀取（水位快取，零日誌讀），對 cold child 則用一次持久化整讀的結果呼叫 `restore({}, events, 0)` 讀取。登錄檔約定不變：沒有失敗通道、沒有新讀法——單元永不拋錯，值缺席本身就是訊號，缺席如何呈現是該消費端自己的決定。

### 協議層：歷史尾頁上的 projections 塊

```ts ignore-check
// session.history response, tail page only (beforeSeq absent):
{ events, hasMore,
  projections?: { asOfSeq: number, values: Partial<SessionProjectionMap> } }
```

api-proxy 的歷史處理器切出尾頁後同步遍歷登錄檔——全程沒有一個 `await`，因此所有 key 的值與 `asOfSeq` 構成同一個一致切面。`asOfSeq` 是**最後一個事件的 seq**（`session.seq - 1`；空日誌為 `-1`，與 `session/subscribed.lastSeq` 同一套詞彙），因此攜帶基線之後首個變更的推送幀在比較時恆嚴格更大。api-proxy 不持有任何領域知識（與 `viewFor` 面向 `ctx.tools` 是同一種載體/貢獻方關係）。

不新增 RPC 方法。時機上的重合是精確的：用戶端每一個需要新基線的時刻（打開、重連重同步、缺口修補）本來就要拉尾頁，而唯一永遠不需要基線的路徑（loadOlder）恰好是唯一傳 `beforeSeq` 的路徑。因此用戶端**完全沒有**獨立的「重取基線」決策。視窗內容從不充當訊號：「視窗裡沒有該領域的事件」這個問題在視窗內從構造上就無法回答，只有基線能回答它。

隨此塊下線的舊通道：`session.planMode` 與 `setPlanMode`（讀寫兩側——plan 選擇改走標準命令通道，見 plan 一節）、`goals.get`（讀側；六個變更 RPC 保留，但其回應不再喂狀態——mux 事件反正會到）、`todos` 搭載欄位，以及 api-proxy 裡的 `backscanTodos`（移入 todo 領域的單元，落在 `tool-todo`）。

### 推送幀與用戶端值倉（領域零用戶端程式碼）

既然 host 是唯一計算地點，成品值經一個新的 mux 幀送達用戶端：

```ts ignore-check
// MuxFrame union + schema branch:
{ type: 'session/projection', sessionId, key: string, value: unknown, seq: number }
```

只要某單元的狀態引用發生變化（上文的 `Object.is` 閘門），框架就寄出該幀；`seq` 是寄出時該單元的水位線。這是即時推送狀態，絕不入日誌——與 tool-view 的 `view` slot 同一姿態：重播時在 host 重新計算。

用戶端對象層為每個工作階段維護一個**通用值倉（value store）**：`key → { value, seq }`，由尾頁的 projections 塊播種、由該幀更新，唯一規則是 **seq 高者勝**。重放的基線無法把更新的幀往回滾；丟失一個幀的代價只是過時——到下一個幀或基線為止——絕不會出錯。沒有 `fromEvent`，沒有按領域的 cell 註冊，沒有用戶端側領域摺疊——領域交付投影支持只需**零用戶端程式碼**（`SessionProjectionMap` merge 經 `/types` 出口同時服務兩側）。專設的 `session/title` 幀與 manager 的標題快照表都收編進這對通用機制。所有按領域自造的柵欄（#587 的三層、#527 的寫 revision）都消融進這一條 seq 規則。

### plan 走標準命令通道（完整示例）

plan mode 完整演示了這套模式——觸發路徑、執行面、重播面，三者乾淨分離：

- **觸發路徑**：web 的 plan 開關像任何其他命令一樣經 `command.execute` 傳送 `/plan` / `/plan off`；專設的 `setPlanMode`/`planMode` RPC 下線。使用者的*請求*被持久記錄為該命令的 `command/run { name: 'plan', args: 'off' | '' }`——結構化欄位，無需解析行文字。
- **執行面**（不變）：plan-mode 服務在記憶體裡保持待定意圖，並在下一個輪次邊界落下 `plan/mode`。冷啟動時服務從重播面重建其意圖佇列（「執行態為空即以重播態為準」）。
- **重播面**：plan 的投影單元摺疊**兩**種事件——它自己的 `command/run` 記錄設定 `wanted`；`plan/mode` 設定 `active` 並清除 `wanted`；`view` 推匯出 `{ active, pending: wanted !== null && wanted !== active }`。待定態由此成為純重播量：host 重新啟動能復原它，其他分頁標籤摺疊同樣的事件（跨分頁標籤待定態隨之自動獲得），冷讀回答 `{ active: false, pending: true }` 也是準確的（「一個未兌現的選擇正等待復原」）。

領域的輸入事件集由領域自己選擇——本示例落實的正是這條一般規則。「使用者請求過 X」是出現在投影裡（plan 摺疊自己的命令記錄），還是隻出現在 flow 裡（命令節點反正會渲染），屬於各領域自己的語義，永遠不是框架的關切。

### React：`useProjection`，第五個框架掛鉤席位

既有四個席位都裝不下這份狀態（store 紀律禁止業務對象；inject 禁止掛鉤；`ConversationSnapshot` 正在被清退）。`useProjection` 成為一個框架席位，在 web-react（唯一的掛鉤鑄造點）鑄造，經與 `useSession` 相同的標準套件通道（`provideInfo` → SessionProvider → props）送達：

```ts ignore-check
type UseProjection = {
  <K extends keyof SessionProjectionMap>(key: K): SessionProjectionMap[K] | undefined
  <K extends keyof SessionProjectionMap, S>(
    key: K, selector: (v: SessionProjectionMap[K] | undefined) => S,
    eq?: (a: S, b: S) => boolean): S
}
```

`undefined` 統一表示能力缺失（host 外掛程式未掛載，或尚無任何基線/幀攜帶過該 key）。值倉只暴露按 key 的裸 `{subscribe, getSnapshot}` 面；其餘交給帶逐 key 快取的 `bindSnapshotSelector`——引用穩定性成立，因為一個 key 的值引用只在幀或基線落地時才變化。寫路徑不變：變更回呼留在 inject 共享面（回呼出自 inject，活狀態出自 `useProjection`）。

「掛鉤不得穿過 inject」的唯一既有違例——`DetailsInjected.useSelection`——隨本變更一並收編：選中態是住在聊天 store 裡的查看狀態，因此 details 註冊聲明共享 store 控制代碼，元件改讀 `props.useStore(s => s.selection)`；`useSelection` 退出 inject 約定。

### 日誌中的命令生命週期

兩個僅日誌（非 surface、模型不可見）事件，映像檔 `tool/call`/`tool/result` 的配對：

```ts ignore-check
'command/run':  { commandId: string; name: string; args?: string; source: CommandSource }
'command/done': { commandId: string; kind: 'success' | 'error'; text?: string }
```

host 側命令執行器（`packages/interaction/commands`）在呼叫處理器前追加 `command/run`，在結帳時追加 `command/done`——在接收 agent（代理）的工作階段上直接獨立追加，與[合成輪次移除](../../implemented/simplification/2026-07-28-remove-synthetic-log-only-turns.md)之後所有外掛程式自有 log-only 事件同一形狀：沒有輪次包裹它們（輪次只描述模型迴圈執行），持久化在常規檢查點排空它們，run/done 配對由 commands 包自己的 invariant 伴生外掛程式把守。載荷是結構化的——`name` 以及默認攜帶的 `args` 來自解析器自己的切分（`parseCommand` 的 name 與 rawInput），因此消費端（摺疊自己命令記錄的投影單元、富命令卡片）永遠無需重新解析行文字。當載荷由權威領域事件持有時，命令定義會設定 `recordInput: false`；此時 `command/run` 省略 `args`，而不是重複該載荷。`text` 是處理器的原樣結果——與 `tool/result.content` 同一性質的事實資料，不是呈現（版式如何編排仍由用戶端在渲染時計算，滿足「呈現永不入日誌」這條紅線）。想讓模型知道結果的領域繼續做它們今天在做的事（plan 的旁白、goal 的注入）——那是領域自己的決定，保持不變。

由於已提交事件會在 mux 流上廣播，刷新後仍在、多分頁標籤同步、fork/復原後可還原這三件事隨之全部自動獲得。`command.execute` RPC 退化為准入判定——`{ matched, commandId? }`：該行是否匹配命中，以及命中時新鑄的配對 id，發起命令的用戶端據此把自己的請求與生命週期事件產出的 flow 節點關聯起來。一次性通知通道（`runDetached` → `noticeFor`）就此下線。

用戶端 flow 建置器新增一個通用命令節點（run/done 按 `commandId` 配對；跨視窗截斷時與工具配對同樣軟降級）。渲染走一個新的 keyed slot `'conversation.chat.commandview'`，key = 命令名，**兜底 = 通用命令卡片**（零註冊即可用——從前的通知文字現在持久地渲染在 flow 裡）。領域要升級展示，只需註冊一個行元件，取材於 `command/run` 的結構化欄位與自己的投影值（`useProjection`）——與 toolview 解散之後的工具行同一形狀。

## 交付計畫

基礎設施先行；三個運送中 PR（Pull Request）原樣不動，待基座落地後重新對接（它們的遷移對映即指南）：

1. **host 基座**：`dsh-session-projection`（單元約定、主動驅動、水位線快取）+ api-proxy 的 projections 塊 + `session/projection` 推送幀。零領域註冊也可合入（此時塊與幀直接缺席）。
2. **用戶端基座**：通用值倉 + `useProjection` 席位；下線按領域的 cell 機制，並在標題單元註冊後一並下線 `session/title` 幀與標題快照表。幀的形狀相依性 1（在此之前 fixture（測試前置資料）喂合成幀）。
3. **命令通道**：兩個事件、執行器落日誌、通用節點 + keyed slot、通知通道下線、`{matched, commandId?}` 准入。與 1 平行。
4. **領域重新對接**（在 1+2 之後）：先 todo（單元進 `tool-todo`，刪掉搭載欄位），再 plan（雙事件單元、RPC 下線、開關改發 `/plan`），最後 goal（`goal/change` 單元，刪掉 `goals.get`，把六個 `Session` 方法移入領域外掛程式的 inject）。
5. **持久投影快取**（後續階段，待 domain-KV 儲存 seam 就緒後）：`(sessionId, key, ver, seq, val)` 行、帶 turn/end 與 detach 強制點的節流寫入，以及持久化側供冷尾部重播用的按 seq 起讀原語。

## 備選方案

**專設一個 `session.projections` RPC**——不予採納：基線刷新時刻與尾頁拉取精確重合，單獨的一元 RPC 只會換來第二次往返、第二個待調和的 seq，以及一個用戶端「何時重取」決策——而搭載設計把這個決策整個刪掉了。

**不透明的 `get(agent)` 提供方約定**——否決：計算模型藏在領域內部時，框架永遠無法為狀態做檢查點、無法服務冷工作階段（沒有 agent、沒有已載入的日誌——`get` 無處可跑）、也無法從日誌中段續算。註冊 `(init, apply, view)` 單元把驅動權交給框架，領域只留純數學；有 host 側行為需求的領域，其服務訂閱照舊自持，與投影單元互不牽連。

**為 plan 待定意圖專設的僅即時疊加掛鉤（`live?(agent, base)`）**——不予採納：它存在的唯一理由是使用者的 plan *選擇*不在日誌裡。讓選擇走標準命令通道後，`command/run` 上了帳，待定態成為純重播量，投影約定保持恰好三個純函式。

**把註冊 API 命名為 `registerFold`**——已被單元約定取代：註冊對象如今確實是一個摺疊，但本倉庫裡 `fold*` 專指純 `(events) => state` 輔助函式，而該登錄檔接收的是帶 key、帶 schema、帶版本的單元。投影仍是事件溯源中指稱讀模型角色的術語，#587 的 Note 標題與 #497 的評論也都已在使用它。

**用戶端側摺疊（帶 `fromEvent` 的按領域投影 cell）**——否決：一旦 plan 的單元要摺疊兩種事件，用戶端 cell 就必須在瀏覽器裡復刻 host 的狀態轉移邏輯——同一個摺疊寫兩遍、各自演化。推送成品值（標題幀先例的泛化）保住唯一計算地點，並把用戶端簡化為一個由 seq 把守的通用值倉；領域零用戶端程式碼。

**對日誌尾部的有界反向掃描（absorber 聲明）**——暫不採納：今天沒有任何東西支持它，它只服務於「每個事件都攜帶完整摺疊狀態」的領域，而持久投影快取以統一方式覆蓋同一冷讀需求（快取行 + 正向尾部重播——與用戶端的基線 + 追趕、與分頁載入是同一套配方）。只有當出現檢查點機制服務不了的真實冷讀路徑時才重議。

**`invalidate` 式 cell（標髒，遇領域事件就重取）**——不予採納：它的存在只為伺候增量事件。全量值規則讓每個領域都是 last-wins；goal 的重取迴圈、合併邏輯、過時讀柵欄隨之全部消失。

**把登錄檔掛到 `ctx.apiProxy` 名下**——不予採納：工作階段投影並非 web 專屬（TUI、ACP（Agent Client Protocol）、headless 都是未來消費端），且領域包不得相依性 apiproxy 包。獨立 seam 還順帶刪掉了 #587 從 api-proxy 指向 plan 包的 type-only 匯入邊。

**獨立的用戶端 `SessionProjectionViews` 類型表**——不予採納：一張 `SessionProjectionMap` 端到端貫通正是協議直通紀律（不設第二套 DTO 詞彙）；值就是 JSON 載荷，渲染歸 slot 管。

**用事件廣播收集、替代登錄檔遍歷**——不予採納：非同步監聽器給不出那個單一的同步切面，而正是它讓 `asOfSeq` 成為橫跨所有 key 的一致快照；登錄檔纔是本倉庫承接貢獻的通行形狀（`ctx.tools`、提示詞片段、slot）。

**專設 `plan/select` 選擇事件（用結構化領域事件替代摺疊命令記錄）**——不予採納，改用命令通道：`command/run` 的結構化 `{name, args}` 已經記錄了選擇，`/plan` 的文法與其摺疊邏輯同住一個外掛程式（領域內耦合，非跨領域），還少一種事件類型。處理器必須在任何可能失敗的路徑之前呼叫 `set()`，使已入日誌的請求與執行面不可能分叉——這是領域內部的順序約束，文件寫在處理器處。

**保留 `setPlanMode` 專用 RPC**——不予採納：plan 選擇就是一條普通的使用者命令；命令通道給它持久記錄、flow 渲染、多分頁標籤可見性與准入語義，不需要專設協議方法。Web UI 的互動元件（一個開關）在內部拼出命令列即可。

**讓變更 RPC 的回應喂 cell 狀態**——不予採納：已提交的 mux 事件即刻到達，攜帶同一個全量值外加 seq；「回應喂狀態」正是當初逼出 #527 寫 revision 柵欄的根源。

## 驗收標準

- 領域外掛程式把按工作階段的日誌派生狀態送達 React，只需寫：全量值事件聲明、一次 host 側單元 `register`、自己那份 `SessionProjectionMap` merge、以及 inject 回呼——零用戶端側程式碼，不改用戶端 `Session` 類、`ConversationSnapshot`、api-proxy 或任何協議 schema 文件。
- 歷史尾頁攜帶 `projections`，其 `asOfSeq` 等於視窗尾部 seq；loadOlder 頁永不攜帶；未裝登錄檔的部署照常返回不帶該塊的歷史，用戶端把所有 key 視為缺席。
- 過時的基線不能覆蓋更新的 `session/projection` 幀，重放的幀也不能讓值倉倒退（兩條路徑都做 seq 高者勝測試）。
- 在一個分頁標籤執行的斜槓命令，刷新後、在第二個分頁標籤上、復原之後都在 flow 中渲染出持久節點；未註冊的命令渲染通用卡片；命令結果的 composer 通知路徑徹底移除。
- `useProjection` 經標準 props 套件抵達元件；沒有任何掛鉤穿過 inject 約定（包括 `useSelection`）。
- 工作階段標題搭乘這對通用機制（基線塊 + 投影幀）；專設的 `session/title` 幀與用戶端標題快照表徹底移除。

## 風險

- **全量值規則是承重結構**：未來某個領域若只記裸增量，就無法憑其最新事件服務消費端，還會讓自己的單元複雜化。緩解：該規則寫明在本 Note 與投影包的 README 裡；單元約定讓完整狀態在每次轉移處都是顯式的。
- **單元的同步紀律**：`init`/`apply`/`view` 一旦 await 就會撕裂一致性切面。登錄檔在文件中申明這條紀律，invariant 配套在可行範圍內斷言同步性；其餘由評審把關。
- **登錄檔的即時增刪不做推送**：工作階段中途載入或解除安裝領域外掛程式會改變鍵集，但不會觸發任何工作階段事件、也不會推任何幀；開著的用戶端持有過時的 key 直到下次尾頁拉取（重連、缺口修補、打開）。接受為僅開發期（HMR）的過時時窗——日後可以在變更流上加一個登錄檔變更推送，約定不受影響。
- **忙碌工作階段上的主動驅動開銷**：每個已提交事件都要過每個已註冊單元的 `apply`。按構造，單元的逐事件開銷很低（全量值規則），不匹配的事件返回同一引用，且已註冊領域的數量很小；若真出現熱點路徑，可以加按單元的事件類型預過濾，約定不變。
- **投影載荷膨脹**：每個尾頁攜帶每個已註冊的 key。載荷是 UI 量級狀態的全量值（一張 todo 清單、一份 goal 快照）；將來若某領域的值很大，可以在請求上加逐 key 的 opt-out 或惰性 key，模型本身不用改。
- **命令日誌體量**：每條斜槓命令兩個僅日誌事件；上限由人敲命令的頻率決定，相對區塊體量可忽略不計。
- **重新對接的返工**：三個未合入的 PR 要變基到挪動後的地基上。這是基礎設施先行的既定代價。
