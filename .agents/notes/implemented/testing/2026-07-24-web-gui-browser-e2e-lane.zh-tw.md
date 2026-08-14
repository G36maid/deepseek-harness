# Agent Note: Web GUI 的無金鑰瀏覽器 e2e 車道

Status: implemented

[English](2026-07-24-web-gui-browser-e2e-lane.md) | [简体中文](2026-07-24-web-gui-browser-e2e-lane.zh.md) | 繁體中文

## 問題

Web GUI 以一條真實組裝鏈交付——chromium 頁面 → client 外掛程式 bundle → HTTP 單次 RPC + 兩條 SSE（Server-Sent Events）流 → `toFetchHandler`/apiproxy → host 端的 agent loop（代理循環）、工具與 JSONL 持久化——卻沒有任何測試無金鑰且確定性地檢驗這條鏈。[GUI 測試體系](../process/2026-07-20-gui-testing-system.md)覆蓋第 1 層（Node 中的協議同構）、第 2 層（對象層狀態機）與第 3 層冒煙測試，但無金鑰冒煙驅動的是 `FixtureApiClient`——沒有 host、沒有 wire、沒有 agent loop——而全鏈路冒煙需要 `DEEPSEEK_API_KEY` 和真實模型，因此不確定、在無金鑰 CI 中自行跳過。[docs/testing.md](../../../../docs/testing.md) 的快照哲學——帶金鑰錄制一次、永久無金鑰重播、格式變動時刷新——已覆蓋 ACP（Agent Client Protocol）、headless `stream-json` 與 TUI 三個 transcript（文字記錄）表面；web 表面是唯一沒有這層保障的組裝形態。而缺口恰恰是兩起已實證 GUI P0 藏身之處：fixture（測試前置資料）用戶端短路掉的 wire 承載鏈。

## 決策

`pnpm run test:web` 攜帶 `apps/web/tests/` 下的無金鑰、確定性瀏覽器 e2e 車道：錄制的工作階段日誌 fixture 經 `@deepseek-ai/dsh-llm-replay` 對真實行程內 web 組合重播；使用者可見狀態使用規範化的 aria 預期輸出，持久化的世界狀態則使用行程內斷言。配套的產品約定包括 `dsh-llm-replay` 的節奏控制、消費檢查與已校驗的索引式覆寫 patch；跨包的 `dsh-llm` 失敗透過自有資料屬性保留經校驗的提供方資訊；已交付的 web 組合掛載 `llm-retry`，以處理瞬態模型失敗。

### Scaffold：`apps/web/tests/scaffold.ts`

一個普通的共享 fixture 模組（[測試政策認可的形態](../../../../docs/testing.md)），不是包：值得閘門把守的邏輯——重播推導、工作階段解析、日誌脫敏、持久化——都在已受閘門的包 `dsh-llm-replay`、`dsh-acp-snapshot`、`dsh-session-persistence-jsonl` 中；剩下的只是啟動接線和瀏覽器膠水，而驅動 chromium 的原始碼在無瀏覽器的覆蓋率 runner 上無法誠實保持逐文件 100% 覆蓋率。

`launchWebScaffold()` 透過 vendored Loader 的 include 機制，從交付的 `apps/cli/config/base.cordis.yml` 與 `apps/cli/config/web.cordis.yml` 啟動真實 web 組合——與 `AppCLIEntry` 為 `dsh web` 驅動的是同一棵樹、同一套機制。差異全部經 include patch 覆蓋在這棵樹上，即 ACP `cordis.snapshot.yml` 模式的行程內表達：臨時 `persistenceRoot`；每個主機級 `skill-filesystem` 根目錄（`dshHome`、`agentsHome` 和 `bundledSkillDir`）都釘在臨時工作區下並停用監聽，因為環境 skill（技能）目錄是模型可見輸入；停用 `agent-instructions`（錄制的 fixture 不得嵌入本倉庫的 AGENTS.md）；停用 `session-title-llm`（其發後不管的標題呼叫會與迴圈爭搶工作階段的重播遊標）；webserver 行釘到埠 0，並使用已建置的 dist；無金鑰模式下停用 `llm-deepseek`。patch 的 id 一旦不再匹配任何行，boot 掃描會大聲失敗而不是漂移。boot 在臨時工作區 `chdir` 下執行，使 api-gateway 的 `process.cwd()` 工作階段預設值、工具 cwd 與 fixture 一致；`dsh web` bin 自身的膠水（argv、profile json、AppCLIEntry）仍由 `smoke-real.e2e.ts` 中的無金鑰 CLI（命令列介面）冒煙把守。初始化回滾和正常關閉都會先對 Cordis 樹執行 dispose（資源釋放），再刪除 scaffold 持有的兩個臨時根目錄；每項清理都會獨立嘗試，並會報告清理失敗而不掩蓋初始化失敗。

