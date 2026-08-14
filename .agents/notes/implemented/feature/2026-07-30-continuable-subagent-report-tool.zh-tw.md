# Agent Note: 可繼續 subagent 報告工具

Status: implemented

[English](2026-07-30-continuable-subagent-report-tool.md) | [简体中文](2026-07-30-continuable-subagent-report-tool.zh.md) | 繁體中文

## 問題

可繼續的行程內 subagent 能夠接收 parent 後續發來的訊息、保留後代、結帳並冷復原，但基礎生命週期無法讓它們將選中內容傳送給直接 parent。child 的完整輸出已可從持久化工作階段中重建，因此缺失的能力是顯式投遞，而非結果儲存。

如果將每條 assistant 最終訊息都視為隱式結果，就會混淆輪次完成與報告。長期執行的 child 可能在某個輪次中無內容可報告，也可能在另一個輪次多次報告進展，而且報告後必須仍可繼續工作。因此，接收方權限、靜默投遞與喚醒投遞、確認、持久性和重試行為都需要一份顯式約定。

## 決策

新增可獨立安裝的 `@deepseek-ai/dsh-tool-subagent-report` 包。它會向每個可繼續行程內 child Activation 貢獻一個普通的面向模型 `report` 工具。機制本身接受一個輪次中呼叫零次或多次；child 會另行被要求在結束前呼叫一次（見[報告義務](2026-08-06-continuable-child-report-obligation.md)）。呼叫成功既不會結束該輪次或結帳 Activation，也不會阻止 parent 之後繼續 follow-up；完成輪次也絕不會自動報告。

該功能是協作控制，不是承載結果的執行包裝層。它不新增 Task、`SubagentRun`、結果 promise、Activation 狀態、投遞佇列或重播路徑。

### 面向模型的約定

`report` 只接受 `{ output: string }`，也只返回 `{ messageId: string }`。它不接受 child id、接收方 id 或投遞模式。`exec.agent` 將工具呼叫綁定到傳送報告的 child；服務從持久化 `parentSession` 中推導唯一接收方，調度則由部署設定決定。

`messageId` 是 parent 接受的使用者角色訊息所對應的穩定 `MessageId`。它不是 `InboxItemId`：靜默投遞不建立 inbox 條目實例，喚醒投遞則會為同一條穩定訊息建立一個條目實例。它也不是已讀回執、parent 日誌確認、輪次完成回執或持久化 flush。

工具描述會明確報告操作在結束前必須執行、可重複、僅限直接 parent 且不會結束輪次。它還會警告：傳送被接受後，後續 `tools/post-execute` 失敗可能替換工具結果，因此工具結果失敗時內容仍可能已經送達。沒有冪等鍵時，更強的表述會誘導呼叫方在結果不明確的失敗後重複重試。

該工具使用不帶 location 的通用渲染，其確認中包含 `messageId`。作用域區域性註冊使呈現與執行保持一致：root、one-shot child、遠端提供方、同級作用域和無 agent（代理）執行既不能看到，也不能執行 `report`。它會在 child 的全域性 `toolFilter` 之後安裝，因此委派 allow-list 不會意外移除這條結構性返回通道；不需要返回通道的部署不安裝該包。

### 服務權限

subagent seam 暴露 `ctx.subagents.reportFrom(child, content, { delivery, signal }): Promise<MessageId>`。確切的線上 child Agent 是傳送方憑據。繼續執行管理器只接受 `handle.agent === child` 的 Activation，從 child 的持久化 header 中推導其直接 parent，並要求該 id 在最終的同步授權與傳送區間解析為一個線上 parent Agent。該 API 不接受由呼叫方選擇的接收方、祖先或傳送方欄位。

root、one-shot child、偽造對象、過時 Agent 和同 id 替換對象都以 `UNAUTHORIZED` 失敗。正在關閉的 child Activation 以 `ACTIVATION_CLOSING` 失敗；管理器 drain 和接受前取消保留既有的生命週期錯誤。直接 parent 不存在或拒絕接受時，以 `PARENT_UNAVAILABLE` 和 `direct parent is not live; report was not delivered` 失敗。失敗不返回 id，不冷復原 parent，不寫入離線郵箱，也不會修改缺失 parent 的工作階段。

巢狀報告恰好跨越一條邊。grandchild 會向其直接 child parent 報告，絕不會直接向頂層 coordinator 報告。中間 child 可以稍後顯式報告自己歸納的更新。

### 投遞策略

