# dsh-tools

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

工具登錄檔與執行管線。工具外掛程式註冊各自的 schema 和執行器；agent loop（代理循環）依次讓每次呼叫經過 `tools/pre-execute`（可擴充的允許／拒絕閘門）→ 已註冊的單調守衛 → `tools/execute`（供逾時／重試／指標外掛程式使用的環繞分發包裝層）→ `tools/post-execute`（檢查／替換結果、附加上下文）→ 由工具定義持有的 `finalizeContent` 邊界 → 僅觀測的 `tools/result` 通知。登錄檔還決定以何種方式向模型呈現工具：`mode` 設定可以選擇原生 Function Calling（函式呼叫）、[Code Mode](#code-mode)，或同時選擇兩者；單個 agent 可用 `presentAs` 為自己遮蔽該預設值。

## 服務：`ToolRuntime`（ctx 鍵：`tools`）

### 設定

```yaml
tools:
  mode: native   # native (default) | code | both
```

`native` 以函式定義的形式貢獻可見工具。`code` 會提供保留的 `run_code` 傳輸、生成的 `tools:sdk` 段，以及聲明「只有 `run_code` 可被直接呼叫」的 `tools:code-only` 規則。執行器隨後強制執行該規則：模型直接呼叫其他任何工具時，會在策略執行前將該呼叫解析為 `UNKNOWN_TOOL`；`both` 同時提供兩種形式，且不聲明該規則，因為其中的原生呼叫確實可以執行。沒有單獨聲明呈現模式的 agent 預設採用此設定；agent preset 可透過 [`dsh-agent-tool-presentation`](../agent-tool-presentation/README.md) 自行選擇呈現模式。不能註冊、遮蔽、限制或移除該保留傳輸，且無論設定何種模式，該名稱都是保留的，因為任何 agent 都可能選擇 code 模式。非原生模式要求所載入 `ctx.codeRuntime` 的 `language` 有已註冊的 SDK 算繪器——TypeScript 經 [`dsh-code-runtime-worker-thread`](../../code-runtime/code-runtime-worker-thread/README.md) 交付；Python 算繪器內建，驅動任何報告 `language: 'python'` 的執行時期（第一方 `dsh-code-runtime-python` 後端另行交付）。沒有算繪器的執行時期語言會導致提示詞組裝明確失敗；如果 `systemPrompt.toolOrder` 條目指向當前模式未貢獻的工具，系統會拒絕組裝提示詞。`system-prompt/assemble` 監聽器可以替換登錄檔貢獻；它返回的組裝結果具有權威性，因此該監聽器負責保留可用的 Code Mode 協定。

### 公開 API

- `ctx.tools.register(definition: ToolDefinition): () => void`：註冊一個受信任、帶類型的同行程定義，其中必須包含規範的 `output` 聲明。所在層由呼叫上下文的作用域決定：普通外掛程式上下文會全域性註冊；agent 的 `agent.ctx` 只為該 agent 註冊，並在此處遮蔽同名全域性工具。同一層內名稱重複會拋出；非原生模式還會拒絕保留的 `run_code` 傳輸名稱。缺失或不受支援的輸出聲明，以及非正數或非有限的 `timeoutMs`，都會使註冊失敗。選填的同步 `finalizeContent` 回呼會在呼叫開始時納入快照；在所有管線結果（包括實體化其他結果欄位時發現的錯誤）規範化之後，它只能替換最終面向模型的內容。該註冊會隨呼叫方 fiber 一同 dispose（資源釋放）。
- `ctx.tools.presentAs(mode: ToolPresentationMode): () => void`：為本 agent 選擇面向模型的呈現方式，僅對該 agent 遮蔽 `mode` 設定；從普通上下文呼叫會拋出（行程級呈現方式是那個設定欄位），同一 scope 內第二次聲明也會拋出。code 類模式還會為該 agent 註冊它自己的 `tools:sdk` 段。工具目錄保持不變：`schemas(agent)` 仍會報告該 agent 的能力；只有組裝結果中的工具清單會按所選呈現方式收束。隨呼叫方 fiber dispose。
- `ctx.tools.restrict(filter)`：對全域性工具應用 agent 作用域的允許／拒絕掩碼；從普通上下文呼叫會拋出。篩選器在註冊時建立快照；多個掩碼取交集，隨後再合併作用域本機工具。拒絕掩碼會接納後來出現且未點名的全域性工具，而允許掩碼會排除後來出現的名稱。未知、本機或保留名稱以及空篩選器都會被拒絕。這是即時可見性組合，不是權限邊界；參見[作用域安全非目標](../../../.agents/notes/implemented/architecture/2026-07-08-agent-scope-contexts.md#security-and-authority-are-non-goals)。
- `ctx.tools.get(name: string, scope?: ScopeKey): ToolDefinition | undefined`：返回指定作用域可見的解析結果，其中已應用名稱遮蔽；被作用域限制排除的全域性工具會被視為不存在。呈現器會傳入發起呼叫的 agent，使卡片與實際執行內容一致。
- `ctx.tools.schemas(scope?: ScopeKey): ToolSchema[]`：返回該作用域可見的所有 schema（不含 `execute` 函式）。已交付工具的 schema 收錄在 [docs/tool-catalog.md](../../../docs/tool-catalog.md) 中；該目錄透過啟動每個工具外掛程式並採集此方法的結果生成（參見[工具 schema 目錄 Agent Note](../../../.agents/notes/implemented/process/2026-07-02-tool-schema-catalog.md)）。
- `ctx.tools.guard(guard: ToolGuard): () => void`：在 `tools/pre-execute` 之後註冊單調同步執行守衛：返回理由會拒絕呼叫，返回 `undefined` 則保持原決定。普通上下文守衛全域性生效；`agent.ctx` 守衛只對該 agent 生效。後續 waterfall（瀑布式事件）監聽器無法將守衛的拒絕重新變為允許。隨呼叫 fiber dispose。
- `ctx.tools.execute(exec)`：以無損方式快照並凍結參數，分配不透明 token，執行完整的策略／分發／結果管線，然後在最終觀測前獨立快照權威結果。無效參數會進入同一結果路徑，但不會到達策略或工具主體。環繞包裝層只能替換 `signal`；登錄檔會在進入工具主體之前，立即將呼叫方的原始訊號重新合併到當前訊號中。
- `ctx.tools.executionMode(exec)`：返回 `parallel` 的唯一條件是可見定義的 `isConcurrencySafe(exec.arguments)` 分類器恰好返回 `true`；未知、隱藏、未聲明、無效或拋出例外的分類結果均為獨佔。

### 注入的服務

`SystemPrompt`：登錄檔透過 `ctx.systemPrompt.tools()` 自動將工具 schema 送入系統提示詞組裝。審批 seam 則在可用時使用（`ctx.get('approval')`，無靜態注入）：未部署該 seam 時仍會將詢問退化為拒絕，而無論是否存在該 seam，登錄檔都會保持活動。

### 取消

取消採用協作方式，並等待完全靜止。每次類型化呼叫都提供由呼叫方擁有的 `AbortSignal`；工具主體透過必填的只讀 `exec.signal` 接收它，只有 `tools/execute` 包裝層可以臨時替換這個必填訊號。登錄檔會在替換期間保留呼叫方取消，並且絕不會在已啟動的同行程 Promise 尚未結帳時提前返回。工具主體呼叫前發生的取消為 `ABORTED_BEFORE_DISPATCH`；工具主體被呼叫後發生的取消，只能將成功結果替換為 `ABORTED`。拒絕、包裝層失敗、工具失敗、後置策略失敗或由逾時機制產生的 `TOOL_TIMEOUT` 仍保留更具體的結果。入口處已中止的呼叫會實體化並凍結參數，隨後跳過所有策略和分發階段，只發布一個結果。每個非同步工具都必須觀測或轉發該訊號，並且只能在其負責的工作停止後結帳。[工具取消 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-19-cooperative-tool-cancellation.md) 規定完整約定和強制終止邊界。

### 即時事件

即時登錄檔管線先經過 3 道可轉換的 waterfall，再經過由工具定義持有的內容終結器，最後發布僅供觀測的 `tools/result` 事件；登錄檔變更通知有意不作過濾，並作為共享狀態通知發布。確切簽名、分發 mode、作用域篩選和失敗隔離約定位於 [tools.md](../../../docs/subsystems/tools.md#cordis-surface) 的生成區塊，完整順序則在生成的[工具執行管線](../../../docs/tool-execution-pipeline.md)中視覺化。`tools/result` 是即時事件；名稱相近的 `tool/result` 是 agent loop 隨後追加的持久工作階段事件。

### 關鍵類型

- `ToolDefinition`：`ToolSchema` + 必填的 `output { schema, render, presentationMeta? }` + `execute(args, exec)`，以及選填的最終內容回呼、呈現回呼、協作式 `timeoutMs` 和逐呼叫的 `isConcurrencySafe(args)` 分類器。主體只能返回輸出 schema 聲明的規範 JSON 值，並透過 `exec.signal` 協作停止。`finalizeContent(exec, result)` 對每個規範化結果都恰好執行一次，包括繞過後置策略的失敗，並且只能替換 `content`；它必須是同步且對所有輸入都有定義的函式。
- `ToolExecutionInput`：呼叫方提供的呼叫描述：`{ callId, name, arguments, signal, agent?, parent? }`；`signal` 必填且只讀，呼叫方可以將外層執行的不透明 token 作為 `parent` 傳入，但絕不能選擇新執行自身的 token。
- `ToolExecutionToken`：登錄檔分配的全新帶品牌 `Symbol`。它只支援透過相等性進行關聯，絕不會跨越模型、日誌或 worker 邊界。
- `ToolExecution`：只讀管線檢視表：不可變的 `{ token, callId, name, arguments, signal, agent?, parent? }`；登錄檔會另行保留並重新融合調用方的原始訊號。`ToolDispatchExecution` 是僅供 `tools/execute` 使用的檢視表，其必填訊號可變，因此包裝層可以替換並還原它，但不能刪除它。巢狀呼叫的 `parent` 是 `ToolExecutionToken`，而不是執行對象。
- `ToolRunContext`：傳給工具主體的執行上下文，在 `ToolExecution` 基礎上增加 `deferContext(context)`。它把一條上下文推遲到該工具的最終結果抵達迴圈時——通常是組合工具轉運的巢狀分發上下文，也可以是葉子工具建立的全新外掛程式來源指令（如 `tool-goal` 的收尾註入）——即使工具後來拋出或取消勝出也不例外；該方法絕不會立即注入上下文。
- `ToolExecutionResult`：帶判別標記的執行區域性結果。成功形態為 `{ isError:false, value:JsonValue, content, meta?, additionalContexts? }`；失敗形態為 `{ isError:true, error:{ message, info? }, content, meta?, additionalContexts? }`，且不含值。呼叫身份保留在不可變的 `ToolExecution` 上。登錄檔會在呈現前快照、驗證並凍結規範值，隨後在最終觀測前實體化持久呈現欄位。`ToolFailure.info` 攜帶內部的 `{ name, code }`，用於表示 `HarnessError`；`additionalContexts` 會保留每個透過延遲或 post-execute 加入且帶標識的 `UserMessage`，供迴圈在結果後按 FIFO 順序處理。
- `PreToolDecision`：`{kind:'allow'}` | `{kind:'deny', reason}` | `{kind:'ask', reason?}`。該類型有意不提供輸入改寫；`ask` 在掛載 [`ctx.approval`](../../interaction/user-approval/README.md) 時由它處理，否則退化為拒絕。
- `PostToolDecision`：接受決定可以替換 `content` 或 `value`（不能同時替換），並可附加 `additionalContexts`；阻止決定會把回饋變成無值失敗。替換內容會保留規範值和中繼資料。替換值會重新驗證，並重新呈現內容／中繼資料。接受決定會先保留工具延遲的上下文，再附加決定上下文；阻止決定會丟棄工具延遲的上下文，只公開阻止決定顯式提供的上下文。
- `ToolGuard`：`(execution) => string | undefined`；返回的字串是最終單調拒絕理由，在可重排的前置執行 waterfall 之後、分發之前求值。
- `ToolCallView` / `ToolResultView`：提供方無關、帶 `card` 標籤的呈現意圖；工具透過 `presentCall` / `presentResult` 返回該意圖，從而擁有 UI 呈現其自身呼叫的方式（參見「工具擁有的 UI 呈現」）。

### 擴充點

- 工具外掛程式呼叫 `ctx.tools.register()`：schema 會自動流入組裝結果。
- `tools/pre-execute` 是可重排的允許／拒絕／詢問閘門；`ctx.tools.guard()` 在其後新增單調的擁有方策略。
- `tools/execute` 會環繞包裝規範化後的規範分發，以支援逾時、重試或指標採集。包裝層只能替換操作訊號；包裝層生成的成功結果會根據已解析工具的輸出聲明進行規範化。每個規範結果屬於一個不可變分發 token，因此來自其他呼叫或工具的快取結果會根據當前聲明重新驗證。
- `tools/post-execute` 可以替換呈現內容、替換規範值、透過回饋阻止，或附加有序上下文。隨後，定義選填的 `finalizeContent` 會在普通結果和外層管線失敗中維護其最終、僅涉及內容的不變式；`tools/result` 觀測不可變的最終結果。內容替換不是保密邊界：當程式設計消費端不得接收某個值時，應阻止或替換該值。
- 確切簽名與順序位於 [tools.md](../../../docs/subsystems/tools.md#cordis-surface) 的生成區塊和[管線](../../../docs/tool-execution-pipeline.md)中。
- MCP 伺服器：每個伺服器使用一個外掛程式；發現工具後，使用伺服器的 schema 呼叫 `ctx.tools.register()`。

### 類型化工具參數 schema

第一方外掛程式作者可以使用本包匯出的 `defineTool()` 輔助函式定義類型化工具參數 schema：

```ts
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

declare const ctx: Context

ctx.tools.register(defineTool({
  name: 'read_file',
  description: 'Read a file from disk.',
  parameters: {
    path: { type: 'string', required: true, description: 'Absolute file path' },
    offset: { type: 'number' },
    limit: { type: 'number' },
  },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  async execute(args, exec) {
    // args is typed: { path: string; offset?: number; limit?: number }
    return readFile(args.path, { encoding: 'utf8', signal: exec.signal })
  },
}))
```

統一 schema DSL 使用 `ParameterSchemaSpec` 表示隱式開放參數對象，使用 `ValueSchemaSpec` 表示任意 JSON 值根。它支援 `string`、`number`、`integer`、`boolean`、`null`、`array`、`object`、僅供作者使用的 `json`，以及恰好匹配一個分支的 `oneOf`；標量 `enum`/`const` 值必須符合其聲明類型。每個顯式 DSL 對象都聲明 `additionalProperties: true | false`，而隱式參數根和原始 JSON Schema 保持標準的開放預設值。schema 記錄只接受自身可枚舉字串鍵，schema 陣列必須是稠密普通陣列。編譯、驗證、從登錄檔分離以及 schema 到 TypeScript 的呈現均使用顯式工作棧，因此，對有效深層 schema 的執行時期處理受記憶體而非呼叫棧限制；`InferValue` 在 16 層容器內保留精確類型，之後回退到 `JsonValue`，使 TypeScript 自身也保持棧安全。

`defineTool` 定義會在執行前驗證模型參數，並把缺失必填值、基本類型錯誤、無效枚舉成員和巢狀違規轉換為 `ToolArgsError`（`INVALID_ARGS`），進入普通錯誤結果路徑。它還會根據 `output.schema` 推斷主體返回類型和純輸出投影器；登錄檔在呈現前快照並驗證返回的無損 JSON。隱式參數根是開放的；顯式對象只有在設定 `additionalProperties: true` 時才接受額外鍵，而沒有聲明屬性的封閉對象只接受 `{}`。原始 JSON Schema 對象保持開放，除非顯式設定 `additionalProperties: false`。系統不會應用預設值；沒有 `properties` 的開放對象和沒有 `items` 的陣列只接受容器型別檢查。透過原始方式註冊的工具負責輸入驗證，但仍需聲明輸出，並由登錄檔強制校驗輸出。

有關詳細資訊，請參閱公開 API 中的 `defineTool`、`validateArgs`、`ToolArgsError`、`ValueSchemaSpec`、`ParameterSchemaSpec`、`InferValue`、`InferArgs`、`valueSchemaSpecToJsonSchema` 和 `parameterSchemaSpecToJsonSchema`。

選填的 `timeoutMs` 必須為正數且為有限值；它是策略中繼資料，不是模型可見的 schema。

選填的 `isConcurrencySafe(args)` 接收經過軟驗證的類型化參數。只有確切的 `true` 才允許並行分發／主體執行；無效輸入和所有其他結果仍為獨佔。選擇並行的主體不得改變父級擁有的狀態；共享狀態競態必須具有交換性，否則必須安全拒絕。[平行工具呼叫 Agent Note](../../../.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.md) 規定完整安全約定。

### 強制執行的原始 JSON Schema 子集

`JsonSchemaNode` 是工具輸出、Code Mode 生成、subagent 和工作流程共享的原始 JSON Schema 對應類型。它允許任意 JSON 根、僅含註解且不施加約束的 JSON 節點，以及恰好匹配一個分支的 `oneOf`；註解必須保持為無損 JSON。`assertSupportedJsonSchema()` 拒絕不受支援的構造，而 `validateJsonSchemaValue()` 返回帶路徑的違規資訊。subagent 和工作流程透過 `assertObjectJsonSchema()` 與 `ObjectJsonSchema` 保留呼叫方定義的對象根要求，而不是相依性共享詞彙的限制。

### 由工具定義的 UI 呈現

工具可以選擇透過純函式 `presentCall()` 和 `presentResult()` 定義呈現意圖，使 UI 無需針對工具名稱編寫特殊邏輯：

- 呼叫檢視表為 `{ card: 'generic', title, kind?, rawInput?, content?, locations? }`、`{ card: 'terminal', title, description?, cwd? }` 或 `{ card: 'diff', title, diffs, locations? }`。
- 結果檢視表為 `{ card: 'generic', title?, content? }`、`{ card: 'terminal', title?, output?, exitCode?, signal? }`、`{ card: 'diff', title?, diffs }`、`{ card: 'search', shape, title?, truncated, total, … }`（已完成的發現型搜尋——`shape: 'matches'`（grep）為按文件分組的匹配，`shape: 'paths'`（glob）為扁平路徑清單，配 `truncated`/`total` 使 UI 永不把被截斷的結果當作完整結果呈現；該檢視表不攜帶結果文字，且搜尋沒有 `card: 'search'` 的呼叫時對應檢視表）、`{ card: 'read', title?, path, offset, lines, totalLines, lang?, content? }`（已完成的文件讀取→帶行號、選填文法高亮的程式碼檢視表；`offset` 是視窗請求的 1-based 起始行，即使 `lines` 為空也保留；`lines` 是 `{ number, text }[]`，保留每一行的文件行號，`content` 是去除讀取結果外層封裝後的正文，供不支援讀取檢視表的 UI 回退顯示）或 `{ card: 'web', kind: 'search' | 'fetch', title?, … }`（已完成的 web 檢索；`kind` 各分支攜帶結構化的搜尋來源或抓取摘要，不具備 `web` 能力的 UI 回退到原始結果內容）。

返回 `undefined` 會選擇通用回退。呈現器只相依性其參數和持久結果，因為 UI 會在即時流式輸出和日誌重播期間呼叫它們。`output.presentationMeta(args, value)` 為直接的頂層呼叫派生 JSON 中繼資料；該中繼資料隨 `tool/result` 持久化並傳回 `presentResult`，而規範值本身仍只存在於執行區域性，絕不會重播。巢狀 Code 分發不會計算中繼資料。`defineTool` 會軟驗證較舊的日誌參數並回退，而不會使重播崩潰。`dsh-tool-bash` 與 `dsh-tool-fs` 是參考實作；[規範輸出 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-20-canonical-tool-output-contract.md) 規定值／呈現拆分，[呈現意圖 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-02-tool-render-intent-union.md) 規定卡片詞彙。

### Code Mode

在 `code` 或 `both` 模式下，登錄檔為當前作用域公開保留的 `run_code` 傳輸和按所載入執行時期語言生成的確定性 SDK——登錄檔按 `ctx.codeRuntime.language` 選擇算繪器（`typescript` → 下方的 TypeScript SDK，`python` → Python SDK）。只有程序的外層日誌與回傳值會重新進入模型上下文。SDK 為每個可見工具聲明精確的參數與規範輸出類型（TypeScript 為 `ToolArgsMap`/`ToolOutputMap`，Python 為具名 `TypedDict`），每個綁定都會解析為該工具的規範 JSON 值。每個無損 JSON 綁定呼叫都會在原生調度約定下重新進入完整工具管線（並行安全的呼叫最多可重疊 `maxParallelSubCalls` 個；獨佔呼叫單獨執行並構成排序屏障），並在日誌中與外層呼叫建立關聯。拒絕及其他失敗結果會以程序實際可見的 `ToolCallError` 形式拒絕，且只攜帶 `toolName` 和 `message`；Native 內容和內部錯誤碼留在 Code 約定之外。普通副作用不會回滾，子呼叫的 `additionalContexts` 會透過父結果延遲，以保持呼叫／結果相鄰。執行結帳會中止並排空尚未完成的綁定；執行時期失敗以 `CodeRunFailedError` 形式出現。

在 `code`（而非 `both`）下，該傳輸同時也是模型唯一可用的入口：模型直呼其他任何可見工具名，都會在建立執行時、早於 `tools/pre-execute`、審批 `ask` 和 guards 解析為 `UNKNOWN_TOOL`，因此沒有任何一方會觀察或批准一個註定失敗的呼叫。拒絕資訊會給出正確路徑（`only \`run_code\` is callable directly — call \`<name>\` from inside a \`run_code\` program instead`），因為同一份提示詞剛剛聲明過那個工具，只說 `unknown tool` 會被讀成部署損壞。SDK 子分發攜帶外層執行的 `parent` token，不受此限制，因此程序保留 SDK 聲明的全部綁定。參見[執行器塌縮 note](../../../.agents/notes/implemented/bug-fix/2026-08-07-code-mode-executor-collapse.md)、[Code Mode 基礎](../../../.agents/notes/implemented/feature/2026-06-15-code-mode.md)、[類型化返回約定](../../../.agents/notes/implemented/feature/2026-07-20-code-mode-typed-tool-returns.md)和[程式碼執行時期 seam](../../code-runtime/README.md)。可以執行 `pnpm run demo:code-mode` 試用。

- **SDK 段**（`tools:sdk`，順序 150）：一個在組裝時求值的提示詞段，每次組裝都會重新生成與所載入執行時期語言相符的 SDK 文字。TypeScript 形態會生成 `JsonValue`、精確的 `ToolArgsMap` / `ToolOutputMap`、`ToolName`、`ToolCallError` 聲明，以及對映呼叫作用域最終可見工具的 `tools` 命名空間（特殊名稱使用帶引號的鍵），並附帶固定的使用說明；Python 形態（`ctx.codeRuntime.language === 'python'`）寄出等價的具名 `TypedDict` 與一個帶相同用法說明的 `tools` 對象。其輸出具有確定性：工具按字典序排列；工具集合不變時，文字逐位元組相同（有利於前綴 cache）。兩個程式碼生成器都已匯出，且絕不會在提示詞組裝期間拋出：`jsonSchemaToTs` 處理統一 schema 的每種構造並將不受支援的原始構造降級為 `unknown`；`jsonSchemaToPy` 同理，降級為 `Any`（當某欄位名不是合法的 `TypedDict` 屬性時，或在 SDK 算繪之外被呼叫時——`TypedDict` 聲明所需的命名上下文由該算繪提供——整個對象降級為 `dict[str, Any]`）。
- **分發橋接層**（`run_code` 的 execute）：每個綁定呼叫都會在分發前快照為無損 JSON（`undefined`、`BigInt`、迴圈、稀疏陣列、`-0` 和特殊對象會使該次呼叫被拒絕），經由每次執行獨有、複用原生並行約定的池調度——呼叫嚴格按提交順序啟動，連續的 `isConcurrencySafe` 呼叫最多可重疊經校驗的 `maxParallelSubCalls` 設定個（預設 10；設為 `1` 即復原序列分發），被分類為獨佔的呼叫先排空池、單獨執行並阻擋其後的呼叫——以外層執行的不透明 token 作為 `parent`，並經過完整的 pre-execute → guards → execute → post-execute → result 管線。成功會返回策略處理後的最終規範值；失敗以一則訊息到達 worker，並成為 `ToolCallError(toolName, message)`。每個已啟動的子呼叫在進入管線時記錄一條 `tool/code-dispatch-start` 事件（確定性 id `<parent>:code:<n>`，按提交順序編號），並以一條攜帶完整模型可見 `content`/`isError` 結果的 `tool/code-dispatch` 事件完結（採用 `tool/result` 詞彙，因此 UI 會沿原生路徑呈現子呼叫——這對事件的 `time` 欄位承載每個子呼叫的計時）；因 run 結帳而被放棄的排隊呼叫兩者都不記錄。`deriveMessages()` 既不公開這兩個事件，也不持久化規範值。token 關聯使按提交語義工作的觀察器可以延後提交內部呼叫的成功結果，直到最終 `run_code` 結果確定，而無需暴露進行中的外層執行；普通工具副作用不會回滾。每個子呼叫的 `additionalContexts` 條目都會按分發順序透過外層 `ToolRunContext` 延遲；迴圈只在父級 `run_code` 結果之後追加這些上下文，從而保持相鄰關係，並且即使程序後來失敗，也會保留各自的來源／中繼資料。
- **結帳紀律**：橋接層擁有一個執行作用域的中止機制；該中止會跟隨傳入的外層訊號，並在執行因任何原因結帳時觸發，因此預算耗盡會中止正在執行的子工具，而不會將其殘留。橋接層隨後會在返回之前排空佇列，使每個 `tool/code-dispatch` 都落在仍打開的輪次內。失敗的執行會拋出 `CodeRunFailedError`（`code: 'CODE_RUN_FAILED'`，message = 失敗類型 + 已捕獲日誌），管線會將其轉換為模型可據以自我修正的結構化 `isError`。
- **結果大小**：中間綁定值會完整傳入 worker 行程，且沒有逐綁定位元組上限。`run_code` 返回規範的 `{ logs: string[], result?: JsonValue }`；字串原樣呈現，其他所有存在的 JSON 根都透過棧安全的美化 JSON 遍歷呈現，總縮排最多為 10 個字元（更深的子樹保持緊湊），`null` 保持顯式，而缺少 `result` 表示程序返回 `undefined`。worker 可設定的 `maxOutputBytes`（預設 64 MiB）只應用於組合序列化後的外層日誌陣列、完成值或失敗訊息載荷；固定的結果封裝文法和呈現空白不計入該上限。無效和超限的完成會明確失敗，只有這個外層結果可以按常規 spill 機制處理。

### 平行執行

agent loop 將連續的 `parallel` 呼叫歸入有界捲動池，並把每個 `exclusive` 呼叫視為順序屏障。只有分發／主體會重疊；策略、持久結果和上下文仍保持模型順序。Code Mode 綁定透過橋接層自己的池複用同一套分類。[平行工具呼叫 Agent Note](../../../.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.md) 規定已交付聲明及其原理。

## 模型體驗

### 普通工具 schema

#### 模型看到的內容

在普通模式下，模型會看到每個可見定義的確切名稱、描述和 JSON Schema；已交付定義記錄在生成的[工具包對映和 schema 章節](../../../docs/tool-catalog.md#tool-package-map)中。agent 作用域的限制、遮蔽和擴充註冊會改變該 agent 的最終工具集合。

#### Token 影響

每次請求的固定成本與可見定義成正比。隱藏工具的限制會為該 agent 移除其全部 schema 成本。

#### KV Cache 影響

只要可見定義及其順序不變，前綴就保持穩定。註冊、dispose 或作用域限制可能從第一個改變的 schema token 起使複用失效。

### Code Mode schema 與系統提示詞

#### 模型看到的內容

Code Mode 會公開生成的 [`run_code` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tools)、下方 SDK 說明，以及按所載入執行時期語言生成的精確 SDK 塊（TypeScript 的 `declare const tools` 塊，或 Python 的 `tools` 聲明）。`both` 會同時公開普通 schema 與此 Code Mode API。在 `code` 下，提示詞還會帶上 `tools:code-only` 規則，其順序排在逐工具指導段之前，讓模型先讀到「可以呼叫哪些工具」再讀「每個工具做什麼」；`both` 下它算繪為空。說明與 SDK 塊隨所載入執行時期的語言切換；下方展示 TypeScript 版本（經 [`dsh-code-runtime-worker-thread`](../../code-runtime/code-runtime-worker-thread/README.md)），Python 版本（用於任何報告 `language: 'python'` 的執行時期）以 Python 文法提供相同操作和類型（`await tools.name(args)`、特殊名稱用下標訪問、`print(...)` 與頂層 `return`）。

##### Code Mode SDK 說明

```markdown
## Writing code for run_code

`run_code` takes two required arguments: `code` — the body of an async TypeScript function (erasable syntax only — no `enum` or namespaces; type annotations are advisory, the code runs type-stripped) — and `description`, a short summary of what the program does. Inside the program:

- Call tools as `await tools.name(args)` — quoted access for exotic names: `tools["my-tool"](args)`. Every call resolves to the tool's typed canonical JSON value. Tool arguments must be lossless JSON.
- A FAILED tool call rejects with `ToolCallError`, whose `toolName` identifies the failed tool and whose `message` is human-readable — `try/catch` it to handle and continue.
- Independent read-only calls MAY overlap under `Promise.all` (safe calls run concurrently; mutating calls run alone, in submission order). Sequence dependent work with `await`.
- Emit results with `return` and/or `console.log(...)`. ONLY what you print or return comes back to you — intermediate tool results never enter the conversation, so extract just what you need.

The available tools:
```

#### Token 影響

每次請求的固定成本與可見定義成正比。Code Mode 使用生成的 SDK 文字加一個傳輸 schema 取代最終工具 schema，但不承諾普遍減少成本。

#### KV Cache 影響

只要 Code Mode 選擇、生成的 SDK、傳輸 schema 和可見工具集合不變，前綴就保持穩定。模式或篩選器變更可能從第一個改變的提示詞或 schema token 起使複用失效。

### 工具呼叫歷史與結果

#### 模型看到的內容

迴圈會保留模型寄出的參數和登錄檔的最終內容。任何拋出例外或遭到拒絕的呼叫，都會轉換為確切的 `Error: <message>`。Code Mode 只返回外層程序列印的行和呈現後的回傳值；兩者都為空時返回 `(run_code completed with no output)`；失敗時返回 `Error: code run failed (<kind>): <message>`，並根據是否存在已捕獲內容，在其後附加 `Captured output:` 與捕獲的行。內部分發事件只保留在日誌中；後置執行監聽器可以在結果之後追加帶來源歸屬的上下文。

#### Token 影響

參數、結果和附加上下文取決於資料，並會重複傳送直至壓縮（compaction）。隱藏工具的限制還會在模型可以呼叫這些工具之前移除其 schema。

#### KV Cache 影響

僅附加；新的可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **並行策略不是事件閘門**：`executionMode()` 直接讀取已解析的工具定義；外掛程式只能在自身擁有的定義上聲明分類器。
- **`tools/pre-execute` 有意不允許改寫 `exec.arguments`**：否則日誌記錄和呈現的參數會與實際執行內容失去同步；改寫設計記錄在[擬議的 Agent Note](../../../.agents/notes/proposed/feature/2026-06-30-pre-tool-input-rewrite.md)中。
- **呼叫方定義的 subagent 與工作流程結構化輸出仍要求對象根**：這是消費端層面的守衛；共享 schema 詞彙和工具輸出支援任意 JSON 根。
- **定義中的 `timeoutMs` 僅作聲明之用**：登錄檔絕不會強制執行截止時間；要強制執行，必須使用 `@deepseek-ai/dsh-tool-call-timeout-policy` 包裝層。
- **Code Mode 的 SDK 語言由當前載入的執行時期決定，且呈現方式按 agent 而非按工具**：`mode: code`/`both` 會拒絕組裝提示詞，除非 `ctx.codeRuntime.language` 有已註冊的 SDK 算繪器（TypeScript 或 Python）；作用域限制／遮蔽與 `presentAs` 會選擇每個 agent 的可見綁定及其形態，但在同一個 agent 內不能讓一個工具僅使用 Native，而另一個僅使用 Code。
- **Code Mode 中間值只存在於執行區域性，且沒有位元組上限**：這些規範的類型化值無法從工作階段重播重建，並可能耗盡行程或 worker 記憶體；只有外層 `run_code` 輸出受 worker 可設定的硬上限約束。每個子呼叫的持久日誌副本則確實有上限：`tools/code-dispatch-log` waterfall 允許 spill 策略把過大的 `tool/code-dispatch` 內容替換為預覽加定位符（[原理](../../../.agents/notes/implemented/feature/2026-07-26-code-dispatch-log-spill.md)）。
- **每次執行都會獲得全新的 `run_code` 狀態**：MVP 不採用持久 REPL 風格核心（跨呼叫狀態不會出現在日誌中）；參見 [Code Mode Agent Note](../../../.agents/notes/implemented/feature/2026-06-15-code-mode.md)。
