# @deepseek-ai/dsh-session-query-sqlite

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

具體 `ctx.sessionQuery` 提供方。`SqliteSessionQueryEngine` 從 Service Definition 包繼承精確讀取、跟蹤和提供方無關的過濾，並使用 SQLite FTS5 實作其兩個全文方法。搜尋使用即時優先的邏輯工作階段語料庫，並按每個工作階段中匹配度最高的事件對跨工作階段結果分組。

## 搜尋約定

`searchSessions(request, exec?)` 返回跨語料庫的 `SessionSearchHit` 分頁結果；`searchEvents(request, exec?)` 返回單個工作階段內的 `SessionEventSearchHit` 分頁結果。查詢不得省略，首尾空白會被移除，內部空白會被規範化，並按字面短語處理。引號、`OR`、`NEAR` 和 `*` 等 FTS5 文法被視為資料，而非可執行 MATCH 文法。中繼資料過濾器是在排名前應用的參數化 SQL 謂詞。為使 SQLite FTS5 MATCH 保持在受支援的外層謂詞上下文中，跨工作階段請求最多可編譯 14 個組合工作階段與事件過濾謂詞；工作階段內請求最多可編譯 13 個過濾謂詞，因為固定目標工作階段謂詞佔用一個 slot。每個範圍端點編譯為一個謂詞。請求超過任一謂詞預算，或超過 SQLite 可移植的 32,766 總綁定上限（包括固定查詢和分頁值）時，會在準備語句前以 `SESSION_QUERY_INVALID_FILTER` 失敗。

持久表和 TEMP 表之間的相關性排名可直接比較：先按實際 FTS5 高亮匹配 span 數降序，再按已儲存文件碼點長度升序。事件時間、適用時的工作階段 id 和 seq 打破其餘平局。跨工作階段結果將所選事件公開為 `bestMatch`；兩種範圍都從 FTS5 高亮位置派生空白規範化的純文字，並按 Unicode 碼點限制長度。遊標是帶品牌類型的不透明值，綁定到規範化請求和服務實例，並在相關世代變更時失敗。工作階段內遊標可在不相關工作階段變更後延續使用；跨工作階段遊標則不能。

預設可搜尋全部三種表層（`current`、`shadowed` 和 `log-only`）。傳入表層過濾器可縮小範圍。

## 來源與索引生命週期

該服務需要 `ctx.sessions`，並動態觀察選填的 `ctx.sessionPersistence`。一個序列化狀態機比較來源限定的輕量持久化快照修訂，僅以不修改日誌的方式檢查新日誌或已更改日誌，提取共享語義文件，以交易方式對帳變更，然後執行查詢。工作階段查詢絕不會呼叫持久化後端會修復崩潰的 `load()`；檢查期間接入的活動所有者無法修改其日誌，穩定觀察重試使結果優先使用即時來源。TEMP 即時行仍會記錄持久化可用性，而持久基庫會在該活動所有者脫離後刷新。重複查詢以及同一儲存未發生變化的重新打開操作不會執行完整持久化日誌檢查；切換儲存，或觀察到新增、已更改、已刪除或經外部 load 修復的來源時，會在下次穩定觀察時對帳。來源或交易失敗不會提交任何內容，下一次搜尋會重試。

`openAt: startup` 是預設值：服務啟用會匯入 `node:sqlite` 並打開控制代碼；如果索引無效，則會在服務發布前失敗。`openAt: first-search` 會將服務以 ACTIVE 狀態發布，同時不匯入 SQLite 模組也不打開控制代碼；首批並行搜尋共享同一個就緒 promise，在任何搜尋前 dispose（資源釋放）服務時也不會匯入模組或打開控制代碼。此模式透過把 SQLite 的實驗性警告推遲到首次實際搜尋，支援需要乾淨 Node 22 啟動輸出的組合；它不會抑制屆時的警告。無效資料庫同樣會使首次搜尋失敗，而不是服務啟用失敗。`openAt: never` 為該部署關閉全文搜尋：`searchSessions` 和 `searchEvents` 在任何請求規範化之前就以 `SESSION_QUERY_SEARCH_DISABLED` 失敗，node:sqlite 絕不會被匯入或打開，也不執行任何來源觀察或對帳，而 `ctx.sessionQuery` 上繼承的全部精確讀取、過濾和跟蹤保持可用。

