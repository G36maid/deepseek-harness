# Agent Note: 空輸入時 Cmd/Ctrl+Enter 將 Web 排隊訊息全部插話

Status: implemented

[English](2026-08-06-web-queue-steer-all-gesture.md) | [简体中文](2026-08-06-web-queue-steer-all-gesture.zh.md) | 繁體中文

## 問題

主工作階段執行時期，使用者用普通 Enter（或在 busy-Enter 偏好為 Queue 時）輸入的訊息會在 Web 佇列裡累積。把它們灌進當前輪次需要逐條點擊「插話傳送」按鈕；而輸入框草稿為空時沒有任何鍵盤手勢——輸入機對空草稿直接拒絕，Enter 與 Cmd/Ctrl+Enter 都是空操作。排隊訊息一多，逐條插話是明顯的多點摩擦，空草稿 + 加速 Enter 正是「全部插話」的自然位置。

## 決策

空草稿的 Cmd/Ctrl+Enter 現在會把仍在排隊（`placement: 'queued'`）的 Inbox 行按 FIFO 順序全部插話進執行中的輪次，僅限報告 running 的主工作階段。手勢在 `InputBar.onKeyDown` 解碼：加速 Enter + 去空白後為空草稿 + `running` + 無 subagent 地址 + 至少一條 `queued` 行時，改走新的 `ComposerKeyboard.steerQueue()` 動詞而不是 `submit()`。`SessionInputShell.steerQueue()` 委託給 hub 編排的流程：重新讀取權威的 `session/queue` 快照，過濾 `placement: 'queued'`（pending steering 行已經在本輪內），並逐條順序執行 Queue 面板的嚴格 steer 操作 `session.updateQueue(itemId, { kind: 'steer' })`，從而在 host 側保證 FIFO 順序。`steer-unavailable`（flush 中途輪次關閉）或 `queue-item-not-found`（行已被佔用）靜默收斂；其他失敗彈出一條 composer 通知（「插話傳送失敗，請重試。」）。無 wire、磁碟或 agent-loop 改動：嚴格 steer 邊界本來就在 host 側。

該手勢嚴格限定為加速組合鍵。空草稿 + 普通 Enter 仍然無操作（即使 busy-Enter 偏好為 Steer）；草稿內容優先於佇列（加速 Enter 只插話當前草稿）；idle 或 subagent 工作階段保持原有空草稿無操作，因為沒有可插入的執行中輪次。

同一套計算得出的可用性門控也負責提示該手勢：當草稿為空、輸入框未鎖定且不處於瞬態機器鎖（adjudicating/submitting）、命令選單未打開、普通主工作階段正在執行且至少一行仍為 `queued` 時，文字方塊 placeholder 會提示 Cmd/Ctrl+Enter 將全部排隊訊息插話傳送。owner 提供的 placeholder 仍然優先；可用時 steer 提示會刻意優先於 plan 模式 placeholder（該視窗內手勢確實可用）。

## 後果

一個鍵盤手勢替代 N 次點擊，同時保持單一嚴格 steer 路徑與單一收斂權威。逐條按鈕與手勢是同一個 host 操作，競態與失敗語義完全一致。手勢及其 placeholder 共用一個呈現層門控；hub 在執行時會重新讀取快照，因此用戶端門控仍只是建議性的，host 仍是權威。

## 相關決策

逐條「插話傳送」動作及其嚴格 steer 邊界由 [將一條 Web 排隊訊息插話到活動輪次](../feature/2026-07-30-web-queue-steer-action.md) 記錄；本筆記只在其之上增加整佇列鍵盤手勢。

## 曾考慮的替代方案

- **在輸入機內攔截。** 已拒絕：輸入機按設計不感知佇列（佇列投影由 wiring 層疊加），且無法區分加速 Enter 與必須保持空操作的普通 Enter。
- **逐條用 `session.prompt(mode: 'steer')` 插話。** 已拒絕：那會鑄造新訊息而不是轉移 pending 行，破壞 dock 的不可變訊息契約；`updateQueue({ kind: 'steer' })` 已經原子地轉移了確切的那條。
- **並行觸發所有行。** 已拒絕：host 到達順序無法保證，而插話順序對模型可見；順序 await 保證 FIFO。
- **為 steer-all 新增 host RPC。** 已拒絕：現有逐條操作已足夠冪等——每行一次嚴格 steer，中途關閉靜默收斂——協議改動沒有收益。
- **傳送按鈕 tooltip。** 已拒絕：普通工作階段執行時期，主按鈕是 Stop，這也是整佇列手勢唯一可用的視窗。空草稿時的 placeholder 恰好在該視窗顯示，可以直接說明這項鍵盤操作。
