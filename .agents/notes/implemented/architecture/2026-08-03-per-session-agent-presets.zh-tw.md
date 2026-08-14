# Agent Note: 工作階段的 agent 由一份 preset cordis.yml 組裝而成

Status: implemented

[English](2026-08-03-per-session-agent-presets.md) | [简体中文](2026-08-03-per-session-agent-presets.zh.md) | 繁體中文

## 問題

一個 `dsh` 行程服務多個工作階段，但決定 agent（代理）究竟是什麼的那套組裝——它的工具、人設、提示詞段落、委派後端——由啟動器所引導的 `cordis.yml` 一次性固定給整個行程。若某個部署希望一個 benchmark 精簡 agent 與一個完整編碼 agent 並存，就必須跑兩個行程；而現有的變通方案（`apps/cli/config/minimal.cordis.yml`，一個用來停用工具行的 `--config` 覆蓋層）會一次性改變所有工作階段。

對"讓工作階段自選組裝"最直覺的理解，是 loader 需要新增一層。其實不需要。[`dsh-tools`](../../../../packages/core/tools/README.md) 與 [`dsh-system-prompt`](../../../../packages/core/system-prompt/README.md) 本就按呼叫方上下文的 scope 分層歸檔註冊，而且 [agent 本身就是一個註冊 scope](2026-07-08-agent-scope-contexts.md)。此前缺的只是一種把整份 `cordis.yml` 指向某一個 agent scope 的辦法。

## 決策

**preset** 是一個目錄，其中放置一份 `agent.cordis.yml`。agent 工廠的 `setup(agentCtx)` 把它作為 Cordis `include` 子樹，掛載到該 agent 的 scope 上下文之下。entry 上下文沿原型鏈連到子樹被掛載時所在的上下文，因此 preset 內部的每一次註冊都落進該 agent 的分層，並隨 agent 一起解除安裝。沒有任何登錄檔新增分層，也沒有任何已在執行的工作階段被觸及。

組裝劃分為兩個平面，依據是什麼必須共享，而不是什麼感覺上與 agent 有關：

| 平面 | 實例數 | 內容 |
|---|---|---|
| 宿主 | 一份 | 登錄檔本身（`tools`、`systemPrompt`、`agents`、`agent-loop`、`sessions`）、跨工作階段設施（持久化、查詢、投影、儲存、設定、憑據、遙測）、這些設施所解析的 subagent provider，以及 web 宿主 |
| agent | 每工作階段一份 | 單個 agent 對這些登錄檔的貢獻：工具外掛程式、人設與提示詞段落、壓縮策略 |

模型路由不進 preset。`installAgentLlmTarget` 已經是 provider、model 與 reasoning effort 的按 agent 可替換點；而掛在 preset 內部的 LLM 配接器永遠不會被 `agent-loop` 解析到，因為後者位於宿主平面。

部署交付哪些 preset，取決於 `apps/cli/config/agent-presets/` 下有哪些目錄；清單是那份目錄清單，而不是在此另抄一份。

掛載默認按工作階段進行。實測一份十二行組裝每工作階段約 3ms、約 600KB，因此隔離比任何共享方案都更划算；而由使用者或 agent 寫出的 preset 也因此擁有儘可能小的影響面。確實自帶昂貴單例的 preset，可以用 Cordis 自身的 `isolate` 詞彙顯式選擇共享：命名 realm 的 label 是行程級全域性的，因此兩棵子樹只要寫同一個 label 就解析到同一個實例。

未指名 preset 的工作階段拿到哪一個，是一項使用者設定（`agent-presets.default`），疊在組裝自身的 `default` 之上——後者成為 `base`。兩層都需要：組裝裡的值是部署交付的東西，在完全沒有 settings 提供方時也必須照常工作；而設定是讓人不必去改一份可能並不屬於自己的 `cordis.yml` 就能調整的東西。

## 後果

**有效預設值在每次解析時讀取，絕不保存快照。** 快取下來就需要一個 `watch` 訂閱和一條重載路徑才能保持誠實，而解析後的 scope 本來就會重讀熱重新載入過的文件。讀穿也不只是省事，它讓邊界本身是對的：新值作用於**下一個新建的工作階段**，每個執行中的工作階段保持它被建置時的那份組裝。這條不變數正是 session 日誌從另一側執行的同一條——header 記錄工作階段**建立時**的 id，此後空白期的任何切換由 `agent-preset/selected` 事件記錄，因此讀取方解析的是兩者之和（`resolveSessionPreset`）、絕不單看 header：復原重建的是其歷史所產出的那份組裝而不是當下的預設值，冷讀記錄的 presenter 在那份組裝的層裡解析，閘道也會拒絕把一個活著的工作階段收編到它當前執行的 preset 以外的 preset 之下。快照會讓兩者恰好在設定改變的那一刻各說各話。


