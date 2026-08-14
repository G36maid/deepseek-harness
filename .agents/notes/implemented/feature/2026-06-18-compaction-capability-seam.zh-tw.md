# Agent Note: 壓縮作為能力 seam（抽象約定 + 基礎後端）

Status: implemented

[English](2026-06-18-compaction-capability-seam.md) | [简体中文](2026-06-18-compaction-capability-seam.zh.md) | 繁體中文

## 問題

長時間執行的 agent（代理）對話會無限成長。隨著事件日誌不斷累積輪次，派生出的訊息歷史最終逼近模型的上下文視窗，模型隨即在回應中途停止生成（`max-tokens`），或表現退化。**上下文壓縮（context compaction）** 是對此的緩解手段：用一段簡潔的摘要替換一批較早的歷史，保持近期上下文完整。

[工作階段介面面](../architecture/2026-06-18-session-surface.md)正是為此而建置的基礎設施：一份建立在事件日誌之上的有序投影，帶有專門設計的 `surfaceOp: { op: 'replace', start, end }` 操作，用於遮蔽一段條目並插入替換內容，`sourceEventSeqs` 列出每個來源事件，使重播可以驗證替換是否引用了它移除的每個事件。剩下的是那個*決定壓縮什麼、並產出摘要*的外掛程式。

兩股力量塑造了設計。第一，壓縮策略與可複用的 token 測量獨立變化：測量歸 LLM（大型語言模型）系列的 [`ctx.tokenMeter` 服務](../architecture/2026-07-15-replay-token-meter-service.md)所有，摘要生成則可以使用模型呼叫、範本或遠端服務。第二，`SurfaceEventType` 封閉為產生訊息的事件類型（`user/message`、`assistant/message`、`tool/result`）；只有這些類型可以攜帶 `surfaceOp`。因此一個專用的 `compaction/*` 事件**不能**出現在 surface 上，編譯器與 Session 始終啟用的 append/seed 邊界都會拒絕在其上附加 `surfaceOp`。

## 決策

### 壓縮是一個能力 seam，Service Definition 與 Service Provider 角色分離

遵循[能力 seam Agent Note](../architecture/2026-06-13-capability-seams.md)，壓縮以獨立包發布，使約定、演算法和（後續的）消費端 API 各自獨立演進：

1. **介面** — `@deepseek-ai/dsh-compaction`：抽象 `CompactionEngine`，擁有 `ctx.compaction` 鍵、`CompactionResult` 詞彙、`compaction/*` 工作階段事件、手動失敗分類體系以及規範的檢查點訊息來源。它將 `compactIfNeeded()`、`compactNow()` 和 `compactRegion()` 聲明為**抽象方法**——約定說明壓縮*做什麼*，而非*怎麼做*。
2. **實作** — `@deepseek-ai/dsh-compaction-basic`：具體的 `BasicCompactionEngine`，消費 `ctx.tokenMeter`，並擁有尾→頭保留遍歷、透過 `ctx.llm.stream()` 生成摘要、surface 替換、鎖、步驟前壓力處理和規範的上下文溢位復原。`summarize()` 是其唯一的子類掛鉤；計價與重播仍歸 meter 所有。
3. **無模型配套服務** — `@deepseek-ai/dsh-compaction-tool-result-pruner`：一個具體的選填服務，在後端選擇摘要範圍之前，重寫當前過大的 `tool/result` 節點。它不是第二種壓縮實作，也不實作 `CompactionEngine`。
4. **面向使用者的消費端** — `@deepseek-ai/dsh-command-compact` 透過 `ctx.commands` 註冊無參數 `/compact`，並呼叫後端無關的 `compactNow()` 操作。它是供使用者直接控制的命令，不是面向模型的工具。

### 約定相依性 `dsh-session` 和 `dsh-llm`——有意為之的偏離

能力 seam Agent Note 規定 Service Definition 包「僅相依性 cordis」（對 `dsh-shell` 成立，因為其詞彙是自包含的）。壓縮**無法**遵守這一點：它的動詞作用於 agent 擁有的 `Session`（`compactRegion(start, end, agent)`），其輸出使用內容詞彙（`CompactionResult.summary: ContentBlock[]`）。不引用 `Session`/`SessionEvent`（來自 `dsh-session`）和 `ContentBlock`（來自 `dsh-llm`），約定就無法表達。

