# Agent Note: Settlement delivery belongs to the continuation manager

Status: implemented

[English](2026-08-06-manager-owned-subagent-settlement-delivery.md) | [简体中文](2026-08-06-manager-owned-subagent-settlement-delivery.zh.md) | 繁體中文

## 問題

可繼續後臺委派是模型唯一一種能夠發起、卻無法抵達終點的非同步操作。其他每一種形態都有取回原語或回傳值：後臺 bash 命令與一次性後臺 subagent 都透過 Task 結帳，`job_output(wait: true)` 可以阻塞等待；workflow 與前臺 subagent 會把結果返回給呼叫方。可繼續後臺 child 只返回它持久化的 id，而父級既沒有可等待的對象，也不會被交付任何東西。

[報告義務](2026-08-06-continuable-child-report-obligation.md)透過要求 child 在結束前上報，補上了這一缺口中協作的那一半。指令無法補上其餘部分。被 token 上限、模型失敗、取消或拆卸終止的 child 永遠走不到能夠遵守的那一步——不是很少，而是從不——而這些恰恰是等待中的父級最需要被告知的結束方式。可觀察到的下游症狀包括：父級忙輪詢 `list_agents`、向已經結帳的 child 反覆傳送訊息，以及部署放棄 `subagent` 轉用 `workflow`，因為 workflow 至少會返回點什麼。

訊號本身早就存在。自可繼續 Activation 發布以來，`subagent/end` 就一直攜帶 `stopReason` 與 `lastAssistantMessage`。缺的是把它變成父級模型能看到的上下文的那個消費者。

## 決策

繼續執行管理器自己投遞這份記帳，就在結束 Activation 的那筆 dispose 交易內部完成。

當駐留 Activation 結帳時，`notifySettlement()` 解析該 child 持久化的直接父級，並向它傳送一條使用者角色訊息：先是父級可據以行動的一句結果說明，然後是 child 的最終 assistant 內容，或一句說明它沒有產出內容。對每個呼叫方真正拿到過 id 的 child，投遞都是無條件的。它不查詢 child 是否上報過，也不保留任何可能讓這項承諾變成有條件的記帳——正是這種無條件性，才讓 `tool-subagent` 能夠承諾一條包含結局與可能存在的最終 assistant 訊息的執行時期通知。在第一則訊息被接受之前就回滾的物化保持靜默，因為呼叫方已被告知該 child 未建立。

### 來源資訊

該通知攜帶 `{ kind: 'subagent-settled', form: 'notice', summary, senderSessionId }`，刻意不複用既有的 `subagent-report` kind。上報是 child 選擇的內容；這則訊息則是執行時期在陳述這個 child 後來怎樣了。把兩者合併會把 child 從未寫過的話算到它頭上，也會讓持久化日誌無法區分「child 說它做完了」和「harness 觀察到它停下了」。`notice` 形態還為 UI 提供了這則訊息想要的摺疊單行呈現，而 `relay` 會把它呈現為往來信件。

### 兩條順序規則，以及為什麼歸管理器所有

外部 `ctx.on('subagent/end')` listener 看起來更解耦，但它是錯的。`SubagentRunEndInfo` 不指名父級；該邊觸發時 child handle 已被 dispose，因此無法從中復原父級；而喚醒父級自身結帳 watcher 的所有權釋放也已經執行過了。管理器在整個 dispose 過程中都持有父級引用，因此這些障礙對它都不存在。

**傳送發生在 `releaseOwnership` 之前。** 此刻父級仍然計入這個 child，因此 `stateOf(parent)` 為 `waiting`，父級在結構上不可能被判定為已結帳。改在釋放之後投遞，則會與一個在下一個 microtask 復原的 watcher 競爭：它會發現自己沒有 child 且處於靜止，於是 dispose 一個 Agent，而該 Agent 的 `cancel()` 會清空正裝著這條通知的那個 inbox。失效表現是一條靜默丟失的訊息，任何地方都不會報錯。

**駐留父級透過 `admitWaking` 接收它。** 在同步傳送之前登記訊息 id，正是讓 `followup()` 與承認它的那個 microtask 之間的視窗不被讀作靜止的原因。這不是對第一條規則的多餘保險：`Agent.status` 會把上下文維護摺疊成 `idle`，而維護期間的喚醒傳送只會預置一次延後喚醒，因此正在壓縮上下文的父級，在所有權釋放落地的那一刻會同時被 `status` 與已擁有 child 集合判定為靜止。

兩條規則都有測試固定：把順序反轉或去掉記帳，測試就會失敗。

### 調度

