# Agent Note: Workspace UI 完整產品動線

Status: implemented

[English](2026-07-25-workspace-ui-product-flow.md) | [简体中文](2026-07-25-workspace-ui-product-flow.zh.md) | 繁體中文

## Problem

[Domain KV storage 與 Workspace entity](../../proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md)定義了 Workspace 的持久實體、路徑規範和有序 Session 帳本，但沒有定義 Host 接線、歷史資料初始化或 GUI 動線。GUI 同時呈現 Workspace 和 Session；使用者進入 New Session 後必須能夠立即輸入，即使此時還沒有 Host Session，甚至沒有 Host Workspace。

待建立 Workspace、待建立 Session、輸入保留與 Host 實體發布必須具有明確所有者，並在 RPC completion 與 Host frame 以任意順序到達時保持同一頁面身份。若零態提前建立 Host Session，則無輸入的頁面狀態會進入 Host 生命週期。歷史 Session 又只有輕量 `SessionHeader.cwd` 可用於歸組，初始化不能讀取事件正文。

## Decision

### Host 與持久資料

Host 在 Workspace entity 上提供以下 GUI 接線：

| RPC | 行為 |
| --- | --- |
| `workspace.list` | 返回持久有序的 Workspace，並過濾未透過 header 校驗的 Session id |
| `workspace.create({ path })` | 按 canonical path 收編已有目錄；由 basename 派生的顯示名可以重複 |
| `workspace.insertBefore({ workspaceId, beforeWorkspaceId? })` | 在持久登錄檔順序內移動一個 Workspace，並返回完整的已提交順序 |
| `workspace.delete({ workspaceId })` | 移除 Workspace 註冊記錄，同時保留目錄和工作階段日誌；相關 Session 進入 Ungrouped |
| `session.create({ workspaceId, sessionId? })` | 從 Workspace 解析 cwd，以選填預分配 id 冪等建立 Session 並 attach |
| `session.create({ cwd })` | 保留給非 Workspace 呼叫方，建立 Ungrouped Session |

Host 流推送 Workspace 與 Session 增量，包括 `host/workspace-removed`；Client 重連後分別刷新 `workspace.list` 與 `session.list` 基線。刪除註冊記錄的所有權與安全邊界由 [Workspace 註冊記錄刪除 Agent Note](2026-07-27-workspace-registration-deletion.md)定義。

Workspace 的 `sessionIds` 是有序候選索引。成員投影同時要求 id 位於索引且對應 `SessionHeader.cwd` canonical 後等於 Workspace path；SessionHeader 不增加 `workspaceId`。cwd 匹配但未入索引的 Session 保持 Ungrouped，索引命中但 header 缺失、cwd 無效或 cwd 不匹配的 id 被過濾。同一 Session 被兩個 Workspace 索引佔用屬於損壞狀態並明確報錯。

Workspace domain 以 durable marker 區分「從未初始化」和「已初始化但為空」。marker 未設定時，登錄檔只調用 `SessionPersistence.list()` 讀取 header 元資料，既不呼叫 `load` 或 `inspect`，也不讀取歷史資料或解析事件正文；有效 cwd 按 canonical path 分組，組內 Session 與 Workspace 組均按 header `createdAt` 降序初始化。Bootstrap 可重入，最後才寫 marker；marker 寫入後，繞過 `workspaceId` 的新 Session 不再被自動收編。

### Client 對象模型

`Session` 與 `Workspace` 從頁面 Intent 階段開始就是前端對象。

- 前端 Session 建立時預分配 SessionId，並在對象內持有 Intent target 與 `pendingPrompt`；Host `session.create` 成功後仍是同一個 Session 對象。
- 前端 Workspace 在 materialize 前沒有 WorkspaceId，並在對象內持有 create input、phase 與 error；Host `workspace.create` 成功後同一個 Workspace 對象 adopt 返回的 view。
- `SessionManager` 與 `WorkspaceManager` 負責對象索引、Host 基線和增量合併；對象是 Intent 與 Host view 的唯一狀態源。
- `SessionRuntime` 提供 Session 對象、真實 selection、scope 與清單投影；`WorkspaceRuntime` 相依性 `SessionRuntime`，負責默認 Workspace、跨對象 New Session 動線和 Workspace materialize。

頁面至多有一個前端 Session Intent 和一個僅在零 Workspace 狀態下配套的 Workspace Intent。Intent 只存在於當前頁面，刷新後消失；真實 Session selection 可以持久復原。選擇真實 Session 或啟動另一個 Session Intent 會放棄舊 Intent 的自動傳送資格，但已經由 Host 發布的 Session 和已經接受的訊息不會回滾。

