# Agent Note: 呼叫後壓縮壓力與上下文溢位復原

Status: implemented

[English](2026-07-10-after-call-compaction-pressure-and-overflow-recovery.md) | [简体中文](2026-07-10-after-call-compaction-pressure-and-overflow-recovery.zh.md) | 繁體中文

## 問題

`agent/pre-step` 執行在最終請求路由之前，也早於 assistant 輸出、工具結果、緩衝上下文與 steering（中途引導）的產生。即使它接收已裝配提示詞與工作階段前綴，壓力檢視表仍是臨時的，因為 `agent/request` 還可以改變路由或呼叫設定，工具 schema 也沒有與這些輸入一同凍結。增加欄位無法讓呼叫前狀態描述已完成呼叫，還會把通用擴充點與壓縮（compaction）耦合。

成功呼叫也不是唯一的壓力訊號。提供方可能在返回 usage 之前就因上下文視窗超限拒絕請求，一些成功呼叫也不提供 usage。因此，系統需要可重播的呼叫後壓力，以及一條狹窄的失敗復原路徑；當壓縮無法證明取得有效進展時，必須保留原始提供方錯誤。

## 決策

### 成功壓力在下一個 pre-step 邊界執行

`agent/pre-step` 接收獨佔的已領取消息批次與 `{ turn, step, signal }`，並返回最終 reject/enter 決策。它不攜帶壓縮專用的提示詞或前綴欄位。

Compact-basic 會在每個擬議請求之前包裝 `agent/pre-step`。在續步邊界，前一條 assistant 輸出、所有已分發或合成的工具結果、工具後上下文與 steering 都已經持久化，因此壓力策略能看到完整的成功呼叫狀態，同時不會拆開 assistant 工具呼叫與其結果。初始邊界上的無 header 工作階段尚無已完成路由請求，因此不執行壓力工作。Compact-basic 會在內部處理操作性失敗、寄出警告並繼續委託，不會 reject 擬議步驟。

`dsh-compaction-basic` 從持久請求標頭讀取精確的最新實際路由模型，只用它確認已經存在已完成的路由，隨後讓單例 `ctx.tokenMeter` 計量規範日誌信封與當前表層。自動壓力不會回退到 `AgentOptions.model`。沒有請求標頭的工作階段尚無已完成路由請求可供判斷，因此不執行工作；任意持久記錄的非空模型名都使用同一個估算器。操作性的計量或摘要失敗會發出警告，並從最新持久表層繼續：任何替換發生前使用完整歷史；若剪枝已經落盤，則使用已剪枝表層。

### 請求復原只覆蓋最終模型邊界

`agent/request-error` 表示來自最終配接器邊界的終止失敗。配接器選擇、分發、iterator 構造與迭代拋出會在 agent loop（代理循環）消費前成為終止 `error` 或 `aborted` finish；配接器直接寄出的終止 finish 進入同一路徑。提示詞裝配、請求 middleware、請求日誌、結果處理、工具、step 監聽器與清理仍屬於普通失敗。[LLM（大型語言模型）流的終止失敗](2026-07-29-terminal-llm-stream-failures.md)規定這一規範化邊界。

復原執行前，失敗 step 已經關閉。負責處理的監聽器修復持久狀態、返回 `{ kind: 'retry' }`，並停止 waterfall（瀑布式事件）委託。迴圈隨後關閉失敗 turn，並從持久日誌開啟一個重試 turn，中間不發布空閒通知。重試策略與嘗試計數由外掛程式自己擁有；compaction-basic 在鏈路到達終態 `agent/settled` 時清除對應 agent 的溢位計數。兩個 DeepSeek 配接器都把識別出的提供方上下文限制錯誤規範化為 `CONTEXT_WINDOW_EXCEEDED`。[重試動作決策](../simplification/2026-07-27-request-error-retry-action.md)規定這一返回邊界。

如果取消發生在 assistant 工具呼叫已經持久化之後、所有呼叫完成分發之前，迴圈會為每個尚未分發的呼叫記錄一對合成的 `tool/call` 與 aborted `tool/result`，隨後進入正常中止路徑。因此，表層不會僅因取消贏得競態而留下孤立的持久工具呼叫。

### CompactionEngine 暴露意圖，而不擁有 token 覈算

`CompactionEngine.compactIfNeeded(agent, trigger, signal)` 接收 `trigger: 'pressure' | 'context-overflow'`。介面不增加估算方法或 token 類型；`ctx.tokenMeter` 繼續作為可複用的覈算所有者。