這不是耦合異味，而是約定的領域所在。「僅 cordis」的指導原則一直是「介面僅相依性約定真正需要命名的東西，絕不相依性實作」的簡寫。`dsh-session` 和 `dsh-llm` 本身是介面/詞彙包，不是實作；`dsh-compaction` 仍然不匯入任何後端。seam 的真正不變式——*消費端和實作在抽象服務背後獨立演進*——完好無損。

### 三個抽象操作，演算法在後端

將完整演算法（保留遍歷、token 求和、文字提取）作為介面上的具體方法，會將約定重新耦合到一種策略：想要不同保留策略或事件排序的後端必須與繼承來的具體程式碼對抗。將三個操作都設為抽象，把所有*怎麼做*的決策放在後端，並讓介面保持為*做什麼*的聲明。token 測量根本不是壓縮掛鉤；單例服務使多個消費端能夠共享逐工作階段的重播摺疊。

`compactIfNeeded(agent, trigger, signal)` 接受顯式的 `'pressure' | 'context-overflow'` 觸發原因與取消訊號。它只讀取最新的持久化已路由請求；沒有 header 就不執行工作，任何已路由的提供方/模型目標都使用單例估算器。`compactNow(agent, signal)` 要求 agent 處於 idle，即使未達到壓力也進行一次有效的平衡縮減；不存在這種範圍時返回 `null`，且不寫入任何內容。`compactRegion(start, end, agent, signal?)` 將 `agent.session` 作為唯一工作階段身份，並為顯式呼叫方保留選填 signal。默認摘要器依次從顯式設定、最新記錄的已路由目標和 agent 選項解析目標，並在任何 `llm/stream` 路由後記錄提供方/模型對。它重播已路由請求的前綴，並將壓縮指令追加為尾部 user 訊息，從而複用提供方的熱 KV Cache；見[摘要前綴快取 Agent Note](../bug-fix/2026-07-21-compaction-summary-prefix-cache-reuse.md)。該結果攜帶 `llmStreamCall: true`，因為生成它時恰好透過此上下文的 LLM 服務發起了一次呼叫；只有滿足相同條件時，子類才設定該標記，因為單有保留的 `rawOutput` 並不能判定呼叫路徑。該呼叫將提供方無關的 `GenerateOptions.purpose` 設為 `compaction`；配接器可以將此用途對映為對模型隱藏的傳輸元資料，DeepSeek 配接器會發送 `x-deepseek-harness-compact: 1`。

### 成功的持久步驟工作完成後執行自動壓力檢查

成功呼叫的壓力檢查在下一個 `agent/pre-step` 執行；此時前一回應、工具結果、緩衝上下文與 steering（中途引導）已經持久化，而下一個請求尚未派生。`dsh-compaction-basic` 透過 `ctx.tokenMeter` 測量規範的已記錄請求，因此下一個請求無需推測性覆蓋信封即可看到任何替換。壓力達到條件後，選填的 `ctx.toolResultPruner` 重寫在摘要範圍選擇前執行；compaction-basic 重新測量持久 surface，如果修剪復原到安全壓力便跳過摘要生成。

規範的提供方上下文溢位走另一條路徑。失敗步驟先關閉，`agent/request-error` 接收原始請求錯誤。compaction-basic 自行持有按 agent 計的溢位次數，在強制執行一次有效且平衡的縮減前先修剪，且僅當 `session.surface.replaceGeneration` 增加時才返回 `{ kind: 'retry' }`；這包括沒有摘要範圍時僅修剪取得的進展。隨後迴圈關閉失敗輪次，開啟新的編號重試輪次，並從持久日誌重建請求。沒有替換、任何替換前的復原失敗、取消、耗盡的上限或無關錯誤都會保留原始提供方失敗。如果修剪已經推進 generation，而後續摘要工作失敗，復原會從該持久的已修剪 surface 重試，除非取消或 dispose（資源釋放）先發生。完整生命週期決策見[呼叫後復原 Agent Note](../architecture/2026-07-10-after-call-compaction-pressure-and-overflow-recovery.md)。

```
assistant/message → tool/result/context/steering → step/end
claim the next batch → await waterfall agent/pre-step  ⟵ pressure compaction before the next request
enter → next step/start

provider overflow → step/end
await waterfall agent/request-error  ⟵ forced compaction between attempts
retry → next numbered step/start      ⟵ derives from the replacement surface
```

