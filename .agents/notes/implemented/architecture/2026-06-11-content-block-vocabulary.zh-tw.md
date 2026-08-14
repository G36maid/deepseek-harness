# Agent Note: 由 dsh-llm 擁有的提供方無關內容區塊詞彙

Status: implemented

[English](2026-06-11-content-block-vocabulary.md) | [简体中文](2026-06-11-content-block-vocabulary.zh.md) | 繁體中文

## 問題

harness 需要一套統一的內部訊息語言，供 agent loop（代理循環）、工作階段日誌和所有外掛程式共同使用。

## 決策

自主擁有詞彙：訊息是類型化內容區塊的陣列（`text`、`reasoning`、`tool-call`、`tool-result`），其聯合類型派生自可合併擴充的 `ContentBlockMap`，外掛程式透過聲明合併新增新的塊類型。同一可合併擴充對映模式為所有「字串化」欄位提供類型（`MessageSource`、`FinishReason`、`TurnTrigger`、`TurnEndReason`）。流式輸出採用原始區塊協議；`BlockAssembler` 是唯一的共享組裝實作。配接器負責轉換為提供方的協定格式（wire format）——對映成本留在配接器中，正是它該在的地方。

工作階段內上下文注入（`context/message`）和輪次中途 steering（中途引導）最初渲染為帶標籤的 user-role 信封（system-reminder 模式），而非引入新角色，因此配接器無需承擔額外負擔。如今兩者都投影為無包裝的普通使用者內容；見[注入內容信封 Agent Note](../simplification/2026-07-20-unwrap-injected-content-envelopes.md)。實際配接器驗證已確認此渲染方式符合當前 DeepSeek 的行為；如果未來某提供方出現不相容，應在該配接器內處理，而非引入新的規範角色。

## 曾考慮的替代方案

- **映像檔 DeepSeek/OpenAI chat-completions 結構**：對第一個提供方零對映成本，但對富內容（推理、結構化塊形式的工具結果）處理不便。
- **原樣採用 Anthropic Messages 塊結構**：經過實戰檢驗，但規範類型將映像檔一個 harness 並非首要對接的第三方 API。

## 後果

- 推理（reasoning）在覈心層有了歸屬，無需相依性提供方特有的結構。
- 多模態塊只有在配接器、UI 和上下文壓縮（context compaction）三方協同支持後才會回歸；見 [drop-image Agent Note](../simplification/2026-07-04-drop-image-content-block.md)。
- 快取提示與 assistant prefill 在有實際配接器能兌現之前保持缺席；見[無生產者的詞彙變體](../../archived/simplification/2026-07-04-prune-producerless-vocabulary-variants.md)與[無端到端可用路徑的請求旋鈕](../../archived/simplification/2026-07-04-drop-inert-request-knobs.md) Agent Note。
- 每個配接器都需承擔翻譯成本；首批真實配接器已驗證了流式輸出協議，新配接器應繼續在配接器本機測試中驗證其提供方特有的對映。
- 跨包邊界的 ID 使用品牌類型（`CallId`、agent 與工作階段共享的 `SessionId`）——零執行時期開銷的名義類型。