持久化 FTS 行位於專用派生資料庫中。連線本機 TEMP 表保存即時行，這些行會遮蔽同一工作階段的持久化基庫，並在即時所有者消失後使其重新可見。解除安裝持久化會隱藏持久行，但不會丟棄快取；重新掛載會對帳快取。關閉或重新打開資料庫會刪除全部即時覆蓋層，但保留持久行。

該資料庫雖可丟棄重建，但 reset 操作受到保護：每個已識別 schema 版本都會在修改 journal mode 前拒絕未知使用者表；只有包含派生表的已識別不相容 schema 才會原地重建。不相關資料庫或規範資料庫將被拒絕。絕不能將 `path` 指向 session-persistence 資料庫。在支援 POSIX 權限模式的檔案系統上，缺失的目錄和資料庫會以僅所有者可訪問的方式建立（行程 umask 前為 `0700` 和 `0600`），SQLite 伴隨檔案繼承資料庫的權限模式；現有權限模式保持不變。每個派生索引路徑在一個行程中只能由一個服務擁有；不支援外部寫入者或第二個行程，因為世代和 TEMP 遮蔽狀態由連線持有。

## 設定

| 鍵 | 預設值 | 約定 |
|---|---:|---|
| `path` | 必填 | 專用派生索引 SQLite 路徑；支援 `:memory:`。在 POSIX 檔案系統上，缺失的檔案系統路徑會以僅所有者可訪問的方式建立。 |
| `openAt` | `startup` | `startup` 會在服務啟用完成前打開；`first-search` 把 SQLite 模組與控制代碼推遲到搜尋時再載入和打開；`never` 關閉全文搜尋（以類型化的 `SESSION_QUERY_SEARCH_DISABLED` 失敗），繼承的讀取保持可用。 |
| `journalMode` | `wal` | `wal`、`delete`、`truncate` 或 `persist`。 |
| `defaultLimit` | `20` | 請求省略 `limit` 時的分頁大小；最多為 `Number.MAX_SAFE_INTEGER - 1`。 |
| `maxLimit` | `100` | 接受的最大請求分頁大小；最多為 `Number.MAX_SAFE_INTEGER - 1`。 |
| `snippetChars` | `240` | 按 Unicode 碼點計算的最大 snippet 長度。 |
| `readWindowMax` | `50` | `before` 或 `after` 的最大原始事件數，用於繼承的 `readEvent()`。 |
| `persistedInspectConcurrency` | `4` | 繼承批次讀取的最大並行持久化日誌檢查數；必須是正安全整數。 |

## 分詞器與限制

該索引使用 FTS5 `unicode61`。取捨是 token/短語召回而非任意子字串召回：`AI` 不匹配 token `BRAID`。需要執行字面的空白彈性子字串掃描時，使用 `ctx.sessionQuery.filterEvents()` 並傳入 `text` 子句。查詢會拒絕 NUL；文件中的保留高亮標記和 NUL 會在索引前被規範化，使展示標記無法與源文字衝突。

中止訊號會停止已排隊工作，並原樣流經快照枚舉和非修改式檢查。來源工作一旦開始，序列化狀態機會自行等待該後端 promise，即使後端忽略取消，之後也會在啟動任何進一步的枚舉、檢查、對帳或查詢工作前檢查訊號。因此，呼叫方只會在已啟動後端工作完全靜止後觀察到取消，而後續搜尋在該清理尚未完成時無法進入 serializer。Node 的同步 `DatabaseSync` API 無法中斷已在 JavaScript 執行緒上執行的中繼資料或 MATCH 語句；系統會在這些不可搶佔呼叫前後立即檢查訊號。

## 模型體驗

無。該可信搜尋後端只向呼叫方返回命中，不註冊面向模型的提示詞、schema、工具或訊息。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **無呼叫方授權**：這是上下文範圍內的可信服務；模型工具或 UI 必須強制執行自己的訪問策略。
- **同步查詢執行**：`DatabaseSync` 在 MATCH 執行期間會阻塞 JavaScript 執行緒，且無法中斷已執行的語句。
- **Token 召回，而非任意子字串**：`unicode61` tokenizer 不會匹配更大 token 中的子字串；對字面掃描使用 `filterEvents()`。
- **單一所有者的派生索引**：每個索引路徑必須僅歸一個行程中的一個服務所有；不支援外部寫入者和多行程共享。
