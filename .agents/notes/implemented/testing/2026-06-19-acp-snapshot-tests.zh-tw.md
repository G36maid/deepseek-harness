# Agent Note: ACP 快照測試——一次錄制 / 確定性重播

Status: implemented

[English](2026-06-19-acp-snapshot-tests.md) | [简体中文](2026-06-19-acp-snapshot-tests.zh.md) | 繁體中文

## 問題

單元測試不會覆蓋組裝後的完整 agent（代理）子行程及其 ACP（Agent Client Protocol）自動化協定格式，而真實 API 測試不具確定性且受金鑰門控。因此，即使單元測試覆蓋率檢查透過，Loader 接線、後端行為和協議輸出仍可能回歸，[默認匯出事後檢討（postmortem）](../../../../docs/postmortem/0001-acp-default-export-drops-inject.md)已經證明瞭這一點。

完整 transcript（文字記錄）測試的阻塞因素在於模型：agent 的輸出由非確定性的 LLM（大型語言模型）驅動，而每次執行都命中真實 API 的金鑰門控測試既不確定也無法在 CI 中執行。該測試層級需要真實執行的保真度與 fixture（測試前置資料）的確定性兼得。

## 決策

快照測試會啟動真實 ACP 示例，透過確定性指令碼驅動其 stdio 協議，並將規範化輸出與已提交的預期輸出比較。從真實 API 一次記錄的工作階段日誌為後續所有模型流提供資料。fixture 就是產品普通的持久化 JSONL。

### fixture 即持久化的工作階段 JSONL

每個場景的 `session.jsonl` 都從真實執行中採集。`assistant/chunk` 事件復現模型流；工具、訊息和邊界事件捕獲 harness 行為。因此，一份普通工作階段產物同時充當重播來源和行為預期輸出。

每個簽入倉庫的工作階段格式 fixture 都使用規範的打包物理版面配置。覆蓋所有行類型的場景從一份獨立的真實錄制機械派生；測試要求它包含每一種打包儲存行類型，並在兩份 fixture 解碼後逐事件精確相等；隨後，普通重播與日誌比較會證明組裝後的行程能夠消費並復現該版面配置。

### 重播從日誌推導模型指令碼

`llm-replay` 短路了提供方無關的 `llm/stream` waterfall（瀑布式事件）。`deriveReplayScript()` 在終止的 `finish` 區塊處切分已記錄的 `assistant/chunk` 事件，並用 `(turn, step)` 變化拒絕前一條未終止的呼叫。攜帶 `llmStreamCall: true` 的 `compaction/summary` 會在其持久日誌位置貢獻一次呼叫：重播根據 `rawOutput` 重建規範塊邊界，保留已記錄的 usage（如有），並提供終止的 `stop`。該標記將這次本機呼叫與範本摘要或遠端摘要區分開；後兩者即使保留了 `rawOutput`，也未使用此上下文的配接器。

### 記憶體中的重播條目遵守完整的 LLM 約定

`deriveReplayScript` 產出一組 `ReplayEntry`，即重播監聽器按位置服務的記憶體單元：

```
{ kind: 'chunks', chunks: StreamChunk[] }
| { kind: 'throw', chunks: StreamChunk[], message: string, code: string }
| { kind: 'hang' }
```

日誌從已結束的 assistant 流和顯式標記的壓縮（compaction）呼叫推導區塊條目。流開始前的拋出、掛起和外部摘要器呼叫沒有可重建的本機區塊表示，因此這些場景提供 `replay.override.json`。throw 條目可以包含前綴區塊以模擬流中途失敗。顯式覆蓋避免了從有損的輪次結束原因或單獨的提供方輸出推斷配接器行為。

### 位置式重播，單個運送中流

重播是位置式的，因此每個場景只允許一個運送中模型流。並行工作階段快照需要按請求鍵索引的條目。呼叫順序變更需要重新錄制，fixture 缺失或耗盡時立即報錯。

