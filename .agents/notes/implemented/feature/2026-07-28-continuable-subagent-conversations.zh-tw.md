# Agent Note: 可繼續的 subagent

Status: implemented

[English](2026-07-28-continuable-subagent-conversations.md) | [简体中文](2026-07-28-continuable-subagent-conversations.zh.md) | 繁體中文

本記錄取代[可繼續的後臺 subagent](../../implemented/feature/2026-07-21-continuable-background-subagents.md)中由 Task 支撐的繼續執行管理器。它保留[將 subagent 控制合併到 subagent 服務](../../implemented/simplification/2026-07-26-merge-subagent-control-service.md)確立的單一 `ctx.subagents` 服務，以及[以意圖命名的 subagent 繼續執行操作](../../implemented/simplification/2026-07-27-intent-named-subagent-continuation-operations.md)確立的 `followup` 操作。

## 問題

以前的繼續執行管理器讓一個 Task、一次提供方執行和一個結果邊界共享同一生命週期。Task 結帳會 dispose（資源釋放）child Agent，Task 完成會注入完成通知，後續輸入則重建另一個 Agent。這曾使通用後臺工作抽象與工作階段投遞耦合，而可繼續 subagent 已經具備工作階段和 Agent inbox。

如果繼續執行管理器為繼續執行請求排隊，而 Agent 保留自己的 inbox，系統就會出現兩個 FIFO，且沒有唯一的順序權威。而把所有訊息都交給 Task，則重複了 agent loop（代理循環）已有的准入、取消和完全靜止機制。`Agent.whenIdle()` 無法復原單項請求的 Task 結果，因為一個執行區間可能清空多個排隊輪次；寬泛的 `Agent.cancel()` 也不能精確移除一項排隊請求。

執行時期生命週期也比單個輪次更長。subagent 可能已經結束自身輪次，但它建立的 child 仍在執行。此時 dispose parent 執行時期，會移除仍負責後代拆卸的 Agent。反之，如果讓所有歷史 subagent 始終駐留，記憶體使用就會失去上界。

parent Agent 還需要在不改變當前輪次的前提下，向同一個線上 child 傳送後續工作。將每條繼續執行訊息作為 follow-up 排隊，可以保留唯一的排序規則。

## 決策

一個可繼續 subagent 擁有一個持久化工作階段，並且至多擁有一個行程內啟用：

```text
persisted Session
  -> optional live Activation
       -> one retained AgentHandle
       -> Agent inbox as the only turn FIFO
       -> zero or more owned child Activations
```

啟用是重建 child Agent 的一次駐留週期。它可以執行多個 FIFO 輪次，並在等待後代時保持駐留。它不是請求、結果、取消或 Task 邊界。

繼續執行管理器負責啟用准入、權限檢查、線上所有權圖、冷復原和 child-first dispose。Agent loop 負責全部輪次排序與執行。沒有任何可繼續 subagent 擁有 Task、啟用 FIFO 或 queued 啟用狀態。

### 物化與公開操作

具名 subagent 提供方只參與準備初始建立規格，此時 `spawn` 與 `fork` 有所區別。其選填的 `prepareContinuable(request): Promise<ContinuableCreateSpec>` 方法就是可繼續建立能力。返回的規格只包含與 Agent 實例分離且由提供方決定的建立輸入，例如選填的 parent 歷史種子；它不包含 Agent、`AgentHandle`、提示詞投遞、結果、dispose 或復原操作。管理器會預留 child 身份，解析持久化描述符和通用 Agent 設定，透過私有 activation-owner 作用域呼叫 `ctx.agents.create()`，將返回的 `AgentHandle` 安裝到啟用中，建立適用的可繼續 parent 所有權，然後呼叫 `Agent.followup(initialPrompt)`。inbox 接受訊息後會產生一個 `MessageId`；`ctx.subagents.startContinuable()` 在此邊界返回 `{ childId, messageId }`，不等待輪次開始，也不等待訊息寫入工作階段日誌。

inbox 接受訊息前發生任何失敗，操作都會在不返回任何 id 的情況下被拒絕。Agent 建立流程負責 handle 移交前的回滾；移交後，管理器會保留一個對並行投遞和 drain 可見的關閉交易，dispose 已建立的 handle、移除啟用並回滾 parent `ownedChildren` 中的任何成員關係，再拒絕操作。在駐留 start 事件發布前失敗不會發布終止事件，start 發布後失敗則透過正常 dispose 閉合生命週期配對。

