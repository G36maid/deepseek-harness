# @deepseek-ai/dsh-goal-round-driver

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

[`ctx.goals`](../goal/README.md) 的同工作階段續行驅動器。它透過公開 `Agent` 與工作階段服務，把 phase 為 active 且已啟用續行的目標轉換為連續的 [Goal Round](../../../docs/glossary.md#goal-round)；[同工作階段驅動器 Agent Note](../../../.agents/notes/implemented/feature/2026-07-19-same-session-goal-round-driver.md) 記載競態與生命週期方面的設計理由。

## 組合

```yaml
- id: goal
  name: '@deepseek-ai/dsh-goal'

- id: tool-goal
  name: '@deepseek-ai/dsh-tool-goal'

- id: goal-round-driver
  name: '@deepseek-ai/dsh-goal-round-driver'
```

該外掛程式沒有可調設定。`maxGoalRounds` 屬於目標定義，面向模型的阻塞閾值則屬於 [`dsh-tool-goal`](../tool-goal/README.md)；在驅動器中重複任一數值都可能產生分歧策略。

## Round 約定

當對應的活躍 agent（代理）實例處於 idle 狀態，且目標 phase 為 active、已啟用續行並有剩餘容量時，驅動器先為待處理 goal 變更建立檢查點，再預留 `roundsStarted + 1`，對應當前 `{ goalId, revision }`。它會排入一條 `<goal_round>` 提示詞，並攜帶 `GoalMessageSource`。`agent/pre-step` 監聽器會在下游監聽器前後驗證完整的已領取記錄與當前 goal；只有進入步驟的 `user/message` 才會增加 `roundsStarted`。因過時而被拒絕的預留不會消耗 Round 編號。

`MessageId` 透過持久 inbox 插入和領取來標識預留訊息；它不標識輪次結果。人類訊息不消耗 goal 上限。如果人類工作在預留前進入 inbox，或加入預留的待處理批次，自動工作會讓行，直到 agent 進入 idle；混合批次中的待處理自動提示詞會被拒絕，只有在該檢查點之後才重新預留。

保留的提示詞會點明經過 JSON 引用的目標與 `round/maxGoalRounds`，將當前工作區、工具結果和持久工作階段狀態視為權威資訊，要求在完成前提供證據，並要求在工作仍未完成時保持目標 active。引用可將多行或形似標籤的目標文字保留為資料。goal 生命週期變更仍必須透過 `dsh-tool-goal` 的獨立權限檢查。

## Idle 檢查點

整個 agent 進入 idle 時，持久 goal phase 和 revision 具有權威性。phase 為 active、已啟用續行且仍有容量的 goal 會預留下一 Round；完成、暫停、阻塞和編輯都會阻止續行。驅動器不會透過關聯 goal 訊息與 `turn/end` 來對前一段活動分類，因此提供方錯誤和 token 上限不屬於提示詞級 goal 結果。

## 生命週期與持久性

`goal/changed` 會產生持久性義務。排隊工作前，驅動器會等待 `ctx.sessions.flush()`，並在等待後重新檢查 goal revision 與競爭輸入。透過 `agent/error` 到達的 flush 失敗會停用續行，避免另一 Round 啟動。

此外掛程式載入到現有 agent 上時絕不會繼承續行啟用狀態。`GoalService.disarm()` 會移除行程本機權限，而不改變持久 phase、revision 或歷史；之後由使用者明確授權的 resume 會記錄重新啟用續行。工作階段 resume 和 fork 後，goal 領域透過 `agent/session-start` 處理應用相同規則。

取消會移除 inbox 中待處理的工作，或留下 agent 範圍的 aborted 狀態。在下一次 idle 檢查點，驅動器會暫停存在已預留或已准入嘗試的 goal，避免取消後自動重新啟動；與 goal 嘗試無關的取消只會撤銷行程本機續行權限。如果 pause 變更失敗，驅動器會回退到停用續行。外掛程式 teardown 會關閉准入，停用所有活躍 goal 的續行，以 `parent` cause 取消正在進行的工作，並在事件防護仍生效的情況下等待驅動器和 agent 完全靜止。

## 模型體驗

### Goal Round 提示詞

#### 模型看到的內容

每個已准入 Round 都是一段保留的使用者角色 `<goal_round>` 塊，其中點明完整目標與正數 Round 編號。更早的使用者訊息、goal 狀態快照、assistant 輸出與工具記錄仍保留在同一工作階段歷史中。

#### Token 影響

每個已准入 Round 會增加一個固定指令塊和目標。後續請求會重新發送保留的 Round，直到壓縮（compaction）將其遮蔽；不會建立新 agent，也不會複製對話前綴。

#### KV Cache 影響

在一個 epoch 內僅附加：每個已准入 Round 都會在可複用前綴後擴充現有對話。壓縮可能替換派生歷史後綴，並移動可複用邊界。

## 已知限制與暫緩事項

- **沒有獨立評估器**：面向模型的 goal 策略會判斷證據是否足以完成，以及 blocker 在語義上是否未變；評估器支援的驗證仍保持暫緩。
- **只在同一工作階段執行**：此包有意不 spawn 新 agent、不 fork 工作階段前綴，也不實作 Ralph 風格的獨立嘗試；該工作流程屬於單獨的外掛程式層。
- **已接受佇列的解除安裝競態**：Cordis 外掛程式解除安裝是非同步的。已經被 agent inbox 接受的 goal 提示詞可以在解除安裝開始前啟動並消耗其 Round；teardown 隨後會取消請求、停用 goal 的續行並等待完全靜止。不會再啟動後續 Round。
- **只有 Round 上限，不是資源預算**：token、貨幣、時間與提供方配額策略保持獨立。對應的工作階段事件不會歸屬於 goal 訊息，也不會對映為 goal 阻塞程式碼。
- **例外情況不自動重試**：暫時性的提供方與持久化失敗需要之後由使用者授權 resume，而不會採用隱式重試策略。
