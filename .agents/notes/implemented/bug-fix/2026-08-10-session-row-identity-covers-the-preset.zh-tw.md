# Agent Note: 工作階段行的標識判定納入 preset

Status: implemented

[English](2026-08-10-session-row-identity-covers-the-preset.md) | [简体中文](2026-08-10-session-row-identity-covers-the-preset.zh.md) | 繁體中文

## 問題

`SessionManager.buildListSnapshot` 按值對清單行做記憶化：一次 wire 刷新會鑄造全新的 summary 對象，因此與快取項相等的行會被替換為快取實例，下游每一個 `SessionListItem` memo 才能持續命中。它聲明的約定是「每個欄位都相同就複用快取對象」，而那段比較是手寫枚舉欄位的，其中沒有 `agentPreset`。

一次已確認的 preset 切換恰好只移動這一個欄位。`noteAgentPreset` 把它 upsert 進去，`applyMutation` 合併它——該合併有意不採用 mutation 的 `updatedAt`，因此切換後的行與它的快取孿生只在 preset 上不同，別處一致。於是標識判定認為這一行沒變，永久地提供了過期實例：manager 自己的 summaries 是 `minimal`，而所有讀取投影快照的一方繼續讀到 `standard`。

hero 上的 chip 正是其中一個讀取方，而且它在寄出任何請求之前會拿這次選擇和那一行比較。切回工作階段建立時的那個 preset，在它看來就是「已經是這個 preset 了」，於是丟棄 stage、根本不發 RPC——chip 的標籤變了，組成沒變。一個工作階段可以從建立時的 preset 切走一次，然後再也切不回來。

## 決策

標識判定把 `agentPreset` 與其餘 summary 欄位一起比較，這本就是「每個欄位都相同」所聲稱的內容。其他一概不動：記憶化、合併、chip 的 no-op 檢查各自都是對的——只要它們讀到的那一行是對的。

## 考慮過的替代方案

**讓 chip 改為直接讀宿主，而不是讀清單行。** 這樣能繞開過期的行，但工作階段頭部的標籤同樣以這一行為準，過期狀態會在最顯眼的介面裡留下來；而且將來任何 `SessionSummary.agentPreset` 的讀取方都會繼承同一個陷阱。

**去掉行標識記憶化，每次快照都重建行。** 這能整類消除「漏欄位」缺陷，代價卻正是這個 memo 存在的理由：一次 wire 刷新會為每一行鑄造新對象，於是每次刷新都要重渲染整個工作階段清單。

**改成結構化比較，而不是逐欄位枚舉。** 通用的深比較不能盲目加：行上帶有 `projectionValues`，它的引用標識本身就是「投影 store 重新發布了」這一有意為之的訊號，把它折進值比較，要麼每個投影 tick 都重渲染，要麼把一次真實變化掩蓋掉。

## 後果

工作階段行攜帶的每個欄位現在都參與行標識，因此讀取 `SessionSummary.agentPreset` 的介面會在宿主確認後立刻看到切換，工作階段頭部標籤也包含在內。該判定仍是手寫枚舉，所以將來給 `SessionSummary` 新增欄位時必須同步加進來；`sessions-service` 的投影測試為下一個這樣的欄位點明瞭失效形態，而不只是釘住這一次。

## 測試

`sessions-service.spec.ts` 傳入一個空白行、記錄一次切換，並斷言投影快照報告的是新 preset——在舊判定下它會失敗，因為這一行別處都沒變。`agent-preset-selection` web e2e 先向下切再向上切，斷言宿主認可第二次切換、`/` 目錄隨之回來；沒有這次修復，第二次切換根本到不了宿主。

## 相關內容

同一條 e2e 也覆蓋[目錄失效的修復](2026-08-10-slash-catalog-follows-preset-switch.md)——正是它讓選單在切換真正落地之後跟隨任一方向的切換。
