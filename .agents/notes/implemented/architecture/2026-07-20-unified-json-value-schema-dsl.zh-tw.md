# Agent Note: 統一 JSON 值 schema DSL

Status: implemented

[English](2026-07-20-unified-json-value-schema-dsl.md) | [简体中文](2026-07-20-unified-json-value-schema-dsl.zh.md) | 繁體中文

## 問題

工具參數使用一套精簡的作者側 schema DSL，subagent／工作流程的結構化輸出則使用另一套原始 JSON Schema 子集和校驗器。兩套詞彙在根類型、標量約束和校驗方式上並不一致；如果繼續沿用這種劃分，類型化的規範工具輸出約定要麼還需重複實作兩條路徑，要麼只能接受部分投影無法強制執行的 schema。

## 決策

`dsh-tools` 以兩種表示形式統一管理一套 JSON 值 schema 詞彙。`ValueSchemaSpec` 是可描述任意 JSON 根類型的作者側形式；`ParameterSchemaSpec` 是其隱式對象屬性對映形式，每個屬性可標記 `required: true`。`JsonSchemaNode` 是原始協議形式。兩種形式都支持字串、有限數值、整數、布林值、null、陣列、對象、類型正確的標量 `enum`／`const`，以及要求恰好匹配一個分支的 `oneOf`；`{ type: 'json' }` 僅是作者側文法糖，會編譯為僅含註解、不施加約束的原始節點。

顯式的作者側對象必須聲明 `additionalProperties: true | false`。隱式參數根對象和原始 JSON Schema 保留標準的默認開放語義。schema 記錄只能包含自有且可枚舉的字串鍵，schema 陣列必須是稠密的內建陣列，系統只從自有屬性讀取受支持的關鍵字；因此，自訂原型、繼承的約束、symbol 和 JSON 不可見的附加內容都無法讓編譯、投影和校驗觀察到不同的聲明。內建的普通 Object 和 Array 容器跨 JavaScript 執行域後仍視為普通容器，而子類和偽造構造函式的原型仍視為非普通對象。

`InferValue<S>` 和 `InferArgs<P>` 根據同一份聲明推導 TypeScript 值，`valueSchemaSpecToJsonSchema()` 和 `parameterSchemaSpecToJsonSchema()` 也將這些聲明編譯為 JSON Schema。精確類型推導以 16 層容器為界，超過後使用 `JsonValue`，從而避免 TypeScript 的類型實例化棧限制作者能聲明的巢狀深度。`assertSupportedJsonSchema()` 會拒絕不受支持或位置錯誤的關鍵字；`validateJsonSchemaValue()` 則以無損 `JsonValue` 邊界校驗受支持的子集，不允許 `undefined`、負零、非有限數、稀疏陣列、迴圈引用、非普通對象、函式、symbol 及其他需要強制轉換的值。作者側 schema 編譯、原始 schema 斷言、值校驗、schema 到 TypeScript 的渲染、登錄檔脫離引用，以及動態 Cordis 的跨執行域規範化與克隆均使用顯式工作棧，因此執行時期巢狀只受可用記憶體限制，不受 JavaScript 呼叫棧限制。

對象根限制屬於消費端規則，不屬於 schema 詞彙本身。subagent 和工作流程中由呼叫方定義的結構化輸出透過 `assertObjectJsonSchema()` 和 `ObjectJsonSchema` 保持對象根限制；工具輸出可以使用任意根類型。動態 Cordis 註冊會把跨 JavaScript 執行域傳入的 schema 重建為宿主擁有的 JSON 值，保留原始包裝層的默認開放語義，並要求直接使用 DSL 聲明的對象明確選擇開放方式，然後再呼叫同一編譯器。動態邊界會在規範化之前拒絕 JSON 不可見的記錄鍵和非普通 schema 陣列，因此不會靜默丟棄約束，也不會觸發自定義迭代邏輯。

## 備選方案

- **保留兩套獨立的參數與結構化輸出 schema 系統：**不予採納。每新增一種輸出結構，都必須分別修改類型推導、編譯、校驗和程式碼生成，而這種重複並未形成有意義的職責邊界。
- **使用 Schemastery 處理工具參數：**不予採納。Schemastery 透過 Standard Schema 面向校驗與轉換，而不是生成 JSON Schema。採用它會增加一層配接器，卻不能產出面向模型的協議 schema 或共享的輸出詞彙。
- **採用完整 JSON Schema 或 Ajv：**不予採納。harness 必須拒絕所有無法投影到生成 SDK 和校驗器中的結構；如果接受更大的語言子集，強制執行能力和模型指引就會與事實不符。
- **讓所有對象默認開放或默認封閉：**不予採納。這兩種選擇都會隱藏一項影響重大的作者決策。只有保持舊有形態的隱式參數根對象和外部原始 schema 纔有意保留預設值。
- **把 `oneOf` 定義為首個匹配分支：**不予採納。這樣一來，分支順序會改變校驗語義，重疊分支也會掩蓋值的歧義。

## 影響

- 參數校驗、輸出校驗、schema 到 TypeScript 的程式碼生成、subagent／工作流程閘門和動態註冊共用一套強制執行的詞彙。
- 輸出聲明可以推導對象、陣列、標量或 null 根類型；subagent／工作流程的結構化輸出仍在其現有服務邊界保持對象根限制。
- 顯式的對象開放方式和類型正確的字面量約束會讓格式錯誤的聲明在編寫或註冊階段快速失敗，而不是拖到後續模型呼叫時才失敗。
- 有界類型推導會為常規聲明保留有用的精確類型，並將例外深的尾部結構退化為 `JsonValue`；執行時期 schema 強制執行在任意深度仍保持精確。
- 原始工具仍可直接註冊範圍更廣的 JSON Schema，但統一程式碼生成會把不受支持的 schema 視為未知類型，不會假裝自己能夠強制執行。
- 每個屬性的 `required: true` 仍是工具作者約定；原有推導路徑暴露選填性缺陷後，類型級回歸覆蓋會鎖定必填鍵不得為選填。
- 執行時期測試和編譯期測試覆蓋所有根類型、恰好匹配一個分支時的重疊／無匹配行為、原始 schema 的默認開放語義、顯式開放方式、有損 JSON 值、類型推導、核心投影和動態投影中的深層巢狀、動態註冊中 JSON 不可見的鍵，以及非普通 schema 陣列。
