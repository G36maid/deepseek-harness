# Agent Note: 共享持久化寫入協調器

Status: implemented

[English](2026-06-18-shared-persistence-write-coordinator.md) | [简体中文](2026-06-18-shared-persistence-write-coordinator.zh.md) | 繁體中文

## 問題

`dsh-session-persistence-jsonl` 與 `dsh-session-persistence-sqlite` 有意在不同儲存介質上證明同一份 `SessionPersistence` 約定，但它們重複實作了寫入路徑編排：每工作階段狀態、`session/created` 接管、後端特定的前綴讀取、write-behind（延遲寫入）控制、按 id 序列執行操作、HMR（熱模組替換）種子注入與 dispose（資源釋放）排空。純粹的種子前綴碰撞檢查與可序列化守衛已遷入 Service Definition 包；剩餘的編排仍然對正確性要求很高，且同樣的修復被應用了兩次。唯一的差異在於儲存原語（寫字節 vs. INSERT 行）。

## 決策

將一個後端無關的 `PersistenceCoordinator` 提取到 `dsh-session-persistence` 中。協調器統一擁有編排邏輯；每個第一方後端組合一個協調器實例（`new PersistenceCoordinator(ctx, this)`），實作一個小型 `PersistenceBackend` 掛鉤介面，並將其有狀態的公開方法（`create`/`append`/`prepare`/`load`/`inspect`/`readFrom`）委託給協調器。由後端擁有的元資料與修訂版本列舉會繞過協調器。

組合，而非繼承。協調器是後端持有的具體類，不是後端繼承的基類。協調器讓非常規後端與繼承層級作鬥爭的風險由此規避：後端只暴露掛鉤，無法觸及協調器的私有編排狀態。第三方後端仍然可以完全不使用協調器、直接實作抽象服務，包括不可變邏輯檢查，以及透過 `load` 實作的默認準備回退。

協調器為每個存活的 `Session` 實例持有一個生命週期條目：初始化，加上一個包私有寫入控制器，後者負責待處理事件、固定批次處理截止時間、活躍寫入、失敗保留和共享 flush 屏障。每個 `session/event` 都進入這條有界寫入路徑，`session/flush` 則繞過等待以觀察完全靜止。控制器歸並由 [flush 控制器簡化](../simplification/2026-07-23-collapse-persistence-flush-state.md)定義；調度節奏由[有界批次處理決策](2026-08-08-bounded-session-persistence-write-batching.md)定義。

協調器透過 `session/disposed` 退役工作階段：它等待控制器完成初始化和當前 flush，序列執行最後一次排空，且僅在成功後才移除控制器與其擁有的每 id 狀態。失敗時保持控制器可被找到，以供後端 teardown（拆除）重試。每個 id 的已結帳鏈尾僅在其仍是當前鏈尾時才移除自身，因此舊操作完成後不會抹除同一 id 的新操作。後端 teardown 會註銷寫入路徑監聽器、flush 每個剩餘的控制器、等待所有按 id 序列化的操作，最後關閉後端。

### 掛鉤介面（`PersistenceBackend<TornMarker>`）

五個必需成員加一個選填的生命週期掛鉤，構成協調器與儲存之間唯一的邊界：

- `name`——後端標籤，用於 dispose 失敗時的 `AggregateError`。
- `loadStored(id)`——按 id 跨所有儲存範圍讀取一個已儲存前綴（JSONL 的所有項目目錄；SQLite 的 id 全域性唯一）。準備、邏輯載入/檢查、物理後綴讀取、存活工作階段接管與建立碰撞探測共用此尋找。協調器會斷言返回的 id，並在修復或發布狀態之前拒絕已儲存記錄與存活工作階段的 cwd 不匹配。
- `appendBatch(meta, events, isMaterialized)`——持久追加一個連續批次，在尚未物化時原子地惰性物化工作階段（物化寫入與首批事件必須一起提交——二者之間發生崩潰時，不得留下一個已物化但為空的工作階段；這就是為什麼沒有單獨的 `materialize` 掛鉤）。
- `commitRepair(meta, tornMarker, closers)`——使崩潰修復持久化：截斷損壞的尾部（當且僅當 `tornMarker !== undefined`）並追加 `closers`。**不要求原子性**——JSONL 合理地分兩步 fsync（先截斷再追加），SQLite 在一個事務中完成 DELETE+INSERT。用於 `prepare`/`load`（截斷 + 合成收尾事件）和存活工作階段接管（僅截斷，`closers = []`）。
- `list()`——列出所有已儲存的元資料。
- `close?()`——選填的生命週期清理（SQLite 關閉 db 控制代碼；JSONL 省略），在 dispose effect 中於排空至完全靜止之後被 await，因此 close 失敗不會掩蓋排空錯誤。

