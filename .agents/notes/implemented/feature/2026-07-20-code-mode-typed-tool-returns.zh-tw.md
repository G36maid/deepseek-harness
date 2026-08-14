# Agent Note: Code Mode 的類型化工具回傳值

Status: implemented

[English](2026-07-20-code-mode-typed-tool-returns.md) | [简体中文](2026-07-20-code-mode-typed-tool-returns.zh.md) | 繁體中文

## 問題

Code Mode 過去會把每個巢狀工具的結果從 `ContentBlock[]` 重新投影為一個字串。這樣雖然保留了適合人類閱讀的 Native 呈現，卻丟失了工具已經生成的規範結果：程序只能從自然語言中提取 job id 和動態掛載 id；結構化搜尋與工作流程結果失去原有形態；非文字塊則變為佔位符。生成的 SDK 可以描述參數，卻無論工具實際輸出為何都只能承諾 `Promise<string>`。

執行時期還把綁定值和程序最終回傳值當作展示資料。日誌和完成值分別設定上限，導致過大或無法克隆的完成值可能被替換為檢查後生成的文字，而中間值本來就不會進入模型上下文。這種設計使程序化組合產生資訊損失，也混淆了記憶體邊界與提示詞邊界。

[規範工具輸出約定](../architecture/2026-07-20-canonical-tool-output-contract.md)確立了單一、經過校驗的執行期值，並將 Native 渲染器與之分離。Code Mode 應直接消費該值，在跨越 worker 邊界時完整保留它，並且只限製程序有意返回給模型的最終輸出。

## 決策

Code Mode 是可見工具登錄檔的類型化投影。每個成功的綁定呼叫都會解析為 post-execute 策略處理後的最終規範 `JsonValue`，失敗的綁定呼叫則會以真正的 `ToolCallError` 拒絕 Promise。中間值只存在於本次執行中，並完整跨越 worker 邊界。只有外層 `run_code` 的日誌、完成值或失敗診斷會進入可設定的輸出帳本以及面向模型的 spill 管線。

本文件定義疊加在原始 [Code Mode 基礎](2026-06-15-code-mode.md)之上的回傳值與失敗約定。統一 schema 詞彙由 [JSON 值 schema DSL Agent Note](../architecture/2026-07-20-unified-json-value-schema-dsl.md)負責定義；Native 渲染與策略投影仍由規範輸出 Agent Note 負責定義。

### 生成的 SDK

每次組裝提示詞時，登錄檔都會把每個可見工具的參數 schema 及其分離的規範輸出 schema 投影為一份確定性聲明：

```ts ignore-check
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

interface ToolArgsMap {
  // one exact inferred entry per visible tool
}

interface ToolOutputMap {
  // one exact inferred entry per visible tool
}

type ToolName = keyof ToolOutputMap

declare class ToolCallError extends Error {
  readonly name: 'ToolCallError'
  readonly toolName: ToolName
}

declare const tools: {
  [K in ToolName]: (args: ToolArgsMap[K]) => Promise<ToolOutputMap[K]>
}
```

`jsonSchemaToTs()` 覆蓋統一 schema 支持的所有節點：對象、陣列、字串、數字、整數、布林值、null、無約束 JSON、標量 `enum` 與 `const`，以及 `oneOf`。提示詞生成期間，不支持的原始結構會回退為 `unknown`，而不會導致組裝失敗。工具名會保留精確鍵名，包括必須使用引號訪問的名稱。

### 綁定值與失敗

分發前，橋接層會把綁定參數快照為無損 JSON，再對分離後的值生成一次快照，供獨立的持久摘要事件使用。宿主側的值分離、執行資料的不可變處理與輸出 schema 投影均採用迭代遍歷，而不使用巢狀結構化克隆或遞迴凍結。`undefined`、非有限數、`-0`、稀疏陣列、迴圈引用、函式和非普通對象都會使該呼叫在工具執行前被拒絕。成功分發會返回 `ToolExecutionResult.value`；Native `content`、元資料和內部錯誤資訊不會傳入程序。

