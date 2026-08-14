# Agent Note: 在工作階段索引中記錄最後活動

Status: proposed

[English](2026-07-29-durable-last-activity-index.md) | 繁體中文

## 問題

一個冷工作階段（已持久化、未附加）對「使用者上次是什麼時候在這裡寄出 prompt」沒有權威的已儲存答案。`dsh-host-apiproxy` 從選填 projection cache 的 `lastPromptAt` 提供 `updatedAt`，缺失時回退到 `createdAt`，Web 用戶端按該值為 Session 樹排序。cache 採用 fail-soft 並非同步寫入 checkpoint，因此缺失或延遲的記錄會讓最近收到 prompt 的 Session 排得過舊。

閘道以前會在可用時採用 JSONL 產物的 mtime。mtime 回答的是另一件事：這份產物上次是什麼時候被寫入。每一次持久寫入都會刷新它，包括對撕裂尾部的截斷修復、平衡中斷輪次的合成 closer，以及拾起時追加的 [`session/end-seed` 邊界](../../implemented/architecture/2026-07-30-session-end-seed-log-boundary.md)。這套近似會讓 Session 僅僅因為被打開就提升排序。[有界冷空白驗證](../../implemented/bug-fix/2026-08-13-bounded-cold-blank-verification.md)移除了 mtime 排序，並把 cache 保守的「過舊」錯誤方向作為現階段取捨。

已附加摘要可以摺疊即時事件日誌並選擇最新的真人 `user/message`，但冷路徑有意不讀取大日誌。為計算 `updatedAt` 而讀取每一份日誌，會讓 `list()` 的開銷隨對話總位元組數而非 Session 數量成長。用於 metadata 驗證的 1 KiB 冷讀取可以讓符合條件的小產物得到精確的最近時間，但不能讓大日誌的排序精確。

讓冷排序變得精確仍是一項持久格式決策，因此其範圍留在本文，而不是閘道 workaround 中。

## 提案

把最新真人 prompt 時間存到列舉本就會讀取的 Session 索引，這樣 `summarizeCold()` 無需打開日誌或相依性 cache checkpoint 就能給出答案。該值由協調器計算，因為它看得到每一次追加，而且本就擁有每 id 狀態；由後端負責持久化。這樣它就成為 `PersistenceBackend` 約定中新增的一個要素，而不是各後端本機帳目，並與已附加投影使用同一個事件謂詞：`source.kind` 為 `user` 的 `user/message`。

兩個已交付的後端受到的約束正好相反，本提案對它們有意採取不對稱的處理：

- **SQLite** 在 `sessions` 表上得到一列，與 `appendBatch` 在同一個交易中寫入，代價是一次單調的 `SCHEMA_VERSION` 遞增。
- **JSONL 無法承載一個可變的 header 欄位。** header 就是第 1 行，在物化時一次寫就，此後這份日誌永遠以追加方式打開；`jsonl.spec.ts` 釘住了「已提交的位元組絕不重寫」。一個每次追加都要改的 header 欄位，違反的是一條被斷言的持久性不變式，而不只是讓寫入方變複雜。要與「讓 JSONL 保持近似」相比較的形態，是每工作階段一個伴隨檔案。

實作之前必須回答三個問題，本文對它們都沒有定論：

**共享謂詞由誰擁有？** 已儲存欄位在寫入時編碼規則，寫入方只看到一個批次，而已附加摘要摺疊整份日誌。兩者必須使用同一個匯出的事件謂詞或 reducer，避免新的訊息來源變體讓已附加排序與冷排序發生分歧。

**該欄位引入之前的日誌表現如何？** 既有產物裡沒有這個值。回退到 mtime 能讓它們保持今天的準確度；回退到 `createdAt` 是誠實的，但會把選擇器和工作階段樹裡每一個既有工作階段都重新排一次序。

**對 JSONL 來說伴隨檔案可以接受嗎？** 它重新引入了每工作階段第二個文件，而該文件可能與日誌不一致，這正是單產物設計所避開的。

## 考慮過的替代方案

