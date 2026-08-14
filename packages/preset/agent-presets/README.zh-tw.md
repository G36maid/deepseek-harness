# dsh-agent-presets

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

按 preset 組裝 agent（代理）。**preset** 是一個目錄，其中放置一份 `agent.cordis.yml`；roster 在整個行程內只把它掛載一次（常駐 scope），命名它的每個工作階段透過把自己 agent 的 scope key 認父到該掛載（`dsh-scope` 的父鏈）來加入。掛載的工具、提示詞段落與投影單元只存在一份，覆蓋所有已加入的 agent——其外掛程式本就按 Session/Agent 分鍵存狀態，工作階段在共享實例內互不串擾——而完全沒有 agent 的宿主讀取方（冷讀記錄）也能按 preset id 解析到同一份常駐註冊。

其機制是兩條 seam。entry 上下文沿原型鏈連到子樹被掛載時所在的上下文，而 [`dsh-tools`](../../core/tools/README.md) 與 [`dsh-system-prompt`](../../core/system-prompt/README.md) 本就按呼叫方上下文的 scope 分層封存註冊——因此常駐掛載的貢獻落在 **preset 的分層**裡。把它們送達每個工作階段的是 `dsh-scope` 的父鏈：agent 的檢視表按 `agent → preset → global` 解析（近者遮蔽遠者），掛載的監聽器對認父到它的每個 agent 放行，而兄弟 preset 的監聽器保持失聰。

## 服務：`AgentPresets`（ctx 鍵：`agentPresets`）

發現程序不做快取：`list()` 與 `resolve()` 每次呼叫都重新讀取各個根目錄，因此行程執行期間新寫的 preset 立即可見，被刪除的 preset 也會在下一次讀取時消失。發現程序同時負責 preset 的**健康**：組裝文件缺失或不可載入（YAML 無法解析——用載入器自己的方言檢查，含 `!!js`——或不是由具名外掛程式行組成的清單）的目錄會作為攜帶 `broken` 原因的行列出而不是被跳過，因為被跳過的目錄仍在磁碟上佔著它的 id，而各個介面卻沒有任何可刪的東西。目錄名不是可用 preset id（`[a-z0-9][a-z0-9-]*`）的目錄才被直接跳過：複製永遠不可能佔用那種名字。

- `ctx.agentPresets.defaultId: string` 呼叫方未指定時掛載的 preset id。
- `ctx.agentPresets.list(): Promise<AgentPreset[]>` 當前各根目錄提供的全部 preset；id 重複時靠前的根目錄勝出；損壞的 preset 也在其中，各自攜帶原因。
- `ctx.agentPresets.resolve(id?): Promise<AgentPreset>` 按 id 取一個 preset，預設取 `defaultId`。沒有任何根目錄提供該 id 時拋錯，並列出可用 id。損壞的 preset 照樣解析——刪除、讀取與上報都需要這一行。
- `ctx.agentPresets.mount(agentCtx, id?): Promise<AgentPreset>` 用一個 preset 組裝一個 agent——確保其常駐掛載（並行去重）並把 agent 的 scope key 認父到它——返回該 preset 供呼叫方記錄。對損壞的 preset 直接以發現時記下的原因拒絕，所以每種不可載入的形態都在載入器介入之前以同一方式失敗。
- `ctx.agentPresets.composeFrom(agentCtx, parentCtx): string | undefined` 讓一個 agent 加入另一個 agent 已在執行的常駐組裝，返回所加入的 preset id——父方未加入任何 preset 時返回 `undefined`，那是無 roster 的部署，不是錯誤。這是認父而非掛載，因此同步、且自身沒有組裝失敗模式；呼叫方用錯（上下文無 scope、agent 已加入過）仍會拒絕。
- `ctx.agentPresets.composedPreset(agentCtx): string | undefined` 某個**活著的** agent 正在執行的 preset，從其 scope 鏈讀取而不是從其工作階段讀取——對於持久化 header 尚在建置中的 agent，這是唯一能拿到的答案。
- `ctx.agentPresets.recompose(agentCtx, id): Promise<AgentPreset>` 把一個 agent 重鏈到另一個 preset 的常駐組裝。僅在該 agent 尚無任何產出時合法——**由呼叫方負責該檢查**；新掛載在鏈移動之前確保完成，失敗時 agent 原封不動。與 `mount()` 一樣拒絕損壞的 preset。
- `ctx.agentPresets.standingKeyFor(id?): Promise<ScopeKey>` 沒有 agent 的宿主讀取方（冷讀記錄）解析 preset 註冊所用的常駐 scope key；確保掛載而不啟動任何 agent、工作階段或輪次。與 `mount()` 一樣拒絕損壞的 preset。
- `ctx.agentPresets.roots: readonly PresetRoot[]` 本 roster 實際掃描的根目錄——全部已設定根目錄按序在前，隨後是推匯出的 harness home 根目錄。它不是 `config.roots`：判斷「是否已組裝 roster」應讀它，從而由同一處推導決定。
- `ctx.agentPresets.authorable: boolean` 上述根目錄中是否有任一具備 `user` 信任等級，因而 preset 是否可建立。
- `ctx.agentPresets.read(id): Promise<string>` 某個 preset 的組裝文字，與儲存內容逐字一致。
- `ctx.agentPresets.copy(from, id, name?): Promise<void>` 透過整目錄複製一個既有 preset 來建立本機創作的 preset——唯一的創作寫入。組裝文字不經過這道接縫，因此副本與其來源同等可載入；複製出的中繼資料保留來源的描述、但絕不保留其名稱與 roster 排序，`name`（或回退到 id）纔是區分兩行的依據。
- `ctx.agentPresets.remove(id): Promise<void>` 刪除一個本機創作的 preset；已加入的工作階段保留其常駐掛載。若使用者預設值恰好指向剛刪除的 preset 則一並清除：存一個尚不存在的預設值是刻意的，但本次刪除的這個再也不會有人提供，留著會讓所有未顯式指定的新工作階段無法啟動。

