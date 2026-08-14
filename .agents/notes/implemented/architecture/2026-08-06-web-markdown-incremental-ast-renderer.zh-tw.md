# Agent Note: 經由直接 mdast 渲染器的增量流式 Markdown

Status: implemented

[English](2026-08-06-web-markdown-incremental-ast-renderer.md) | [简体中文](2026-08-06-web-markdown-incremental-ast-renderer.zh.md) | 繁體中文

## Problem

`MarkdownText` 在每次流式發布時都重新解析整個已累積的回覆:react-markdown 的純字串 API 每次渲染都新建 unified processor,並對全文跑完 micromark → mdast → hast → React,因此每個 chunk 的主線程工作量隨回覆長度線性成長,整個流的累計成本隨之二次成長。既有緩解手段(幀級合併、隔離的流式尾部、圍欄 plain 臂)約束的是這份工作跑多頻繁、波及多廣,從未約束每次重新解析多少文字。修復它需要 AST 級輸入——凍結已定型的塊、只重新解析源文字尾部——這是純字串封裝在結構上無法表達的。

## Decision

`MarkdownText` 直接渲染 mdast,並在流式期間增量解析:

- **文法**([parse.ts](../../../../packages/client/ui-primitives/src/markdown/parse.ts)):`parseGfm`(流式臂與 `extractMarkdownPlainText`)和 `parseGfmWithMath`(定稿臂)以被替換的 remark 外掛程式所包裝的同一組 micromark 擴充呼叫 `mdast-util-from-markdown`,因此各處塊邊界完全一致。`mathCompatibility`(原 `remarkMathCompatibility`)現在直接匯出其 micromark 擴充。
- **增量解析**([incremental.ts](../../../../packages/client/ui-primitives/src/markdown/incremental.ts)):CommonMark 塊解析按行推進,追加文字只會重塑解析前沿。`IncrementalMarkdownParser` 保留末尾兩個塊不穩定(最後一塊是前沿;倒數第二塊是安全裕量),凍結其前的所有塊,只從最後一個凍結塊的 `position.end.offset` 起重新解析源尾部——用的是解析器自己的偏移量,沒有任何自製源掃描。每個源區間在整個流中解析 O(1) 次而非每 chunk 一次;單個巨型塊(未閉合圍欄)退化為舊的全量重解析成本,不會更差。非追加輸入在遞增的 generation 下重設狀態。
- **渲染**([render.tsx](../../../../packages/client/ui-primitives/src/markdown/render.tsx)、[katex.tsx](../../../../packages/client/ui-primitives/src/markdown/katex.tsx)):一個對 mdast 節點類型的 switch 取代 remark-rehype + react-markdown,逐位元組復刻被替換管線的 DOM——表格對齊渲染為 `text-align` 樣式、緊湊清單段落解包、任務清單類名與核取方塊空格、腳註區(其頁內錨點本就被協議白名單降為純文字)、字面 raw HTML、會與字面 HTML 文字相鄰顯形的分隔換行,以及 rehype-katex 的三臂容錯鏈,KaTeX HTML 經瀏覽器自帶的 `DOMParser` 對映為 React(無包裹元素,首/末子元素的 margin 規則仍能作用於 `.katex-display`;React 18 會把 `.katex-mathml` 子樹放進 HTML 命名空間,與被替換管線完全一致——既有限制,不在本對等性約定範圍內,對承擔視覺渲染的 `.katex-html` 臂不可見)。凍結塊快取其 React 元素並保持源偏移 key,跨過凍結邊界時走 reconcile 而非重掛載;`MarkdownText` 已 memo 化。

DOM 由 `tests/fixtures/markdown-dom` 釘死:fixture 錄制自替換前的 react-markdown 實作,新渲染器必須在空白規整序列化器下復現。fixture 差異即使用者可見的 markdown 樣式變更,必須按此評審,絕不能為重構而重錄。`tests/markdown-incremental.spec.tsx` 承載等價性性質——以 1/3/7/16 位元組分塊,在每個追加前綴處,常駐元件的 DOM 都等於全新掛載——外加凍結邊界的 DOM 節點同一性與重設行為。

這推翻了[助手 Markdown Note](../feature/2026-07-23-web-assistant-markdown.md) 中被否決的備選("維護一個自訂 React walker"):增量需求是當時不存在的新證據,walker 的安全敏感分支(URL 白名單、圖片策略、惰性 HTML)本就是產品自有函式,而該相依性不再刪減自有程式碼——它阻塞了架構。該 Note 的不可信輸出策略與渲染器選型不變。

## Alternatives considered

**保留 react-markdown,把源文字切成逐段 `<ReactMarkdown>` 實例。** 渲染器零自有成本,但每幀對尾部解析兩次(邊界偵測 + 渲染),定稿數學仍要全量重解析,hast 建置與逐渲染 processor 依舊存在,且塊跨過凍結邊界時會重掛載——元素樹無法跨實例快取。

**用 `mdast-util-to-hast` + `hast-util-to-jsx-runtime` 渲染快取的 mdast。** 白拿上游節點對映,但每幀保留 hast 中間層,並為一個對映面小、封閉、且已被 fixture 釘死的管線引入兩個新直接相依性。

**用 `hast-util-from-html-isomorphic` 解析 KaTeX 輸出(rehype-katex 的做法)。** 為解析可信、詞彙受限的 KaTeX 輸出把基於 parse5 的 HTML 解析器拉進 bundle,而瀏覽器自帶的 `DOMParser`(帶規範的 SVG/MathML 屬性調整)解析結果完全相同。

## Consequences

流式的每 chunk 工作量現在跟隨不穩定尾部而非整個回覆,react-markdown、remark-gfm、remark-math、rehype-katex、unified 及 hast 鏈退出瀏覽器 bundle(`mdast-util-math` 與 `micromark-util-sanitize-uri` 成為直接相依性;兩者原本就是傳遞相依性)。包自有約 25 個節點對映、其測試以及 KaTeX DOM 轉換——代價由凍結其輸出的 fixture 約定避險。兩個行為偏差,均在定稿的全量解析處自愈:定義落在凍結邊界另一側的引用式連結或腳註在流式期間渲染為字面文字;當腳註定義先凍結而引用塊仍不穩定時,腳註引用可能閃回字面文字。本模組與 KaTeX 轉換假定瀏覽器 DOM(`DOMParser`),這個 client-only 包本就如此。
