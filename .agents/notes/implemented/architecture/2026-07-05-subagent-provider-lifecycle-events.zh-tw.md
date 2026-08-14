# Agent Note: Subagent 提供方生命週期事件——`subagent/provider-added` / `subagent/provider-removed`

Status: implemented

[English](2026-07-05-subagent-provider-lifecycle-events.md) | [简体中文](2026-07-05-subagent-provider-lifecycle-events.zh.md) | 繁體中文

## 問題

[提示詞變數 Agent Note](2026-07-05-prompt-variables-and-tool-guidance-ownership.md) 讓 `dsh-tool-subagent` 從其提供方派生面向模型的措辭：`SubagentProvider.inheritsParentContext`（spawn 和 ACP（Agent Client Protocol）為 `false`，fork 為 `true`）同時驅動程式工具描述和 `prompt` 參數描述，使 fork 工具不再在上下文繼承問題上對模型撒謊。這一修復引入了跨 fiber 的資料相依性：工具描述在工具註冊時固定（這是有意為之——描述是 tool-choice 引導所在之處），但提供方在自己的外掛程式 fiber 上到達，時機不確定。

如果在工具外掛程式的 `apply` 時刻解析提供方，就會產生一個隱式的載入順序要求（「在 cordis.yml 中把後端列在工具前面」）。這個要求不成立，因為 Cordis Loader 並行啟動同級條目，且 `Entry.init()` 不會等待啟用完成：延遲到達的後端即使列在前面，也可能讓工具 fiber 失敗。Loader 不提供同級順序保證——「非同步狀態不是同步狀態」（見[防禦性模式](../../../../docs/defensive-patterns.md)）。

## 決策

登錄檔將提供方的成員變化作為類型化事件廣播，消費端映像檔這些事件而非假設順序：

- **`subagent/provider-added(provider)`**：一個提供方在 `ctx.subagents` 登錄檔中變為可解析。在註冊時寄出。
- **`subagent/provider-removed(name)`**：一個提供方離開登錄檔（其外掛程式 fiber 被 dispose（資源釋放）——解除安裝或 HMR（熱模組替換）重載）。從註冊的 disposer 中寄出。

`dsh-tool-subagent` 映像檔其命名提供方的生命週期：當提供方可用（或變為可用）時註冊工具——在那一刻從該提供方派生措辭——當提供方離開時註銷工具，並在重新註冊時（HMR 重載）重新派生。提供方不在時工具不存在，因此不會對模型撒謊。這裡有意不留下任何需要文件化的載入順序要求：事件讓順序問題消失，而非將其釘死。

這些事件還完善了 seam 的詞彙：`ctx.subagents` 是一個命名登錄檔，多個委派後端（`spawn`、`fork`、`acp`）在其上共存；一個其他外掛程式從中派生狀態的登錄檔，應當以類型化事件廣播成員變化，而非要求輪詢或相依性載入順序。

## 曾考慮的替代方案

- **在 `apply` 時解析提供方，不存在則拋例外**：否決。「先列後端」這一要求聲稱了 Loader 並不存在的順序保證。
- **重試尋找（輪詢直到提供方出現）**：最終能收斂，但在框架已有的機制（effect 註冊 + disposal）之外發明瞭一套私有就緒協議；它也無法感知提供方離開，因此 HMR 會殘留一個措辭描述已 dispose 後端的工具。
- **僅在 section 中放置 subagent 措辭，在組裝時惰性解析**：同樣能容忍任意載入順序，但將 tool-choice 引導移出了描述，與提示詞變數 Agent Note 建立的所有權規則相矛盾（每個工具的語義和何時使用屬於描述）。響應式註冊既保持描述的權威性，又不相依性順序。
- **根據提供方名稱而非提供方對象確定措辭**：`providerName` 本身是設定，重新命名後的提供方會靜默獲得錯誤的措辭；從已解析提供方自身的 `inheritsParentContext` 派生則不會漂移。

## 後果

- 從命名提供方派生狀態的消費端回應 `subagent/provider-added`/`-removed` 事件，而非在 `apply` 時讀取登錄檔；`dsh-tool-subagent` 是參考實作。
- **新增時大聲失敗；移除時按監聽器隔離。** 新增監聽器可以回滾註冊。移除在 disposal 期間執行，因此單個監聽器拋例外只會被記錄日誌，不會餓死後續映像檔或幹擾拆解流程。`start()` 仍在每次執行時期按名稱解析提供方，防止過時工具呼叫已移除的後端。見[事件目錄](../../../../docs/subsystems/subagent.md#cordis-surface)與[生產者/消費端對映](../../../../docs/event-producer-consumer.md)。
- **工具不存在的視窗期。** 在後端 disposal 與重新註冊之間（HMR 重載期間），模型看不到 subagent 工具。這是誠實的狀態——替代方案是一個向空處分發的工具——工具登錄檔寄出的 `tools/change` 事件會使提示詞組裝保持最新狀態。
- **兩個等待中的 fiber 共享同一 `toolName` 是無效設定，被延遲捕獲。** 如果兩個 `dsh-tool-subagent` 載入實例分別指定了不同的提供方但相同的 `toolName`，兩者都會等待，先到達的提供方先註冊；第二次註冊僅在其提供方到達時才拋例外。外掛程式中的 `TODO(subagent-dup-toolname)` 記錄了這一影響範圍；工具登錄檔的重名拒絕機制仍是最終防線。