`AgentPreset` 攜帶 `id`（目錄名）、`trust`（`system` 或 `user`，取自它所在的根目錄）、`path`（組裝文件的絕對路徑），以及——僅當該 preset 無法組裝工作階段時——`broken`（一條人類可讀的原因，名單介面原樣展示）。

### 應在何處呼叫 `mount()`

agent 工廠的 `setup(agentCtx)` 掛鉤是唯一受支援的呼叫點。只有在那裡，認父是在 agent 尚未發布時完成的，因此組裝被拒絕會讓整次建立回滾，而不會留下一個組裝到一半的工作階段。常駐子樹歸 roster 服務自己的 fiber 所有——刻意用其未追蹤的上下文，因為從被追蹤的 `this.ctx` 派生的子樹會經呼叫方的 shadow fiber 解析一切服務、無視各 entry 自己的 inject store——所以它比任何 agent 都活得久，只隨整棵樹解除安裝。每個代際記錄其組裝文件的 stamp（mtime 與大小）：發現 stamp 過期的工作階段會開啟下一個代際，而所有已加入的工作階段保持各自正在執行的那個——正在執行的工作階段所加入的組裝在其文件被修改或刪除後繼續存活；文件是唯一的組裝編輯器，stamp 正是把編輯送達後續工作階段的機制。

### 組裝子 agent

subagent 的子 agent 透過 `composeFrom()` 加入其父方的常駐組裝，絕不走 `mount()`。所有面向模型的行都在 agent 平面，工具登錄檔的全域性層是空的，因此沒有加入任何組裝的子 agent 抵達模型時既沒有任何工具，也沒有父方的任何提示段。

按 id 重新掛載父方的 preset 與認父有兩處差別，且兩處都要緊。父方啟動後被編輯過的組裝文件會把與父方歷史所產出時**不同**的一個代際交給子 agent；而此後被刪除的 preset 會讓子 agent 直接失敗，儘管其父方仍在正常執行。認父還是同步的，這正是行程內 subagent 驅動能夠使用它的前提——它們在同步的建立視窗裡組裝子 agent。

子 agent 會把所加入的 id 記在自己的持久化 header 上（見 [`dsh-subagent`](../../subagent/subagent/README.md)），因此冷讀子 agent 的歷史時重建的是它實際執行過的組裝，而不是部署預設值。

### 工作階段實際執行的是哪個 preset

建立頭部記錄的是工作階段**以什麼開始**，`resolveSessionPreset(session)` 給出的纔是它**實際執行的**。空白工作階段一旦切換過，兩者就不同，因此所有重建路徑——選擇器讀取的摘要、resume、fork——都走解析，而非直接讀頭部。

