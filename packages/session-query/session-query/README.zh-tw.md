# @deepseek-ai/dsh-session-query

[English](README.md) | 繁體中文

`SessionQueryEngine` 是組合式抽象 `ctx.sessionQuery` 約定。它對即時 `ctx.sessions` 和選填的動態掛載 `ctx.sessionPersistence` 實作精確工作階段歷史取回、關係跟蹤和與提供方無關的過濾；具體後端實作它的兩個全文方法。匹配 id 只產生一條記錄：即時事件優先，而 `live` 和 `persisted` 會報告兩種來源的可用性。如果不可變 header 存在衝突，則以 `SESSION_QUERY_SOURCE_CONFLICT` 失敗。

## 讀取

- `listSessions(signal?)` 讀取當前持久化元資料，以即時記錄優先的方式合併它們，並按確定性的最新優先順序返回克隆記錄。
- `readSession(sessionId)` 在執行與復原相同的核心重播驗證後，返回一份完整、脫離儲存的原始日誌；它絕不會將該工作階段放入即時儲存。
- `filterSessions(filters, signal?)` 對同一份克隆邏輯語料庫應用與提供方無關的工作階段元資料和可用性謂詞。
- `filterEvents(sessionId, filters)` 提取第一方語義文件，並按 seq 升序應用與提供方無關的元資料和字面文字謂詞。
- `readTitleSnapshots(sessionIds, signal?)` 從一次即時優先的語料庫觀察中解析唯一 id，將取消訊號傳遞給持久化清單查詢和檢查，並按順序返回每個工作階段的結帳結果，使某個缺失或格式錯誤的標題來源不會導致其他工作階段的結果被丟棄。每個即時來源直接 fold，每個持久化 worker fold 為脫離儲存的 header/標題結果，並在出隊下一個 id 前釋放完整日誌。取消會拒絕整個批次。`readTitleSnapshot(sessionId, signal?)` 是單次觀察檢視表；`readTitle(sessionId, signal?)` 只返回其選填的 folded `session/title`。
- `listEvents(sessionId)` 載入即時優先的原始日誌，將每個事件分類為 `current`、`shadowed` 或 `log-only`；該分類使用共享 `dsh-session` 表層 fold。
- `readSurface(sessionId)` 返回一個克隆 header、原始日誌捕獲邊界，以及按模型歷史順序排列的完整摺疊後當前表層。即時工作階段優先於持久化；壓縮（compaction）只會在其替換追加之前或之後被觀察，絕不會出現合成混合。
- `readEvent(request, signal?)` 返回一個克隆 header、完整目標事件和有界的原始 seq 視窗。`before` 和 `after` 預設為 0，且不得超過 `readWindowMax`。
- `traceSession(sessionId, signal?)` 只讀取一次語料庫，返回從直接父級向外的祖先，以及確定性的遞迴後代樹。`complete: false` 標識第一個缺失父級；與目標相連的迴圈會以 `SESSION_QUERY_INVALID_LINEAGE` 失敗。
- `traceEvent(request, signal?)` 只載入一次邏輯日誌，返回其克隆源 header、直接位置替換和直接引用的源事件連結。`replacementChain` 沿位置替換者跟蹤到最終替換；源事件連結仍不傳遞。

持久化是選填的，可動態掛載或解除安裝。已掛載持久化無法讀取時，跨語料庫清單和血緣跟蹤以 `SESSION_QUERY_PERSISTENCE_FAILED` 失敗；已經成功讀取、但無法透過 Session 校驗的持久化記錄則以 `SESSION_QUERY_CORRUPT_SESSION` 失敗。針對已知即時工作階段的標題讀取、事件跟蹤或事件讀取不會查詢持久化，因此持久化後端的健康狀態無法使當前記憶體狀態變得不可讀。持久化標題和事件操作在載入前先執行清單查詢，並在元資料不匹配時拒絕，而不會組合不一致的觀察。血緣跟蹤的取消訊號會傳遞給持久化清單查詢；事件跟蹤和事件讀取的取消訊號會傳遞給持久化清單查詢和檢查。每項操作都會等待已啟動的後端呼叫結帳，然後使用訊號的精確原因拒絕，即使後端忽略了該訊號。針對已知即時工作階段且預先中止的標題讀取、事件跟蹤或事件讀取會在 fold 或快照之前拒絕，且不查詢持久化。批次標題觀察執行一次元資料清單查詢，使用最多 `persistedInspectConcurrency` 個 worker 檢查唯一持久化 id，並保留每個標題自己觀察到的 header，供下游授權使用。取消不會啟動已排隊檢查，且只在已啟動 worker 結帳後拒絕。`listSessions()` 仍保持輕量，不載入日誌或索引標題。