無金鑰的模型替換 = 停用配接器行的 patch 加 `installLlmReplay` 在停穩的根 ctx 上以提供方目錄（providers-catalog）模式填充空的配接器登錄檔——絕不用 catch-all：配接器行被停用後不存在任何配接器，catch-all 會讓 `resolveModelInfo` 無路由可走，`compaction-basic` 的步後壓力檢查將步步告警，而不是被可證明地閒置（發布的 128k `contextWindow` 使該路徑對小 fixture 保持閒置）。選擇直接安裝而非插入重播外掛程式行是刻意的：直接安裝返回收尾消費檢查所需的 `ReplayHandle`。沒有 fixture 的場景讓登錄檔保持空置，任何意外的流式呼叫都會以 NO_ADAPTER 大聲失敗。

`seedSession()` 透過真實持久化 API 播種冷工作階段——一次性 `Context` 掛載 `SessionStore` + `JsonlSessionPersistence` 到 host 的根上下文，`create()` + `append()`，一次 `utimes` 回撥保證側欄順序確定（`semantic-checkpoint.snapshot.ts` 先例）——絕不裸寫文件，因此播種器對桶雜湊、檔名編碼、壓縮一無所知，host 的 zstd 預設值也無需任何啟動開關。種子在播種時即校驗（可解析、以 `turn/end` 結尾——未閉合的最終輪次會被復原（resume）的崩潰修復改寫）。

### 確定性規則

重播模式下瀏覽器斷言的屏障棧，按序：（1）host 側 `await agent.whenIdle()` 加逾時，以行程內 `turn/end` 為錨——空閒翻轉發生在持久化落盤之後，一次等待同時覆蓋輪次完成與持久性；（2）瀏覽器安定輪詢（流式輸出節點已解除安裝、最終文字可見）。錄制模式下，日誌採收在 `whenIdle()` 之後、scaffold 釋放之前進行，此時執行中的工作階段仍然可用。單獨監聽行程內 `turn/end` 是錯誤屏障（它先於 SSE 幀到達瀏覽器、先於 fsync 觸發）；禁止輪詢持久化文件來充當輪次完成或持久性屏障（NFS 上慢，且被 `whenIdle` 取代），但工具控制的臨時就緒標記可以僅作為該完成屏障之前的互動門控進行輪詢；`networkidle` 被徹底禁止（SSE 流保持打開時它永不解析）。導覽斷言會在頁面載入前同時監聽 `session.list` 和 `workspace.list` 的初始回應，隨後等待播種資料投影到 DOM；僅憑 shell 已掛載不能判定就緒，因為較晚完成的 bootstrap 可能替換受控狀態。

不做單次瞬態 DOM 斷言：從重播產出到 React 提交的每一跳都可能合併區塊，取樣 `[data-streaming]` 天然就是競態。流式輸出的增量性由持久化的 `assistant/chunk` 事件斷言（模型可見 ⟺ 已記錄，使日誌成為權威證據）。`dsh-llm-replay` 的選填 `paceMs`（默認預設 = 突發）只是讓瀏覽器觀察到真正增量 SSE 的真實感旋鈕；正確性絕不相依性它，且節奏等待期間中止會即時取消。

每個場景都會因任何 pageerror 或用戶端的連線丟失/間隙修復控制台警告而失敗：否則重連機制加歷史重同步會把一條死掉的 SSE 通路自愈掉，套件反而認證了壞 wire。Scaffold 的 `close()` 呼叫 `ReplayHandle.assertConsumed()` 收尾檢查（每個已錄指令碼都被綁定、每個遊標都耗盡），把靜默的少放與錯綁變成清晰診斷。車道不設 vitest 重試；每文件一個 chromium、每場景一個新 context、每場景一個 host；視口固定；互動選擇器錨定 role、`data-*` 屬性和可見文字，而 frame 與工作階段區採集則使用既有的 CSS 模組區域性類名錨點。常規場景開啟 `en-US` 瀏覽器，使本機化的 role 定位器和預期輸出統一採用明確指定的語言；斷言中文文案的場景則開啟 `zh-CN` 瀏覽器，因為 Host settings 文件沒有顯式偏好時，用戶端的暫定 locale 由 `navigator` 推導（[由瀏覽器推導初始 locale](../feature/2026-07-31-browser-derived-initial-locale.md)）。`settings-chrome.e2e.ts` 還額外覆蓋雙向切換、全新英文瀏覽器默認態，以及共享同一 DSH home 的不同埠之間的偏好持久化。

