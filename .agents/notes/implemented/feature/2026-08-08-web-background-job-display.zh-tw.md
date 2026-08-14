# Agent Note: Web 背景工作展示

Status: implemented

[English](2026-08-08-web-background-job-display.md) | [简体中文](2026-08-08-web-background-job-display.zh.md) | 繁體中文

## 問題

`ctx.jobs` 已經承載了 harness 在後臺啟動的全部長時工作——`bash`、`pwsh`、`pty-send`，以及一次性後臺 subagent——但它唯一的讀者是模型。[`dsh-tool-jobs`](../../../../packages/jobs/tool-jobs/README.md) 暴露了 `job_list`、`job_output` 和 `job_kill`，除此之外沒有任何東西觀察這個登錄檔。

於是 Web 端的人類看不到建置正在跑，分不清一個任務是已經完成還是卡死，也無法把它停掉。唯一的痕跡是 transcript 裡更早某處那張列印了 job id 的 `run_in_background` 工具卡片，而那張卡片此後再也不會更新。

工作階段 header 本來就是每工作階段後臺活動的落點：[`dsh-client-ui-subagent`](../../../../packages/client/ui-subagent/README.md) 把 subagent 目錄貢獻到 `conversation.session.header.actions`。位置沒有爭議。缺的是任何一條把任務狀態送到瀏覽器的通道。

## 決策

任務狀態以**每工作階段一幀的整份快照**到達瀏覽器，在登錄檔每一個會改變該工作階段可見內容的提交點推出。用戶端保持一份 last-wins 映像檔，由一個 header 入口渲染。沒有 RPC，沒有輪詢，用戶端不需要任何過期狀態管理。

本次只交付清單。每個任務的流式輸出與人類發起的中斷是各自獨立的階段，而通道的形狀讓兩者都不必推翻它。

### 線路形狀

mux 流中的一幀：

```ts ignore-check
| { type: 'session/jobs'; sessionId: SessionId; jobs: JobView[] }
```

`JobView` 是瀏覽器安全類型，由載體在 [`packages/host/apiproxy/src/api/jobs.ts`](../../../../packages/host/apiproxy/src/api/jobs.ts) 裡擁有，與其他領域契約並列，線路 schema 就在旁邊的 `jobs.schema.ts`：

```ts
import type { JobId } from '@deepseek-ai/dsh-jobs/brand'

export interface JobView {
  id: JobId
  kind: string
  label: string
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  detail?: string
  startedAt: number
  finishedAt?: number
}
```

`JobId` 取自不相依性 cordis 的 [`@deepseek-ai/dsh-jobs/brand`](../../../../packages/jobs/jobs/src/brand.ts) 葉子——與 `api/subagents.ts` 已經在用的 `@deepseek-ai/dsh-llm/brand` 匯入是同一種安排，因為 `dsh-jobs` 根出口會牽到 `dsh-agent`，即便只作類型也無法被用戶端程序觸及。和本倉庫其他每一個非根子路徑一樣，它帶有顯式的 `tsconfig.base.json` `paths` 條目；沒有這一條，Typert 分析器會把該 specifier 解析到 `lib/types/` 並判定該引用未被匯出。

線路上的 `kind` 是 `string` 而非 `JobKind`。kind 對映由生產者外掛程式按聲明合併擴充，用戶端建置無法枚舉這個閉集；遇到無法識別的 kind，呈現層走一條有文件的默認分支。

`JobSnapshot` 的三個欄位被刻意省去：`ownerSession`（幀的 `sessionId` 已經帶了）、`reported`（內部的通知投遞位，對使用者無意義），以及 `outputLimitBytes`（生產者擁有的模型呈現策略）。

這一幀帶整份快照而非增量，理由就是 [`session/queue`](../../../../packages/host/apiproxy/src/api/events.ts) 為自己寫下的那條：啟動、中斷、結帳、重連，以及第二個瀏覽器分頁標籤，全都透過同一個權威值收斂。一個工作階段的任務集是個位數，幀很小。

### 任務登錄檔變更訂閱

`JobRegistry` 擁有一個觀察方法：

```ts ignore-check
abstract onJobsChanged(listener: JobsChangedListener): () => void
```

