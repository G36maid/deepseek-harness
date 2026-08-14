# Agent Note: Web session fork 操作

Status: implemented

[English](2026-07-27-web-session-fork-actions.md) | 繁體中文

## Problem

Session store 已提供按完成輪前綴建立子工作階段的 fork 原語，但 Web 端沒有一份統一的互動約定。Session 行選單只能表達「從最新完成輪分支」，訊息 IconActions 還需要表達「從這則訊息所在輪分支」；如果兩處各自解釋邊界、切換與失敗行為，同一個使用者動作會形成兩套語義。把 fork 子工作階段巢狀在源工作階段下還會讓新選中的子工作階段相依性祖先展開態才能看見，並削弱 workspace 的手動排序模型。

## Decision

本決策中的訊息資格部分由[已完成輪次尾部決策](../bug-fix/2026-08-02-message-fork-actions-require-completed-turn-tail.md)收緊；共享執行時期操作、注入歸屬、標題處理和同級清單決策仍然有效。

Web 的 session 行選單與訊息 IconActions 共用 client runtime 的 `sessions.fork` 操作。Session 行傳 `{ sessionId, increaseTitle: true }`，因此在源工作階段最後一個已完成輪次處分支；符合條件且位於已完成輪次尾部的訊息傳 `{ sessionId, atSeq: node.seq, increaseTitle: true }`，因此在以該訊息結束的輪次處分支。`increaseTitle` 只由 client 消費：子工作階段進入本機清單後，client 把源工作階段持久化標題尾部的 `(N)` 或 `（N）` 遞增並保留括號樣式，無編號時追加 ` (1)`，沒有持久化標題時不改名；Host fork 請求仍只有 `sessionId` 與選填的 `atSeq`。改名成功後呼叫方纔打開子工作階段；fork 或改名失敗時保持源工作階段與當前選擇不變，改名失敗時已建立的子工作階段仍留在清單中。

`forkAt(seq)` 只在 ui-conversation 的 apply 注入層接觸 session 服務，訊息元件只回傳事件 `seq`。Session 行同理只透過 ui-workspace 的注入回呼發起操作；兩個呈現包都不持有 session mutation 狀態，也不複製 host 的邊界求值。

Session lineage 不投影成清單層級。WorkSpace 模式按 `WorkspaceView.sessionIds` 的手動序把源工作階段與所有 fork 子工作階段顯示為同級行，每行都可獨立打開、搜尋和拖拽；In one list 模式繼續按 `updatedAt` 嚴格排序；Ungrouped 組在沒有 workspace 帳本時也按 recency 排序。`parentId` 仍用於 lineage 和後續查詢，但不控制 session 清單可見性。

## Alternatives considered

**只接 session 行選單。** 否決：使用者在訊息處已經選擇了更精確的上下文，強迫其回到清單只能退化為最新完成輪，且已展示的訊息分支圖示會成為無回應控制元件。

**只允許使用者訊息分支。** 否決：已定稿 assistant 內容同樣有穩定事件 `seq`，host 會把它歸入所屬完成輪；讓兩個外觀相同的分支按鈕只有一個可用會製造不可見的行為差異。

**按 `parentId` 把 fork 子工作階段巢狀在源工作階段下。** 否決：lineage 不是導覽所有權；巢狀要求自動展開祖先才能看見當前項，並讓子工作階段無法參與 workspace 的同級手動排序。

**由訊息元件直接呼叫 session 服務。** 否決：client 元件不得接觸 `ctx` 或業務服務；注入回呼讓 mutation 留在 apply 世界，元件保持純 props。

## Consequences

使用者可從 session 行或符合條件的已完成輪次尾部訊息建立分支，兩處最終走同一個 runtime/host 操作；訊息點位保留精確事件邊界，清單點位保留「最新完成輪」快捷語義。連續 fork 的標題按 `(1)`、`(2)` 遞增，而不是重複追加 `(1)`；全形括號標題保持全形樣式。所有 fork 子工作階段立即作為普通同級行出現，清單不再需要 session 展開狀態、遞迴節點或 twist 控制元件。

Fork 與子工作階段改名失敗都保持靜默並保留源選擇，避免一個派生操作破壞當前閱讀位置；該取捨也意味著 UI 暫不提供失敗原因或重試入口。包級測試固定符合條件的訊息 `seq` 轉發、標題遞增與同級清單派生，`apps/web/tests/message-actions.e2e.ts` 透過裝配後的應用執行 assistant 訊息分支與 session 行選單分支。
