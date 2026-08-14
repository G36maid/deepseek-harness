# Agent Note: Session 清單瀏覽與 Workspace 手動排序

Status: implemented

[English](2026-07-25-session-list-browsing-and-manual-order.md) | [简体中文](2026-07-25-session-list-browsing-and-manual-order.zh.md) | 繁體中文

## 問題

[Workspace UI 完整產品流](2026-07-25-workspace-ui-product-flow.md)交付了分組 session 清單的首個形態，並把 Rename、拖拽排序等操作明確劃出當期範圍。設計稿（figma 239-10458 及關聯畫面）隨後補齊了這些互動：清單要能切換成不分組的平鋪檢視表、session 行懸停要出詳情卡與操作選單、workspace 要能改名、組內 session 要能手動排序。

兩條既有機制擋在前面。其一，host 在每條 `session/event` 上把活躍 session 持久化地提到 workspace 帳本最前（活動置頂），任何手動排序都會被下一次活動打亂——兩種排序權威不可調和。其二，瀏覽區域被劈在兩個包裡：ui-sidebar 擁有清單、搜尋和組頭行，而 ui-workspace 只借一個 picker slot 放彈層；每加一個 workspace 域的對話框都要跨包接線，歸屬越來越擰。

## 決策

### 平鋪行與瀏覽態

group-by 選單提供 WorkSpace / In one list 兩種模式。WorkSpace 模式按 `WorkspaceView.sessionIds` 的手動序在各組內展示同級 session 行；In one list 把所有 session 合併後嚴格按 `updatedAt` 新→舊排序。兩種模式都不把 `parentId` 投影成清單層級，fork 譜系只保留為 session 資料；完整 fork 行為由 [Web session fork 操作](2026-07-27-web-session-fork-actions.md)定義。模式選擇持久化在瀏覽器（`dsh.workspace.view`），刷新後仍保持。[Workspace 側邊欄順序與摺疊](2026-08-11-workspace-sidebar-order-and-folding.md)隨後加入瀏覽器本機的最近更新檢視表，而未改變 Host 記帳的手動順序權威。

### 行互動

- session 行懸停 500ms 出詳情卡（完整標題、相對時間、狀態行；在 wire 增加 status 欄位前，狀態行只有 running/idle 兩態）。卡片與行選單互斥：選單開啟或拖拽進行中不出卡。
- session 行 … 選單：Rename / Fork session / Delete session，其中 Rename 與 Fork 已接線，Delete 仍為純視覺；workspace 組頭 … 選單的 Rename / Delete workspace 均已接線。選單滑鼠移出即關。
- 支撐件：`Menu` 新增 label 條目、danger 行、`closeOnPointerLeave`；新增 `HoverCard`（portal 定位、開啟延時、disabled 守衛）。

### workspace.rename

`workspace.rename({ workspaceId, title })`：title trim 後非空；同名 no-op 與重名查重都在 Host 的 Workspace 操作序列鏈內求值（與按路徑收編和刪除共鏈，並行的 Workspace 操作不能穿插出重名或亂序假成功），衝突返回 `workspace-name-conflict`。按路徑收編可以派生出已有 title，因為擁有身份的是 canonical path，而不是 title（見[身份決策](../bug-fix/2026-07-31-same-basename-workspace-adoption.md)）。落盤經 `setTitle` 的 mutate 通道，`domain/changed` 監聽自動廣播 `host/workspace-changed` 幀。UI 為標準 Modal，client 側另做重名預檢。

### 手動排序：insertSessionBefore 取代活動置頂

`session/event` → `touchSession` 活動置頂鏈整體刪除；workspace 帳本順序現完全由手動排序決定——新 session attach 時前插，顯式重排走 `workspace.insertSessionBefore({ workspaceId, sessionId, beforeSessionId? })`（DOM insertBefore 語義：給定錨點時插在錨點前，省略則追加到末尾）。實體只對不在帳的 session/錨拋類型化的 `WorkspaceMoveInvalidError`，handler 僅把它對映為業務碼 `workspace-move-invalid`，儲存故障保持 internal。