### 保留是輪次無關的；工具配對平衡是唯一的結構守衛

自動壓縮在**每個成功的**步驟之後檢查，而非每輪一次。這對失控輪次存活至關重要：工具密集型的 ReAct 輪次每步追加一個 `assistant/message` + 一個 `tool/result`，因此 surface 會在一輪之內成長。下一個 pre-step 檢查可以在後續執行開啟另一個步驟之前壓縮早期已關閉的工具對；如果請求率先越過限制，由提供方確認的溢位仍是兜底機制。

`compactIfNeeded` 保留估算大小達到解析後保留 token 預算的最小完整 surface 單元尾部，壓縮更早的節點。一個單元是一個完整的已關閉步驟或一條無步驟訊息。如果 token 截斷點落在步驟內部，保留範圍會擴充直到切割點滿足工具配對平衡。平衡按 surface 順序檢查，而非日誌序號，因為替換摘要在舊的 surface 位置擁有新的序號。`dsh-compaction` 匯出前後邊緣輔助函式；只要 `replaceGeneration` 不變，其逐工作階段快取就只摺疊新增的 surface 尾部節點，面對僅日誌成長時不讀取事件，並在替換後重建當前成員關係與平衡。`compactRegion` 拒絕將工具呼叫與其結果拆分的邊界。進行中的輪次不享受特殊保留。

因此失控輪次的壓縮方式與其他歷史完全相同：其早期*已關閉*步驟被摘要，近期步驟保持原樣。當唯一可壓縮的內容只剩一個不可拆分的開放尾部步驟（其工具呼叫尚無結果）時，壓縮拒絕執行（返回 `null`）並在該步驟關閉後重試。

**部分單一單元溢位仍不在範圍內。** 摘要範圍選擇無法拆分不可分割的單元。當可移除的文字型工具結果內容佔據大部分空間，且修剪後的剩餘內容不再超限時，選填修剪器可以修復一個已關閉的工具對。僅信封壓力、貼上的 `user/message` 等不可分割的超大非工具節點，以及不可修剪餘量仍然過大的工具單元，依舊不屬於壓縮範圍；限制這些單元是另一個關注點。

### 頭部錨定：一個自動檢查點，始終在頭部

自動壓縮始終從 surface 頭部開始，將先前的檢查點與新壓縮的歷史合併，因此只保留一個自動檢查點。`shadowedRange` 因此是位置性的而非數值序號區間：一個較新的摘要序號可能佔據較舊的 surface 位置。`shadowedSeqs` 記錄權威的 surface 順序。手動的中間範圍壓縮可能留下多個檢查點。

### 近似收斂不變式

`resolveConfig` 提供可用預設值：閾值比例 `0.8`、保留尾部比例 `0.16`、空的摘要提供方/模型覆蓋、`maxTokens: 8192`、`compactionRetries: 1`、`maxOverflowRetries: 1` 以及 `auto: true`。選填的精確提供方/模型策略會部分覆蓋頂層預設值；壓力根據擁有該路由的 LLM 配接器所報告容量縮放比例，而 `retainTokens` 可以替代按比例保留。保留量必須低於最終閾值。收斂仍然是動態的，因為提供方輸出上限可能被隱藏或顯式的推理（reasoning）token 消耗，摘要大小也不可預測。如果壓力仍高於閾值，`compactIfNeeded()` 會按設定的重試次數再次壓縮頭部檢查點，但每次提交的摘要必須小於其遮蔽的內容。溢位不需要容量元資料，並會繞過閾值和保留尾部策略，執行一次最大且平衡的頭部縮減，留下最新的不可分割單元。所有權劃分由[已路由模型上下文與壓縮策略 Agent Note](../architecture/2026-07-20-routed-model-context-and-compaction-policy.md)規定。

### Surface 替換：`compaction/*` 事件僅存在於日誌；一條 `user/message` 承載摘要

由於 `SurfaceEventType` 是封閉的，摘要不能搭載在 `compaction/*` 事件上。後端改為追加**單條 `user/message`**，帶有 `source: COMPACT_CHECKPOINT_SOURCE` 和 `surfaceOp: { op: 'replace', start, end }`；其 `content` 是（帶框架的）摘要，`sourceEventSeqs` 覆蓋被遮蔽的條目*和*簿記事件。介面匯出該來源和 `isCompactCheckpointSource()`，使消費端無需相依性後端包身份，即可識別持久化或克隆得到的檢查點。`compaction/*` 事件記錄鎖、摘要、選中區間、被遮蔽的 seq、token 數和模型呼叫，但不加入 surface。surface 變更位於鎖**內部**，`compaction/end` 是最後追加的事件：