### 預期輸出

具有穩定所屬區域的場景會為每個不同的使用者可見狀態提交一份規範化的 `ariaSnapshot()`；跨區域的工作區管理狀態則使用語義 DOM 斷言和權威的 host 狀態檢查。UUID、cwd、工作區目錄名與時長等易變內容會歸一為穩定 token；採集過程持續輪詢，直到連續兩次規範化讀取結果相同。Role 與文字錨點繼續充當可評審預期輸出周圍的語義防線，並直接覆蓋跨區域狀態。世界狀態斷言使用根上下文的工作階段事件，而不是第二份提交的日誌預期輸出，因為 ACP、headless 與 TUI 套件已經透過同一迴圈和持久化釘住持久化日誌表面。`refresh` 是預期輸出的唯一寫入者；重播模式下缺少預期輸出時，測試會連同重新生成命令一起失敗。

型別檢查平面切分是結構性的：host scaffold、其支持模組，以及每個啟動或檢查 host 組合的 web spec 都會從註冊在 client 側的 `apps/web` 工程中排除，並逐文件納入 `tsconfig.host.json`。一個程序不能同時持有 Cordis `Context` 合併的兩側。

### 模式與 fixture

`DSH_SNAPSHOT` 選擇 replay（默認，無金鑰）、record（帶金鑰）或 refresh（無金鑰）。發起提示的 spec 將所有模式共用的驅動步驟與僅供 replay/refresh 使用的斷言分開；record 模式驅動真實輸入框，採收記憶體中的工作階段 header 與事件，脫敏請求標頭，並 token 化當次執行的工作階段、cwd 與 RPC 標識。隨後一次無金鑰 refresh 重新生成 aria 預期輸出。每條提示詞都會與 fixture 中錄制的 `user/message` 核對；每個場景目錄都採用封閉清單，其中每個 JSONL 都是脫敏不動點。Web fixture 全部脫敏請求標頭且不釘任何 header 類別；見「暫緩」。

### 覆蓋約定

該車道覆蓋三類行為。即時輪次場景釘住普通工具執行、取消、不可重試失敗、瞬態重試、常駐提問與輪次中途 steering（中途引導）；同步相依性持久事件、`whenIdle()` 或顯式重播標記，而不使用延時。冷歷史場景透過真實持久化 API 播種，在不呼叫模型的情況下覆蓋歷史渲染、側欄搜尋、Trajectory 與 waterfall（瀑布式事件）檢視表及工具詳情。瀏覽器生命週期場景覆蓋首次傳送時物化工作區、重新載入復原、版面配置重設、主題與語言偏好，以及工作區的建立、重新命名和檢視表操作。每類場景都斷言瀏覽器表面和權威的 host 狀態；意外的模型呼叫或未耗盡的 fixture 會使拆卸失敗。必需車道還包含一份合成的 88 輪 Chat 滾動約定，其中混合了換行 Markdown、圍欄程式碼以及成對的 bash 呼叫/結果。真實 wheel、輸入框、工具、tab、工作階段與 viewport 互動會在並行歷史前插加帶節奏流式輸出、貼底/離底流式輸出、工具 disclosure 離屏迴圈、擴充歷史後的檢視表/工作階段重新掛載、寬度重排、貼底後立即重新掛載、輸入框尺寸變化以及 textarea wheel 鏈場景中，斷言一個已穩定的具名行相對 transcript scrollport 的頂部位置和到真實底部的距離；真實鍵盤翻頁與觸摸式慣性滑動模擬額外釘住不相依性 wheel 的貼底跟隨所有權（[讀者滾動歸因筆記](../bug-fix/2026-08-06-reader-scroll-attribution-observed-top-ledger.md)）；它刻意不釘 DOM 基數或絕對 `scrollTop`，因此同一約定可以驗收虛擬化實作。另一份基於同一 fixture 的互動約定釘住異構行順序、相鄰工具 disclosure 的獨立狀態、使用者訊息剪貼簿內容的精確值、以輪次為邊界的訊息 fork、源工作階段/子工作階段隔離，以及子工作階段中的一次真實追問輪次；wheel 輸入只用於導覽到語義目標，不承載幾何預期。一份簡短的即時歷史約定從空白工作區開始，連續驅動輸入框輪次，其中包括真實的 bash 呼叫/結果輪次和一段帶節奏的長篇最終回應；它釘住單一工作階段身份、每輪事件的精確歸屬、瀏覽器回顯唯一性與輸入框復原，不設定時間閾值。

