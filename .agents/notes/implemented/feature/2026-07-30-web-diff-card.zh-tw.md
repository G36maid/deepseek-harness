# Agent Note: Web diff 卡片 —— write/edit 渲染意圖抵達瀏覽器

Status: implemented

[English](2026-07-30-web-diff-card.md) | 繁體中文

## Problem

`write` 和 `edit` 工具為其 call 和 result 都聲明瞭 `card: 'diff'`（[render-intent union](../architecture/2026-07-02-tool-render-intent-union.md)）：call view 攜帶從參數推導的預期改動，result view 攜帶已應用的上下文 hunk（`FileDiff[]`，由 `packages/fs/tool-fs/src/diff.ts` 計算，並持久化在 result `meta` 中以便重播重建）。該檢視表早已抵達瀏覽器 —— host、connection、runtime 將它作為 `callView`/`resultView` 投遞到 `ConversationSnapshot` —— TUI 也已將其渲染為按文件分組的 `+`/`-` 塊加 `+A -R · N file(s)` 頁腳。

Web 用戶端忽略了它。write/edit 呼叫落到 `GenericToolCard`，其行從原始工具參數推導，詳情面板把 result 的 content block 攤平進一個 `<pre>`。`diffs` 載荷 —— result 的全部意義 —— 被丟棄，於是一次文件改動讀起來只是一行確認、看不到任何改動。

這是把 [terminal 卡片](2026-07-28-web-terminal-card.md) 對 `diff` 這一支重做一遍：那次改動讓 Web 用戶端成為 `terminal` 渲染意圖的消費者；這次讓它成為 `diff` 渲染意圖的消費者，複用同一套四層結構。

## Decision

`DiffBlock` 是一個 `ui-primitives` 元件，把文件改動渲染為內聯 diff 表面，write/edit 呼叫的兩個 Web 渲染點都透過它消費 diff 渲染意圖：chat 工具行的行體和詳情面板的 Output 區。`ui-tool/src/client/tool/models/diff-card-model.ts` 是唯一把快照的 `callView`/`resultView` 對轉成元件 props 的地方，因此兩個渲染點不會對一次改動產生分歧。當兩側都未聲明 `card: 'diff'` 時它返回 null —— 走通用路徑 —— 包括本用戶端版本不認識的 `card` 值，以及已結帳呼叫的 result view 是 generic 的情況（write/edit 的執行錯誤正是這樣留在通用路徑上的）。呼叫結帳後 result 側是權威：已應用的 hunk 替換僅從參數推導的 call 時 diff。分頁視窗丟棄了 call 頭也仍能渲染，因為 result view 攜帶完整改動。

該元件與 TUI 共用單欄框架、行終止符規則和去重路徑計數。兩者的行分類不同：Web 渲染完整的變更前後兩側，而 TUI 會在有界比較完成時派生中性上下文和精確變更行，並把整側回退標記為近似結果。

- **路徑分組。** 新文件開啟一個粗體路徑頭；同文件的第二個 hunk（分散編輯，或 `replace_all`）以一個 `⋯` gap 開啟，而非重複路徑。TUI 在每個 hunk 上都保留路徑頭，但兩個前端的 `N file(s)` 頁腳都按去重路徑計數，因此同文件兩個 hunk 在兩端都讀作 `1 file`。
- **整側改動配色。** 舊側每一行都以 error token 上的 `- ` 顯示，新側每一行都以 success token 上的 `+ ` 顯示，並在橫向滾動的盒子裡以 `white-space: pre` 逐字繪製：原始碼行靠縮排閱讀，因此滾動而不折行。新建（`oldText: null`）沒有刪除側。
- **高度上限帶展開控制元件。** 長於 `DEFAULT_DIFF_MAX_LINES`（16）的 diff 顯示 `ceil(max/2)` 個頭部行加剩餘尾部行，中間一個按鈕報告隱藏行數。分割算術與 `TerminalBlock` 和 TUI 的摺疊卡片一致，因此長 diff 的頭尾切片在兩個前端一致。
- **行終止符。** 每一側的內容按 `TerminalBlock` 與 TUI 共用的終止符規則在 `\n` 上切分：空文字是零行（整文件刪除的 `newText`、新建缺失的 `oldText` 側），單個結尾換行終止其最後一行而非新增一條幻影空行，內部空行保留。
- **頁腳與複製。** 暗色 `└ +A -R · N file(s)` 頁腳報告 Web 卡片完整新側與舊側的行數。TUI 頁腳則在可用時報告精確變更行數，並把有界整側回退標記為近似結果；兩者使用相同的去重路徑計數。複製控制元件複製帶前綴的 Web diff 文字（路徑頭、`- `/`+ ` 行、`⋯` gap），使多文件複製保持可辨別歸屬。

