# Agent Note: 檔案系統能力 seam——ctx.fs、本機後端與面向模型的檔案系統工具

Status: implemented

[English](2026-06-17-filesystem-capability-seam.md) | [简体中文](2026-06-17-filesystem-capability-seam.zh.md) | 繁體中文

## 問題

harness 已有一個具體的 `bash` 能力 seam（`dsh-shell` / `dsh-bash-local` / `dsh-tool-bash`），但檔案系統操作當時即將作為面向模型的工具落地，卻沒有等價的 seam。如果 `read`、`write` 和 `edit` 直接使用 `node:fs`，面向模型的工具包就會同時承擔檔案系統執行策略、本機路徑解析、原子寫入行為、文字解碼、符號連結行為和編輯語義。

這把三個獨立變化的關注點耦合在了一起：

1. 檔案系統約定：外掛程式可以請求哪些操作。
2. 後端：當前是本機磁碟，未來可能是沙盒/遠端/項目作用域的檔案系統。
3. 消費端 API：面向模型的 `read` / `write` / `edit` schema 與結果格式化。

如果沒有 `ctx.fs` 介面，將本機檔案系統訪問替換為沙盒或遠端後端時，即使面向模型的約定應當保持穩定，工具 schema、演示和提示詞引導也會被迫變動。這還使權限/沙盒邊界更難推理：一個 `cwd` 選項看起來像沙盒，但除非有顯式的後端或 `tools/execute` 策略強制執行路徑包含約束，否則它只是一個基礎路徑。

檔案系統工具必須在成為公開包（package）介面之前，以與 bash 相同的能力 seam 形態落地。

## 決策

檔案系統訪問是一個一等的能力 seam，遵循[能力 seam Agent Note](2026-06-13-capability-seams.md)：

1. `@deepseek-ai/dsh-fs`（`packages/fs/fs`）擁有抽象的 `ctx.fs` 服務、檔案系統詞彙類型，以及 `fs/*` 策略事件詞彙。
2. `@deepseek-ai/dsh-fs-local`（`packages/fs/fs-local`）提供第一個實作，以本機檔案系統為後端。
3. `@deepseek-ai/dsh-tool-fs`（`packages/fs/tool-fs`）透過 `ctx.fs` 提供面向模型的 `read`、`write` 和 `edit` 工具，是分發 `fs/*` 事件的執行器。

Consumer 包僅相依性 Service Definition 包，從不相依性 `dsh-fs-local`。需要不同後端的部署只需為 `ctx.fs` 載入不同的提供方，無需改動工具 schema 或面向模型的提示詞引導。

讀後寫/編輯與觀測狀態策略是第四個包 `@deepseek-ai/dsh-fs-observation-policy`（`packages/fs/fs-observation-policy`），透過 `fs/*` 事件門控貢獻，而非掛在 `ctx.fs` 上；載入 `dsh-tool-fs` 的部署同時載入 `dsh-fs-observation-policy` 以獲得讀後寫/編輯能力。本決策確立了由三個包構成的邊界；策略從提供方基類拆出的決策由 [拆分檔案系統 seam Agent Note](../simplification/2026-06-26-fsspec-style-fs-seam.md) 做出，其以事件門控外掛程式（而非方法服務）實作的方式由 [事件門控 Agent Note](2026-06-26-file-context-as-event-gate.md) 做出。

第一個後端有意僅限本機：`dsh-fs-local` 基於宿主檔案系統實作 `ctx.fs`。未來的兄弟後端可在同一介面之後提供沙盒、遠端、虛擬或項目作用域的檔案系統。

第一個消費端有意僅限文字文件：`dsh-tool-fs` 暴露面向模型的 `read`、`write` 和 `edit` 工具，處理 UTF-8 文字文件。未來的消費端可以新增目錄清單、搜尋/glob、二進位安全操作、文件監視或更高層的項目操作，只要 `ctx.fs` 上存在所需能力，就無需改動本機後端包。直接目錄清單後來由[為檔案系統 seam 新增直接目錄列舉能力](../../archived/architecture/2026-07-03-filesystem-directory-listing-seam.md)新增。

檔案系統權限和沙盒並非此拆分所隱含。本機後端從其設定的基目錄解析相對路徑，但路徑包含約束策略是獨立的決策：要麼由更嚴格的 `ctx.fs` 實作強制執行，要麼由權限/沙盒外掛程式包裝 `tools/execute` 並在呼叫到達消費端之前否決。

