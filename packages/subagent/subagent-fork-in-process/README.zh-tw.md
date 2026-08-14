# @deepseek-ai/dsh-subagent-fork-in-process

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

fork 提供方會建立一個行程內子 agent（代理），並以父 agent 已完成的對話輪次作為初始內容。它與 spawn 共用全部執行機制；唯一的行為差異是工作階段初始內容。

## 初始內容邊界

subagent 啟動時，父 agent 當前的工具呼叫輪次仍未結束：其日誌包含 assistant 工具呼叫，但尚無匹配的工具結果或 `turn/end`。直接複製這份原始日誌會給子 agent 一個無效且不平衡的工作階段。

因此，fork 會計算截至最後一個 `turn/end` 的連續前綴。子 agent 能看到父 agent 所有已完成輪次，但看不到進行中的輪次。如果父 agent 尚未完成任何輪次，初始內容為空，子 agent 的行為與全新 spawn 相同。

初始內容只傳遞對話歷史。子 agent 仍會獲得全新的扁平註冊作用域；它不繼承父 agent 的工具限制或權限。

## 啟動與能力

`start(request)` 將已完成輪次的初始內容傳給 [`startInProcessRun`](../subagent-in-process-driver/README.md)，並等待子 agent 發布。共享驅動程式器負責取消、深度、訂製、結果讀取和 dispose（資源釋放）。

fork 聲明 `{ outputSchema: true, depthLimit: true, toolFilter: true, persona: true }`，與 spawn 相同。

## 設定

| 鍵 | 含義 |
|---|---|
| `providerName` | `ctx.subagents` 上的登錄檔名稱（默認 `fork`）。 |
執行生命週期、模型繼承與深度跟蹤均為共享行為，見 [`dsh-subagent-spawn-in-process`](../subagent-spawn-in-process/README.md)。

## 模型體驗

### 子 agent 歷史與包絡

#### 模型看到的內容

子 agent 先接收由父 agent 已配平的已完成輪次構成的表層前綴，再逐字接收新的任務內容。設定的 persona 會在子 agent 的全新作用域中遮蔽提示詞文字；工具限制會過濾其全域性協議 schema、可執行工具尋找和 Code Mode SDK 綁定，但不影響獨立的指導內容。父 agent 的工具檢視表與權限不會被繼承。選填的結構化輸出請求會新增僅屬於子 agent 的約定。父 agent 當前進行中的輪次會被排除。

#### Token 影響

fork 會把保留的已完成歷史複製到獨立的子 agent 請求中；隨後子 agent 獨立累積自己的 token。persona 會改變重複提示詞的成本，過濾會改變 schema 或生成 SDK 的成本，而首輪 fork 沒有繼承歷史。

#### KV Cache 影響

在提供方和模型相同的前提下，子 agent 可以複用繼承的逐位元組相同前綴。persona、工具過濾、生成 SDK 或路由變化可能在繼承歷史之前使複用失效；後續子 agent 歷史僅附加。因此隨附組合把本提供方綁定為 `backgroundMode: one-shot`：可繼續子 agent 還會額外攜帶作用域區域性的 `report` 工具及其提示詞 section，而這些增量位於繼承歷史之前，會使繼承歷史整體失效（見 [fork 保持 one-shot 的 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-10-fork-children-stay-one-shot.md)）。

### 父 agent 工具結果（間接）

#### 模型看到的內容

父 agent 只透過 `dsh-tool-subagent` 接收子 agent 自身的最終輸出，不接收繼承的前綴或中間工作。

#### Token 影響

父 agent 輸入會增加一個取決於資料的最終結果，並保留到壓縮（compaction）為止。

#### KV Cache 影響

僅附加；新增可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **初始內容是一次性快照**：子 agent 只能看到 fork 時父 agent 已完成的輪次，看不到父 agent 此後記錄的任何內容；不會即時共享上下文。
- **沒有任何隨附組合會建立可繼續的 fork 子 agent**：`prepareContinuable` 仍然實作完好，seam 也接受它，但每份隨附的 `cordis.yml` 都在 fork 委派工具上設定 `backgroundMode: one-shot`，因此該提供方的可繼續路徑沒有生產呼叫方。重新開放它需要子 agent 的系統提示詞與工具 schema 與父 agent 逐位元組一致，而這一點目前被 [`report` 返回通道](../tool-subagent-report/README.md)阻止。理由與重新開放條件見 [fork 保持 one-shot 的 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-10-fork-children-stay-one-shot.md)。
