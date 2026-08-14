# @deepseek-ai/dsh-agent-default-model

[English](README.md) | 繁體中文

該部署預設值供入口在建立尚無工作階段級模型選擇的 Agent 時使用。`AgentDefaultModelConfig` 提供 `ctx.agentDefaultModel`；`dsh --profile headless` 這類直接入口與 ApiProxy 這類由 Host 支撐的入口讀取同一服務，而不是分別持有平行的提供方／模型預設值。

外掛程式設定必須提供 `{ provider, model }`。該組合設定項構成 Settings 中 `agent-default-model` 分節的基礎層；掛載的設定提供方在其上疊加使用者選擇，更改會在下一次呼叫 `currentSelection()` 時可見。`reasoningEffort` 屬於該 Settings 分節，但特意不屬於外掛程式設定：完整保存的選擇必須能在下一個選定模型沒有推理（reasoning）強度時清除舊值，而組合設定值會再次被繼承。

- `ctx.agentDefaultModel.currentSelection()` 返回一份獨立的 `{ provider, model, reasoningEffort? }` 選擇，供新建立的 Agent 使用。
- `ctx.agentDefaultModel.saveSelection(selection)` 保存完整的使用者選擇。未掛載設定提供方時，此呼叫不執行任何操作，組合設定項仍為當前值。

該服務不校驗目錄成員關係。提供方路由可以服務未在目錄中公佈的模型；實際發起模型請求的消費端負責可用性診斷。

## 模型體驗

透過提供給入口的提供方／模型選擇間接影響；模型可見請求由請求組裝與配接器負責。

#### KV Cache 影響

更改預設值隻影響之後從該預設值解析選擇的 Agent。請求日誌已經指明選擇的現有工作階段仍沿用該選擇，因此本服務不會使其已建立的前綴失效。

## 已知限制與暫緩事項

- 該服務只擁有一項行程級預設值；每個工作階段的選擇仍由入口負責。
- 未掛載設定提供方時，`saveSelection()` 無法保留選擇供後續 Agent 使用。