### 不透明的 torn marker

保持 seam 整潔的唯一設計選擇：崩潰修復中「損壞尾部在哪裡」的 token 對協調器是不透明的。協調器計算合成收尾事件（它擁有來自 `dsh-session` 的 `interruptedTurnClosers`），但它只測試 `tornMarker !== undefined` 並將值原樣傳回 `commitRepair`——從不檢視其內容。每個後端選擇自己的 marker 類型：JSONL 攜帶要截斷到的位元組偏移，以及從不完整最終幀中解碼出的任何完整事件；SQLite 則攜帶要從其開始刪除的 seq。協調器因此既不瞭解位元組長度，也不瞭解幀復原狀態。

## 測試

共享的 `runPersistenceContract`（公開 API 約定）為每個後端執行，並證明 `inspect` 會配平被中斷的邏輯檢視表但不改變儲存或修訂版本，隨後由 `prepare` 或 `load` 提交復原。`runCoordinatorContract`（`tests/coordinator-contract.ts`）透過記憶體參考實作、JSONL 與 SQLite 覆蓋接管、HMR、碰撞、工作階段與後端 dispose 排空和崩潰尾部修復。`persistence.spec.ts`、`preparations.spec.ts` 與 `write-behind.spec.ts` 覆蓋準備複用與預留、有界準備狀態淘汰、固定視窗後續批次、存活控制器清理、同 id 鏈尾競態、失敗批次重試與關閉順序。各後端自身的測試規格只保留儲存機制。每個真實後端都有一個經由協調器的崩潰尾部修復測試，以覆蓋不透明 marker 分支，因為約定中的崩潰用例會產生合成收尾事件，卻不會產生 torn marker。

## 曾考慮的替代方案

- **後端繼承的基類**——否決，改用組合：後端只暴露掛鉤，無法觸及協調器的私有編排狀態，且第三方後端仍可完全不使用協調器、直接實作抽象服務。
- **更寬的掛鉤 API**——每個候選掛鉤都被摺疊掉：沒有限定儲存範圍的存活工作階段尋找，因為 `loadStored` 加上協調器的 cwd 檢查即可維持碰撞邊界；沒有儲存定位器泛型，因為經驗證的 JSONL 元資料可還原其路徑，而 SQLite 已按 id 綁定；沒有單獨的 `materialize` 掛鉤，因為首批事件必須與物化原子提交；沒有單獨的建立碰撞探測，因為它就是 `loadStored(id) !== undefined`；`list()` 也不經由協調器透傳，因為列舉不需要任何編排。

## 後果

協調器增加了一層間接、一個不透明的 torn marker、脫離工作階段生命週期的退役任務，以及有界的已準備 Session 狀態，但將此前每個後端重複的、對正確性要求很高的編排邏輯集中到一處。工作階段 dispose 仍是僅觀察事件，因此工作階段所有者不會等待持久化退役；協調器會收容失敗、在存活控制器中保留待處理事件，並以後端 teardown 為完全靜止邊界。其掛鉤面保持窄小：標識校驗、接管、碰撞檢查、準備與不可變檢查共用 `loadStored`；物化保持在 `appendBatch` 內原子完成；列舉繞過協調器。讀模型使用 `inspect` 而非 `load`，因此觀察已持久化但仍開放的輪次時不會提交中斷收尾事件；複用、預留與發布由 [Session 準備階段決策](2026-08-05-session-preparation.md)定義。新後端只需實作儲存原語，而無需複製有界寫入生命週期。
