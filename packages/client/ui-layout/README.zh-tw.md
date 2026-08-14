# @deepseek-ai/dsh-client-ui-layout

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

外殼外掛程式：三欄 AppFrame（拖動手柄與讓步鏈）加 `ctx.layout` 面板幾何服務；它註冊到執行時期擁有的 `root` slot，並聲明 `sidebar`、`conversation`、`details` 和 `conversation.empty`。側邊欄的縮放邊界是不可見命中條帶，詳情欄邊界則保留其浮動膠囊；讓步期間只有詳情欄會收縮並隨後自動關閉。關閉的側邊欄仍保留 56px 控制欄，詳情欄則關閉到零寬度。該包還提供主題呈現器：它消費解析後的 `ctx.theme` 快照，並將其投影到 document（用 `html { color-scheme }` 驅動程式原生 UA 控制元件，依據當前配色方案設定 `body[data-ds-dark-theme]`，並將主題的別名 token 設為 body 上的內聯變數，同時擁有一個 `<meta name="theme-color">`，其內容隨計算後的 body 背景色更新）。在應用調色板和 token 後進行測量，可確保渲染後的背景成為唯一的顏色依據；呈現器在 dispose（資源釋放）時會移除其自有的元資料節點，並一並清除其寫入的其他全域性狀態。

AppFrame 始終掛載工作階段欄和詳情欄；已連線 Session 透過 `SessionProvider` 渲染。版面配置 store 是瞬時狀態，側邊欄以默認寬度啟動，詳情欄則保持關閉，且該 store 從不讀寫 `localStorage`。hero 和其他未選中狀態也會將詳情欄的渲染寬度派生為零，但不會改變儲存的寬度偏好。AppFrame 會跨越這些狀態保留最後一個非 blank 工作階段 id：首個工作階段保持關閉；顯式打開詳情欄的操作會使用約定默認寬度；返回同一工作階段時復原其未改變的寬度；選擇不同工作階段時，詳情欄會在繪製前關閉。工作階段 owner share 為空，側邊欄 owner share 只包含 `collapsed` 和 `width`；註冊方透過標準掛鉤取得業務資料，並從各自的 inject 介面取得操作。

`/client` 匯出表層包含外掛程式主體（`apply`／`inject`）、`LayoutController` 和四個 owner-share 介面。AppFrame、面板 store 與讓步求解器仍屬於包內部。

## 模型體驗

無。版面配置外殼管理瀏覽器查看狀態；這裡沒有任何內容進入模型請求。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **面板幾何資訊是瞬時狀態**：重新載入會復原側邊欄預設值，並使詳情欄保持關閉；在不同工作階段 id 之間切換同樣會關閉詳情欄，並忘記拖動後的寬度，而未選中表面會以零寬度渲染詳情欄，但不會修改幾何資訊。
- **讓步鏈自動關閉透過推導零寬度實作，不會改動寬度偏好**：視窗變寬時面板會自行復原；消費端禁止把 store 中的詳情寬度當作實際渲染狀態。
- **擠壓重排期間不提供滾動錨定**：版面配置變化可能移動讀者的 viewport。