Code Mode 透過執行時期請求中的 `{ name: "ToolCallError", memberNameProperty: "toolName" }` 聲明其以例外拒絕 Promise 的能力。執行時期 Service Definition 只把這些名稱視為資料：worker 會動態生成並注入真正用於 `tools` 綁定失敗的構造函式，因此無需讓通用執行時期瞭解工具，`error instanceof ToolCallError` 也能成立。worker 使用模組初始化時捕獲的 Error 構造函式與屬性定義內建方法，配合原型為 null 的屬性描述符，構造失敗對象並定義其公開欄位，因此模型程式碼的修改不會把約定承諾的 reject 變成 worker 失敗。該錯誤包含標準的 `Error` 訊息和確切的 `toolName`，並有意省略 `ToolFailure.info`、錯誤程式碼與 Native 內容。這是一項用於控制流的例外約定，而不是供程序分類的失敗聯合。

綁定參數與綁定回傳值會在不可信 worker 協議的兩端重新校驗為無損 JSON，且不設位元組上限。每個分離後的值在透過結構化克隆跨越邊界前，都會編碼為扁平的前序 token 流，其傳輸結構的巢狀深度有界；接收方再以迭代方式重建該值。因此，有效應用資料的巢狀深度既不受 JavaScript 呼叫棧深度上限限制，也不受特定平臺對巢狀結構化克隆施加的上限限制。模組初始化時，worker 會捕獲自身 JavaScript 執行域中 `Array.prototype` 和 `Object.prototype` 的引用、僅用於識別其他執行域普通容器原型、可取得原生函式原始碼的內建函式，以及 JSON 邊界用於結構處理和計量的全部內建方法。屬性寫入使用原型為 null 的屬性描述符；內部的陣列與集合操作直接呼叫捕獲的方法，不會訪問可變的全域性或原型槽位。因此，即使模型程式碼替換 `Object.keys`、`Array.isArray`、集合方法、字串方法或 `Buffer.byteLength` 等輔助方法，重寫內建原型的構造函式槽位，或向 `Object.prototype` 新增形如屬性描述符的欄位，也不會改變校驗、協議傳輸或位元組計量。面向其他執行域的原生函式原始碼檢查仍會拒絕由使用者編寫、冒充 `Object` 或 `Array` 的構造函式。為保持相依性輕量，執行時期 Service Definition 將結構等價類型命名為 `CodeJsonValue`，從而無需相依性工作階段側擁有的規範類型；生成的 SDK 和工具 API 則使用 `JsonValue`。這些值不會經過提示詞截斷、上下文 spill 或持久化。因此，程序可以完整篩選已經採集的搜尋、工作流程、任務、檔案系統與 MCP 值，同時提供方和執行器的採集上限仍會實際生效。

### 外層結果與輸出帳本

執行時期接受以任意 JSON 類型為根的精確無損完成值。返回 `undefined` 表示省略完成值；返回 `null` 則是顯式結果。`run_code` 暴露規範外層值 `{ logs: string[], result?: JsonValue }`。其 Native 渲染器先輸出日誌；字串結果保持原文，其他所有 JSON 根值則使用迭代式美化渲染器。總縮排長度上限為 10 個字元，更深的子樹保持緊湊格式，既保留既有的淺層文字，又確保遍歷不受呼叫棧深度限制，且格式化輸出大小與規範 JSON 大小呈線性關係。

`WorkerThreadCodeRuntime` 以可設定的 `maxOutputBytes` 取代彼此獨立的日誌與值上限，預設值為 `67_108_864` 位元組。worker 會將已捕獲日誌序列化為 JSON 字串後的精確位元組數計入帳本，並在傳送終態訊息前，根據組合帳本的剩餘額度預檢分離後的完成值或程序例外。因此，即使拋出的字串或堆疊極大，透過 worker 埠的也只會是固定的 `output-limit` 診斷。宿主側會針對偽造流量以及 worker 無法觀察的原生管道寫入，重複執行這套面向不可信對端的帳本校驗。固定的 `CodeRunResult` 欄位名、花括號、有界的錯誤類型標籤及後續展示空白有意不計入這份可變負載帳本。這兩個階段都不會實際生成超出上限的完成值序列化結果。結果不超過上限時會保持精確。完成值無法透過無損 JSON 快照時，以 `invalid-output` 失敗；值、診斷或包含日誌的組合結果超過上限時，以 `output-limit` 失敗，而不會變成檢查格式化後或截斷的文字。

