# @deepseek-ai/dsh-tool-lsp

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

面向模型的 **`lsp` 工具**，基於 `ctx.lsp`：一個只讀工具，透過四種操作執行精確程式碼導覽。它擁有模型 schema、提示詞指引、坐標轉換、結果限制與格式化，以及 UI 呈現；不匯入任何提供方。

Namespace 外掛程式（`name`／`inject`／`Config`／`apply`，無默認匯出）。注入 `tools`、`lsp` 和 `systemPrompt`。

## 工具

`lsp` 接受 `operation`（`goToDefinition` | `findReferences` | `goToImplementation` | `hover`）、`file_path`、`line` 和 `character`。`line` 與 `character` 是正的、從 1 開始的 UTF-16 遊標坐標；工具將其轉換為 seam 從零開始的位置，並把渲染位置轉換回來。`findReferences` 包含聲明，因此影響分析不會遺漏定義位置。提供方、language id、工作區根目錄、限制、逾時、初始化和可執行文件均不進入模型輸入。

該工具要求從工作階段 `header.cwd` 取得工作區根目錄，沒有回退值：缺失時會在查詢前以 `LSP_WORKSPACE_REQUIRED` 失敗。其規範結果是完整的已規範化 Service Definition 聯合類型：`{ kind: "locations", locations, resolvedWorkspaceUri }` 或 `{ kind: "hover", hover }`；Code Mode 可以直接檢查每個已取得的位置和從零開始的範圍。原生渲染以提供方的規範工作區 URI 為基準，投影按文件穩定分組的 `path:line:character` 條目，而不對工作階段 cwd 應用宿主平臺路徑規則。`file:` URI 落在該工作區 URI 內時成為工作區相對路徑，位於其外時成為從 URI 派生的絕對路徑；格式錯誤的 URI 與非 `file:` URI 保持原樣。空位置和 `null` hover 都是成功的無結果回應；格式錯誤的提供方載荷仍是結構化錯誤。

## 設定

| Key | 預設值 | 含義 |
|---|---|---|
| `maxLocations` | `100` | 出現省略標記前可渲染位置的最大數量。 |
| `maxResultChars` | `16000` | 完整渲染結果的最大長度，包括截斷元資料。 |
| `timeoutMs` | `60000` | 由 `dsh-tool-call-timeout-policy` 強制執行的工具呼叫逾時預算；覆蓋完整的排隊打開／查詢／關閉生命週期，且模型不可設定。 |

## 模型體驗

### 系統提示詞

#### 模型看到的內容

一個系統提示詞區段（順序 112）將 LSP 定位為精確輔助工具，文字如下：

##### 逐字指引

```markdown
Use search/read for ordinary navigation. Use lsp when textual matches are ambiguous or before a change requires precise definitions, implementations, or references. Positions are one-based line and character (UTF-16) at the cursor; an off-symbol position may return no results. findReferences always includes the declaration.
```

#### Token 影響

外掛程式處於活躍狀態時，每次請求承擔固定指引成本。

#### KV Cache 影響

只要外掛程式 scope 與指引文字不變，前綴就保持穩定；啟用或 dispose（資源釋放）可能使從該區段起的複用失效。

### 工具 schema

#### 模型看到的內容

模型會看到生成的 [`lsp` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-lsp)。

#### Token 影響

啟用期間，每次請求承擔固定 schema 成本；`timeoutMs` 預算絕不會發給模型。

#### KV Cache 影響

只要可見工具定義與順序不變，前綴就保持穩定；註冊生命週期或 scope 限制可能使從第一個變化的 schema token 起的複用失效。

### 結果

#### 模型看到的內容

按文件分組的 `path:line:character` 位置行或規範化 hover 文字，先由 `maxLocations` 限制，再由 `maxResultChars` 限制；省略與截斷標記計入完整字元上限。這些上限隻影響原生／模型呈現，不影響規範值。空結果使用不同的 `No results.`／`No hover information.` 行。

#### Token 影響

每項工具結果以 `maxResultChars` 為上限，`maxLocations` 還會限制導覽項數量。

#### KV Cache 影響

工具結果追加在已快取請求前綴之後，不會直接使其失效。

### UI 呈現

#### 模型看到的內容

無。用戶端渲染通用搜尋卡片：`{ card: 'generic', kind: 'search', title, locations: [{ path, line }] }`；從 args 派生的標題攜帶操作與從 1 開始的遊標，跟隨焦點對準查詢行，標題則保留列號。

#### Token 影響

直接 token 影響為零，因為渲染只發生在用戶端。

#### KV Cache 影響

無；UI 呈現位於模型請求之外。

## 已知限制與暫緩事項

- **UTF-16 遊標坐標**：列坐標與協議精確一致，但模型難以在非 BMP 字元周圍計數；未落在符號上的位置可能返回空結果，因此提示詞解釋了該約定，但不鼓勵廣泛使用 LSP（見 [seam Agent Note](../../../.agents/notes/implemented/architecture/2026-07-15-lsp-capability-seam.md)）。
- **不承諾跨伺服器完整性**：受支持的伺服器仍可能根據索引就緒情況返回空或部分結果；該工具不承諾跨語言或伺服器的完整性。
