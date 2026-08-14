# Agent Note: 規範工具輸出約定

Status: implemented

[English](2026-07-20-canonical-tool-output-contract.md) | [简体中文](2026-07-20-canonical-tool-output-contract.zh.md) | 繁體中文

## 問題

工具主體過去直接編寫面向模型的 `ContentBlock[]`，並可選擇將其與不透明的 `meta` 包裝在一起。因此，Native 模式的 Function Calling（函式呼叫）雖然擁有可供人閱讀的投影，但程序化呼叫方沒有穩定的領域值：Code Mode 會將內容區塊重新展平為字串，動態工具會重複定義內容形態，策略也可以替換展示內容，卻無法區分這項變更究竟是替換展示，還是替換操作結果。多個能力 seam 已經返回了資訊更豐富的提供方值，卻又在面向模型的工具邊界丟棄這些值。

持久工作階段約定將這份展示內容視為重播時的權威來源，但如果持久化每一個資訊豐富的中間值，就會擴大日誌、使實作資料進入壓縮（compaction）和遷移流程，還會錯誤地把執行期本機 API 變成工作階段格式的一部分。因此，系統底層需要在執行期間保留一個類型化值，並顯式將其投影為現有的持久化內容和模型可見內容。

## 決策

每個工具都必須聲明規範輸出，並且只能返回該聲明描述的值：

```ts ignore-check
output: {
  schema: OutputSchema
  render(args, value): ContentBlock[]
  presentationMeta?(args, value): JsonValue
}
```

`defineTool` 從統一的 `ValueSchemaSpec` 推導工具主體回傳值和兩個投影器的類型。原始定義和動態定義則提供編譯後的 `JsonSchemaNode` 形式。註冊時會拒絕缺失輸出聲明或採用不受支持的原始 schema 的定義，不提供相容舊式內容回傳值的路徑。

每次成功分發時，登錄檔會將回傳值快照為無損 `JsonValue`，依據 `output.schema` 校驗並深度凍結，然後呼叫純渲染器；對於直接的外層呼叫，還會呼叫選填的元資料投影器。渲染器、投影器、schema 或無損 JSON 處理失敗都會被收斂為普通 `ToolOutputError` 結果。圍繞 `tools/execute` 的包裝層接收並返回規範的成功／失敗聯合；包裝層自行產生的成功結果會再次透過已解析工具的輸出聲明完成歸一化，而不會信任其獨立編寫的內容。每個規範結果都與建立它的不可變分發 token 綁定；因此，如果包裝層返回來自其他呼叫或工具的快取結果，系統會依據當前生效的輸出聲明重新執行歸一化，而不會繞過這一步。

```ts ignore-check
type ToolExecutionResult =
  | { isError: false; value: JsonValue; content: ContentBlock[]; meta?: JsonValue; additionalContexts?: HookContext[] }
  | { isError: true; error: { message: string; info?: { name: string; code: string } }; content: ContentBlock[]; meta?: JsonValue; additionalContexts?: HookContext[] }
```

`tools/post-execute` 為成功結果提供兩種互斥的投影方式。替換 `content` 只改變 Native／模型展示，並保留規範值和元資料。替換 `value` 會重新校驗替代值，並重新計算兩份展示投影。阻止操作會移除值並轉為失敗。因此，替換內容並不是保密機制：必須阻止程序化訪問的策略，應當阻止呼叫或替換值。

規範值僅存在於執行期間。agent loop（代理循環）持久化的 `tool/result` 只包含 `content`、`error` 和選填的 `meta`；Code Mode 的 `tool/code-dispatch` 持久化子呼叫渲染後的 `content` 與 `isError`。兩個事件都不儲存規範中間值，因此重播可以重現展示，卻無法重建程序化結果。當工具聲明 `presentationMeta` 時，系統只會為直接的外層呼叫計算它；巢狀 Code 分發沒有元資料或結果卡片。外層 `run_code` 卡片則讀取最終的 post-policy 內容，並且不聲明展示元資料。通用以及工具自有的 spill 投影同樣跳過巢狀分發，因為它們的規範值永遠不會進入模型上下文。

第一方工具在保持現有 Native 文字不變的同時返回領域 DTO：