```
compaction/start    → log-only. Acquires the lock.
[summarize older range via the backend]
compaction/summary  → log-only. Records the raw summary, local-call marker, range, shadowed seqs, and token count.
user/message     → canonical checkpoint source + surfaceOp { op:'replace', start, end }.
                   THE surface mutation (framed summary).
                   deriveMessages() renders it as a user-role message.
compaction/end      → log-only. Releases the lock (carries `error` on a recoverable failure).
```

`deriveMessages()` 隨後產出 `[summary_as_user_message, ...retained_entries]`。複用 `user/message` 是誠實的而非變通：摘要確實*是* user 角色的上下文。

### 檢查點框架 + 增量合併（後端私有）

基礎後端將摘要包裝為既定的檢查點上下文，並標記以便下一輪增量合併。原始摘要保留在 `compaction/summary` 上。框架是後端策略；seam 承諾由一條替換 user 訊息承載可能帶框架的摘要，並使用規範的檢查點來源。

### 透過日誌記錄的鎖實作阻塞，加上崩潰/可復原失敗的分類

`compaction/start … compaction/end` 事件對承擔兩項職責：

1. **可偵測的崩潰孤兒 + 已記錄的摘要輸入**（首要）。摘要生成是一次慢速模型呼叫，持久化在 `compaction/start` *之後*。摘要生成中途崩潰會留下一個沒有匹配 `compaction/end` 的 `compaction/start`——一個可偵測的孤兒。最後釋放鎖（而非最先）將崩潰視窗從*靜默損壞*轉變為可偵測的孤兒。
2. **防止並行壓縮。** 每個自動、手動和顯式範圍入口點都會拒絕活動的未匹配 `compaction/start`。該標記對就是唯一的鎖；沒有行程本機 mutex 重複承擔同一職責。

該鎖只排除另一項壓縮，不排除無關事實。其標記是時間點，而不是排他的容器，因此持久 inbox splice 可以出現在獨立手動 start 與 end 之間。自動工作要求其輪次內的整個 surface 保持穩定。手動工作只重新驗證所選位置 span，使其外部的僅附加上下文在替換後保持可見。

生命週期邊界使崩潰狀態含義明確：

- **當前生命週期：** 最新 `session/end-seed` 之後懸空的 `compaction/start` 是活動的持久鎖，並報告 busy。
- **後續生命週期：** 構造函式寫入的較新 `session/end-seed` 證明更早的未匹配 start 已過時，因此復原、fork 和接手不會被已死的寫入方持續卡住。
- **可復原失敗：** start 落地後，後端會恰好嘗試一次 `compaction/end { error }`。摘要或穩定性失敗會保持工作階段 surface 不變，同時在日誌中保留失敗嘗試。如果追加閉合事件失敗，未匹配 start 會繼續有意阻塞。

`compaction/end` 保留其 `error?` 欄位（與 `tool/result` 的自包含錯誤一致——一個事件即可區分成功與失敗，無需關聯兄弟事件）。沒有單獨的 `compaction/error` 事件。

**核心工作階段修復保持對壓縮無感知——這是有意為之。** `interruptedTurnClosers` 從不被教導 `compaction/*`。通用 `session/end-seed` 生命週期邊界提供壓縮所有者所需的證據；壓縮不變數與後端負責解釋它，無需向核心新增外掛程式專屬修復。

## 曾考慮的替代方案

