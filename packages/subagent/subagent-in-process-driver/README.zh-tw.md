# @deepseek-ai/dsh-subagent-in-process-driver

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

本包是兩個行程內提供方共用的執行驅動器。spawn 不傳入工作階段初始內容；fork 傳入父 agent（代理）已完成輪次的前綴。其餘機制，包括深度、子 agent 建立、選填的子 agent 訂製、結果讀取、取消和 dispose（資源釋放），都在此共用同一套實作。

## 啟動約定

`startInProcessRun(request, options): Promise<SubagentRun>` 只在子 agent 發布到 `ctx.agents` 後才兌現。啟動被拒絕時，agent 工廠的未發布建立交易已經完全靜止，因此呼叫方絕不會收到建立到一半的控制代碼。

驅動器按以下順序執行：

1. 校驗父 agent 深度和選填的絕對 `maxDepth`，然後把子 agent 深度推導為父 agent 深度加一，並將其持久化到子 agent 工作階段 header。
2. 直接呼叫 `parent.ctx.agents.create`，把必需的請求訊號傳入工廠的建立交易。
3. 在該交易未發布的設定視窗中，安裝請求的 persona、工具限制和結構化輸出執行時期。
4. 發布子 agent，保留返回的 `AgentHandle`，並透過先呼叫 `child.followup(prompt)`、再呼叫 `child.whenIdle()` 來驅動一項任務。
5. 從完整的自有子執行中讀取子 agent 自身的輸出——最後一條非空 assistant 訊息（記錄 usage 的空內容訊息會被跳過），若沒有這類訊息則取其累積的 assistant 文字——以及最終持久化的輪次原因，並排除任何 fork 初始內容。

子 agent 會獲得父 agent 的工作目錄／工作階段譜系；除非 `request.agentOptions` 覆蓋，否則還會繼承父 agent 的提供方、模型和輸出 token 上限。它獲得全新的扁平註冊作用域：父級所有權不會匯入父 agent 的工具限制，也不會建立權限子集。

該結果邊界成立，是因為提供方擁有從發布到完全靜止的隔離子 agent 生命週期。在該生命週期內提交的 steering（中途引導）屬於子執行；提供方不會聲稱輸出只歸初始 follow-up 所有。

