# @deepseek-ai/dsh-skill

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

純 agent skill（代理技能）提供方登錄檔。

該包負責 `ctx.skills` 介面。它不知道 skill 來自本機文件、嵌入式外掛程式資料、HTTP 還是其他後端；提供方透過 `ctx.skills.registerProvider(...)` 註冊這些來源。已發布的本機實作是 [`@deepseek-ai/dsh-skill-filesystem`](../skill-filesystem)。

登錄檔基於 [`@deepseek-ai/dsh-scope`](../../core/scope) 採用宿主 + 按 scope 的分層結構，即工具登錄檔確立的形態：註冊落入呼叫方上下文 scope 對應的層——宿主行與 repository 外掛程式落入全域性層，由 agent preset 常駐組合掛載的外掛程式落入該 preset 的層——讀取時將全域性層與觀察 scope 的鏈合併，最近層直接贏得重名，rank 只在單層內裁決重名。

## 服務：`SkillRegistry`（ctx 鍵：`skills`）

### 公開 API

- `ctx.skills.registerProvider(create): () => void` 呼叫同步提供方工廠並向其傳入 `{ signal, invalidate }`，隨後以在呼叫方上下文所在層內唯一的 `provider.name` 註冊其只讀結果。同層重複提供方名稱會拋錯，`runtime` 為保留名稱；註冊失敗會中止訊號。精確的 Cordis disposer 會註銷提供方、中止訊號，並保持有序組合拆卸。
- `ctx.skills.snapshot({ cwd?, signal?, scope? })` 返回觀察 scope 各層合併後、與呼叫策略無關的 `{ skills, complete }` 觀測。任一提供方呼叫被拒絕或顯式報告發現不完整，或有界重試期間又發生目錄修訂時，`complete` 為 false；該次觀測提供的候選項仍保留在此結果中，但該結果絕不快取。
- `ctx.skills.list({ cwd?, signal?, scope? })` 借用只讀檢視表選項，然後返回當前工作區中的全部勝出摘要；這些摘要在全域性層與觀察 scope 鏈之間合併，並按名稱排序。消費端在自身邊界呼叫 `isModelInvocable(skill)` 或 `isUserInvocable(skill)`。
- `ctx.skills.get(name, { cwd?, signal?, scope? })` 在發現和載入中使用同一組只讀選項和勝出候選項；在發現或快取命中後重新檢查取消，讓提供方載入與訊號競速，驗證已載入定義，然後無論呼叫策略如何都將其返回。
- `ctx.skills.register(skill): () => void` 將只讀執行時期嵌入式 skill 註冊進呼叫方上下文所在層，省略時新增允許模型和使用者呼叫的策略以及 `provider: "runtime"`。同層同名執行時期註冊使用先到先得：重複項會記錄警告，並獲得無操作 disposer。成功註冊會返回精確的 Cordis disposer，以供有序組合拆卸。

### 事件

- `skills/change` 是一條不帶過濾條件的失效通知，在提供方或執行時期貢獻註冊或釋放後，以及活動提供方的註冊控制觸發失效後寄出。它不攜帶目錄或 diff；每個消費端都使用自身的尋找選項重新取得 `snapshot()`。監聽器拋錯或 Promise 拒絕會被記錄，既不能否決登錄檔變更，也不能阻止後續監聽器執行。

### 設定

| 欄位 | 預設值 | 含義 |
|---|---|---|
| `collectCacheMaxEntries` | `128` | 記憶體中保留的最大已完成 cwd/提供方目錄數。 |

### 呼叫策略

`SkillSummary.invocation` 是一個必填的類型化策略對象，其正向布林欄位 `modelInvocable` 和 `userInvocable` 分別描述兩個介面。提供方會在每個候選項和定義中返回這一已解析形狀；只有 `SkillRegistration` 輸入可以省略它，此時 `register()` 會補入 `{ modelInvocable: true, userInvocable: true }`。登錄檔保留全部四種組合，使一次發現結果可以同時服務面向模型的工具、面向使用者的命令和受信內部呼叫方，而不會混淆各自的目錄。

| 策略 | 模型 | 使用者 |
|---|---|---|
| `{ modelInvocable: true, userInvocable: true }` | 包含 | 包含 |
| `{ modelInvocable: true, userInvocable: false }` | 包含 | 排除 |
| `{ modelInvocable: false, userInvocable: true }` | 排除 | 包含 |
| `{ modelInvocable: false, userInvocable: false }` | 排除 | 排除 |

### 共享的面向模型渲染