該包會校驗 `reportDelivery: 'quiet' | 'wakeup'`，預設值為 `wakeup`（見[預設值反轉的理由](2026-08-06-continuable-child-report-obligation.md)）。

靜默投遞呼叫 `parent.inject()`。它會新增模型可見上下文，但不啟動 parent 模型請求：若 parent 空閒，則在呼叫返回前追加訊息；若 parent 正在准入或執行，則暫存報告，留到下一個安全日誌位置。該模式不建立 inbox 條目實例，因此也不會產生虛構的繼續執行管理器接受記錄。

喚醒投遞呼叫 `parent.followup()`。它會建立一個普通的 FIFO parent 輪次，喚醒已停駐的 parent driver，且絕不 steering（中途引導）已開始的輪次。當該 parent 本身也是可繼續 Activation 時，傳送會使用管理器現有的准入計數，防止 parent 在同步入隊與准入微任務之間結帳。

兩種模式都會將一條使用者角色訊息封裝為 `Background subagent <child-id> reported:`，後面跟隨完全原樣的 `output`。持久化訊息來源為 `{ kind: 'subagent-report', senderSessionId: child.id }`。並行傳送的順序由 Agent 的常規規則決定；subagent 層不會建立第二條佇列。

### 確認與復原

成功表示確切的線上 parent 已同步接受該訊息。空閒 parent 在接受靜默注入時已經完成追加，而暫存的靜默上下文只有到達正常日誌邊界後纔可重建。喚醒投遞包含一個 inbox 條目實例，其 id 與返回的穩定訊息 id 保持分離。

首個版本不提供持久化郵箱、冪等鍵、投遞回執、重試協議或恰好一次保證。行程故障可能讓呼叫方無法確定結果，在結果未知時重試則可能重複報告。parent 不可用時，持久化 child transcript（文字記錄）仍是復原來源。

### 組合與生命週期

subagent seam 新增 `registerContinuableSetup(contribution): () => void`，由 `SubagentActivationSetupRegistry` 支撐。每個同步貢獻都會接收尚未發布的 child 上下文，並返回其安裝的 disposer。繼續執行管理器首先應用基礎 child 組合，然後透過同一個用於首次建立與冷復原的設定閉包，按註冊順序應用當前貢獻。

登錄檔負責註冊、每個 child 的安裝記錄、設定回滾、child 作用域清理和立即撤銷。應用一個批次會返回 Agent setup 提交對象，用於在每次 setup 的 await 結帳後以及緊鄰 Agent 發布前重新校驗設定狀態。因此，某項貢獻拋出例外或被並行撤銷時，會在 Agent 與工作階段發布前拒絕操作並回滾該批次。新註冊項只會在駐留 child 的下一個 Activation 生效；移除註冊項時，會先將它對新設定關閉，再立即撤銷為正在預設定或駐留的每個 child 安裝的實例。註冊 dispose（資源釋放）與 child 上下文 dispose 都是冪等的，兩者都會先嘗試每項釋放，再聚合失敗。

該 seam 使繼續執行管理器無需知道工具名。report 包只安裝 `report` 及其 child 作用域指引 section；`@deepseek-ai/dsh-tool-subagent-control` 則獨立安裝 parent 側的 `send_message` 和 `list_agents`。部署時可安裝任一方向、同時安裝兩者或兩者均不安裝。提供方仍只負責資料，持久化描述符不會對 report 可用性或投遞模式建立快照，冷復原則使用部署當前的貢獻與策略。

### 快照覆蓋

ACP（Agent Client Protocol）快照 harness 新增 `waitForSubagentTurnEnd`，按與 `session.N.jsonl` 相同的順序選擇第 N 個已收集 child。它會等待一個包含請求 header 的已閉合 child 輪次，以防可繼續 child 早期播種描述符的輪次錯誤滿足該邊界。這樣，整體組裝的場景無需偽造 parent 可見訊號，就能等待 child 側報告。

手寫快照會啟動一個可繼續 child，執行真實的作用域區域性 `report` 工具，觀察默認喚醒投遞所產生的那一個普通 parent 輪次，然後提交一條後續 parent 提示詞，使其消費封裝後的報告。它聲明 child pin `1`，因此本不屬於全域性的 `report` schema 與該 child 自身的提示詞會分別與 `tool-schemas.1.expected.json` 和 `system-prompt.1.expected.md` 比對，root 則繼續使用類別 pin。生成的工具目錄會另外鑄造一個 child 作用域，以收錄同一個作用域區域性 schema。

