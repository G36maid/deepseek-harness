# Agent Note: Web result 卡片前端 —— 在瀏覽器渲染 web 渲染意圖

Status: implemented

[English](2026-07-30-web-result-card-frontend.md) | [简体中文](2026-07-30-web-result-card-frontend.zh.md) | 繁體中文

## Problem

`web_search` 和 `web_fetch` 工具聲明瞭 `card: 'web'` result view（[web result card](2026-07-30-web-result-card.md)）：一個 `kind` 標籤聯合,攜帶結構化的被引用 sources 加選填的 provider answer（`kind: 'search'`),或抓取的 URL 及其 HTTP 狀態（`kind: 'fetch'`）。該檢視表早已抵達瀏覽器 —— host、connection、runtime 將它作為 `resultView` 投遞到 `ConversationSnapshot` —— 但 Web 用戶端忽略了它:一次已完成的 web 呼叫只渲染為攤平的模型可見文字,正是約定筆記所解釋的、結構化檢視表要替代的那種有損渲染。`web_search` 到達讀者時是每個 source 一行自由文字 markdown,而非可點擊 source 的引用清單;`web_fetch` 是它的 markdown 正文,沒有檢索摘要。

## Decision

`WebBlock` 是一個 `ui-primitives` 元件,渲染一次已完成的 web 檢索,web 呼叫的每個 Web 渲染點都透過它消費 `web` 渲染意圖:鍵控的 chat 工具行（`web_search`/`web_fetch`）、`GenericToolCard` 渲染點兜底,以及詳情面板的 Output 區。`ui-tool/src/client/tool/models/web-card-model.ts` 是唯一把快照的 `resultView` 轉成元件 props 的地方,映像檔 `terminal-card-model.ts`,因此沒有兩個渲染點會對一次 web 呼叫的顯示產生分歧。它返回 null —— 走通用路徑 —— 對執行中的呼叫（web 卡片是 result-only 的,因為工具保留 generic pending 檢視表）、對 result view 不是 web 卡片的已結帳呼叫（包括本用戶端版本不認識的 `card` 值,它經 wire 抵達因而不能被信任為已編譯的變體）、對 generic result view（web 工具的錯誤路徑返回 generic 卡片,其文字由通用路徑保留）、以及對本用戶端版本不認識 `kind` 的 web 卡片（更新的 host 經 wire 發來的值,讀作 fetch 會畫出空 URL 和 `HTTP undefined`）。

一個元件繪製兩種 kind,由 `kind` 判別。`search` 把 answer 作為 markdown 顯示在引用清單上方;每個 source 是一個安全外鏈,以其標題為標籤,provider 未給標題時以其主機名為標籤,下方是 snippet 與發布日期,工具截斷清單時顯示 `来源列表已截断` 提示。`fetch` 顯示一個緊湊摘要:帶連結的最終 URL、其 HTTP 狀態、以及 `内容已截断` 提示。用一個元件而非兩個,因為兩者都是渲染為同一卡片族的 web 檢索 —— 這正是約定把它們放在一個 `card` 標籤下、用 `kind` 判別的原因。

**連結的安全性沿用 MarkdownText 對不受信任的 assistant 連結所用 allowlist 的 http(s) 子集。** MarkdownText 還允許 `mailto:`，此處刻意排除，因為檢索 URL 絕不會是郵件地址。一個 source 或 fetch URL 僅當其協議為 `http:` 或 `https:` 時才成為可導覽錨點，帶 `target="_blank"` 和 `rel="noopener noreferrer"`；`javascript:`/`data:`/`file:`/`mailto:` URL 或無法解析的字串渲染為純文字、無 href。web 工具返回的 result content 是模型創作的,未經驗證抵達本元件,因此像 assistant markdown 一樣被當作不受信任處理。標籤從標題回退到主機名再回退到原始 URL,因此即便標題缺失且 URL 無法解析,source 也總能讀作某個東西。

**幾何映像檔 CodeBlock/TerminalBlock**（12px 圓角、code-block 表面、16px 垂直外邊距）,使 web 卡片與它們讀作一家。整份 source 清單渲染在單個 `<ol>` 裡,由 `max-height: 320px` 與 `overflow-y: auto` 約束,因此高於該值的清單在原地縱向滾動,而不是把卡片撐高（[來源滾動](2026-08-03-web-search-source-scroll.md)）。source 清單是散文而非按列對齊的輸出,所以它正常換行,而不像終端機卡片的輸出那樣橫向滾動 —— 這是與 TerminalBlock 唯一刻意的分歧。

卡片在 chat 行中**常駐**於摘要行之下,與 `BashRow` 所用的同一常駐姿態。兩個渲染點展示同一份完整的 source 清單,僅由卡片自身的滾動高度約束,而沒有行與面板兩級的 source 上限。鍵控行把一個 `WebRow` 元件註冊在 `web_search` 與 `web_fetch` 兩個鍵下;行僅根據工具名判別以選取其圖示（search 對 browse）與標題（`Search`/`Fetch`）。沒有自己鍵控行的 web 聲明工具落到 `GenericToolCard`,它長出同一張常駐卡片。詳情面板渲染該卡片,並在其下方渲染攤平的模型可見結果內容:`web_fetch` 卡片只攜帶 URL 與狀態,因此其抓取正文只在此處可讀。

## Consequences