`backgroundMode: 'one-shot' | 'continuable'` 仍是部署策略。設定為 continuable 時要求存在 `prepareContinuable`；該方法是否存在會取代 `SubagentProvider.resume?()` 成為能力檢查，而具備該能力的提供方仍可執行 one-shot 工作。

冷復原不會透過 subagent 提供方分發。繼續執行管理器會歸並通用的行程內描述符，透過同一個 activation-owner 作用域呼叫 `ctx.agents.resume()`，安裝返回的 `AgentHandle`，並提交等待中的 `next-turn`。`SubagentProvider.resume?()` 和 `SubagentProviderResumeRequest` 均不存在。初始提供方註銷後，描述符仍保留其名稱；該名稱不賦予復原能力，也不要求後續駐留時該提供方存在。遠端提供方需要單獨設計。

`SubagentProvider.start()` 和 `SubagentRun` 只保留在不變的 one-shot 路徑上。可繼續啟用直接持有自身的 `AgentHandle`，絕不建立、包裝或保留 `SubagentRun`；因此，`SubagentRun.steer?()` 不存在。

`ctx.subagents.followup(parent, childId, content, { source, signal })` 仍是唯一的從 parent 到 child 的繼續執行訊息操作。確切的線上 parent Agent 授權投遞；冷復原會在重建前檢查該權限，每條路徑還會在最終無 await 的 inbox 准入區間再次檢查，因此在物化期間被註銷或替換的 parent 無法授權投遞。`source` 記錄誰提供了獲準訊息，不賦予任何權限。面向模型的 `send_message` 工具只保留穩定的 `subagent_id` 和 `message` 欄位，並始終提交一個 follow-up 輪次。start 和 follow-up 都返回已接受的 `MessageId`，兩者都不報告管理器如何物化啟用。

對於 start 和 follow-up，呼叫方 signal 只在 inbox 接受訊息前持有尋找、物化和准入。操作返回 `MessageId` 後，管理器會獨立持有該啟用；呼叫方之後的取消不會取消已接受的輪次，也不會 dispose child。

### 持久化工作階段與線上啟用

工作階段持有穩定的 child 身份、transcript（文字記錄）、直接 parent 譜系、委派深度和帶版本的繼續執行描述符。`SessionHeader.parentSession` 記錄直接 parent，並作為鑒權輸入；它不是線上路由能力，也不表示記錄的 parent 仍然駐留。

空閒的歷史工作階段沒有 `AgentHandle`。第一條透過鑒權的 `next-turn` 投遞會根據持久化工作階段復原啟用，並將訊息提交到其 inbox。冷復原使用經過身份認證的確切線上 parent Agent 執行鑒權；當該 parent 有啟用時，還使用它建立所有權，但絕不使用 parent 執行重建。

啟用會直接持有已發布的 `AgentHandle` 直至結帳，而管理器的私有 activation-owner 作用域則是其 Cordis 結構化所有者。可繼續 subagent 路徑不建立任何中間的帶結果執行包裝層，包括 `SubagentRun`；一次性委派保持不變，且不屬於該生命週期。遠端提供方不在此處的範圍內，引入時需要單獨的啟用所有權約定。啟用 dispose 後，歷史工作階段不消耗執行時期記憶體。

### 啟用生命週期

內部駐留生命週期有三個條件，沒有單獨的 `queued` 狀態：

```text
running
  | Agent quiescent with live children
  v
waiting
  | next-turn
  +--------------------------> running

running or waiting
  | Agent quiescent and no live children
  v
settled
  | AgentHandle.dispose completes
  v
no Activation
```

`running` 表示 Agent 正在執行准入或輪次，或者 inbox 中存在會喚醒 Agent 的工作。`waiting` 表示 Agent 已經完全靜止，但啟用仍持有至少一個尚未完成 dispose 的 child 啟用。`settled` 表示 Agent 已經完全靜止且所有持有的 child 都已 dispose；隨後管理器會 dispose `AgentHandle` 並移除啟用。

管理器根據 Agent 是否完全靜止以及所持 child 集合派生這些狀態，而不是維護第二套執行狀態機。在 `running` 時投遞的 `next-turn` 會進入 Agent inbox。在 `waiting` 時投遞的 `next-turn` 會喚醒同一個 Agent，並使啟用回到 `running`。在 dispose 完成後投遞訊息則會冷復原新啟用。

