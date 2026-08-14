# @deepseek-ai/dsh-client-ui-primitives

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

純 React 原子元件（零 cordis）：StateDot、DisclosureRow、ic_ds_* 圖示、Button/Pill/Menu/Modal/Input、Toast 短時橫幅、OnboardingSurface 首次使用接管層（portal 到 body 的遮罩加不透明展示層，在且僅在自身生命週期內保持 `#root` 為 `inert`）、markdown 家族（MessageText/MarkdownText/JsonBlock）、只讀 JsonTree 檢查器、`useAnchoredMaxHeight` 掛鉤（把底部錨定的浮層高度收斂到錨點上方的視口空間，並在 resize、scroll 與呼叫方提供的相依性變化時重新測量）、TerminalBlock、DiffBlock、ReadBlock、SearchBlock，以及 WebBlock。

## 懸浮卡片

`HoverCard` 透過指針離開寬限期，使採用 portal 算繪的預覽在跨過與錨點之間的間隙時仍可觸及。消費端還可傳入 `copyText`：此時卡片為指針與鍵盤啟用提供按鈕語義，其無障礙名稱會在 `copyLabel` 前綴後包含該值，透過包內剪貼簿輔助函式原樣寫入該值，並且只有宿主接受寫入後，才會臨時將內容替換為 `copiedLabel`。與卡片相交的非摺疊文字選區會阻止指針點擊啟用；成功回饋保持卡片原有高度，並隨卡片關閉或在一秒後清除。`copyLabel` 和 `copiedLabel` 採用 label prop，是因為這個 zero-cordis 原子元件無法讀取應用 locale；省略 `copyText` 時，卡片維持只讀且選填擇文字的行為。歷史依據見[已封存的懸浮卡片複製 Agent Note](../../../.agents/notes/archived/feature/2026-07-31-hover-card-click-copy.md)。

## Toast

`Toast` 是頂部的短時橫幅：滑入後滿不透明度停留三秒，再用一秒淡出，隨後呼叫 `onDone` 由持有方解除安裝。它算繪 `role="alert"`，帶選填的前置圖示插槽，文案是必填 prop（零 cordis，由持有方本機化）。它經 body portal 算繪且 `pointer-events: none`，距視口頂部 120px，水準中心跟隨選填的 `anchor` 元素（視窗尺寸變化時重測）——composer 傳入自己的卡片，橫幅因此在聊天列而非整個視窗上置中——不傳則回退到視口置中。重複展示同一則訊息需要重新掛載，持有方用每次展示遞增的序號作為 key，讓相同文案重新走完停留與淡出，而不是靜默複用已淡出的橫幅。`prefers-reduced-motion: reduce` 下去掉滑入，只保留延遲淡出。它的層級高於 ui-attachment 的圖片燈箱，預覽打開時報出的失敗仍然可讀。

## Markdown 算繪

`MarkdownText` 透過 React 元素算繪來自不受信任 assistant 輸出的 GFM 與 `$…$`、`$$…$$`、`\(…\)` 和 `\[…\]` TeX 公式，公式由 KaTeX 排版並停用受信任命令；塊級同一行 `$$…$$` 是顯示公式並支援 `\tag{}`。一個小範圍的 micromark 擴充允許由星號標記、以標點結尾的粗體在緊鄰的 CJK 文字前閉合，以適應 CJK 文字通常省略 CommonMark 所要求空格的寫法；單星號強調、緊鄰非 CJK 文字的情況、轉義、程式碼與數學公式仍沿用上游解析行為。它會省略原始 HTML，使相對連結及非 HTTP(S)/mailto 連結失效，以安全的外部連結屬性打開 HTTP(S) 連結，並在不傳送 referrer 的情況下算繪採用絕對 HTTP(S) URL 的圖片；相對路徑、絕對本機路徑、`file:` URL 與不受支援的 scheme 會保留其 alt 文字。完整內容為絕對 HTTP(S) URL 的行內程式碼會保留程式碼樣式，並獲得同樣安全的外部連結；命令、非完整 URL、其他 scheme 與圍欄程式碼仍不會成為連結。選填的 `fileMentions` 解析器讓持有該元件的檢視表為命名真實文件的行內程式碼新增可點擊入口：token 保留程式碼樣式，並獲得一個連線到解析所得 opener 的按鈕，按鈕帶有解析器提供的無障礙標籤和以完整路徑為值的 `title`。算繪器絕不猜測哪些內容像路徑：未解析的 token 保持不可互動；文件提及僅應用於已定稿的算繪（流式快取不得固化可能過期的 handler）；錨點內的 token 也保持不可互動，因為按鈕不能巢狀其中。回覆流式輸出期間，`MarkdownText` 增量解析：除末尾兩個塊外全部凍結為快取的 React 元素，每個區塊只重新解析其後的源文字尾部，因此每區塊的工作量跟隨尾部而非整個回覆（[機制與 DOM 一致性約定](../../../.agents/notes/implemented/architecture/2026-08-06-web-markdown-incremental-ast-renderer.md)）。`MessageText` 仍是使用者創作內容使用的字面文字原語。`extractMarkdownPlainText` 會移除 Markdown 呈現標記以用於緊湊標籤，同時將原始 HTML 保留為字面文字。元素間距、響應式圖片、表格、連結與行內程式碼使用與 deepsuite `@deepseek/md` 相同的 `--dsw-alias-markdown-*` / `--dsw-font-markdown-*` token。圍欄程式碼區塊透過 `CodeBlock` 算繪（語言橫幅、複製控制元件，以及對已註冊文法使用 shiki）。

