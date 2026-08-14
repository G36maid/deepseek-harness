# Agent Note: 在單個連線上多路複用並行 ACP 工作階段

Status: implemented

[English](2026-06-14-acp-multi-session.md) | [简体中文](2026-06-14-acp-multi-session.zh.md) | 繁體中文

> 本 Agent Note 寫於 ACP 還是編輯器橋接層的時期，動機來自 Zed 的多工作階段用戶端模型。[ACP 作為僅面向自動化的協議](../simplification/2026-07-23-acp-automation-only-protocol.md)移除了編輯器介面；多路複用決策本身不變，本 Agent Note 現依照自動化約定陳述它。

## 問題

一個 ACP（Agent Client Protocol）自動化用戶端可以在同一個 agent（代理）子行程上保持多個對話。如果橋接層只支持單活躍工作階段，就不得不啟動額外行程，也會阻止一個父控制器透過一條連線驅動多個獨立子任務。多路複用引入了隔離風險：已提交的回答、提示詞完成、取消、權限請求以及可預測的後臺 job id 絕不能跨越工作階段邊界。

## 決策

ACP 橋接層將活躍工作階段儲存在 `Map<SessionId, SessionRecord>` 中。agent 作用域的回呼使用 `ownedRecord`：在正向 map 中尋找 `agent.session.id`，且僅當該記錄擁有精確的 agent 對象時才接納它，使外部的同 id 對象無法冒領工作階段。一條記錄擁有其 agent、精確的釋放器，以及選填的進行中提示詞和最終結帳它的持久輪次號。工作階段 header 擁有其 cwd；橋接層不保留平行的工作區或用戶端能力狀態。

每個 `session/event` 回呼在傳送或結帳任何內容之前，先解析出所屬記錄。每個工作階段獨立允許一個進行中的提示詞。提示詞捕獲自己源自使用者訊息的 `turn/start`，並僅在匹配的 `turn/end` 到達時結帳；注入輪次、外掛程式或 goal 的自主輪次，以及來自已取消的前一輪次的遲到 end 都不能 resolve 它。`session/cancel` 定位到一條記錄，只調用該 agent 的佇列感知取消路徑。

權限歸屬使用對正向 map 的同一精確 agent 檢查。ACP `approval/request` 應答器只為擁有發起請求的 agent 的工作階段傳送一次性機器策略請求，並將外部請求或不帶 call id 的請求委託出去。橋接層沒有表單引導、設定選擇或其他人機互動狀態。

後臺 bash 任務攜帶一個不透明的 owner token，其值等於所屬工作階段 id。`job_output` 和 `job_kill` 在學取或終止之前，將呼叫方的 token 與執行器的任務歸屬進行比較；僅憑可預測的 job id 不能獲得訪問權。歸屬資訊與執行器任務一起儲存，因此工具外掛程式重載不會擦除它。

連線拆除時清空活躍 map，將每個待處理的提示詞以取消狀態結帳，並平行 dispose（資源釋放）所有 `AgentHandle`。每個控制代碼停止並等待其迴圈完成、在仍然附著時刷新工作階段、註銷 agent 並移除工作階段。拆除操作被 memoize 化，由用戶端斷連和外掛程式 dispose 共享。

## 協議與工作區作用域

[ACP v1 明確允許一個連線上存在多個並行工作階段](https://github.com/agentclientprotocol/agent-client-protocol/blob/01beb5fb5eec60e9f516a80d85eb03594bac61e3/docs/get-started/architecture.mdx#L16-L24)，每個新工作階段都攜帶自己的主 `cwd`。本橋實作該工作階段級多路複用，其中包括[按工作階段 cwd 決策](../architecture/2026-07-02-fs-per-session-cwd.md)所記錄的不同主工作區；它不會為每個工作階段建立一個 agent 子行程。

一個工作階段內部的多根項目是另一項選填能力：ACP 把[有效根目錄定義為主 `cwd` 加 `additionalDirectories`](https://github.com/agentclientprotocol/agent-client-protocol/blob/01beb5fb5eec60e9f516a80d85eb03594bac61e3/docs/protocol/v1/session-setup.mdx#L313-L367)。自動化橋接層不公佈任何多根能力，並拒絕非空的 `additionalDirectories`；如[包約定](../../../../packages/acp/acp/README.md#protocol-contract)所記錄，每個全新工作階段恰好有一個工作區。

[標準傳輸是每個 stdio 連線一個 agent 子行程](https://github.com/agentclientprotocol/agent-client-protocol/blob/01beb5fb5eec60e9f516a80d85eb03594bac61e3/docs/protocol/v1/transports.mdx#L17-L42)；多個連線因此需要多個子行程或自訂傳輸，而本決策保證的是一個連線內部存在多個工作階段。在該連線內，`ctx.sandboxPolicy` 把每個工作階段的 `cwd` 解析為其自己的 `workspace-write` 根目錄，因此共享的 bash 和檔案系統服務可以服務並行項目而不授予跨項目寫入。這不會新增 ACP `additionalDirectories`；它只是從已經支持的「每工作階段一個主根目錄」路徑中移除了行程級根目錄限制。

## 曾考慮的替代方案

**每連線單活躍工作階段**：否決。增加行程開銷，並阻止程序化的父控制器多路複用可獨立取消的工作。

**每工作階段 `ctx.extend()`**：否決。子上下文本身不會建立子外掛程式 fiber，因此監聽器仍屬於橋接層 fiber。實際實作的橋接層使用全域性監聽器加顯式 O(1) 解複用，以及每工作階段擁有的記錄；agent 生命週期由 `AgentHandle` 管理。

**以 agent 對象標識作為 bash 任務歸屬**：否決。復原或替換後的 agent 對象可能合法地代表同一個持久工作階段。不透明的工作階段 token 纔是跨邊界的標識，應當在外掛程式重載後仍然存活。

## 後果

N 個工作階段可以並行地返回已提交的回答、提交提示詞、請求權限和執行背景工作，而不會交錯或跨工作階段結帳。一個工作階段中的取消不影響相鄰工作階段。橋接層為此付出了顯式 map 和隔離測試的代價，但它不會為每個工作階段新增一組監聽器，從而避免了長連線期間的監聽器扇出。

橋接層不暴露獨立關閉單個活躍工作階段的協議方法。所有記錄會在連線拆除時一並移除；工作階段導覽與復原屬於 host API，而非這個自動化協議。

## 驗證

多工作階段測試套件透過按路由投遞的已提交回答、獨立的進行中提示詞、定向取消以及共享拆除來驅動並行工作階段；審批與輸出邊界套件覆蓋權限路由和對非同一 agent 對象的拒絕。工具 bash 測試證明一個工作階段無法讀取或終止另一個工作階段的背景工作。
