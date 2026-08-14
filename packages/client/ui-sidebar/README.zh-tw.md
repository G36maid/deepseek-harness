# @deepseek-ai/dsh-client-ui-sidebar

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

側邊欄外殼外掛程式：負責字標、New Session 操作、版面配置持有的摺疊控制元件、可感知滾動的區域 seat，以及固定在底部的 Settings seat。[ui-workspace](../ui-workspace/README.md) 持有渲染到 `sidebar.workspaces` 的 Workspace 與 Session 瀏覽器；本包既不派生其中的行，也不持有其檢視表偏好。摺疊到版面配置擁有的 56px 軌道仍屬於本機呈現行為。約定：[slot 系統標準](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md)。

New Session 會啟動執行時期的頁面區域性前端 Session Intent。執行時期優先使用作用域操作明確指定的 Workspace，否則使用當前 Session 所屬 Workspace，再否則使用最近活躍 Workspace；一個 Workspace 都沒有時則清空選擇，進入空白 New Session 頁面。Workspace 專屬控制元件與共享選擇器由 ui-workspace 持有。

`SidebarRootComponentProps` 組合版面配置 owner share、全域性 `useSessions` 和 `useWorkspaces` 掛鉤、已聲明的 `sidebar.workspaces` 與 `sidebar.settings` 子 slot，以及注入的 `startSession` 與側邊欄切換回調。這裡沒有外掛程式 store。

即時收起時，外殼會把展開內容固定在當前寬度，並用 150ms 將其淡出。隨後，上方四個控制元件——外殼的側欄切換與新建工作階段，以及透過 `sidebar.workspaces` 渲染的新增和搜尋——共用一次 150ms 的淡入和 49px 左移，在版面配置的 300ms 欄滑動結束時一起進入 56px 軌道；每個 36px 控制元件盒都會沿同一條路徑到達軌道左側 10px 的內邊距。固定在底部的 `sidebar.settings` 控制元件只共用淡入時序，不發生橫向位移。頁面初始即為收起狀態時會靜態渲染軌道；減少動態效果模式會停用兩段過渡。

欄內的捲軸是一種指針可供性：只要指針不在欄內，外殼就把 ui-theme 的[捲軸間接層](../ui-theme/README.md)重新綁定為 `transparent`；指針離開後滑桿再保留 2 秒，因此沒人指向的清單不會帶著捲軸。避免行位移的空間預留屬於滾動區域本身（[ui-workspace](../ui-workspace/README.md)），所以顯示滑桿不會引起重排。

頁腳承載 `sidebar.settings`：側邊欄只渲染固定在底部的版面配置 slot，並共享其欄狀態（`wide`）；ui-settings 在此註冊觸發行和設定面板。

`/client` 匯出表層只包含外掛程式主體（`apply`／`inject`）及約定類型；SidebarRoot、行元件和樹派生仍由 slot 註冊封裝在包內。

## 模型體驗

無。側邊欄渲染瀏覽器工作階段清單；這裡沒有任何內容進入模型請求。

#### KV Cache 影響

無；該包（package）既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **Session 狀態點渲染由 [ui-workspace](../ui-workspace/README.md) 持有**：沒有可用的 done/error 通知資料源。
- **Workspace 瀏覽行為由組合持有**：分組、排序、搜尋與行狀態都屬於 [ui-workspace](../ui-workspace/README.md)，不屬於此外殼。
- **「New task completed」未讀標記是本機查看狀態**：完成時間 > 上次查看時間這一事實永遠不會到達宿主。