**直接掛載的子樹對啟動審計不可見。** 它不會把自己關聯到 `Entry`，因此不在 `ctx.loader.entries()` 中，`assertEntriesActivated` 也看不到它。改由掛載過程自行校驗各行，透過一個會公開自身 tree 的 `Include` 子類讀取。

**preset 能寫出 group，是因為 app 註冊了它。** 跨行共享 realm 就是一個 `cordis:group` 行，而住在本工作區之外的 preset——也就是 Harness home 下由人或 agent 創作的那些，正是這套設計的目的——無法按名字解析 `@cordisjs/plugin-group`：Node 向上尋找 `node_modules` 的路徑從那裡永遠走不到 harness。因此 `boot()` 把 `cordis:group` 與 `cordis:include` 並排註冊為 loader builtin，兩者都經由環境模組管線載入，而不相依性被包含樹自身的說明符解析。沒有它，上文那套 `isolate` 詞彙就只能一行一行地表達，提供方也永遠無法與它的消費端歸入同一組。

**preset 不得把服務發布進根 realm。** 這類服務是行程級全域性而非按工作階段的，因此第二個掛載同一 preset 的工作階段會與第一個相撞——而這次相撞表現為 `setup` 永遠觀察不到的未處理 rejection，留下一個看起來健康、實則組裝到一半的 agent。掛載改為直接拒絕它；本包的執行時期不變數還會在每次服務通知時複查，因為從定時器或非同步續體中發布的行會繞過一次性審計。

**失敗會讓 agent 回滾。** `setup` 在發布之前執行，因此掛載被拒絕會讓 `ctx.agents.create()` 失敗且不留殘留。這正是 `setup` 是唯一受支持呼叫點的原因。

**「preset 文件從不被回寫」這條斷言，必須先有失敗的可能。** 最初那版在一次普通掛載之後斷言文件未變，其實什麼也抓不到：Loader 只在認定 config 變了時才會走到寫路徑，而那份組裝裡沒有任何一行會自行銷毀。回歸用例改為植入一個自行銷毀的行——真實 preset 在每次 agent 被拆除時都會命中的形狀——並把組裝放在臨時根目錄而不是 `fixtures/` 下：沒有那個覆寫，Loader 會回寫它讀入的文件，於是提交進倉庫的 fixture 會被**恰恰是證明該缺陷的那次執行**改壞，之後每一次執行都拿改壞後的文件作比較從而透過。

**fiber 歸屬判定用對象同一性，而非 `uid`。** `uid` 是按 registry 計數的序號，因此兩個不同根下的 fiber 會在它上面撞號；按 `uid` 比較曾導致一個執行時期的子樹為另一個執行時期中發布的服務背鍋。`ctx.plugin()` 返回的是 thenable 的 `Object.create(fiber)` 包裝對象，與父鏈中出現的 fiber 永遠不同一，因此子樹在構造時捕獲自己的 fiber。

**preset 文件是輸入，絕不是持久化目標。** 只要 loader 認為設定變了，`EntryTree.write()` 就會回寫整棵樹，而一個外掛程式自我 dispose 就足以觸發——銷毀 agent 會 dispose 它的整棵子樹。若繼承該行為，它會重寫自己讀入的那份組裝，實際後果是第一次工作階段結束時把隨附 preset 截斷成 `[]`。子樹因此把 `write()` 覆蓋為空操作。

**按自身名字回查全域性登錄檔的外掛程式，在 preset 裡必然失效。** `ctx.tools.register()` 歸檔進**呼叫方**上下文的 scope，因此掛在 preset 裡的外掛程式只為一個 agent 註冊，而不帶 scope 的 `ctx.tools.get(name)` 理所當然查不到。`dsh-tool-skill` 正是這樣寫的，於是每次 preset 掛載都拋錯；現在它與自己註冊的那個定義比對。任何希望可被 preset 掛載的外掛程式，都必須持有自己的註冊對象，而不是按名字重新讀取。

**entry 本機 `isolate` realm 不僅對宿主不可見，對 agent 自身的 scope 同樣不可見。** 只有該組內部的行能解析到該服務。這正是讓 preset 的 `skills` 登錄檔歸屬單個 agent 而非共享的原因——同時也意味著：留在提供方組之外的消費端會悄然解析到宿主登錄檔，然後什麼都不貢獻。