`renderSkillContent(skill)` 把一個已載入 skill 渲染為規範的 `<skill_content>` 塊（轉義後的 `name` 屬性、資源提示、原樣正文）。它是兩條載入路徑的唯一真源：`dsh-tool-skill` 將其作為 `skill` 工具結果返回，並在使用者顯式的手勢邊界將其注入，因此無論載入由誰發起，模型看到的都是同一種形態。`escapeText` 隨之一並匯出，供要在同一標記框架中嵌入文案的消費端使用。該包還聲明 `skill-invocation` 這個 `MessageSource` kind（{ name, form: 'instructions' }），使用者顯式注入會把它打在自己的訊息上——transcript（文字記錄）消費端依據這份元資料呈現該次呼叫，而不是重新解析正文。

`isModelInvocable(skill)` 和 `isUserInvocable(skill)` 分別直接讀取對應的正向欄位。`ctx.skills.get()` 仍是受信且與策略無關的載入原語，因此每個面向使用者或模型的消費端都必須先執行與自身介面匹配的判定，再暴露或載入 skill。

## 提供方約定

提供方工廠同步執行，並接收一項註冊作用域內的控制能力。註冊失敗或釋放時，`control.signal` 會中止；僅當該精確註冊仍處於活動狀態時，`control.invalidate()` 才會清除已完成目錄，因此延遲回呼無法影響同名替代項。不可變提供方可以忽略該控制能力。遠端設定、身分驗證和發現應在提供方的 `list(options)` 呼叫中完成，該呼叫會被等待。返回陣列是完整發現的簡寫形式；若提供方已收集到可用候選項，卻無法建立權威觀測，則返回 `{ candidates, complete: false }`。提供方對象、尋找選項、候選項和定義都以只讀方式借用，而不是克隆或重新綁定。提供方應遵守 `options.signal`；取消後，登錄檔也會停止等待不協作的發現或載入。

登錄檔在快取前驗證候選項，在返回前驗證定義。勝出提供方會收到同一候選項和不透明 `locator`，兩者都是它從 `list()` 返回的內容，從而支持後端專用文件、URL、id 或版本控制代碼。呼叫方和提供方必須保持只讀約定。

違反約定時會快速失敗。`list()` 返回的 Promise 被拒絕會被視為瞬時來源失敗，並省略其結果。顯式的不完整觀測仍會為 `list()` 和 `get()` 提供其候選項，但會使聚合快照不完整且不可快取。提供方或執行時期修訂發生變化時，會丟棄正在進行的結果並重試一次。如果這次重試也被後續修訂取代，則返回其候選項，並將結果標為不完整且不予快取，以免持續觸發失效的提供方一直佔用呼叫方。單層內重複名稱依次按 rank、提供方註冊順序和提供方本機順序解決衝突；跨層則由最近 scope 的條目贏得名稱。摘要按 skill 名稱排序。

定義仍採用漸進式載入。`get()` 每次呼叫都會向勝出提供方請求正文，而不是在此登錄檔中快取正文。若返回定義的名稱不同於所選候選項，系統會拒絕該過時選擇，並由登錄檔在內部使該精確提供方失效，以便下一次快照重新發現其目錄。

## 執行時期 skill

`ctx.skills.register(...)` 是嵌入式執行時期 skill 的便利介面。執行時期 skill 使用 rank `250`：項目提供方可覆蓋它們，它們則覆蓋已發布本機提供方的自訂根目錄和使用者根目錄。執行時期定義和巢狀資源元資料均以只讀方式借用；服務只物化一個頂層定義，以補入省略的呼叫策略和 `provider` 預設值。執行時期貢獻內的註冊使用先到先得，因此重複貢獻無法透過其 disposer 移除當前生效的貢獻。

## 消費端邊界

登錄檔不渲染模型指引，也不註冊面向模型的工具。[`@deepseek-ai/dsh-tool-skill`](../tool-skill) 消費 `ctx.skills` 以提供持久工作階段目錄和 `skill` 工具，因此提供方仍與模型介面獨立。

## 模型體驗

透過 `dsh-tool-skill` 間接影響模型；該包將提供方摘要渲染到持久的初始目錄或替換目錄訊息中，並將已載入指令渲染到已保留工具結果中。

#### KV Cache 影響

不直接影響提示詞。指定的消費端負責持久初始目錄，以及失效後的僅附加式目錄替換。

## 已知限制與暫緩事項

- **失效由提供方驅動程式**：登錄檔沒有 TTL，無法推斷任意遠端來源是否已發生變化；每個可變提供方都必須保留其註冊作用域內的 `invalidate()` 能力，並由自身的觀測機制呼叫它。
- **提供方依次查詢**：一個回應取消但速度緩慢的提供方會延遲之後註冊的所有提供方；取消會停止呼叫方等待，但無法終止不回應取消的提供方持續執行的工作。
- **不保留不完整觀測**：被拒絕的提供方會被省略，顯式提供的候選項也僅在當前尋找中可用；登錄檔既不負責上一份可用目錄，也不負責逐提供方診斷。
- **重名項的裁決採用先到先得**：系統會記錄並隱藏層內較晚出現的低優先級候選項，較近的層會靜默遮蔽較遠的層；不提供檢查全部被遮蔽定義的 API。