驅動器透過共享的子 agent 輔助函式應用該 seam 的[委派策略](../subagent/README.md#delegated-policy)：它會在建立子 agent 前捕獲父級的顯式沙盒覆蓋項與 `'never'` 審批釘定，並在未發布的設定階段追加帶來源標記的事件，使其位於所有 fork 歷史之後、工作階段發布之前。參見[委派策略決策](../../../.agents/notes/implemented/feature/2026-07-25-subagent-policy-inheritance.md)。

## 取消與所有權

必需的請求訊號同時覆蓋啟動階段和即時執行。發布前，`AgentCreationTransaction` 會觀察該訊號、回滾並拒絕。工廠返回前會移除僅用於建立階段的監聽器；驅動器隨即再次檢查訊號，然後安裝最小化的即時執行監聽器，從而消除交接競態。發布後，中止會取消子 agent。

兌現後，呼叫方擁有該執行。提供方外掛程式解除安裝不會撤銷它。`dispose()` 會移除即時中止監聽器、記錄取消，並委託給返回的 `AgentHandle.dispose()`；後者透過經記憶化的完全靜止交易停止迴圈、移除 agent 和工作階段，並撤銷作用域內的註冊。取消流程會接管所有尚未完成的進行中結果，並將其報告為 `aborted`；已經完成的輪次仍保持完成狀態。

## spawn 與 fork 輸入

`InProcessRunOptions` 的形態為 `{ seed?: SessionEvent[] }`。spawn 省略該值。fork 提供已配平的已完成輪次前綴，並記錄其長度，確保結果讀取器不會把作為初始內容的父 agent 訊息誤認為子 agent 輸出。

深度強制在 `startInProcessRun` 內部完成：它透過 `delegationDepthOf` 讀取父 agent 深度（持久化的 `SessionHeader.delegationDepth` 具有權威性；執行時期 `AgentOptions.subagentDepth` 可以加深但絕不能降低該值，因此復原後的子 agent 會保留預算），缺失值按頂層深度零處理，拒絕格式錯誤的儲存值，並報告嘗試的子 agent 深度超過 `maxDepth`。超過安全整數範圍、無法表示的深度會觸發 `RangeError`。子 agent 深度寫入子 agent header，因此會在持久化和復原後保留。

## 結構化輸出

`attachStructuredRuntime(childCtx, schema)` 會在子 agent 作用域中安裝完整約定：

- 使用請求 schema 註冊的 `structured_output` 工具會校驗並暫存模型值。
- 一個順序為 190 的系統提示詞段會告訴子 agent，該工具呼叫就是終態答案。
- 兩項貢獻都是普通的子 agent 作用域註冊。專家級 `system-prompt/assemble` 監聽器可以替換它們，因此負責為該子 agent 保留結構化輸出協議。
- `tools/result` 觀察器只會在該次執行的權威最終工具結果成功後提交暫存值；Code Mode 子分派外層的 `run_code` 結果也包括在內。
- 單調工具防護會在捕獲值後阻止後續呼叫，結構化輸出執行的 `concludeTurn()` 標記則在結果提交後結束輪次。

正常結束卻始終未提交必需結構化值的輪次會報告 `error`；驅動器不會重新提示。所有註冊都附著於子 agent fiber，並隨其一同消失。

## 模型體驗

### 子 agent 請求

#### 模型看到的內容

共享驅動器把任務逐字作為子 agent 的使用者訊息傳送；若有請求，還會在未發布子 agent 的全新作用域中遮蔽 persona，並限制全域性工具 schema、尋找、執行和 Code Mode SDK 綁定。父 agent 的限制不會被繼承，獨立的工具指導段仍會保留。spawn 不提供歷史；fork 提供平衡的初始內容。

#### Token 影響

子 agent 輸入與父 agent 隔離，並透過子 agent 自身的步驟成長。persona 會改變重複提示詞文字；過濾會改變 schema 或生成 SDK 的成本，但不影響獨立註冊的指導內容。

#### KV Cache 影響

與父 agent 請求快取相互獨立。子 agent 後續歷史僅附加，而 persona、工具過濾、生成 SDK、提供方或模型變化會建立不同的子 agent 前綴。

### 結構化輸出系統提示詞、schema 與結果

#### 模型看到的內容

結構化執行會新增下方的結構化輸出指令。它還會新增子 agent 作用域的 `structured_output` 定義，其精確描述為 `Report your final structured result. Call this exactly once, when your answer is complete; the arguments must match this tool's parameter schema exactly.`，參數使用請求的 schema。該僅執行時期存在的定義不在已生成並隨產品發布的[工具包索引](../../../docs/tool-catalog.md#tool-package-map)中。其規範確認值是 `{ recorded: true }`，渲染為 `Structured output recorded.`；後續呼叫會變為 ``Error: structured output already recorded: the run is complete, so `<tool>` is not executed``。

##### 結構化輸出指令

```markdown
When you have your final answer, you MUST report it by calling the `structured_output` tool with arguments matching its parameter schema exactly. Do not finish with a plain text answer: only the tool call counts as your result.
```

#### Token 影響

固定指令和能力產生的 token 開銷僅由該子 agent 承擔。結果文字進入子 agent 歷史，而只有捕獲的值會成為父 agent 結果。

#### KV Cache 影響

只要結構化輸出指令和 schema 不變，子 agent 內部的前綴就保持穩定。更改 schema 或能力可能從該早期片段開始使子 agent 快取失效；結果會分別追加到子 agent 和父 agent 歷史中。

### 父 agent 啟動錯誤（間接）

#### 模型看到的內容

透過 `dsh-tool-subagent`，無效深度狀態會精確變為 `Error: agent subagentDepth must be a non-negative safe integer`、`Error: subagent child depth exceeds the safe-integer range` 或 `Error: subagent depth <attempted> exceeds maxDepth <max>`。發布前取消的中止原因會透過登錄檔的 `Error: <message>` 包裝傳遞。

#### Token 影響

啟動成功時為零 token；只有失敗的父 agent 工具呼叫會保留這段文字。

#### KV Cache 影響

僅附加；新增可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

### 父 agent 結果（間接）

#### 模型看到的內容

驅動器只提取子 agent 自身最後的 assistant 輸出或捕獲的結構化值；作為初始內容的父 agent 訊息和子 agent 中間工作不會成為結果。

#### Token 影響

父 agent 透過消費端接收一個相依性資料的結果；其他所有子 agent token 都留在子 agent 工作階段中。

#### KV Cache 影響

僅附加；新增可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **執行不公開 `sendMessage`/`resume`**：行程內執行不具備這些選填執行時期能力。
- **結構化捕獲只接受 `defineTool` schema 子集**：不支持的 JSON Schema 構造會在子 agent 建立前失敗；需要更廣 schema 詞彙的提供方必須採用不同的執行時期。