**只有空白工作階段才允許切換。** 一旦跑過任何輪次，那段歷史就是在該 preset 的工具下產生的，替換會留下無法執行的已記錄 tool call，因此 `agentPreset.select` 返回 `agent-preset-locked`。空白期的切換保留 agent 與 session，只替換子樹——因為宿主丟棄了它建立的 `AgentHandle`，也沒有 delete RPC；而保留它們本身就是更好的結果，工作階段 id、workspace 掛接與 projections 都原地不動。該替換是"先卸後裝"（兩份組裝會把同名工具註冊進同一分層），因此它在拆除任何東西之前先解析新 preset，並在新組裝裝載失敗時復原原來的那一份。

**創作 preset 是一次 RPC，而且是特權 RPC。** 組裝是一個文件，但“去檔案系統裡改它”並不是瀏覽器能提供的操作，因此名單在 `select` 之外新增了 `read`/`write`/`remove`。這三者被固定在環回地址：組裝指明瞭一個工作階段所執行的外掛程式，因此讀取它是偵察，寫入它是任意能力。`list` 與 `select` 刻意保持為普通方法。名單只攜帶 id 與信任等級，而局域網用戶端的選擇器需要它；至於選擇本身，它看起來像提權——其中一個 preset 會掛載可編輯活動執行時期的工具集——但 `session.create` 本就接受 `agentPreset`，只固定切換會把同一能力留在隔壁一個方法上。這份能力也不由 preset 授予：部署自帶的默認 preset 本就帶著 `bash` 與檔案系統工具，因此任何被允許開啟工作階段的呼叫方，早已能以本行程的身份執行命令。約束是 id 自身的性質（`[a-z0-9][a-z0-9-]*`），在它成為目錄名之前就檢查，而不是事後再去審視拼接出的路徑；文字使用 loader 自身的 schema 與方言解析，因此保存不會留下任何工作階段都無法載入的文件。隨部署提供的 preset 拒絕寫入與刪除，因為部署自帶的那一份正是用來對照有問題的本機 preset 的——這也讓“先複製、再編輯”成為創作路徑本身，而非事後補充。

**在 agent 平面之外還有消費端的服務，不能搬進 preset。** 激進拆分把 `subagents` 登錄檔連同 spawn/fork 後端一起搬進了 delegation 組的 entry-local realm，於是 `dsh web` 直接起不來：`dsh-host-apiproxy` 是宿主行，它注入 `subagents` 來回答瀏覽器的跨工作階段查詢（`listChildren`、`followup`），因而永遠等待一個此刻只有工作階段才提供的服務。按工作階段各一份在兩個層面上都是錯的——provider 名只能註冊一次，第二個工作階段本來也會相撞。登錄檔與所有共享後端，包括[固定的 Codex 與 Claude Code 產品 provider](2026-08-10-product-subagent-providers-in-shared-host.md)，都屬於宿主平面；preset 只貢獻自己的 agent 應看見的委派**工具**，這些工具解析宿主登錄檔。`workflows` 保持 entry-local，因為 agent 之外沒有任何東西讀它。本該攔下它的是「檢索注入方」這一步，而它沒攔住：檢索必須覆蓋宿主包，而不只是 agent 平面的包。

**真實組裝測試若停用了某個宿主行，就無法審計該行。** web 組裝測試把 `api-gateway`——也就是 api-proxy 本身——當作「有外部副作用的行」停用了，而它恰恰是那個會以 pending 注入點名此次斷裂的行。現在它在啟用 api-proxy、並替換為 browse 目錄選擇器的前提下引導，啟動審計因此覆蓋整個宿主平面的注入圖；只有埠、資源目錄與遙測匯出器仍然關閉。

**preset 的包名必須從 harness 解析，而非從 preset 解析。** `EntryTree.import()` 按行所屬樹的 `baseUrl` 解析，而 `Include` 把它設為組裝文件所在的目錄。這對相對識別符號是對的，對包名卻是致命的：本機創作的 preset 位於使用者主目錄之下，Node 向上尋找 `node_modules` 永遠夠不到已安裝的 harness，因此每一個 `@deepseek-ai/dsh-*` 行都會匯入失敗，整個 preset 無法掛載。隨部署提供的 preset 掩蓋了這一點——它們本就在安裝目錄之內。掛載在插入子樹之前先記錄宿主組裝的基址，並把裸識別符號送往那裡，同時讓相對路徑繼續從 preset 解析，使它自帶的文件仍隨它一同遷移。發現它的正是那個把 preset 寫入臨時根目錄的真實組裝測試。