**在冷路徑上讀取日誌。** 它按構造就是正確的，也不需要改動格式，但會讓只讀 header 的列舉失去意義：`list()` 的開銷將隨日誌總體量成長，而 web 工作階段樹會扇出到儲存中的每一個工作階段。mtime 近似的存在，正是為了避開這個選項。

**保留 mtime，但把邊界的寫入排除在它之外。** 否決的理由是做不到，而不是不合意：mtime 屬於檔案系統，不屬於後端。除了在每次邊界寫入之後把時間戳復原，沒有別的辦法能保住它，而那樣做會與任何並行讀取方產生競態，也會對這份產物撒謊。

**僅在確實發生了修復時才寫入邊界。** 這能降低出現頻率，而[邊界 Agent Note](../../implemented/architecture/2026-07-30-session-end-seed-log-boundary.md)已經否決過它：謂詞對有序重新啟動同樣必須成立。用一條正確性不變式去換時間戳的準確度，方向是錯的。

**從投影快取派生活動時間。** 這是當前的過渡實作。`session-projection-cache` 會摺疊水位線之後的尾部，無需改變持久格式，但它是選填且 fail-soft 的。缺失或 checkpoint 延遲會讓排序取決於 cache 是否存在以及是否新鮮，因此無法提供本文所提議的權威值。

## 驗收標準

- 冷工作階段的 `SessionSummary.updatedAt` 等於已附加工作階段的投影為同一個工作階段報告的那個值；驗證方式是復原、不跑輪次就退出，並斷言兩條路徑上的順序都沒有變化。
- 在 web 工作階段樹和 TUI 復原選擇器中，一個復原後即被棄置的工作階段不會排到此後工作過的工作階段之前；由一份組裝後的快照釘住，而不是隻靠單元測試。
- prompt 時間規則只有一個定義：一個測試證明，在包含真人 prompt、注入式 user message、邊界和 closer 的日誌上，已儲存欄位與已附加摺疊結果一致。
- 在選定的回退方案下，該欄位引入之前的產物能夠無錯誤地載入和列舉，並且該回退在排序上的後果有斷言覆蓋。
- 按本倉庫不做遷移的立場，SQLite 的 `SCHEMA_VERSION` 遞增會拒絕舊的磁碟版本。

## 風險

**prompt 時間的兩個定義發生漂移。** 已儲存欄位按批次計算，而投影在整份日誌上計算。一種新訊息來源若在寫入時按一種方式歸類、在學取時按另一種方式歸類，就會產生冷排序與已附加排序彼此矛盾的 Session；該缺陷只會在重新啟動後顯現。

**JSONL 的伴隨檔案可能與它的日誌不一致。** 在日誌追加與伴隨檔案寫入之間發生崩潰，會留下一個過時的值，而且沒有撕裂尾部標記可用來修復它。每個消費端都得把伴隨檔案當作一條提示來對待，而這與 mtime 今天的地位已經很接近了。

**回退方案會讓既有工作階段重新排序。** 無論選定哪種回退，持有既有日誌的使用者都會在升級時看到自己的選擇器和工作階段樹重新排一次序。選 `createdAt` 會讓這次重排的幅度很大。

**代價可能超過這個缺陷本身。** 剩餘缺陷是 projection metadata 缺失或延遲時的保守錯序。如果對 JSONL 來說誠實的答案是「保留 cache 回退」，那麼本文的結局可能是記錄該決定，而不是實作一個欄位。

## 相關

- [有界冷空白驗證](../../implemented/bug-fix/2026-08-13-bounded-cold-blank-verification.md)——移除 mtime 排序，定義 projection cache 的過渡回退，並把直接冷讀取限制為小產物 metadata 驗證。
- [種子結束日誌邊界](../../implemented/architecture/2026-07-30-session-end-seed-log-boundary.md)——讓 mtime 不適用的非 prompt 寫入之一。
- [工作階段持久化](../../implemented/architecture/2026-06-14-session-persistence.md)——僅附加與絕不重寫這兩條不變式，正是它們排除了可變的 JSONL header 欄位。
- [共享持久化寫入協調器](../../implemented/architecture/2026-06-18-shared-persistence-write-coordinator.md)——一個已儲存欄位將掛入的那條追加路徑。
