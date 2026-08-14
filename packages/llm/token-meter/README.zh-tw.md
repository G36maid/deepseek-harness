# @deepseek-ai/dsh-token-meter

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

透過單例 `ctx.tokenMeter` 服務進行具備重播感知能力的 token 測量。它從持久日誌為每個工作階段推進一個隔離 fold，因此壓縮（compaction）與其他壓力敏感外掛程式可以共享計量，無需相依性 `CompactionEngine`。

## 設定

估算器沒有設定項。它有意使用一項固定啟發式規則：每個 token 按四個字元估算，再加上角色、塊與請求 envelope 欄位的結構開銷。任何設定鍵都會被拒絕；模型容量屬於擁有精確提供方／模型路由的配接器，可透過 `ctx.llm.resolveModelInfo().context` 取得。

## 測量約定

`ctx.tokenMeter` 直接公開兩個操作：

- `measure(session, requestHeader?)` 在同一個已消費日誌 revision 上返回請求壓力與當前已計價表層。
- `estimateMessage(message)` 使用固定啟發式規則為一則訊息計價。

`measure()` 會同步一次，並返回一個獨立且深度不可變的快照。`totalTokens` 是請求與回應壓力，`surfaceTokens` 是僅表層啟發式總量，等於 `nodes[].tokens` 之和。`requestHeader` 覆蓋隻影響壓力欄位；表層欄位仍描述當前工作階段。每次呼叫都會克隆帶位置的節點，因此測量是 O(surface)。

fold 跟蹤完整請求標頭快照、步驟邊界、表層追加與替換、成功 assistant 訊息、提供方用量，以及每條 assistant 訊息引用的區塊 seq。只有當最新成功呼叫的規範請求 envelope 與已測量 envelope 匹配，且其總量不低於該呼叫的完整啟發式錨點時，才會複用提供方用量；後續成功會替換較早錨點。否則會對當前 envelope 與表層進行完整估算。表層變更保持相對於匹配錨點的帶符號值，包括縮減替換後的負 delta。

用量計量會求和不重疊的輸入、cache-read、cache-write 與輸出 bucket；不會再次新增推理（reasoning）。每次成功呼叫都會記錄一個 assistant 錨點，包括無內容呼叫。顯式的空 `sourceEventSeqs` 清單表示已知空提供方流；殘留記錄缺少該清單時，fold 會保守地將持久 assistant 輸出視為提供方輸出。

## 工作階段投影

當組合提供 `ctx.sessionProjections` 時，token-meter 會透過一個選填子 fiber 註冊三個單元。

`tokenUsage` 攜帶完整持久日誌中的 `uncachedInputTokens`、`outputTokens`、`cacheReadTokens` 和 `cacheWriteTokens`。即使請求隨後失敗，用量區塊仍會計入；同一 `(turn, step)` 的最終 assistant 訊息用量會替換該樣本，而不是重複計數。推理仍是輸出的一個細分項。只保留單個最新樣本，相依性的是工作階段日誌的一條順序性質：一旦某個更晚的步驟報告了用量，合法日誌就絕不會再為更早的步驟報告用量。

`contextPressure` 攜帶選填的 `pressureTokens`（提供方報告的最新提示詞規模，為未快取輸入加快取讀取與寫入之和）、選填的 `projectedTokens`，以及來自最新一條 `request/context` 記錄的選填 `contextWindow`。提供方報告用量前兩個數字都保持缺失；路由配接器未公佈容量時容量也保持缺失。輸出不計入其中，因此輪次流式輸出期間 `pressureTokens` 保持不動，等到下一個請求報告用量時才前進。

