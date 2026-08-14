# Agent Note: 移除 steering（中途引導）插話標注

Status: implemented

[English](2026-08-10-web-remove-steering-interjection-caption.md) | [简体中文](2026-08-10-web-remove-steering-interjection-caption.zh.md) | 繁體中文

## 問題

[上下文來源與 steer 標識決策](../feature/2026-08-04-web-context-source-and-steer-marks.md)給每個持久與待處理的 steering 氣泡加上了 `插话` / `Interjection` 標注，讓 transcript（文字記錄）能說明哪條靠右對齊氣泡打斷了正在執行的輪次。這個標注重複了訊息流已經呈現的事實：steering 氣泡位於輪次中途、夾在被它打斷的助手內容之間，而開輪提示位於輪次邊界。在每個 steer 氣泡上方常駐一行三級文字，並沒有讓一個能看到位置的讀者多讀出任何資訊，而且它是所有使用者樣式氣泡中唯一帶裝飾的，還破壞了原本統一的靠右對齊節奏。

## 決策

steering 完全按使用者氣泡渲染。`UserStyleBubble` 不再有 steering 標志，`message.steering` locale 鍵與 `.steeringMark` 樣式已刪除，`PendingSteeringBubble` 與 `UserMessageNodeView` 只傳內容與操作。輪次中途的 steer 只能靠它在執行輪次訊息流中的位置辨認，除此之外沒有任何標識。

執行時期的區分保持不變。從持久 `agent/inbox/spliced` 歷史投影 `SteeringMessageNode`、`data-pending-steering` 屬性、待處理到持久的交接全部保留：待處理生命週期無論呈現如何都需要節點身份，測試也仍透過該屬性定位待處理氣泡。

本決策部分取代[上下文來源與 steer 標識決策](../feature/2026-08-04-web-context-source-and-steer-marks.md)中的 steering 條款；其上下文來源與召回命名仍然有效。這個標注此前已經翻轉過一次：[已歸檔的取消 steer 裝飾決策](../../archived/simplification/2026-07-31-web-ui-no-steer-entry-or-interjection-chrome.md)在 composer 無法 steer 時移除了它，2026-08-04 的決策在 composer 獲得 Steer 手勢後把它加了回來。本次移除不重議手勢本身——steering 入口、Queue dock 的插話傳送操作、待處理生命週期各歸其主——只判定 transcript 不需要為其結果命名。

## 考慮過的替代方案

**保留標注。** 它是現狀，維持成本低，但它永久裝飾每個 steer 氣泡，只為編碼氣泡位置已經陳述的事實。不承載讀者缺少的資訊的裝飾應當刪除，而不是維護。

**連 `SteeringMessageNode` 區分一起刪。** 節點類型派生自持久 inbox 歷史，驅動待處理到持久的交接；它是重播事實，不是呈現。把它並入 `UserMessageNode` 會改變投影行為，卻沒有任何 UI 收益。

**換更安靜的裝飾（底色、縮排、懸停標籤）。** 任何替代裝飾都會用更弱的表達重新提出同一個問題。transcript 需要的區分是位置性的、已經可見的；換成更含蓄的裝飾保留了成本，卻丟掉了文字標注唯一的優點，就是明確。

## 測試

- `packages/client/ui-conversation` 的 jsdom 覆蓋固定了純氣泡行為：待處理交接測試透過 `data-pending-steering` 定位待處理氣泡，在沒有任何標注的前提下斷言單氣泡交接；MessageItem 的 steering 分支在無標注氣泡上斷言可複製且無分支操作。
- 無金鑰的組裝 Web goldens（`steering/mid-steer`、`steering/settled`、`plan-review/approved`）用未變的工作階段 fixture 重播，不含標註文字。

## 後果

- 重播的 transcript 不再為 steering 命名：讀者靠訊息在輪次中的位置推斷這是一次中途插話。對快速掃讀輪次邊界的讀者，這個推斷弱於顯式標籤；本決策接受這一代價。
- 待處理的 steer 氣泡在被准入前與普通已傳送氣泡在視覺上完全一致，僅缺少時間戳。
- 重新引入任何形式的 steering 裝飾都需要一個取代本 note 的新產品決策。