UI 為組內 session 行的 HTML5 拖拽（僅 workspace 分組、非搜尋態；fork 子工作階段及其源工作階段各自獨立排序）。順序權威完全在 host：drop 只發 RPC，client 零本機重排，檢視表靠回應體 upsert 與 changed 幀刷新；失敗即無事發生。client 的 upsert 拒絕比已裝載投影更舊（`updatedAt`）的快照，防遲到的一元回應回滾較新的幀。

### 殼/區域切分

ui-sidebar 縮為列幾何殼：品牌行、摺疊狀態機、New Session、Settings，以及一個 `sidebar.workspaces` 洞；殼與區域的約定只有兩個事實 `{ wide, expandSidebar }`。ui-workspace 全權擁有瀏覽區域（section header、搜尋、分組樹與平鋪、全部 workspace 對話框、拖拽）及其 groupBy store；rail 態的搜尋、新增工作區圖示也歸區域，經 `expandSidebar()` 請求殼展開。picker 拆為核心件 `WorkspacePickFlow`（區域內直接元件組合；在[單一路徑 Note](../simplification/2026-07-31-one-route-to-add-a-workspace.md)之前名為 `WorkspaceCreateFlow`）與薄包裝層 `WorkspacePicker`（繼續填 ui-conversation 的 hero slot）；原 `sidebar.workspace` picker slot 與聲明感知延遲註冊隨之刪除。

## 考慮過的替代方案

**保留活動置頂、拖拽僅作臨時調整**——手動序在下一次 session 活動即被打亂，形同虛設；兩種排序權威並存無法向使用者解釋。也考慮過「拖過一次即凍結該 workspace 的活動置頂」的折中，狀態多一檔、語義更難講，直接刪除更乾淨。

**排序報文用數字下標**——`{ index }` 在拖拽視窗期會漂移：host 前插新 session（如 Intent 材料化）後同一下標指向別的行。錨點式 insertBefore 對前插與過濾投影天然免疫。

**drop 後樂觀重排**——client 先行重排需失敗回滾，對象層多一塊糾纏態；本機、局域網往返毫秒級，等 host 回應的簡單方案肉眼無感。順序權威單一化（完全信 host）後，前端永不發明順序。

**rename 對話框留在 ui-sidebar（最小改動）**——正是問題本身：workspace 域的對話框散落在借來的坑裡，每加一個（Delete 確認框將至）都重演跨包接線。只挪 rename Modal 會在下一個對話框上重演這份接線；整個瀏覽區域歸 ui-workspace，殼只留幾何。

**WorkSpace 模式按 fork 譜系巢狀 session**——巢狀會讓當前子工作階段相依性祖先展開態才能可見，也讓組內手動序只能移動根節點；`parentId` 是 lineage 資料，不是清單導覽結構。所有 session 拍平成同級行後，每行都可獨立打開、搜尋與排序；In one list 仍因沒有 workspace 持久化載體而停用拖拽。

## 後果

- 手動序是 Host workspace 帳本的唯一順序權威：活動絕不改動 `WorkspaceView.sessionIds`。後續加入的瀏覽器本機最近更新檢視表可以把活躍行提到最前，但不會改變該帳本；其獨立語義見 [Workspace 側邊欄順序與摺疊](2026-08-11-workspace-sidebar-order-and-folding.md)。
- 殼/區域兩事實約定把 workspace 域的後續功能（Delete 確認、跨組移動、Ungrouped 收編）全部收進 ui-workspace 單包；ui-sidebar 不再隨 session 清單功能演進。
- 平鋪模式不支持重排，也沒有在指定 workspace 中建立 session 的入口（需切回分組檢視表），是拍板接受的範圍收窄。
- session Delete 的功能接線與擴充 wire 狀態枚舉，留待後續迭代。

## 測試

包級用例覆蓋派生（deriveGroups/deriveFlat）、同級 session 行、兩處 apply 註冊與透傳、host 實體移位語義、rename/insertSessionBefore 的 RPC 實作與 fixture（測試前置資料）樁；`apps/web` keyless 快照回歸覆蓋裝配後的應用，並釘住 fork 後沒有 session 展開控制元件。
