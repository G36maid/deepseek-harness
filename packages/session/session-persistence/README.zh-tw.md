# @deepseek-ai/dsh-session-persistence

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

工作階段持久化是一項能力 seam。抽象的 `SessionPersistence` 服務（`ctx.sessionPersistence`）是其 Service Definition。它要求持久化後端持久儲存、重新載入和列出工作階段，但不規定具體儲存實作。該 seam 採用與 `dsh-shell` 相同的角色劃分（見[能力 seam](../../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)）：本包負責 Service Definition，同級包負責 Service Provider，Consumer 注入該服務。

持久化單元就是現有 `SessionEvent`（事件溯源模型：日誌是唯一真源），因此不存在另一套平行的「持久訊息」類型。不屬於可重播對話狀態的元資料（格式版本、cwd、血緣、種子邊界、origin、委託深度）作為 `SessionHeader` 單獨傳輸，該類型歸 `dsh-session` 所有，並在此重新匯出。

## 服務 API（`ctx.sessionPersistence`）

| 方法 | 約定 |
|---|---|
| `locate(meta): SessionLocation \| undefined` | 在不執行 I/O 或實體化的情況下解析每個工作階段的絕對產物目標。沒有獨立本機產物的後端返回 `undefined`。 |
| `supportsRawArtifacts: boolean` | 明確說明該後端是否為每個工作階段暴露一份逐字工件。Consumer 在呼叫 `readRaw` 前檢查此能力；`false` 並不表示工作階段缺失。 |
| `readRaw(id, signal?): Promise<SessionRawArtifact \| undefined>` | 讀取受支持後端自身的逐字工件文字；只解碼物理編碼，絕不從事件重建。`undefined` 僅表示所請求工件缺失；不支持的後端會拒絕。 |
| `create(meta): Promise<void>` | 註冊新工作階段元資料。可以將物理寫入延遲到第一次 `append`（延遲實體化）。 |
| `append(id, events): Promise<void>` | 持久保存一個批次。僅附加；任何修復後，第一個事件 `seq` == 已儲存 next-seq；非 JSON 可序列化資料會被拒絕，並命名違規類型。 |
| `prepare(id, signal?): Promise<SessionPreparation>` | 預留復原所使用的那個未發布 Session。協調器會盡可能複用之前的檢查結果、提交待處理復原，並在 dispose（資源釋放）時將未發布 reservation 釋放回有界快取。 |
| `load(id): Promise<{ meta; events }>` | 轉換同一格式版本中受支持的舊記錄後，返回不可變、平衡的邏輯日誌，並提交冷復原。即時 load 先 flush 其快照，並在輪次開放時拒絕；冷 load 保留中斷的最終輪次，並用合成 `tool/result`/`step/end?`/`turn/end {interrupted}` 事件持久關閉它。只丟棄撕裂尾部碎片；已提交損壞和格式錯誤的記錄以 `SessionPersistenceCorruptionError` 拒絕，不支持的格式 `version` 或本建置不認識且信封未帶 `ignorable` 標記的事件類型以 `SessionFormatUnsupportedError` 拒絕，訊息說明拒絕方向，並在後端為每個工作階段保留獨立文件時給出原始日誌路徑。 |
| `inspect(id, signal?): Promise<{ meta; events }>` | 返回已經升級、驗證和深度凍結的邏輯檢視表，但不提交復原或發布 Session。冷檢視表會獲得僅存在於記憶體的合成復原 closer，物理撕裂尾部保持不變；即時狀態下的檢視表則是當前不可變快照，可能包含開放的輪次。基於協調器的實作會在有界 LRU 中保留該冷狀態下未發布的 Session 本身，供後續 `prepare` 使用，但已儲存修訂值變化後會丟棄並重新讀取。同 id 檢查共享進行中的讀取。 |
| `readFrom(id, fromSeq, signal?): Promise<{ meta; events }>` | 返回 `seq >= fromSeq` 的有效已儲存事件，不進入 preparation 快取、不截斷、不合成 closer，也不發布協調器狀態。`fromSeq` 達到或超過已儲存末尾時返回空事件清單；負數或非安全整數 `fromSeq` 會被拒絕。可尋址後端（SQLite）只讀後綴，除非轉換受支持的舊記錄需要讀取更早的記錄；順序後端（JSONL）解析整個產物並向前跳過。未知類型拒絕遵循同一讀取方式：尋址讀取只檢查返回的後綴，順序回退路徑還會拒絕視窗以下的未知必需事件。供 checkpoint 消費端只應用已存序號之後的事件。 |
| `list(signal?): Promise<SessionHeader[]>` | 從元資料輕量列出，不解析完整日誌。選填訊號取消後端清單工作。零事件延遲實體化工作階段不在 `list` 中。 |
| `listSnapshots(signal?): Promise<SessionPersistenceSnapshot[]>` | 返回輕量元資料和每份日誌一個不透明、帶品牌類型的修訂值，不載入事件日誌。日誌及其後端儲存不變時，修訂保持相等；append 或變更性 load 修復後會改變；不會僅因兩個儲存使用相同本機計數器而衝突。選填訊號請求取消後端發現工作；第一方後端會先等待所有已啟動的列出工作結束，再予以拒絕，因此呼叫返回拒絕時，相關工作已完全靜止。 |