管理器會針對每個持久化 child，將投遞、child 釋放和 dispose 線性化。如果投遞與最終 dispose 發生競爭，只有一方能越過准入截止點：投遞要麼進入仍線上的 Agent inbox，要麼等待 dispose 完成後冷復原新啟用。任何呼叫方都不能向已經開始 dispose 交易的 handle 傳送訊息。

### 一個 inbox 與 follow-up 投遞

Agent inbox 是唯一佇列。每條繼續執行訊息都使用 `Agent.followup()`，並成為一個 FIFO 輪次；繼續執行管理器和宿主都不維護另一則訊息佇列。每個已接受且會喚醒 Agent 的條目都會讓當前啟用保持線上，直至 `Agent.whenIdle()` 觀察到完整的喚醒工作後綴已經結束。

路由只取決於啟用的駐留狀態：

| 啟用狀態 | `followup` |
|---|---|
| `running` | 在同一啟用中排隊 |
| `waiting` | 喚醒同一啟用 |
| 無啟用 | 冷復原新啟用 |

繼續執行層不定義單獨的投遞路由結果。成功投遞 `ctx.subagents.followup()` 或 `send_message` 時會返回已接受的 `MessageId`，投遞失敗則會拋出例外。現有的 `agent/inbox/enqueue`、`agent/inbox/dequeue` 和 `agent/inbox/discard` 事件仍用於觀測訊息生命週期；配接器可以呈現通用的接受確認，但不暴露 `started`、`queued`、`resumed` 或其他 subagent 專屬路由詞彙。

### child 所有權

每次啟用都持有自身的 `AgentHandle` 和一個 `ownedChildren: Set<SessionId>`。由於一個工作階段至多有一次線上啟用，child 工作階段 id 足以標識線上 child，無需另一個執行時期 incarnation 引用。`SessionHeader.parentSession` 記錄持久化的直接 parent 身份，`ownedChildren` 中的成員關係則記錄行程內所有權關係。

當經過身份認證的 parent 自身是由繼續執行管理器管理的啟用時，啟動 child 或提交由 parent 發起的工作，會在 child 可以執行或訊息可以進入其 inbox 前，將 child 工作階段 id 加入該 parent 的 `ownedChildren`。該集合非空時，這個 parent 不能結帳或 dispose。頂層 Agent 或其他非繼續執行 Agent 沒有啟用，也不會加入該等待圖。

只有在 child Agent 完全靜止、該 child 持有的每個 child 都已 dispose、best-effort 的最終工作階段 flush 結帳且 child 的 `AgentHandle` 完成 dispose 後，系統才釋放 child。管理器會等待 `ctx.sessions.flush(child.session)`，但不解釋其參與布林值：任意 listener 都無法證明所選持久化後端已儲存該狀態。rejection 會被記錄，但不會阻止 handle dispose 或釋放所有權，因為保留 child 會讓其祖先永久固定在 `waiting`。如果 child 歸 parent 所有，管理器隨後會透過 `SessionHeader.parentSession` 解析線上 parent，並從其 `ownedChildren` 中移除 child 工作階段 id。管理器拆卸使用相同的 child-first 順序。

系統會一直保留所有權，直至 child 啟用完成 dispose。後續改進可以更早釋放限定到請求的 lease，但這需要精確關聯輪次完成，而本 Task-free 設計特意不增加該機制。

頂層拆卸由宿主負責，而不表示為另一次啟用。管理器解除安裝會呼叫其內部的管理器全域性 drain，同步關閉准入，等待每個已獲準的物化過程完成發布或回滾，停止穩定的線上森林，並按 child-first 順序釋放。擁有選定頂層 Agent 的宿主使用 `drainContinuableDescendants(parents)`：確切的 Agent 身份只關閉這些根之下的准入，直到每個身份離開登錄檔，而無關森林和管理器全域性准入保持線上；管理器會在第一次 await 之前停止其可見後代，只等待這些根之下已獲準的物化過程，並且只釋放選定分支。每個已物化的 start 和線上投遞都會在與 inbox 提交相同的同步區間內重新檢查呼叫方取消、適用的 draining 作用域、Activation dispose 和確切的 parent 權限，因此只要拆卸或 parent 替換先於接受發生，就會阻止向正在關閉的 handle 投遞。只有適用的 drain 結帳後，宿主才能 dispose 自己的頂層 Agent；只有管理器全域性 drain 會先於管理器作用域 dispose。

