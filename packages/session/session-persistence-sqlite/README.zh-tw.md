# @deepseek-ai/dsh-session-persistence-sqlite

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

SQLite 持久工作階段儲存後端：第二個 `SessionPersistence` 提供方（見[工作階段持久化](../../../.agents/notes/implemented/architecture/2026-06-14-session-persistence.md)），滿足與 `dsh-session-persistence-jsonl` 相同的約定（僅附加、連續 seq、延遲實體化、在 load 時關閉中斷輪次），但用 `node:sqlite` 行而非文件位元組表達。

`locate(meta)` 返回 `undefined`：所有工作階段共享一個數據庫，因此不存在真實、獨立的逐工作階段 transcript（文字記錄）路徑。

## 儲存模型

每個 `SessionEvent` 1:1 對映到 `events` 表中的一行 `(session_id, seq, type, time, data, source_event_seqs, surface_op)`；`data` 是作為 JSON 文字的事件 payload，因此行結構就是原始事件本身（包括 `assistant/chunk`，保持 `seq` 連續）。兩個 `TEXT` 列 `source_event_seqs` 和 `surface_op` 可為空，儲存事件選填介面元資料欄位（見[工作階段介面](../../../.agents/notes/implemented/architecture/2026-06-18-session-surface.md)）。日誌外元資料（`SessionHeader`）、每實體化 incarnation id 和每日誌單調修訂位於 `sessions` 行；`createdAt` 是儲存在 strict `INTEGER` 列中的非負安全整數。單例狀態行攜帶不可變儲存 id。`sessions` 行只由第一次 `append` 寫入，其存在性是延遲實體化訊號（`list` 精確報告有行的工作階段）。

倉庫支持的 Node 範圍可不加 flag 使用 `node:sqlite`。資料庫啟用外鍵，並使用已設定 journal mode（默認 `wal`；WAL 共享記憶體文件不適用時使用 rollback mode）。`PRAGMA application_id` 標識規範持久化資料庫，`PRAGMA user_version` 儲存版面配置版本。新資料庫必須沒有 application identity 或使用者定義 schema 對象；初始化在一個事務中建立全部表並蓋上兩個 pragma。非 pristine 無版本資料庫、外部 application identity 和所有非當前版本在 journal-mode 變更前均會被拒絕，因為該未發布格式無遷移。

在具有 POSIX mode 的檔案系統上，後端為缺失目錄請求 mode `0700`，並在 SQLite 打開前以 mode `0600` 排他建立缺失資料庫；行程 umask 可進一步限制兩者。新 WAL、共享記憶體和持久 rollback-journal sidecar 獲得資料庫最終的僅所有者 mode。現有目錄、資料庫文件和 sidecar 保留原 mode；除已存在資料庫外的檔案系統設定錯誤會使初始化失敗。這些預設值防止寬鬆行程 umask 造成的意外暴露，但當其他 principal 能替換父目錄中的資料庫條目時，不保護資料庫機密性或完整性。

## 行上的約定語義

- **Append = 交易。**`append` 圍繞批次執行 `BEGIN`/`COMMIT`：它實體化 `sessions` 行（如果仍未實體化），並 INSERT 每個事件，首先斷言連續 seq 約定（第一個事件 `seq` 必須等於已儲存 next-seq）。批次中失敗（重複 seq 上的 UNIQUE 違規）會完全回滾，使已儲存日誌和記憶體遊標保持一致。（`load()` 已平衡已儲存日誌，因此 `append` 不必修復崩潰尾部。）
- **延遲實體化。**`create()` 只在記憶體記錄意圖，第一次 `append` 前不寫行。已建立但從未 append 的工作階段沒有 `sessions` 行，因此不在 `list()` 中（它精確報告有行的工作階段）。
- **在 load 時關閉中斷輪次。**`load()` 實作共享[當機復原約定](../../../.agents/notes/implemented/architecture/2026-06-14-session-persistence.md)：保留有效中斷輪次，在一個事務中追加合成關閉事件，並只移除撕裂尾部行。已提交解析錯誤或序列缺口使工作階段無法載入。復原會變更已儲存行，因此下一次 append 從平衡日誌和準確遊標開始。
- **非修改式檢查。**`inspect()` 返回不可變、平衡的邏輯檢視表，並可在記憶體中合成復原 closer，但不會刪除撕裂尾部行、追加復原行或更改輕量修訂。
- **輕量修訂。**`listSnapshots(signal?)` 組合不可變儲存與資料庫文件身份、每實體化 incarnation id，以及在每個變更交易中遞增的每工作階段計數器。完整前綴讀取在同一個讀交易中捕獲該 revision 及其事件行，`readStoredRevision()` 則只查詢 session 行來校驗保留的 preparation。它在不解析事件行的情況下保持未變觀察穩定，並區分獨立儲存和重建的同 id 日誌。它在共享就緒和同步元資料查詢前後檢查取消；查詢本身不可搶佔。

