# dsh-tool-call-timeout-policy

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

工具呼叫逾時強制執行器：單個 `tools/execute` 環繞分發監聽器，會在 `exec.signal` 上設定單次呼叫的協作式截止時間；適用於聲明瞭 `timeoutMs` 且聲明位於其 `ToolDefinition` 上的工具。該截止時間先到時，它返回結構化 `TOOL_TIMEOUT` 結果。預算從工具自身的聲明中讀取（`ToolDefinition.timeoutMs`，由擁有該工具的外掛程式設定），因此此外掛程式是**零設定**的。它是 `tools/execute` 包裝層的參考實作，也是面向模型工具呼叫預算的強制執行歸屬地（[逾時庫 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md)）。

## 外掛程式（命名空間：`timeout-policy`）

它是函式／命名空間外掛程式（`name`／`inject`／`apply`），而非服務。它不註冊工具，也不接受設定；它消費 `ctx.tools` 的 `tools/execute` waterfall（瀑布式事件）（由 `dsh-tools` 登錄檔始終提供），並讀取每個已分發工具聲明的 `timeoutMs`；該聲明來自登錄檔（`ctx.tools.get(exec.name)`）。

```yaml
- id: timeout-policy
  name: '@deepseek-ai/dsh-tool-call-timeout-policy'
```

每工具預算由工具外掛程式聲明（例如 `dsh-tool-web` 的 `fetchTimeoutMs`／`searchTimeoutMs` 設定，會附加為 `ToolDefinition.timeoutMs`）；此外掛程式只負責強制執行，因此不可能拼錯工具名。

### 行為

對 **聲明瞭 `timeoutMs` 的工具**，監聽器會：

1. 從登錄檔中的工具自身聲明（`ctx.tools.get(exec.name)?.timeoutMs`）讀取預算，並設定 `deadline(exec.signal, timeoutMs, 'TOOL_TIMEOUT')`：一個將呼叫方中止與此外掛程式計時器融合的訊號（`@deepseek-ai/dsh-timeout`）。
2. 將該派生訊號替換到 `exec` 上用於下游分發，然後復原呼叫方自身的訊號（Cordis `next()` 忽略傳入的參數，因此包裝層會原地修改共享 `exec`；復原可使 `tools/post-execute` 看到呼叫方的訊號）。
3. 分發後，如果 `timeoutOf(d.signal, 'TOOL_TIMEOUT')` 偵測到此外掛程式自身的計時器已觸發，則將結果替換為結構化 `TOOL_TIMEOUT` 工具結果：`{ isError: true, error: { message, info: { name: 'ToolTimeoutError', code: 'TOOL_TIMEOUT' } }, content: 'Error: tool call timed out after <ms>ms' }`。

**未聲明預算的工具** 會原樣委託（不啟動截止時間）。

基礎 `next()` 是登錄檔為 `tools/execute` 提供的、帶規範化處理的分發 thunk，因此當逾時訊號到達拋出自身上游中止錯誤的提供方時，分發會先將其轉換為普通錯誤結果，再由此包裝層替換為 `TOOL_TIMEOUT`。這一順序就是替換依據訊號（`timeoutOf`）而非已分發結果形狀的原因。

### 協作式，而非硬終止

派生訊號只會**通知**；是否終止仍取決於工具及其將 `exec.signal` 轉發到的能力（`dsh-timeout` 庫本身不負責硬終止）。**因此，聲明 `timeoutMs` 意味著「與 `exec.signal` 協作」**：忽略該訊號的工具不會在逾時時停止。只有轉發訊號的工具才應聲明該欄位；已交付的 `web_fetch`／`web_search`（透過 `ctx.web` 轉發給提供方）是參考實作。`TOOL_TIMEOUT` 無需工作階段事件以滿足可重建性：它是最終面向模型的 `tool/result`，已由迴圈記錄。

### 與其他 `tools/execute` 包裝層組合

多個 `tools/execute` 監聽器按 Cordis 註冊順序組合。與未來的重試／沙盒／指標包裝層一起使用時，註冊順序決形容詞義：「逾時覆蓋整個重試操作」（逾時註冊在外層），或「逾時覆蓋每次嘗試」（逾時註冊在內層）。

## 模型體驗

### 條件工具結果

#### 模型看到的內容

此外掛程式不新增提示詞或 schema。如果已聲明的截止時間先到，它會將提供方結果替換為 `Error: tool call timed out after <ms>ms` 與結構化 `TOOL_TIMEOUT`；否則原結果保持不變。

#### Token 影響

未逾時的呼叫不會增加 token。逾時會新增一條會被保留的簡短錯誤結果，並可防止體積更大、較晚返回的提供方結果進入上下文。

#### KV Cache 影響

僅附加；新可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **協作式，絕不是硬終止**：截止時間只透過 `exec.signal` 通知；忽略該訊號的工具不會在逾時時停止（參見「協作式，而非硬終止」一節）。
- **沒有統一預算**：只有聲明 `timeoutMs` 並將其放在 `ToolDefinition` 上的工具才會獲得截止時間；未聲明工具沒有登錄檔級預設值（已交付的 `bash`／`read`／`write`／`edit` 有意不聲明）。
