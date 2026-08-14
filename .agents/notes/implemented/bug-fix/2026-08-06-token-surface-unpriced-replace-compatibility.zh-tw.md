# Agent Note: 未計價的表層替換以中性方式摺疊

Status: implemented

[English](2026-08-06-token-surface-unpriced-replace-compatibility.md) | [简体中文](2026-08-06-token-surface-unpriced-replace-compatibility.zh.md) | 繁體中文

## 問題

`contextPressure` 與 `contextBreakdown` 兩個投影只維護一份滾動累計的表層 token 總量，外加至多一條待結帳的影子價格（shadow price）聲明，因此其持久化檢查點在工作階段整個生命週期內保持 O(1)。當前的替換生產方會緊貼在替換之前追加一條 `compaction/summary` 或 `compaction/prune` 計量事件；其 `shadowedTokenCount` 對被替換區間精確計價，`foldSurfaceProjection` 再把它換算成有符號增量。

影子價格協議引入之前錄制的工作階段，其日誌中的替換沒有相鄰的計量事件。O(1) 狀態無法重建被替換區間的價格，而摺疊此前把每一次未計價替換都當作約定違規並拋出例外，於是重播這類工作階段會在第一處替換就中斷（`token surface: replace at seq … has no adjacent shadow price`），工作階段從此永遠無法打開。

## 決策

到達時沒有已就位聲明的替換以價格中性的方式摺疊：`foldSurfaceProjection` 返回 `deltaTokens: 0`，相當於把被替換區間計價為恰好等於其替換內容的成本，重播隨即繼續。因中間插入的事件而過期的聲明也走同一條中性路徑，因為摺疊無法把它與從未計量過的日誌區分開。

已就位但指向**另一個**區間的聲明仍會拋出例外。此時計量事件確實相鄰，說明生產方寫入了互相矛盾的相鄰事件：這是現行影子價格約定的違規，不是歷史資料，必須響亮失敗，而不能任由總量悄然漂移。

兩個投影共用同一個摺疊，因此二者都不新增狀態欄位，也不提升 `stateVersion`。`surface-fold.ts` 與 `ctx.tokenMeter.measure()` 不受影響：它們持有逐節點的已計價表層，本來就不需要聲明協議。

## 備選方案

**維持拋出例外。**保住了嚴格的生產方約定，但協議之前的每個工作階段都將永遠無法重播，而投影本就是為服務重播而存在的。

**在投影狀態中持久化完整的已計價表層。**可以對任意被替換區間精確計價，但檢查點會隨每條模型可見訊息各增加一個節點、無上限地成長，恰恰破壞了影子價格協議所要守住的 O(1) 約束（見[上下文儀表的 Agent Note](2026-08-05-context-meter-blind-to-compaction.md)）。

## 影響

未計價的替換讓總量保持不動而不是縮小，因此被壓縮（compaction）掉的區段仍被計入：`contextBreakdown.messageTokens` 保留這部分多計的量；`contextPressure.projectedTokens` 會高估佔用率，但只持續到下一個用量樣本重新錨定為止，因為該數字追蹤的是自樣本以來的增減，而非絕對水準。誤差方向是安全的：高估佔用率最壞不過是招致一次更早的壓縮。

響亮失敗保留在它仍有意義的地方：區間不匹配的相鄰聲明是現行生產方的缺陷，仍會拋出例外。

## 測試

`packages/llm/token-meter/tests/context-breakdown-projection.spec.ts` 釘住了無聲明與聲明過期兩種替換的中性摺疊、聲明區間不匹配時的拋出例外，以及聲明匹配時的精確計價。`packages/llm/token-meter/tests/token-usage-projection.spec.ts` 釘住了 `contextPressure` 在一次未計價替換前後保持不動。
