# Agent Note: Goal 命令輸入投影

Status: implemented

[English](2026-08-01-goal-command-input-projection.md) | 繁體中文

## 問題

面向使用者的命令在模型輪次之外執行，並持久化為 `command/run` 與 `command/done`。Web transcript（文字記錄）此前只渲染結果行。因此，在新工作階段中，`/goal` 會清空編輯器並成功完成，但頁面仍停留在空白 Hero；只有後續對話內容啟用 Chat 後，結果才會顯示。若處理器追加普通 `user/message`，將改變模型可見歷史與命令語義。

## 決策

命令登錄檔與持久命令生命週期保持不變。`command/run` 記錄由解析器提供的名稱、選填的原樣參數、來源和呼叫 id；`command/done` 記錄結帳。兩條事件都不攜帶瀏覽器呈現意圖。

`ui-goal` 用戶端外掛程式會在通用命令 Definition 之外註冊一個歸 Goal 所有的 Conversation Definition。兩者都匹配同一條 `/goal` `command/run`：通用 Definition 保留持久結果行，Goal Definition 則在更早的分數錨點建置獨立的 `command-input` Chat Node。Goal 外掛程式還為該 Node 註冊 keyed React renderer。它的本機元件只複用使用者氣泡的靠右對齊幾何形態和語義 token，使用 14px/22px 等寬字體文字，並且不掛載時間戳、複製或分支操作。

`Session.composerPhase` 把可見的非命令 Chat Node 視為對話內容，因此 `command-input` 會啟用當前對話，而僅有通用命令列時不會。Host 的 `summary.blank` 位仍以輪次為基礎，因此清單隱藏和空白工作階段複用保持不變。

Goal Definition 根據結構化 run 派生 `/<name><args.trimEnd()>`：分隔符與內部多行輸入保持不變；在已認領的裸命令形式中，參數只有一個空格時顯示 `/goal`。僅包含 `command/done` 的歷史視窗沒有匹配的 Goal Context，因此會保留通用結果行，而不會虛構輸入氣泡；載入包含更早 run 的頁面後，兩個 Node 都會復原。

模型邊界保持不變。Goal 投影不會建立 `user/message`、`turn/start`、`step/start` 或 `request/header`。已接受的 goal 變更只會透過 goal 領域現有的 `<goal_state>` 快照或 clear tombstone 到達模型，與 `command-input` Node 無關。

## 驗證

Goal 用戶端測試固定雙 Definition 輸出、順序、排除其他命令、裸命令與多行文字、僅含 done 的切分視窗、renderer 語義、資源釋放和新工作階段 phase 選擇。無金鑰的完整組裝 Web 場景在不含模型配接器的新工作階段中提交裸 `/goal`，驗證兩行都顯示且不存在面向模型的事件，然後重新載入並驗證持久化後的 transcript。

## 備選方案

**在 `/goal` 處理器中追加 `user/message`。**不予採納，因為該命令會變成模型輸入，並可能觸發或改變後續請求。

**向命令登錄檔與持久事件新增呈現意圖。**不予採納，因為一個 Goal 檢視表會擴大通用命令介面，並要求 Session、Chat 和每個命令 fixture（測試前置資料）都攜帶瀏覽器呈現狀態。現有 `command/run` 的名稱和參數已足以讓組合後的 Goal 用戶端重建自有檢視表。

**讓通用命令 renderer 識別 `/goal`。**不予採納，因為命令專用檢視表的建置歸 Goal 用戶端外掛程式所有。在組閤中移除該外掛程式後，氣泡必須隨之消失，且命令執行和通用結果行不能改變。

**把每條命令輸入都渲染為使用者氣泡。**不予採納，因為現有控制命令會有意讓新工作階段停留在 Hero；這樣修改會在沒有功能自有 Conversation Definition 的情況下擴大互動語義。

## 後果

一條持久 `/goal` run 會向兩個各自獨立歸屬的檢視表 Context 提供資料，而不改變命令能力。在組閤中移除 `ui-goal` 後，普通命令執行及其結果行保持不變。即時分頁標籤與冷重載會得到一致結果，因為兩個檢視表都派生自同一條 run。頁面切分只保留 `command/done` 時，會暫時只顯示結果行；如果該命令是工作階段中的唯一內容，Hero 會隱藏該行，直到載入更早頁面復原 run。由於 Host 的 blank 語義仍以輪次為基礎，工作階段在模型輪次開始前仍從清單中隱藏，並且可以複用。
