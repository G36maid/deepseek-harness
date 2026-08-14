# Agent Note: Workspace 側邊欄順序與摺疊

Status: implemented

[English](2026-08-11-workspace-sidebar-order-and-folding.md) | [简体中文](2026-08-11-workspace-sidebar-order-and-folding.zh.md) | 繁體中文

## 問題

Session 很多的 Workspace 會佔滿整個側邊欄，把其他 Workspace 擠出可見範圍。緊湊清單需要有界的默認高度，同時仍要提供到達每條 Session 的明確入口。側邊欄還需要面向活動時間的順序，但 `WorkspaceView.sessionIds` 是持久的手動記帳，不能被 Session 活動改寫。

Workspace 分組本身沒有使用者可控的持久順序。瀏覽器原生拖拽還會把清單外鬆手判為拒絕，並把行彈回原位，即使應用仍持有有效插入標記。Workspace 展開後，若只按組頭命中，兩個分組之間的視覺邊界也不再等於任一組頭的中點。

## 決策

### Workspace 順序

Workspace 登錄檔持有持久 `workspaceIds` 順序，並提供採用 DOM `insertBefore` 語義的 `insertBefore(id, beforeId?)`。Host RPC `workspace.insertBefore` 返回完整的已提交順序；單純順序變更透過 `host/workspace-order-changed` 推送同一份完整順序。未知來源或錨點 id 以 `workspace-not-found` 拒絕；以自身為錨點或移動到當前位置不會寫入。

用戶端對 Workspace 拖拽進行樂觀安裝。請求代次與幀代次保證只有最新一元回聲可以替換本機順序，且更新的 Host 幀優先於舊回應；最新請求被拒時會復原最近一份由 Host 基線、幀或當前一元回聲確認的完整順序。每次成功的清單基線都會復原 Host 順序，因此重連會接納其他位置提交的持久變更。

### Session 摺疊與檢視表順序

每個 Workspace 持久化一項瀏覽器本機打開狀態：關閉表示零條 Session 行，打開表示最多五條。存在更多 Session 時，**展開其餘**只在當前掛載期間顯示剩餘項；關閉整個 Workspace 會清除此臨時展開，因此重新打開時復原為五條。只有在使用者尚未為該 Workspace 儲存明確狀態時，當前 Session 所在分組才會自動打開。從 Workspace 行建立 Session 時會在啟動 Session 前打開目標分組，使狀態傳播完成後新行保持可見。就緒的 Workspace 基線發生變化後，瀏覽器會移除基線中不存在 id 的展開狀態、順序和已觀察時間戳記錄，同時保留 Ungrouped 和單清單記帳。

組合檢視表選單在分組和單清單呈現中都提供**手動排序**和**最近更新**，每個記帳各自持有一份瀏覽器本機持久順序。真實 Workspace 從 `WorkspaceView.sessionIds` 初始化；Ungrouped 和跨 Workspace 的單清單從最近更新時間順序初始化，且沒有 Host Session 記帳。進入最近更新時會執行一次完整的時間排序；後續 user prompt 或 steer 會將對應 Session 置頂一次，拖拽仍可編輯所得順序。返回手動排序會保留當前順序，只停用後續活動置頂。真實 Workspace 在手動模式下的拖拽還會寫入 Host Session 記帳，而 Ungrouped 和單清單的拖拽與活動置頂保留在瀏覽器本機。單清單沒有父級層次，因此不顯示空的左側狀態槽；存在可見狀態時仍保留該槽。

### 拖拽與緊湊介面

Workspace 命中測試使用完整渲染分組區段，包括可見 Session 行。前一分組的下半部與後一分組的上半部共享同一條插入邊界，指示器是一條帶有相連右向尖角且不影響版面配置的絕對定位橫線。樹主體覆蓋層會在滾動裁切區外以相同的負偏移繪製第一條邊界，因此左側尖角保持可見，清單位置也不會改變。Workspace 或 Session 拖拽期間，文件級 `dragover` 與 `drop` 處理器會接受原生操作；若在 Workspace 清單外鬆手，`dragend` 會提交最後一個有效標記。

搜尋在摺疊時是區頭操作，展開後佔據標題與尾部操作的空間。查詢經清除首尾空白後為空時，點擊外部會收起搜尋；非空查詢則會保留。緊湊的 Workspace 與 Session 行、24px 底部漸隱以及取消每個 Workspace 的 Session 數量共同節省縱向空間，同時保留導覽入口。

## 考慮過的替代方案

**把每次活動置頂寫入 `Workspace.sessionIds`。** 瀏覽器呈現偏好會在使用者每次提交提示詞時覆蓋共享的 Host 記帳。

**為手動排序和最近更新分別保留獨立順序。** 切換模式會用另一份順序中的舊位置替換可見清單，而選擇手動排序只表示後續活動不再移動條目。

**打開 Workspace 時始終顯示全部 Session。** 大型 Workspace 仍會擠佔其他分組；只記憶整個分組的打開狀態無法限制其高度。

**持久化展開剩餘狀態。** 很久以後重新打開 Workspace 時，它可能意外佔滿側邊欄。只有零條或五條狀態屬於穩定導覽偏好；顯示剩餘項只是一次本機查看。

**使用數字下標或只按組頭命中拖拽。** 拖拽期間行發生變化會使下標漂移；Workspace 展開時，組頭中點與可見邊界不一致。錨點 id 與完整區段幾何在兩種情況下都保持穩定。

**讓瀏覽器拒絕清單外鬆手。** 應用會提交最後一個有效標記，而瀏覽器同時播放拒絕動畫，形成相互矛盾的回饋。

## 後果

- Workspace 順序透過 Host 持久並共享；分組方式、打開狀態、每個記帳的 Session 檢視表順序和查詢狀態仍是瀏覽器本機呈現偏好。Ungrouped 和單清單支持相同的拖拽與置頂規則，但因沒有單一 Workspace 記帳，其順序只保存在瀏覽器本機。
- 最近更新模式會在進入時執行完整時間排序，隨後保持手動調整，直到 user prompt 或 steer 推進某條 Session 並將其置頂。返回手動排序會保留所有當前位置。
- 未執行明確的**展開其餘**手勢時，打開 Workspace 最多顯示五條 Session；關閉分組只重設這項臨時手勢。
- Host Session 記帳繼續採用[工作階段清單瀏覽與 Workspace 手動排序](2026-07-25-session-list-browsing-and-manual-order.md)確立的手動順序含義。

## 測試

領域與 Host 測試覆蓋持久 Workspace 移動、無操作與無效錨點、重新啟動復原、完整順序 RPC 回應、順序幀以及每條 Host stream 基線只讀取一份 Workspace 快照。執行時期測試覆蓋樂觀順序、幀／回應優先級、重疊拒絕後復原 Host 已確認順序、重連基線以及 New Session 目標優先級。UI 測試覆蓋五行摺疊、臨時展開重設、Workspace 移除後清理持久狀態、保持順序的模式切換、一次性最近更新置頂、瀏覽器本機 Ungrouped 與單清單拖拽持久化、無層級單清單行左側間距、當前檢視表標記、展開區段的 Workspace 命中、未裁切的第一條插入邊界、清單外 Workspace 與 Session 鬆手、搜尋收起規則和緊湊 CSS 尺寸。
