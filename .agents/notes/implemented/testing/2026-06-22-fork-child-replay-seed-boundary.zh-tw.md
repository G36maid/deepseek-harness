# Agent Note: 持久化 seed 邊界以確保 fork 子工作階段重播正確路由

Status: implemented

[English](2026-06-22-fork-child-replay-seed-boundary.md) | [简体中文](2026-06-22-fork-child-replay-seed-boundary.zh.md) | 繁體中文

## 問題

[逐工作階段快照重播 Agent Note](2026-06-22-subagent-snapshot-replay.md)使快照層能夠表達巢狀 agent（代理）形狀：一個父項加上每個行程內 subagent 的一份記錄日誌，每份日誌都按呼叫工作階段作為鍵，以獨立指令碼重播。它曾指出（§ 範圍，最後一個項目符號），fork 快照「只是未來很容易新增的一項，並非鍵控缺口」。這一判斷對 fork 子工作階段而言是錯誤的——問題不在鍵控，而在*指令碼派生*。

subagent 指令碼由 [`deriveReplayScript`](../../../../packages/test-support/llm-replay) 從已錄制的工作階段日誌推導：它按 `(turn, step)` 對日誌中的 `assistant/chunk` 事件分組，每次 `stream()` 呼叫對應一條重播條目。對 **spawn** 子工作階段而言這是正確的，因為其日誌只包含自身的模型呼叫。

**fork** 子工作階段不同。fork 後端用*父日誌的一段平衡的已完成輪次前綴*（[`dsh-subagent-in-process-driver`](../../../../packages/subagent/subagent-in-process-driver)）來播種子工作階段，而該 seed 會成為子工作階段持久化的 `log`（`Session` 構造函式將 seed 複製進 `this.log`）。因此 fork 子工作階段的 `.jsonl` 以**父工作階段**的事件開頭——包括父工作階段的 `assistant/chunk` 事件——之後纔是子工作階段自身的輪次。

從 fork 子工作階段的完整日誌推導指令碼，會把**父工作階段**的已錄制回應當作**子工作階段**的模型呼叫來回放：實際執行的 fork 子工作階段第一次呼叫 `stream()` 時，會收到父工作階段的第一段區塊序列而非自身的。當時已錄制的場景全部是 spawn，所以這從未觸發——但 fork 快照會靜默地錯誤路由，恰好屬於快照層存在的意義所要捕獲的那類 bug。

## 決策

記錄工作階段**繼承**前綴的結束位置，將其持久化，並讓重播 harness 僅從子工作階段**自身**的事件推導指令碼。

### 1. 工作階段頭部的 `seedLength`

`SessionHeader` 新增選填欄位 `seedLength: number`——表示有多少前導事件是透過 seed 繼承而來、而非本工作階段產生的。fork 後端在建立子工作階段時設定它（= 播種前綴的長度）；全新的 spawn 子工作階段不設定（等同於 0）。它透過 `CreateSessionOptions.meta`（及 `CreateAgentOptions.meta`）傳遞，在 `SessionStore.prepare` 中設定。

`seedLength` 是**顯式**的，絕不從 `seed.length` 推斷。復原/載入時用工作階段的完整已儲存日誌作為 seed，此時 `seed.length` 是全長而非原始邊界——復原路徑改為從載入的 header 中取回持久化的 `seedLength`。（做法與 `createdAt` 相同：復原時顯式保留，而非重新預設為當前時間。）

### 2. 兩個持久化後端均完整往返

- **JSONL**：header 行上的 `seedLength` 欄位（`toHeaderLine`/`fromHeaderLine`）。
- **SQLite**：`sessions` 表上的 `seed_length` 列。

包含 `seed_length`、`source_event_seqs` 和 `surface_op` 的 SQLite 版面配置為 schema version 4。更早的 version 3 版面配置存在歧義，因此在預發布策略下，所有非當前 `user_version` 均直接拒絕，不做遷移。

### 3. 重播從邊界之後推導子工作階段指令碼

`dsh-llm-replay` 的 `parseSessionHeader` 現在也讀取 `seedLength`（缺失則為 0），`loadSessionScripts` 從 `parseSessionLog(text).slice(seedLength)` 推導子工作階段條目——即邊界及之後的事件，也就是子工作階段自身的模型呼叫。對 spawn 子工作階段而言 `seedLength` 為 0，此操作是空操作，spawn 場景逐位元組不變。

這彌補了路由正確性的缺口，兩個已錄制的 fork 場景對其進行端到端驗證——見[記錄 fork 與混合 spawn+fork 快照場景](../../archived/testing/2026-06-22-fork-snapshot-scenarios.md)。

## 曾考慮的替代方案

- **在 `llm-replay` 中啟發式推導邊界**（播種前綴是連續的父事件，止於子工作階段第一條 `user/message` 之前的最後一個 `turn/end`）。否決：在測試 harness 中用脆弱的啟發式重新推導一個生產者已經知道的事實。在源頭（fork 後端）持久化邊界，是「在包邊界處顯式優於隱式」這條規則跨越持久化邊界的應用——子工作階段 fixture（測試前置資料）的讀取者永遠不需要重建繼承在哪裡結束。
- **固定格式版本而不遞增**（事件日誌使用的 `SESSION_FORMAT_VERSION = 0`「不穩定」姿態）。對 SQLite *表*版面配置否決：`SCHEMA_VERSION` 是單調遞增並拒絕舊版的旋鈕（數量不多、可枚舉且值得區分的一組修訂），與事件詞彙的 `version` 不同。新增列正是它所版本化的那種破壞性表變更，因此需要遞增。

## 後果

- core 與兩個後端新增一個持久化 header 欄位；子系統目錄（`persistence.md`）在同一變更中更新（其 `SessionHeader` / `CreateSessionOptions` 的 `type-equiv` 塊）。
- 既有的 schema v2 SQLite 資料庫在打開時被拒絕（預發布階段無使用者資料）。
- spawn 重播不變（`seedLength` 為 0）。fork 重播現在將子工作階段路由到自身的指令碼；由 `llm-replay` 測試中的一個回歸用例覆蓋（一個子工作階段 fixture，其播種前綴包含父工作階段的區塊——推匯出的子工作階段指令碼必須排除它，不做 slice 時該用例會失敗）以及一個持久化往返測試（兩個後端，透過共享的 coordinator 約定）。
