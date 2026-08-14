# Agent Note: Web 搜尋卡片 —— grep 與 glob 的 render intent 到達瀏覽器

Status: implemented

[English](2026-07-30-web-search-card.md) | [简体中文](2026-07-30-web-search-card.zh.md) | 繁體中文

## Problem

`grep` 與 `glob` 工具聲明瞭一個僅在結果階段存在的 `card: 'search'` render intent（[search render card](2026-07-30-search-render-card.md)）：`SearchMatchesResultView`（`shape: 'matches'`）攜帶 grep 按文件分組的匹配，或 `SearchPathsResultView`（`shape: 'paths'`）攜帶 glob 的扁平路徑清單，兩者都帶 `truncated`/`total` 截斷訊號。該檢視表已經到達瀏覽器 —— host、connection、runtime 把它作為 `resultView` 投遞到 `ConversationSnapshot` 上 —— 但 Web 用戶端忽略了它：每個非終端機、非 diff 的工具結果都落到 generic 卡片，渲染面向模型的文字。想把搜尋結果渲染成可展開的按文件匹配分組、或可掃讀的路徑清單的 web 前端，只有那段預格式化文字。

這正是 search render card note 指名的後續：後端約定和它的兩個生產者歸那篇 note 所有，web 消費端歸本 note 所有。

## Decision

`SearchBlock` 是一個 `ui-primitives` 元件，把一次已完成的搜尋渲染成兩種形態之一，`grep`/`glob` 呼叫的 Web 渲染點都透過它消費搜尋 render intent。`ui-tool/src/client/tool/models/search-card-model.ts` 是把 snapshot 的 `resultView` 轉成元件 props 的唯一位置，因此沒有渲染點重新推導形態。當結果檢視表不是搜尋卡片時它返回 null（走 generic 路徑），包括仍在執行的呼叫（搜尋卡片僅在結果階段存在，`execute` 前無內容）、`grep`/`glob` 失敗或巢狀 `run_code` dispatch 產生的 generic 結果、terminal 結果檢視表、本用戶端版本不認識的 `card` 值、`shape` 是本版本無法編譯的 `card: 'search'` 檢視表，以及 —— 因為 `shape` 和分組/扁平內容與 host schema 只做字串校驗的那同一個不可信 wire 幀同行 —— 一個 `shape` 已知但 `files`/`paths` 缺失或格式錯誤的檢視表（否則會讓 `SearchBlock` 在 `.reduce`/`.map` 處崩潰）。結果檢視表的判別鍵是 `shape`（不是 `kind` —— 後端把 `kind` 留給 call view 的選圖示簽）；`SearchBlock` 自身的 prop 仍是 `kind`，由本推導從 `shape` 對映得到。

與終端機卡片的不對稱是刻意的，繼承自後端約定：`terminalCardModel` 同時讀 `callView` 和 `resultView`，因為命令、cwd、description 在呼叫時就存在；`searchCardModel` 只讀 `resultView`，因為搜尋的匹配或路徑只在執行後存在。因此執行中的搜尋行只顯示摘要，沒有卡片。

一個元件繪製兩種形態，用 `kind` 區分，因為 `grep` 和 `glob` 是同一個視覺對象 —— 一個搜尋結果。`SearchMatchesBlockProps`（`kind: 'matches'`）和 `SearchPathsBlockProps`（`kind: 'paths'`）讓每種形態的欄位保持必填，而不是所有欄位都選填的單一介面。元件把它持有的形態壓平成一個渲染行清單 —— matches 形態是一個文件頭行加它的匹配行，paths 形態是每個路徑一行 —— 於是高度上限把一個文件頭當作一行來計，與一條匹配行或一個路徑相同，頭/尾切片算術就是 `TerminalBlock` 的（`ceil(max/2)` 頭，其餘為尾），因此一個長搜尋結果和一段長命令輸出在兩張卡片間在同一處截斷。

元件約定：

