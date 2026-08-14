# Agent Note: Web 附件展示經附件原子元件對齊 DeepSeek Chat

Status: implemented

[English](2026-08-11-web-attachment-display-alignment.md) | [简体中文](2026-08-11-web-attachment-display-alignment.zh.md) | 繁體中文

## 問題

Web 輸入框的圖片介面缺乏基本可用性（使用者回饋，issue #2248）。刪除按鈕以 `top/right: -6px` 掛在 72px 縮略圖外側，被附件欄的 `overflow-x` 盒子裁切，點擊經常落空；預覽只能雙擊打開，除了 tooltip 沒有任何提示這個操作；附件欄超出輸入框寬度時在膠囊內部直接出現原生橫向捲軸；圖片接收被拒和傳送失敗（例如所選模型不支持圖片輸入時的 `attachment-error`）以常駐的內聯紅條顯示在卡片上方。這些介面在 DeepSeek Chat 裡都有使用者熟悉的既定設計：單擊預覽、卡片內部懸停顯示的刪除按鈕、隱藏捲軸的箭頭翻頁、頂部置中的短時 toast。

首個多模態版本把這些介面記錄在[Web 多模態 Note](2026-07-22-web-multimodal-image-input-and-durable-attachments.md)中；本 Note 取代其中的展示與互動細節（縮略圖幾何、點擊方式、錯誤呈現），其附件服務邊界、准入與持久化決策繼續有效。

這些 UI 還全部住在 `dsh-client-ui-conversation` 裡——附件欄內聯在 700 行的 `InputBar` 中，歷史圖片和燈箱分散在 `chat/` 與 `skeleton/`——沒有其他介面可複用的接縫，純 props 的紀律也無從約束。

## 決定

附件展示落位到新的零 cordis 原子元件包 `@deepseek-ai/dsh-client-ui-attachment`（`packages/client/ui-attachment`），模式照 `dsh-client-ui-primitives`：`AttachmentRail`（64px、16px 圓角縮略圖，單擊 `onOpen`，卡片內部的刪除按鈕懸停或聚焦顯示、`pointer: coarse` 下常顯，隱藏捲軸配兩端圓形箭頭並依滾動幾何重算，縱向滾輪轉橫向平移且單次鉗制 60px，新增條目滾到欄尾），`MessageImage`/`ImageGallery`（單擊預覽），以及 `ImageLightbox`。文案經 label props 傳入；`ui-conversation` 透過 `src/client/image-labels.ts` 橋接 `conversation` 詞典，並保留狀態機接線（草稿 id、預覽狀態、接收回呼）。跨包 import 之所以是被允許的路徑，正因為它是原子元件庫而非 client 外掛程式：外掛程式之間仍禁止互相 import 元件，且附件欄是輸入框自有的渲染，不是插槽。

兩個浮層都 portal 到 body：從聊天訊息打開的燈箱位於帶 transform 的祖先之下，`position: fixed` 會被困在祖先的盒子裡（遮罩只蓋住聊天列），因此 `ImageLightbox` 與 `Toast` 經 `createPortal(document.body)` 渲染，從任何打開位置都覆蓋整個視口。短時橫幅是 `ui-primitives` 的 `Toast` 原子（距視口頂部 120px，水準中心跟隨選填錨點——composer 卡片，因此橫幅在聊天列上置中——`role="alert"`、`pointer-events: none`，停留三秒再一秒淡出，`onDone` 解除安裝，按展示序號作 key 使相同文案重新播報）。`InputBar` 把接收拒絕（`addImages` 返回的原因）和 `promptError` 都改走 toast，替換內聯紅條，`ModelSelect` 的模型選擇被拒也走同一原子，其選單內帶 Retry 的錯誤條仍是目錄載入的呈現面；狀態機 notice 條不受影響。DeepSeek Chat 原始碼（本機參考副本）提供了目標行為：其 `ImageThumbnailInInput`（64px 卡片、透明度過渡的刪除鈕）、`ScrollArrows`（哨兵驅動程式的翻頁）與 `useToast` 用法。

## 備選方案

**元件留在 `ui-conversation` 裡只改樣式。** 被使用者否決：附件面預期還會長（文件卡片、上傳進度），而倉庫的外掛程式紀律禁止其他外掛程式 import `ui-conversation` 內部實作，在外掛程式裡生長只會堆出無法複用的一坨。原子元件包給了同樣的元件一條被允許的 import 路徑。

**做成註冊插槽的 `ui-attachment` client 外掛程式。** 否決：附件欄渲染在狀態機持有的輸入框裡，畫廊渲染在聊天節點裡，二者都不是該由其他外掛程式填充的組合孔位，外掛程式形態會為純展示元件強加插槽間接層。

**Toast 放在 `ui-conversation`。** 否決：短時橫幅沒有任何工作階段特有的東西，`ui-primitives` 是零 cordis 原子元件的既定歸屬，其他介面也可能複用。

**保留內聯紅條，只給圖片接收加 toast。** 否決：`promptError`（issue 截圖裡的 `attachment-error`）恰是使用者實際抱怨的介面，一個輸入框裡存在兩種錯誤呈現會讓紅條成為孤例。

## 結果

輸入框與歷史圖片介面的互動模型現已與 DeepSeek Chat 一致，label props 接縫讓原子元件在任何語言環境下渲染而無需觸達 locale。代價是一個真實的包邊界：`ui-attachment` 背上標準腳手架（invariant 伴生、雙語 README、tsconfig face、逐文件 100% 覆蓋率），且每個未來消費者都要自行解析條目文案而非繼承。錯誤橫幅變為短時——使用者移開視線四秒就會錯過訊息，這正是 DeepSeek Chat 自己做的取捨。非圖片附件仍不支持；附件欄的卡片模型已就緒，但輸入框的接收仍只認圖片（記錄於包 README 的限制一節）。
