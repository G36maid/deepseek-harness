# Agent Note: Web 讀取卡片前端 —— 讀取工具的行視窗以帶行號、文法高亮的形式渲染

Status: implemented

[English](2026-07-30-web-read-card-frontend.md) | [简体中文](2026-07-30-web-read-card-frontend.zh.md) | 繁體中文

## Problem

[讀取後端](2026-07-30-web-read-card.md)給 `ToolResultView` 增加了第四種渲染意圖卡片 `card: 'read'`：一次已結帳的讀取現在會把 `{ path, lines: [{ number, text }], totalLines, lang? }` 作為 `resultView` 帶到工作階段快照上。這份資料能到達瀏覽器，但 Web 用戶端沒有消費者。每個讀取行都僅從參數派生，詳情面板把結果的 content block 攤平進一個 `<pre>`，於是讀取顯示為帶 `N: text` 前綴的純文字，沒有行號欄、沒有文法高亮，也沒有視窗讀取的"顯示 N / M"提示。[web 終端機卡片](2026-07-28-web-terminal-card.md)確立了消費一個結構化卡片的模式；讀取卡片沿用它，只在結果側。

## Decision

`ReadBlock` 是一個 `ui-primitives` 元件，把一次讀取結果渲染成帶行號、選填文法高亮的文件檢視表，讀取的兩個 Web 渲染點都透過它消費讀取渲染意圖：聊天工具行（常駐在摘要行之下）與詳情面板的 Output 區段。`ui-tool/src/client/tool/models/read-card-model.ts` 是把快照的 `resultView` 轉成元件 props 的唯一位置，因此兩個渲染點不會產生分歧。

**新建一個 `ReadBlock` primitive，而不是擴充 `CodeBlock`。** `CodeBlock` 已經帶語言橫幅和複製控制元件做 shiki 高亮，但讀取檢視表需要一個每行帶該行自身文件行號的行號欄，而 `CodeBlock` 把內容渲染為單個 `<pre>` 樹、沒有逐行結構。給 `CodeBlock` 加一個選填行號欄會把讀取專屬的關切（視窗行號、"顯示 N / M"提示、高度上限）強加給共享該元件的每個 markdown 程式碼圍欄和每個 `run_code` 程序體。`ReadBlock` 轉而複用真正共享的部分：`markdown/highlight.ts` 裡的 shiki 文法單例。那裡新增的 `highlightLines(code, lang)` 把程式碼切成 shiki 自己的逐行 token 陣列（`codeToTokens`），而不是 `highlightToHtml` 產出的單 `<pre>` HTML，於是該 block 能每行放一個行號、同時用同一套 `--shiki-*` 自訂屬性、同一份文法白名單給內容上色。高度上限及其頭/尾展開演算法照抄自 `TerminalBlock`（`ceil(max/2)` 行頭部加剩餘的尾部），因此長讀取和長命令輸出在同一處摺疊。複製控制元件寫入視窗的原始文字（各行以換行拼接），絕不含行號欄或橫幅。

`readCardModel` 只在結果側，與後端對稱：一次讀取呼叫在 `execute` 返回前不帶任何內容，因此掛起中的呼叫保持為 `GenericCallView`（`kind: 'read'`），本函式對執行中的讀取返回 null —— 該行保持其從參數派生的摘要，直到結果到達。它對結果檢視表不是讀取卡片的已結帳呼叫也返回 null，包括本 UI 版本不認識的 `card` 值（它從線路到來、不能被信任為一個已編譯的變體）以及讀取工具對錯誤結果自己的通用回退。卡片橫幅標籤在工具提供 `title` 時取它（約定的替換標題規則），否則取相對於工作階段工作區化簡後的檔案路徑，使工作區根下的絕對路徑顯示為與行摘要相同的短形式。該 model 把凍結的行陣列複製進 primitive 自己的行形狀，因此卡片絕不持有指向執行時期快照快取的引用。

聊天行把卡片**常駐**渲染在摘要行之下，上限 `CHAT_READ_MAX_LINES`（8，是 primitive 預設值的一半），與 `BashRow` 對終端機卡片的姿態相同 —— block 的內部展開器讓長讀取不會佔據整個訊息流。兩個渲染點承載它：keyed `ReadRow`（經 `ctx.slots.inject` 以 `read` 鍵註冊，與 bash 樣例完全一致），其摘要是作為可打開的宿主連結的檔案路徑；以及 `GenericToolCard` 對沒有自己 keyed 行的讀取聲明工具（例如歸到 `read` 變體的 `web_fetch`）的回退。詳情面板以 primitive 自己的全高上限（16）渲染同一張卡片，因為面板是單次呼叫的閱讀介面。