- **完整演算法作為介面的具體方法**——否決，因為它將約定重新耦合到一種保留策略。三個操作都是抽象的；可複用測量屬於單獨的 LLM 系列服務，`summarize()` 是 basic 唯一的掛鉤。
- **在 `agent/request` 或壓縮專屬的 loop 回呼上執行壓縮**——否決，因為前者觀察的是臨時請求，後者會將通用生命週期耦合到壓縮策略。對先前持久請求進行 pre-step 重播，再加上規範溢位復原，即可覆蓋成功和被拒絕的呼叫。
- **`compact` 布林值或無類型的請求元資料 map**——否決，因為多個輔助呼叫種類會變成互斥標志，而開放 map 會丟棄由編譯器檢查的詞彙。一個類型化的 `purpose` 判別欄位可以擴充其他呼叫種類，而無需再為 `GenerateOptions` 新增欄位。
- **單獨的 `compaction/error` 事件**——否決：`compaction/end` 保留 `error?` 欄位，與 `tool/result` 的自包含錯誤一致——一個事件即可區分成功與失敗，無需關聯兄弟事件。
- **教導核心輪次修復識別 `compaction/*`**——否決：通用 end-seed 邊界已經能夠區分先前生命週期的歷史；為每個未來的 `xxx/start … xxx/end` 事件對修補核心模組，恰好是能力 seam 架構存在的意義所要避免的耦合。

## 後果

- **包**：`packages/compaction/compaction` 提供介面，`compaction-basic` 提供後端，`compaction-tool-result-pruner` 提供選填的確定性重寫，`command-compact` 提供面向使用者的 `/compact`。`packages/llm/token-meter` 獨立擁有重播感知的測量。
- **自動擴充點**：`agent/pre-step`（`@mode waterfall`）在請求派生前處理壓力，`agent/request-error`（`@mode waterfall`）處理失敗步驟關閉後的最終請求失敗。pre-step 的 payload 攜帶已領取批次、輪次、步驟與 signal（參見 [payload-object 事件決策](../architecture/2026-08-06-agent-event-payload-objects.md)），不攜帶壓縮專屬的提示詞/前綴 payload。
- **`SessionEventMap`** 透過可合併擴充的聲明合併獲得 `compaction/start` / `compaction/summary` / `compaction/end`；`SurfaceEventType` **未被**觸及。這些是工作階段事件，不是 cordis `Events`，因此事件分類閘門無需新增條目。
- **`dsh-compaction`** 擁有 `COMPACT_CHECKPOINT_SOURCE`、`isCompactCheckpointSource(source)`、`toolPairingBalancedBefore(session, seq)` 與 `toolPairingBalancedAfter(session, seq)`。該標記用於跨後端實作識別替換摘要。帶快取的 surface 邊緣檢查會防止 `compactRegion` 和 `compactIfNeeded` 拆分工具呼叫/結果對，按 seq 校驗當前成員關係，從每個切割點的一條平衡序列回答兩側邊緣，並拒絕過時或缺失的 seq 與孤立結果。
- **`dsh-session`** 透過唯一的 surface 管理器校驗位置替換、引用的來源事件是否覆蓋完整，以及僅內容的單節點 `tool/result` 重寫。其不變式配套外掛程式將新追加的工具結果視為執行，要求存在已打開的步驟與待處理呼叫，而壓縮配套元件負責維護數字輪次 owner 與獨立 `null` owner 事件對之間的關係。
- **接線**：`examples/tui-agent/cordis.yml` 依次載入零設定的 `dsh-token-meter`、`dsh-compaction-tool-result-pruner`、`dsh-compaction-basic`，然後載入 `dsh-command-compact`；服務級預設值使組合無需重複數值策略即可使用。

## 測試

- **單元測試：** 使用真實 Loader 和 invariant 外掛程式覆蓋完整單元保留、修剪設定與重播、富塊順序、元資料保留、收斂、`compaction/end` 的兩種結果、開放尾部拒絕、僅修剪與帶摘要的溢位復原、generation 證明、上限和原始錯誤保留。
- **迴圈測試：** 測試固定 pre-step 發生在前一個 `step/end` 之後、下一個 `step/start` 之前，使用實際 `agent/request` 路由，關閉失敗步驟，分配新的重試編號，並覆蓋完整的拋出/帶內溢位 → 壓縮 → 重建重試組合。
- **手動測試：** 無需模型金鑰即可固定 maintenance 序列化、標記順序、注入保留、活動／過時未匹配標記分類、取消、閉合／flush 失敗、命令對映以及排隊 TUI 流程。
- **帶金鑰 e2e：** 真實模型和 bash 工作階段在降低的限制下觸發壓縮，記錄完整的 `compaction/start…end` 對，縮小 surface，並完成任務。
- **快照：** 組裝後的上下文溢位場景僅在 `llmStreamCall: true` 證明本機 LLM 服務執行了輔助呼叫時，才從 `compaction/summary` 派生該呼叫；規範重建的塊在不固定提供方增量切分的情況下固定完整復原過程。