它在每一個會改變 `list(owner)` 返回內容的提交點**之後**觸發：`start()` 末尾的註冊、`kill()` 裡轉入 `stopping`、結帳，以及 `disposeOwner()` 執行的移除。`owner` 為 `undefined` 表示一個無主任務發生了變化，因而每一個呼叫方的檢視表都變了。

監聽器按 owner 而非按任務分粒度。唯一的消費端推的是整份快照，逐任務記錄到手即棄——而且逐任務的訂閱根本無法表達 owner 銷毀時的移除，除非發明一個別處都不需要的墓碑狀態。

`onJobDone` 不是它的子集。後者按 first-wins 語義投遞終態記錄和確切的 owner `Agent`，`dsh-tool-jobs` 把這套語義與 `reported` 綁在一起；`onJobsChanged` 是純觀察，不含任何投遞含義，也不把任何東西標為已上報。監聽器拋錯被包住且從不 await，與 `onJobDone` 一致，每次註冊都是呼叫方 fiber 上的 effect。

服務銷毀刻意什麼都不通告。每個 `onJobsChanged` 註冊都是登錄檔自身 fiber 上的 effect，等到 teardown 清空 store 時監聽器早已消失；觀察者透過自己的銷毀而不是一份最終空集來得知登錄檔離開了。

### api-proxy 載體

`mux()` 訂閱 `ctx.jobs.onJobsChanged` 並推送 `session/jobs`；訂閱 baseline 緊挨著既有的 `session/subscribed` 控制幀寄出，讓重連的用戶端在渲染前就是最新的。

載體守著四條規則：

- **絕不 resume。** 變更推送用監聽器給出的確切 `Agent` 調 `jobs.list(owner)`，即使該 owner 的 scope 正在拆除、按 id 尋找已經查不到，它依然正確。baseline 則讀 `ctx.jobs.list(ctx.agents.get(session.id))`——不觸發 resume 的登錄檔讀法，沒有活體 Agent 的工作階段正確地只得到無主任務。兩條路徑都不碰 [`api-remotes` 的 Agent 解析器](../../../../packages/api/remotes/src/agent-lookup.ts)，那個解析器會把查詢變成復活冷工作階段的副作用；列個任務不該讓使用者隨手劃過的工作階段活過來。
- **無主變更要扇出。** `owner` 為 `undefined` 時向每一個已訂閱工作階段推一份新快照，因為無主任務對所有呼叫方可見。
- **保持選填。** 載體讀 `ctx.get('jobs')`。沒有掛登錄檔的組合不發任何幀，用戶端也就不渲染入口——`sessionProjections` 在這個文件裡已經是這個姿態。
- **沒有就不說。** baseline 只為清單非空的工作階段推送，用戶端上鍵缺失即表示空清單。把清單清空的那次變更仍然推 `[]`，因為這一個轉換是用戶端唯一無法從「缺失」推斷出來的東西。

### 用戶端映像檔

`SessionListState` 帶有 `jobsBySession: Readonly<Record<SessionId, readonly JobView[]>>`，由 `SessionManager` 擁有，按 last-wins 從幀摺疊而來；被清空的集合存為缺失的鍵，使「缺失」與 `[]` 成為同一種表示。

它放在清單映像檔而不是 `Session` 上，有三個理由：header 入口本來就透過 `useSessions` 讀清單狀態；沒有任何東西需要 `session/queue` 那種實例化前的緩衝（沒有 composer 行為相依性任務）；將來側欄加指示器時不必再開第二條通道。

兩處清理讓它保持誠實。重新訂閱時 manager 丟棄該工作階段的映像檔——`session/queue` 已經遵循的規則，因為新的 baseline 正在路上，而這一世代對空集不發 baseline，被留下的清單會變成幽靈。`host/session-removed` 時再丟一次：owner 銷毀在登錄檔側已經移除了記錄，但那件事落在 mux 流上而這一幀走 host 流，兩者沒有相對順序。

### header 入口