Session 自己持有首條輸入並驅動一條內部管線：必要時以預分配 id attach 到 Workspace，然後傳送 `pendingPrompt`。attach 與 send 的失敗都落回同一 Session。Workspace 建立 phase/error 只屬於 Workspace 對象，Session 不模擬 Workspace 生命週期。

### 使用者動線

應用首次進入時等待 Workspace 與 Session 兩份基線 ready。仍有效的真實 Session selection 被復原；否則進入 New Session，並固定選擇一次最近 Workspace。最近 Workspace 取其成員 Session 的最大 `updatedAt`，空 Workspace 回退到 `createdAt`；該派生只決定默認目標，不改變 Host Workspace 順序，也不會在後續 hydration 時二次改選。

完全沒有 Workspace 時，頁面建立默認名為 `workspace` 的前端 Workspace 對象和指向它的前端 Session。兩者不寫 Host，composer 始終可輸入；首次傳送才依次 materialize Workspace、attach Session、傳送訊息。

頂部 New Session、Workspace 行內加號和 Workspace picker 最終都呼叫同一 New Session 動作：顯式 Workspace id 直接成為目標，未指定時先使用當前 Session 所屬 Workspace，再使用最近 Workspace；沒有真實 Workspace 時進入空白 New Session 頁面。Workspace picker 的單一 Add workspace 動作（見[單一路徑 Note](../simplification/2026-07-31-one-route-to-add-a-workspace.md)；本決策做出時是 Use an existing folder 與按名稱建立兩個動作）會在使用者確認目錄時立即建立真實 Workspace，再將前端 Session 的目標改為該 Workspace；即使使用者不傳送訊息，顯式建立的空 Workspace 也保留。

新建 Workspace 的顯示名取自其所在目錄。不同 canonical path 可以擁有相同的 basename 派生顯示名（見[身份決策](../bug-fix/2026-07-31-same-basename-workspace-adoption.md)）；顯式的重新命名操作仍保留顯示名重名檢查。跨 Workspace 移動 Session、從 Ungrouped 手動收編以及分別輸入顯示名和目錄名仍不在此動線範圍內。

### 首次傳送與復原

前端 Session 的 `pendingPrompt` 在 Host 接受訊息前始終保留原文。首次傳送按 Workspace materialize、Session attach、提示詞傳送順序推進：

1. Workspace 建立失敗時，Workspace Intent 保留輸入與錯誤，Session 仍指向該對象。
2. Session 建立在發布前失敗時，Session Intent 回到可編輯狀態，以同一預分配 SessionId 重試。
3. `workspace-attach-failed` 證明 Session 已發布；同一 Session 對象進入真實清單並保留提示詞，後續重試 attach。
4. 提示詞傳送失敗時，Session 保留提示詞並只重試傳送，不重複建立 Workspace 或 Session。
5. Session 建立期間若頁面切換到另一個 Intent，舊 Session 即使隨後發布也不自動傳送；它保留原提示詞和可見錯誤。

RPC 回應丟失、Host frame 先於 completion 和 completion 先於 Host frame 都透過預分配 SessionId 與對象身份收斂。Manager 對 Host view 做有序 upsert，本機 materialize 時優先保留原對象身份，不生成同 id 的臨時第二行。

### Sidebar 與排序

Workspace 組使用 Host 返回的持久順序。Bootstrap 一次性確定歷史順序，顯式建立的新 Workspace 放在首位，`workspace.insertBefore` 則持久應用使用者拖拽順序；Session 活躍不會移動 Workspace 組。

Host 記帳保持手動的 `Workspace.sessionIds` 順序：新 attach 的 Session 放在首位，活動不會改動該順序。分組瀏覽器可以改選瀏覽器本機的最近更新檢視表；當 Session 的 `updatedAt` 增大時該檢視表會把它移到首位，同時仍允許手動調整。每個打開的 Workspace 默認顯示五條 Session，使用者可臨時展開其餘條目。持久 Workspace 重排序和瀏覽器本機 Session 順序見 [Workspace 側邊欄順序與摺疊](2026-08-11-workspace-sidebar-order-and-folding.md)。

當前空白 Session 會顯示為一條「New session」行，但不顯示數量、時間標籤或行選單；其他空白 Session 保持隱藏，並可由對應 Workspace 複用。搜尋會排除空白行。

無法歸入任何 Workspace 的真實 Session 進入 Ungrouped。Host `session-added` 與 `workspace-changed` 可以任意順序到達，清單合併不相依性 frame 順序。

刪除 Workspace 註冊記錄會移除其分組，但不會刪除或關閉任何 Session。已記帳的 Session（包括當前 Session）會立即進入 Ungrouped；刷新後，獨立的 Workspace 與 Session 基線會重建出相同結果。

### React 與 slot 邊界

