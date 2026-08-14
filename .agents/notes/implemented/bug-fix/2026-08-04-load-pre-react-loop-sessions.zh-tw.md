# Agent Note: 載入 react-loop 重構前格式的工作階段

Status: implemented

[English](2026-08-04-load-pre-react-loop-sessions.md) | [简体中文](2026-08-04-load-pre-react-loop-sessions.zh.md) | 繁體中文

## 問題

react-loop 簡化在保持 `SESSION_FORMAT_VERSION` 為 0 的同時更改了持久事件。該變更基線所儲存的工作階段包含 steering（中途引導）事件 `steering/message`，以及 `turn/start.trigger` 欄位；其終止原因還使用粗粒度 `aborted`、獨立的 `disposed` 和兩種舊版錯誤載荷。當前表層和輪次不變數無法直接重播這些記錄。

新的持久 inbox 不屬於此相容性問題。該基線會發出行程本機 inbox 通知，但不會產生 `agent/inbox/*` 工作階段事件，因此將舊歷史重播為待處理工作會讓已經領取或丟棄的提示詞再次執行。

## 決策

`PersistenceCoordinator` 會在後端解碼後識別 react-loop 重構前的確切形狀，並將其投影為當前讀取檢視表。它移除已廢棄的 `turn/start.trigger`，把 `steering/message` 轉換為同一條帶標識的 `user/message`，將舊版失敗事實對映為當前結構化錯誤，把 `disposed` 摺疊為帶 `disposed` 原因的已中止輪次，並用僅供持久化匯入使用的 `{ kind: 'legacy' }` 原因表示粗粒度中止記錄，因為無法獲得其呼叫方。

協調器會把該投影應用於 `load`、`inspect`、接管、HMR（熱模組替換）前綴比較和 `readFrom`。可尋址的 `readFrom` 通常只讀取後綴；如果後綴包含需要更早替換標識的舊版事件，協調器會先載入並規範化完整前綴，再返回所請求的 seq 範圍。

匯入器不會合成 inbox splice。復原後的 react-loop 重構前 agent（代理）從空的待處理清單開始，這與基線執行時期無法持久化待處理 inbox 工作的行為一致。已儲存產物仍然僅附加，後續事件使用當前格式。

## 考慮過的替代方案

**將同版本記錄視為不受支持。** 這符合預發布階段的默認立場，但會使 PR（Pull Request）基線產生的工作階段無法復原，儘管已移除的 steering 內容和終止事實都有完整對映。

**將舊 inbox 通知重播為持久 splice。** 這些通知不是工作階段事件，也無法提供可信的待處理狀態快照。如果無法獲知每一次領取和丟棄，就推斷插入操作，會讓已消費的工作再次執行。

**將粗粒度中止記錄歸因於現有呼叫方。** 將其對映到 `user`、`parent` 或 `hook` 會憑空指定舊記錄未註明的呼叫方。專用的 `legacy` 原因既能保留停止分類，也不會產生虛假的審計事實。

**重寫已儲存的 JSONL 和 SQLite 記錄。** 重寫會違反僅附加約定，並要求為讀取相容邊界建立後端專用的原子遷移機制。

## 後果

以重構基線格式寫入的工作階段可以透過當前 AgentLoop 復原，並完整保留 steering 內容、輪次邊界、錯誤事實和停止分類。共享協調器約定覆蓋記憶體、JSONL 和 SQLite 的 `load`／`inspect`／`readFrom`，包括 SQLite 後綴回退；組裝後的 JSONL agent 復原用例會驗證歷史 transcript（文字記錄）可見，同時兩個新 inbox 清單都從空狀態開始。

此例外支持基線格式，不支持重構開發期間產生的中間格式。具體而言，它沒有為更早的實驗性 `agent/inbox/spliced` 載荷定義遷移。透過確切形狀識別，當前格式外觀相似但結構錯誤的記錄仍會走拒絕路徑，不會被猜測性地轉換為有效記錄。

## 相關資料

- [載入訊息標識機制引入前持久化的工作階段](2026-07-28-load-pre-identity-session-messages.md)：負責另一項同版本格式變更的確定性標識和通用只讀匯入邊界。
- [以抽象服務實作工作階段持久化](../architecture/2026-06-14-session-persistence.md)：負責僅附加後端儲存和復原。