`projectedTokens` 是「下一個請求的提示詞要花多少」：在該樣本之上，加上自取樣以來表層增減部分的啟發式重新計價，下界鉗制為零，摺疊走的是測量服務重放的同一份 `surface-fold.ts`。只有增量部分是估算的，因此這個數字既錨定在提供方讀數上，又能在內容落地——或壓縮遮蔽一段區間——的瞬間做出反應。最後這種情況正是該欄位存在的理由：壓縮透過直連的 `ctx.llm.stream()` 呼叫生成摘要，自身不追加任何用量，所以僅憑 `pressureTokens` 會一直報告壓縮前的提示詞規模，直到再完成一整個輪次為止。佔用率展示讀取 `projectedTokens`。

`contextBreakdown` 攜帶啟發式的 `systemTokens`、`toolsTokens` 與 `messageTokens`，描述上下文的組成而非提供方計費規模。envelope 數字在每條 `request/header` 上按後者勝重新計價；訊息數字重放 `surface-fold.ts`——也就是 `measure()` 執行的同一個帶位置 fold——因此它在每個事件邊界上都等於 `measure().surfaceTokens`，壓縮會像縮小下一個請求那樣縮小它。三個數字都使用測量服務的固定啟發式規則，屬於估算值：它們加起來不等於 `projectedTokens`——後者的提供方錨點所體現的恰好是這些明細行仍然帶著的誤差（按「4 字元 ≈ 1 token」計價，CJK 文字與 JSON schema 會被嚴重低估）。請把它們當作近似的**組成**呈現，而不是總量。

三個單元都使用標準的投影基線、即時幀、seq 高者勝值倉和 JSON 檢查點路徑。解除安裝 token-meter 會移除這三個鍵。不帶投影 seam 的組合會保留測量服務的既有行為。

### 上下文佔用率是刻意為之的近似值

這些佔用率欄位各自後者勝、彼此獨立，**不是**對單個請求的一次原子觀測。切換模型時，新容量會與上一路由的樣本配對，直到下一個請求報告用量為止；而 `pressureTokens` 描述的是最後一個請求，不是此刻的表層——`projectedTokens` 把該樣本沿表層的增減推進到當下，但它的錨點仍然是那個較早的請求。

這是刻意的選擇。佔用率百分比是面向使用者的參考數字，既不是計費記錄，也不是門控輸入：harness 中沒有任何環節依據它做決策，壓縮改為直接讀取 `measure()`。UI 用測得的壓力除以為所選模型單獨解析出的容量來計算佔用率。

[Agent Note](../../../.agents/notes/implemented/architecture/2026-07-29-projected-token-usage-and-request-context.md) 記錄了否決「讓這對值保持原子」方案的那次對比。需要同一邊界精確數字的消費端應在自己的請求邊界呼叫 `measure()`，而不是讀取該投影。

## 組合

```yaml
- name: '@deepseek-ai/dsh-token-meter'
- name: '@deepseek-ai/dsh-compaction-basic'
```

兩個外掛程式都有可用預設值。meter 保持與模型路由和選填壓縮無關。部署會在 LLM（大型語言模型）配接器上設定容量，並在 `dsh-compaction-basic` 上設定壓縮策略。

## 模型體驗

透過 `dsh-compaction-basic` 等消費端間接影響；該服務自身不新增提示詞、訊息、schema、工具或模型呼叫。

#### KV Cache 影響

不會直接失效；請求前綴變更由上述消費端負責。

## 已知限制與暫緩事項

- **固定啟發式規則是近似值**：沒有可複用提供方用量的內容按字元數加結構開銷計價，而不是使用精確提供方 tokenizer 或請求 serializer。
- **每次測量都會克隆當前表層**：一致且不可變的快照使讀取成為 O(surface)，包括低於閾值的壓力檢查。
- **提供方用量只能為完全相同的規範 envelope 複用**：提示詞、前綴、工具、提供方、模型或呼叫設定變更都會有意回退到完整啟發式估算。
- **保守處理缺少源事件 seq 的殘留記錄**：沒有 `sourceEventSeqs` 的 assistant 訊息無法區分提供方輸出與 listener 改寫，因此 fold 不會聲稱已知空流或精確區塊流。
