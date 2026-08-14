# dsh-system-prompt

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

系統提示詞組裝登錄檔。外掛程式可以貢獻有序段、工具 schema 和具名變數。迴圈在每個步驟組裝一次，並將結果算繪為完整的模型提示詞。此外掛程式擁有靜態 harness 身份和全域性部署 persona；agent（代理）作用域的 persona 會遮蔽全域性預設值。

## 設定

| 鍵 | 預設值 | 含義 |
|---|---|---|
| `includeHarnessIdentity` | `true` | 是否包含順序為 −100 的固定開場白 `You are an AI agent powered by DeepSeek Harness.`。僅當相容性部署擁有完整系統提示詞時設為 false。 |
| `includeRuntimeContext` | `true` | 是否在組裝中包含有序動態上下文。設為 false 時不會求值上下文提供方，並會在 waterfall 後丟棄 `system-prompt/assemble` 監聽器新增的上下文；其他服務及其強制機制仍然生效。 |
| `persona` | `''` | 全域性部署 persona 預設值：唯一由設定提供的提示詞片段，算繪為順序為 0 的 `deployment:persona` 段，除非 agent 作用域的貢獻將其遮蔽。它是樣板，完整的 `{{…}}` 組會嚴格按已註冊變數解釋（隨附迴圈註冊 `{{model}}`/`{{cwd}}`），目前沒有表達字面量花括號的轉義文法。為空 ⇒ 算繪時刪除該段。 |
| `toolOrder` | 無 | 顯式指定面向模型的工具順序。該清單由 `ToolSchema.name` 組成，並且必須恰好包含一個 `'<unlisted-tools>'` 其餘項標記（`TOOL_ORDER_REST`）：已列工具按清單位置排列，未列工具則按名稱字典序插入該標記所在的位置。缺席 ⇒ 直接按名稱字典序排列。該順序會在 `system-prompt/assemble` waterfall（瀑布式事件）之前應用於已收集的工具。與段的 `order` 排序一樣，它會規範化登錄檔貢獻的內容；註冊順序只是外掛程式載入時序的產物。修改清單的 waterfall 監聽器對其輸出的確定性負責。設定錯誤會明確失敗：清單沒有恰好一個其餘項或存在重複項，會在載入時拋出；已列名稱沒有對應已註冊工具，會使每次 `assemble()` 被拒絕；工具提供方返回保留的其餘項名稱也會被拒絕。在隨附迴圈下，輪次會在任何模型請求前失敗。為何採用中心清單而非每外掛程式權重，見[顯式面向模型工具順序](../../../.agents/notes/implemented/feature/2026-07-06-explicit-tool-order.md)。 |

## 服務：`SystemPrompt`（ctx 鍵：`systemPrompt`）

### 公開 API