`WebBlock` 只讀 web view 的欄位,因此它是渲染意圖所攜帶內容的純函式 —— 無工作階段尋找,與產出該檢視表的 presenter 一樣重播安全,且不同於終端機卡片它不需要 cwd 解析,因為 web view 不攜帶路徑。沒有 `web` 能力的 UI（TUI）仍得到約定的回退 `content`;工具的 result 形狀沒有任何改變。answer 複用 `MarkdownText`,因此 answer 自身的不受信任連結處理與 GFM 渲染免費獲得。

每張常駐卡片（terminal、diff、web）共用的整行摺疊/展開互動歸[統一展開與檢視 note](2026-07-30-web-tool-row-unified-expand-and-inspect.md)所有;本卡片遵循常駐約定,而非搶先做那套互動。

## Alternatives considered

**兩個元件,每種 kind 一個。** 拒絕:兩種形狀共享卡片外框、安全連結處理、截斷提示,而約定已經把它們的差異表達為一個 `card` 標籤下的 `kind` 判別;兩個元件會重複共享表面並拆分安全連結邏輯。

**重解析模型可見的渲染文字,而非消費結構化檢視表。** 因約定筆記給出的同一理由拒絕:`web_search` 的渲染把每個 source 的欄位壓縮成一行自由文字、以標題或主機名為標籤,所以重解析無法復原 `{url, title?, snippet?, publishedAt?}`。結構化的 `resultView` 是唯一忠實來源,這正是後端約定新增它的原因。

**不加協議 allowlist 直接渲染裸錨點。** 拒絕:URL 在此展示邊界處是模型創作、未經驗證的,所以未過濾的 href 會讓 `javascript:` URL 在點擊時執行。該 allowlist 是 MarkdownText allowlist（它還允許 `mailto:`）的 http(s) 子集,因此不受信任的檢索連結無論在何處渲染都行為相同。

## Testing

`packages/client/ui-primitives/tests/web-block.client.spec.tsx` 把元件釘到 per-file 100% 門檻:兩種 kind;標題-或-主機名-或-原始 URL 的標籤回退;兩種 kind 上的安全連結屬性（http(s) URL 成為帶 `target`/`rel` 的外鏈,`javascript:`/`file:`/無法解析的 URL 渲染為無 href 的純 span）;snippet 與日期在存在/為空/缺失時的顯示或省略;由標志位控制的截斷提示;以及完整 source 清單渲染在單個滾動容器內、無展開控制元件、`<li value>` 從 1 起為每條 source 連續編號。

`packages/client/ui-tool/tests/web-card.client.spec.tsx` 在每個接線邊界映像檔 `terminal-card.spec.tsx`:`webCardModel` 的派生投影每個 source 欄位、其截斷與缺失 answer 的支路、fetch 派生、以及每個 null 支路（執行中、null result view、generic result view、未知 card 標籤、未知 web `kind`）;鍵控 `WebRow` 對兩種 kind 的常駐卡片、其僅摘要行的執行中與失敗支路;`GenericToolCard` 兜底為 web 聲明工具長出常駐卡片、並為非 web 呼叫保持純行;詳情面板 Output 區對兩種 kind —— 含 `web_fetch` 正文攤平在其 URL/狀態卡片下方 —— 及其對非 web 結果的攤平回退;以及在 `web_search` 與 `web_fetch` 兩鍵下用一個元件的鍵控註冊。該文件位於覆蓋率 `exclude` 清單（`ui-tool/src/*`）,因此覆蓋率執行不度量它。

fixture（`packages/client/connection/src/client/fixture.ts`）新增 turn 66（`web_search`）與 67（`web_fetch`）,內聯撰寫,因為用戶端 fixture 無法 import web 工具:turn 66 的 result view 攜帶一個 answer 與三個 source,演練引用清單（一個帶 snippet 與日期的有標題 source、一個無標題因而以主機名標注連結的 source、一個有日期無 snippet 的 source）並開啟截斷提示;turn 67 攜帶抓取的 URL 與一個 200 狀態。兩者都保留 generic pending call view,僅在 result 時新增 `web` 卡片,匹配約定的 result-only web 形狀,且以真實工具命名,使其命中鍵控 `WebRow`。它們被排在 todo turn（重編號為 68）之前,理由與終端機 turn 相同:待定計畫在下一個 `turn/start` 退休,所以排在其後的 turn 會清空 dock 的 plan strip。這驅動程式 built-boot snapshot 與一個即時 `?fixture` 服務。

## Related

- [Web result card](2026-07-30-web-result-card.md) —— 新增 `card: 'web'` result 支路並讓兩個工具寄出它的後端契約;其前端消費端歸本 note 所有。
- [Web search 來源卡片改為滾動而非摺疊](2026-08-03-web-search-source-scroll.md) —— 用定高滾動容器替換本筆記的 source 清單頭/尾摺疊,並移除 `CHAT_WEB_MAX_SOURCES` 與原語自身的 source 上限;本筆記的其餘決策依然成立。
- [Web terminal card](2026-07-28-web-terminal-card.md) —— 本條所映像檔的先例:一個 `ui-primitives` block、一處 card-model 派生、鍵控與兜底 chat 行、以及一個詳情面板支路,用於 `terminal` 渲染意圖。
- [工具呼叫呈現的標籤化 render-intent union](../architecture/2026-07-02-tool-render-intent-union.md) —— `card` 標籤詞彙;Web 用戶端現在是 `web` 支路的完整消費者。