activation-owner 作用域之所以存在，是因為普通 Cordis owner effect 按註冊逆序撤銷，無法表達動態 child 圖。管理器初始化時先註冊私有作用域的結構化 disposer，再註冊自身的 drain disposer，使逆序撤銷先執行 drain、再釋放該作用域；如果只在與後續 Agent handle 相同的作用域上註冊 cleanup effect，結構化 handle dispose 就可能繞過 child-first 順序。每個物化過程都會在啟動內部交易前註冊其屏障參與項，並對其確切的線上祖先建立快照，然後保持跟蹤，直到安裝 Activation 或完全回滾。Activation 會保留其在這組祖先中的弱成員關係，因此中間 Agent 即使離開登錄檔，也不會讓仍線上的後代脫離宿主根節點的可見範圍。每個 Activation 都會在取消或遞迴回呼前安裝一個記憶化的 dispose promise，使限定作用域的宿主關閉、全域性管理器解除安裝、child 釋放和正常結帳能夠匯合，而不會重複釋放。取消會在等待緩慢的後代清理之前自頂向下傳播；handle 釋放仍是 child-first。同級分支獨立 drain；系統會記錄單次 dispose 失敗，但仍會嘗試其餘選中 handle，聚合 drain 則在所有選中分支結帳後報告失敗。這次行程內拆卸不會銷毀持久化 child 工作階段。

### 報告投遞擴充

後來新增的選填 child 作用域 `report(output)` 工具不會改變 Activation 駐留狀態，也不會增加另一條佇列。它每輪可呼叫零次或多次，不允許指定接收方，而是推導線上的直接 parent；投遞採用靜默注入還是喚醒 parent follow-up，由部署設定選擇。[report 工具 Agent Note](2026-07-30-continuable-subagent-report-tool.md)規定其權限、確認、設定貢獻和投遞約定。

### 延後的 steering（中途引導）

本版本不暴露 subagent steering 操作。parent 的繼續執行訊息始終開啟後續 FIFO 輪次，因此繼續執行層不儲存當前輪次控制方，也不新增能夠感知控制方的 Agent 准入約定。

後續宿主 UI 可以分別暴露 **Steer** 和 **Follow up** 操作。宿主 steering 必須嚴格且僅限線上使用：只有當啟用接受下一步驟時，它才能呼叫現有的 Agent steering 路徑；其他情況必須拒絕，而且絕不能轉為排隊或冷復原。是否透過面向模型的工具暴露 parent steering 仍需單獨設計。

### 權限與已記錄的傳送方身份

權限來自確切的線上 Agent 工具上下文。准入後，`MessageSource` 和 `senderSessionId` 記錄誰提供了訊息；呼叫方不能用這些欄位取得權限。

本版本只授權持久化 child 的直接 parent。管理器會在將 child 註冊到該 parent 的 `ownedChildren` 之前，於最終無 await 的 inbox 准入邊界根據確切的線上 parent Agent 檢查 `SessionHeader.parentSession`；冷復原還會在重建前執行一次更早的檢查，以便快速失敗。其他 Agent、祖先、宿主、團隊和工作流程仍被拒絕，直至有具體消費端證明另一種權限協議合理。

由 parent 發起的投遞要求 parent 在准入時線上，並透過所有權關係使其繼續線上。

### 持久性、dispose 與復原

沒有 Task 後，系統不再提供 `job_output`、`job_kill`、Task 狀態或逐訊息結果 promise。呼叫方 signal 只能在 inbox 接受訊息前中止 start 或 follow-up。訊息被接受後，parent 不能透過 `ctx.subagents` 取消已接受的訊息或 dispose 啟用；唯一的公開停止操作是後來的[當前輪次中斷](2026-08-06-continuable-subagent-interrupt.md)，它以 `keepInbox` 取消線上目標的當前輪次，駐留、待處理工作與後代均保持不變。

宿主和管理器拆卸仍是生命週期停止路徑。管理器解除安裝會全域性應用它；宿主只會在自己確切擁有的頂層 Agent 之下應用它。兩種形式都會關閉適用的准入作用域，停止選中的可見 Activation，等待該作用域中已獲準的物化過程，按 child-first 順序釋放，並保留持久化 Session。

