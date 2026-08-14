# @deepseek-ai/dsh-typert-registry

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

生成的 Typert 產物所用的執行時期登錄檔。每個註冊項包含某個包在一個 face 上的業務反射資訊，以及選填的執行時期 Zod schema；`ctx.typert` 會以原子方式同時註冊兩者，並在發起呼叫的 Cordis fiber 釋放時一並移除它們。TypeScript 分析和程式碼生成由 [`dsh-typert-generator`](../generator/README.md) 負責。

包反射資訊以 `<package>#<face>` 為鍵。schema 以 `<package>#<name>` 為鍵，並保留生成方的 Zod 實例。系統按需在消費端邊界計算 JSON Schema。

## 公開 API

- `TypertRegistry` 是預設外掛程式，並提供 `ctx.typert`。
- `ctx.typert.lookups.register()` 註冊由業務包擁有的協定聲明和預設解析器；`configure()` 註冊由宿主組合擁有且可非同步執行的解析器。兩者的生命週期相互獨立：設定可以先於提供方註冊，解除安裝設定會復原預設策略。
- `ctx.typert.contexts.registerHost()` 和 `configureHost()` 對具作用域的上下文身份採用同樣的所有權劃分；`registerClient()` 提供對應的用戶端上下文綁定器。
- `register(contribution)` 會在提交任何內容之前拒絕格式錯誤的標識，以及重複的包與 face 組合鍵或 schema 鍵，隨後返回 Cordis effect 提供的同一資源釋放函式。
- `get(key)`、`resolve(key)` 和 `list(filter?)` 查詢當前有效的 schema。`resolve()` 能區分格式錯誤的鍵、未註冊的包，以及已註冊但未以該名稱提供 schema 的包。
- `getPackage(packageName, face?)` 和 `listPackages(filter?)` 查詢生成的服務、事件和對象反射資訊；預設 face 為 `host`。
- `toJSONSchema(key, params?)` 使用 `z.toJSONSchema()` 投影當前有效的 schema，且不快取結果。
- `typertKey()` 和 `typertPackageKey()` 構造兩種穩定的標識形式。

`@deepseek-ai/dsh-typert-registry/types` 子路徑包含註冊項和記錄的純類型約定。[`dsh-typert-loader`](../loader/README.md) 會在 Loader 組閤中發現並註冊生成的宿主側產物；其他組合所有者可以直接呼叫 `ctx.typert.register()`。

## 模型體驗

無。登錄檔不會提供提示詞、工具或工作階段事件；所有模型可見投影均由 `cordis_inspect` 等消費端負責。

#### KV Cache 影響

無直接影響。將反射資訊放入請求的消費端負責由此產生的前綴變化。

## 已知限制與暫緩事項

- 登錄檔儲存生成的反射資訊，但不會合並宿主側與用戶端側的圖，也不會解析 TypeScript 引用；這些由分析器和產物輸出器負責。
- schema 鍵不包含 face，因為宿主側和用戶端側在不同的上下文中執行。若在同一上下文中註冊來自兩個 face 的同名 schema，系統會將其作為重複項拒絕。