- **按文件分組的匹配，逐文件可摺疊。** 每個文件是一個頭行（加粗路徑加它的匹配計數，整行即摺疊控制元件），後面跟它的 `lineNumber: line` 行。摺疊一個組會把它的匹配行從壓平清單和高度上限的算術裡去掉，但絕不從複製文字裡去掉。
- **扁平路徑清單。** paths 形態每行一個路徑，無頭行。
- **截斷指示。** `truncated` 時，橫幅摘要把截斷前總數折入 —— grep 為 `显示 X / 共 N 处匹配 · K 个文件`，glob 為 `显示 X / 共 N 个路径` —— 因此卡片絕不把一個被截斷的頁面呈現為完整結果。未 `truncated` 時摘要是一個樸素的結構計數（`{n} 处匹配 · {m} 个文件`，或 `{n} 个路径`）。
- **被截斷結果的復原腳註。** 卡片只持有保留的那一頁，但通往其餘部分的定位符 —— grep/glob 的 `Full … stored at: <locator>` 腳註 —— 只存在於原始 `tool/result` 內容裡（搜尋檢視表不攜帶結果文字；沒有卡片的 UI 回退到那段原始內容），而非結構化的 matches/paths 中。由於每個渲染點都用卡片替換了原始結果，`searchCardModel` 在（且僅在）結果被截斷時把 block 自身壓平後的結果文字作為 `SearchCardModel.recovery` 暴露出來，每個渲染點把它畫在卡片下方。沒有它，通往被丟棄行的唯一路徑就會從 UI 裡消失；未截斷的結果攜帶了每一行，其原始文字不增加任何資訊，因此被丟棄。
- **不軟換行。** 結果行在一個橫向滾動的盒子裡 `white-space: pre`，因此一條長匹配行或一個深路徑橫向滾動而不摺疊。
- **帶展開控制元件的高度上限。** 超過 `DEFAULT_SEARCH_MAX_LINES`（16）行時顯示一個頭/尾切片，中間一個按鈕報告被隱藏的行數，形狀和算術與 `TerminalBlock` 相同。
- **複製。** 複製控制元件寫入整個結構化結果 —— 每個文件與匹配，或每個路徑 —— 無關高度上限或哪些組被摺疊，因此剪貼簿攜帶的是結果本身，而不是卡片此刻恰好顯示的內容。

幾何、圓角、字體映像檔 `CodeBlock` 與 `TerminalBlock`，因此搜尋卡片與它們讀作同一族；`white-space: pre` 加橫向滾動是它們共享的刻意分歧。

### 渲染點

三個渲染點消費該推導，與終端機卡片的落位完全一致：

- **keyed `SearchRow`**（`toolviews/search-row.tsx`）把一個元件同時註冊到 `tool.call.toolview` keyed hole 的 `grep` 與 `glob` 鍵下，並把卡片作為常駐（resident）渲染在摘要行下方，上限為 `CHAT_SEARCH_MAX_LINES`（8）—— 與 `BashRow` 對其終端機卡片採取的姿態相同。兩個工具名共用同一行，因為推匯出的 `kind` 決定形態，第二個元件只會重複它。被截斷結果的復原腳註畫在卡片下方。因為 keyed 行佔據了這個渲染槽，一個沒有搜尋卡片的已結帳呼叫 —— 出錯的搜尋（grep/glob 出錯時不產出結果檢視表）、成功的巢狀 `run_code` 子派發（後端不為其計算 `presentationMeta`，故 `resultView` 為 null）、或舊日誌的 generic 結果 —— 否則只會顯示摘要而丟失內容；該行把這段面向模型的文字作為 fallback body 暴露出來，判據是 `search === null && 已结算`，而非僅憑錯誤狀態。（該常駐姿態與 terminal/diff 卡片一致；一次性翻轉了所有常駐卡片的整行摺疊/展開互動歸[統一展開與檢視 note](2026-07-30-web-tool-row-unified-expand-and-inspect.md)所有。）
- **generic fallback**（`chat/GenericToolCard` → `chat/ToolRow`）把推匯出的 model 作為展開門控的 body 傳入，與 `terminal` 用的是同一分支：沒有 keyed 行的 `grep`/`glob` 結果（發布應用裡沒有，因為兩者都註冊了）仍在行的展開開關後渲染其卡片，並帶復原腳註。
- **details panel**（`skeleton/DetailsPanel`）在 Output 段以 primitive 自身的完整高度渲染卡片，復原腳註畫在其下方，保留 JSON Input 段。

`CHAT_SEARCH_MAX_LINES`（8）是行內上限，為 primitive 預設值的一半（panel 保留預設值），理由與 `CHAT_TERMINAL_MAX_LINES` 相同：chat 流是跨多次呼叫掃讀的摘要表面，panel 是單次呼叫的閱讀表面。

## Alternatives considered

**兩個卡片元件，每個工具一個。** 否決：`grep` 與 `glob` 是僅由 `kind` 區分的同一視覺對象，兩個元件會重複橫幅、高度上限、複製控制元件與不換行幾何。一個按 `kind` 分支的元件正是後端那個單一 `card: 'search'` 檢視表的用途。

