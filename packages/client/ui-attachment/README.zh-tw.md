# @deepseek-ai/dsh-client-ui-attachment

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

純 React 附件原子元件（零 cordis）：輸入框草稿圖片欄（`AttachmentRail`）、聊天歷史圖片畫廊（`MessageImage`/`ImageGallery`）、原圖燈箱（`ImageLightbox`）與整頁拖放遮罩（`DropOverlay`）。所有文案都由持有方外掛程式在自己的語言命名空間中解析後經 label props 傳入，此包不讀取任何應用狀態；當前消費者是 `@deepseek-ai/dsh-client-ui-conversation`，經其 `image-labels` 模組橋接 `conversation` 詞典。

## 附件欄

`AttachmentRail` 將待發送草稿圖片算繪為固定 64px（16px 圓角）的縮略圖橫排，捲軸始終隱藏，溢位改由兩端的圓形箭頭提示：每次翻頁捲動一個視口寬度（減去一張卡片作為上下文，下限 200px）並平滑捲動（`prefers-reduced-motion: reduce` 下瞬時完成），箭頭的顯隱在捲動、條目數量變化和欄自身尺寸變化時依據捲動幾何重算（rail 元素上的 ResizeObserver，因此側欄、面板的寬度變化也計入，不只是視窗尺寸變化）。附件欄只允許橫向捲動：非 passive 監聽器消費所有帶縱向分量的滾輪事件——不會捲動輸入框背後的工作階段記錄——純縱向滾輪轉為橫向步進（LINE/PAGE 單位先歸一化為畫素，單次行程鉗制在 60px 內），對角平移保留其橫向分量，純橫向平移保持原生捲動。新增條目會捲動到欄尾展示，刪除則保持原位，帶著已有草稿重新掛載的欄保持起始位置。每張縮略圖單擊經 `onOpen` 打開原圖，刪除按鈕位於卡片內部右上角，懸停卡片或鍵盤聚焦時才顯示；粗指針（觸屏）設備沒有懸停，因此常顯。是否掛載由持有方決定，僅在有條目時算繪。

## 訊息圖片與燈箱

`MessageImage` 算繪一張持久化歷史圖片，經持有方的 `ImageLoader` 載入工作階段授權 URL；載入失敗算繪顯式重試按鈕，載入完成後單擊打開 `ImageLightbox`（載入中的點擊被忽略）。尺寸規則對齊 DeepSeek Chat：一則訊息僅有的一張圖（`variant="single"`）長邊 240px、展示寬高比鉗制在 [0.25, 4] 之間——超出部分由 `object-fit: cover` 裁切，特別高的圖錨定頂部、特別寬的圖錨定左側——且從不放大超過原始尺寸；多圖中的一張（`variant="tile"`）為固定 64px 方塊。`ImageGallery` 將一則訊息的圖片包為一個對齊的可換行彈性分組（使用者訊息 `end`，助手訊息 `start`），按圖片數量選擇 variant，空清單不算繪。`ImageLightbox` 是文件級模態預覽，鋪在共享的對話框遮罩上（`--dsw-alias-bg-mask-1` 加 `--dsw-mask-blur`，畫在獨立圖層上，模糊不會波及預覽圖本身），按 Escape、按下遮罩或點關閉按鈕均可關閉，解除安裝時將焦點還給打開者。

## 拖放遮罩

`DropOverlay` 是文件拖曳懸停頁面時的全視口邀請層：插畫、標題，接受拖放時再加一行上限說明（`disabled` 換為停用插畫並隱藏上限行）。該層不接收指針事件——持有方的 document 級拖曳監聽器負責 enter/leave 計數和接受與否的判定；遮罩只呈現狀態。與燈箱一樣經 body portal 算繪。

## 模型體驗

無。該包（package）在瀏覽器中算繪純 React 原子元件；這裡沒有任何內容進入模型請求。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **僅支援圖片** — 非圖片文件尚無附件欄卡片與歷史算繪；DeepSeek Chat 風格的文件卡片和上傳進度狀態等輸入框接受非圖片附件後再做。
- **燈箱無縮放與下載** — 預覽僅以適配視口的尺寸算繪原圖。
- **燈箱不鎖定焦點** — 它設定 `aria-modal` 並在關閉時歸還焦點，但 Tab 仍可移動到背後的頁面（沿襲入包前元件的行為）。
