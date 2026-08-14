# Agent Note: slot 體系標準——單一 register、props 四份額與框架 store 席位

Status: implemented

[English](2026-07-22-slot-type-chain-implementation.md) | [简体中文](2026-07-22-slot-type-chain-implementation.zh.md) | 繁體中文

> 範圍：Web 用戶端 slot 體系的終版設計——UI 外掛程式如何拼合頁面、渲染權威落在哪裡、元件 props 如何定型、業務活資料住在哪裡。周邊語境（裝載鏈、對象層、服務）歸 [Web 用戶端架構 RFC](2026-07-19-gui-web-client-architecture.md) 所有，其 slot 各節移交本文。

## 問題

頁面在執行時期由各自獨立裝載的外掛程式拼合而成，UI 因此需要一套能以靜態強制力回答四個問題的組合機制。誰可以渲染進某塊區域——這份權威是可強制執行的，還是僅靠約定？元件如何在保持純函式（零 ctx、零框架 import）的同時拿到它需要的一切，而不必把每個值都經裝配程式碼手工穿線？即時業務資料應存放在哪裡，才能讓流式更新恰好只重渲染訂閱者，而不必讓每個外掛程式自建一套訂閱機制？以及這一切有多少能交給編譯器檢查，讓漂移的元件、越權的渲染呼叫、錯配的 store schema 成為單一可見呼叫點上的編譯錯誤，而非執行時期的意外？

## 決策

一句話：**殼只渲染 `'root'`；外掛程式用單獨一次 `register` 呼叫組合 UI——這一次呼叫同時佔用 slot、聲明並授權子 slot、聲明 store、注入業務面；元件是純函式，props 分四份額到達，每一份額都從各自唯一的真源自動推導。**

### 'root' 是唯一的先驗 slot

`SlotRegistry`（client 執行時期）在構造時聲明 `'root'`——single/root、`owner: {}`——其 `SlotMap` 合併聲明位於執行時期包。殼的全部裝配就是 `ctx.slots.renderSlot('root', {})`：唯一的 ctx 級渲染入口；傳任何其他鍵、渲染器未安裝、root 無人註冊，一律大聲失敗（無 fallback）。

### register 是唯一 API；children = 聲明+授權+執行時期 spec

```ts ignore-check
ctx.slots.register({
  name: 'root',
  children: {
    'sidebar':      { kind: 'single', scope: 'root' },
    'conversation': { kind: 'single', scope: 'session' },
  },
  store: createLayoutStore,      // StoreHandle or factory (below)
  inject: injectFrame,           // business face (below)
}, AppFrame)
```

不存在獨立的 slot 定義 API。`children` 對象同時做兩件事：**聲明子 slot**，並**授權本元件渲染它們**——slot 是渲染樹上的一個洞，因為有人要渲染它才存在，所以 slot 的生命週期就是聲明它的 entry 的生命週期（entry 一經 dispose（資源釋放），slot 隨之消亡、slot 內既有貢獻清空）。children 的值是執行時期 spec（`kind`/`scope` 驅動 outlet 的迭代形態與 binding 選擇；`SlotMap` 是純類型、執行時期即被擦除，這正是鍵陣列行不通的原因），並與對應 `SlotMap` entry 靜態對齊校驗——類型與值在同一點聲明、交叉驗證。

對等原則：**聲明子 slot 的 entry 獨佔渲染這些子 slot 的權力**，全部在 register 時確定（設定錯誤會在裝載時明確失敗；渲染熱路徑不再校驗）。裝載即炸的情形：第二個 entry 聲明已被聲明的 slot；向未聲明的 slot register；同一個 store 控制代碼掛到兩個 scope 之下；chain 註冊缺 `select`。

啟用順序獨立於聲明條目的貢獻方使用 `ctx.slots.inject(key, callback)`，並讓直接呼叫 `register()` 繼續大聲失敗。聲明、貢獻方、替換與失敗各自的生命週期由 [slot 聲明注入決策](2026-08-05-slot-declaration-injection.md) 規定。

`SlotMap` 聲明合併仍是類型權威，且 entry 只聲明自己的軸加 **owner 份額**——註冊方注入的 props 永不進入全域性表（「誰注入的，類型歸誰」）。

### 元件 props：四份額，各有唯一真源

