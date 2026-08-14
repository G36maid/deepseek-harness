# Agent Note: 上下文儀表看不見壓縮

Status: implemented

[English](2026-08-05-context-meter-blind-to-compaction.md) | [简体中文](2026-08-05-context-meter-blind-to-compaction.zh.md) | 繁體中文

## 問題

composer 的[上下文儀表](../feature/2026-08-05-composer-context-meter-breakdown.md)的圓環、百分比與 `~已用 / 容量` 標題都取自 `contextPressure.pressureTokens`，即提供方報告的最新提示詞規模。這個數字只在某個請求報告用量時才會移動，而壓縮（compaction）不報告用量：`compaction-basic` 透過直連的 `ctx.llm.stream()` 呼叫生成摘要，只追加 `compaction/start`、`compaction/summary`、用作替換的 `user/message` 和 `compaction/end`——沒有 `assistant/message`，也沒有用量區塊。

於是在唯一一個專門用來改變它的操作面前，這塊儀表紋絲不動。透過真實的 agent loop（代理循環）驅動一次 `compactNow`：

```
BEFORE compact:  ring=4%  header=~4227/100000   rows=[system 18, tools 0, messages 4365]
AFTER  compact:  ring=4%  header=~4227/100000   rows=[system 18, tools 0, messages  286]
```

摺疊表層得出的組成明細行下降了 93%。而圓環——那個主要的可操作元素，也正是使用者壓縮完立刻會去點開面板的理由——完全沒動，而且要等到又跑完一整個輪次才會動。此時面板上的標題與明細行相差一個數量級以上，恰恰發生在學者最可能去把明細行加總的時刻。

## 決策

`contextPressure` 發布第二個分子 `projectedTokens`：在提供方樣本之上，加上自取樣以來表層增減部分的啟發式重新計價，下界鉗制為零。該摺疊透過共享的 `surface-fold.ts` 攜帶已計價的表層，並在用量樣本落地時記下 `sampledSurfaceTokens`——記錄時機在同一條事件加入表層**之前**，因此 `assistant/message` 錨定的正是它自己那次請求實際攜帶的表層。`stateVersion` 提升到 3。

只有增量部分是估算的。錨點保持提供方精確值，從而把估算器對 CJK 文字與 JSON Schema 的系統性低估擋在佔用率數字之外，同時又讓這個數字能在內容落地或某段區間被遮蔽的瞬間做出反應。`contextOccupancy` 讀取 `projectedTokens`，並回退到裸樣本，因此從不含該欄位的檢查點復原出來的投影會退化為舊行為，而不是直接消失。

這推翻了[上下文儀表決策](../feature/2026-08-05-composer-context-meter-breakdown.md)中「圓環、標題與進度列總長保持提供方精確值」的那一半。那條決策真正想守住的東西——不要把啟發式明細行按比例縮放到提供方總量、從而偽造精度——依然守住了：明細行仍未被縮放，標題仍不等於它們之和。改變的是這樣一個認識：「提供方精確、但描述的是兩次壓縮之前那個請求」並不是更真實的數字。

## 備選方案

**改為投影 `measure().totalTokens`。** 測量服務本來就合成了正是這個量（`baseline` 錨點加有符號的 `surfaceDeltaTokens`），而且反應正確——同一次壓縮前後實測為 4383 → 304。但它是一個建立在私有重放狀態上的服務，不是純摺疊，投影無法呼叫它。要在 `ProjectionDefinition` 內部復現它的錨點，需要 `_estimateProviderAssistant` 對按 seq 引用的區塊事件進行隨機訪問（`session.events[seq]`），而 `apply(state, event)` 拿不到。以取樣時的表層總量作為錨點，是同一個思路在純逐事件摺疊中可達的版本。

**在壓縮結束時補寫一條合成的用量記錄。** 這確實能推動 `pressureTokens` 本身，但壓縮手上唯一的用量是摘要請求自己的用量——那是完全另一個提示詞。把它記成本對話的提示詞規模，等於把謊言寫進持久日誌，而不只是寫進某一處展示。

**讓 UI 自己做減法：暴露 `sampledSurfaceTokens`，再讀 `contextBreakdown.messageTokens`。** 這會把一個數字的算術拆散到兩個投影和用戶端三處。詞彙的所有者是宿主，就應當由它發布完整值。

## 影響

佔用率現在隨每個表層事件推進，而不再是每個輪次跳一次，因此一個輪次中產生工具結果時圓環會持續爬升，而不是等到輪次結束才跳變——壓縮落地的瞬間它也會掉下來。代價是線路上多了投影幀：`contextPressure` 每個表層事件推一幀，也就是 `contextBreakdown` 本來就在跑的頻率。

面板的組成明細行仍然加不出標題數字，但現在只剩一個能講清楚的原因，而不是兩個：明細行帶著估算器的誤差，標題的錨點不帶。剩下的抓手是估算精度（在 `estimate.ts` 裡做 CJK 感知加權），它不改動任何 seam。

`sampledSurfaceTokens` 相依性一個前提：在某個步驟的請求與它的用量報告之間，不會有新內容加入表層。agent loop 在 `buildRequest` 之前接納 steering（中途引導）與上下文，在 `assistant/message` 之後才排空工具結果，因此該前提成立；即便將來不再成立，誤差也被限制在一則訊息以內，並在下一個樣本處自行糾正。

## 測試

`packages/llm/token-meter/tests/token-usage-projection.spec.ts` 覆蓋了投影值在表層成長與一次壓縮期間的延續更新（樣本保持不動而投影值縮小），以及啟發式誤差會把數字壓到負數時的零鉗制。`packages/client/ui-conversation/tests/context-meter.client.spec.tsx` 釘住圓環讀取投影值這一點，`chat-stats.spec.tsx` 釘住 `contextOccupancy` 的優先級與回退。上面那組端到端數字來自在掛載了投影登錄檔的真實 `AgentLoop` 上驅動 `BasicCompactionEngine.compactNow`。
