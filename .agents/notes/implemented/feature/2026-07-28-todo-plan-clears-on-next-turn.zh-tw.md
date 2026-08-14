# Agent Note: 下一輪次開始時清空 todo 計畫條

Status: implemented

[English](2026-07-28-todo-plan-clears-on-next-turn.md) | [简体中文](2026-07-28-todo-plan-clears-on-next-turn.zh.md) | 繁體中文

## 問題

`todo_write` 在工作階段日誌中儲存完整清單快照，互動式宿主把最新清單渲染為計畫條（web TodoPanel 經 `todos` 投影，TUI Plan 面板）。一個輪次結束後，該條仍留在下一使用者輪次的螢幕上——上一任務已完成或已放棄的清單。讀者把計畫條理解為「本輪次正在做什麼」，因此跨輪次的過時清單是錯誤的產品生命週期。[web todo 展示](2026-07-23-web-todo-display.md)與 [`todo_write` 工具](2026-06-29-todo-write-tool.md) Agent Note 仍擁有事件溯源與兩個渲染面；它們把常駐計畫描述為持續整段工作階段直至下一次寫入。

## 決策

常駐計畫是其後沒有更晚 `turn/start` 的最近一次 `todo/write`。`turn/end` 保留清單可見，以便使用者閱讀回答時仍能看到剛完成的清單；下一次 `turn/start` 將其清空，直至模型再次寫入。

### 宿主投影（web）

`dsh-tool-todo` 的 `todos` 投影單元摺疊該規則：`apply` 從每個 `todo/write` 取完整清單，並在每個 `turn/start` 返回 `null`（`stateVersion` 2）。載體（`dsh-host-apiproxy`）在歷史記錄尾部的 `projections` 塊中提供該值，並以 `session/projection` 幀推送；web dock 經 `useProjection('todos')` 讀取。無金鑰 fixture（測試前置資料）映像檔同一摺疊，供組裝後的快照使用。

### TUI 即時路徑

原 TUI 的 `renderEvent` 分支曾在 `turn/start` 清空本機計畫面板、在 `todo/write` 替換之，其重建路徑在重播前重設面板，使冷復原收斂到同一規則；該包其後已被移除（[移除 TUI 包](../simplification/2026-08-04-remove-tui-package.md)）。

## 考慮過的替代方案

- **在 `turn/end` 清空**——使用者仍在閱讀剛完成的回答時就隱藏清單；此時計畫條的職責是已完成計畫，而非空 dock。
- **僅在全部項為 `completed` 時清空**——會讓放棄或部分完成的計畫跨輪次殘留；計畫條仍會顯示另一任務的工作。
- **在輪次開始時追加空的 `todo/write`**——為 UI 生命週期規則改寫日誌，並捏造模型從未寫出的寫入。

## 後果

宿主投影與 TUI 面板共用同一生命週期規則；重新打開工作階段僅在其後沒有更晚輪次開始時復原計畫。部分取代 [web todo 展示](2026-07-23-web-todo-display.md)與 [`todo_write` 工具](2026-06-29-todo-write-tool.md)中「工作階段級常駐計畫」的表述：事件溯源、last-write-wins 替換與兩個渲染面仍歸那些 Agent Note；本 Agent Note 擁有輪次邊界清空。覆蓋：tool-todo 投影對 turn/start 清空與 turn/end 保留的規格測試、供組裝 web 快照的 fixture 推送幀清空，以及啟動下一輪次並固定計畫條已消失這一結果的 TUI 快照。
