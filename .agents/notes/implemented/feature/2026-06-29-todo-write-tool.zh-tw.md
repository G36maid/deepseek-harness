# Agent Note: `todo_write` 工具——將模型任務清單作為事件溯源的工作階段狀態

Status: implemented

[English](2026-06-29-todo-write-tool.md) | [简体中文](2026-06-29-todo-write-tool.zh.md) | 繁體中文

## 問題

harness 為模型提供了 bash 和 subagent 工具，卻沒有辦法記錄結構化的任務清單。todo 清單有兩個同等重要的用途：引導模型規劃多步驟工作並保持當前活躍工作明確；同時為互動式宿主提供即時進度清單。調研的所有參考編碼 agent（代理），包括 claude-code、opencode、codex、oh-my-pi 和 pi，都提供了某種形式的此類功能；本 harness 此前沒有。

## 決策

新增一個面向模型的 `todo_write(todos: [{ content, status }])` 工具，其整清單狀態作為新的 `todo/write` `SessionEventMap` 變體儲存在事件溯源的工作階段日誌上。互動式宿主從持久事件渲染：TUI 直接摺疊它，web 用戶端將其投影進 `ConversationSnapshot.todos`（[web todo 展示](2026-07-23-web-todo-display.md)），而[僅面向自動化的 ACP（Agent Client Protocol）橋接層](../simplification/2026-07-23-acp-automation-only-protocol.md)有意省略 todo 展示。

### 整清單替換，三態 status

模型每次呼叫傳送完整清單；新清單替換舊清單（重播時 last-write-wins）。這是 claude-code V1、opencode 和 codex `update_plan` 共同採用的形狀，也是模型訓練最多的形狀——沒有逐項 id，沒有 delta 協議。`status` 恰好是 `pending | in_progress | completed`，與 codex `update_plan` 相同的三元組；在 bridge 還把 todo 清單投影為 `plan` 更新時，它也與 ACP `PlanEntryStatus` 1:1 對應，該對映已隨[僅面向自動化的 ACP 約定](../simplification/2026-07-23-acp-automation-only-protocol.md)退役。

### 狀態在工作階段日誌上，而非服務

清單作為 `todo/write` 事件追加到日誌，攜帶完整的 `{ todos }` 快照。harness 是事件溯源的——LLM（大型語言模型）歷史、工具呼叫和輪次結構都在日誌上——所以 todo 清單也在那裡。這免費獲得了持久性、重播和復原重建：重新打開的工作階段從「其後沒有更晚 `turn/start`」的最近一次 `todo/write` 重新推導當前計畫（[計畫條生命週期](2026-07-28-todo-plan-clears-on-next-turn.md)），無需獨立的持久化後端、無需重新復原狀態的記憶體服務、無需額外接線。一個記憶體中的 `ctx.todos` 服務需要重新發明以上所有。（全量 log 消費端直接獲得這份重建；web 用戶端的分頁視窗則從尾頁 history 中由宿主計算的投影獲得——見 [web todo 展示說明](2026-07-23-web-todo-display.md)。）

### 不是 surface 事件

`todo/write` 被有意排除在 `SurfaceEventType` 之外。surface 是產出 LLM 訊息歷史（`deriveMessages()`）的投影；todo write 不產生對話訊息。因此它不攜帶 `surfaceOp`，不加入有序 surface，不進入 `deriveMessages()`——它是持久、可重播的 *UI* 狀態，與對話平行傳輸但不屬於對話的一部分。（dev-mode 不變式仍要求它位於一個尚未結束的輪次內，而它始終如此：它在工具呼叫的步驟中途追加。）

### 相比 claude-code V1 捨棄的欄位：`activeForm`、id、priority

claude-code V1 的條目是 `{ content, status, activeForm }`；後來（V2）增加了 id、相依性和所有權——但僅為支持 agent *叢集*（以磁碟為後端、鎖保護、逐項變更）。本工具將條目保持在最小集：`{ content, status }`。不要 `activeForm`（現在進行時標籤）——UI 直接展示 `content`；不要 id——整清單替換不需要穩定標識；不要 priority——它只曾是 ACP `PlanEntry` 的協定格式（wire format）要求，在 bridge 邊界合成為常數而非建模，並已隨該投影一起離開。每捨棄一個欄位，模型每次呼叫就少產出一項。

### 單一所有者——無叢集機制（YAGNI）

每個清單屬於呼叫它的 agent 工作階段，非 agent 呼叫被拒絕。沒有共享作用域、resolver 或 delta 協議。跨 agent 清單需要逐項日誌 delta 和顯式作用域選擇，因此留作未來獨立設計。

### 校驗：低成本的中間路線

schema 強制 type/required/enum。在此之上，`execute` 拒絕為空或重複的 `content`，並在 `allowParallelInProgress` 為 `false` 時拒絕超過一個活躍任務。排序和保持清單最新仍透過工具描述交給模型。被拒絕的寫入返回 `isError` 結果，使模型自行修正。必須採用的部署策略，以及持久不變式獨立於該策略這一點，均由[平行 in-progress Agent Note](2026-07-26-todo-parallel-in-progress.md)負責。

## 為何沒有 cordis-catalog 條目 / 沒有 `@mode`

`todo/write` 是 `SessionEventMap` 的成員，不是一等的 cordis `interface Events` 事件。catalog 生成器（`scripts/gen-cordis-catalog.ts`）掃描 `interface Events` 聲明；`SessionEventMap` 變體搭載現有的 `session/event` emit，不產生新的 catalog 行。因此它不攜帶 `@mode` 標籤（生成器僅對 `interface Events` 成員要求該標籤）——新增一個毫無意義。

## 測試

四個層級：
- **單元測試**——工作階段事件（append/snapshot-clone/last-write-wins/not-on-surface）；工具（schema 形狀、透過真實 `ctx.tools.execute` 的參數校驗、值校驗、事件追加與替換、非 agent 拒絕、`presentCall`、HMR（熱模組替換）安全性）；以及 TUI 摺疊。
- **真實 Loader 路徑**——外掛程式透過 `Loader.unwrapExports` 執行，斷言命名空間匯出形狀存活（它有 `inject`，因此一個意外的 default 匯出會在載入時崩潰——postmortem/0001）。
- **全迴圈整合**——一個指令碼化的 mock 模型透過真實 agent loop（代理循環）呼叫 `todo_write`；`todo/write` 事件落地，第二次呼叫替換它。
- **復原/重播**——持久化的 `todo/write` 摺疊回當前任務清單。
- **帶金鑰 e2e + 快照**——真實提示詞誘導 `todo_write`；組裝後的快照固定日誌事件和互動式渲染。

## 曾考慮的替代方案

- **記憶體中的 `ctx.todos` 服務**——需要重新發明日誌免費提供的持久性、重播和復原重建。
- **逐項 delta 協議**——僅在共享多所有者清單時需要，超出當前範圍；整清單替換更簡單，且與參考實作一致。
- **工具放在 `core/` 中**——`todo_write` 是註冊在 `ctx.tools` 上的擴充工具，不屬於主幹；它像其他工具族一樣位於自己的 `packages/todo/` 分組中。

## 後果

todo 清單是持久、可重播的工作階段狀態：互動式宿主從最新持久化的 `todo/write` 重新推導它，日誌（而非外掛程式記憶體）是唯一真源。整清單替換意味著每次更新需呼叫一次工具，last-write-wins；沒有需要協調的 delta 協議。事件不進入模型 surface，因此 todo 更新永遠不會擾動推匯出的模型歷史——模型只看到自己的工具呼叫和結果。