## 每個後端必須遵守的不變數

- **僅附加；崩潰輪次會被關閉，而非截斷。** 已 flush 事件絕不重寫。崩潰可留下未關閉最終輪次，其事件真實且可能很大；`load` 保留它們，並持久追加合成 closer（為每個未獲回答的 assistant 呼叫新增一個帶風險分類錯誤的 `tool/result`，再新增 `step/end?`+`turn/end {interrupted}`），以平衡日誌，並確保重新載入的歷史仍是有效的提供方 transcript（文字記錄）。只丟棄從未完整寫入的撕裂尾部碎片。
- **連續 seq。**`load` 拒絕日誌中間的 `seq` 缺口/解析錯誤；`append` 的第一個 `seq` 必須等於已儲存 next-seq。
- **JSON 可序列化資料。**`append` 透過共享單遍無損 JSON 邊界實體化每個直接/重播批次。活動 `Session` 事件已深度凍結，但寫入協調器仍將每個事件複製到持久化自有緩衝區。
- **持久性。**`append` 只在批次持久後返回。

## 寫入協調器

`PersistenceCoordinator` 負責每 id 狀態和序列化、每個活動工作階段各自的有界寫入 controller、延遲實體化、崩潰尾部修復、工作階段接管和完全靜止的 dispose。第一方後端組合一個協調器，實作小型 `PersistenceBackend` 儲存掛鉤介面，並委託其有狀態方法。因此 JSONL 和 SQLite 共享生命週期正確性，同時保留不同儲存原語；見[協調器 Agent Note](../../../.agents/notes/implemented/architecture/2026-06-18-shared-persistence-write-coordinator.md)、[flush controller 簡化](../../../.agents/notes/implemented/simplification/2026-07-23-collapse-persistence-flush-state.md)和[有界批次處理決策](../../../.agents/notes/implemented/architecture/2026-08-08-bounded-session-persistence-write-batching.md)。

每個 `session/event` 將事件複製到工作階段 controller。第一個待處理事件會開啟固定批次處理視窗；後續事件會加入該批次，但不會重設截止時間。設定的 `writeBatchMaxDelayMs` 只限制這段有意等待，而不限制事件迴圈、初始化、序列化操作或後端延遲。寫入期間接納的事件會形成一個新的有界批次。`session/flush` 會取消等待，並作為共享的完全靜止屏障，排空屏障執行期間接納的事件。後臺寫入失敗只記錄一次日誌，保留順序不變的批次，並暫停自動重試；新事件會開啟新的固定視窗，而顯式 flush 或後端拆卸會立即重試，並在失敗再次發生時向呼叫方暴露失敗。