讀後寫/編輯與觀測狀態屬於 `dsh-fs-observation-policy`，而非 `ctx.fs`。透過 `fs/*` 事件門控，策略按不透明 actor 記錄版本，並提供選填的變更期望；提供方原子性地強制新鮮度。`dsh-tool-fs` 寄出事件但不相依性策略。見[拆分檔案系統 seam](../simplification/2026-06-26-fsspec-style-fs-seam.md)和[事件門控外掛程式](2026-06-26-file-context-as-event-gate.md) Agent Note。

## 包拓撲

檔案系統 seam 使用與 bash 三件套相同的相依性方向：

```text
@deepseek-ai/dsh-tool-fs  --depends on-->  @deepseek-ai/dsh-fs  <--depends on--  @deepseek-ai/dsh-fs-local
        consumer                                interface                         implementation
```

`@deepseek-ai/dsh-fs` 僅相依性 `cordis` 加上來自 `@deepseek-ai/dsh-llm` 的倉庫級 `HarnessError` 基類。它聲明 `ctx.fs` 鍵、抽象 `FileSystem` 服務、後端和消費端共享的詞彙類型、檔案系統錯誤詞彙，以及 `fs/*` 策略事件詞彙。它不持有觀測狀態儲存，也不持有 owner 推導形態；事件傳遞一個不透明的 `object` actor，提供方從不讀取它，`dsh-fs-observation-policy` 外掛程式在這些事件之上擁有 owner 推導形態和觀測狀態儲存。

`@deepseek-ai/dsh-fs-local` 相依性 `@deepseek-ai/dsh-fs` 和 `cordis`。它繼承 `FileSystem`，將自身註冊為 `ctx.fs`，擁有本機後端設定（如基目錄），並包含所有直接的 `node:fs` / `node:path` 訪問。它不持有觀測狀態儲存——新鮮度是後端鑄造、策略外掛程式記錄的版本權杖。

