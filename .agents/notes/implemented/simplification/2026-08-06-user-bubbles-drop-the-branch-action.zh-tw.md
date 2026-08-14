# Agent Note: user 與 steering 氣泡移除分支操作

Status: implemented

[English](2026-08-06-user-bubbles-drop-the-branch-action.md) | 繁體中文

## 問題

每個 user 氣泡和已消費的 steering（中途引導）氣泡都渲染分支控制元件，受[已完成輪次尾部決策](../bug-fix/2026-08-02-message-fork-actions-require-completed-turn-tail.md)的閘門約束。在這些氣泡上，該閘門實際上是永久性的：開輪的 user 訊息後面必然跟著本輪自己的節點，已消費的 steering 訊息按構造就處在輪次中間，因此只有當輪次結束時該訊息之後一個節點都沒有——即在第一個模型事件之前就取消——控制元件纔可能啟用。讀者因此看到一個永遠不會啟用的控制元件，tooltip 許諾的是這個按鈕到達不了的狀態。這個操作入口本身也有誤導：在訊息 seq 處 fork 會切在所在輪次的 `turn/end`，「在我的訊息處分支」實際會把下方的回答一並帶走，與在自己氣泡上看到分支時「分叉重問」的直覺預期恰好相反。

## 決策

user 與 steering 氣泡不再渲染分支操作。`MessageItem` 移除其 fork props，`PendingSteeringBubble` 移除其 `showBranch` 特例，`messageBranchSeqs` 收窄為 `assistantBranchSeqs`：只有已完成輪次的 transcript（文字記錄）尾部、且該尾部是本輪自己的帶 text 內容 assistant 節點纔可 fork。分支入口只存在於已定稿的回答之下。

含有 steer 的輪次的 fork 點保持不變：fork 是切在 `turn/end` 上的日誌前綴，steer 是子工作階段必須繼承的模型可見歷史，因此被引導過的輪次的已定稿回答與其他輪次一樣可以 fork。assistant 側的閘門及其可見但不可用的呈現也保持不變——在回答之下，不可用是一個短暫且可到達的狀態（當前尾部被後續工具行或錯誤行佔據），這正是 tooltip 的用武之地。

## 考慮過的替代方案

**僅在不可用時隱藏訊息氣泡上的控制元件。** 否決：它保住了那個幾乎不可達的啟用場景，代價是圖示只在輪次尚未產出任何東西就中止時纔出現在自己的氣泡上，這種不一致不值得為它服務的場景付出。

**保留可見但不可用的控制元件（現狀）。** 否決：[已完成輪次尾部決策](../bug-fix/2026-08-02-message-fork-actions-require-completed-turn-tail.md)選擇可見，是為了讓 tooltip 解釋一個讀者可以到達的邊界；在 user 與 steering 氣泡上這個邊界實際不可達，解釋文字是在為一個不該存在於此的控制元件打修補程式。

**在 user 氣泡上採用切在訊息之前的分支語義。** 不在本次範圍內：從自己的提示詞重問需要切在訊息之前並預填輸入框，是另一個 Host 操作。移除當前控制元件恰好為這樣的功能留出位置，而不是讓語義相反的控制元件佔著它。

## 後果

唯一的 fork 入口是已定稿回答下方啟用的分支控制元件。在任何節點跟上其訊息之前就被取消的輪次失去了它唯一的入口，從此沒有 fork 點，與尾部是無內容 interrupted 節點的輪次一致。`apps/web` 的 aria golden 全部移除 user 氣泡的停用分支行及其隱藏說明文字。包測試釘住：user 與 steering 氣泡不渲染分支控制元件，steering 作為尾部的輪次讓敘述節點的控制元件保持不可用。