**preset id 對模型可見，必須寫入日誌。** 它決定工具集與提示詞，因此被復原的工作階段必須還原同一份組裝；記錄它屬於工作階段事實，而非執行時期狀態。它與 `cwd` 並列寫在工作階段頭部，並由工作階段摘要攜帶，使選擇器顯示的是某個工作階段實際執行的 preset，而非部署當前的預設值。

**持久化的頭部欄位，在每個後端都寫入之前都算不上持久。** `agentPreset` 帶著正確的理由落在了 `SessionHeader` 上，而兩個持久化後端都沒有攜帶它：JSONL 頭部行、SQLite `sessions` 行、以及派生的查詢索引各自逐列對映頭部，於是被復原的工作階段回來時沒有 preset，所有據以命名它的表層隨之失聲。`summarizeCold` 是同一個形狀——它手工拼裝冷清單行，而沒有複用共享的投影。聲明為持久的欄位，需要一個跨越真實儲存的測試，而不只是聲明它的那個類型。

**這個選擇屬於它仍然可用的那個介面。** composer 座位幾乎一生都處於停用狀態，因為一旦跑過一個輪次，preset 即固定。它移到了新建工作階段介面、工作區選擇器旁邊，選擇在那裡是**暫存**的：該介面先於它要應用到的工作階段存在，暫存值在某個工作階段成為當前工作階段且仍為空白時落地——這既覆蓋工作區連線新建的工作階段，也覆蓋它複用的那個空白工作階段，而搭 `sessions.create` 的便車會漏掉後者。它一經使用即被清空，與旁邊的工作區選擇器一致。至於執行中的工作階段在跑什麼，則是其標題旁的一個只讀標籤：在那裡放控制元件，等於承諾一次宿主會斷然拒絕的切換。

**preset 放大的是宿主本來就在付的代價：沒有任何東西會 dispose 一個 agent。** 用 `--expose-gc` 對隨附組裝實測：一個存活的 agent 在 `minimal` 上約佔 0.17 MB、在 `standard`/`cordis` 上約 1.31 MB，掛載耗時分別約 38 ms 與 135 ms；行程裡第一個 agent 另需約 7 MB，那是 Node 首次 import 模組的一次性成本，此後每次掛載共享。成長嚴格線性——10、30、50 個的單個增量一致——且 dispose 後基本全額回收（50 個 `standard` 佔住 57.8 MB，釋放後全部歸還）。所以對象圖並不洩漏，缺的是生命週期。`dsh-host-apiproxy` 建立後直接丟棄 `AgentHandle`，`archiveSession` 只改工作區登錄檔，`AgentRegistry` 沒有驅逐機制，而宿主裡唯一一處 dispose 是 JSON-RPC 伺服器自身的關停。於是一個 web 宿主會留住它接觸過的每一個工作階段，組裝 preset 之後每個約 1.3 MB，而在此之前約 0.2 MB。注意：剪枝掛載登錄檔在這裡沒有用——它丟棄的是 fiber `uid` 已清空的記錄，而永不死亡的 agent 永遠不會清空它。

- 殘留 TODO：idle agent 驅逐——工作階段持久化後 dispose，復原時重新掛載。它屬於持有 handle 的那個宿主，不屬於本 seam。

## 考慮過的替代方案

**在 scope 登錄檔中新增 preset 分層。** `ScopedLayers.merge()` 把全域性層與恰好一個精確 scope 層合併。新增中間層可以讓多個工作階段共用一份已掛載的組裝，但它要改動 `dsh-scope` 及每個 scope 感知的登錄檔，換來的只是毫秒級的開銷節省，而且會讓 preset 的註冊獲得一個沒有任何 agent 擁有的生命週期。

**把 agent 的 scope 鍵設為 preset。** 同一 preset 上的工作階段就能免費共享一層，但按 agent 的註冊——`installAgentLlmTarget`、按 agent 的工具限制——會跨工作階段相撞。

**把每個 preset 作為子行程執行。** [`subagent-dsh-sdk`](../../../../packages/subagent/subagent-dsh-sdk/README.md) 已經證明完整的子 harness 可行，隔離性也會是絕對的。但這同時意味著要按工作階段代理流式輸出、審批與投影，那是一個傳輸層項目，而非組裝問題。

**給產品 subagent 增加全域性啟用設定與獨立設定頁。** 行程級值會與 preset 爭奪模型可見工具的所有權，也無法表達兩個工作階段使用不同組裝。產品 provider 留在宿主，普通 preset 行分別暴露 Codex 與 Claude Code 工具。

**為 Codex 與 Claude Code 的每種組合交付一份 preset。** 四個身份會複製完整 preset 組裝，只為表示兩條獨立行。複製後的 preset 已能直接啟用任一行，因此組合 preset 只增加名單與維護成本，不增加使用者結果。