[`@deepseek-ai/dsh-client-ui-jobs`](../../../../packages/client/ui-jobs/README.md) 在 `conversation.session.header.actions` 註冊一個條目，排在 subagent 目錄之後。呈現契約歸它自己的 README；值得記在這裡的決策是：工作階段沒有任務時控制元件根本不渲染；活躍角標為零時省略，讓只剩歷史的工作階段保留一個安靜的入口；終態行保持可見，因為失敗任務的 `detail` 是其失敗唯一可讀之處。

因此一個執行中的一次性後臺 subagent 會同時出現在那裡和 subagent 目錄裡。兩者回答不同的問題——目錄負責進入子工作階段的 transcript，而這個清單是中斷能力唯一可能附著的控制代碼——在這裡封鎖 `kind: 'subagent'` 會讓中斷那一期恰好對這批任務沒有入口。

### 刻意不做的事

**沒有任何 Web 路徑呼叫 `ctx.jobs.read()`。** 它消費唯一的輸出遊標，瀏覽器讀一次就悄悄拿走了模型 `job_output` 永遠看不到的位元組。這該是一條有測試兜底的不變數而不是一條約定，因為它的故障在呼叫點完全不可見。

**不做中斷。** 那一期欠一個 seam 目前沒有回答的決策：`kill()` 會把終態投遞標為已上報，所以照今天的契約寫出來的人類中斷，會讓模型一直以為它的任務還在跑。

**幀上不帶輸出水位。** 輸出那一期的增量通道纔是錨點欄位該出現的地方；現在加就是一個沒有讀者的欄位。

## 備選方案

**訊號幀加 RPC 拉取，即 subagent 目錄的形狀。** 推一個無 payload 的 `jobs-changed` 訊號，防抖後用一元 RPC 重讀權威狀態。subagent 目錄就是這麼做的，代價在 [`SessionManager`](../../../../packages/client/runtime/src/client/sessions/manager.ts) 裡一覽無餘：`catalogInflight` 做單飛行、`catalogStale` 在成員幀落於請求中途時補一次尾拉、`updateCatalogActivity` 既就地打修補程式又往運送中請求裡寫一份好讓比幀更舊的回應被覆蓋、`parentAvailableOverride` 重放一個過期的 `false`，還有重連時逐一重拉每個打開的目錄。這套裝置之所以存在，是因為目錄的權威被劈成兩半——持久血緣來自投影，活躍度是回應時刻的取樣——而任務沒有持久的那一半，不該繼承這份複雜度。它還恰好在輸出那一期最在意的時刻失效：任務結帳，輸出流立即關閉，狀態卻要等防抖加一次往返纔到，那段視窗裡 UI 顯示一個流已死的執行中任務。

**只在彈層打開時輪詢，不改 seam。** 最省事，也是唯一不碰 `JobRegistry` 的選項。它無法在不常駐輪詢的前提下支持觸發器上的常駐計數，而後面兩期反正都需要一條真正的變更訂閱，所以它省下一週又還回去。

**基於持久任務事件的 session-projection 單元。** 投影單元在已提交的工作階段事件上摺疊，所以這條路要先讓任務生命週期變持久——`job/started` … `job/settled` 作為一對獨立的開合括號，由最後一個 [`session/end-seed`](../../../../packages/core/session/src/types.ts) 把未配對的開括號標為死歷史，與 compaction 括號已有的做法完全一致。它在用戶端確實更省：`dsh-tool-todo` 用十五行的單元展示了整套模式，而現成的 `session/projection` 幀、history-tail 塊和持久化 checkpoint 快取本可以承載這批資料，無需新線路面、無需載體訂閱、無需 manager 狀態。否決它，是因為這要拿一次持久格式變更去換一個瀏覽器清單，而且它並不能延伸到最需要它的那一期：[`spill/`](../../../../packages/spill/README.md) 的存在正是為了讓超大工具輸出留在日誌之外，所以流式任務輸出無論如何都不能騎在持久事件上。如果持久任務歷史將來憑自身價值站得住，本設計不阻擋重新考慮它。

**複用 `dsh-tool-jobs` 的 `PublicJobSnapshot`。** 欄位幾乎就是對的，但它屬於面向模型的控制面。瀏覽器程序從一個 tool 包匯入線路類型，會把用戶端呈現耦合到面向 prompt 的決策上，並把一個 host-only 包拖進用戶端建置。