日誌會在產生時立即流出，因此執行被終止時仍可保留已經納入額度的輸出。繞過 worker 中已改寫流寫入入口的原生 stdout 和 stderr 寫入會經由彼此獨立的管道傳輸，因此執行時期在終態結帳期間仍會繼續在上限內捕獲輸出，直至 worker 完全終止，然後才組裝結果。超過上限後，執行時期會返回一個顯式的有界失敗，並攜帶可容納的已捕獲前綴。該外層結果隨後透過普通的 `run_code` 渲染與 spill 策略；策略可以保存已捕獲的文字，並暴露其設定指定的頭尾預覽。spill 層無法復原執行時期在硬上限之外拒絕的位元組。

計算時間、牆鐘時間、worker 堆記憶體、取消和每次執行使用全新 worker 的隔離仍是互相獨立的限制。外層帳本從不計入中間綁定值，因此生成快照、扁平協定格式的編碼與解碼、結構化克隆開銷，以及行程或 worker 的可用記憶體構成了這些值的實際邊界。

### 類型化控制代碼與生命週期

後臺生產方返回類型化的規範控制代碼，例如 `{ kind: 'background', jobId }`，同時保留既有的 Native 語句。已預先中止的後臺呼叫仍是失敗，因為成功輸出承諾返回 id，而此時並未建立任務。`ctx.jobs.start()` 發布 id 後，工作由任務自有的取消機制控制：外圍 `run_code` 呼叫完成，或隨後被取消，都不會終止該任務。後續程序可以把返回的 id 傳給 `job_output`；任務取消則由 `job_kill`、所有者的 dispose（資源釋放）或服務 teardown 流程負責。前臺執行仍與本次呼叫的訊號耦合。任務生命週期約定由[背景工作執行時期 Agent Note](../architecture/2026-06-20-generic-long-running-tool-runtime.md)定義。

臨時 Cordis 外掛程式遵循同一規則：`cordis_mount` 返回 `{ id, pluginName, state, provides, waitingFor }`，因此程序可以直接讀取 `mounted.id`，檢查 active 或 pending 狀態，並把該 id 傳給 `cordis_unmount`，無需解析穩定的 Native 語句。

### 持久化、元資料與 spill

巢狀分發在 `tool/code-dispatch` 上記錄子呼叫完整渲染後的 `content`/`isError`，但不會持久化規範值。`tool/result` 繼續只持久化渲染後的內容、錯誤和選填元資料。`SESSION_FORMAT_VERSION` 保持不變（預發布階段的形狀變動不遞增版本號），重播也無法重建程序的規範中間值。

不透明的 `exec.parent` token 用於標識巢狀呼叫。由於這些呼叫沒有直接對應的結果卡片，而且其規範值永遠不會進入上下文，展示元資料以及通用或工具自有的 spill 投影都會跳過它們。只有外層 `run_code` 呼叫會生成一張卡片，並且可能對 post-policy 處理後的最終展示執行 spill；`run_code` 有意既不聲明結果展示器，也不聲明展示元資料，因此 UI 配接器會透過通用的原始內容回退機制，使用持久化的 `tool/result.content` 補全該卡片。

## 測試