| 份額 | 類型 | 真源 | 內容 |
|---|---|---|---|
| 執行時期 | `PropsRuntime<K>` | K 對應的 SlotMap entry | `OwnerOf<K>`（渲染現場傳參）+ session scope 標配 `useSession`/`sessionId` + 全域性 `useSessions`/`useWorkspaces` |
| 子 slot 渲染 | `PropsRenderSlots<S>` | register 的 `children` 鍵集 | `renderSlot(key, owner)`，鍵參靜態收窄到 S；chain 鍵另有 `renderSlotChain` |
| store | `PropsStore<H>` | store 工廠的返回類型 | `useStore` selector 掛鉤 + `actions.*`（剝去 draft 形參） |
| 業務 | `I` | inject 的返回類型 | 普通資料+回呼；保留的 `hooks` 區域內，裸 observable 經綁定後以 `use<Name>` 選擇器掛鉤的形式到達（`InjectFace<I>`） |

凡聲明 `scope: 'session'` 之處，`sessionId` 一律由框架供給——owner 傳參不攜帶它。register 呼叫點是雙重類型約束的收口：元件的 renderSlot 鍵集超出 `children` 聲明、漏接某個已聲明的面、store/inject 形狀漂移，任何一條都在那一行上報編譯錯誤。轉授就是普通的 props 傳遞（把 `renderSlot` 函式遞下去，可按需包一層更窄的簽名）——不存在白名單面對象，也不存在鑄面 API。

### chain kind：entry 自薦，首個匹配項負責渲染

第四種 `SlotKind`——`'chain'`——把路由權相對 `keyed` 反轉：keyed 的分派現場以 `entryKey` 點選佔用 slot 的 entry，chain 則由 entry 自薦——owner 只分派一套格式統一的 owner props，永遠不知道誰來接管，新的接管包註冊進來 owner 零改動。chain 註冊攜帶一個 `select` 純選擇器（`ChainSelect<O, M>`：`(owner) => matched | null`）與選填的 `priority`（升序；同值保持註冊序 = 裝配序——部署可控的 inject 拓撲——複用 list `order` 的同一穩定排序）；註冊缺 `select` 即上文裝載即炸情形之一。渲染時 outlet 按鏈序依次執行各 select：首個非 null 回傳值當選，該值以 `matched` 並入元件 props（元件絕不自行重新推導匹配）；返回 `null` 則輪到下一個 entry；全 null 則渲染 owner 的 fallback 體（`ChainRenderOpts`）。

「不接」的判定住在 `select` 裡，絕不在掛載後的元件裡自探 props：元件為了渲染 null 也得先掛載，其掛鉤與 effect 全部白跑，隨之而來的掛載/解除安裝抖動還會破壞 memo 化與 React key 語義；而選擇器是純函式——可單測、零掛載副作用——與「presentation methods are pure functions of `args`」是同一條紀律。純，就是選擇器的約定：不讀外部可變狀態、不產副作用，路由判定因此完全是 owner props 的函式，每次分派都可安全執行。選擇器只做路由，絕不建立新對象——按分派逐次構造對象會讓引用每次渲染都換新；把匹配值包成更豐富的面這件事，發生在當選元件內部（以 `matched` 為相依性的 `useMemo`）。

類型鏈上，chain entry 的 SlotMap 形狀是 `{ kind: 'chain'; scope; owner }`，`owner` 即鏈的貨幣；`M`——`matched` prop 的類型——從 select 回傳值推導（選擇器收窄 union 成員時，`matched` 類型自動隨之收窄），且元件位不參與 `M` 的推斷，與釘住 inject 份額的 NoInfer 裁定同源（見下文裁定）。owner 側，`renderSlotChain(key, owner, { fallback })` 與 `renderSlot` 同住 `PropsRenderSlots` 份額，其鍵域靜態收窄到本 entry children 聲明中 chain kind 的鍵（`ChainKeysOf`）；分派現場只有一行，不含任何自有的派生或路由邏輯。

### store 席位：引擎歸框架，schema 歸註冊方

框架只擁有一套訂閱機制：快照 store 引擎（zustand vanilla + immer + 選填 localStorage 持久化）住 **執行時期包**（`./client` 主出口——無子路徑），產出裸的可觀察源；web-react 在 outlet 處把它們綁定成掛鉤（按源快取的 uSES 綁定）。store 裡*裝什麼*是註冊方的聲明，且必須寫成工廠函式，使模組級控制代碼根本無從存在（模組級控制代碼會成為跨外掛程式重載存活的事實單例）：

