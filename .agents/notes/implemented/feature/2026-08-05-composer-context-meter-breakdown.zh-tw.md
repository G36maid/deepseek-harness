# Agent Note: composer 上下文佔用圓環與啟發式組成明細

Status: implemented

[English](2026-08-05-composer-context-meter-breakdown.md) | 繁體中文

## 問題

Web 聊天的統計行把上下文佔用率作為一個行內數字（`Context N% of X`）擠在計費分組之間。它回答了「有多滿」，卻回答不了「被什麼佔滿」：沒有任何地方展示視窗在系統提示詞、工具 schema 與對話之間如何分配，而單行統計行也容納不下這種明細。可用的數字還分屬兩套口徑——來自 `contextPressure` 的提供方精確計費的提示詞規模，與 token-meter 的固定字元啟發式——沒有任何既有介面能在不混淆兩者的前提下展示組成。

## 決定

三個協作部分，每個包邊界一個：

`dsh-session` 匯出純函式 `deriveEventMessage(event)`（此前只能透過 `Session` 方法訪問，該方法現在委託給它），使 host 側 fold 無需 `Session` 實例即可為表層節點計價。

`dsh-token-meter` 把計價啟發式抽取到 `src/estimate.ts`、把位置表層摺疊抽取到 `src/surface-fold.ts`（兩者都與測量服務逐字共享），並註冊第三個工作階段投影 `contextBreakdown`，攜帶 `systemTokens` / `toolsTokens` / `messageTokens`。envelope 數字在每條 `request/header` 上經 `canonicalHeader` 按後者勝重新計價；訊息數字在逐節點 `{seq, tokens}` 清單上重放 `foldSurfaceTokens`，因此它在每個事件邊界上按構造等於 `measure().surfaceTokens`，壓縮（compaction）會像縮小下一個請求那樣縮小它。這份共享摺疊是全函式且總是新建陣列——返回下一個表層而不是原地改寫——從而保留了服務側「先校驗再提交」的重放交易：拋出時重放遊標不前進，同一條畸形事件在重試時報同樣的錯。摺疊表層中不存在的替換範圍會直接拋出：已提交日誌在追加時就經過表層校驗，無法解析的範圍是日誌損壞，而不是可跳過的事件。

`ui-conversation` 把上下文佔用率從統計行移走（一個事實一個家），放到 composer 尾部的 `ContextMeter`：模型座位之後的一枚 14px 佔用圓環，由 `contextPressure` 供數，點擊彈出的面板把提供方精確的百分比與 `~已用 / 容量` 標題與 4px 分色分段進度列及帶 `~` 前綴的組成明細行並列。兩套口徑刻意永不對帳——啟發式數字只決定進度列各彩色分段之間的相對比例，並原樣顯示在明細行中；每個數字都標有 `~`，因為固定的「4 字元≈1 token」啟發式會系統性低估 CJK 文字與程式碼。（本記錄落地時，圓環、標題與進度列總長取的是提供方精確值；它們現在改讀錨定在提供方讀數上的 `projectedTokens`，因為裸樣本看不見壓縮——見[儀表對壓縮的失明](../bug-fix/2026-08-05-context-meter-blind-to-compaction.md)。）標題是一整句本機化文案（`context.aria`，與圓環的無障礙名共用），在 `{percent}` 槽位處切開渲染，於是讀數的位置由各語言自己決定——英文在前、中文在後——同時讀數保留自身獨立的強調樣式；寬度算出為零的分段直接不渲染，否則 `.segment` 的 min-width 會在 0% 佔用時畫出一段填充色。

## 備選方案

**在用戶端從已載入視窗推導組成。** 視窗是日誌的連續後綴：攜帶系統提示詞與工具 schema 的 `request/header` 事件可能在視窗之外，翻頁還會讓數字悄悄變化。只有持久的 host 側投影能在翻頁與壓縮後倖存，這正是資料以第三個投影而非聊天視窗 fold 的形式過線的原因。

**把啟發式明細行按比例縮放，使其總和等於 `pressureTokens`。** 強行對帳是在捏造精度：壓力滯後一個請求，還包含估算器從不建模的提供方封裝開銷，會讓明細行在組成毫無變化時也跟著變動。最終選擇以顯式 `~` 展示估算器的真實口徑。

**更細的類別（rules、skill（技能）、MCP 工具，如 Claude Code 的 `/context`）。** 在這裡不可分：harness 在請求標頭存在之前就把這些貢獻折入系統文字與工具清單，因此三個類別是誠實的解析度。

## 後果

token-meter 現在註冊三個投影鍵；解除安裝會移除全部三個，`contextBreakdown` 可從 JSON 檢查點復原（`stateVersion` 為 1）。統計行刪除了 Context 分組，圓環成為唯一的上下文 UI。面板的啟發式明細行與提供方精確的標題數字肉眼可見地不一致——已接受並以 `~` 前綴標示；提升估算精度（例如按 CJK 加權）只需改動 `estimate.ts`，不涉及任何 seam。圖例的紫色分段色值是字面量，因為設計平臺沒有紫色靜態 token。