### 錄制採集日誌；無金鑰重播需要無提供方的設定

記錄模式使用真實 `llm-deepseek` 配接器和設定為 `persistenceCompression: 'none'` 的 JSONL 持久化後端執行場景，再把生成的 `.jsonl` 複製到場景目錄。顯式 raw 模式讓已提交重播 fixture 保持逐行可讀，而普通部署使用後端的壓縮預設值；符合條件的區塊連續段仍使用默認的打包儲存行。逐事件追加具有持久性，但 harness 會在採集前優雅關閉子行程（關閉 stdin → `await ctx.dispose()`），以確保最終事件已刷出。`llm-replay` 本身不執行記錄——它只負責重播。

重播使用 `cordis.snapshot.yml` overlay，以 `llm-replay` 替換真實配接器，同時保留實際組合。記錄使用普通設定和由 harness 提供的持久化根目錄。重播模式跳過 `.env` 載入，因此意外存在的 API 金鑰不會觸發真實呼叫。參見[單一來源設定 Agent Note](../../archived/testing/2026-07-04-single-source-acp-replay-config.md)。

### 兩個表面：歸一化後比對

快照執行斷言**兩個**歸一化後的表面，因為 harness 的外部表面是不同的：

1. **stdout transcript**——自動化用戶端收到的、分幀後的 ACP JSON-RPC 回應與已提交的訊息更新。它捕獲傳輸約定的回歸，與已提交的 `stdout.expected.jsonl` 比較。
2. **重新持久化的工作階段 JSONL**，經過規範化後與 `session.jsonl` 比較。同一 fixture 同時作為重播來源和預期日誌。提示詞與工具的主體內容會被清理；每種請求標頭類別由一個場景固定餘下的請求標頭序列。該 pin 默認擁有可讀的提示詞與工具 schema 伴隨檔案；當完整的對應序列相同時，也可將另一個 pin 指定為其中任一來源，因此每個不同的伴隨檔案版本只提交一次。fixture 守衛會拒絕重複的伴隨檔案內容，錄制/刷新會拒絕生成不同位元組的共享引用方。最初的請求標頭固定理由保留在[請求標頭固定 Agent Note](../../archived/testing/2026-07-06-pin-request-header-content-in-one-scenario.md)中。Override 場景僅從其伴隨檔案派生模型行為。

兩個表面互補：stdout 覆蓋精簡的自動化協定格式，JSONL 覆蓋協定格式有意省略的迴圈、工具和邊界結構。

規範化會替換工作階段、cwd、協議 id、時間戳、路徑和行程易變值，同時保留確定性序號。錄制與刷新還會在重播 fixture 中將生成的 workspace 及其檔案系統解析出的別名儲存為 `{{cwd}}`，使平臺臨時根目錄和隨機 basename 不影響錄制結果；手工編寫的臨時路徑與顯式 `workspaceParent` 下的 cwd 值仍保留字面值。場景把真實 bash 使用限制在穩定命令上。stdout 預期輸出仍是符合協定格式的 JSONL，每個原始行都必須可解析為 JSON。普通 Vitest 快照更新只寫入 stdout 預期輸出；重播 fixture 的寫入由顯式 `record` 和 `refresh` 模式負責。

### 隔離：當前靠歸一化，後續可加沙盒

工具確定性來自生成的 cwd、清理後的環境、全新的非登入 shell、受限命令和規範化。cwd 預設為平臺臨時目錄；當臨時目錄是始終可寫的策略根，而行為需要獨立項目位置時，場景可以改為提供其父目錄。並行重播執行各自擁有獨立 cwd、持久化目錄和定長且按場景鍵區分的 spill 根目錄，因此一個場景的清理操作無法刪除另一個場景仍在進行的完整輸出復原，同時真實路徑預覽預算保持穩定。該層不聲稱提供 OS 級隔離。如果需要更強層級，沙盒執行器可以透過現有[能力 seam](../architecture/2026-06-13-capability-seams.md)替換本機後端。