頭部保持凍結，因為它是建立期事實。切換以 `agent-preset/selected` 工作階段事件記錄，在替換提交之後追加；這正是 model-visible ⟺ logged 規則的要求：preset 決定模型看到的工具 schema 與提示詞段落，因此必須能從日誌重建。服務會把這項已提交事實重新發為不帶 scope 的 cordis 事件 `agent-preset/selected(sessionId, agentPreset)`，其聲明位於 client-safe 的 `./types` 出口，使遠端消費端無需匯入 Host 執行時期類型即可讓工作階段派生狀態失效。只讀頭部會讓切換過的工作階段按建立時的組裝重建，從而重放新工具集無法執行的歷史——這正是「僅空白可切」那道鎖要防的危險。

### 切換空白 agent

`recompose()` 先解除安裝已裝入的子樹、再裝入新的，因為兩份組裝無法共存——它們會把相同的工具名註冊進同一個層。掛載失敗會復原先前的組裝，而不是讓 agent 一無所有；未知 id 則在任何東西被拆除之前就被拒絕。

"僅限尚未產出任何內容的 agent"是一條產品規則而非機制約束：在對話進行中調換工具，會留下新組裝無法執行的、已被記錄的工具呼叫。該規則由閘道在傳輸層執行（[`dsh-apiproxy`](../../host/apiproxy/README.md) 返回 `agent-preset-locked`），因為工作階段歷史在那裡纔拿得到。

## 創作

創作即複製。新 preset 是某個既有 preset 的整目錄副本——組裝、中繼資料、skill 目錄、附帶資產——落在首個 `user` 根目錄之下；輸入只有兩個由服務對照自身根目錄解析的 id 加一個選填顯示名，因此呼叫方從不提供組裝文字，一次複製不會授予 roster 尚未攜帶的任何能力。建立之後的一切都發生在 preset 自己的文件裡。`copy()` 在任何內容落盤之前拒絕三種情況：

- **不符合 `[a-z0-9][a-z0-9-]*` 的 id。** id 會成為目錄名，因此約束是 id 自身的性質，而非事後再做一次路徑檢查——`../escape`、`a/b` 與絕對路徑都作為 id 被拒絕。
- **已被佔用的 id。** 複製從不覆寫：任一根目錄已提供該 id 即拒絕（與隨附 preset 同名的使用者目錄只會被它遮蔽），磁碟上佔著該名字的目錄同樣拒絕。發現程序會把這樣的目錄列為損壞的 preset，所以這條拒絕的出路——刪掉它——就在報告它的同一頁面上。
- **未知的來源。** 來源可以是任何信任等級——複製隨附 preset 正是主要用途——但必須存在；複製失敗會回滾做到一半的目錄，而不是留下一個 discovery 看不見的目錄。

複製出的目錄樹被收緊為僅屬主可用（文件 `0o600` 並保留屬主執行位，目錄 `0o700`），符號連結被解引用以保證副本自包含，且根目錄在首次複製時建立——部署設定了尚不存在的使用者根目錄，正是首次執行的正常狀態。複製出的 `preset.yml` 會被重寫：保留來源的描述供作者就地編輯，但丟棄其名稱與 roster `order`——副本若與來源呈現得一模一樣、或按隨附集合聲明的順序排序，roster 就不再能區分它們。`remove()` 拒絕隨部署提供的 preset；隨附集合正是副本的已知良好起點。

### preset 的各行如何解析

行的**包名**從宿主組裝解析，而非從 preset 目錄解析。Loader 通常按 entry 所屬樹的 `baseUrl` 解析，而對 preset 而言那就是組裝文件所在之處；本機創作的 preset 位於使用者主目錄之下，Node 向上尋找 `node_modules` 永遠夠不到 harness，因此每一個 `@deepseek-ai/dsh-*` 行都會匯入失敗。掛載在插入子樹之前先記錄宿主的基址，並把裸識別符號送往那裡。

**相對**路徑仍從 preset 自身的目錄解析，因此 preset 自帶的外掛程式文件與 skill 目錄會隨它一同遷移。

**絕對**檔案系統路徑則保留其自身位置。掛載會先將它轉換為 `file:` URL 再交給 ESM 匯入，從而使 POSIX 路徑和 Windows 盤符或 UNC 路徑都採用 Node 能夠接受的說明符。

### 展示用元資訊

preset 可以在組裝文件旁的選填 `preset.yml` 裡發布展示文字：

```yaml
name: 极简模式
description: 仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。
```

