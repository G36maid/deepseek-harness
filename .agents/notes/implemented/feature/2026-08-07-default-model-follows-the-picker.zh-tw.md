# Agent Note: 默認模型跟隨選擇器

Status: implemented

[English](2026-08-07-default-model-follows-the-picker.md) | [简体中文](2026-08-07-default-model-follows-the-picker.zh.md) | 繁體中文

## 問題

工作階段模型選擇器與部署預設值是同一項偏好的兩個層次。如果選擇器隻影響其所在工作階段，下一個空白工作階段可能選擇不同模型，使用者卻沒有途徑使預設值與選擇器一致。如果預設值位於 Host 閘道內部，直接建立 Agent 的入口只有相依性 Host 或複製狀態才能共享它。

推理強度使持久化形態變得重要：不含強度的模型選擇必須清除已存強度，否則下一個 Agent 可能會採用所選模型不接受的強度。

## 決定

`AgentDefaultModelConfig` 提供 `ctx.agentDefaultModel`，並把 `{provider, model, reasoningEffort?}` 註冊為 `agent-default-model` Settings 分節。其 `{provider, model}` 組合條目是 base 層，`settings.yaml` 提供使用者層。該服務不偏向特定入口，因此直接建立與 ApiProxy 支撐的建立共享同一個預設值（[headless 直接 core 入口](../architecture/2026-08-09-headless-direct-core-entry-point.md)）。

`reasoningEffort` 屬於 Settings 分節，但不屬於外掛程式設定。Settings 層按欄位合併，因此已設定的強度會在使用者選擇省略它時繼續存在。`saveSelection()` 寫入完整的使用者分節；因此，缺少該欄位會清除已存強度。部署級強度預設值屬於配接器 profile，並由它按模型解析。

`session.selectModel` 把被接受的 `ModelSelection` 應用於所在工作階段，並呼叫 `saveDefaultModelSelection()` 保存共享的 Agent 預設值。儲存失敗只記日誌，不撤銷工作階段選擇。沒有 Settings 提供方的部署保留組合條目，被接受的選擇只停留在該工作階段中。

`ApiProxyDefaults` 攜帶 `defaultModelSelection()` 與 `saveDefaultModelSelection()` 閉包，因此 `createApiProxy` 不相依性 Settings seam。`ApiProxyService` 將它們分別接到 `ctx.agentDefaultModel.currentSelection()` 與 `ctx.agentDefaultModel.saveSelection()`。

`selectionFor(agent)` 每次讀取時都解析各層：先取行程內的工作階段選擇，其次取工作階段最新記錄的 `request/header`，最後取當前 Agent 預設值。已有請求日誌的工作階段持續綁定到日誌中持久化的選擇。空白工作階段即使建立於偏好保存之前，也會觀察到當前預設值；這與 New Session 介面可能複用空白工作階段的行為一致。

已存選擇不要求屬於目錄。某條提供方路由可能服務其僅供參考的目錄未列出的模型。因此，`session.models` 會在已公佈分組之外單獨報告已存選擇，並另行報告配接器是否服務其提供方。

## 影響

`host.describe` 報告當前 Agent 預設值。模型切換成功後，`settings.yaml` 中會存有一個 `agent-default-model:` 分節。閘道不透過 Settings 頁 allowlist 暴露該 namespace；模型選擇器是它的編輯器。

## 無法傳送訊息的工作階段

當沒有配接器服務工作階段所選提供方時，`session.prompt` 會在開啟輪次前以 `model-unavailable` 拒絕。這一方法是強制執行邊界；停用 composer 只是用戶端提供的便利。

`session.models` 報告 `routable`。ui-model-selection 外掛程式透過 `ctx.conversation.blocks` 投影不可路由的選擇，composer 隨之變為不可操作，同時保留模型 seat 可用。用戶端不知道是否可路由時不會阻斷輸入，包括目錄首次載入或載入失敗的情況。

可路由性與目錄成員關係不同。仍在服務的提供方路由可以處理未公佈的模型，因此不在目錄分組中並不代表會話不可用。

## 考慮過的替代方案

| 替代方案 | 約定不匹配之處 |
|---|---|
| 已存提供方不可用時回落到組合條目 | 產品會靜默切離使用者選擇。 |
| 根據目錄成員關係校驗已存選擇 | 目錄僅供參考，可能省略仍可請求的模型。 |
| 使用合併 patch 保存 | 省略的 `reasoningEffort` 無法清除已存欄位。 |
| 只保存空白工作階段中的選擇 | 對話期間知情作出的選擇不會成為部署預設值。 |
| 增加單獨的「設為默認」手勢 | 工作階段選擇器與未來工作階段偏好雖然代表同一使用者選擇，卻仍可能分歧。 |
