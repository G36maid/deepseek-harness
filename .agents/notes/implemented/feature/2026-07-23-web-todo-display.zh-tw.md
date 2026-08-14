# Agent Note: Web todo 展示——快照副作用通道 + 兩個渲染面

Status: implemented

[English](2026-07-23-web-todo-display.md) | [简体中文](2026-07-23-web-todo-display.zh.md) | 繁體中文

## 問題

`todo_write` 把 `todo/write` 的整份清單快照追加進工作階段日誌；TUI 渲染一塊常駐的 plan 面板（自動化專用的 ACP（Agent Client Protocol）橋接刻意不做 todo 呈現）。Web 用戶端把這個事件整個丟棄了：host mux 流本已轉發每一個工作階段事件，但 `todo/write` 不是 surface 類型（它從不 fold 進 `ConversationSnapshot.nodes`），也沒有任何副作用分支累積它——瀏覽器既無消費點，也無展示面。

## 決策

把 `todo/write` 當作工作階段副作用消費，而非 surface 節點，並在兩個面上渲染它，這兩個面正對應 TUI 已經繪製的那套劃分。

### 副作用通道，與視窗重播收斂

`applyEventSideEffects` 新增一個 `todo/write` 分支（整份清單，後寫覆蓋先寫），並在 `turn/start` 清空（[按輪次界定的計畫生命週期](2026-07-28-todo-plan-clears-on-next-turn.md)）。`rebuildDerivedFromWindow` 從空計畫掃過視窗，僅當視窗從未判定計畫（無 `todo/write` 且無 `turn/start`）時復原尾頁種子；否則以視窗內寫入／`turn/start` 摺疊為準。`installWindow` 的每個呼叫方都是尾頁請求（`doOpen`、其補洞重拉、`repairGap`；`loadOlder` 只往前拼接、不再播種），而 host 對尾頁請求要麼帶上投影、要麼在沒有當前有效的計畫時省略——因此欄位缺失就是權威的空清單，直接照此賦值。這個區分在回滾場景上要緊：若 host 在持久化即時寫入前崩潰，log 裡就是空的，此時保留舊值會讓已回滾的計畫永遠留在螢幕上。`ConversationSnapshot.todos` 是讀取面。這遵循事件自身的約定（「僅存在於日誌中的 UI 狀態；絕不納入派生歷史」）：把每次寫入作為對話節點呈現，會讓已被取代的清單看起來仍然有效。

### TodoPanel：持久化清單作為一條常駐橫條

面板經 `conversation.input.dock` slot 掛載（普通註冊者外掛程式 `todoDockEntry` 使用 `ctx.slots.inject`，不相依性 `ConversationController`，`order: 0` 排在佇列條上方），空清單時隱藏，可摺疊為標題加以 `·` 連線的各狀態計數的表頭（本機化，形如 `1 已完成 · 2 进行中 · 1 待处理`，計數為零的段落省略；摺疊態不再附帶進行中條目正文）。狀態圖示為 figma todo 套件（綠色勾選環／藍色漸隱環／虛線未開始環），卡片使用 tip 表面（`--dsw-specific-tip`、14px 圓角、`width: calc(100% - 88px)`／`max-width: 776px` 置中；InputBar 頂部 6px 內邊距是到輸入卡的間距）。它經 dock entry 收到的標準件 `useProjection` hook 讀取 host 計算的 `todos` 投影——無 store、無 service、無 ctx。內部元件保持 props 完備且框架無關；dock 適配件只是一行包裝。

### TodoRow：經 keyed toolview slot 的逐呼叫行

專用的 `todo_write` 對話行是一個普通註冊者外掛程式（`todoToolview`，由 `apply` 掛載），經 `ctx.slots.inject` 註冊進 keyed 的 `tool.call.toolview` slot，遵循與 bash 樣例相同的聲明生命週期，但屬產品級註冊。摘要由呼叫 args 推導（`N/M done · first active item`，其餘活躍項的 `+<n>` 計數放在 `ToolRow` 的不收縮 `summarySuffix` 位裡）；無法解析的 args 回退到通用行摘要；點擊會以原始 args 打開 details 列。todo 不新增任何 `ToolEventView`——呈現歸用戶端所有，常駐清單從工作階段事件渲染，而非工具卡。

## 考慮過的替代方案

- **把 todo 寫入作為 surface 條目摺疊進 `nodes`**——重播的視窗會渲染每一份已被取代的清單；該事件被刻意設計成非 surface 類型。
- **面板硬編碼進 `ConversationRoot`**——input-dock slot 出現之前的原始落點；dock 是本架構給「composer 上方常開橫條」安排的位置，硬編碼繞開了 slot 登錄檔的 disposal 與定序。
- **面板放進 details 列**——details slot 單佔用且由選中驅動，生命週期不同於一條常開橫條。
- **host 計算的檢視表（一個 todo `ToolEventView`）**——呈現屬於用戶端；協議已在事件載荷裡攜帶整份快照。

## 後果

重播正確性由一條程式碼路徑掌管：未來對視窗重建的任何改動都會自然保持 todos 一致；fx-alpha 第 71 輪的 fixture（測試前置資料）加上 `packages/client/ui-conversation/tests/todo-panel.client.spec.tsx` 固定整條鏈（行摘要與狀態、dock 面板內容、摺疊往返）。`todos` 是 `ConversationSnapshot` 的必填欄位，所以 spec 裡指令碼化的 fake 必須帶上它。自動化專用的 ACP 橋接刻意不做 todo 呈現；Web 各面渲染同一個事件，只新增一個協議欄位，不新增事件類型。這個由 host 提供的欄位正是冷載入重建的依據：history 尾頁附帶 `todos`——全量 log 上當前有效的計畫（其後沒有更晚 `turn/start` 的最近一次 `todo/write`），獨立於分頁視窗計算（與 view 配對同一種 backscan 姿勢）——因此重開會話時若計畫仍然有效且最後一次寫入落在視窗之前，計畫也照常復原；該值跨往前翻頁保留，之後的任何寫入照常覆蓋，更晚的 `turn/start` 會清空，而尾頁回應不帶投影時復位為空。
