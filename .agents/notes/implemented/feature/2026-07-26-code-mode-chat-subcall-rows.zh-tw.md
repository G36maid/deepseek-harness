# Agent Note: Code Mode 的 chat 渲染——子呼叫作為父行之下的原生行

Status: implemented

[English](2026-07-26-code-mode-chat-subcall-rows.md) | 繁體中文

> 範圍：Web chat 檢視表如何渲染一個 `run_code` 輪次，即 Code Mode UI 棧的用戶端側部分，建置在[宿主側基礎](2026-07-26-code-dispatch-ui-foundation.md)之上（攜帶完整內容的 `tool/code-dispatch`、必填的 `description` 參數）。本篇所依託的 slot 模型歸 [toolview 溶解](../architecture/2026-07-23-toolview-dissolution.md)所有。

## 問題

啟用 Code Mode 後，chat 檢視表過去只顯示一條不透明的 `run_code` 行：摘要就是原始程序文字，子呼叫則處處不可見。已敲定的產品要求恰恰相反：每個子呼叫都必須與原生工具呼叫渲染得*完全一致*——同樣的行元件、同樣的自訂註冊、同樣的詳情面板——同時 transcript（文字記錄）仍須如實反映模型只發起了一次呼叫這一事實。

## 決策

**子呼叫是在 surface 流之外遞迴附著到父級的標準工具呼叫塊，經由與原生行相同的 keyed slot 渲染，並始終顯示在父級之下。**

- **資料層**：執行時期的 `ToolCallTree` 把視窗內的 `tool/code-dispatch-start` 與 `tool/code-dispatch` 事件折入私有的逐父級索引，再把執行中和已結帳的子級投影到遞迴的 `ToolCallBlock.subCalls` 上。即時工作階段投影與 `projectConversationHistory` 共享這一摺疊過程；逐父級的寫時複製陣列和路徑複製投影讓無關根節點與兄弟節點保持引用穩定。子呼叫永不進入 `nodes`——surface 流始終精確等於模型可見的輪次結構。這些事件在 wire 消費端邊界作結構性收窄，該邊界也會拒絕成環的父子關係（dsh-tools 的宿主類型無法進入用戶端程序，因為宿主端與用戶端兩側的 `Context` 聲明合併會衝突）。
- **渲染層**：`ChatView` 透過整體工具 seat `'conversation.chat.tool'` 傳遞每個父呼叫及其遞迴子呼叫。ui-tool 的 `ToolCallTree` 先渲染 parent，再渲染 `[data-subcalls]` 巢狀；每個原子呼叫都透過同一個 `'tool.call.toolview'` keyed slot，以工具名稱作為 `entryKey`，並共用 `GenericToolCard` fallback。一個 keyed 註冊因此無需變化即可同時接管任意後代與頂層呼叫。執行中的 parent（`runningCalls`）在同一個遞迴塊中接收已累積的 dispatch，使 child 行在執行期間即時流入。
- **`run_code` 的呈現**：新增一種 `code` 行變體（分類器對映 `run_code → code`、標題 `Code`、圖示 `IconCodeOutline16`），以模型撰寫的 `description` 作摘要，展開後顯示程序本身（在 markdown 程式碼塊的填充底色上以等寬字體呈現），而非參數的 JSON 封裝。
- **詳情面板**：`materialFor` 遞迴搜尋 `nodes` 與 `runningCalls`，因此被選中的後代 callId 會經由與已完結的原生呼叫完全相同的渲染路徑，解析出完整參數與完整輸出。

## 曾考慮的替代方案

**把子呼叫平鋪進 surface 流（折入 `nodes`）。** 否決：這會歪曲 transcript——模型只發起了一次呼叫；巢狀在父行之下既保住程式碼↔呼叫的關聯，也讓摺疊過程的模型可見順序不變式原封不動。

**隱藏子呼叫，展開父行後才顯示。** 由產品決策否決：子呼叫正是一個 Code Mode 輪次的核心內容；把它們藏起來，等於重新製造出本功能所要消除的那種不透明。父行的展開開關只用於顯示程序本身。

**專用的子呼叫行元件。** 否決：本功能的全部要義就在於與原生行保持同一性；一個平行元件必然漂移。巢狀包裝層（縮排 + 左側邊線）是子呼叫唯一的專屬視覺裝飾。

## 後果

自訂 toolview 註冊無需額外改動即可適用於子呼叫——而且是刻意為之：不存在按註冊粒度的退出機制，唯一的出路是元件自行讀取自身上下文，而當前沒有任何消費端需要這麼做。選中高亮經由同一條 `selectedCallId` 通道到達巢狀行（分組歸屬會搜尋整棵樹）。trajectory/waterfall 現在依據分發計時事件對（[即時平行分發](2026-07-26-code-mode-live-parallel-dispatch.md)）繪製子呼叫 span；缺少計時，waterfall 上的 span 就是在撒謊。fixture（測試前置資料）的輪次 64（`?fixture`），加上 `code-mode-round` 瀏覽器 e2e（錄制的真實輪次、無金鑰重播），共同鎖定整個介面；jsdom 與執行時期測試套件則鎖定 slot 分發、錯誤狀態、遞迴詳情解析、歷史投影與引用穩定的路徑複製。