## 設定（schemastery）

```ts
interface Config {
  path: string   // SQLite database file path, or ':memory:' for an in-process DB
  journalMode?: 'wal' | 'delete' | 'truncate' | 'persist'   // journal_mode pragma; default 'wal'
  preparedSessionCacheSize?: number   // positive integer; default 5
  writeBatchMaxDelayMs?: number   // positive integer; default 200; maximum 2_147_483_647
}
```

## 寫入路徑

與 JSONL 後端一樣，外掛程式將每個凍結的 `session/event` 複製到對應活動工作階段的 controller 中，每個活動工作階段各有一個 controller。第一個待處理事件會開啟設定的固定批次處理視窗，後續事件會加入但不會重設截止時間。視窗到期後會啟動一個事務；該次寫入期間接納的事件會形成另一個獨立有界的後續批次。`session/flush` 會取消等待並排空當前與待處理批次。Controller 會持久化一次 fork 種子，並保留寫入遊標，使復原操作絕不重新 append 已儲存事件；它還會在 apply 時為活動工作階段設定初始狀態，因為 HMR（熱模組替換）不重播 `session/created`。dispose（資源釋放）會在關閉資料庫前排空每個保留的 controller。每個事件仍各佔一行 SQLite 記錄；批次處理只把更多 INSERT 歸入同一個交易和同一次修訂版本遞增。

## 模型體驗

### 復原的對話歷史

#### 模型看到的內容

SQLite 儲存不會向當前請求提供提示詞或 schema。載入會復原與 JSONL 相同的呈現歷史，並保留之前的 header 用於重建；新 loop 組合當前 envelope。復原會用 `TOOL_NOT_STARTED` 平衡沒有已持久化呼叫的 assistant 請求；已有持久化呼叫但無結果時則變為 `TOOL_OUTCOME_UNKNOWN`，它要求模型只重試只讀或冪等工作，並驗證可能的副作用或詢問使用者。行元資料和原始區塊不會成為訊息。

#### Token 影響

SQLite 儲存不會增加當前請求的 token 用量。復原會還原已保留的歷史，並產生當前 envelope 以及每個中斷呼叫所附、以引用形式呈現的修復結果文字所產生的 token 開銷。

#### KV Cache 影響

SQLite 儲存不修改當前請求前綴。只有重建歷史、當前 envelope 和模型路由匹配時，復原 loop 才能重用提供方快取；崩潰修復結果會追加到末尾。

## 已知限制與暫緩事項

- **`DatabaseSync` 是同步的**：每個 append 交易在整個期間阻塞事件迴圈；對本機儲存可接受，對繁忙多工作階段伺服器是吞吐上限。
- **寫入爭用無等待或重試策略**：後端不設定 busy timeout，也不重試 locked-database 錯誤，因此其他連線持有寫交易時操作立即拒絕。
- **只有 pristine 新資料庫或當前自有 `SCHEMA_VERSION` 才能打開**：無版本 schema 對象、外部 application identity 和所有其他 schema 版本被拒絕，而不是遷移（未發布軟體，無持久使用者資料需要保留）。
- **不刪除已儲存工作階段**：行會累積，直到外部移除（seam 無刪除介面；`ON DELETE CASCADE` 已為這種帶外清理設定）。
- **TODO：** 該後端直接呼叫 `node:sqlite`。如果採用 Cordis 資料庫服務（`cordis/db` / `@cordisjs` SQL driver 外掛程式），應改為透過該服務路由，而不在此直接持有 `DatabaseSync`；約定介面（`SessionPersistence`）不會變，只更換儲存驅動。