### CI 立場

根據[瀏覽器快照 CI 決策](2026-07-30-web-browser-snapshot-ci-gate.md)，該車道是 Linux Pull Request必需的只比較閘門。`node 24 / snapshots and artifacts` 消費端任務在[消費端獨立建置](../process/2026-07-30-independent-ci-consumer-build.md)中負責唯一一次 Linux 建置，安裝鎖定檔選定的 Chromium，復原以作業系統和鎖定檔為鍵的快取，並用 `DSH_SNAPSHOT=replay` 執行該車道。這是有意的平面切分：host 與 spec 使用 [tsx 原始碼啟動約定](../architecture/2026-07-29-dsh-source-launch-tsx-esm.md)，瀏覽器則消費 `apps/web/dist` 和包的 `lib/client.js` 產物，因此閘門相依性 `built-package-invariants` 提供這些用戶端產物。託管和自託管的默認分支 Linux 序列任務執行同一閘門；託管任務生成供 PR 消費的瀏覽器快取，持久化自託管池則不需要託管側快取。CI 從不錄制或刷新預期輸出。場景仍面向 POSIX，並繼續置於 Windows 和 macOS 矩陣之外。

高基數效能診斷使用單獨按需啟用的 `apps/web/tests/**/*.perf.ts` 清單，並且只由 `vitest.web.perf.config.ts` 選中。`complex-history.perf.ts` 的隔離用例複用真實 scaffold：工作區用例播種 1,000 個緊湊工作階段以及一份包含 500 次工具呼叫的 500 輪次歷史，在 Chat 中窮盡並重新掛載該歷史，並報告 Chromium 主線程、DOM、監聽器、堆記憶體、分頁、搜尋和 Trajectory 測量結果。兩個續聊用例播種同一份長歷史，但比較默認的 24 輪次 Chat 視窗與展開全部 500 輪次的狀態，然後各自透過真實輸入框、agent loop、SSE wire、工具和持久化繼續進行 8 個相同輪次；其中兩輪執行真實 `bash` 呼叫並斷言其持久化結果，最後一輪則填入一條包含 8,232 個字元的混合語言提示詞，並回放 120 個帶節奏的文字增量。一個單獨的 soak 用例從空白工作階段開始，透過真實輸入框連續驅動 100 輪，每第 10 輪執行一次 `bash` 呼叫並產生結果，每 10 輪強制執行一次 GC，並報告每 10 輪的延遲視窗及保留的瀏覽器狀態。隨後它透過受信任的瀏覽器點擊提交第 101 個純文字輪次，並使用瀏覽器時鐘分別測量傳送到 transcript DOM 和傳送到繪製後的延遲，排除輸入框的草稿映像檔，並與完整輪次完成時間分開。逐輪診斷涵蓋輸入框填入、點擊到使用者訊息回顯、點擊到首個區塊、完成、瀏覽器變更、持久化區塊和工具事件；合成重播模型擁有足夠的上下文容量，可使 fixture 基數保持穩定，而不會因壓縮（compaction）消耗指令碼化呼叫。結構性斷言釘住預期的負載、流和工具形狀，但時間仍不設閾值，因為機器速度不屬於正確性約定。必需的 `vitest.web.config.ts` 清單仍僅限 `*.e2e.ts` 和 `*.snapshot.ts`，因此 `test:web:built` 及其 CI 閘門都不會收集效能用例。

## 業界先例