```ts ignore-check
export function createChatStore() {
  return defineStore({
    init: () => ({ selection: null as SelectionTarget | null, draft: '' }),
    persist: 'dsh.conversation.chat',
    actions: {
      select:    (d, t: SelectionTarget) => { d.selection = t },
      clearDraft:(d) => { d.draft = '' },
    },
  })
}
```

一個工廠，三個消費點：① `register`——獨佔 store 直接傳工廠；要共享實例，則在 `apply` 裡呼叫一次工廠、把同一控制代碼傳給多次 register（跨外掛程式共享構造性不可能：控制代碼從不出包）；② `PropsStore<ReturnType<typeof createChatStore>>` 推匯出元件的 store 份額，零手寫成員；③ 測試自己呼叫工廠並 `.create()` 出真引擎實例，把 `useSelector`/`actions` 直接當 props 喂進去——生產 outlet 走的正是同一條 `create` 路徑，不存在第二套機械。

store 的 scope **從掛載 entry 的 scope 推導**（session slot →每個工作階段一個實例，隨工作階段生滅；root slot →每個 entry 一個）。讀 = `props.useStore`；寫 = 僅 `props.actions.*`——裸實例（帶 `update`/`set`）永遠到不了元件，聲明的 actions 就是完整且可審計的變更 API。生產程式碼在 `apply` 之外從不呼叫工廠或 `create`。

### inject：註冊方透過自己的 ctx 提供業務介面

inject 工廠只接收其聲明所授權的形參——session slot 獲得 `sessionId`，聲明瞭 store 的獲得綁定好的 `actions`，否則無參——取服務一律經 **apply 閉包自己的 ctx**，其能力邊界因此就是本外掛程式聲明的 `inject` 拓撲（cordis property proxy 原生生效；不存在攜帶更寬 ctx 的裝配控制代碼）。回傳值是普通資料與回呼，至多外加保留鍵 `hooks` 格：一張裸 observable source（getSnapshot+subscribe）表，渲染器在業務面抵達元件前把每個 source 綁成 `use<Name>` 選擇器掛鉤——即 provide 通道 hooks 格的註冊方私有孿生，供太小眾、不該進全域性標準件的響應式事實（composer 的 notices/lexicon、settings 導覽行）取用。元件永遠收不到裸 source，業務程式碼因此仍不包含訂閱機制。其餘保持普通：本外掛程式自有服務的收窄讀寫面、跨服務編排（如 `send` = `actions.clearDraft()` + `ctx.conversation.send(...)`）、以及 per-(entry×session) 的裝配副作用。不得手寫掛鉤，不得生成 ReactNode，也不得傳遞整個服務對象——收窄本身就是價值：元件能做什麼，恰由工廠回傳值的形狀圈定。

### 資料界線紀律

掛鉤只許框架造：`useSession`、`useSessions`、`useWorkspaces`、`useStore`、`renderSlot` 五席，加上 provide 貢獻與 inject `hooks` 格綁出的掛鉤——全部出自渲染器同一臺綁定機械；業務程式碼在父子元件之間只傳普通資料與回呼（元件自用、不訂閱任何外部資料源的行為掛鉤不在此限）。活資料恰有三條通道：父知道的，作為 owner props 在 renderSlot 現場傳入；只有元件自己知道的，是本機 state；需要跨 entry 共享或跨重掛載存活的，是聲明的 store。派生是對框架掛鉤資料做純函式（`useMemo`），絕不自成一路訂閱。

### 樹上語境與渲染器約定

`SessionProvider` 是框架元件，**以標配席位形式送達**：`children` 裡聲明瞭 session scope slot 的 entry 經 prop 收到它（類型住 ui-slots，值由渲染器注入）——元件永不對它做值 import。它框架自接線（內部自讀執行時期的當前工作階段狀態，裝配方零傳參），render-prop 形——`children(sessionId)` 外加 `empty` 分支，以 `key={sessionId}` 重掛。`BindingContext` 屬機械內部；業務元件可見的 React Context 為零。inject 工廠有意在 outlet 內部執行（per-entry 錯誤邊界接得住它們；崩潰的註冊方只黑掉自己那一格，裝配錯誤則重拋）；outlet 將樹上下文作為僅供框架機制使用的隱式參數讀取——即「身份出自 register 閉包、現場出自樹位置」的分工。

