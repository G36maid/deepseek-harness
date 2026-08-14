# Agent Note: Todo 優先的 composer 上下文順序

Status: implemented

[English](2026-08-02-todo-first-composer-context-order.md) | [简体中文](2026-08-02-todo-first-composer-context-order.zh.md) | 繁體中文

## 問題

composer 上下文堆疊將 Goal 渲染在 Todo 之前，但 Harness 設計稿把當前任務計畫排在進行中的目標和待處理 Queue 之前。Todo 還把 Queue 包裝層的 776px 寬度用作自身的可見卡片寬度，而 Goal 和 Queue 面板則渲染在共享的 752px 卡片列上。結果既顛倒了預期的資訊層級，也讓 Todo 比相鄰兩個面板更寬。

## 決策

`conversation.input.dock` 清單採用統一的產品順序，升序依次為 Todo `0`、Goal `10`、Queue `20`，隨後是位於清單外的 composer bar。註冊順序仍是語義真源；渲染器不會硬編碼已知元件 id，也不會使用 CSS 修正它們的順序。

Todo、Goal 與可見的 Queue 面板共用 800px composer 寬度上限內的 752px 卡片列。Queue 保留 776px 包裝層，並在兩側各留 12px 透明內縮，因為該包裝層負責與 composer 重疊。Todo 是獨立卡片，而非包裝層，因此其響應式寬度和最大寬度都會直接扣除兩層內縮。Goal 使用相同的響應式卡片列，並將內層橫條的寬度上限設為 752px，從而在低於桌面寬度上限時也保持邊緣對齊。

[composer 堆疊約定](2026-07-30-composer-context-stack-order.md)繼續規定卡片間距，以及僅限 Queue 與 composer 重疊。本決策只取代該記錄中 Goal 優先的順序。

## 驗證

Todo 與 Goal 的註冊測試分別固定順序 `0` 和 `10`；Queue 仍固定為 `20`。無金鑰 Queue 瀏覽器場景同時渲染三個面板，記錄 Todo–Goal–Queue 的無障礙順序，並在 1680px 桌面基線和低於寬度上限的 640px 視口下比較其可見邊界框，隨後再執行 Queue 變更。

## 考慮過的替代方案

**在 `ConversationRoot` 內重新排列已知面板。** 不予採納，因為 `conversation.input.dock` 是可擴充的有序清單；硬編碼的元件清單會使外掛程式啟用順序與渲染順序不一致。

**使用 CSS `order` 移動 Todo 的視覺位置。** 不予採納，因為無障礙順序和鍵盤順序必須與視覺層級一致，而 slot 帳本已經負責語義順序。

**讓 Todo 保持 Queue 包裝層的寬度。** 不予採納，因為 Queue 包裝層的透明內縮是其與 composer 重疊所需的版面配置基礎設施，不屬於可見面板列。

## 後果

當前有效的任務計畫顯示在進行中的目標之前，待處理 Queue 工作仍最靠近 composer，三張可見卡片共用相同的橫向邊緣。未來的 input-dock 外掛程式必須相對於 Todo `0`、Goal `10` 和 Queue `20` 選擇明確位置；僅 Queue 負責末端包裝層與 composer 的重疊。