## 終端機輸出

`TerminalBlock` 將一條 shell 命令算繪為終端機表層：命令的每一行各佔一個提示行（縮短後的 `cwd` 標籤只出現在第一行，因為檢視表只知道一個工作目錄，而一個 `cd` 就會讓後面的行去到別處，標籤之後是該行）、命令輸出、非零結束碼或終止訊號對應的狀態膠囊，以及寫入原始 `output` prop 的複製控制元件。一枚執行狀態 `StateDot` 為整次呼叫標記一次，位於第一行，以脫離文件流的方式落在卡片以自身左內邊距預留的落區中，因此它位於卡片盒之內、提示文字之左。它用到 `StateDot` 的三種狀態——`running` 期間為追逐動畫，與算繪狀態膠囊相同的結束狀態為紅色，其餘為綠色——因此卡片直接陳述其命令是否仍在執行，而不是讓人從有無輸出中推斷；由於 `StateDot` 是 `aria-hidden`，它攜帶一處視覺隱藏的文字標籤。無論多少行都只有一枚狀態點是有意為之：結束狀態屬於整次呼叫，因此每行一枚就會聲稱一個檢視表並不攜帶的逐行結果。命令文字使用 `white-space: pre`，因此重複空格、製表符與縮排續行都原樣呈現，同時該行仍保持單行並以省略號截斷。ANSI 轉義序列透過執行時期相依性 `anser` 解析為 React span；遊標移動在剝除無顯示意義控制符之前先重放進逐行的列緩衝，因為回車與退格**只移動**遊標：單是 `100%` 加回車再加 `OK` 顯示為 `OK0%`，而 spinner 隨重繪寫出的 `\x1b[K` 會擦掉尾巴，因此 `100%\r\x1b[KOK` 顯示為 `OK`。行內擦除的三種參數形式都被遵循，遊標按終端機列推進（8 列製表位；emoji 與 CJK 佔兩列；組合標記不佔列），SGR 狀態按單元格歸一化儲存，與終端機一致，並跨行延續、在行結束時的狀態處收束；基礎 16 色前景色對映到 `--dsw-*` token，而 256 色板與真彩色值按字面 rgb 透傳。輸出保持 `white-space: pre` 並支援橫向捲動，因此按列對齊的輸出保留其對齊而不會軟換行；超過 `maxLines`（預設 16）時摺疊為頭部切片加尾部切片，由展開按鈕控制。原理：[Web 終端機卡片筆記](../../../.agents/notes/implemented/feature/2026-07-28-web-terminal-card.md)。

## Read 算繪

`ReadBlock` 將返回的文件視窗算繪為帶行號、文法高亮的程式碼表層：一個粗體路徑（或 presenter 提供的標題）橫幅加複製控制元件，其下是內容行，行號槽裡是文件自身的行號（視窗化的 read 保留文件本身的編號，因此偏移之後的 read 從大於 1 處起始）。`totalLines` 超過視窗行數時畫出 `showing N of M` 提示；超過 `maxLines`（預設 16，與 TerminalBlock 相同的切分演算法）時摺疊為頭部切片加尾部切片，由展開按鈕控制。高亮走與 `CodeBlock` 相同的 shiki 路徑。原理：[Web read 卡片筆記](../../../.agents/notes/implemented/feature/2026-07-30-web-read-card.md)。

## Diff 算繪

`DiffBlock` 將一次文件改動算繪為內聯 diff 表層：每個文件一個粗體路徑頭、刪除行（`- `，error token）在新增行（`+ `，success token）之上、同文件第二個 hunk 前一個 `⋯` gap，以及暗色 `└ +A -R · N file(s)` 頁腳。各行使用 `white-space: pre` 並橫向捲動，因此原始碼行保留其縮排而不軟換行；超過 `maxLines`（預設 16，與 `TerminalBlock` 相同的切分演算法）時摺疊為頭部切片加尾部切片，由展開按鈕控制。新建（`oldText: null`）沒有刪除側。複製控制元件寫入帶前綴的 diff 文字（路徑頭、`- `/`+ ` 行、gap），使多文件複製保持可歸屬，並浮在右上角而非佔據自己的 banner 行。幾何結構與 `CodeBlock`/`TerminalBlock` 一致。原理：[Web diff 卡片筆記](../../../.agents/notes/implemented/feature/2026-07-30-web-diff-card.md)。

## 搜尋結果

