# Agent Note: fork 錨點向下取整到事件 seq

Status: implemented

[English](2026-07-31-fork-anchor-floors-to-event-seq.md) | [简体中文](2026-07-31-fork-anchor-floors-to-event-seq.zh.md) | 繁體中文

## 問題

在已停止的助手訊息上點 fork 毫無反應——沒有子工作階段，沒有報錯，也沒有任何可見變化。

這則訊息背後的凍結節點並不是日誌事件。即時投影和歷史重播都用 `turnEnd.seq - 0.9` 這個排序坐標來生成它，讓它嚴格落在被中斷輪次的所有事件之後、下一輪之前，而 chat 檢視表原樣把這個節點 seq 交給 fork 入口。`session.fork` 在 wire 上只接受非負整數，因此分數錨點在抵達 host 之前就被判為 invalid-params，而 chat 入口的 fork 呼叫又吞掉了失敗。於是被拒絕和按鈕失靈在表現上毫無區別。

host 的切分規則從來不是障礙。被中止的輪次會記錄一條 reason 為 `aborted` 的 `turn/end`，它和其他輪次一樣是可切分的完整前綴——只是錨點根本沒送到。

## 決策

`SessionRuntime.fork` 在發起 RPC 前對 `atSeq` 向下取整。分數 seq 這個約定屬於 `dsh-client-runtime`，即時投影和重播投影都由它生成，因此也由同一個包在跨出 wire 邊界時把它換回真實事件 seq，而不是要求每個 UI 呼叫方各自記得轉換。整數錨點不受影響。

向下取整落在錨點自身所在的輪次內，不會回退：每一輪都以 `turn/start` 開頭，所以 `turnEnd.seq - 1` 不可能是上一輪的 `turn/end`。host 隨後按「首個位於錨點或其之後的 `turn/end`」收口，命中的正是讀者點擊的那一輪，與訊息級 fork 按鈕在已完成輪次上一貫承諾的整輪語義一致。

apiproxy 的 fork 用例固定了 host 這一側的約定：落在被中止輪次內的取整錨點會切穿該輪，並把它種進子工作階段。

## 備選方案

**讓 wire 接受分數 `atSeq`。** 否決：host 約定要的是事件 seq，而不是連續坐標上的某個位置；分數形式只是某一個用戶端的渲染約定，一旦放行，`atSeq` 會成為所有攜帶 seq 的載荷中唯一容忍非整數的欄位。

**在已中斷的訊息上隱藏 fork 按鈕。** 否決：從讀者主動叫停的那一輪分叉，恰恰是最需要 fork 的場景之一，而 host 側這個能力一直是好的。

**在 chat 入口的 `forkAt` 配接器裡取整。** 否決：`ui-conversation` 只是分數約定的消費端，並不擁有它；將來任何第二個 fork 入口都得把同樣的轉換重新發現一遍。

## 影響

從已停止的輪次 fork 會得到一個種子切到該輪 `turn/end` 的子工作階段。被凍結的殘缺文字是從 chunk 事件重建出來的，從未成為 `assistant/message`，因此它不會進入子工作階段的模型上下文——正如源工作階段復原時它也不會進入一樣，子工作階段拿到的上下文與源工作階段一致。

fork 失敗在 chat 入口仍然是靜默的。這個 bug 能存活至今，正是因為該呼叫點丟棄了自己的 rejection；把 fork 錯誤呈現到 UI 上是另一件事。