崩潰修復只適用於冷狀態。對於已有活動工作階段的 id，`load(id)` 為權威記憶體日誌製作快照，等待該快照持久，並只在平衡時返回；活動工作階段中開放的輪次會被拒絕，而不會收到合成中斷 closer。對於冷 id，檢查只讀取、驗證、凍結並構造一次未發布 Session；只有來源修訂值仍然是當前值時，重複檢查才會複用該對象圖。`prepare(id)` 在修復前執行相同校驗，預留該 Session 本身，提交任何待處理的撕裂尾部或中斷輪次修復，並將其返回用於發布。HMR（熱模組替換）接管透過 `loadStored` 讀取，應用協調器 cwd 檢查，並絕不關閉活動輪次。

後端讀取會在驗證當前記錄前，轉換同一格式版本中明確受支持的舊記錄。訊息標識機制引入前的訊息會獲得確定性的 id `legacy-message:<session-id>:<event-seq>`；工具結果的內容替換會繼承其目標匯入後的 id。react-loop 引入前的 `turn/start` 會移除過時的 trigger，已移除的 steering（中途引導）事件 `steering/message` 會轉換為同一條帶標識的 `user/message`；舊版 `turn/end` 會對映終止原因，但不會虛構舊記錄中沒有記載的呼叫方。協調器對 `load`、`inspect`、`readFrom`、無所有者狀態的認領和 HMR 前綴接管使用同一份轉換後檢視表。儲存仍然僅附加：讀取不會重寫舊記錄，此後追加的事件使用當前格式。這些是[訊息標識機制引入前的訊息](../../../.agents/notes/implemented/bug-fix/2026-07-28-load-pre-identity-session-messages.md)與 [react-loop 引入前工作階段](../../../.agents/notes/implemented/bug-fix/2026-08-04-load-pre-react-loop-sessions.md)決策所規定的範圍受限的匯入例外，並不構成通用的 v0 遷移承諾。

活動工作階段寄出 `session/disposed` 時，協調器等待其 controller，以序列方式執行最終 drain，然後釋放該精確 `Session` 對象擁有的狀態。失敗退役會將 controller 保留在活動工作階段 map 中，使後端拆卸可重試。後端拆卸先停止事件接納，flush 每個剩餘 controller，等待每 id 操作，最後才關閉儲存控制代碼。

無副作用 `locate`、輕量 `listSnapshots` 和按 id 查詢的 `readStoredRevision` 仍由後端負責，因為它們描述儲存拓撲和修訂身份，而非寫入編排。`listSnapshots(signal?)` 將呼叫方傳入的同一個訊號傳給後端發現流程，使觀察者可在不脫離該工作的情況下取消。

`PersistenceBackend<TornMarker>` 掛鉤（協調器與儲存之間的唯一約定）：

| 掛鉤 | 職責 |
|---|---|
| `name` | dispose 失敗 `AggregateError` 的後端標籤。 |
| `loadStored(id, signal?)` | 在全部儲存範圍中按 id 讀取已儲存前綴。用於復原／載入、非修改式 inspect、活動工作階段接管和 create 衝突探測。選填訊號屬於僅觀察讀取。返回元資料標識 `id`；`revision` 精確標識返回的 header 和事件；當且僅當必須截斷撕裂尾部時才存在不透明 `tornMarker`。 |
| `readStoredRevision(id, signal?)` | 在不載入事件日誌的情況下讀取一個 id 當前的來源限定修訂值。它使用與 `loadStored` 相同的修訂值表示；id 不存在時返回 `undefined`。 |
| `loadStoredFrom?(id, fromSeq, signal?)` | 服務 `readFrom` 背後的選填可尋址後綴讀取：返回 header 和 `seq >= fromSeq` 的已儲存事件，非修改式、無撕裂標記。SQLite 實作它（`WHERE seq >= ?`）；不實作的後端使用協調器回退——`loadStored` 加向前跳過。 |
| `appendBatch(meta, events, isMaterialized)` | 持久追加連續批次；尚未實體化時以原子方式延遲實體化。 |
| `commitRepair(meta, tornMarker, closers)` | 使崩潰修復持久：截斷撕裂尾部（當且僅當 `tornMarker !== undefined`；標記可為 falsy，例如 seq/offset `0`），並追加 `closers`。不要求原子性。由 load（截斷 + closer）和活動工作階段接管（僅截斷）使用。 |
| `list(signal?)` | 列出全部已儲存元資料，並遵循選填的取消訊號。 |
| `close?()` | 選填生命週期拆卸（例如關閉 db 控制代碼），在 dispose drain 後等待其完成。 |

