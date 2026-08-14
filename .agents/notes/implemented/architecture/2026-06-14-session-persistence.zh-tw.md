# Agent Note: 工作階段持久化作為基於現有 `SessionEvent` 的抽象服務

Status: implemented

[English](2026-06-14-session-persistence.md) | [简体中文](2026-06-14-session-persistence.zh.md) | 繁體中文

## 問題

工作階段此前僅存在於記憶體中。示例外掛程式 `session-jsonl.ts`（在兩個示例中逐位元組重複）是隻寫的遙測：它緩衝 `session/event` 並追加 JSON 行，沒有讀取/重播路徑，沒有崩潰安全性（無 fsync、無原子寫入、dispose（資源釋放）時採用 fire-and-forget 方式排空），沒有清單功能，也沒有格式版本控制。沒有任何機制能將磁碟上的歷史工作階段重新注入到活躍的 agent（代理）中，因此持久復原、持久 fork 以及宿主側的工作階段瀏覽都無法實作。

[事件溯源模型](2026-06-11-event-sourced-sessions.md)將僅附加日誌作為唯一真源，並從中派生 LLM（大型語言模型）歷史。持久化必須忠實於這一設計：直接持久化現有的 `SessionEvent`，不引入需要來回轉換的平行「持久化訊息」類型。後端也必須可替換——當前用文件儲存，以後用資料庫儲存——並由同一介面封裝。

## 決策

持久化是一個具有抽象 Service Definition 的**能力 seam**（[能力 seam](2026-06-13-capability-seams.md)，`dsh-shell` 範本），而非迴圈或核心邏輯：

1. **介面**（`dsh-session-persistence`，`ctx.sessionPersistence`）：一個抽象的 `SessionPersistence` 服務，提供 `locate`/`create`/`append`/`prepare`/`load`/`inspect`/`readFrom`/`list`/`listSnapshots`。其持久化單元就是現有的 `SessionEvent`（`{ type, seq, time, data }`），原樣複用，無轉換類型。
2. **實作**（`dsh-session-persistence-jsonl`）：每個工作階段一個僅附加的邏輯 JSONL 日誌：先是一行 `SessionHeader`，隨後是無損表示連續 `SessionEvent` 流的儲存記錄。符合條件的 `assistant/chunk` 增量連續段默認使用打包行；[帶校驗和的 Zstandard 幀](2026-07-19-zstandard-jsonl-session-logs.md)是默認物理編碼，也可透過設定使用原始行。

長期有效、存在爭議的關鍵選擇：

