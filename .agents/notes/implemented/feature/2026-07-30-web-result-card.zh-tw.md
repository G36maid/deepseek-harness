# Agent Note: Web result card — a structured render intent for web_search and web_fetch

Status: implemented

[English](2026-07-30-web-result-card.md) | 繁體中文

## Problem

`web_search` 與 `web_fetch` 工具各自聲明瞭一個 generic 待處理卡片（`presentCall`，`kind: 'search'`/`'fetch'`），但沒有 `presentResult`，因此一個已完成的 web 呼叫抵達 UI 時只剩下面向模型的 render 文字。對於想渲染引用清單或抓取摘要的 web 前端而言，該文字是有損的：`web_search` 的 render 把每個來源的 `title`、`snippet`、`publishedAt` 壓進一行以 title 或 hostname 標注的自由文字 markdown（`packages/web/tool-web/src/search.ts` 中的 `formatSearchOutput`），因此重新解析 render 無法復原各來源欄位；`web_fetch` 的 render 也僅在一行 header 裡攜帶 `url` 與 `statusCode`。渲染意圖約定（[標籤聯合類型](../architecture/2026-07-02-tool-render-intent-union.md)）此前沒有一個可供 web 工具聲明、用以攜帶結構化結果的分支。

## Decision

向 `ToolResultView`（`packages/core/tools/src/presentation.ts`）新增一個 `card: 'web'` 結果分支，它是以 `kind: 'search' | 'fetch'` 欄位作判別的聯合 `WebResultView = WebSearchResultView | WebFetchResultView`，並附一個表示單個可引用來源的 `WebSource` 形狀。兩個工具現在都聲明 `presentResult`。

採用一個標籤加 `kind` 判別，而非兩個標籤。兩個呼叫都是 web 檢索，web 前端會用同一族元件渲染它們（一個檢索卡片，正文按 kind 不同），因此共用一個 `card` 讓每個 card 消費端的 switch 只需新增一個分支，並讓前端在其內部按 `kind` 分岔。兩個標籤會迫使當前及未來每個消費端為本屬同一視覺族的東西新增兩個分支。這兩個 `kind` 取值與兩個工具既有的 generic 呼叫檢視表 `kind` 一致，因此一個呼叫與它的結果讀起來是同一類別。

`presentationMeta` 攜帶 render 文字無法攜帶的東西。工具從 `execute` 返回的結構化結果對象**不會**經由 wire 抵達用戶端——只有面向模型的 `render` 文字，以及（聲明時）投影到 `tool/result` 事件 `meta` 上的 `output.presentationMeta` JSON 會。對 `web_search`，meta 是得到 `{url, title?, snippet?, publishedAt?}` 的**唯一**忠實途徑：render 把這些欄位壓進一行有損的自由文字，消費端無法重新解析。對 `web_fetch`，meta 是更小但真實的收益：`url`/`statusCode` 可從確定格式的 `Fetched <url> (HTTP <n>)` header 行還原，但 `truncated` 是有效截斷——提供方上限、轉換前源截斷，或部署的 `fetchMaxOutputChars` 輸出上限——用戶端無法重算，因為它不知道那個上限。抓取卡片與面向模型的文字都從同一個 `renderFetchOutput(result, maxOutputChars)` helper 派生 `truncated`，因此卡片絕不會與模型看到的尾部資訊分叉。這照搬 write/edit 的 diff 範本（`packages/fs/tool-fs/src/diff.ts`）：一個 `*MetaFromValue` 投影器喂給 `output.presentationMeta`，一個 `*MetaFromResult` 收窄器讀回 `result.meta`，並在失敗時防禦性回退到 generic 卡片。`web_fetch` 的正文已是結果內容中的 markdown，因此不重複寫入 meta。

兩個結果檢視表都不攜帶 `content` 副本。不渲染結構化 `web` 卡片的 UI 回退到原始 `tool/result` 內容，這也是 generic 卡片消費的輸入。把結果內容複製進檢視表會在同一投遞幀上重複最多 `fetchMaxOutputChars` 個字元卻毫無收益（與 meta 一節對抓取正文的否決同理），因此檢視表省略它，回退路徑渲染完全相同的文字。每個檢視表從呼叫參數設定其結果期 `title`（`args.query`／`args.url`），因此丟掉了呼叫頭的視窗截斷重放仍有標題，與 write/edit 在結果期重設 title 的做法一致。

