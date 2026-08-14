# Agent Note: 固定標題欄，sticky 編輯器位於 transcript（文字記錄）滾動容器內

Status: implemented

[English](2026-07-29-sticky-composer-conversation-scroll.md) | [简体中文](2026-07-29-sticky-composer-conversation-scroll.zh.md) | 繁體中文

## 問題

活躍工作階段列把滾動拆成兩段：聊天（以及 trajectory）檢視表自有 `overflow-y: auto`，編輯器棧則作為該滾動容器的兄弟節點坐在下方。指針落在統計行或輸入區上時，滾輪打在不可滾動區域上因而毫無效果——只有指針在訊息清單上時 transcript 才會移動。草稿變長時更糟：textarea 本身也是滾動容器，編輯器上的滾輪可能被截在那裡。工作階段標題欄必須以普通 chrome 佔據列頂（不能在滾動容器內 `position: sticky`），而編輯器必須與 transcript 貼在同一滾動容器底部，使頁腳上的滾輪能帶動內容流動。

## 決策

`ConversationRoot` 始終擁有同一個 `data-conversation-scroll` 主體，其中嚴格 `conversation.session` view outlet 位於 `data-composer-seat` 之前；該 seat 包住整條 `'conversation.composer'` chain 輸出（`overlay: true` 下的 fallback 與選舉出的 overlay 兄弟節點）。獨立的嚴格 `conversation.session.header` outlet 作為 `flex: none` 列 chrome 位於滾動容器上方，並在 Session 仍為 blank 時隱藏。固定的父級樹讓滾動主體與 composer seat 從無工作階段、blank Hero 到活躍對話始終保持掛載。活躍階段 CSS 以 `position: sticky; bottom: 0` 釘住該 seat，使使用者未貼底時 Question／Approval 接管仍可見；Hero CSS 在滾動主體內置中 fallback 棧。ChatView 與 Trajectory/Waterfall 僅在宿主之外掛載時（單元測試）保留本機 scroller；位於宿主下時設為 `overflow: visible`，並透過 `closest('[data-conversation-scroll]')` 解析貼底跟隨與前置錨定。

工作階段統計掛在 `'conversation.composer.dock'`（位於 `'conversation.input.dock'` 之上）。InputBar 的 textarea 在宿主內以 `{ passive: false }` 鏈式處理 `wheel`：在限高 textarea 仍能沿該方向滾動時保留原生手勢；僅在自身邊緣才 `preventDefault` 並將 `deltaY` 施加到宿主。

Chat 歷史前插透過穩定的已渲染 node／call 身份跟隨讀者意圖，而不是使用整個滾動容器的高度差。分頁開始時，`ChatView` 記錄第一個可見的 `data-chat-anchor-key` 及其相對滾動容器的頂部位置；請求運送中期間，每次讀者滾動都會重新選擇當前可見的穩定錨點；頁面到達後則按該行矩形的前後差值補償。到達底部或追加讀者自己的訊息會取消分頁錨點，因此遲到的頁面不能把檢視表從最新內容拉走。貼底跟隨採用儲存狀態，而不是原始滾動幾何狀態；讀者輸入如何被識別——即以與設備無關的方式偏離由最近一次交付或寫入的 `scrollTop` 構成的 observed-top ledger——由[讀者滾動歸因筆記](2026-08-06-reader-scroll-attribution-observed-top-ledger.md)負責。`ChatView` 的單個 `ResizeObserver` 只會在貼底所有權仍保持時跟隨流式輸出、工具展開與草稿尺寸變化，且每個區塊不會觸發第二次滾動寫入。

## 考慮過的替代方案

**標題欄與編輯器都在同一列滾動容器內 sticky。** 標題欄否決：它必須作為固定版面配置 chrome 佔據頂部，而不是參與滾動容器的 sticky 層。

**滾動容器下方 flex-none 固定編輯器並轉發滾輪。** 否決：產品要求編輯器 sticky 在 transcript 滾動容器內，使頁腳成為該滾動命中面的一部分，而不是僅轉發增量的兄弟節點。

**把編輯器 portal 進 ChatView 的 scroller。** 否決：編輯器跨檢視表標籤共享；其目標是常駐殼中由 root 持有的滾動容器。

**把 StatsLine 留在 ChatView 訊息列下方。** 否決：落在 sticky 編輯器之外會隨內容滾走，而輸入區仍釘在底部。

**為每一種瀏覽器滾動輸入來源建模。** 此次窄範圍修復不採用：已復現的桌面端路徑使用滾輪／觸控板輸入。指針／觸控滾動、拖動原生捲軸、鍵盤滾動、焦點導覽與巢狀 overflow 所有權當時被留在輸入來源模型之外，也未為此新增通用輸入狀態機。[讀者滾動歸因筆記](2026-08-06-reader-scroll-attribution-observed-top-ledger.md)後來透過 observed-top ledger 泛化了歸因，補上了這一延後事項，且仍未引入輸入狀態機。

## 後果

在頁腳上滾輪會滾動 transcript；可見版面配置是固定標題欄、可滾動 transcript 與 sticky 底部編輯器。統計出現在每一個活躍檢視表標籤上。宿主下的巢狀檢視表 scroller 被抑制，因而 Trajectory 的 sticky 輪次標題貼在列宿主上。並行歷史載入、流式輸出、工具展開與編輯器重排會保留讀者的滾動決定，包括 Chromium 先推進合成器幾何狀態再交付事件，以及流收尾階段的收縮鉗制。貼底跟隨所有權依據[讀者滾動歸因筆記](2026-08-06-reader-scroll-attribution-observed-top-ledger.md)擴充到每一種讀者輸入。無工作階段 → blank Hero 與 Hero → active 都保持同一 textarea DOM 節點以及 InputHub 草稿。
