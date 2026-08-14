# Agent Note: 未選擇 Workspace 時從編輯器打開現有選擇器

Status: implemented

[English](2026-08-07-workspace-picker-composer-entry.md) | 繁體中文

## 問題

[Session scope 決策](../architecture/2026-07-25-web-client-session-scope-and-provide-channel.md)會在 Workspace 存在前保留同一個常駐編輯器，但 textarea 處於停用狀態，只有較小的 Workspace chip 能打開選擇器。使用者首次點擊最顯眼、也最熟悉的輸入區域時，介面不會回應，儘管同一介面已有繼續操作的入口。

## 決策

新工作階段尚未歸屬任何 Workspace 時，整張輸入卡片都可透過滑鼠點擊啟用現有的 `conversation.hero.workspace` 選擇器——點擊處理器歸卡片所有，其停用控制元件放行指針事件，因此整個膠囊是同一個目標；只讀的常駐 textarea 也可經 Enter 或 Space 啟用。`aria-haspopup="menu"` 和 `aria-expanded` 在共享選擇器選單掛載時描述其展開狀態。全新安裝沒有 Workspace 行時，選擇器會立即轉交目錄對話框並清除自身的展開狀態；該對話框使用自己的可訪問性語義。虛線 l4 描邊（SVG dash ring，因為原生 `dashed` 的間距不可調）配合 hover 時的 business 藍，把卡片標記為選擇入口。卡片會攔下 `pointerdown`，使已打開選擇器的外點關閉無法與點擊的重新打開競態——先關後開會讓 chip 的展開回顯閃動。訊息提交、命令、權限、模型及其他 Session 作用域控制元件會保持鎖定，直到使用者選擇 Workspace 並建立或重新連線真實 Session。

Workspace 選擇繼續使用現有 owner 和流程。`ConversationRoot` 打開選擇器，`WorkspacePicker` 列出或建立 Workspace；Session 到達後，同一個 textarea DOM 節點變為可編輯狀態。

## 考慮過的替代方案

**保持 textarea 停用並突出 Workspace chip。** 這樣能保留原有控制元件邊界，但首次操作時最主要的編輯器區域仍然沒有回應。

**在 textarea 上方放置透明按鈕。** 按鈕具備直接的觸發器語義，但它會在常駐 textarea 上方增加第二個可聚焦元素，並使保留焦點、輸入法和草稿行為的 DOM identity 過渡更複雜。

**在選擇 Workspace 前接收草稿。** 這需要由 client 擁有的草稿 Session 或另一條 Session 前狀態軸。此功能只需要提供一個更容易發現的現有選擇器入口。

## 後果

使用者首次點擊編輯器即可繼續必要的設定流程，鍵盤使用者也能啟用同一路徑。textarea 會如實報告只讀狀態，直到 Session 存在；相鄰控制元件仍處於停用狀態。介面沒有引入新的 Workspace 狀態、傳輸或目錄選擇流程。

元件測試會固定滑鼠和鍵盤啟用、覆蓋整卡的點擊目標、被攔下的 `pointerdown`、相鄰控制元件鎖定、選擇器展開，以及同一節點變為可編輯 textarea 的過渡。組裝後的 Web helper 會透過 textarea 開始全新 Workspace 設定，因此重放瀏覽器場景會覆蓋實際交付路徑。