調研了 AI（人工智慧）聊天/agent web UI 與 mock 層（LibreChat、vercel/ai-chatbot + AI SDK、lobe-chat、open-webui、OpenHands、Chainlit、continue、cline、langfuse、gradio/streamlit；Playwright HAR/route、MSW、Polly/nock、WireMock、aimock）。自有後端的應用的主流成熟架構是：真實後端約定後放一個行程內偽造/重播模型，下游全部真實（LibreChat 的 `LIBRECHAT_TEST_RUN_HOOK` 偽模型；ai-chatbot 的 `MockLanguageModelV3` + `simulateReadableStream`；continue 的指令碼化 mock 提供方類）——這正是 `dsh-llm-replay` 已然所是。瀏覽器層 SSE 攔截無法檢驗增量渲染（`route.fulfill` 一次性交付整個回應體；playwright#33564），且伺服器端 SSE 棧完全失測，因此各項目只把它用於邊緣用例。區塊節奏作為 fixture 參數反覆出現（LibreChat 默認 10ms 附慢速檔；ai-chatbot 500ms）；CI 裡的真實模型會腐爛（open-webui 的套件長出 120 秒逾時，先被停用後被刪除）；工作階段在持久化層以受控時間戳播種（LibreChat 直插回撥時間的 Mongo 文件；langfuse 播種其資料庫）。沒有任何被調研項目為 UI 測試把錄制的 agent 事件日誌經真實後端重播——最接近的是提供方層錄制 fixture（aimock）與前端層 socket 歷史發射（OpenHands MSW）——因此工作階段日誌即 fixture 的設計沿著本倉庫「模型可見 ⟺ 已記錄」不變式所指的方向比業界先例多走了一步。

## 曾考慮的替代方案

**瀏覽器網路層 SSE 攔截（`page.route`）。** 已否決：`route.fulfill` 無法流式輸出，增量 token 渲染無從檢驗，且伺服器端 SSE/背壓/關閉路徑——兩起已實證 P0 的藏身處——完全失測。

**`DEEPSEEK_BASE_URL` 處的 mock HTTP 提供方。** 作為本車道機制已否決（僅保留給既有的工作區探針冒煙）：fixture 會變成手寫的 OpenAI SSE 位元組指令碼，一種與倉庫其餘部分錄制重播的工作階段日誌格式漸行漸遠的第二 fixture 格式；配接器的真實 HTTP 路徑歸帶金鑰 e2e 管。

**擴充 `?fixture` 用戶端。** 已否決：分層紀律——`FixtureApiClient` 的存在意義就是脫離伺服器測試用戶端 shell；client API 邊界以下按構造即失測。

**用佔位 `DEEPSEEK_API_KEY` + 重播攔截替代停用配接器行。** 儘管零組合改動且樹內有兩處先例仍被否決：它用謊言滿足 `llm-deepseek` 的快速失敗金鑰檢查，還留下一個掛載卻被攔截的死配接器；停用行（ACP overlay 的同款做法）是誠實的無金鑰，並在最早可解析點快速失敗。

**`packages/test-support/web-snapshot` 包 + `defineWebSnapshotSuite` 工廠。** 已否決：驅動 chromium 的原始碼在無瀏覽器的覆蓋率 runner 上無法誠實保持逐文件 100%，且除受閘門的包已匯出的輔助工具與本機 scaffold 外，這些場景專用互動尚未形成穩定的無瀏覽器約定。出現第二個 web 形態消費端，或被證實重複的生命週期程式碼確立該約定後，再重新考慮。

**第二份提交的規範化工作階段日誌預期輸出。** 已否決：日誌表面已由 ACP/headless/TUI 套件經同一迴圈與持久化釘住；在此只會翻倍刷新成本並重複測試下層。內聯在根上下文事件上的世界狀態斷言保住了驗證世界的義務。

**以 `DSH_SNAPSHOT` 重播分支拉起 `dsh web` bin。** 已否決：它需要在交付的 CLI 中增加測試專用重播分支和環境變數管道。行程內 scaffold 已載入同一份 `apps/cli/config/base.cordis.yml` 與 `apps/cli/config/web.cordis.yml`；只剩 argv、profile JSON 和 `AppCLIEntry` 膠水不在其覆蓋範圍內，而這些路徑已由無金鑰 CLI 冒煙覆蓋。

**為可測試性改 wire 協議。** 已否決：約定已有第一等的無金鑰行程內路徑（`InProcessApiClient(toFetchHandler(api))`），逐事件不合批的 SSE 恰是重播在瀏覽器中可觀測的原因，測試一條不再交付的 wire 會顛倒該層的存在意義。

**以真實模型瀏覽器測試充當無金鑰車道。** 已否決：按構造即不確定；被調研的前車之鑑（open-webui）長出無界逾時後被刪除。帶金鑰的真實 host 冒煙仍是真實模型側的補充。

**在必需的瀏覽器閘門中執行高基數效能用例。** 已否決：其 fixture 設定和完整歷史渲染會增加數十秒耗時，而壁鐘時間和記憶體值隨 host 不同而變化，無法提供穩定的正確性閾值。必需車道保留確定性行為斷言；貢獻者在調查或更改大清單和長歷史渲染時執行該診斷用例。

