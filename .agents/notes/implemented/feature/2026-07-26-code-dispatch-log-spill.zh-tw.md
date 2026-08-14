# Agent Note: 將 Code Mode 子分發結果的持久化副本納入 spill 機制

Status: implemented

[English](2026-07-26-code-dispatch-log-spill.md) | [简体中文](2026-07-26-code-dispatch-log-spill.zh.md) | 繁體中文

> 範圍：用既有的 spill 實作限制 `tool/code-dispatch` 事件的內容。[宿主側基礎 Agent Note](2026-07-26-code-dispatch-ui-foundation.md) 有意接受了不設上限的日誌，並把 spill 支持留到本次更改；[即時平行 Agent Note](2026-07-26-code-mode-live-parallel-dispatch.md) 定義了該監聽器處理的事件對。

## 問題

加入完整內容的分發日誌後，讀取大文件的 `run_code` 程序會把完整的渲染文字寫進工作階段日誌，既沒有上限，也不經過 spill 策略；原生結果則會在記錄之前限制在 `maxInlineBytes` 以內。兩類結果受到不同處理，而為批次資料工作設計的子呼叫最可能產生巨大結果；每個受影響的輪次都會讓 JSONL 成長數 MB。

## 決策

**在登錄檔上增設 `tools/code-dispatch-log` waterfall（瀑布式事件），spill 策略作為其第一個監聽器。**

- **擴充點**：`tools/code-dispatch-log` 是一個按作用域過濾的 waterfall，橋接層會在追加 `tool/code-dispatch` 之前，對每個已結帳的子分發執行它。橋接層透過 `RunCodeBridgeOptions` 以能力閉包形式接收登錄檔私有的 `shapeDispatchLog` 呼叫器；waterfall 是公開約定，該呼叫器不會增加服務方法。監聽器拋出例外時，呼叫器會安全地報告任意拋出值，並使用原始的已結帳內容。`CodeDispatchLog` 載荷包含外層執行、`agent` 路由鍵、子呼叫標識和默認內容；默認內容是原生 `tool/result` 會攜帶的渲染後結果投影，而程序收到結構化 `value`。監聽器只能替換持久化副本，模型不會看到這份副本。監聽器作為受跟蹤任務在程序的返迴路徑之外執行。待處理日誌任務超過 `maxParallelSubCalls` 時，有序提交迴圈會等待，因此慢速 spill 後端會限制後續子呼叫啟動，而不會無限累積待完成 I/O。run 結帳仍會等待開放輪次內的全部任務完成。
- **策略**：`dsh-spill-policy` 為該事件註冊監聽器，並複用面向模型結果的監聽器所用的替換程式碼：相同的 `maxInlineBytes` 上限、預覽和定位符、不超上限不變式，以及盡力而為回退。spill 產物以 `dispatch` 為標籤，記錄在子呼叫 id 名下。UI 與重播透過被 spill 的原生結果所用的同一路徑讀取全文，因此兩類結果會渲染出相同的資訊。
- **一處有意差異**：面向模型結果的監聽器跳過 `read`，以防出現 `read → spill → read again` 迴圈。分發日誌監聽器也會替換過大的 `read` 子呼叫內容，因為日誌副本不是模型上下文，該迴圈不會發生，而 `read` 最可能產生巨大的日誌條目。

## 曾考慮的替代方案

**在橋接層內部使用普通位元組數上限，不存入 spill。** 否決：沒有定位符的截斷會丟失重播或 UI 可能需要的資料，還會復原之前更改已經移除的、資訊較少的「截斷摘要」渲染。

**直接在橋接層內做 spill，即從 `code-mode.ts` 呼叫 `ctx.spillStore`。** 否決：登錄檔會要求提供 spill 能力。waterfall 把該策略與其他 spill 決策放在一起，並允許組合不載入它；省略 `maxInlineBytes` 時，該監聽器仍不執行任何操作。

**讓巢狀呼叫複用 `tools/post-execute`，而不是新增一個事件。** 否決：post-execute 可以修改面向程序的結果，因此巢狀呼叫有意跳過它，讓程序取得完整資料。持久化副本需要一個單獨的監聽器，在程序取得其值之後執行。

## 後果

工作階段日誌中的 Code Mode 分發條目現在遵守已設定的位元組數上限，README 中關於分發日誌不設上限的「已知限制」條目現在指向本篇。攜帶超大分發內容的舊日誌仍可重播，因為事件欄位沒有變化；只有今後的追加包含更少文字。Web UI 經由與原生結果相同的路徑，把被 spill 的子呼叫輸出渲染為預覽和定位符文字，不需要特殊處理。
