# Agent Note: 摘要呼叫重播對話前綴以複用 KV Cache

Status: implemented

[English](2026-07-21-compaction-summary-prefix-cache-reuse.md) | [简体中文](2026-07-21-compaction-summary-prefix-cache-reuse.zh.md) | 繁體中文

## 問題

自動壓縮（compaction）在對話中途觸發，恰好在迴圈用最後一個已路由請求（`system` + `tools` + 派生歷史）預熱了提供方的 KV Cache 之後。隨後默認摘要器寄出一個*獨立的*輔助請求，其前綴與那個已預熱請求沒有任何共享部分：一個專門的摘要器 `system` 提示詞，後接被拍平成單個渲染後 transcript（文字記錄）字串的較早歷史。提供方基於請求起始的 token 序列做快取，因此第一個 token 只要不同（即一個不同的系統提示詞），整個已快取前綴就會失效。於是每次壓縮都要為整段重播的歷史付出兩次完整的提示詞處理成本：一次用於觸發壓力的對話請求，另一次用於摘要呼叫，恰好在對話最大時讓快取失去作用。

## 決策

摘要指令從請求的**前端**（一個全新的 `system` 提示詞）移到對話的**末尾**（最後一條 `user` 訊息）。輔助呼叫現在逐字復現最後一個已路由請求的前綴，並追加一條尾部指令，因此它是已預熱請求的真正前綴擴充，提供方會複用已快取的 token。

### `SummarizationInput` 攜帶回放的前綴，而非渲染後的字串

`summarize()`（以及內部的 `summarizeWithLlm`）接受一個 `SummarizationInput`（`{ system?, tools?, messages }`）而不是一個扁平的 transcript 字串。`region.ts` 用 `session.requestHeader()`（持久的 `system` 和 `tools`）加上經 `session.deriveEventMessage` 對映的被遮蔽區域來建置它，後者產出與 `deriveMessages()` 摺疊進已路由請求的內容位元組級一致的 `Message` 對象。`summarizeWithLlm` 把 `system` 和 `tools` 轉發到 `GenerateOptions`，並行送 `[...input.messages, { role: 'user', content: COMPACTION_INSTRUCTION }]`。`tools` 會一同帶上，即便摘要器從不呼叫任何工具：丟棄它們會縮短 token 序列，破壞與已快取請求的對齊。

### 指令是一條尾部 user 訊息

`COMPACTION_INSTRUCTION` 以 "You are now acting as a compaction engine…" 開頭，指示模型濃縮*上方的對話*。它保留先前檢查點的結構化標題，並在其新位置上新增了兩條前置系統提示詞此前不需要的規則：不要提及摘要請求，以及只輸出檢查點文字而不呼叫任何工具。被遮蔽區域總是結束在工具配對平衡的邊界上，因此在其後追加一條 `user` 訊息，對 OpenAI 相容配接器和 DeepSeek 配接器而言是合法的訊息排序。

### 快取複用是盡力而為，正確性則有保證

自動壓縮總是錨定在表層頭部，因此被遮蔽區域就是已路由請求的頭部，重播的前綴與之完全匹配，這就是保證命中的情形。手動的中段 `compactRegion` 仍然重播真實的前綴並保持正確，但會放棄複用，因為它的被遮蔽區域不是請求標頭部。設定的 `summarizationProvider`/`summarizationModel` 若與對話的路由不同，也會放棄複用；這是部署方明確的權衡，而非缺陷。目標解析（設定的覆蓋值 → 最新的已路由 header → agent（代理）選項，否則拋出）保持不變。

## 考慮過的替代方案

- **保留摘要器系統提示詞但複用其餘部分**——否決：system 槽位正是提供方最先做快取的 token 區域，因此一個不同的摘要器系統提示詞無論後面跟著什麼都會使整個前綴失效。只有把指令移離前端才能復原快取。
- **只發送被遮蔽區域而不帶 `system`/`tools` 頭部**——否決：頭部不同的序列在第一個 token 處仍然與已快取請求分叉，因此快取效果並不更好，反而丟失了摘要所需的框架。
- **從摘要請求中省略 `tools`**（模型從不呼叫任何工具）——否決：工具 schema 是已快取 token 序列的一部分；省略它們會讓後續每個 token 失去對齊，破壞複用。
- **為快照重播專門建立一個寄出 `assistant/chunk` 的摘要子工作階段**——否決：持久的 `compaction/summary` 事件會記錄成功本機呼叫的位置和完整輸出，而顯式呼叫標記可防止重播把範本或遠端輸出當作本機流。

## 後果

- **`dsh-compaction-basic`** 擁有 `SummarizationInput`；受保護的 `summarize(input, agent, signal?)` 掛鉤簽名發生變化（發布前可接受），並且 `region.ts` 新增了 `buildSummarizationInput`，它在 header 前綴之後對被遮蔽的 seq 摺疊 `deriveEventMessage`。
- **移除無用的渲染表面。** 舊的拍平路徑（`renderTranscript` / `renderContentBlocks` 及其在 `dsh-compaction` 中的 spec）已無消費端，連同其匯出一並刪除。
- **README 的 Model Experience** 現在把 `dsh-compaction-basic` 的輔助請求記述為重播的前綴加上一條尾部壓縮指令訊息，並把其 KV Cache 效果記述為複用已預熱的對話前綴。
- **帶框架的檢查點輸出未改變**，因此落地的 `user/message` 和每個對話請求快照都不受影響；只有輔助請求的形狀發生了變化。

## 測試

- **單元：** `compaction-basic.spec.ts` 斷言輔助呼叫轉發 `system`/`tools`/前導訊息，並把壓縮指令作為最後一則訊息追加，且 `compactRegion` 重播最新的已路由 header 前綴。現有的內容斷言透過重播的訊息而非 transcript 字串來讀取摘要器輸入。
- **迴圈：** `compact-loop-repro.spec.ts` 依據摘要請求尾部 user 訊息中的壓縮指令對其分類，溢位復原測試則繼續在真實迴圈中固定對話請求與摘要請求的數量。
- **快照：** 無金鑰重播會從帶標記的 `compaction/summary` 重建一條規範成功流；[compaction-seam Agent Note](../feature/2026-06-18-compaction-capability-seam.md) 負責持久標記約定。