**用戶端 `data-dsh-busy` 安定訊號。** 暫緩：host 側 `whenIdle` 屏障配合穩定 DOM 輪詢，足以覆蓋當前場景。第一次安定輪詢抖動，或必要狀態在 DOM 中不可觀察時，再重新考慮。

## 測試

`pnpm run test:web` 建置並無金鑰執行該車道；`test:web:built` 基於現有建置產物執行。`pnpm run test:web:perf` 建置並執行手動效能清單；`test:web:perf:built` 複用現有產物。`DSH_SNAPSHOT=record pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/<spec>` 對真實模型錄制一個發起提示的場景，`DSH_SNAPSHOT=refresh pnpm run test:web` 則無金鑰重寫 aria 預期輸出。CI 顯式選擇重播模式。live-interactions AUTH 場景會把不可重試的終態失敗釘為 Chat 內聯狀態，其中攜帶適合展示的訊息與錯誤碼，並驗證提供方回顯的憑據片段不會出現在 Chat 或 Trajectory 中；該場景同時覆蓋輸入框復原與 `turn/end` 錯誤。scaffold 環境隔離場景會在全部 3 個環境 skill 根目錄中分別填入不同條目，並要求這些條目都不得進入組裝後的目錄。`dsh-llm-replay` 單元覆蓋率釘住節奏控制、取消、消費診斷、sidecar 校驗、按索引替換與唯一的追加位置。

## 暫緩

- **Web 頭類別釘住**：web fixture 處處 token 化 `{{system}}`/`{{tools}}`，沒有場景釘住 web 組合的提示詞/工具 schema（`TODO(web-header-pin)`——scaffold 的 `recordFixture` JSDoc 有標記）。沿用 TUI 處處脫敏先例；當 web 組裝的請求標頭與其映像檔的 repl 組合進一步分叉時重審。
- **復原後追問場景**：真實 wire 上的歷史/即時縫合路徑；當該程式碼變更或回歸時作為獨立場景補充。
- **輸入框 steering 手勢**：輸入在執行期間鎖定（只能停止或等待），因此 steering 場景從頁面走 wire 做 steer；`TODO(web-steer-composer)` 待產品長出真實的輸入框手勢後，把驅動步驟升級為該手勢。
- **拖拽工作階段重排**：`workspace.insertSessionBefore` 尚無瀏覽器場景；它需要在同一個工作區裡物化兩個工作階段，並合成 HTML5 拖拽事件。當該表面變更或回歸時再補充。無行為的工作階段 Rename/Fork/Delete 和工作區 Delete 選單行待獲得行為後再補充場景。
- **長歷史 Chat 到 Trajectory 的 Inspect**：兩個檢視表共用 Session 分頁，而所選 Trajectory 記錄由一個派生的表格索引定位；隨著較早頁面前插，該索引可能移動。短歷史 Inspect 仍有覆蓋；在選中項具有穩定的語義身份之前，長歷史互動約定不包含這項交接。

## 後果

Web 表面獲得了錄制一次/永久重播的層級：真實 chromium → SSE → apiproxy → 迴圈 → 工具 → 持久化的鏈路以約 10-30 秒無金鑰執行，重複執行結果確定，fixture 由車道自身持有並可重錄。接受的成本：每次有意的工作階段 UI 變更都以一次無金鑰 `DSH_SNAPSHOT=refresh` 收尾（預期輸出變動是受評審的 diff，錨斷言保住語義綠色）；aria 格式歸 Playwright 所有——倉庫唯一不受自己控制的提交快照格式——因此 playwright 版本升級必須是刻意的升級加刷新提交（相依性在 `apps/web/package.json` 中浮動為 `^1.49.0`；若變動傷人則改為精確鎖定）；重播的首次呼叫順序綁定把每個場景限制為至多一個發起提示的工作階段，消費斷言是絆線；`compaction-basic` 與工作階段共享重播遊標，僅在目錄中發布的 128k 上下文視窗下保持閒置；必需的消費端任務承擔 Chromium 供給與一次瀏覽器執行的成本，使改動組裝後 UI 的 PR（Pull Request）持有相應的預期輸出 diff。按需啟用的效能車道保留了可重複的診斷工作負載，又不會向 CI 新增受 host 差異影響的時長或記憶體預期；在倉庫擁有經校準的基準測試環境之前，效能回歸仍是需要人工解讀的訊號。