**並進 subagent 目錄做成統一的「活動」面板。** 一個入口而不是兩個。否決的理由是 `SubagentCatalogAction` 已經 605 行，其主題是含已結束子工作階段的持久工作階段血緣樹；行程域的任務是第二套資料模型，身份、生命期和可用動作都不同，而目錄的懶展開分支、時長與 token 契約全都要重寫才能容納它們。

**跨全部工作階段的 host 全域性任務清單。**「顯示所有執行中任務」的字面讀法。否決是因為登錄檔的鑒權圍欄是按 owner 工作階段的，全域性讀需要一條新的訪問規則，而且全域性清單不該出現在某個工作階段的 header 裡——它需要側欄裡自己的位置。本設計沒有阻擋後續再加；按工作階段的幀就是同一批資料。

## 測試

[web e2e 場景](../../../../apps/web/tests/background-job-list.e2e.ts)是端到端的證據，且無需金鑰：一次真實的 `run_in_background` bash 呼叫註冊進 `ctx.jobs`，header 的計數與行在沒有任何使用者操作的情況下出現，透過登錄檔殺掉該任務後打開著的清單翻到生產者給出的 detail。它斷言的是整條投遞鏈路，而不是其中某一層。

在它之下，[`jobs-local`](../../../../packages/jobs/jobs-local/tests/jobs.spec.ts) 釘住變更訂閱的全部四個提交點、對拋錯觀察者的包容，以及顯式銷毀與 fiber 拆除兩條路徑上的註銷；[`api-proxy-jobs`](../../../../packages/host/apiproxy/tests/api-proxy-jobs.spec.ts) 釘住「非空才發 baseline」、三次變更推送、被丟棄的內部欄位、無主扇出、不 resume 的保證，以及沒有登錄檔的組合；用戶端各套件釘住 last-wins 摺疊、缺失鍵表示、兩處清理，以及元件的排序、時長與關閉行為。

## 影響

**漏掉一個提交點會漏行。** 如果 `disposeOwner()` 的移除有朝一日不再觸發訂閱，用戶端會一直留著已經不存在的任務，直到工作階段消失。整份快照的形狀讓這件事可復原而非損壞——下一次正當變更就修好了——但銷毀路徑是最容易被忘掉的一條，所以它自帶測試。

**無主任務的扇出很容易做漏。** 只推給變更 owner 所在的工作階段，對有主任務是對的，對處處可見的無主任務則是悄悄錯的。這個 bug 只會在會建立無主任務的組合裡顯形，所以載體套件直接覆蓋了它。

**UI 的集合不等於登錄檔的集合。** header 顯示的是「一個工作階段能看到什麼」，所以別的工作階段擁有的任務在這裡永遠不出現，儘管登錄檔裡有它；而由於登錄檔是行程本機的，一次重新啟動會清空所有清單，transcript 裡那些啟動它們的 `run_in_background` 卡片卻還在。無主任務是反過來的情形：它們會進入每一個工作階段的清單，正如 `list(caller)` 對每個呼叫方都報告它們。

**終態行會堆積。** 登錄檔把已結帳任務留到 owner 銷毀，所以一個跑了很多後臺命令的長工作階段會積出長清單。如果真的成為抱怨，給終態尾巴加上限是呈現層改動而非協議改動。

**`stopping` 今天幾乎不可達。** 只有模型的 `job_kill` 會產生它，所以這個狀態會被渲染但在人類中斷落地之前很少見到。現在就納入聯合類型，是因為把它留在外面會讓那一期變成一次線路變更。

**一個執行中的 subagent 有兩個入口。** 這是刻意接受的，且被限制在一次性後臺委派這一種情況。如果實際用起來讀著像噪聲，修法是呈現層的——可以讓目錄行引用那個任務，而不是讓任務清單隱藏這個 kind。

**新增非根子路徑必須補 `paths` 條目。** `@deepseek-ai/dsh-jobs/brand` 得先登記進 `tsconfig.base.json`，Typert 分析器才會接受該引用。它的故障表現是一條來自遠離改動處的生成器的、令人困惑的「not exported by」錯誤，所以這個條目是新增子路徑的組成部分，而不是最佳化。