整行摺疊/展開（把每個工具呼叫默認摺疊）歸[統一展開與檢視 note](2026-07-30-web-tool-row-unified-expand-and-inspect.md)所有，它已一次性翻轉每張常駐卡片；本 note 的卡片是常駐的，與它旁邊的終端機卡片一致。

**讀取卡片的文法按需 lazy 載入，只有 boot 三種保持 eager。** `highlight.ts` 是 `ui-primitives` 在每次 Web 啟動都載入的平臺 seed，其預熱會無條件建置 shiki 單例。讀取卡片的 `langFromPath` 提示覆蓋完整的原始碼/設定/標記擴充集（python、rust、yaml、html……）；把它們全部 eager 註冊會給啟動 chunk 增加約 1.6 MB 的文法模組、並把它們的同步初始化攤給每個工作階段，包括從不打開讀取卡片的工作階段。因此只有每個工作階段本就渲染的三種文法 —— TypeScript、shell、JSON（markdown 圍欄與 `run_code` 語言）—— 在 boot 時載入。每種讀取卡片擴充文法置於 `LAZY_GRAMMARS` 中一個動態 `import()` 之後，以其別名解析到的文法 id 為鍵。對某個 lazy 語言首次呼叫 `highlightLines`/`highlightToHtml` 時，`ensureGrammar` 啟動 import（僅一次）並返回未就緒，於是卡片該幀渲染純文字；import 解析後用 `loadLanguageSync` 註冊該文法、遞增一個載入計數、並通知訂閱者。`ReadBlock` 與 `CodeBlock` 透過 `useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount)` 訂閱，因此文法就緒的那一刻卡片就重渲染帶上高亮。未知/預設語言仍同步返回 undefined（純文字，絕不報錯）。

**空視窗的複製控制元件被隱藏，與 `TerminalBlock` 對齊。** 成功讀取一個空文件會返回 `lines: []`、`totalLines: 0`，且 `presentResult` 仍投出 `card: 'read'`，因此空視窗分支是可達的。故 `ReadBlock` 在 `lines` 為空時隱藏複製控制元件，正如 `TerminalBlock` 對空輸出隱藏複製，使按鈕絕不會用空字串清空剪貼簿。

## Alternatives considered

**給 `CodeBlock` 加一個選填行號欄和 `startLine`。** 拒絕：這會把讀取專屬的行號欄、視窗計數提示和高度上限強加給共享 `CodeBlock` 的每個 markdown 圍欄和 `run_code` 程序體，對那些呼叫者毫無好處。真正共享的介面是 shiki 文法單例，兩個 block 都透過 `highlight.ts` 複用它；圍繞它的外殼各不相同（讀取有行號欄和視窗提示，圍欄兩者都沒有），因此第二個小 primitive 是正確的切分 —— 正如 `TerminalBlock` 是基於同一套 token 的第二個 primitive，而不是 `CodeBlock` 的一種模式。

**複用 `highlightToHtml`，用 CSS counter 注入行號。** 拒絕：shiki 產出的單 `<pre>` HTML 沒有可供行號欄掛上文件行號的逐行邊界（視窗讀取的行號從大於 1 處開始，不是簡單的 CSS counter 自增），而從 HTML 裡把行號解析回來又很脆弱。`codeToTokens` 直接給出逐行 token 結構。

**在 boot 預熱裡 eager 註冊所有讀取卡片文法。** 拒絕：這會給每次 Web 啟動攤上約 1.6 MB 文法模組及其同步初始化，只為一張多數工作階段從不打開的卡片。lazy 路徑的代價是某個語言首次被讀取時的一幀純文字，隨後在文法載入的重渲染裡高亮；boot 代價只為每個工作階段本就渲染的三種文法付出。

## Consequences

`ui-primitives` 增加 `ReadBlock` 和 `highlightLines`；沒有新的執行時期相依性（shiki 已因 `CodeBlock` 存在）。`ReadBlock` 只讀取讀取檢視表的欄位，因此保持為渲染意圖所承載內容的純函式 —— 無工作階段查詢，與產出該檢視表的 presenter 一樣可安全重播。沒有讀取能力的 UI 仍透過通用卡片拿到後端的 `content` 回退（剝掉外殼的文字），保持不變。