- `ctx.systemPrompt.section(section: PromptSection): () => void`：貢獻一個段。層由呼叫上下文的作用域決定：`agent.ctx` 只為該 agent 貢獻，並在該處遮蔽同名全域性段。一個 `complete: true` 段會在組裝 waterfall 之後成為精確的完整提示詞；有效 complete 段超過一個時，組裝會被拒絕。同一層中的重複名稱和非有限順序會拋出。隨呼叫 fiber 一並 dispose（資源釋放）。
- `ctx.systemPrompt.context(context: PromptContext): () => void`：為呼叫作用域貢獻有序動態上下文。每次符合條件的組裝都會求值提供方，並在隨附迴圈下成為模型歷史中帶來源的 runtime-context 快照。
- `ctx.systemPrompt.suppressRuntimeContext(): () => void`：抑制呼叫作用域的所有動態上下文貢獻。多個註冊會獨立組合；只有當不再存在抑制器時，dispose 返回的 effect 才會復原上下文。
- `ctx.systemPrompt.tools(provider: (context: AssembleContext) => ToolProviderResult): () => void`：貢獻工具 schema；每次組裝時使用該次組裝的上下文求值。`ToolProviderResult` = `{ schemas, knownNames? }`：`schemas` 是限制後的可見集合；`knownNames` 是限制前由 `toolOrder` 使用的全集。提供方不得返回名為 `TOOL_ORDER_REST` 的 schema。帶作用域提供方只在其作用域的組裝中查詢。隨呼叫 fiber 一並 dispose。
- `ctx.systemPrompt.variable(name: string, provider: (context) => string | undefined): () => void`：貢獻提示詞變數，在段文字中以 `{{name}}` 引用。帶作用域變數會為該 agent 遮蔽同名全域性變數。同層重複或無法引用的名稱會拋出；`undefined` 表示「本次組裝沒有值」。隨呼叫 fiber 一並 dispose。
- `ctx.systemPrompt.assemble(context?: AssembleContext): Promise<PromptAssembly>`：為一個呼叫方組裝提示詞：將全域性層與 `context.scope` 的層合併，並在變換 waterfall 前分離工具 schema。它經過按作用域篩選的 `system-prompt/assemble` waterfall，之後將一個有效的 complete 段復原為唯一的提示詞段，並實施任何活動的 runtime-context 抑制器。選填的 `context.signal` 顯式控制本次組裝請求；提供方與監聽器可以配合該訊號，但不得將它保留給另一輪次。存在多個 complete 段、已設定的 `toolOrder` 指名提供方 `knownNames` 全集以外的工具，或提供方返回保留的其餘項名稱時，呼叫會被拒絕。

<a id="live-events"></a>

### 即時事件