空閒父級得到一個普通的後續輪次。繁忙父級則被 steer 到其最近的 step 邊界，因為 `Inbox.claim()` 會在一個邊界上整批取走 next-step：四個 child 同時結帳時因此只消耗一個 step，而不是四個輪次。採用 steer 而非 inject 是刻意的——驅動程式執行期間該喚醒是空操作，同時它關閉了「驅動程式在狀態讀取與傳送之間退出」的那個視窗；否則通知會滯留無人認領，直到別的事件喚醒父級。這是正確性規則而非部署偏好，因此不做成 `Config` 欄位。

有一種 `running` 父級是無法 steer 的：輪次已被 cancel 但尚未退出的那種。`Agent.send()` 會把取消之後提交的喚醒輸入改投到下一個輪次、閂存這次喚醒，並在被取消的驅動程式收斂後重放它——只有 disposal 取消從不閂存，那屬於下面的拆卸規則。因此通知仍會開啟自己的輪次，無需等待無關輸入；代價是一次被改投的輪次邊界，而不是訊息本身。

**自身已開始拆卸的父級不會被喚醒。** 喚醒不是入隊操作：對靜息 Agent 呼叫 `Agent.followup()` 會開啟一個輪次，而對空閒 Agent 呼叫 `cancel()` 是文件明確的空操作，不會對之後的輪次設防。因此每條拆卸路徑最終都面對一個線上、已取消、仍在登錄檔中的父級——ACP 橋接層正是在取消其 session agent 與 dispose 它們之間呼叫 `drainContinuableDescendants()`——於是一條無防護的通知會在一個即將被銷毀的 Agent 上發起真實模型請求，而且每層樹各一次，因為每層自己的通知又會喚醒它上面那層。`notifySettlement()` 會問 `assertAdmitting()` 問的同一個問題（這條譜系的可繼續准入是否已關閉？），並改為 inject。inject 不是持久 mailbox——父級自身的 dispose 會對它做什麼，記在「已接受的風險」裡——但它是唯一能送達仍在學取自身 inbox 的父級、又不會在不該被喚醒的父級上預置一個輪次的傳送方式；而喚醒本可送達的東西一樣沒有丟失：喚醒開啟的那個輪次本身就會在半途被 dispose。

投遞絕不會阻塞或使拆卸失敗。傳送被拒會被記錄並丟棄，因為為重試一條通知而保留 child，會把它的整條祖先鏈永久釘在 `waiting` 上；而父級已離開登錄檔屬於普通結果，不是錯誤。

### epoch 自己的日誌就是全部交代

`epochStopReason()` 從 epoch 自己的日誌讀取結局，因為拆卸成功與否，對「模型是否報錯、是否撞到上限、是否被停下」什麼也沒說明。只讀輪次這件事已經錯了兩次，而兩次的形狀相同：在第一個 step 之前被停下的輪次，其 `turn/end` 與「拒絕」或「被清空的認領」產生的平衡空轉輪次長得一模一樣，於是那道用來跳過後者的過濾，也把真實的結局一起跳過了，轉而用上一個輪次的乾淨收尾作答。持久化檢查點（`dsh-session-checkpoint-policy`，存在於每個隨附 profile 中）與提示詞組裝都執行在這個邊界上、且都會向外傳播，而此時 `Inbox.claim()` 已經把訊息取走了——於是父級被告知 child 已完成，而它正在等待的那條投遞已被吞掉。在已公佈的自動結帳通知約定下，這恰恰是父級無法察覺、也不會重試的那一種失敗。

缺失的事實從來不屬於輪次，而屬於 inbox。`Inbox` 會把每次改動連同 `removedCount` 一起記入日誌，並給取消標記 `outcome: 'canceled'`，這就把「某個輪次認領了它的輸入」與「工作被丟棄且從未執行」區分開來。`dsh-agent` 中的 `foldConsumedWork()` 把兩套詞彙摺疊成一個答案：能為已消費工作作出交代的最新輪次——進入過 step 的，或認領後失敗、被停下或被拒絕的——以及此後是否有已接受的工作被取消、而沒有任何輪次為它開啟過。認領過輸入、以 `blocked` 結束的輪次同樣是一份交代：產生它的 pre-step 拒絕——hook deny、策略外掛程式——把該輪次認領的訊息一並丟棄了，因此通知會說 child 拒絕了任務，而不是完成了任務。只有沒認領任何輸入的 `blocked` 輪次保持不可見。