Web 聊天裡的讀取行現在常駐承載文件內容，是相對純摘要行的一次刻意的密度增加，受聊天上限約束。按已發布的協定格式，`run_code` 子派發不會到達讀取卡片，與巢狀 bash 呼叫到不了終端機卡片同因：`session.ts` 把 `tool/code-dispatch(-start)` 摺疊為 `resultView: null`，因此巢狀讀取保持通用的攤平形式。

## Testing

`packages/client/ui-primitives/tests/read-block.client.spec.tsx` 固定 primitive 與 token 路徑：`highlightLines` 的逐行 css-variables 片段、它對尾部終止行的丟棄與真正空白末行的情形、它對未知/預設語言返回 `undefined`、以及它的 lazy 路徑（lazy 文法首次觸碰返回純文字，import 註冊且訂閱者觸發後再高亮）；還有 `ReadBlock` 的帶行號行保留文件自身編號、高亮與純文字兩條內容分支、橫幅（標籤、語言、僅當讀取是視窗時的計數提示）、頭/尾高度上限及其 `aria-expanded` 切換、複製控制元件在接受與拒絕兩條剪貼簿路徑上寫入視窗原始文字、以及空視窗分支隱藏複製控制元件。`code-block.spec.tsx` 覆蓋 `highlightToHtml`，含它對每種讀取卡片文法的 lazy 路徑（每個動態 import thunk 各觸碰一次）。`ReadBlock.tsx`、`highlight.ts`（及 `CodeBlock.tsx`）在這兩個 spec 上均保持每文件 100% 覆蓋。

`packages/client/ui-tool/tests/read-card.client.spec.tsx` 固定每個渲染點的接線：`readCardModel` 的派生與每條 null 分支（執行中讀取、無檢視表、通用檢視表、未知卡片）、結果標題替換化簡後的路徑、路徑相對工作區的化簡、凍結行陣列的複製而非別名；`GenericToolCard` 回退中與 keyed `ReadRow` 中的常駐卡片（外加其路徑連結打開宿主、其 running/error/stopped 狀態、以及其 `read` 鍵註冊）；還有面板 Output 區段以全高渲染讀取卡片同時保留 JSON Input 區段，含執行中讀取佔位與非讀取攤平 pre 兩條分支。該文件位於覆蓋 `exclude` 清單（`ui-tool/src/*`），因此不承受門檻壓力。

`packages/client/connection/src/client/fixture.ts` 中的 fixture（測試前置資料）增加輪次 66，一次 `read` 呼叫，其結果檢視表是視窗讀取（行號從文件行 41 起、`totalLines` 180、`ts` 提示），使 built-boot 快照和即時 `?fixture` 伺服器展示帶行號、高亮和計數提示的讀取卡片。它命名為 `read` 以驅動程式 keyed `ReadRow`。輪次 64 的 `run_code` 樣例中的巢狀讀取子派發並不驅動程式渲染點回退讀取卡片：`session.ts` 把它們摺疊為 `resultView: null`，因此它們只覆蓋回退行的通用行形狀，而非回退行內的讀取卡片；回退行讀取卡片由 `read-card.spec.tsx` 的 `web_fetch` 用例釘住。輪次 66 排在 todo 輪次（現為 67）之前，與終端機樣例同因：常駐計畫在下一次 `turn/start` 退場。

## Related

- [讀取卡片後端](2026-07-30-web-read-card.md) —— 增加本文消費的 `card: 'read'` 結果檢視表；產出本文渲染的 `lines`/`totalLines`/`lang`。
- [Web 終端機卡片](2026-07-28-web-terminal-card.md) —— 本文遵循的先例：一個 `ui-primitives` block、一個 `contract/*-card-model.ts` 派生、一個 keyed 行，以及讓 `GenericToolCard`/`DetailsPanel` 感知卡片。
- [Web 用戶端文法高亮](../process/2026-07-26-web-syntax-highlighting-shiki.md) —— 擁有 `CodeBlock` 與 shiki `highlight.ts` 單例，本文以逐行 token 路徑擴充它。
- [工具呼叫呈現的標籤式渲染意圖聯合](../architecture/2026-07-02-tool-render-intent-union.md) —— `card` 標籤詞彙表；Web 用戶端現在是 `read` 分支的完整消費者。