**加一個 `SearchCallView`，讓行在搜尋執行時期就渲染卡片。** 否決：後端約定刻意沒有呼叫階段的搜尋檢視表 —— 搜尋在 `execute` 前沒有匹配或路徑。執行中的行只顯示摘要，`searchCardModel` 對執行塊返回 null，忠實於實際存在的東西。

**複用 `TerminalBlock` 或 `CodeBlock`。** 否決：兩者都不建模逐文件可摺疊的組或摺疊式截斷摘要，都需要把按文件分組的形態硬塞進去。三個塊轉而共享幾何與字體 token，那是唯一一處一個實作對三者都正確的部分。

## Consequences

`SearchBlock` 只讀搜尋檢視表的欄位，因此保持為 render intent 所攜內容的純函式 —— 無工作階段查詢，與產生該檢視表的 presenter 一樣可重放。沒有搜尋能力的 UI 仍得到 bridge 的圍欄回退；工具的結果形態沒有任何改變。給 `ToolRow` 擴一個 `search` body prop 只在 `terminal` 旁加一個分支；一次呼叫至多攜帶一種卡片，因此兩者絕不同時出現在一行。

## Testing

`packages/client/ui-primitives/tests/search-block.client.spec.tsx` 以 per-file 100% 覆蓋固定元件：兩種 kind、折入摘要的截斷前總數、空結果分支、逐文件摺疊/再展開且不影響鄰居、一個文件頭與匹配行一樣，在高度上限中單獨計為一行、切口落在文件中間時尾部切片復原其所屬文件頭、跨兩種形態的頭/尾上限及其展開控制元件（含無尾與默認上限的邊界），以及複製控制元件在接受與拒絕的剪貼簿路徑上寫入整個結構化結果。

`packages/client/ui-tool/tests/search-card.client.spec.tsx` 固定每個渲染點的接線：`searchCardModel` 對兩種 kind 的推導、截斷訊號、替換標題、僅在截斷時暴露的復原文字，以及每個 null 分支（執行中、無檢視表、generic、terminal、未知卡片、本版本無法編譯的 `kind`、以及一個形態缺失/錯誤的已知 kind）；透過 `GenericToolCard` 的展開門控 matches 與 paths body（含復原腳註），對照非搜尋的 args-JSON body；`SearchRow` 對兩種 kind 的常駐卡片、它的復原腳註、它對出錯搜尋與已結帳無卡片結果兩者的 fallback body、它與摘要行執行狀態的一致、替換標題優先級，以及一個元件在 `grep` 與 `glob` 兩個鍵下的 keyed 註冊；以及 details panel 的 Output 段對兩種 kind（含復原腳註），對照非搜尋的壓平形態。`packages/client/ui-tool/src/*` 在覆蓋排除清單上，因此該文件不受 gate 壓力。`packages/client/connection/src/client/fixture.ts` 新增一個寄出 `kind: 'matches'` 的 `grep` turn（三個文件、十二行超過行內上限、`truncated` 且帶溢位復原腳註，因此在組裝快照裡同時演練頭/尾上限與復原腳註）與一個寄出 `kind: 'paths'` 的 `glob` turn，兩者都驅動 built-boot snapshot 與即時 `?fixture` 服務。`apps/web/tests/search-card.snapshot.ts` 是倉庫約定要求的組裝輸出檢查：它透過 keyless fixture 傳輸啟動真實建置的 `client.js` bundle，打開 fixture 工作階段，並把 grep 卡片的組裝形態——kind、截斷摘要、頭/尾切片及其展開控制元件——固定在 `apps/web/tests/snapshots/search-card/` 下，因此一個損壞的 SearchRow 註冊或被丟棄的卡片會讓一個 golden 失敗，而 built-boot smoke（按約定只測啟動）無法捕獲它。

## Related

- [Search render intent —— grep 與 glob 寄出結構化搜尋卡片](2026-07-30-search-render-card.md) —— 後端約定與它的兩個生產者；本 note 是它指名的 web 消費者後續。
- [Web 終端機卡片](2026-07-28-web-terminal-card.md) —— 本 note 映像檔的先例：工具的 render intent 透過一個 `ui-primitives` 塊、一個 `contract/*-card-model.ts` 推導、以及同樣的三個渲染點到達瀏覽器。
- [工具呼叫呈現的標籤化 render-intent 聯合](../architecture/2026-07-02-tool-render-intent-union.md) —— 兩張卡片都消費的 `card` 標籤詞彙。
