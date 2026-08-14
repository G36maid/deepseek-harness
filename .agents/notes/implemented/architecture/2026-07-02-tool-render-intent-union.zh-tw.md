# Agent Note: 用於工具呼叫展示的帶標籤 render-intent 聯合類型

Status: implemented

[English](2026-07-02-tool-render-intent-union.md) | [简体中文](2026-07-02-tool-render-intent-union.zh.md) | 繁體中文

> render-intent 聯合類型對 UI 傳輸層仍然有效；其 ACP（Agent Client Protocol）對映已被 [ACP 作為僅面向自動化的協議](../simplification/2026-07-23-acp-automation-only-protocol.md)取代。

## 問題

工具透過 `ToolDefinition` 上的兩個回呼 `presentCall`/`presentResult` 聲明其呼叫在 UI（編輯器的工具呼叫卡片）中如何渲染，返回 `ToolCallPresentation` / `ToolResultPresentation`，並帶有一個選填的 `ToolTerminal` 子結構。這些類型在增量演進中變成了一個**選填欄位的集合**：呼叫側有 `title`、`kind`、`rawInput`、`content`、`locations`、`terminal`；結果側有 `title`、`content`、`terminal`；`ToolTerminal` 上有 `cwd`/`output`/`exitCode`/`signal`。職責劃分模糊不清：

- 呼叫側和結果側的 `terminal` 欄位重疊，bridge 需要將每次呼叫的 `content` 塊、`terminal` 塊和 `rawInput` 用臨時條件邏輯拼接在一起。
- 哪些組合是*合法的*沒有文件說明：一個設定了 `content` 的 `terminal` 呼叫意味著「卡片上方的描述」；一個設定了 `terminal` 的 generic 呼叫毫無意義但類型上可表達。類型允許無意義的狀態存在。
- 無法表達編輯器最需要的文件工具能力：**diff 卡片**（`{path, oldText, newText}`，Zed 將其渲染為內聯 diff / 新文件預覽）。`ToolCallPresentation.content` 使用的是 *LLM（大型語言模型）* 的 `ContentBlock[]` 詞彙（text/image），工具根本無法請求 diff 展示。

一個早先被否決的摺疊工具自有呈現提案把富渲染推遲到它能夠「在至少有兩個真實工具和兩個真實消費端驗證詞彙之後，以帶標籤 render-intent 聯合類型的形式回歸」之時。該條件已由多個生產者族，加上 TUI 與宿主/用戶端執行時期（Web）這些消費端滿足。

## 決策

用一個**以 `card` 為標籤的可辨識聯合類型**替代選填欄位集合。工具為每次呼叫/結果聲明一個渲染意圖；bridge 根據標籤分發。

```ts ignore-check
type FileLocation = { path: string; line?: number }
type FileDiff = { path: string; oldText: string | null; newText: string } // oldText null ⇒ new file

// presentCall → ToolCallView
type ToolCallView = GenericCallView | TerminalCallView | DiffCallView
interface GenericCallView { card: 'generic'; title: string; kind?: ToolCallKind; rawInput?: unknown; content?: ContentBlock[]; locations?: FileLocation[] }
interface TerminalCallView { card: 'terminal'; title: string; description?: string; cwd?: string }
interface DiffCallView { card: 'diff'; title: string; diffs: FileDiff[]; locations?: FileLocation[] }

// presentResult → ToolResultView
type ToolResultView = GenericResultView | TerminalResultView
interface GenericResultView { card: 'generic'; title?: string; content?: ContentBlock[] }
interface TerminalResultView { card: 'terminal'; title?: string; output?: string; exitCode?: number; signal?: string }
```

`card` 在每個變體上都是**必填**的——真正的判別欄位，而非選填預設值。bridge 執行 `switch (view.card) { case 'generic': … case 'terminal': … case 'diff': … default: assertNever(view) }`。該聯合類型是**封閉的**（遵循 [switch 窮舉約定](../../../../AGENTS.md)）：第四種渲染意圖（表格、圖表）無論如何需要新的 bridge 程式碼來渲染，因此一個由外掛程式新增但被 bridge 靜默丟棄的變體，比編譯錯誤更糟糕。新增變體會在 bridge 的 switch 處中斷編譯——這正是我們想要的訊號。

### 為什麼帶標籤聯合類型優於欄位集合