- **規範的持久日誌無損保留每個 `SessionEvent`，包括 `assistant/chunk`。** JSONL 儲存可以將一段連續的增量事件編碼為一條打包行，但邏輯讀取方會重建精確的事件邊界、序號與時間戳。`deriveMessages()` 跳過區塊，而過濾區塊的方案（Codex 的 `policy.rs`）很有吸引力，但 `seq = log.length` 以及 `events[i].seq === i` 驗證要求*連續*的邏輯日誌；過濾掉區塊會留下空洞，同時破壞約定和復原功能。基於區塊過濾的投影可以作為派生檢視表在後續實作（帶有自己的重新編號），但它不是規範日誌。
- **僅附加；崩潰的輪次被關閉，而非截斷。** 已刷寫的事件永不被重寫。[語義檢查點策略](../bug-fix/2026-07-21-semantic-session-checkpoints.md)會在呼叫模型前排空請求、在呼叫工具前排空已記錄的頂層呼叫，並在步驟結束後排空完整的回應/結果批次；迴圈則排空最終輪次邊界。由於一個被中斷的輪次可能包含大量有效工作，冷檢查會保留其連續、可解析的事件，並在記憶體邏輯檢視表中為未應答的 assistant 呼叫新增按風險分類的錯誤結果、補一個缺失的 `step/end`，以及帶 `{ kind: 'interrupted' }` 的 `turn/end`。`prepare` 或 `load` 在返回可復原檢視表前提交這些收尾事件；合成結果保證復原後的提供方 transcript（文字記錄）仍然有效。只有不完整的最後一條記錄會在提交修復時被丟棄；在最後一個真實 `turn/end` 處或之前出現解析錯誤或序號間隙，屬於資料損壞，會使該工作階段不可載入。
- **文件後端為規範實作，資料庫後端為經過驗證的直接替換。** `SessionEvent` 1:1 對映到一行 `(session_id, seq, type, time, data)`：`append` 是 INSERT（在一個斷言連續 seq 約定的交易中），讀取使用 SELECT … ORDER BY seq。`dsh-session-persistence-sqlite` 正是如此：一個 `SessionPersistence` 子類，介面無變化（opencode 在 SQLite/WAL 上採用的正是這種介面形態），且透過與 JSONL 後端相同的 `runPersistenceContract` 測試套件。該約定以相同的語義約束兩個後端（惰性物化、邏輯關閉中斷輪次、修復只提交一次、連續 seq），一次表達在文件位元組上，一次表達在資料庫行上。其資料庫擁有專用的 application id 與單調遞增的 schema 版本。系統會在一個事務中為全新文件建立所有表並寫入這兩個 header 值；未版本化文件若帶有任何使用者定義的 schema 對象或應用標識、當前版本文件若帶有外部應用標識，以及任何非當前版本文件，都會在修改日誌模式之前被拒絕。
- **元資料在日誌之外。** 格式版本、cwd 和譜系是儲存關注點，不是可重播的對話狀態，因此它們存放在 `dsh-session` 擁有的 `SessionHeader` 中，並透過新的只讀屬性 `session.header` 附加到 `Session` 上——永遠不進入 `SessionEventMap`，永遠不到達 `deriveMessages()`。`createdAt` 是以 Unix epoch 毫秒錶示的非負安全整數：執行時期建立和持久化註冊會拒絕小數值，JSONL 會驗證解碼後的 header，SQLite 則將其存入嚴格的 `INTEGER` 列。替代方案（一個可合併擴充的 `session/meta` 事件作為日誌第 0 行）被否決：日誌內事件會自然隨 seed/fork 的工作階段攜帶，但元資料不是可重播狀態，因此顯式的日誌外 header 邊界是更清晰的取捨。（header 最初被拆分為不可變的 `SessionHeader` 加可變的 `SessionSummary`，二者的聯合類型為 `SessionMeta`；可變 summary 後來因屬於死狀態而被移除——見 [移除可變工作階段摘要](../simplification/2026-06-19-drop-mutable-session-summary.md)。）
- **`ctx.agents.create()` 和 `ctx.agents.resume()` 是非同步工廠；復原還跨越持久化邊界。** `ctx.agents.resume({ resumeSessionId })` 透過 `ctx.sessionPersistence.prepare()` 取得精確的未發布 Session，以持久化 id 發布它，並繼續其投影。[Session 準備階段決策](2026-08-05-session-preparation.md)定義歷史檢查與復原之間的複用。agent loop（代理循環）不會硬注入 `sessionPersistence`（那樣會讓非持久化的演示永遠掛起）；當它不存在時，`resume` 會以明確的錯誤拒絕。

## 曾考慮的替代方案

上述每個關鍵選擇都在陳述處記錄了被否決的替代方案：**過濾區塊的規範日誌**（Codex 的 `policy.rs` 形式）破壞連續 seq 約定；**截斷崩潰的輪次**會靜默銷毀長時間自主執行中的真實工作；**日誌內 `session/meta` 事件作為第 0 行**——元資料不是可重播狀態；**有限的非整數 `createdAt` 值**沒有生產方，且與整數 Unix 毫秒儲存及查詢列不一致；**接受非全新的未版本化 SQLite 文件**可能覆蓋無關對象或應用標識；**將 `sessionPersistence` 硬注入迴圈**會讓非持久化的演示永遠掛起。

格式版本控制：header 攜帶一個 `version`；冷讀取拒絕任何非當前版本。預發布階段的工作階段格式仍固定為 `SESSION_FORMAT_VERSION = 0`，不承諾廣泛相容；當持久化使用者資料確有需要時，協調器可以負責顯式且範圍受限的匯入升級（[訊息標識機制引入前的訊息復原](../bug-fix/2026-07-28-load-pre-identity-session-messages.md)）。僅附加 + 刷寫對尾部的不完整寫入具有健壯性（冷準備時可容忍），但無法抵禦未使用 fsync 時在行寫入中途斷電；資料庫/WAL 後端是該場景下更強的選項。

## 後果

新增兩個包，以及 `dsh-session` 中的元資料約定（`session.header`，`create(id?, options?)` 簽名）。收益：持久復原/fork、讀取/重播路徑、崩潰容忍，以及基於現有事件溯源日誌的宿主側工作階段訪問，後端可在同一介面下替換。可複用的 `runPersistenceContract` 測試套件以相同的僅附加、連續 seq、惰性物化、邏輯復原、整數元資料與可序列化語義約束每個後端。持久化完整的邏輯日誌還確定了事件保真度：即使 JSONL 將多個 `assistant/chunk` 打包到一條儲存行中，每個事件也會精確保留。SQLite 初始化要麼提交完整的自有 schema 與 header 標識，要麼不留下任何會使下次打開受阻的部分 schema。
