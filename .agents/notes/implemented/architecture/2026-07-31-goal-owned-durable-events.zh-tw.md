# Agent Note: Goal 自有的持久事件

Status: implemented

[English](2026-07-31-goal-owned-durable-events.md) | [简体中文](2026-07-31-goal-owned-durable-events.zh.md) | 繁體中文

## 問題

Goal 狀態與 inbox 狀態具有不同的生命週期。無論相關模型上下文是否獲準進入步驟，goal 變更都必須在重新啟動與 fork 後保留；inbox 訊息則可能在步驟調度期間被編輯、領取、拒絕或丟棄。把 goal 變更編碼到 Round 為 0 的 inbox 訊息中，會讓佇列放置成為領域提交點，並迫使重播對帳插入、准入、訊息標識、來源元資料與渲染內容。

Goal 領域需要持久狀態，但不需要擁有待處理的模型輸入。繼續執行調度仍然需要 inbox；goal 持久化不需要。

## 決策

`@deepseek-ai/dsh-goal` 擁有持久的 `goal/change` 工作階段事件。每個事件攜帶變更後的完整 goal 快照，或帶修訂號的清除墓碑。`GoalService` 同步追加該事件，再發出 `goal/changed`；嚴格重播與 `goal` 工作階段投影只摺疊 `goal/change` 來獲得生命週期狀態。

`GoalMessageSource` 只標識已准入且為正數的繼續執行 Round。匹配的 `user/message` 會推進 `roundsStarted`；普通使用者訊息與 inbox splice 事件不會改變 goal 狀態。Goal 包不會插入、領取、移除或檢查 inbox 訊息。`@deepseek-ai/dsh-goal-round-driver` 仍透過公開 inbox 生命週期負責排隊和跟蹤自己的繼續執行提示詞。

啟用態仍只存在於行程中。服務在快取觀察事件時，將同步追加的事件序號與所請求的啟用狀態關聯；重播或外部追加的變更默認處於 disarmed 狀態。工作階段日誌仍是唯一的持久權威。

該領域不會自動把每次變更投影為模型輸入。Goal 工具返回當前狀態；真正調度工作時，繼續執行提示詞包含目標描述與 Round 狀態。未來如果需要始終可見的 goal 上下文，應由獨立上下文外掛程式擁有其 inbox 訊息，而不是把它作為持久化副作用。

## 考慮過的替代方案

- **繼續以 Round 為 0 的 goal 訊息作為持久記錄。** 不予採納，因為這會把領域提交與佇列變更綁定，並要求 goal 摺疊理解領取和准入對帳，儘管佇列結果不能回滾領域狀態。
- **只從模型可見訊息派生 goal 狀態。** 不予採納，因為變更可以在不打開步驟的情況下有效且持久，取消或策略拒絕也不能擦除它。
- **把 goal 存入獨立資料庫。** 不予採納，因為有序工作階段日誌已經提供持久化、重播與 fork 繼承，無需引入第二個原子性邊界。

## 後果

Goal 狀態不相依性 inbox 放置與准入。重播只有一條變更路徑，投影直接由 `goal/change` 推進，繼續執行訊息只攜帶 Round 歸屬。模型不會收到僅用於變更的 `<goal_state>` 訊息；模型可見狀態來自 goal 工具與已調度的繼續執行提示詞。直接寫入工作階段的寫入方仍受信任，並且可以追加畸形變更；嚴格摺疊與 invariant 配套模組會拒絕這些變更。

聚焦的 goal、goal-round-driver、command、TUI 與 client fixture（測試前置資料）測試固定持久重播、正數 Round 計數、inbox 獨立性、投影更新和復原工作階段行為。無金鑰行程測試檢查持久的 `goal/change` 事件，並驗證僅建立 goal 不會啟動繼續執行 Round。