它**只**承載展示文字。`id` 是目錄名，`trust` 取自 preset 被發現時所在的根目錄，兩者都不可寫在這裡——否則本機創作的 preset 就能把自己命名進隨附集合。之所以是獨立文件：組裝是外掛程式行的頂層清單，YAML 無法在其旁攜帶同級鍵，而偽造一個元資訊行等於遞給 Loader 一個要載入的東西。

任何讀取失敗都退化為「沒有元資訊」——缺失、格式錯誤、類型不對、內容為空，含義相同，選擇器回退到 id。展示不是能力：名字壞掉的 preset 依然能掛載。

## 設定

| 欄位 | 預設值 | 含義 |
|---|---|---|
| `default` | 必填 | 呼叫方未指定時掛載的 preset id |
| `roots` | `[]` | 按優先級排列的掃描目錄；每項提供 `path`（開頭的 `~` 會展開）與 `trust`（預設為 `user`） |
| `includeUserRoot` | `true` | 在全部已設定根目錄之後，追加 `<dshHome>/.agent-presets` 作為 `user` 根目錄 |

根目錄不存在時視為不提供任何 preset，而非失敗：使用者根目錄在寫出第一個本機 preset 之前並不存在，而指定了沒有任何根目錄提供的預設值，在解析時本就會明確報錯。

### 可寫根目錄屬於本包，隨附根目錄屬於 app

`<dshHome>/.agent-presets` 是個人自有 preset 的所在，正如 `<dshHome>/skills` 是其自有 skill 的所在（[`dsh-skill-filesystem`](../../skill/skill-filesystem/README.md)），因此 roster 自行推導它，而不等某個部署記得設定——一個什麼都沒配的啟動器同樣能發現並創作 preset。它追加在全部已設定根目錄**之後**，從而保持靠前的根目錄贏得重複 id：隨附的 `standard` 仍然遮蔽一個佔用該名字的家目錄目錄，而 `copy()` 會拒絕該 id，不會落下一個無人解析得到的 preset。

根目錄在服務構造時解析一次。若根目錄集合在一次 `list()` 與依據其答案執行的 `copy()` 之間發生變化，寫入的將是呼叫方從未見過的目錄。

`includeUserRoot: false` 使 roster 只覆蓋 `roots`。把 preset 限制在自有目錄內的部署需要它，任何釘住確切 roster 的測試同樣需要——否則將由這臺機器真實的 `<dshHome>` 決定 roster 的內容。

隨附根目錄仍然是裝配事實：它位於已安裝 app 自身設定的旁邊，那個路徑只有該 app 能解析。

### 預設 preset 是一項使用者設定

當組裝中存在 settings 提供方時，本外掛程式會註冊 `agent-presets` 命名空間，並以 `config.default` 作為其組裝 base，因此使用者文件會層疊覆蓋部署方的工程預設值：

```yaml
agent-presets:
  default: minimal
```

該值在每次解析時讀取而非快照，因此熱重新載入的文件對**此後建立**的工作階段生效，而每個執行中的工作階段仍停留在它當初據以組裝的 preset 上。清空使用者欄位即重新繼承組裝預設值。若預設值指向沒有任何根目錄提供的 preset，寫入時不會報錯，而在下一次 `resolve()` 時失敗——名單是一個活動目錄，此刻不存在的名字，等到某個工作階段真正索取時可能已經存在。

## 掛載會拒絕什麼

直接掛載的子樹不會出現在 `ctx.loader.entries()` 中，因此沒有任何啟動審計能覆蓋它。`mount()` 因此自行校驗結果可用，並拒絕三種情況。

**目標上下文沒有 scope。** 掛載到不帶 agent scope 的上下文，會把該 preset 的工具註冊成全域性的，作用於行程內每一個 agent。

**某一行始終未進入可用狀態。** 模組匯入失敗或外掛程式拋錯的行，loader 已經會拒絕；剩下的情況是某一行仍在等待該組裝從未提供的服務，審計會指名這種情況。

**某一行把服務發布進了根 realm。** 這類服務是行程級全域性的，因此第二個發布同名服務的 preset 會與第一個相撞，宿主讀取方也會把某一個 preset 的實例當成所有工作階段的。確實需要自帶服務的 preset，應把它放在 `isolate` realm 之後——entry 本機 realm 讓兩個 preset 的同名服務互不相干，正如它從前隔開兩個工作階段——否則該服務應改放進宿主組裝。