普通段以 `system-prompt/assemble` 的返回結果為準；complete 段則會在 waterfall 之後作為最終提示詞約束生效。替換條目的監聽器必須保留任何已啟用的 Code Mode 或結構化輸出協定。篩選需要在呈現、尋找與執行之間保持一致時，應使用 [`ToolRuntime.restrict()`](../tools/README.md)。登錄檔變更通知不經過篩選。[system-prompt.md](../../../docs/subsystems/system-prompt.md#cordis-surface) 的生成區塊擁有事件簽名和分發約定。

### 關鍵類型

- `AssembleContext`：說明一次 `assemble()` 呼叫的用途。它可透過合併擴充；此處聲明 `scope?: ScopeKey`（層選擇器）與 `signal?: AbortSignal`（顯式請求控制能力），而 `dsh-agent` 聲明 `agent?: Agent`（類型化 DX 欄位；絕不能在沒有 `scope` 時設定，應使用 `assembleContextFor(agent, signal)`）。提供方必須容忍欄位缺席，因為裸 `assemble()` 攜帶的是無作用域、無訊號的空上下文。`signal` 是請求值，不是環境 Agent 執行 frame 的一部分。
- `PromptSection`：`{ name, order, text, complete? }`。各段按 `order` 升序拼接。順序區間：`-100` 是 harness 身份，`0` 是部署 persona，工具引導使用 `100–199`。協作式組裝完成後，一個有效的 `complete` 段會抑制其他所有段。
- `PromptAssembly`：`{ sections: AssembledSection[], tools: ToolSchema[], variables: Record<string, string | undefined> }`。各段文字到達時已求值，但尚未插值；`variables` 保存所有已註冊變數在當前上下文中求得的值。工具 schema 按設計屬於組裝結果：「模型獲知自己能做什麼」是一個連貫整體，儘管配接器把 schema 作為獨立 wire 欄位傳輸。
- `renderPrompt(assembly)`：插值每個段中的 `{{variable}}` 引用，刪除空段，並用空行連線。嚴格規則：未知引用（使用 `Object.hasOwn` 尋找，因此 `{{constructor}}` 等原型名稱未知）、已註冊但無值的引用、格式錯誤的完整 `{{…}}` 組，或出現 `{{` 卻沒有形成完整組、而後文仍有 `}}`（`{{{model}}}`），都會拋出例外；明確失敗勝過交付格式錯誤的提示詞。孤立的 `{{` 如果後面任何位置都沒有 `}}`，會按字面量透過；替換值絕不再次掃描。

可透過合併擴充：外掛程式可以藉助聲明合併，為 `PromptAssembly` 和 `AssembleContext` 聲明額外欄位。

### 擴充點

- 段提供方：工具包擁有自身的跨呼叫指導（`tool:bash`、`tool:read` 等）；此外掛程式擁有 `harness:identity` 與 `deployment:persona`。
- 變數提供方：agent loop（代理循環）註冊 `model` 與 `cwd`；任何外掛程式都可以註冊自己擁有的事實（未來的 `date`、git 狀態等）。
- 工具 schema 提供方：`ToolRuntime` 自動將自身註冊為工具提供方。
- [`system-prompt/assemble` waterfall](#live-events)：按呼叫方協作式修改或替換組裝結果，之後再實施 complete 段約束。

設計原理：[提示詞變數 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-05-prompt-variables-and-tool-guidance-ownership.md)。

## 模型體驗

### 系統提示詞

#### 模型看到的內容

預設情況下，每次組裝都從下方 harness 身份開始，然後在嚴格變數插值後追加已設定 persona 與有序外掛程式段。`includeHarnessIdentity: false` 僅省略這個固定開場白。空段會消失；帶作用域的段和變數可以為一個 agent 遮蔽全域性項。`system-prompt/assemble` waterfall 決定交付的提示詞與工具 schema，除非一個有效段聲明自身為 complete；此時，該確切段會成為完整的系統提示詞，而 waterfall 得到的上下文、工具和變數保持不變。有序動態上下文與系統提示詞段分離，只在存在時才會成為帶來源的 user 角色快照。`includeRuntimeContext: false` 或帶作用域的抑制器會移除所有這類上下文，包括監聽器新增的內容，但不會停用擁有底層策略或狀態的服務。

##### harness 身份

```markdown
You are an AI agent powered by DeepSeek Harness.
```

#### Token 影響

啟用時，身份是每次請求的固定成本。Persona 與外掛程式文字在每次請求中重複，成本隨算繪內容成長。

#### KV Cache 影響

只要身份、persona、變數、段文字與順序的算繪完全相同，前綴就保持穩定。任何變更都可能從第一個變化的系統提示詞 token 起使複用失效。

### 工具 schema

#### 模型看到的內容

對於已交付工具，模型會收到[生成工具 schema](../../../docs/tool-catalog.md#tool-package-map) 中對每個 agent 可見的子集；限制與組裝攔截完成後，按設定或字典序排列。擴充可以透過同一登錄檔貢獻其他定義。段與 schema 提供方是獨立的組裝輸入，因此工具限制不會移除獨立註冊的引導。

#### Token 影響

schema token 在每次請求中重複。限制工具會為該 agent 移除其全部 schema 成本，但不會移除獨立提示詞段；重排序會改變快取形狀，但不改變語義內容。

#### KV Cache 影響

只要可見 schema 集合、算繪與順序不變，前綴就保持穩定。註冊、限制或重排序可能從第一個變化的 schema token 起使複用失效。

## 已知限制與暫緩事項

- **部署方編寫的提示詞文字只來自設定／組合**：此外掛程式擁有全域性 persona 預設值；建立方外掛程式可以註冊 agent 作用域的遮蔽項；其他段來自擁有相應事實的外掛程式。不存在終端機使用者提示詞編輯 API。
- **沒有表示字面量 `{{…}}` 花括號的轉義文法**：每個完整組都會按已註冊變數插值；只有實際提示詞需要轉義時才會實作。
- **`toolOrder` 設定錯誤在提示詞組裝（首輪）時出現，而不是啟動時**：只有形狀違規會在設定載入時拋出。
- **共享同一 `order` 值的段按註冊順序打破平局**：這是外掛程式載入產物；確定性相依性在順序分段內使用不同值的約定，與已規範化的工具順序不同。