`SearchBlock` 算繪一次已完成的搜尋，並透過 `kind` 判別，由一個元件處理兩種結果。`matches`（grep）將每個文件顯示為粗體路徑頭及其 `lineNumber: line` 行，各文件組均可摺疊；`paths`（glob）顯示扁平的路徑清單。兩者都攤平成一個行清單，由高度上限對其做頭尾切片（預設 16，與 `TerminalBlock` 相同的切分演算法），且都不軟換行：較長的匹配行或路徑會橫向捲動而非折行。當工具截斷結果時，banner 摘要會包含截斷前的總數（grep 為 `显示 X / 共 N 处匹配 · K 个文件`，glob 為 `显示 X / 共 N 个路径`），使卡片絕不把截斷後的結果呈現為完整結果；無論是否觸及上限或哪些組處於摺疊狀態，複製控制元件都會寫入完整的結構化結果。幾何結構與 `CodeBlock`/`TerminalBlock` 一致。原理：[Web 搜尋卡片筆記](../../../.agents/notes/implemented/feature/2026-07-30-web-search-card.md)。

## Web 檢索

`WebBlock` 算繪一次已完成的 web 檢索，用一個元件繪製 `web` 算繪意圖的兩種 kind（由 `kind` 判別）。`search` 在有序引用清單上方顯示選填的提供方回答（透過 `MarkdownText`）：每個 source 是一個安全外鏈，以其標題為標籤，或以其主機名為標籤，當 URL 無法解析或沒有主機名（`file:`/`data:` URL）時回退到原始 URL，因此標籤絕不為空；其下算繪 snippet 與發布日期。只有 http(s) URL 會成為錨點（設定 `target`/`rel`）——這是 `MarkdownText` 對不受信任連結所用 allowlist 的 http(s) 子集（該 allowlist 還允許 `mailto:`，此處排除）；任何其他 URL 算繪為純文字。整份清單算繪在一個定高捲動容器裡（`max-height: 320px`、`overflow-y: auto`），因此超出該高度的清單在原地縱向捲動，而不是把卡片撐高；`<li value>` 固定每個 source 的引用編號，從 1 起連續，而不相依性 `<ol>` 的隱式計數。當一次 search 合法地返回無 answer 且無 source 時，卡片顯示一個明確的空狀態提示，而不是空的 `<ol>`（chat 行不呈現原始 result content）。`fetch` 顯示一個緊湊摘要：帶連結的最終 URL 及其 HTTP 狀態。兩者都會標記一次被截斷的檢索。原理：[Web result 卡片筆記](../../../.agents/notes/implemented/feature/2026-07-30-web-result-card-frontend.md)與[來源捲動筆記](../../../.agents/notes/implemented/feature/2026-08-03-web-search-source-scroll.md)。

## 模型體驗

無。該包在瀏覽器中算繪純 React 原子元件；這裡沒有任何內容進入模型請求。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **流式期間跨邊界引用解析被推遲**：定義落在增量凍結邊界另一側的引用式連結或腳註，在回覆流式輸出期間算繪為字面文字；定稿時的全量解析會將其解析。內聯連結以及在同一次解析內完成解析的引用不受影響。
- **字形級圖示是重新繪製的近似版本**：魚形標志（以及 ui-conversation 持有的閃光圖示）來自字體字形，而本機設計資料無法匯出其向量幾何；在獲得精確匯出路徑前，使用手工重建版本代替。
- **Pill 與 Input 沒有設計來源**：兩個原子元件均自行定義；與其相似的側邊欄搜尋欄位和檢視表標籤條由消費端組合，不是這些原子元件。
- **StateDot 沒有 `Active` 變體**：支援的狀態為 done、warning、ongoing 和 error。
- **面向使用者的文案經 label props 本機化，預設值為原中文字面量**：這些原子元件是 zero-cordis 的，拿不到 `ctx.locale`，因此 `HoverCard`（`copyLabel`/`copiedLabel`）、`TerminalBlock`（`labels`）、`JsonTree`（`labels`）、`CodeBlock`（`copyLabel`/`copiedLabel`）、`MarkdownText`（`codeLabels`）、`JsonBlock`（`truncatedLabel`）、`ConnectionBanner`（`label`）和 `Modal`（`closeLabel`）都把文案作為選填 props 接收。已本機化的外掛程式用自己的 `t` 席位傳入字典驅動的 label；什麼都不傳的消費端得到的就是這些預設值。`WebBlock` 尚未跟進這一模式：它的來源清單截斷提示與 fetch 截斷提示、以及空搜尋提示仍是內聯中文，待同樣的 label-prop 處理。
- **`TerminalBlock` 不是終端機模擬器**：它算繪已結束或仍在執行的命令輸出，而不是互動式工作階段：SGR 顏色與屬性會被遵循，進度行所用的行內遊標移動同樣被遵循——回車、退格、行內擦除、製表位與字元寬度。絕對遊標定位、清屏與備用螢幕序列會被剝離。基礎 16 色中的洋紅與青色沒有對應 token，保持字面 rgb。