渲染位於一份安裝約定之後，因此執行時期不相依性 React：`SlotRenderer`（介面住 ui-slots，實作 `createSlotRenderer()` 住 web-react）在殼 boot 時經 `ctx.slots.install(...)` 安裝一次；雙重安裝與安裝前渲染均 throw。歸屬記帳是服務裡的單一 `Map<key, entry>`——帳本、slot、貢獻、渲染綁定、store 實例全部沿同一條 entry 軸生滅，跨外掛程式重載的過時權威視窗由此在構造上關閉（已 dispose 的 entry 所捕獲的 `renderSlot`，一進入口即拋過時授權（stale-authorization）錯誤）。

### 類型鏈實作裁定

register 簽名裡的兩條硬化裁定之所以存在，是因為顯然的替代方案會以具體、可復現的方式失敗；將來的編輯者不應重新爭論它們：

1. **註冊位用 `SlotComponent<P>`（裸呼叫簽名）而非 `FC<P>`。** React 的 `FC` 攜帶靜態欄位（`propTypes`、`defaultProps`），其類型在協變位引用 `P`；兩個 `FC` 實例化之間的可賦性檢查連這些靜態位一起查，會拒絕設計本想接受的元件。裸呼叫簽名只走乾淨的形參逆變檢查；元件仍是普通函式。
2. **`NoInfer<I>` 把業務份額的推斷釘在 inject 工廠上。** 沒有它，TS 還會從元件形參位收集推斷候選，漂移的元件（消費一個工廠並不供給的鍵）會靜默把 `I` 加寬到讓呼叫透過——恰好吸收掉類型鏈本要抓的漂移。負樣本 spec 釘住這一點：若這個 `NoInfer` 日後被「順手簡化」掉，expect-error 位會第一個變紅。

## 後果

渲染權威從此可強制執行，而非僅靠約定：誰渲染什麼是裝載期事實，審計 UI 結構 = 通讀 register 呼叫；對 chain slot，「誰來渲染」額外多出一層渲染期事實，但做決定的選擇器全是 register 現場的聲明，審計範圍仍是 register 呼叫。每個 props API 都從單一真源靜態推導（SlotMap entry、children 鍵集、store 工廠、inject 回傳值），schema 變更由編譯器傳播，而不靠 grep。外掛程式不再自帶任何訂閱機制——store 生命週期（每工作階段實例、dispose、持久化）是釘在 entry 軸上的框架語義。代價：註冊選項稠密（children spec 對象）；框架背上實打實的推斷機械（`defineStore` 的 init/actions 同輪推斷可能需要柯裡化兜底）；編譯期雙向鎖意味著原型階段的漂移直接是硬錯誤，而非警告。

## 考慮過的替代方案

| Rejected | One-line reason |
|---|---|
| 獨立的 define/register 兩步式 API | 拆分讓渲染權威無從強制、招來時序 bug；children 進 register 讓聲明、授權、spec 在同一個可見位置結清 |
| 白名單面對象（`ScopedSlots` + 收窄輔助件） | 白名單已在元件的 props 類型裡，該對象可由機械推導；可鑄造的面對象是第三套權威 API，且只有執行時期校驗 |
| 裝配控制代碼把 root ctx 帶進 inject | 繞開聲明的 inject 拓撲——每個工廠都摸得到每個服務，package.json 的相依性聲明就此失去意義 |
| `children` 用鍵陣列形 | kind/scope 是執行時期分派資料；SlotMap 已被擦除，陣列形必然逼出第二個 spec 註冊 API——定義 API 復活 |
| 業務手造掛鉤 / 元件 props 裡遞裸 observable | 每個外掛程式都變成自己的訂閱機械；inject `hooks` 格讓同樣的事實走那一臺受審計的綁定機械 |
| 模組級 store 控制代碼 | 模組級控制代碼是跨外掛程式重載與跨測試用例的單例；工廠形把身份圈定在單次 apply/測試呼叫內 |
| 元件直收 store 實例 | 渲染程式碼裡能用 `update`/`set`，變更 API 就無從審計；聲明的 actions 讓「什麼能變」保持為 register 現場的事實 |
| 註冊位用 `FC` / 從元件推斷 `I` | FC 靜態位產生協變噪音、拒絕合法元件；元件側推斷靜默吸收 props 漂移（見上文裁定） |
| 接管 slot 用 keyed 分派 + owner 側路由 | owner 會不斷攢下逐 entry 約定與硬編碼路由表（每種接管一份 `find` + `entryKey`）；chain 貨幣讓新增接管註冊保持 owner 零改動 |
| 元件靠渲染 null 表示不接 | 不接也得先掛載——掛鉤與 effect 白跑，掛載/解除安裝抖動破壞 memo 化與 key 語義；純選擇器無需元件實例即可裁決 |
