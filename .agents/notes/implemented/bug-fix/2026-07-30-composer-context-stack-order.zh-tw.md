# Agent Note: Composer 上下文堆疊順序

Status: implemented

[English](2026-07-30-composer-context-stack-order.md) | [简体中文](2026-07-30-composer-context-stack-order.zh.md) | 繁體中文

## 問題

Goal、Todo 與 Queue 獨立註冊到同一個 `conversation.input.dock` 清單，但各自的註冊順序與間距規則沒有編碼組合矩陣。因此，渲染器將 Todo 放在 Queue 和 Goal 之前，而 Queue 與 Goal 都帶有用於 composer 邊界的負外邊距。三者同時出現時，Queue 與 Goal 相接，Goal 與 composer 相接，顛倒了設計層級。

## 決策

[Todo 優先的對齊決策](2026-08-02-todo-first-composer-context-order.md)規定當前的升序排列。本記錄保留圍繞該順序的堆疊約定：數值間隔使未來條目可以聲明預期位置，不必相依性外掛程式啟用順序；composer bar 位於清單之後。

`ConversationRoot` 負責獨立上下文卡片之間的 6px 間距。Goal 是一張獨立的 752×36px 卡片，摺疊後的 Todo 是一張獨立的 752×44px 卡片。Queue 是末端 dock 條目：其 776px 包裝層包含相同的 752px 面板列，並減去共享間距與具名的 5px 版面配置重疊量，因此後渲染的 composer 卡片只覆蓋 Queue 邊緣。空條目渲染為 null，不佔用間距。

順序與重疊是兩項獨立約定。註冊順序定義語義層級，stack 上的 CSS 變數定義共享幾何。系統不能僅因 Queue 是最後一個可見條目，就推斷它可以與 composer 重疊，因為沒有 Queue 時，Goal 或 Todo 可能成為最後一個可見上下文卡片，而它們必須與 composer 保持間隔。

## 驗證

註冊測試固定了三個順序值。無金鑰 Queue 瀏覽器場景同時渲染 Todo、Goal 和 Queue，固定它們的無障礙順序，並檢查其可見卡片邊緣；分別針對 Goal 與 Queue 的場景覆蓋各自的獨立狀態。

## 考慮過的替代方案

**Goal 和 Queue 分別保留獨立的負外邊距。** 不予採納，因為受影響的相鄰項會隨 slot 順序變化；除非語義順序也固定，否則區域性外邊距無法表達允許哪一種關係。

**在 `ConversationRoot` 中分別渲染每個已知 dock id。** 不予採納，因為這會把可擴充的清單 slot 變成硬編碼的元件清單，並迫使 owner 在每新增一個註冊方時隨之修改。

**讓最後一個 dock 條目與 composer 相接。** 不予採納，因為 Goal 和 Todo 是獨立卡片；Goal 或 Todo 缺席時的組合不得改變剩餘卡片的介面語義。

## 後果

所有存在組合下的視覺層級都保持穩定，Queue 是唯一與 composer 相接的上下文介面。新的 input-dock 外掛程式必須相對於 Todo `0`、Goal `10` 與 Queue `20` 選擇順序；若條目位於 Queue 之後，還必須明確決定由哪個介面負責 composer 邊界。