從日誌而不是從活動狀態推導，才讓它完整。早先的版本會在 cancel 之前立刻取樣管理器自己的 Activation，而那樣只能看到本管理器即將執行的取消：來自祖先的 `interrupt()`，或某個正在解除安裝的外掛程式取消它所跟蹤的 Agent，都會讓該取樣為假，通知照舊說 `finished`。它也讓「已接受但從未被認領」這一情形沒有任何測試能把它與「該判據不存在」區分開。一次對日誌的摺疊覆蓋了所有發起方，而兩個半邊在被移除時都會讓各自的測試失敗。

優先級歸消費端：已記錄的失敗或上限優先於取消，因為停下一個已經失敗的 child，不會把它的失敗變成一次取消。`dsh-agent` 擁有這個 fold，是因為答案所相依性的那個 inbox 標記歸它所有，而兩個消費端本來就相依性它——這裡的可繼續 epoch，以及一次性的 `readResult()`（它有同一個漏洞）。

兩者的影響都超出通知本身：`subagent/end` 會把 `stopReason` 送到 jsonrpc UI 與 Claude hook 橋接層，而它們此前把被拆卸的、正在跑輪次的 child 報成 `completed`。

### 快照覆蓋

三個整體組裝的 ACP 場景覆蓋該通知：一個從不上報的 child、一個先上報的 child，以及一個被多輪 follow-up 驅動程式的 child。三者都需要顯式柵欄。通知在 child 拆卸完成後纔到達，會與父級當時正在做的事競爭，因此每個場景都會把 child 保持到父級啟動輪次結束，再等待該通知開啟的那個父級輪次（先 `waitForTurnStart` 到該輪次，再 `waitForTurnEnd`），然後指令碼才繼續。等待一個執行並未被柵欄保證會產生的輪次不算覆蓋：一旦通知落進已經在跑的那個輪次，它就是一次逾時。

`subagent-continuable` 是其中固定失敗結局的那個。它的 child 最後一個輪次在被強制的持久化檢查點上死亡，且未進入任何 step，因此該 transcript 正是上面那條終止原因規則的端到端可見之處：通知說該 child **失敗**，把此前的 `SECOND_OK` 作為它最後產出的內容而非結果攜帶，而父級自己的確認輪次會到達 ACP 用戶端。

另有一個無金鑰的 headless Loader 快照端到端覆蓋使用者可見路徑。其重放父級省略 `run_in_background` 以覆蓋可繼續後臺默認路徑，從不呼叫 `list_agents`、`send_message` 或 Task 工具，消費管理器寫入的 `subagent-settled` 通知，並給出最終答案。child 從不呼叫 `report`，因此該 transcript 不可能經由協作式上報路徑透過。一個僅用於測試的 Loader 柵欄會把父級啟動後的請求保持到真實管理器通知進入其 inbox 為止，從 transcript 中排除平臺調度差異，但不會偽造該通知。

`subagent-report` 還需要多做一步讓步。在隨附的喚醒上報預設值下，該場景有兩個互相獨立的父級喚醒——上報與結帳——而第二個究竟是延長第一個的輪次還是另開一個輪次，是一枚真正的硬幣，多次執行實測約為五五開。任何手寫 transcript 都無法同時容納兩種順序。因此它的 overlay 固定 `reportDelivery: quiet`，使結帳成為唯一喚醒；另一個僅用於快照的 pre-step 柵欄會把 child 保持到父級啟動輪次結束，使這次喚醒開啟一個確定輪次並同時認領兩則訊息。喚醒上報預設值的覆蓋則保留在 report 包自身的測試中。

拒絕與中斷兩種措辭在單元測試中逐字釘死，而不進入重放 transcript：觸發它們需要一個會拒絕的策略外掛程式、或一次在 step 邊界被柵欄卡住的取消，而無金鑰組裝本身並不攜帶這些；通知通路本身已由整體組裝場景端到端釘住。

## 考慮過的替代方案

**給可繼續 child 引入 Task。** Task 是一次性契約：一個生產者、一次結帳、一個結果。Activation 會執行許多輪次、比其中任何一輪活得更久，並且可以在結束後被復原。用 Task 包裝它，恰好重建了可繼續 child 當初為消除而引入的生命週期錯配，還會讓某一個輪次看起來是終局。

**掛一個外部 `subagent/end` listener。** 因上文三點被否決——payload 裡沒有父級、child handle 已被 dispose，以及 listener 無法影響的順序。listener 還必須嚴格同步才能搶在釋放之前，而該 seam 上沒有任何東西強制這一點，因此正確的版本只能靠碰巧正確。