幾何、圓角、字體映像檔 `CodeBlock`/`TerminalBlock`，使 diff 卡片、terminal 卡片、程式碼塊讀起來是一家；`white-space: pre` 加橫向滾動是刻意的分歧。複製控制元件浮在卡片右上角，而非佔據自己的 banner 行，因為只放一個複製按鈕的 banner 會在第一行 diff 上方畫出一條空帶 —— TUI 的 diff 卡片也沒有 banner，只有頁腳。

chat 行把 diff 常駐渲染在路徑連結摘要之下，上限 `CHAT_DIFF_MAX_LINES`（8），對應面板的 16 —— 與 [terminal 卡片](2026-07-28-web-terminal-card.md#inline-output-in-the-chat-row-reverses-a-stated-convention)記錄的內聯輸出決策、以及流內表面與閱讀表面的同一劃分一致。write/edit 行是單文件的，所以它的摘要既是可打開的路徑連結，其 diff 卡片又展開；兩者共存，因為卡片不是路徑的參數體。

## Alternatives considered

**並排（雙欄）diff。** owner 目前拒絕：它更密但不適合狹窄的 chat 行，目標是與 TUI 單欄統一形式對齊。詳情面板裡的雙欄模式是後續的 props 改動，不是重設計。

**git 式行號槽。** `FileDiff` 約定只攜帶 `{ path, oldText, newText }` —— `structuredPatch` 的 hunk 起始行在 `diff.ts` 裡被丟棄，所以沒有行號抵達用戶端。渲染行號槽需要後端約定改動（攜帶 `oldStart`/`newStart`）並同步升級 TUI 以保持一致；推遲，使本變更保持為對既有約定的純 Web 消費。

**複用 `CodeBlock`。** 因與 terminal 卡片相同的理由拒絕：`CodeBlock` 會折行，且沒有每行 `+`/`-` 角色、沒有路徑頭、沒有頁腳。兩者共享幾何與字體 token，那是唯一一處一個實作對兩者都正確的部分。

## Consequences

`DiffBlock` 只讀 diff view 的欄位，因此它是渲染意圖所攜帶內容的純函式 —— 與產出該檢視表的 presenter 一樣重播安全。沒有 diff 能力的 UI 仍得到 bridge 的通用回退；工具的 result 形狀沒有任何改變。無新增執行時期相依性：不同於 terminal 卡片的 `anser`，diff 不需要解析器。

`DiffBlock` 的多文件支路（一張卡、多個路徑頭）今天沒有生產者：`write`/`edit` 每次呼叫各改一個文件，所以真實卡片顯示一個文件帶一個或多個 hunk。該支路為將來的多文件改動工具而建置並測試，不是為當前消費者。

## Testing

`packages/client/ui-primitives/tests/diff-block.client.spec.tsx` 釘住元件：新建支路（只有新增、無刪除側）、編輯支路（刪除在新增之上）、同文件 `⋯` gap 對比新文件自己的頭、空 diffs 的 null 渲染、頁腳計數及其單複數、頭尾上限及其 `aria-expanded` 切換、以及複製控制元件在接受與拒絕兩條剪貼簿路徑上斷言帶前綴的 diff 文字。Per-file 100%。

`packages/client/ui-tool/tests/diff-card.client.spec.tsx` 釘住每個渲染點的接線：`diffCardModel` 的派生及其每個 null 支路、result hunk 替換 call 時 diff、視窗截斷的 call 仍從 result 渲染、chat 行的 diff 體、`FileMutationRow` 的常駐卡片及其路徑連結經 host 以 cwd 解析打開、其在 `write` 與 `edit` 下的註冊、以及面板的 Output 區。

fixture（`packages/client/connection/src/client/fixture.ts`）攜帶三個 diff turn，使 `?fixture` 服務與 per-package 接線測試套件在兩個渲染點演練全部三個支路：單 hunk 編輯（turn 62，keyed `FileMutationRow`）、新建/寫入（turn 63）、多 hunk 編輯（turn 67，一個文件內兩處分散 hunk 之間的 `⋯` gap）。built-boot snapshot（`apps/web/tests/built-boot.snapshot.ts`）是啟動裝配 smoke，只斷言圖掛載並抵達 chat 內容（`data-sample="bash-global"`）；按其自身約定它不帶 diff 行為斷言，那由接線套件負責。

## Related

- [Web terminal 卡片](2026-07-28-web-terminal-card.md) —— `terminal` 支路的同一套四層結構；本 note 複用其內聯輸出決策與頭尾上限算術。
- [工具呼叫呈現的標籤化 render-intent union](../architecture/2026-07-02-tool-render-intent-union.md) —— 本改動消費的 `card` 標籤詞彙；Web 用戶端現在也是 `diff` 支路的消費者。
- [Web 用戶端架構](../architecture/2026-07-19-gui-web-client-architecture.md) —— 兩個渲染點所處的 slot 與快照分層。
