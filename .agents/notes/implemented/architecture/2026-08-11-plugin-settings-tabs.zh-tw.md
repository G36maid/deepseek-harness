# Agent Note: “外掛程式”設定中的功能自有分頁標籤

Status: implemented

[English](2026-08-11-plugin-settings-tabs.md) | [简体中文](2026-08-11-plugin-settings-tabs.zh.md) | 繁體中文

## 問題

外掛程式設定與只讀 Loader 清單各自註冊了一個頂層 `settings.section`。兩者描述同一個“外掛程式”領域，卻佔據兩行導覽，把搜尋與設定拆成互不相關的頁面，也沒有給 Settings 外殼一個有原則的聚合方式。若直接合併兩者的元件，則會讓一個功能外掛程式 import 並擁有另一個功能的資料生命週期。

## 決策

`@deepseek-ai/dsh-client-ui-settings-plugins` 擁有唯一一個 id 為 `plugins` 的 `settings.section` 貢獻。它渲染共享標題和緊湊標籤欄，聲明根級清單 slot `settings.plugins.tab`，並把該記錄中的 id、order 與跟隨語言的 label 投影成分頁標籤。該 slot 的規範類型位於 `ui-settings`，因此分頁標籤貢獻方相依性設定領域約定，而不是相依性另一個功能外掛程式。

分區擁有方貢獻 `configurable` 分頁標籤，由它聲明既有的巢狀 `settings.plugin.item` 清單。設定卡片原有的命名空間綁定、草稿狀態、校驗與寫入均保持不變。`@deepseek-ai/dsh-client-ui-settings-plugin-inventory` 向 `settings.plugins.tab` 貢獻 `all` 分頁標籤；它的 Host Loader 觀察器、生成的 Remote 命名空間、DTO 與搜尋語義保持不變。已停用的清單條目會在摘要和詳情中省略重複的“未掛載”執行狀態，已啟用條目仍顯示其 Cordis 階段。

默認選擇順序中的第一個分頁標籤。某個分頁標籤只有首次被選擇時才掛載，之後在“外掛程式”分區保持掛載期間只隱藏而不解除安裝。這樣會把清單 RPC 延遲到使用者打開**外掛程式清單**時，並在切換分頁標籤時保留草稿、搜尋文字、摺疊狀態和已讀取的快照。關閉 Settings 會解除安裝該分區，因此再次打開後，重新選擇該分頁標籤時會取得新的清單快照。

兩項註冊都使用 `ctx.slots.inject()`。分區聲明方解除安裝時，標籤 slot 及其全部貢獻隨之摺疊；重新聲明後，每項功能都能重新註冊，無需靜態 import，也不相依性啟用順序。

## 備選方案

**保留兩行 Settings 導覽，只改名稱。** 否決，因為重複是結構問題，而非文案問題：兩個頁面仍然代表同一個“外掛程式”領域，並繼續爭奪導覽空間。

**把清單元件 import 進 `ui-settings-plugins`。** 否決，因為設定外掛程式會因此擁有另一個外掛程式的 Remote 相依性與生命週期，也會把選填的瀏覽器貢獻變成包級相依性。

**在分區擁有方硬編碼兩個分頁標籤的名稱和元件。** 否決，因為第三項功能需要修改擁有方，HMR teardown 也可能留下已不存在貢獻的介面框架。slot 記錄已經提供標識、順序、本機化與級聯語義。

**把“外掛程式”聚合移入 `ui-settings-general`。** 否決，因為 Settings 外殼擁有通用導覽與模態介面框架，而不擁有功能內容。把“外掛程式”專屬分頁標籤放在那裡，會讓今後每一種“外掛程式”檢視表都需要修改外殼。

## 影響

Settings 只有一行“外掛程式”導覽，排在“Agent 預設”之前，包含**外掛程式設定**與**外掛程式清單**兩個分頁標籤。“Agent 預設”仍是獨立分區，因為它編輯每個工作階段的 agent 組裝，而非即時 Host Loader 樹。

功能所有權保持明確：`ui-settings-plugins` 擁有“外掛程式”頁面與可編輯卡片，`ui-settings-plugin-inventory` 擁有隻讀清單檢視表，Host／RPC 路徑不變。新的“外掛程式”檢視表只需註冊一個 `settings.plugins.tab` 貢獻即可加入。

該聚合相依性分區擁有方被組裝：沒有 `ui-settings-plugins` 時，`ui-settings-plugin-inventory` 會等待標籤 slot 的聲明且不渲染任何內容。這是透過 slot 登錄檔承載的有意組合相依性，而不是靜態包 import。