每個輪次都會請求執行工作階段持久性檢查點，而 Activation 最終結帳還會等待 `ctx.sessions.flush()`，將其作為 best-effort 屏障。管理器特意忽略布林結果，因為 listener 是否參與無法標識持久化後端。rejection 會被記錄，但不會改變生命週期結果或宿主 drain 的結果；管理器仍會 dispose handle 並釋放所有權，後續復原時持久化 child 狀態可能缺失或過時。

只有實際寫入 child 工作階段日誌的訊息，才能在重建時保留提供它的來源；僅被 inbox 接受並不提供重新啟動保證。

工作階段和描述符的持久化狀態可在重新啟動後保留。啟用狀態、Agent inbox 內容和所有權圖都是行程內狀態。行程崩潰可能丟失已被接受但仍留在 inbox、尚未寫入工作階段日誌的初始提示詞或 follow-up。工作階段和描述符可能保留，因此後續獲得授權的訊息仍可冷復原 child，但丟失的訊息不會自動重播。復原已接受但未完成或未寫入日誌的訊息需要持久化 inbox 協議，本提案不隱含該能力。

### 範圍

本版本覆蓋可繼續的行程內 child，一次性委派保持不變。遠端提供方必須具備單獨的啟用 handle，以及等價的認證控制與 child-first 完全靜止約定，才能支持同樣的行為。

它不新增 host-user 繼續執行、subagent steering 操作、持久化郵箱、跨行程 lease、中斷 inbox 工作的自動重播、團隊權限、工作流程權限、公開駐留查詢、新的線上啟用數量或後代總數限制，以及執行時期快取；後來的[當前輪次中斷](2026-08-06-continuable-subagent-interrupt.md)在此生命週期之上補充了唯一的公開停止操作。現有委派深度策略保持不變。選填的 child 到 parent 報告是後續消費該生命週期的功能，不屬於基礎可繼續能力。

## 曾考慮的替代方案

**保留由 Task 支撐的啟用。** Task 可以提供通用狀態、結果收集和取消，但使用 Task 投遞工作階段會產生第二條佇列，並重複輪次所有權。本設計放棄這些通用 Task 控制，讓 Agent inbox 成為唯一執行順序。

**每個 `next-turn` 建立一次啟用。** 這會復原獨立的結果與取消邊界，但需要在 Agent inbox 旁維護管理器 FIFO，還會使所保留的 Agent 跨越人為劃分的啟用邊界。每個駐留週期對應一次啟用更小，也直接跟隨 `AgentHandle` 生命週期。

**等待期間 dispose Agent。** child 仍屬於上一個行程內所有權圖時重建 parent，需要持久化所有權與拆卸協議。只為尚未完成的所有權圖保留 `AgentHandle`，可以在不讓已結帳歷史駐留的前提下，保留 child-first 拆卸。

**讓提供方透過 Agent handle 建立、復原 child 或投遞訊息。** 初始提供方只持有 `prepareContinuable()` 及其分離式建立規格這一項差異：child 是全新啟動，還是帶有 parent 前綴。管理器必須透過私有 activation-owner 作用域自行呼叫 `ctx.agents.create()`，使該作用域成為每個 handle 的結構化所有者。持久化的行程內工作階段已經包含初始前綴及通用重建描述符，訊息投遞則屬於 Agent inbox。讓提供方持有任何後續 handle、`SubagentRun` 或訊息所有權，會讓提供方保留所有權，卻沒有已發布行為需要它。

**將報告投遞納入基礎生命週期。** 可重複的 child 到 parent 報告與該生命週期相容，但靜默投遞還是喚醒投遞、確認、持久性和重試行為都是獨立的產品決策。後續的 report 包保持選填，並消費一個顯式的 child 設定掛鉤，因此可繼續駐留不會默認授予返回通道。

**將 `SessionHeader.parentSession` 視為線上所有權。** 持久化譜系不能證明已記錄的 parent 當前持有 child。線上 parent 的 `ownedChildren` 成員關係會記錄行程內關係，而不改變持久化 parent id。

**在單獨的 link 中保留確切的 parent Agent。** parent 啟用已經持有自身 `AgentHandle`，而且 `ownedChildren` 會在 child 仍然線上時阻止該啟用 dispose。因此，透過工作階段 id 解析 parent 已經足夠，也可以避免冗餘的執行時期引用。