對於 `pressure`，compaction-basic 先解析持久提供方/模型目標對應配接器所維護的容量與精確目標策略，再把得到的閾值與保留尾部預算應用到一次統一的 `ctx.tokenMeter.measure()` 結果。未達到壓力閾值時直接返回，不執行剪枝。壓力達到條件後，選填的 `ctx.toolResultPruner` 會改寫當前表層中過大的工具結果，compaction-basic 再透過同一個 meter 重新計量；若壓力已降至安全水準則跳過模型呼叫，否則從已剪枝表層選擇範圍並生成摘要。範圍定價、引用的源事件計量、被遮蔽 token 數與非縮小摘要拒絕也由同一個單例 meter 完成。通用預設值保持為閾值比例 `0.8`、保留歷史比例 `0.16`、摘要提供方/模型 `''`、`maxTokens: 8192`、`compactionRetries: 1` 與 `auto: true`；選填 `modelPolicies` 項可以按精確提供方/模型組合覆蓋這些值。

對於規範化溢位，compaction-basic 不要求容量元資料，並繞過標量壓力與普通保留 token 預算。它先執行剪枝，再在保留最新不可分割單元的同時選擇最大的工具配對平衡頭部範圍；存在範圍時，纔在同一 signal 下嘗試一次縮小摘要壓縮。自動監聽器先對 `session.surface.replaceGeneration` 建立快照，剪枝或摘要讓 generation 增加時就返回 `{ kind: 'retry' }`。即使剪枝先落盤而後續摘要工作拋錯，這條規則仍然成立；取消依然優先。後端若只返回結果但沒有替換表層，不能授權重試；只有剪枝取得進展時，即使沒有 `CompactionResult` 也可以授權重試。

`maxOverflowRetries` 選填且預設為 `1`；`0` 只停用溢位復原，不會停用壓力檢查。`auto: false` 不註冊任何自動監聽器。非規範化錯誤、嘗試耗盡、已經中止的 signal、缺失路由模型、沒有安全範圍、generation 未變化，以及在任何替換之前復原拋錯，都會委託給下一個監聽器。若沒有後續復原，迴圈報告原始提供方錯誤對象與程式碼。generation 增加後的復原拋錯會基於持久進展授權重試；即使復原工作並行完成，取消或 dispose（資源釋放）仍具有最終優先級。

默認摘要器依次解析顯式設定、最近記錄的路由與 agent options。因為直接 `llm/stream` 中介軟體可以重新路由該輔助呼叫，`compaction/summary.{provider, model}` 記錄分發後觀察到的可變 `GenerateOptions` 最終目標，而不是 waterfall 之前的候選值。

## 測試

單元測試覆蓋最終配接器規範化邊界、已關閉 turn 的重試編號與重設、取消與 dispose、step 邊界順序、已路由信封壓力、壓力門控剪枝、剪枝獨立解除壓力、從已剪枝輸入生成摘要、平衡溢位縮減、後續失敗前已落盤的剪枝進展、generation 證明、上限、委託與輔助呼叫路由。真實迴圈測試覆蓋拋出式和帶內溢位在經剪枝或摘要壓縮後重建重試請求的過程。

## 考慮過的替代方案

- **向 pre-step 增加壓縮專用欄位**——不予採納，因為規範持久工作階段與 token meter 已擁有計量輸入；通用生命週期不需要攜帶第二份信封。
- **重試相同編號的 step**——不予採納，因為復原會在失敗邊界之後追加持久事件。新 step 保持平衡巢狀與可重建性。
- **只要 `compactIfNeeded` 返回結果就重試**——不予採納，因為自訂後端可能報告成功卻沒有改變模型可見狀態。`replaceGeneration` 纔是權威證明。
- **讓 compaction-basic 解析提供方措辭**——不予採納，因為分類屬於配接器，而且必須同時覆蓋拋出式與帶內交付。
- **沒有持久路由時回退到 `AgentOptions.model`**——不予採納，因為自動策略必須描述已完成且已記錄的請求。沒有請求標頭的壓力檢查與復原會原樣委託。

## 後果

下一個 pre-step 的壓力檢查描述前一個已完成的路由請求，包括持久工具結果與新領取輸入。選填的無模型剪枝會在選擇摘要前移除可預測的工具輸出體積，也能獨立產生足以重試的進展。當成功 usage 錨點不存在時，規範化溢位提供兜底路徑。復原有明確上限、以取消為準，並保持單調：只有模型可見的表層 generation 變化後才重試。

代價是在共享 pre-step waterfall 中執行壓力工作，並需要配接器持續維護溢位分類。提供方措辭與啟發式字元密度仍是維護風險。表層壓縮依然無法修復僅信封本身就超出視窗的情況，也不能拆分不可分割的非工具節點，或修復不可剪枝的剩餘部分仍然過大的工具單元。若可移除的文字工具結果是主要體積，選填剪枝器仍可修復原本不可分割的工具配對。

[已領取 pre-step 生命週期](2026-07-31-claimed-pre-step-inbox-lifecycle.md)取代了本記錄原先的 post-step 觸發方式。服務拆分、獨立 token meter、平衡範圍約定、日誌中記錄的鎖、摘要替換與唯一 `summarize()` 子類 hook 均保持不變。