最後一條規則由本包的執行時期不變數在每次服務通知時複查，因為從定時器或非同步續體中發布的行會繞過一次性審計。

## preset 文件是輸入，不是持久化目標

只要 Loader 認為設定變了，它就會把樹寫回原始檔——而一個行釋放自己的 fiber 就足以讓它這麼認為：該 entry 被標記 `disabled`，隨即觸發寫回。若繼承該行為，一個工作階段的執行時期狀態就會被燒進所有工作階段共享的文件裡：YAML 往返會抹掉註解，而對隨附的只讀 preset，`writeFile` 還會在 `setTimeout` 內拋出無人接管的 rejection。

因此被掛載的子樹把 `write()` 覆寫為空操作。本包不寫任何組裝；創作組裝是另一件獨立且顯式的操作。

## 信任

preset 就是組裝，因此一個 preset 的權限恰好等於它所引用的外掛程式。`user` preset——無論由人還是由 agent 寫出——與 shell 訪問權限同級；`trust` 欄位的存在是為了讓消費端呈現這一差異，而不是用來強制隔離。

## 模型體驗

Indirectly, through the plugins a standing composition registers, which own every tool schema and prompt section the preset makes visible to the agents joined to it.

#### KV Cache effect

在一個 agent 的整個生命週期內保持前綴穩定：組裝只裝入一次，發生在 agent 發布之前、因而也在它的首個請求之前，且在 agent 執行期間不再重新讀取。為新工作階段選擇不同的 preset，只會為該工作階段建立不同的前綴，無法讓任何已在執行的工作階段失去快取複用。

## 已知限制與暫緩事項

- **位於可寫根目錄之外的 preset 可被發現卻無法刪除** —— `remove()` 拒絕任何不在**第一個** `user` 根目錄下的 preset，因此一個既設定了自有可寫根、又保留 `includeUserRoot` 的部署，會列出並掛載 harness home 下的 preset，卻對每次刪除回答「它不在可寫 preset 根目錄之下」。roster 按設計只有一個可寫根；只想要自有根的部署應設定 `includeUserRoot: false`。
- **工作階段一旦產出內容便無法更換 preset** —— `recompose` 把**空白**工作階段的父作用域重鏈到另一個常駐掛載，且僅限空白工作階段：切換已執行過的組裝會抽走模型已呼叫的工具。更改預設值隻影響此後建立的工作階段。
- **代際只以組裝文件為鍵** —— stamp 檢查只察覺 `agent.cordis.yml` 的變化，察覺不到旁邊 skill 文件或資產的編輯；那些編輯要等組裝文件本身變動或行程重新啟動才達到新工作階段。
- **被替代的代際永不回收** —— 已加入的工作階段保持其執行所在的代際，而名單沒有加入計數可以判斷最後一個何時離開，因此整棵子樹一直掛到行程結束。代價按代際計而非按工作階段計，但並非為零：`dsh-skill-filesystem` 預設監聽自己的根目錄，因此每一輪「編輯後建工作階段」都會新增一套活的 watcher。上限取決於組裝被編輯的頻率——而設定頁的編寫流程把這件事從「每次部署」變成了「每次保存」。要回收就需要給常駐掛載加上已加入 agent 的計數；見 `ensureStanding` 處的 `TODO`。
- **副本從不被實際掛載以校驗** —— 它與來源逐位元組相同，因此磁碟上已壞的來源會產出與來源同樣損壞的副本；發現程序的健康檢查會在下一次讀取名單時把兩行都標出來，而不是把失敗推遲到工作階段啟動。
- **健康是形狀檢查，不是掛載** —— 發現程序只證明組裝能以載入器方言解析、由具名行組成，不證明每一行的模組都能解析並激活；引用不存在的包的行仍在第一個工作階段處失敗，並回滾該工作階段的建立。
- **副本是會漂移的快照** —— 升級部署不會更新隨附 preset 的副本，本層也沒有表達「standard 加一處改動」的 patch 語義（那是 bundle 層 `cordis.patch.yml` 的能力）；隨附集合自己也接受同樣的代價——`cordis` 與 `code` 就是 `standard` 的完整副本——換來整份組裝在一個文件裡可讀。
- **根目錄掃描不做監聽** —— 每次讀取都實際訪問檔案系統，這讓名單保持新鮮，但每次 `list()` 會對每個根目錄產生一次 `readdir`。
