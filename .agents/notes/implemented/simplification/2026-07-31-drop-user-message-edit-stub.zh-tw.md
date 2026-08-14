# Agent Note: 移除 user 訊息的編輯存根

Status: implemented

[English](2026-07-31-drop-user-message-edit-stub.md) | 繁體中文

## 問題

user 氣泡的 IconActions 行在複製和分支旁邊還有一個編輯按鈕，但其背後什麼都沒有：該控制元件沒有點擊處理、沒有 client 側變更，也沒有 host 側重新發送已編輯訊息的操作。使用者找到它時，看到的是一個產品無法兌現的可供性。

## 決策

`MessageIconActions` 只渲染時鐘／複製／分支，其 `edit` prop 隨按鈕一並刪除；`MessageItem` 不再傳入該 prop。現在 user 氣泡與 assistant chrome 只在時鐘位置上不同。包 README 在 Known Limitations 中記錄這項缺失的能力，web 的 message-actions 預期輸出固定了不含該控制元件的動作行。

公共 locale 保留通用的 `edit` 詞條：它是共享詞彙，而非本元件的文案。

重新引入該控制元件時要與能力一起落地：既需要編輯已定稿 user 訊息的 client 變更，也需要 host 側決定這條編輯後的訊息對已經消費過它的輪次意味著什麼。

## 曾考慮的替代方案

**把按鈕置灰並加提示。** 一個可見但無效的控制元件仍在宣告可以編輯，解釋成本相同；直接移除纔是誠實的狀態。

**接到佇列編輯器上。** 佇列編輯的是尚未傳送的訊息。已定稿的 user 訊息已經進入 transcript（文字記錄）和模型上下文，複用該編輯器會讓同一個動作悄悄變成另一件事。

## 後果

Web 沒有任何途徑修正已傳送的訊息；從該訊息分支是最接近的現有手勢。由於動作行的內容完全由 props 組合而來，client 變更就緒後重新引入只是一次純 UI 改動。
