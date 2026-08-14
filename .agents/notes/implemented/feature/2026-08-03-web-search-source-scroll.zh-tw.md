# Agent Note: Web search 來源卡片改為滾動而非摺疊

Status: implemented

[English](2026-08-03-web-search-source-scroll.md) | [简体中文](2026-08-03-web-search-source-scroll.zh.md) | 繁體中文

## 問題

`web_search` 結果卡片（`WebBlock`，`packages/client/ui-primitives/src/WebBlock.tsx`）此前用首尾摺疊渲染它的來源清單：超過 `maxSources` 數量（詳情面板為 16，聊天行經由 `CHAT_WEB_MAX_SOURCES` 為 8）時，它畫出前 `ceil(max/2)` 條來源、一個 `… 其余 N 条来源` 展開按鈕，再畫出末尾 `max - ceil(max/2)` 條，仿照 `TerminalBlock` 的輸出上限機制。使用者閱讀該卡片時看到 `来源列表已截断`，會以為前端丟棄了它正持有的來源。

其實並沒有。seam（`capSources`，`packages/web/web/src/index.ts`）把 provider 的來源裁剪到工具的 `searchMaxResults` 上限（默認 8）並置位 `truncated`，而這一份被裁剪過一次的清單同時喂給面向模型的 render 文字與卡片的 `presentationMeta`。卡片持有的來源絕不會多於這一次裁剪的產物。因此這個摺疊隱藏的正是使用者本有權完整查看的來源——並且在默認上限為 8、面板上限為 16 時，它幾乎從不觸發，只留下 `truncated` 提示，卻無從展開任何內容。

## 決策

`WebBlock` 的 search 分支把它收到的每一條來源都渲染進單個 `<ol className={css.sources}>`，不做首尾切片、不設展開按鈕、也不帶 `maxSources` prop。`.sources`（`WebBlock.module.css`）獲得一個固定的 `max-height` 與 `overflow-y: auto`，因此長於卡片高度的清單在原地滾動，而非撐大卡片或隱藏行。該高度是卡片幾何形狀的一個設計常數，因此放在 CSS 裡，而非外掛程式設定欄位。

模型側不變：seam 仍在 `searchMaxResults` 處封頂來源，面向模型的 render 文字未動，`truncated` 標志及其 `来源列表已截断` 指示保留。卡片完整且可滾動地畫出 seam 產出的這份清單，而非摺疊其中段。

只要工具下游沒有單獨改寫結果 content，這份清單就是模型讀到的那份。掛載了 `dsh-spill-policy` 的部署會對超限結果打破這一對應：`tools/post-execute` 把面向模型的 `content` 替換為預覽加 spill 定位符，而 `presentationMeta` 原樣保留，因此卡片仍畫出全部來源，模型讀到的卻是一段有界摘錄。所以卡片的約定是它收到的 view，不是模型的上下文。

`CHAT_WEB_MAX_SOURCES` 與該 primitive 的 `DEFAULT_WEB_MAX_SOURCES` 被移除：有了滾動，聊天行與詳情面板展示同一份完整清單，僅以各自的容器高度區分。`<li value={ordinal}>` 仍釘住每條來源從 1 起算的引用序號；沒有了摺疊造成的間斷，這些序號如今就是連續的。

把清單變成滾動容器，也把它的 `padding-left` 從間距變成了正確性約束。滾動容器裁掉 inline-start 方向的溢位且無從滾回，而 `::marker` 靠右對齊到內容邊緣，因此寬於 padding 的序號會靜默丟掉前導數字——在清單原本的 20px 下，兩位數序號被畫成 `0.` 與 `1.`，而本該是 `10.` 與 `11.`。`searchMaxResults` 是無上界的正整數，因此該 padding 以 `em` 計量——相對清單自身的字體，也就是序號所繼承的那個——裝得下三位數序號（`999. ` 在應用字體棧下量得 2.35em），並保留一位數情形原有的間隙。

## 考慮過的替代方案

**提高 `searchMaxResults`（或讓它無上限），使更多來源同時抵達模型與卡片。** 被使用者否決：它改變了模型側行為（每個請求的上下文納入更多來源、更多 token），並拉大模型讀到的內容與卡片畫出的內容之間的差距。