`@deepseek-ai/dsh-tool-fs` 相依性 `@deepseek-ai/dsh-fs`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-system-prompt` 和 `cordis`。它註冊面向模型的工具和提示詞段落。它禁止匯入 `node:fs`、`node:path` 或 `@deepseek-ai/dsh-fs-local`；檔案系統執行始終透過 `ctx.fs`。如果實作需要具體的 agent（代理）或工作階段輔助類型，這些相依性屬於 `tool-fs`；它們禁止回漏到 `dsh-fs` 中。

根 `tool-fs` 外掛程式透過組合各工具的註冊輔助函式來註冊完整的檔案系統工具套件（`read`、`write` 和 `edit`）。它注入 `fs`，從不匯入 Service Provider 包。

## `ctx.fs` 約定

`@deepseek-ai/dsh-fs` 擁有一個語義檔案系統服務。它比 `readFile` / `writeFile` 更高層，這樣 `tool-fs` 就不必重新實作路徑解析、版本管理、文字解碼、二進位拒絕、分頁、原子替換、符號連結行為或字面編輯語義。

該介面涵蓋以下語義操作：

- 將模型/外掛程式提供的路徑解析為後端定義的目標。
- 將解析後的目標轉換為同一執行環境的規範行程路徑或 `file:` URI，並在不解析其不透明鍵的情況下檢查包含關係。
- 取得目標元資料而不讀取文件內容。
- 讀取完整或流式 UTF-8 文字；消費端執行各自的檢視表與保留上限。
- 建立或替換一個 UTF-8 文字文件。
- 透過字面替換編輯一個已有的 UTF-8 文字文件。

提供方約定還攜帶策略所相依性的新鮮度掛鉤——但觀測狀態儲存和 owner 推導位於 `dsh-fs-observation-policy` 外掛程式中，而非 `ctx.fs` 上：

- 後端為每個目標鑄造一個不透明的 `version` 權杖（在 `stat` 以及每次讀取/變更結果中）。
- `writeText`/`editText` 接受一個選填的版本期望：省略它表示無條件的裸提供方變更；提供它則在後端的原子臨界區內守護變更。
- `dsh-fs-observation-policy` 外掛程式在 `fs/write-intent`/`fs/edit-intent` 上決定該期望，並在 `fs/observed` 上記錄觀測版本，以它從不透明事件 actor 推匯出的 owner 為鍵（通常是 `exec.agent.session`）。

授權基於版本新鮮度，而非完整/部分檢視表的區分：任何讀取都會記錄目標的版本，後續的寫入/編輯只要文件仍處於該版本就被授權——因此對第 100-150 行的視窗化讀取可以授權對第 120 行的編輯。觀測狀態儲存是 `dsh-fs-observation-policy` 內部的 `WeakMap<owner, Map<targetKey, version>>`；`dsh-fs` 不持有任何此類資料，並將 actor 視為不透明。（本決策最初建模了一個帶 `full`/`partial` 檢視表的 `FileState` 快取放在 `ctx.fs` 上；拆分檔案系統 seam 與事件門控兩份筆記將其替換為此處描述的基於新鮮度的策略外掛程式。）

路徑解析是顯式的，允許非同步。本機解析可能只做路徑規範化，但沙盒/遠端/項目作用域的後端可能需要 I/O 才能將使用者提供的路徑解析為穩定的目標標識。

解析後的目標必須至少暴露三個概念：

- 原始輸入路徑，用於診斷。
- 不透明的 `targetKey`，用於過時守護和文件狀態尋找。本機後端可能使用類似 realpath 的鍵；遠端後端可能使用工作區 URI 或文件 id。消費端禁止解析或假設它是本機絕對路徑。
- `displayPath`，用於面向模型/UI 的輸出。根據後端不同，它可能是本機絕對路徑、工作區相對路徑或遠端 URI。

即使另一項能力共享提供方的執行環境，`targetKey` 仍保持不透明。這類消費端透過提供方的 `processPath(target)`、`fileUrl(target)` 或 `contains(parent, child)` 取得所需事實；[可移植執行環境決策](2026-07-28-portable-execution-world-consumers.md)說明這些事實為何屬於檔案系統 seam。

讀取和變更結果必須包含不透明的文件 `version`。本機後端從 bigint stat 元資料（`dev`、`ino`、`size`、`mtimeNs` 和 `ctimeNs`）派生權杖，因此同大小重寫和 inode 替換都會可靠地使消費端失效；遠端後端可以使用 revision id 或類似 hash 的權杖。`dsh-fs-observation-policy` 外掛程式記錄版本用於過時檢查；消費端可以展示相關元資料但禁止解釋版本權杖。

提供方返回已解碼的文字：`readText` 返回整個普通文字文件，`streamText` 為大文件或消費端自有的保留上限流式傳輸相同的文字語義。行視窗化、位元組上限、帶行號渲染和總行數統計歸 `dsh-tool-fs`、`dsh-lsp-stdio` 等消費端所有。提供方負責普通文件檢查、UTF-8 解碼和二進位／NUL 拒絕；它不知道行視窗、協議上限或檢視表。

觀測狀態記錄不在 `ctx.fs` 上：成功讀取後，執行器寄出 `fs/observed`，`dsh-fs-observation-policy` 外掛程式為推匯出的 owner 記錄 `{ version }`。沒有 `full`/`partial` 檢視表——任何視窗的讀取都記錄版本，新鮮度（而非檢視表完整性）授權後續的寫入/編輯。

全文件寫入建立或替換 UTF-8 文字文件。後端在支持且有文件說明時可以建立父目錄。已有的非常規目標被拒絕。`writeText` 接受一個選填期望：`createIfAbsent` 建立缺失的目標並拒絕已存在的（報 `FS_NOT_OBSERVED`，這是策略為未觀測 owner 使用的路徑）；`replaceIfVersion` 僅在目標處於觀測版本時替換，否則報 `FS_STALE_VERSION`；省略期望則為無條件的裸提供方建立或覆蓋。策略外掛程式根據 owner 的觀測狀態選擇提供哪個期望。

字面編輯是提供方原語（`editText`），而非在 `tool-fs` 中由讀取加寫入組合而成。字面匹配、重複匹配拒絕、CRLF 保留、二進位拒絕、選填的過時版本檢查和原子讀-改-寫必須一起留在後端的變更臨界區內。`editText` 接受相同的選填版本期望；過時檢查在字面匹配之前執行，因此基於舊讀取的編輯會報 `FS_STALE_VERSION`。遠端後端可以將編輯實作為原生的 compare-and-edit 操作；消費端不強制本機風格的組合。

策略外掛程式（而非 `ctx.fs`）對先前觀測進行門控：`edit` 要求 owner 有先前觀測（否則報 `FS_NOT_OBSERVED`），記錄的版本作為 CAS 基礎傳給 `editText`。在策略外掛程式缺席時，`ctx.fs` 本身是一個完整的無約束 seam（無條件寫入/編輯）；工具從不與策略方法耦合。

檔案系統約定失敗以 `FsError extends HarnessError` 拋出，工具登錄檔將其轉換為帶結構化 `{ name, code }` 元資料的 `isError` 工具結果。`dsh-fs` 擁有此詞彙，而非由每個工具各自發明訊息。錯誤碼包括 `FS_NOT_FOUND`、`FS_NOT_TEXT`、`FS_STALE_VERSION`、`FS_NOT_OBSERVED`、`FS_NOT_REGULAR_FILE`、`FS_AMBIGUOUS_EDIT`、`FS_EDIT_NOT_FOUND` 和 `FS_ABORTED`。（早期草案包含 `FS_PARTIAL_OBSERVATION`；基於新鮮度的授權沒有 partial/full 區分，因此已刪除。目錄清單相關的錯誤碼後來由[為檔案系統 seam 新增直接目錄列舉能力](../../archived/architecture/2026-07-03-filesystem-directory-listing-seam.md)新增。）

## 工具消費端行為

`@deepseek-ai/dsh-tool-fs` 是面向模型的消費端。它擁有工具名稱、JSON Schema、模型邊界的參數校驗、提示詞段落和結果格式化。它不擁有檔案系統執行。

第一個工具套件包含：

- `read`：檢查一個 UTF-8 文字文件並返回帶行號的內容與分頁引導。
- `write`：建立或完全替換一個 UTF-8 文字文件。
- `edit`：透過替換字面文字更新一個已有的 UTF-8 文字文件，默認要求唯一匹配，並允許顯式的全部替換模式。

每個工具遵循相同的執行形態：

1. 校驗並規範化模型參數。
2. 呼叫相應的 `ctx.fs` 操作。
3. 將結果格式化為面向模型的 `ContentBlock[]`。
4. 讓拋出的後端/工具錯誤流經 `ToolRuntime.execute()`，由其轉換為 `isError` 工具結果。

該包透過 `ctx.systemPrompt.section(...)` 註冊提示詞引導，透過 `ctx.tools.register(...)` 註冊 schema。工具 schema 仍透過 `SystemPrompt.assemble()` 和 `ToolRuntime.schemas()` 流入正常的提示詞組裝路徑；無需改動 agent loop（代理循環）。

工具包在後端變化時保持面向模型的約定穩定：本機後端和遠端後端內部可能以不同方式解析路徑，但 `read` / `write` / `edit` schema 不會僅因後端變化而改變。

默認部署要求在用 `write` 或 `edit` 更新已有文件之前先 `read`。`tool-fs` 不透過檢查是否執行過名為 `read` 的工具來實作這一點：它分發 `fs/write-intent`/`fs/edit-intent` 事件（將執行上下文作為不透明 actor 傳遞），`dsh-fs-observation-policy` 外掛程式推導 owner、對先前觀測進行門控並提供版本期望。任何視窗化讀取都能授權後續的寫入/編輯，只要文件未變。用 `write` 建立新文件不要求先前觀測。

根外掛程式透過組合各工具的註冊輔助函式來註冊完整套件。它注入 `fs`、`tools` 和 `systemPrompt`。

## 測試

測試遵循包邊界，而不僅是使用者可見的工具：`dsh-fs` 中的服務約定；`dsh-fs-local` 中透過 `ctx.fs` 介面測試的真實檔案系統行為（解析、符號連結、流式傳輸、二進位/UTF-8 拒絕、無條件和版本守護的寫入、字面編輯語義、行尾保留、結構化 `FsError` 錯誤碼）；`dsh-tool-fs` 中基於真實本機提供方的消費端介面（只 mock 模型/時鐘，從不 mock 協作者）；以及透過 `ctx.tools.execute()` 在有和沒有 `dsh-fs-observation-policy` 的情況下進行整合測試，透過從磁碟回讀文件來驗證世界狀態，既不信任規範值，也不信任渲染內容。觀測狀態/owner 推導策略在 `dsh-fs-observation-policy` 中測試，不在此處。

本倉庫曾踩過的防禦性模式類別被直接固定：

- **原子寫入暫存檔安全。** 寫入/編輯透過目標旁邊一個私有隨機 `0700` 目錄中的獨佔 owner-only（`'wx'`、`0o600`）暫存檔暫存，失敗時清理，最後原子 rename——與 bash spill 文件規則一致，因為可預測的 world-readable 臨時路徑招致符號連結競爭和資訊洩露。測試斷言權限，並斷言已存在的臨時路徑不會被覆蓋；此原語是 seam 的常設要求。
- **透過符號連結的 `targetKey` 同一性。** 兩個輸入路徑解析到同一 realpath 時共享一個觀測狀態條目：透過路徑 A 的 `read` 滿足透過符號連結路徑 B 的 `edit` 的讀後編輯守護，透過一個路徑的過時寫入可透過另一個路徑偵測到。
- **並行/過時競爭。** 對同一目標的兩個並行寫入/編輯操作確定性地收斂——一個成功，另一個被 `FS_STALE_VERSION` 拒絕——成功的編輯刷新記錄狀態，使同一 owner 的下一次編輯可以繼續。
- **HMR（熱模組替換）安全與 dispose（資源釋放）。** dispose 後端的 fiber 會撤回 `ctx.fs` 提供方；後續的提供方以無繼承狀態啟動。

## 曾考慮的替代方案

- **面向模型的工具直接基於 `node:fs`**：工具包將同時承擔執行策略、路徑解析、原子寫入、文字解碼和編輯語義，耦合問題部分所列的三個獨立變化的關注點，且任何後端替換都會攪動 schema。
- **單一合併包 `dsh-fs-tools`**：seam 之前的形態；以與 bash 相同的 Service Definition / Service Provider / Consumer 拆分理由否決，且合併名稱從未成為公開 API。
- **觀測狀態放在 `ctx.fs` 上**：本 Agent Note 最初落地的形態；被 [拆分檔案系統 seam Agent Note](../simplification/2026-06-26-fsspec-style-fs-seam.md) 和 [事件門控 Agent Note](2026-06-26-file-context-as-event-gate.md) 取代：沙盒/遠端後端不應繼承面向模型的觀測策略，因此提供方只保留版本權杖和選填的版本守護變更。

## 後果

**`cwd` 可能被誤認為沙盒。** 本機後端的基目錄是解析預設值，而非自動的隔離邊界。如果需要路徑包含約束，必須由後端約定或 `tools/execute` 上的權限/沙盒外掛程式強制執行。

**介面可能變得過於本機化。** 如果 `ctx.fs` 返回 `absolutePath` 之類的欄位，遠端、沙盒或虛擬後端會變得尷尬。約定應暴露顯示元資料，而不要求消費端理解宿主路徑。

**介面可能變得過於薄。** 如果 `ctx.fs` 只映像檔 `node:fs` 原語，`tool-fs` 將重新實作二進位偵測、分頁、原子寫入和編輯語義，重新製造本決策所避免的耦合。

**編輯語義天然易受競爭影響。** 字面編輯是讀-改-寫操作；守護手段是後端的原子變更臨界區加上選填的版本期望，因此並行編輯確定性地收斂——一個贏，另一個得到 `FS_STALE_VERSION`。

**觀測狀態不屬於 `ctx.fs`。** 記錄執行上下文看到了什麼是工作流程策略，而非原始檔案系統 I/O。本決策最初將其放在檔案系統 seam 內部；拆分檔案系統 seam 筆記隨後確立了沙盒/遠端後端不應繼承面向模型的觀測策略，並將其移入 `dsh-fs-observation-policy` 外掛程式。提供方約定只保留寫入/編輯安全在儲存層真正需要的東西——後端鑄造的版本權杖和選填的版本守護變更——而策略外掛程式擁有 owner 推導、觀測狀態和基於 `fs/*` 事件的讀後編輯門控。

**`resolve` 然後操作的形態每次呼叫多一次往返。** 每個工具可能先將路徑解析為 `FsTarget`，再以單獨的 `ctx.fs` 呼叫發起讀取/寫入/編輯。對本機後端來說這可以忽略（解析是記憶體中的路徑規範化），但遠端/沙盒後端可能將每步變成獨立請求，使單次 `read` 變為兩次網路往返。往返開銷重要的後端可以在內部快取或摺疊解析，同時保持可觀測約定不變。

**觀測狀態持久化被推遲。** 觀測狀態存在於記憶體中（`dsh-fs-observation-policy` 內部的 `WeakMap`），因此復原的工作階段保守地要求文件在寫入/編輯前重新讀取，直到未來的工作階段事件或持久化機制使觀測可重播。

**錯誤碼成為 seam 的一部分。** `FsError` 錯誤碼使過時版本和觀測失敗可透過既有的結構化錯誤分類體系進行機器路由。代價是 `dsh-fs` 從 `dsh-llm` 匯入共享的 `HarnessError` 基類；該相依性是有意為之且限於錯誤詞彙。

**包拆分的成本前置。** 三包拆分在只有一個後端時就增加了樣板程式碼。這是有意為之：檔案系統訪問是可能的沙盒/遠端邊界，在面向模型的工具發布後再改包 API 代價更高。