**為繼續執行訊息維護單獨佇列。** 第二個 FIFO 會讓它和 Agent 已接受訊息之間順序不明確。單個 Agent inbox 為每個已接受輪次提供唯一且可觀察的順序。

**現在就暴露 subagent steering。** parent steering 需要當前輪次控制方狀態，以及不同於 follow-up 投遞的單獨准入策略。首個版本將每條繼續執行訊息都排隊，可以避免引入該狀態及其准入競爭。

**在沒有 host 消費端的情況下暴露 host-user follow-up。** 公開的權限鑄造方法和使用者分支可以在沒有歷史 parent 的情況下實作冷復原，但沒有生產 host 配接器呼叫該操作。在具體的經認證宿主互動能夠收到私有能力之前，繼續執行 API 只接受確切的線上 parent。

**返回 subagent 專屬的投遞路由。** `started`、`queued` 和 `resumed` 等標籤重複了啟用與 inbox 狀態，卻沒有給呼叫方提供獨立結果。複用 `MessageId` 和現有 inbox 事件，可以讓投遞關聯繼續由其所屬的 Agent 約定承載。

**使用 child 引用計數。** 計數無法識別哪個 child 仍持有拆卸工作，也允許重複遞減錯誤。身份集合會顯式保留取消和 dispose 義務。

## 影響

本實作固定了以下行為：