React 元件只消費 `useSessions`、`useWorkspaces` 與 session-scoped 掛鉤，不擁有實體生命週期。Zustand store 只保留版面配置、當前 view、普通真實 Session 的 composer 文字和其他純呈現狀態；Session/Workspace Intent、materialize phase、錯誤和保留的提示詞位於 React-free 執行時期對象層。

Sidebar 與 conversation empty hero 透過 slot 獲得標準化動作：`startSession`、`updateSessionPrompt`、`sendSession`、`open` 與 `toggleSidebar`。Workspace picker 複用同一組件與 `createWorkspace` 動作；owner 只提供 popover 開關、錨點和選中回呼。呈現層不直接傳送 `host/workspace-changed`，Host 事件只由 Host mutation 與流配接器產生。

## Alternatives considered

**為待建立 Workspace 與 Session 保存獨立頁面記錄。** 該方案在 materialize 後需要替換身份並轉交輸入、錯誤、焦點和 sidebar 行；對象自身的 Intent 狀態可以保持身份連續。

**由呈現層或 root Zustand store 編排對象生命週期。** 該方案會重複 Manager 與服務的職責，並把領域狀態帶回 React。標準化動作由執行時期服務提供，slot 只注入呈現所需的窄介面。

**零態立即建立 Host Session 或 Host 持久化 Intent。** 未輸入頁面會進入 Host 生命週期，並改變刷新語義；前端 Session 在首次傳送前只保留 page-local Intent。

**顯式 Create Workspace 延遲到首次傳送。** 使用者確認後 sidebar 仍看不到真實空 Workspace，「建立 Workspace」與「準備 Session」語義混合；只有系統自動產生的零 Workspace Intent 延遲 materialize。

**持續按 cwd 動態派生 Workspace。** 該方案無法表達空 Workspace、穩定顯示名和顯式順序，也會自動收編非 Workspace 呼叫方；cwd 只用於一次歷史 bootstrap 與成員雙向校驗。

**Client 在 Session list 到達後按時間批次重排。** 首屏會先展示 Host 順序再整體跳動，重連也可能改變位置；排序由 Host 持久帳本擁有，Client 只合併單項更新。

**在 SessionHeader 增加 workspaceId。** 它會與 Workspace 索引形成兩個持久歸屬欄位並要求雙寫；header 保留 Session 自身 cwd 事實，Workspace 索引負責顯式歸屬。

## Verification

- 完全無 Workspace 的零態不寫 Host 且允許輸入；顯式 Create Workspace 立即建立並顯示空 Workspace。
- 前端 Session 與 Workspace 在 materialize 前後保持對象身份，輸入、錯誤、焦點和 sidebar 投影始終來自對象層。
- 首發按 Workspace、Session、提示詞順序推進，各成功階段不回滾，輸入在提示詞被接受前不丟失，建立重試使用同一 SessionId。
- Workspace list 只讀取 header 完成一次可重入 bootstrap；已初始化的空登錄檔重新啟動不重複初始化，成員讀取同時校驗索引與 canonical cwd。
- 初始默認目標只在兩份基線 ready 後確定一次；Workspace 組不因 hydration 或 Session 活躍重排，顯式 Workspace 拖拽順序在重連後仍然保持。
- 當前空白 Session 可顯示為唯一的 New Session 行，同時不暴露其他可複用空白工作階段，也不顯示 Session 數量。
- UI 與 Host 會將 canonical path 不同但 basename 相同的目錄接納為獨立 Workspace，而顯式的重新命名操作會拒絕重複顯示名；cwd-only Session、無效歷史 cwd 和未 attach Session 保持 Ungrouped。
- 經確認的 Workspace 刪除只移除註冊記錄，保留當前 Session、目錄、文件和工作階段日誌，並在刷新後保持該狀態；包級測試固定一元回應／幀／基線競態和失敗回滾行為。
- keyless runnable 快照覆蓋零態、顯式建立和首次傳送；包級測試覆蓋 bootstrap、成員校驗、排序、冪等、失敗復原及任意 frame 順序。

## Consequences

- SessionHeader 不記錄最後活躍時間，歷史 bootstrap 只能按 `createdAt` 初始化 Host 手動順序；瀏覽器選填的最近更新檢視表在 hydration 後從 Session 摘要開始建立。
- 歷史 cwd 缺失、目錄無效或 realpath 失敗的 Session 留在 Ungrouped；本期沒有手動收編入口。
- 頁面刷新會丟棄未 materialize 的 Workspace/Session Intent 和尚未被 Host 接受的輸入，這是 page-local 約定。
- 顯式 Create Workspace 立即落盤，使用者不傳送就離開也會留下空 Workspace。
- Host Session 在首個事件前仍遵循現有懶持久化語義；前端 Intent 不改變 Host 重新啟動後的空 Session 行為。
