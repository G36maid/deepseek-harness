# Agent Note: 動態工作流程——指令碼驅動程式的多 agent 編排 seam

Status: implemented

[English](2026-07-05-dynamic-workflows.md) | [简体中文](2026-07-05-dynamic-workflows.zh.md) | 繁體中文

## 問題

harness 可以透過 `dsh-tool-subagent` 將一個任務委派給一個子 agent（代理），但需要扇出到多個獨立部分的工作——跨多文件審計、遷移、多角度調研、對抗式驗證——迫使模型逐輪次編排：每個中間結果都落入父上下文，計畫無處持久儲存，每一步的協調都要消耗一次模型往返。Claude Code 以[動態工作流程](https://code.claude.com/docs/en/workflows)的形式提供了這一能力：模型編寫一段 JavaScript 編排指令碼，執行時期執行它，由指令碼（而非對話）持有迴圈、分支和中間結果。

## 決策

在 `packages/workflow/` 下以 bash seam 的形態（Service Definition／Service Provider／Consumer）提供一組工作流程能力，以及它在 subagent seam 上所需的結構化輸出基礎。

### 指令碼約定（相容 Claude Code）

一次工作流程呼叫包含 JSON `meta`（`name`、`description`，以及選填的 `whenToUse`/`phases`）和一段支持頂層 `await` 並返回 JSON 值的 JavaScript `script` 正文。元資料作為資料校驗，從不被執行。正文接收 `agent(prompt, options)`、`parallel(thunks)`、`pipeline(items, ...stages)`、`phase(title)`、`log(message)` 和 `args`。管線各階段接收 `(prev, item, index)`，階段之間無屏障；失敗的子 agent 和普通階段錯誤將受影響的 item 結帳為 `null` 並跳過其剩餘階段。Claude Code 的確定性限制隨日誌機制一並延後實作，因此相容的指令碼正文在將 meta 頭移入參數後可以使用時鐘和隨機數。

與 CC 有一處刻意的嚴格性差異：掛鉤誤用——未知或延遲的選項（`effort`/`isolation`/`agentType`）、格式錯誤的參數、超出支持子集的 schema、觸發上限、seam 啟動失敗——會拋出帶 `fatal: true` 的 `WorkflowError`，組合器會重新拋出 fatal 錯誤而非將 item 置為 null。如果不這樣做，一個拼錯的選項會悄然變成一個與子 agent 失敗無法區分的 `null`——這正是本倉庫禁止的「被接受後被忽略」的失敗模式。另有一處新增：工具的 `args` 參數是一個 JSON 對象（裸清單被包裝為一個欄位），使協定格式（wire format）保持誠實。

### seam（dsh-workflow）

`ctx.workflowEngine` 是 bash 形態的抽象 `WorkflowEngine`——每個上下文一個引擎，無命名提供方登錄檔（引擎是部署級替換，不是共存者）。`start(request)` 對無法啟動的指令碼同步拋出；返回的 `WorkflowRun` 的 `result` 永不 reject（失敗時結帳為 `stopReason: 'error' | 'cancelled'`）。`workflow/*` 事件是僅觀察的 emit，攜帶資料快照（id + meta；`workflow/end` 省略 result 值），按監聽器隔離，與 `subagent/start`/`subagent/end` 對稱——控制權留在 run 的持有者手中。詞彙詳情見 [subsystems/workflow.md](../../../../docs/subsystems/workflow.md)。

### 引擎（dsh-workflow-worker-thread）：每次執行一個 worker 執行緒

**信任前提**：工作流程指令碼與模型的 bash 訪問具有相同的信任等級。引擎會約束有缺陷指令碼的影響，並保證結果已 settled、值可安全表示為 JSON、取消後完全靜止；它不防禦惡意程式碼。vm 上下文和 worker 執行緒不是安全邊界：指令碼可以逃逸到具有行程級權限的 Node API。沙盒化需要在此 seam 背後使用獨立行程或 isolated-vm 引擎。

**為何選擇 `node:worker_threads`**：每次執行獲得一個非池化的 worker。vm 上下文限定了文件中說明的指令碼 API，而訊息埠 RPC 將 `agent()` 橋接到宿主側的子迴圈。worker 防止指令碼的同步工作阻塞宿主，提供序列化邊界，並允許取消後強制終止。`isolated-vm` 因其維護狀態和部署要求被否決。

宿主在發布前校驗元資料並解析正文。私有枚舉鍵 payload 對映定義協定格式；待啟動記錄、已發布子記錄、單一取消訊號、worker 死亡回收、結果優先級與 dispose（資源釋放）時的完全靜止，在此協議上保持 subagent run 約定。這些競態演算法由 [agent 作用域執行時期設計 Agent Note](../architecture/2026-07-12-agent-scope-runtime-design.md#workflow-children-are-pending-starts-or-published-records) 定義。

引擎暴露一條行程內 `MessageChannel` 測試路徑，因為主行程 V8 覆蓋率無法觀測 worker 執行。

**Meta 是資料**：經 schema 校驗的 `meta` 欄位以 JSON 形式到達 seam，僅做形狀校驗。宿主從不執行元資料字面量，否則指令碼控制的訪問器可以在 worker 隔離之外執行。

**值邊界**：`materializeFromRealm` 複製出站值，並拒絕函式、symbol、巢狀 `undefined`、異域原型、迴圈引用、稀疏陣列和非有限數字。資料屬性複製使 `"__proto__"` 安全；getter 正常讀取，拋出例外的 getter 會明確報錯。`args` 透過 `workerData` 傳入，暴露前再次克隆。realm 函式被呼叫而非複製，拋出的值使用對所有輸入均有定義的渲染器，因此 `result` 不會 reject。掛鉤錯誤是宿主 realm 的 `WorkflowError`，指令碼應基於 `name` 或 `code` 分支而非 `instanceof Error`，如引擎 README 所述。並行、total-agent、item、逾時和寬限限制均為經校驗的設定。

### Consumer（`dsh-tool-workflow`）

一個 `workflow` 工具，映像檔 `dsh-tool-subagent` 的同步形態：啟動、await、`try/finally` dispose、abort 橋接 `exec.signal`、非 `completed` → `isError`。渲染意圖：一張以呼叫的 `meta.name` 參數為標題的 `generic` 卡片（展示是參數的純函式）。工具描述即面向模型的編寫規範。使用策略以工具自身的 `tool:<toolName>` 提示詞段落隨工具發布（顯式請求才使用的引導——工具引導存在於工具外掛程式中，從不在部署 persona 中）；harness 沒有 ultracode 風格的 effort 門控。

對於頂層工具執行，同一消費端還會把執行及實際成員生命週期寫入呼叫方父 Session，形成四類 log-only `tool-workflow/*` 事件。記錄路徑只觀察、不控制執行：第一次 append 失敗會停用本執行後續寫入並留下合法前綴，不改變工具結果。[`ui-workflow-run`](../../../../packages/client/ui-workflow-run/README.md) 透過 Conversation Node 引擎重建這些事實，形成獨立 keyed Chat 行；現有 generic 工具行繼續擁有自己的展示。持久化、重播、展開/收起與即時導覽的詳細決策見 [Chat 中的持久工作流程執行](2026-08-10-durable-workflow-runs-in-chat.md)。

### 基礎：subagent seam 上的結構化輸出

`SubagentStartRequest.outputSchema` 由 `dsh-subagent-in-process-driver` 為兩個行程內後端實作。每個結構化子 agent 在 `child.ctx` 上獲得自己的作用域捕獲工具、指令和強制註冊；並行子 agent 可以使用不同的 schema 而不共享可變策略，dispose 子 agent 時移除整個附件。

輸出 schema 使一次 schema 有效的已提交捕獲成為子 agent 成功完成的必要條件。作用域執行時期呈現捕獲工具和指令，僅提交成功的最終結果（包括 SDK 呼叫時外層 `run_code` 的結果），在捕獲變為 pending 後拒絕後續副作用，並在提交後不再進行模型步驟即停止子 agent。校驗失敗仍是可重試的工具錯誤；沒有已提交捕獲的正常完成以錯誤結帳。

`ObjectJsonSchema` 是 `dsh-tools` 統一且可強制執行的原始 JSON Schema 子集所提供的對象根消費端檢視表；不支持的關鍵字會明確報錯，因為該協議資料會逐字成為捕獲工具的 parameters。[統一 JSON 值 schema Agent Note](../architecture/2026-07-20-unified-json-value-schema-dsl.md)定義詞彙與校驗語義，[agent 作用域執行時期設計 Agent Note](../architecture/2026-07-12-agent-scope-runtime-design.md#structured-output-commits-only-authoritative-outcomes)則定義組裝、提交、守衛和終止停止演算法。

## 測試

worker 側邏輯透過行程內 `MessageChannel` 執行，使 V8 覆蓋率能夠度量它。單元測試覆蓋指令碼輔助函式、fatal 與 nullable 失敗、JSON 邊界、上限、取消、子 agent 所有權和透過真實迴圈的結構化輸出。建置後二進位檔案的冒煙測試在純 Node 下執行單獨打包的 `lib/worker.cjs`，帶金鑰的 e2e 驅動程式真實子 agent，面向模型的工作流程行為透過其所屬示例進行快照覆蓋。

## 延遲（明確的非目標）

- **後臺收集**（啟動工具 → run id → 完成通知 → 收集），與 shell/subagent 後臺統一一起設計。
- **日誌化 + 復原**（`resumeFromRunId`、快取的 agent() 前綴）：實作它會以指令碼約定收緊的形式重新引入 CC 的確定性禁令（指令碼目前可以讀取時鐘）。
- **保存／打包的工作流程**（`.deepseek/workflows/` 登錄檔、斜槓命令 API）和**指令碼持久化到執行目錄**（工具呼叫事件已經持久記錄了指令碼）。
- **巢狀 `workflow()`**、**token `budget`**，以及 `effort`/`isolation`/`agentType` agent 選項（每個都會明確拒絕，並在訊息中註明其已延遲實作）。
- **整體執行的掛鐘逾時**：取消總能釋放呼叫方（result 在寬限期內 settle），因此總執行時期間上限是後臺重設計的策略旋鈕，不是此處的正確性需求。
- **超越 worker 執行緒的引擎加固**：在同一 seam 背後使用 isolated-vm 或獨立行程引擎（真正的沙盒化；記憶體限制）。
- **ACP（Agent Client Protocol）後端結構化輸出**和 **`toolFilter`**（兩者仍以能力標志 `false` 門控）。

## 曾考慮的替代方案

- **宿主側的惡意值防護**（無 trap 代理拒絕、從不呼叫訪問器的描述符遍歷、realm 側預渲染拋出值、realm 建置的 promise/array/error 克隆加結構化 fatal 識別）：否決。每項防禦針對的都是信任前提所接受的作者，而執行緒的序列化邊界已經從構造上保證跨 realm 值的處理對所有輸入都有確定結果。
- **行程內 `node:vm` 執行**：機械上最簡——無 RPC、無執行緒——但 `start()` 會在指令碼的初始同步切片期間阻塞呼叫方，第一個 await 之後的同步自旋無法在行程內終止（vm `timeout` 僅覆蓋第一個切片），且 `dispose()` 只能在宿主迴圈上放棄一個未 settle 的指令碼。worker 執行緒引擎保持相同的 vm 上下文指令碼 API，同時解除宿主阻塞並使終止成為現實。
- **後臺執行作為默認**（CC 的形態）：延遲。前臺同步與 `dsh-tool-subagent` 的當前形態一致，後臺語義應在 bash、subagent 和工作流程之間統一設計一次，而非逐工具設計。
- **工作流程層為 `agent({schema})` 做 JSON 解析**：在一個消費端重複 seam 關注點，而 seam 的能力標志仍不誠實地為 `false`。
- **Meta 嵌入指令碼中作為 `export const meta = {...}`**（CC 的確切格式）：保持指令碼自包含且 CC 指令碼可直接使用，但取得 meta 需要在宿主上執行模型編寫的文字。即使一個空的限時 vm 上下文也無法約束指令碼控制的 getter（當宿主讀取結果對象時）。JSON 參數消除了掃描器、執行和宿主自旋漏洞；代價是 CC 指令碼的 meta 頭必須移入參數（正文保持可直接使用）。
- **`ValueSchemaSpec` 作為 `outputSchema` 協議類型**：面向作者的形式如今具有等價詞彙，但工作流程提供的是來自其他 realm 的原始 JSON Schema 資料；將這類執行時期資料假裝成可信的作者聲明，會跳過原始 schema 斷言邊界。
- **schema 對象庫（zod 或本倉庫的 schemastery）用於結構化輸出子集**：schema 是協議資料——純 JSON，跨越 `agent({schema})` 中的 vm realm 邊界並逐字落入強制工具的 parameters——正是活 schema 對象無法存在的位置；在執行時期消費原始 JSON Schema 需要在其上加一個第三方轉接器（zod core 只輸出 JSON Schema，不能反向），且會在 schemastery 的設定角色旁邊放置第二種 schema 語言。
- **ajv 用於值校驗**：它校驗完整 JSON Schema，因此子集門控——模組的真正要點，因為每個被接受的關鍵字都必須是 harness 強制執行的——無論如何仍需手寫；它透過 `new Function` 編譯校驗器；且它將成為 dsh-tools 的第一個執行時期相依性，僅為替換約 70 行的值遍歷器，而帶路徑且逐一報告所有違規的錯誤報告無論如何都是自訂的。
- **提供方 JSON 模式代替捕獲工具**：它保證 JSON 有效，但不保證其符合 schema，且它與工具呼叫的互動不明確。捕獲工具保留了輪次內的校驗重試。提供方側的嚴格工具 schema 後續可以在不改變本設計的情況下收窄接受的子集。

## 後果

扇出計畫現在存在於可重執行的指令碼中，`outputSchema` 提供權威的結構化子 agent 結果。每次執行付出 worker 啟動和訊息埠 RPC 成本，但宿主啟動保持非阻塞，取消可以終止 worker，序列化強制執行值邊界。worker 執行緒不是安全邊界。無效選項會失敗而非退化為 Claude Code 的 `null`；消費端透過 run handle 保持控制權，觀察者僅接收快照。頂層 Web 使用者還會得到持久、可重播的工作流程記錄，同時不擴寬執行 seam，也不把原工具卡耦合到工作流程專屬 UI。