- 可繼續 child 至多擁有一個線上啟用和一個 Agent inbox；繼續執行管理器沒有啟用 FIFO 或 queued 啟用狀態。
- `SubagentProvider.prepareContinuable?()` 只返回分離式 `ContinuableCreateSpec`；設定為 continuable 時要求具備該能力，而 `backgroundMode` 仍是獨立的策略選擇。
- 管理器透過私有 activation-owner 作用域呼叫 `ctx.agents.create()`，安裝返回的 `AgentHandle` 並建立 parent 所有權，呼叫 `Agent.followup(initialPrompt)`，然後在 inbox 接受訊息並產生 `MessageId` 時返回 `{ childId, messageId }`，而不等待輪次開始或訊息寫入工作階段日誌。
- 初始提示詞被 inbox 接受前的每條失敗路徑都會導致操作被拒絕且不返回 id，並透過一個對並行投遞和 drain 可見的關閉交易回滾已建立的任何 handle、啟用和 parent `ownedChildren` 成員關係；生命週期發布失敗不會產生無配對的終止事件。
- 冷復原由繼續執行管理器呼叫 `ctx.agents.resume()`，絕不透過或相依性初始 subagent 提供方；提供方移除後，描述符仍保留初始提供方名稱，且 `SubagentProvider.resume?()` 和 `SubagentProviderResumeRequest` 均不存在。
- 可繼續啟用直接持有 `AgentHandle`，絕不建立、包裝或保留 `SubagentRun`；`SubagentProvider.start()` 和 `SubagentRun` 只用於 one-shot，且沒有 `SubagentRun.steer?()`。
- `followup()` 只接受確切的線上直接 parent，並在任何物化之後的最終無 await 的 inbox 准入邊界再次檢查該身份；持久化訊息來源資訊不能授權投遞。
- 繼續執行訊息始終使用 `Agent.followup()` 並共享其 inbox FIFO，包括 child 已有開放輪次的情況。
- `ctx.subagents.followup()` 及其 `send_message` 配接器只返回已接受的 `MessageId`；繼續執行層不接受投遞 target，也不定義 subagent 專屬路由結果。
- 呼叫方 signal 只能在 inbox 接受訊息前停止 start 和 follow-up，限定到宿主的拆卸與管理器全域性拆卸則保留 child-first 清理；[當前輪次中斷](2026-08-06-continuable-subagent-interrupt.md)是唯一的公開停止操作，且不進入拆卸流程。
- 本版本不暴露 subagent steering 操作或當前輪次控制方狀態。
- 帶有線上所持 child 的空閒 Agent 會產生 `waiting` 啟用，其 `AgentHandle` 繼續保留。
- 向 `waiting` 投遞 `next-turn` 會喚醒同一個啟用；完成 dispose 後投遞訊息會冷復原新啟用。
- 每個由繼續執行管理器管理的 parent 啟用只會在直接持有的所有 child 啟用完成 `AgentHandle` dispose 後進行 dispose；頂層 Agent 不加入等待圖。
- Activation 最終結帳會等待 `ctx.sessions.flush(child.session)`，將其作為 best-effort 屏障；它會記錄 rejection，但不會把 listener 參與解釋為持久性證明，然後 dispose child handle 並釋放 parent 所有權，使 flush 失敗不會洩漏 `waiting` Activation。
- 管理器拆卸會全域性關閉准入；擁有選定頂層 Agent 的宿主則只關閉這些確切身份之下的准入，直到這些根離開登錄檔。兩者都會按確切祖先關係跟蹤已獲準的物化過程，為每個選中的可見 Activation 安裝一個記憶化 dispose 截止點，自頂向下傳播取消，按 child-first 順序釋放 handle，即使個別分支失敗也會等待所有選中分支，之後才 dispose 對應的頂層 Agent 或管理器作用域。
- 基礎生命週期不暴露隱式報告行為；選填的 report 包透過 setup 掛鉤貢獻一個顯式的 child 作用域工具。
- 工作階段日誌只會重建實際寫入的訊息，並保留每則訊息的提供來源；已被 inbox 接受但未寫入日誌的訊息沒有重新啟動保證。
- 可繼續 subagent 路徑不建立或相依性 Task、`JobId`、Task 完成通知、Task 取消或中間的帶結果執行包裝層。
- 單元覆蓋固定 `startContinuable()` 在 inbox 接受訊息時的返回邊界、每條接受前和生命週期發布失敗路徑的完整回滾、全域性和限定到 parent 作用域的 drain 都會等待夾在 Agent 發布與 Activation 註冊之間的物化過程完全靜止、同級森林隔離、中間 Agent 離開登錄檔後的確切祖先關係、不相依性提供方的冷復原、冷復原物化後的最終確切 parent 再授權、接受前後兩個階段的呼叫方 signal 與拆卸所有權，以及已接受但未寫入日誌的訊息不會自動重播。
- 單元覆蓋固定僅由駐留狀態決定的路由表、單 inbox 順序、透過 inbox 事件關聯 `MessageId`、在開放輪次期間 follow-up、等待喚醒、冷復原、所有權註冊與釋放、child-first dispose、傳送與 dispose 的競爭、沒有 listener 和 listener 失敗時的 best-effort 最終 flush，以及不存在公開 subagent 取消和 steering。
- report 包的單元覆蓋會分別固定僅 child 可見性、setup 撤銷、權限、投遞模式、穩定訊息身份和生命週期競爭。
- 一項無金鑰整套應用快照覆蓋 parent 委派和 follow-up 排隊、不存在 subagent steering 和隱式 report 投遞、保留 waiting 中的 `AgentHandle` 以及 child-first dispose。另一項 report 快照覆蓋選填的顯式返回通道。

### 已接受的代價

移除 Task 會放棄通用後臺工作檢查、結果收集和精確 Task 取消。如果這些產品功能成為需求，就需要不會重新引入第二條執行佇列的請求 ticket 或 inbox 能力。

在後代執行期間保留啟用，會按尚未完成所有權圖的規模消耗 Agent 資源。現有委派深度策略仍會限制巢狀層級，但本版本不新增線上啟用數量或後代總數限制；已結帳的歷史工作階段不保留 `AgentHandle`。

行程內 inbox 和所有權圖無法協調兩個 harness 行程。允許多個行程並行訪問同一持久化儲存的部署，仍需要持久化 lease 和郵箱協議。

未安裝選填 report 包時，完成 child 輪次既不會把內容傳送給歷史 parent，也不會喚醒它。安裝後，只有顯式呼叫 `report` 才會發送選中內容；靜默投遞不喚醒 parent，喚醒投遞則會排入一個後續輪次。無論如何，child 的詳細輸出都會保留在其持久化工作階段中。

將每條繼續執行訊息排隊，意味著 parent 無法立即糾正正在進行的 child 輪次；糾正操作會在下一個輪次執行。後續 UI steering 操作可以縮短該延遲，而不改變 follow-up 排序。

best-effort 最終 flush 失敗時會記錄日誌，同時執行時期所有權圖繼續 drain；持久化 child 狀態可能缺失或過時。重試與修復需要單獨的復原設計。