**保留首尾摺疊，僅對展開區域加滾動。** 否決：一個關注點上兩套重疊機制。一旦整份清單始終渲染，摺疊的算術、展開/摺疊狀態與那個按鈕都是累贅；僅靠滾動即可約束高度。

**把滾動高度做成外掛程式設定欄位。** 否決：該高度約束的是卡片在螢幕上的幾何形狀，而非部署策略，因此它屬於 `WebBlock.module.css`，與 [Web result 卡片前端筆記](2026-07-30-web-result-card-frontend.md) 已作為本卡片幾何固定在那裡的圓角、表面與外邊距並列。

## 後果

工具返回的每一條來源始終存在於 DOM 中，因此 view 攜帶的來源沒有一條被藏在互動之後。無論來源數量多少，卡片高度都受限；高於容器的清單在原地滾動。代價是滾動提示相依性平臺的捲軸渲染：overlay 捲軸系統（macOS 默認）在指針離開時不顯示常駐捲軸，因此受高度限制的清單依靠 `来源列表已截断` 提示加上被裁切的最後一行來表明還有更多內容。`WebSearchBlockProps`/`WebFetchBlockProps` 失去 `maxSources` prop，primitive 失去 `DEFAULT_WEB_MAX_SOURCES`，因此未來任何呼叫方都從構造上渲染完整清單，而不是靠傳入一個很大的上限值。

## 測試

`packages/client/ui-primitives/tests/web-block.client.spec.tsx` 刪去摺疊相關用例（首尾切片、點擊展開、摺疊尾部編號、展開器不計入編號、僅首部、默認上限），並新增：一張含 30 條來源的卡片渲染出全部 30 個 `<li>`，無 `[aria-expanded]`、無 `<button>`，每個 `<ol>` 子元素都是一條來源 `<li>`，且 `<li value>` 從 1 到 N 連續編號。`packages/client/ui-tool/tests/web-card.client.spec.tsx` 刪去 `CHAT_WEB_MAX_SOURCES` 上限斷言；WebRow 展開測試仍斷言卡片展示每一個來源欄位。`packages/web/tool-web` 的測試不變——模型側沒有改動。

jsdom 不解析 CSS Modules 版面配置，對任何元素都報 `scrollHeight === clientHeight`，因此它根本無從見證這次滾動。幾何改由組裝態瀏覽器釘住，位於 `apps/web/tests/web-search-round.e2e.ts`：其確定性 search double 返回 12 條提供方結果，每條帶標題、引用摘錄與日期。這首先在真實組合裡端到端釘住 seam 的裁剪——出廠 `searchMaxResults` 保留 8 條，面向模型的 render 文字含這 8 條標題、不含被丟棄的 4 條 URL，並含 `(Showing the first 8 sources. Refine the query for more.)`，`meta.truncated` 為 true。隨後位於 aria golden 之後的一個用例展開 `web_search` 行，對卡片的 `<ol>` 斷言：8 個 `<li>`、卡片內任何位置都沒有 `<button>`、`来源列表已截断` 指示可見，以及計算樣式 `max-height: 320px` 與 `overflow-y: auto`，`scrollHeight` 為 574、`clientHeight` 為 320。再後一個用例在清單自身繼承的字體下量出 `999. ` 序號的寬度，要求計算後的 `padding-left` 不小於該寬度，從而把滾動容器無從滾回的那段序號空間釘在最寬序號上，而非釘在某一份 fixture（測試前置資料）的來源條數上。錄制的模型流與 aria golden 都未變動：重播是對 fixture 中 `assistant/chunk` 條目的位置遊標，而 search double 是提供方經 `fetch` 抵達的另一個本機端點；捕獲時卡片處於摺疊狀態，其 `<ol>` 不在 DOM 中，摘要行也不攜帶來源數量。

## 相關文件

- [Web result card](2026-07-30-web-result-card.md) —— 本卡片消費的 `card: 'web'` 渲染意圖分支與 `presentationMeta` 路由；那份裁剪過一次的清單的來源。
- [Web result 卡片前端](2026-07-30-web-result-card-frontend.md) —— `WebBlock`、唯一的 `web-card-model` 派生，以及繪製該卡片的各渲染點由它擁有；本筆記替換掉它所規定的來源清單摺疊，它的其餘決策（一個元件繪製兩種 kind、http(s) 連結 allowlist、單一派生、常駐姿態）依然成立。
