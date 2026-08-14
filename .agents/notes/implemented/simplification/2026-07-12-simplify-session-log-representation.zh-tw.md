# Agent Note: 簡化工作階段日誌表示

Status: implemented

[English](2026-07-12-simplify-session-log-representation.md) | 繁體中文

## 問題

工作階段日誌維護著兩種表示，其機制複雜度超出了消費端的實際需求：一個偽連結串列 surface 和自訂的請求標頭增量。

`SurfaceManager` 同時在陣列、seq map 和可變 `prev`/`next` 連結中儲存相同順序。生產程式碼從不讀取任一連結：compact 的工具配對 balance 判定基於按 surface 順序快取的各切點 balance。替換已經使用 `indexOf`，因此連結並未使其主導操作成為常數時間。使用線性替換尋找的 seq 陣列具有相同的漸近替換成本，卻只有一種表示需要驗證。

請求標頭子系統實作了一套自訂的系統/工具增量編解碼器和傳輸決策層，儘管其約定聲明增量只是編碼最佳化，而非可重建性要求。在每個 agent loop（代理循環）實例邊界保留初始/復原的完整快照，然後在該實例的組裝頭髮生變化時寫入一條規範的完整 `request/header`，即可保留重播能力，同時刪除 `SystemDelta`、`ToolsDelta`、往返回退邏輯以及持久化的 `request/header-delta` 變體。編解碼器專屬的詞彙隨編解碼器一起消失，並非因為其各分支本身無效。

實作保留追加與替換操作的 `sourceEventSeqs`、崩潰修復結果引用的 `tool/call` seq，以及所有 `SessionStartSource` 變體，因為這些欄位承擔審計/攔截職責，當前沒有讀取方並不能推翻這一點。

## 決策

`SurfaceManager.nodes` 是由事件序號組成的 `readonly number[]`；公共 `SurfaceNode` 形狀、node 連結和 seq-to-node map 均已移除。內部替換 generation 訊號保留。session-query 使用的完整 `foldSurface()` 讀取會返回相同的數字陣列表示和替換元資料，而無需讓增量 manager 保留歷史。工具配對 balance 和壓縮（compaction）使用事件序號與 surface 位置；由 compact 擁有的每個切點的 balance cache 不相依性 node 連結。

請求標頭只使用規範的完整快照。初始與復原錨點即使沒有變化也仍是完整快照；實例內變化會追加另一個完整 `request/header`，reason 為 `change`。delta 事件、codec 類型、diff/apply 輔助函式，以及僅供 codec 使用的 `fallback` reason 均已移除。請求重建選擇最新快照。

`SESSION_FORMAT_VERSION` 仍固定為 `0`，因此 seed、追加和持久化載入驗證會顯式拒絕舊 v0 `request/header-delta` 事件，以及攜帶已刪除 `fallback` reason 的完整快照。不存在相容性 fold 或遷移。JSONL 與 SQLite 測試固定了這一失敗即報錯的邊界；ACP（Agent Client Protocol）快照 harness 則把合法的工作階段中途變更表示為固定的完整請求標頭和完整可讀提示詞。

## 曾考慮的替代方案

**保留連結串列節點和緊湊增量以備未來擴充。** 連結可能有助於未來的遊標 API，增量在大型工具 schema 僅有少量變化時可以縮減日誌。但沒有已發布的遊標使用這些連結，而完整快照以磁碟空間為代價，顯著簡化了正確性保障。如果頭部體積確實成為問題，可以基於真實 trace 設計壓縮方案或經過度量的規範增量方案。

## 驗證

單元測試覆蓋並鎖定有序 surface 的追加/替換行為、工具配對、壓縮、完整請求標頭 fold/記錄、請求重建和開發不變數。Seed 驗證以及 JSONL、SQLite 載入測試會在重播前拒絕舊事件。無金鑰 ACP 套件按新的表示覆蓋記錄、刷新、重播、變更後請求標頭的固定，以及沙盒模式切換 fixture（測試前置資料）。

## 後果

完整請求標頭會增加日誌體積，線性替換尋找在極大 surface 上也可能較慢。由於先前實作呼叫 `indexOf`，替換原本就是線性的；benchmark 推遲到真實 trace 表明更簡單的陣列成為瓶頸時再進行。格式版本仍為 `0`，因此顯式拒絕舊事件是預發布格式邊界的永久組成部分。作為交換，surface 順序和請求標頭狀態現在各自只有一種表示，刪除了連結維護、map、codec 分支、往返 fallback 和針對 delta 的快照規範化。