`presentResult` 在錯誤結果、以及 `meta` 缺失或畸形時返回 `undefined`（即 generic 卡片），因為 presentation 會在對任意已記錄結果（可能來自舊 schema）的重放中執行，絕不能拋錯。收窄器防禦性地校驗每個欄位；空來源清單是有效 meta，而非畸形。

## Consequences

前端消費端屬於 [Web result card 前端 note](2026-07-30-web-result-card-frontend.md) 的工作範圍：本次生產者變更新增約定分支並讓兩個工具寄出它，不含用戶端渲染。其唯一可觀察的變化是 `web_search`/`web_fetch` 的 `tool/result` 事件持久化一個 `data.meta` 載荷（`web-fetch` keyless 快照當時隨之刷新）；面向模型的 render 文字與 generic 回退內容保持不變。渲染 `web` 卡片的組裝應用 transcript（文字記錄）快照屬於渲染它的消費端變更。任何做窮盡 switch 的 `ToolResultView` 消費端都必須新增一個 `web` 分支；非窮盡消費端可以使用原始結果回退。`apiproxy` 的工作階段 schema 已接受任意 `card` 字串（`packages/host/apiproxy/src/api/sessions.schema.ts`），因此新檢視表無需 schema 變更即可跨 wire。

未來想用此卡片的 web 工具，聲明一個返回帶自有 `kind` 的 `card: 'web'` 檢視表的 `presentResult`；新增第三個 `kind` 是一次聯合類型編輯加前端的分岔，而非一個新的 card 標籤。

## Alternatives considered

**兩個 card 標籤（`web-search`、`web-fetch`）。** 否決：它在每個 card 消費端處為一個視覺族翻倍分支數，而兩個形狀已有足夠多的共性（一個帶回退內容的帶標題檢索卡片），`kind` 判別無需第二個標籤即可表達差異。

**在 `presentResult` 裡重新解析 render 文字，而非投影 meta。** 對 `web_search` 否決：render 的來源清單是有損的（title 或 hostname 標籤，snippet 與日期拼進自由文字），因此重新解析無法忠實復原結構化欄位。`presentationMeta` 是唯一保留它們的途徑。

**把抓取正文放進 meta，或把結果內容複製進任一檢視表。** 否決：正文已是結果內容中面向模型的 markdown，把它複製進 meta 或檢視表的 `content` 欄位會為無收益的目的翻倍持久化或投遞載荷；不具備 `web` 能力的 UI 回退到既有的結果內容，那是相同的文字。

## Testing

`packages/web/tool-web/tests/tool-web.spec.ts` 覆蓋以下內容，滿足按文件 100% 的閘門：`searchMetaFromValue`/`fetchMetaFromValue` 投影，含省略不存在的選填欄位，以及抓取 `truncated` 投影在僅輸出上限截斷正文時、以及在毫無截斷時都與 render 尾部資訊一致；`searchMetaFromResult`/`fetchMetaFromResult` 收窄，含一次往返與每種畸形形狀的拒絕（非對象、欄位類型錯誤、畸形來源條目）以及空來源清單的接受；`presentSearchResult`/`presentFetchResult` 類型化檢視表，含從參數派生的 title、無 `content` 副本、truncated 訊號、錯誤結果回退與畸形 meta 回退；以及兩次真實登錄檔執行，斷言工具把 meta 投影到 `result.meta` 上，其註冊的 `presentResult` 推匯出 `card: 'web'` 檢視表。

## Related

- [標籤化的工具呼叫渲染意圖聯合類型](../architecture/2026-07-02-tool-render-intent-union.md) —— 本卡片以 `web` 分支擴充的 `card` 標籤詞彙表。
- [Web terminal card](2026-07-28-web-terminal-card.md) —— 把 bash `terminal` 渲染意圖帶到瀏覽器的先例；[Web result card 前端](2026-07-30-web-result-card-frontend.md)是它針對這一分支的對應方案。