編譯期測試與快照測試鎖定了精確的 `ToolArgsMap`、`ToolOutputMap`、`ToolName`、schema 到 TypeScript 的覆蓋範圍以及特殊名稱。登錄檔與真實 worker 測試覆蓋標量、陣列、對象和 null 值；字串原文渲染；缺席的 `undefined`；消費端聲明、實際用於拒絕 Promise 的例外類，包括 `ToolCallError`；無效參數與完成值，包括偽裝為內建原型的偽造原型；模型程式碼修改過的 JSON 邊界全域性對象、原型方法、構造函式槽位，以及繼承而來的屬性描述符欄位；上述修改後的類型化綁定失敗；不設上限的大型中間綁定值；巢狀 spill 抑制；64 MiB 上限內外的精確計量；日誌、值與診斷的組合計量；拋出的超大堆疊；有界失敗的 spill；不可信對端偽造的流量；以及建置後包的執行。

無金鑰的真實 worker 整合測試鎖定了自然語言結果無法安全支持的兩種控制代碼工作流程。後臺 bash 呼叫返回 job id，外層執行結束，之後的執行再根據該 id 輪詢直至任務完成；其他用例分別證明，預先中止不會建立任務、發布後的呼叫取消會保留任務、前臺執行仍與訊號耦合，並且由 `job_kill` 負責取消。Cordis 程序會直接讀取 active 或 pending 掛載的 id 和 `waitingFor` 欄位，按該 id 解除安裝，並在不解析渲染文字的情況下確認掛載已移除。

## 考慮過的替代方案

**返回 Native 文字並附加選填 JSON：**不予採納。程序會面對兩套相互競爭的成功約定；選填值不存在時，仍需使用工具專屬的解析規則。規範值纔是 API；Native 內容只是它的展示。

**讓每個綁定返回成功／失敗聯合：**不予採納。失敗沒有穩定的程序化分類體系。reject 保留普通的 `try`／`catch` 控制流，並且只暴露工具名與可供人閱讀的訊息。

**限制每個中間綁定值：**不予採納。中間值不會進入模型上下文，任意截斷會破壞程序化組合。明確的邊界仍是生產方的採集約定與行程記憶體。

**靜默檢查格式化或截斷過大的完成值：**不予採納。把 JSON 值改成字串既有損又違反類型。顯式的 `output-limit` 失敗讓模型可以選擇返回更小的結果，而保留的日誌和診斷仍可使用普通的外層 spill 機制。

## 後果

Code Mode 程序可以透過穩定值組合工具，無需逆向解析 Native 自然語言。Native 和 Both Mode 保留現有文字與 UI 展示，Code Mode 則獲得輸出 schema 類型和精確的執行時期 JSON。工具作者必須把規範值視為程序化 API，並將僅用於展示的格式化放入渲染器。

worker 會以巢狀深度有界的扁平協定格式傳輸資料並執行無損校驗，但不會降低中間值的開銷，也不會使其具備持久性。外層輸出溢位會顯式導致執行失敗，錯誤處理則有意由人類引導，而不是相依性帶版本的錯誤程式碼聯合。

## 已知限制與暫緩事項

- 即使工具輸出可以採用任意 JSON 根，subagent 和工作流程中由呼叫方定義的結構化輸出仍透過消費端等級的閘門保持對象根限制。
- Post-execute 分別提供值投影與展示投影；替換內容不是保密機制，因此策略若需向程序化呼叫方隱藏內容，就必須阻止呼叫或替換值。
- 中間規範值僅存在於執行期間，無法用於重播，因為持久事件只儲存展示和有界摘要。
- 中間值沒有位元組上限，可能因值的保留、扁平協定格式副本或結構化克隆開銷而耗盡行程或 worker 記憶體。
- 64 MiB 硬上限只適用於外層可變負載，不計固定的結果封裝文法與展示空白；spill 無法復原超出該上限後被拒絕的位元組。
- 提供方或執行器的採集上限可能在規範值到達 Code Mode 前就已丟棄部分源資料。
- 不支持的 MCP 輸出 schema 會回退為 `JsonValue`；更豐富的 Native 多媒體投影留待後續實作。
- 每個外層 `run_code` 只有一張結果卡片，巢狀呼叫不會各自生成卡片。
- Code Mode 失敗只暴露 `ToolCallError` 的訊息與工具名，不提供程序可用的錯誤程式碼聯合。