## 曾考慮的替代方案

### 自動投遞每個最終回答

自動投遞無法表示零次報告、進展報告或多次精選更新。它還會將報告與結帳耦合，並可能重複投遞已顯式報告的內容。

### 始終喚醒 parent

每次報告都喚醒 parent 會產生未經請求的輪次，還可能沿巢狀 subagent 級聯擴散。當初選擇靜默投遞作為預設值，前提是 parent 還有別的理由去讀自己的上下文。[報告義務](2026-08-06-continuable-child-report-obligation.md)取代了該選擇：已經停駐的後臺協調者並沒有這樣的理由，因此喚醒成為預設值，而本段現在記錄的是 `quiet` 為何仍然保留。

### 允許 child 選擇投遞模式

向模型提供 mode 參數會賦予其控制調度器壓力的能力，並使行為相依性部署。child 只決定內容和時機；該內容是否啟動另一個 Agent 輪次，由部署設定決定。

### 註冊全域性工具

全域性 `report` 會向 root、one-shot child、遠端 child 和無 agent 呼叫方公佈一項無法使用的能力。到執行時才拒絕，會使 schema 可見性與權限不一致。

### 將兩個方向合併到 control 包

`send_message` 與 `report` 的受眾、作用域、設定和生命週期各不相同。獨立的包可讓部署授予任意一個方向，而不暗示也授予另一個方向。

### 持久化離線 parent 郵箱

修改或冷復原不線上的 parent，需要一套新的持久化尋址、權限、衝突、確認和重播協議。要求直接 parent 線上，可以讓首個版本繼續使用現有 Agent 傳送路徑。

### 重新引入 Task 或結果 promise

承載結果的包裝層會讓一次報告或一個輪次看似具有終止性，並重新引入可繼續 Activation 已經移除的生命週期不匹配。顯式、可重複的傳送無需中間執行對象。

### 在 Agent 建立後校驗 setup

建立完成後的撤銷檢查只能在 Agent 與工作階段均已發布後拒絕 Activation。對返回的 handle 執行 dispose 會移除即時對象，但當前 seam 無法刪除持久化內容，因此會留下一個仍可復原的 child，而繼續執行管理器卻判定它從未建立。改為返回 `AgentSetupCommit`，Agent 工廠便可在自身的發布邊界同步執行同一項可變狀態檢查。

## 影響

- 只有安裝 report 包貢獻時，可繼續行程內 child 才會恰好暴露一個作用域區域性 `report` schema；無關 Agent 永遠不會暴露該 schema。
- 工具返回 parent 訊息的穩定 `MessageId`。靜默投遞沒有 `InboxItemId`；喚醒投遞會產生一個單獨的 inbox 條目實例。
- 只有確切的駐留 child 才能報告，且只能報告給根據持久化譜系推導的確切線上直接 parent。服務不接受接收方參數，也不提供離線 fallback。
- 喚醒投遞是校驗後的默認模式：它會恰好建立一個後續 FIFO 輪次，絕不 steering 已開始的輪次。靜默投遞則絕不會啟動 parent 請求。
- parent 接受後取消或 dispose child 不會撤回報告。接受前，child dispose、drain、parent 丟失或呼叫方取消都會拒絕操作。
- 新建和復原的 Activation 都會在發布前組合當前設定貢獻。新授權等待下一個 Activation 才生效，而已駐留 child 的授權撤銷立即生效。
- 單元覆蓋固定可見性、allow-list 行為、兩種投遞模式、穩定的訊息與傳送方身份、巢狀路由、無效傳送方、缺失的 parent、取消、drain、撤銷競爭，以及不存在 Task 或隱式最終報告。
- 無金鑰整體組裝快照證明真實 child 工具、那一個被喚醒的 parent 輪次、持久化 parent 封裝，以及 parent 後續消費。

### 已接受的風險

該接受邊界弱於持久化端到端投遞。崩潰可能導致結果不明，重試則可能重複報告。

喚醒投遞可能在巢狀 child 頻繁報告時放大模型工作量。透過 `reportDelivery` 交由部署所有者控制，可以限制該風險，但無法完全消除。

登錄檔中的存在性就是 parent 線上訊號。宿主擁有的 parent 如果已開始 `AgentHandle.dispose()` 但尚未完成其作用域清理，仍可能接受並追加一條本行程不會再處理的報告。要彌合這個缺口，需要 Agent 層面的 dispose 開始訊號，不能由 subagent 層推斷。
