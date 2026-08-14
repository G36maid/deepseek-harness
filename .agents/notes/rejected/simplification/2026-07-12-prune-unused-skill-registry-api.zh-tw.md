# Agent Note: 裁剪 skill 登錄檔中未使用的介面

Status: rejected — 直接在執行時期註冊 skill 是為第三方外掛程式保留的有意擴充路徑。

[English](2026-07-12-prune-unused-skill-registry-api.md) | [简体中文](2026-07-12-prune-unused-skill-registry-api.zh.md) | 繁體中文

## 問題

skill（技能）服務的嵌入式執行時期子系統中，`ctx.skills.register()` 沒有任何生產呼叫方。它引入了一個保留的 `runtime` 提供方名稱、一套執行時期 map/rank/source、重複策略、快取鍵中的第二個 revision、規範化邏輯、dispose（資源釋放）函式以及相應測試——而所有已交付的 skill 都使用提供方約定。`SkillSummary.whenToUse` 和 candidate/definition 的 `path` 被解析和複製，但沒有任何生產消費端讀取它們：模型目錄只渲染 name/description，資源載入使用 `resourceBase`，提供方自行管理其定位器。有意開放的 `metadata` 擴充點保留不動。

## 提案

移除 `SkillRegistry.register()`、`SkillRegistration`、執行時期偽提供方及保留名稱規則、執行時期 revision/快取分支，以及僅用於執行時期的 source/rank 規範化邏輯。需要嵌入式 skill 的測試改為註冊一個小型真實提供方。保留 `providerRevision` 作為進行中發現操作的 epoch，但已完成的目錄快取僅以 cwd 為鍵：每次提供方變更同步清除快取，await 之後的 revision 比較已能阻止插入過時結果。從 skill 約定和本機提供方副本中移除 `whenToUse`、`SkillCandidate.path` 與 `SkillDefinition.path`，同時保留提供方的 locator/root 路徑；保留 `metadata`、`disableModelInvocation`、`source`、`provider`、`locator` 和 `resourceBase`，因為它們要麼是有意開放的擴充詞彙，要麼是生產消費的欄位。

同步修訂 skill 系統 Agent Note、README、JSDoc、目錄文件與測試。agent（代理）作用域的系統提示詞段、工具提供方和變數明確不在本提案範圍內：[agent 作用域貢獻者約定](../../implemented/architecture/2026-07-08-agent-scope-contexts.md)有意允許在 `setup(agentCtx)` 期間透過 agent 擁有的上下文註冊這三者，因此倉庫內沒有固定的作用域註冊並不能證明它們未被使用。

## 曾考慮的替代方案

**保留面向嵌入方的執行時期 skill 註冊。** 這是已實作的 skill Agent Note 中有意提供的同步直接定義便利介面。一個小型提供方包裝層可以在 effect 擁有的生命週期下暴露相同的嵌入資料，但它必須實作非同步 `list()`/`get()`、攜帶提供方身份，並接受提供方處理重複項的語義。本提案選擇只保留一條統一的提供方路徑，而非維護第二套排序、校驗、快取失效與尋找路徑。

## 驗收標準

- skill 收集只有一條提供方驅動程式的路徑，已完成快取僅以 cwd 為鍵，revision epoch 僅用於使進行中的發現操作失效；保留的 skill 欄位要麼有生產讀取方，要麼有記錄在案的有意擴充約定。
- agent 作用域的系統提示詞段、變數、工具提供方、工具守衛，以及原生模式和 Code Mode 下的 structured-output 提交行為保持不變。
- 型別檢查、覆蓋率、快照、doc-sync（文件同步閘門）、module-graph 校驗、建置與 hygiene 全部透過。

## 風險

這是對預發布 skill 登錄檔的編譯可見收縮。外部程式設計式 `list()`/`get()` 消費端將失去 `whenToUse` 路由提示和 candidate/definition 的 `path`；已交付的模型目錄從未渲染它們，資源解析保留了顯式的 `resourceBase` 加上提供方自有的不透明 locator，但這些欄位並非觀測等價。skill 本機 frontmatter 解析必須繼續保留並校驗所支持的 metadata schema，外部提供方仍可提供嵌入式、檔案系統、遠端或其他 skill 來源。