## 過濾與提取

`SessionResultFilter` 覆蓋 id、可空 cwd、建立時間範圍、可空父級和來源可用性。`SessionEventResultFilter` 覆蓋 seq/時間範圍、事件類型、表層和語義文字。過濾器陣列使用 AND；同一清單子句內的值使用 OR。空清單值不匹配任何內容，範圍包含端點，而格式錯誤的範圍或封閉聯合值以 `SESSION_QUERY_INVALID_FILTER` 失敗。

文字子句刻意與 FTS 提供方無關：呼叫方文字會被轉義為不區分大小寫的 Unicode 正規表達式，每段連續空白匹配一個或多個空白字元。它是字面語義文字掃描，而非全文查詢。`extractSessionEventText()` 和 `buildSessionEventSearchDocuments()` 定義共享的第一方文件投影；推理（reasoning）塊、結構邊界、流區塊、請求 header 和未知聲明合併變體不產生文件。

## 全文方法

`SessionQueryEngine.searchSessions(request, exec?)` 按匹配最強的事件對邏輯語料庫分組；`searchEvents(request, exec?)` 搜尋一個邏輯工作階段。這兩個是服務僅有的抽象方法。兩者都返回分頁結果，其延續資訊是由服務持有的帶品牌 `SessionSearchCursor`；接受選填取消，並在不使用提供方專用數值分數的情況下提供摘錄。事件搜尋分頁結果還攜帶來自與命中相同索引世代的克隆目標 header，使授權消費端可將策略綁定到此次載荷觀察。搜尋請求只接受事件元資料過濾器，因為字面文字過濾使用上文所述掃描路徑。

該包沒有提供方協調器、回退實作或獨立具體外掛程式。具體服務後端繼承已實作的讀取、過濾和跟蹤，同時負責全文觀察、對帳、排名、遊標世代和查詢執行；第一個實作是 [`@deepseek-ai/dsh-session-query-sqlite`](../session-query-sqlite/README.md)。

`SessionQueryError.code` 是一個封閉聯合，覆蓋請求驗證、缺失目標、格式錯誤的表層、來源衝突、持久化/索引失敗、取消，以及無效或過時遊標；精確字面值在 [`src/config.ts`](src/config.ts) 中定義。

`listEvents()`、`readSurface()` 和 `traceEvent()` 執行同一個單遍 `dsh-session` 表層 fold。只有當事件 seq 從零開始且連續、表層標記符合事件類型的適用性要求、源事件陣列非空且無重複、引用指向較早事件，且每個位置替換都命名並引用它移除的每個表層節點時，載入的日誌纔有效；任何違規都以 `SESSION_QUERY_INVALID_SURFACE` 失敗。

## 設定

| 鍵 | 預設值 | 約定 |
|---|---:|---|
| `readWindowMax` | `50` | `before` 或 `after` 的最大原始事件數。 |
| `persistedInspectConcurrency` | `4` | 一次批次讀取中的最大並行持久化日誌檢查數；必須是正的安全整數。 |

## 模型體驗

無。該可信查詢服務只向呼叫方返回克隆工作階段記錄，不註冊面向模型的提示詞、schema、工具或訊息。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **無呼叫方授權**：這是上下文範圍內的可信基礎設施；未來的模型工具或 UI 必須限制呼叫方可檢查的工作階段。
- **無登錄檔或面向模型工具**：尚未提供提取器和搜尋提供方登錄檔、遞迴遍歷所引用的源事件的能力，以及面向模型的工具。[跟蹤決策](../../../.agents/notes/implemented/feature/2026-07-13-session-query-tracing.md) 負責關係語義；SQLite 歸屬和 tokenizer 決策位於[已實作搜尋記錄](../../../.agents/notes/implemented/feature/2026-07-10-sqlite-session-query-provider.md)。