| 工具系列 | 規範值 |
|---|---|
| `read` | `{ path, offset, lines: [{ number, text }], totalLines }` |
| `write` | `{ path, operation: "create" | "update", before: string | null, after }` |
| `edit` | `{ path, before, after }` |
| `glob` | `{ paths: string[] }` |
| `grep` | `{ matches: [{ path, lineNumber, line }] }` |
| `web_search` ／ `web_fetch` | 歸一化後的 `WebSearchResult` ／ `WebFetchResult` |
| `lsp` | `{ kind: "locations", locations, resolvedWorkspaceUri }` 或 `{ kind: "hover", hover }` |
| `bash` | `{ kind: "background", jobId }` 或 `{ kind: "foreground" } & ShellRunResult` |
| `terminal_open` ／ `terminal_list` ／ `terminal_send` ／ `terminal_read` ／ `terminal_signal` ／ `terminal_close` | 公開工作階段快照、有界的讀取／傳送 DTO、訊號／關閉操作結果，或背景工作控制代碼 |
| `job_output` ／ `job_list` ／ `job_kill` | 不含所有者或通知管理資訊的公開任務快照 |
| `subagent` | 背景工作控制代碼或 `{ kind: "foreground", runId, output: JsonValue[] }` |
| `workflow` ／ `ralph` | `{ runId, agentsStarted, result: JsonValue }` |
| `skill` | `{ name, provider, resourceBase?, content }` |
| `todo_write` | `{ todos, counts }` |
| `ask_user_question` | `{ answers: [{ id, selected, custom? }] }` |
| `exit_plan_mode` | `{ approved: true }` |
| `cordis_inspect` ／ `cordis_mount` ／ `cordis_unmount` | 檢查文字或類型化的臨時外掛程式控制代碼 |
| `structured_output` | `{ recorded: true }` |
| `run_code` | `{ logs: string[], result?: JsonValue }` |

提供方和執行器的採集上限仍會實際限制規範值。僅用於格式化的限制歸 `render` 所有；例如，`glob` 和 `grep` 會在 `value` 中保留所有已採集項，而其 Native 投影會保留設定指定的第一頁，並盡力將其寫入 spill 文件。通用 spill 會前置註冊其 post-execute 監聽器，並讓該監聽器先向後委託，因此無論外掛程式載入順序如何，普通工具自有的非同步投影都會在通用位元組數上限處理之前完成。檔案系統變更工具根據 `args` 和規範的變更前／後值推導可重播的 diff 元資料，不再由工具主體返回 UI 狀態。

MCP 橋接層透過 `McpResult<{...}> = { content: JsonValue[]; structuredContent? }` 保留協議內容區塊。當公佈的 `outputSchema` 屬於受支持的原始子集時，系統會強制校驗；不受支持的 schema 則回退為 `JsonValue`，而不會假裝已完成校驗。Native 渲染仍使用現有的 MCP 到 `ContentBlock` 投影，MCP `isError` 則會變為失敗的工具結果。

## 備選方案

- **向 Code Mode 返回渲染後的文字：**不予採納。呼叫方仍需從自然語言中提取 job id、掛載 id、路徑和結構化提供方結果。
- **在 `tool/result` 上持久化規範值：**不予採納。巢狀執行值不屬於模型歷史記錄，無需在重播後繼續存在；持久化還會引入與 Native 重建無關的工作階段格式和儲存承諾。
- **允許工具同時回傳值和內容：**不予採納。由作者分別維護的兩份結果可能互相矛盾，策略也無法說明哪一份纔是權威結果。渲染器會根據已校驗值確定性地產生展示。
- **將內容替換視為值脫敏：**不予採納。展示內容和程序化訪問面向不同消費端；只隱藏前者會製造虛假的安全邊界。
- **要求工具輸出必須以對象為根：**不予採納。標量、陣列和 null 結果都是合理的 JSON API。只有由呼叫方定義的 subagent／工作流程結構化輸出仍受消費端的對象根規則約束。

## 影響

Native 和重播行為仍以內容為先，並保持逐位元組相容；執行期呼叫方則無需解析內容，即可使用經過校驗的領域值。失敗結果必須包含訊息，並可選擇附加內部類名／程式碼資訊；成功與失敗結果由判別欄位區分，失敗結果絕不會承諾存在值。工具作者必須一並設計值及其 Native 投影；增加這項聲明是有意為之，因為它避免從自然語言內容意外推匯出程序化約定。

中間值只受產生它們的能力和行程記憶體限制。日誌不包含這些值，因此重播無法復原；僅處理內容的 post 策略也無法隱藏這些值。這些都是執行期本機約定的明確屬性，並非意外缺口。