### 重播外掛程式是獨立的包

`@deepseek-ai/dsh-llm-replay` 是一個支撐包，而非示例本機的膠水程式碼。它透過用從 JSONL 重建的流短路 `llm/stream` 來替換真實配接器，其包級放置使重播邏輯處於正常覆蓋率閘門之下。

### 兩個子命令，重播在默認閘門中

`pnpm run test:snapshot` 無需金鑰即可重播已提交 fixture；`test:snapshot:record` 使用真實 API，並重寫採集的工作階段日誌與 stdout 預期輸出。同一無金鑰閘門會透過 `session` 頭記錄發現倉庫中的 JSONL，並拒絕與共享編解碼器的規範打包表示不同的任何 fixture。缺少 fixture 時會明確報錯。每個場景都包含 `input.json`、`stdout.expected.jsonl` 和 `session.jsonl`；不呼叫模型的情況使用僅含頭記錄的日誌。只有標記為 `overridden` 的場景才需要 `replay.override.json`，因為它一旦存在就會取代派生重播。fixture 守衛會拒絕缺失、不匹配和孤立文件。兩個命令都接受場景過濾器。

## 曾考慮的替代方案

- **手工編寫包含模型區塊的 `llm.json`**——早期草案；複用真實工作階段日誌，使 fixture 成為系統的真實產物而非手工建置的 mock，並讓它同時充當行為預期輸出。
- **為每個壓縮摘要強制提供重播 override**——否決：持久摘要事件已經固定成功本機呼叫的位置、完整輸出與選填 usage。顯式的本機呼叫標記保留了這份單一來源 fixture，而不會為範本摘要器或遠端摘要器憑空構造呼叫。
- **位元組級 HTTP 錄制庫（Polly/nock/MSW）**：否決。與配接器耦合，處理流式 SSE（Server-Sent Events）時笨拙，且層級低於被測對象。
- **從 `turn/end {kind:'error'|'aborted'}` 合成拋錯/取消條目**：否決。這會將 `llm-replay` 耦合到 loop 內部的輪次關閉語義，且 `turn/end` 原因是有損的（無法區分拋出的 401 與 finish-error）；顯式的 `replay.override.json` 伴隨檔案是更清晰的 seam。
- **在每個類別 pin 旁複製兩個請求標頭伴隨檔案**：否決。提示詞與工具 schema 的組合各自獨立變化，因此一個共享元件發生變更，就會使不相關類別 pin 中位元組完全相同的文件產生無意義改動。顯式的分元件來源可在不重複內容的情況下，為每個類別保留一個結構性 pin。

## 後果

該測試層為每個場景增加經過評審的輸入、工作階段、stdout、選填 override 和選填 workspace fixture，並為每個不同的已固定提示詞序列、每個不同的已固定工具 schema 序列各增加一個文件。記錄與重播都會把 workspace seed 複製到生成的 cwd。作為回報，該層透過真實 Loader 和工具組合提供確定性的無金鑰覆蓋，其中包括一個組裝後的上下文溢位復原場景，其帶標記的壓縮摘要提供輔助呼叫。保留下來的大多數場景測試的是組裝後的後端而非 ACP；[僅面向自動化的 ACP 決策](../simplification/2026-07-23-acp-automation-only-protocol.md#snapshot-boundary)將該語料保留在此處，直至它能夠在不損失覆蓋的情況下遷移到傳輸無關的 headless 套件。

本 Agent Note 與[擬議的確定性 Agent Note](../../proposed/testing/2026-06-11-deterministic-and-stress-testing.md)相關，但不取代它：該提案的「通用重播 fixture」在每次測試後重新派生工作階段*訊息歷史*（內部一致性不變數），而這些快照固定組裝後的行為與外部自動化輸出。在後端語料遷出 ACP 之前，兩者相互補充。