- **無效狀態變得不可表達。** generic 卡片不能攜帶終端機輸出；terminal 卡片不能攜帶 diff。舊的欄位集合允許所有這些組合。
- **消費端分發而非拼接。** 每種卡片一個分支，精確產出該卡片所需的檢視表，而非調和五個互動關係未文件化的選填欄位。
- **`diff` 成為一等意圖。** `dsh-tool-fs` 的 write/edit 聲明帶 `{path, oldText, newText}` 的 `card:'diff'`，讓有能力的 UI 無需針對工具名做特殊處理即可渲染行內變更。

### 生產者對映

- `dsh-tool-fs` read → `generic`（`kind:'read'`，附帶一個 follow-along `location`）；write → `diff`（`oldText:null`）；edit → `diff`（`oldText:old_string || null`，`newText:new_string ?? ''`）。這與 `claude-agent-acp` 的 `toolInfoFromToolUse` 中 Read/Write/Edit 各分支逐欄位對應。
- `dsh-tool-bash` 前景執行 → `terminal` 呼叫 + `terminal` 結果；`run_in_background` → `generic`。通用 `job_*` 控制工具擁有各自的 generic 卡片。
- `dsh-tool-todo` → `generic`。

### 終端機回退的歸屬

`TerminalResultView` 只攜帶 `output`/`exitCode`/`signal`。不具備終端機能力的 UI 需要一個圍欄 ` ```console ` 文字回退；該推導移至 **bridge**（在無能力路徑上將 `output` 包裹在圍欄程式碼區塊中），而非由工具雙重編碼。這使 bash 工具的結果保持單一結構化形狀，並逐位元組保留既有的能力門控行為。

terminal 意圖只用於展示。harness 仍透過自身的 bash 服務執行命令，從而保留沙盒、環境清理、任務歸屬和每工作階段 cwd；UI 只呈現已完成的呼叫，絕不會成為第二個執行後端。

### 純函式性保持不變

`presentCall`/`presentResult` 仍然是 `args`（`presentResult` 還有 result）的純函式——它們在即時流式輸出和工作階段日誌重播中都會執行，因此必須具備重播確定性。每個 view 僅從 args 推導：write 的 diff 是新文件風格（`oldText:null`），因為工具在呼叫時沒有舊內容；edit 的 diff 是 `old_string`→`new_string`。

## 曾考慮的替代方案

- **完全刪除工具自有的展示**：即本 Agent Note 所取代的那個被否決的 collapse 提案；其自身的結論正是推遲到兩個真實工具和兩個真實消費端存在後再做此聯合類型，該條件現已滿足。
- **讓 UI 執行 terminal 意圖**：否決。這樣會繞過 harness 的 bash 策略與歸屬約定，並把命令執行分裂到不同後端。terminal 卡片描述的是 harness 擁有的執行，絕不授權用戶端側執行。
- **可合併擴充的聯合類型**（`ContentBlockMap` 模式）：否決。新的渲染意圖無論如何需要新的 bridge 程式碼來渲染，因此一個被 bridge 靜默丟棄的外掛程式新增變體，比封閉聯合類型在 bridge 的 `assertNever` switch 處引發的編譯錯誤更糟糕。
- **保留選填欄位集合**：即「問題」一節所剖析的現狀：無效狀態可表達、欄位互動無文件、且完全無法請求 diff 卡片。

## 後果

新的渲染意圖會在 bridge 的 switch 處引發編譯中斷——這是有意為之：渲染程式碼必須先於卡片種類存在。無效的卡片/欄位組合現已不可表達，bash 回退推導歸 bridge 所有，工具只返回一個結構化形狀。第四種卡片（表格、圖表）的門檻是在同一個變更中編寫其 bridge 分支。

## 非目標

- **即時增量 `terminal_output_delta` 流式輸出**與**命令分類**：終端機渲染 Agent Note 自身推遲的後續工作，本 Agent Note 不涉及。

## 相關

- 取代早先被否決的摺疊工具自有呈現提案（已否決——「等兩個真實工具和兩個真實消費端，然後做帶標籤 render-intent 聯合類型」）中的推遲決定。該條件現已滿足；本 Agent Note 即為那個聯合類型。
- 被[結果時已應用 hunk 差異](../../archived/architecture/2026-07-02-result-time-applied-hunk-diffs.md)（已歸檔）擴充：後者新增了一個持久化的 `meta` 通道，使 write/edit 在結果時輸出 `DiffResultView`（應用後的變更：帶上下文行的 contextual hunk / 每個 `replace_all` 位點一個，或建立時的整文件 diff）——值/呈現拆分與持久化的 `presentationMeta` 通道現由[規範工具輸出約定](2026-07-20-canonical-tool-output-contract.md)擁有。
- 將 `ToolTerminal` 折入當前 UI 傳輸層使用的帶標籤 `terminal` 檢視表。