協調器斷言已儲存 id，並在修復或活動工作階段接管前比較已儲存/活動工作階段 cwd。其 `inspect()` 路徑取得新鮮後端值的所有權，只驗證和凍結一次，並在不呼叫 `commitRepair` 的情況下最多保留設定數量的未發布 Session。只有保留源的修訂值仍等於 `readStoredRevision` 時，系統才會複用或修復它；否則協調器會重新讀取。該新鮮性校驗不會增加跨行程寫入排他。持久日誌在一次讀取與複核往返內保持不變時，修訂值重試才能收斂；持續的外部寫入可能延遲 `load`、`inspect` 或 `prepare`。`tornMarker` 完全不透明：協調器只測試 `!== undefined`，並將其原樣往返給 `commitRepair`，絕不檢查值（JSONL 後端使用待截斷位元組偏移，SQLite 後端使用待刪除 seq）。第三方後端可以不用協調器直接實作抽象服務，但必須提供相同的非修改式檢查和可信輕量快照修訂。詳見[寫入協調器 Agent Note](../../../.agents/notes/implemented/architecture/2026-06-18-shared-persistence-write-coordinator.md)。

## 元資料與位置類型

從 `dsh-session` 重新匯出：`SessionHeader`（不可變工作階段元資料：`version`、`id`、`createdAt`、`cwd?`、`parentSession?`、`seedLength?`、`origin?`、`delegationDepth?`）。`SessionLocation` 是 `{ readonly kind: string; readonly path: string }`；其 path 是絕對後端目標，不證明產物已存在或包含未 flush 輪次。

## 模型體驗

### 復原的對話歷史

#### 模型所見

該 seam 不新增提示詞或 schema。復原會將已儲存的表層事件還原為訊息歷史；已儲存請求 header 重建較早呼叫，新 loop 則為下一次請求組合當前系統提示詞、工具和工作階段前綴。崩潰修復將沒有持久呼叫的 assistant 請求標記為 `TOOL_NOT_STARTED`；有持久呼叫但無結果時變為 `TOOL_OUTCOME_UNKNOWN`，其文字允許模型重試只讀或冪等工作，但要求驗證副作用或詢問使用者，而不是盲目重試。

#### Token 影響

普通持久化期間為零 token。復原後會重新計入保留歷史的 token 用量，並照常計入當前請求 envelope 的 token 用量；每個已修復呼叫都會增加一段以引用形式保留的錯誤文字。

#### KV Cache 影響

持久化不修改當前請求前綴。只有當重建歷史、當前 envelope 和模型路由匹配時，復原 loop 才能重用提供方快取；崩潰修復結果僅附加，不重寫較早歷史。

## 已知限制與暫緩事項

- **無刪除或保留介面**：剪枝已儲存工作階段是帶外後端維護。
- **`list()` 無分頁且無過濾**：它返回每個已儲存工作階段的 header；適合本機儲存，大規模時無索引。
- **修復時合成 closer 是唯一崩潰方案**：後端必須在 load 時合成 `tool/result`/`step/end`/`turn/end` closer；沒有繼續中斷輪次而不先關閉它的部分輪次復原。