**僅在 child 沒有上報時投遞。** 這是最初的設計。它需要按 Activation 記帳，仍會漏掉「報了進度、隨後在給出結果前死掉」的 child，而且最關鍵的是：它讓面向父級的承諾變成有條件的。「通常你會被告知」不是工具描述能陳述的契約，而無法相依性該通知的模型無論如何都會去輪詢。

**把投遞做成可設定。** 部署開關會把面向模型的文字重新變回「通常」，而這正是本次改動要消除的失效。協議常數與安全不變數保持固定；這就是其中之一。

**修改 `subagent/end` 讓它攜帶父級，由外掛程式負責投遞。** 那會為一個包內消費者拓寬已發布的 payload，保留全部順序風險，並讓返回通道重新變成選填外掛程式。以 `terminal(failure)` 擴充包私有的 `ActivationObserver`，則只保留一處終止事實的計算，且不改動任何公開面。

**始終使用 `followup`。** 更簡單也更統一，但一批同時結帳的 child 會各自消耗一個父級輪次。step 邊界的批次語義本來就存在，用它是免費的。

## 後果

- 可繼續 child 的父級會為每個已結帳 Activation 收到一則訊息。因此，做扇出的部署會增加父級輪次；steer 會把同時結帳的一批壓縮到一個 step。
- `tool-subagent` 在其 schema 中承諾該通知，因為返回通道是服務行為，不是選填外掛程式。
- `Activation` 攜帶 `parentSession` 與 `announced`。前者存在是因為 child handle 在投遞前已被 dispose；後者讓被回滾的物化保持靜默。
- `foldConsumedWork()` 取代 `dsh-session` 的 `findLastMessageTurnEnd()`，並遷移到 `dsh-agent`——它擁有該 fold 所讀取的 inbox 標記；一次性 in-process 路徑摺疊同一個答案，不會把被中途切斷的一次性 child 歸類為 `completed`。
- 單元覆蓋固定了無條件約定、每種終止原因、空閒與繁忙兩種調度、批次語義、維護期回歸、釋放前順序、父級已消失，以及一次不得讓拆卸失敗的傳送被拒。
- 三個 ACP 場景使用顯式的結帳柵欄，`subagent-report` 帶有固定靜默上報投遞的設定 overlay。
- 一個無金鑰的 headless Loader 快照固定了「後臺啟動 → 管理器寫入的結帳通知 → 父級最終答案」路徑，其中沒有輪詢，也沒有 child `report` 呼叫。

### 已接受的風險

通知只是被投遞，而不是被確認。沒有持久化 mailbox、回執或重試：不線上的父級會丟失它，child 的 Session 仍是唯一的持久記錄。要補上這一點，需要一套帶有自身尋址、授權與重放規則的離線 mailbox 協議。

當父級緊接著被 dispose 時（每個拆卸呼叫方都會這麼做），在拆卸期間被 inject 的通知不會被模型讀到：dispose 的 cancel 會清除這條未被認領的訊息，而日誌保留 insert/cancel 這一對作為記錄。要讓拆卸期投遞在 resume 之後仍可讀，要麼需要上面那套離線 mailbox，要麼需要改變 dispose 對持久待處理工作的處理方式。dispose 會丟棄每一條未被認領的 inbox 項，使用者輸入也不例外，因此改變該行為是一個 core-agent 決策，而不是結帳投遞的細節。resume 後的父級可以發現 child，但不會收到結局：`list_agents` 只報告存在性與「線上/僅儲存」狀態——`SubagentListEntry.activity` 就是這麼寫的——要取回結局，必須透過 `send_message` 去問那個 child。

終止原因的歸因是對日誌既有 splice 詞彙的盡力而為，偏向永不高估成功。`Inbox.remove()` 與拆卸的 `clear()` 寫出的取消 splice 完全相同，因此刪除一條內容仍保留在別處的訊息——`agent-instructions` 清理待處理的 instructions 刷新、或結帳自身的 cancel 清掉一條仍在掛起的這類訊息——可能被讀作「工作被丟棄且從未執行」，把已完成的 child 報成被停下。區分二者需要 `dsh-agent` 提供更豐富的刪除詞彙；在該詞彙可用前，這項誤讀的範圍很窄，且錯的方向是讓父級複查一個已完成的 child，而永遠不是信任一個未完成的 child。

對於深或寬的樹，輪次放大是真實存在的，而且按設計不可設定。step 邊界的批次語義只能約束同時結帳的情形，無法約束分散結帳的 child。

兩個互相獨立的喚醒源無法在手寫 transcript 中排序。整體組裝覆蓋分別固定它們，而不固定它們的交錯。
