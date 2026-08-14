# Agent Note：Web 思考尾部滾動 —— 摺疊態 reasoning 跟隨即時輸出

Status: implemented

[English](2026-08-02-web-thinking-tail-scroll.md) | [简体中文](2026-08-02-web-thinking-tail-scroll.zh.md) | 繁體中文

## 問題

Web Think 行在結帳與流式 block 中都把 reasoning 首行渲染成摺疊摘要。首行一旦出現，之後每個 reasoning delta 只會改變隱藏的正文。於是快速模型在思考時看起來靜止，使用者必須展開完整思維鏈才能確認輸出仍在推進。產品事項表已經要求“thinking：滾動展示思維鏈更新、可展開”；當前行只滿足了後半項。

## 決策

只有 reasoning block 是當前流式尾部、且仍處於摺疊態的 Think 行會跟隨即時輸出。其摘要使用最新的非空行，而不是結帳後的首行；已有單行摘要元素成為程序化橫向滾動區，每次文字更新後釘到 `scrollWidth - clientWidth`。這裡刻意直接賦值 `scrollLeft`，透過真實 delta 推進而不虛構獨立的跑馬燈速度：token 快則移動快，模型停頓則停止，短文字因滾動範圍為零而保持靜止。

該行為由已有呈現元件擁有。`AssistantMarkdown` 只在 Think 行執行時期選擇最新行；`ToolRow` 已經擁有摺疊／展開狀態，因此由它決定摘要是否追隨行內末端。不改變 session、wire、持久事件或模型可見約定。展開會移除摺疊摘要，並讓完整 reasoning 正文進入普通頁面流。該行結帳後復原穩定首行，同時把摘要重設到左端。其他工具摘要與已結帳 Think 行保留已有省略號行為。

## 曾考慮的替代方案

**播放與流式輸出無關的 CSS 跑馬燈。** 否決：它會在 provider 停頓時繼續移動，讓慢模型顯得很快，破壞該互動本應暴露的吞吐訊號。

**始終顯示完整 reasoning 字串的固定後綴。** 否決：按字元切片可能截斷單詞或字素，在內容真正溢位前就丟掉當前行的開頭，而且只會跳變，無法隨每個 delta 移動。

**自動滾動展開的 reasoning 正文或工作階段頁面。** 否決：展開內容是閱讀介面，強制跟隨會與向上回看的使用者爭奪滾動；跟隨器只屬於摺疊的單行摘要。

## 後果

摺疊行現在會同時透過內容移動和已有掃光傳達 provider 節奏，而結帳後的 transcript 保持逐位元組穩定。滾動更新只發生在流式累加器本就會觸發的 React 渲染中；不會增加計時器、動畫迴圈、訂閱、持久狀態或傳輸流量。較長的當前 reasoning 行仍會把完整文字留在 DOM 中，只以程式設計方式裁掉已經溢位的前綴，因此展開仍能顯示完整 block，輔助技術讀到的也仍是同一份當前摘要文字。

## 測試

`packages/client/ui-conversation/tests/reasoning-row.client.spec.tsx` 固定最新行選擇、算出的右端滾動位置，以及結帳後復原首行和 `scrollLeft = 0`。`apps/web/tests/lifecycle-chrome.e2e.ts` 中的無金鑰組裝態 Chromium 場景以可觀察節奏重播真實錄制的 reasoning chunks，把視口收窄到摘要溢位，並斷言即時摺疊 Think 行到達真實瀏覽器的滾動邊界。其結帳態 replay golden 保持不變，證明歷史摘要約定仍然穩定。
