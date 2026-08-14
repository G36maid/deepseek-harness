# Agent Note: 模型邊界處的執行時期參數校驗

Status: implemented

[English](2026-06-11-runtime-arg-validation.md) | 繁體中文

## 問題

`defineTool`（[統一 schema DSL](2026-07-20-unified-json-value-schema-dsl.md)）為工具作者的 `execute(args)` 提供了經 `InferArgs<S>` 對映的類型化參數。但該類型只是對執行時期值的編譯期聲明，而這個值實際上是模型生成的 JSON：沒有任何機制強制模型遵守 schema，因此畸形呼叫（缺少必需鍵、聲明為數字的位置傳入字串，或字面量超出聲明的集合）會以「僅在名義上類型化」的狀態到達 `execute`。工具函式體隨後要麼在處理結構錯誤的資料時崩潰，要麼在不報錯的情況下行為例外。

## 決策

`validateArgs(spec, args): string[]` 編譯 `ParameterSchemaSpec`，並委託共享的 `validateJsonSchemaValue()` 遍歷器，對格式正確的聲明返回可讀的違規清單。`defineTool` 在定義時對編譯後的參數 schema 建立快照，並在呼叫類型化函式體之前執行校驗；存在違規時會拋出 `ToolArgsError`（`INVALID_ARGS`），登錄檔將其作為模型可據以修正的錯誤結果返回。

校驗器與編譯器因此共享完全一致的語義：隱式參數根是開放對象；必需鍵僅來自 `required: true`；預設值仍是註解；顯式巢狀對象遵循其聲明的開放性；陣列透過 `items` 遞迴校驗；標量字面量約束保證類型正確；`oneOf` 僅在恰好一個分支匹配時才接受。直接註冊的工具自行負責輸入校驗。

## 後果

- 模型會收到有關自身畸形呼叫的可操作回饋，而不是遭遇不透明的崩潰，彌合了 `InferArgs` 的承諾與執行時期現實之間的鴻溝。
- 校驗器與 `InferArgs` 必須保持一致；一項[屬性測試](../testing/2026-06-11-property-based-testing.md)生成滿足 spec 的參數並斷言它們透過 `validateArgs`（同時透過針對性改壞參數來斷言其會被拒絕），透過自動化檢查消除這種漂移風險。
- `ToolArgsError` 是[結構化錯誤分類體系](2026-06-11-structured-error-taxonomy.md)中 `HarnessError` 的子類，保留其 `code` 欄位；讀取 `.message` 的呼叫方不受該層級結構影響。
- 校驗開銷相對於一次模型呼叫可忽略不計。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
