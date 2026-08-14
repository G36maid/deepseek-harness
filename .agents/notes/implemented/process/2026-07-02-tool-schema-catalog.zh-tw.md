# Agent Note: 生成的工具 schema 目錄（啟動並採集）

Status: implemented

[English](2026-07-02-tool-schema-catalog.md) | [简体中文](2026-07-02-tool-schema-catalog.zh.md) | 繁體中文

## 問題

倉庫此前沒有一份統一的參考文件來記錄實際暴露給模型的工具名稱、描述與 JSON Schema。原始碼聲明分散各處且在執行時期組合，而既有的 Cordis 參考和子系統頁面覆蓋的是接線與詞彙，而非工具。

## 決策

目錄透過**啟動每個工具外掛程式並讀取其已註冊 schema** 來生成，而不是解析原始碼。`scripts/gen-tool-catalog.ts` 在全新的 Cordis `Context` 上掛載每個已發布工具包；該上下文還提供 `SystemPrompt`、`ToolRuntime` 以及外掛程式 `apply` 所讀取的注入服務。生成器呼叫 `ctx.tools.schemas()`——也就是傳送給模型的確切 `ToolSchema[]`——隨後 dispose（資源釋放）上下文，並為每個包渲染一個 `## <package>` 章節，每個工具附帶一個 ` ```json ` `parameters` 塊。它與 `gen-cordis-catalog` / `gen-module-graph` 的 CLI 形狀一致：默認 `--write` 重新生成；提交副本過時時 `--check` 失敗；輸出具有確定性（按清單排序，工具按名稱排序）。`verify-tool-catalog`（即 `--check`）在 `doc-sync` 內執行，因此相關文件變更和 CI 會執行同一項新鮮度檢查。

### 為何啟動而非解析（核心要點）

Cordis 目錄是純 TypeScript AST 遍歷，因為每個事件/服務名都是字串字面量，可以往返對映到靜態聲明——AST 即全部事實。**工具 schema 在靜態層面不可知**，因此同樣的技術會產出一份說謊的文件：

- `tool-todo` 寫了 `enum: [...STATUSES]`——對一個執行時期 `const` 的展開。AST 看到的是展開表達式，而非 `["pending","in_progress","completed"]`。
- 每段描述都透過字串**拼接**建置（`'…' + '…'`）。AST 看到的是拼接節點，而非模型實際讀到的最終文字。
- `tool-subagent` 的工具名是 `config.toolName ?? 'subagent'`——載入時選定，並非字面量。
- MCP 外掛程式可以透過 `ctx.tools.register()` 直接註冊**原始 JSON Schema**，完全不經過 `defineTool`，因此結構化枚舉 `defineTool(` 呼叫點會遺漏。

唯一準確的真源，是外掛程式載入後登錄檔實際持有的 schema。啟動外掛程式是把[測試策略](../../../../docs/testing.md)中「驗證現實，而非自我報告」的準則應用到文件生成器：讀取已發布產物，而非重新推導一份。

### 復原「不會靜默遺漏」的保證

啟動有一項 AST 遍歷不存在的代價：沒有原始碼聲明集合可供枚舉，新工具包可能被遺忘。一個**完整性守衛**復原了這項保證——`assertManifestComplete` 對 `packages/` 下所有 `tool-*` 包進行 glob，若有任何一個不在生成器的啟動 manifest 中則直接報錯。新工具包在註冊之前會導致生成器失敗，進而導致 `doc-sync` 失敗。這與 Cordis 生成器透過枚舉原始碼免費獲得的結構性屬性相同，只是為基於啟動的生成器重新實作了一遍。

### 手動維護的啟動 manifest 是無法省去的策略

檔案系統負責發現工具包清單，完整性守衛負責拒絕遺漏。`TOOL_PACKAGES` 仍然為每個包持有一份顯式的啟動配方，因為所需的 Service Provider 和設定屬於策略，不是能從目錄版面配置或注入名稱安全推斷的事實。

### 範圍

`packages/*/tool-*` 下已發布的產品工具包，每個都使用預設配置啟動，包括 `dsh-tool-bash`（`bash`）、`dsh-tool-jobs`（`job_output`、`job_list`、`job_kill`）和 `dsh-tool-subagent`（`subagent`）。僅供示例使用的工具不在範圍內。

目錄的單位是包，而非經過設定的每個工具實例。每個包以預設配置啟動一次；載入時的別名（如 `subagent_fork`）會註明，但不枚舉所有部署設定組合。部署清單覆蓋的是一個獨立且無界的範圍。

### 使用普通 `json` 圍欄

schema 塊使用 ` ```json `，而非自訂的 `ts` 系圍欄。`doc-typecheck` 只提取 `ts*` 圍欄，因此 JSON 塊對它不可見——無需 `BlockKind` 接線（不同於 Cordis 目錄的 `ts cordis-catalog` 圍欄，後者需要加入白名單以避免裸簽名片段被編譯）。

## 曾考慮的替代方案

- **純 TypeScript AST 遍歷，如 Cordis 目錄**：工具 schema 在靜態層面不可知（見上文核心要點）：執行時期展開、字串拼接、設定選定的名稱，以及原始 `ctx.tools.register()` 註冊，都會讓 AST 推匯出的文件說謊。
- **從各包的 inject 推斷啟動配方**：屬於[發現包清單提案](../../proposed/process/2026-06-20-discover-package-inventory.md)所警告的「過度聰明」路徑；配方保持為手寫策略，清單由檔案系統發現並由完整性守衛把關。
- **為 schema 塊使用自訂 `ts` 系圍欄**：不必要。普通 ` ```json ` 圍欄對 `doc-typecheck` 不可見，無需 `BlockKind` 白名單。

## 後果

- 目錄不會發生漂移：提交文件未反映的工具 schema 變化會使 `doc-sync` 和 CI 中的 `verify-tool-catalog` 失敗。新增的 `tool-*` 包若未加入 manifest，會直接使完整性守衛失敗。
- 工具描述文字有唯一歸屬——原始碼中 `defineTool` 的 `description`——生成的條目質量取決於它，與 Cordis 目錄對事件 JSDoc 施加的強制力相同。
- 生成器匯入並執行工作區包（這是倉庫中第一個這樣做的指令碼；其他指令碼只讀文字）。它透過根 `tsconfig` 的 `paths` 對映在 `tsx` 下執行，使用與演示和測試相同的未建置原始碼路徑，因此不需要建置步驟。
- 未來某個工具背後新增一個能力 seam，意味著 manifest 中需要新增一條配方條目（聲明要掛載哪些 seam）。這正是上文指出的有意為之的手寫成本；僅在新增工具包時才需變更。
