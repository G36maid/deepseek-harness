# Agent Note: 注入內容逐字投影，去除 XML 封套

Status: implemented

[English](2026-07-20-unwrap-injected-content-envelopes.md) | [简体中文](2026-07-20-unwrap-injected-content-envelopes.zh.md) | 繁體中文

## 問題

兩類注入的工作階段內容在渲染進模型 transcript（文字記錄）時被包在 XML 封套裡：`steering/message` 包成 `<steering source="…">…</steering>`，`context/message` 包成 `<context source="…">…</context>`（後者有一個 `'raw'` 退出選項可跳過封套）。這些封套意在告訴模型「這是注入內容，不是使用者在說話」。

兩個問題：

- **沒有模型在這些標籤上訓練過。** `<steering>` 和 `<context>` 是任何模型都未被教會去讀的任意標記，因此這層框架只是徒增 token 而沒有可靠效果，還可能起反作用——已錄制的 transcript 顯示，模型會把 `<steering>` 指令當成第三方元資料而拒絕服從，只回答原始提示詞。
- **工作階段表層是承載框架的錯誤層次。** 表層的職責是把持久日誌投影為模型 transcript；決定內容如何措辭並不是它的事。想要特定框架的呼叫方可以在注入前自行格式化內容——唯一的重度生產方（`agent-instructions`）本就這樣做，它自帶完整的 `<system-reminder>` 框架，並用 `envelope: 'raw'` 退出 `<context>` 封套。剩下的標籤機制（`ContextEnvelope` 類型，以及貫穿 `InjectOptions`、`HookContext`、`context/message` 事件和 agent loop（代理循環）的 `envelope` 欄位）所服務的區分，本應歸屬呼叫方。

## 決策

注入的工作階段內容逐字投影，框架由呼叫方自行負責。`deriveEventMessage` 把 `user/message` 的內容區塊原樣送達模型；`source` 保留在持久事件日誌中，但不渲染。

`ContextEnvelope` 類型和所有 `envelope` 欄位都被移除——包括 `SessionEventMap` 中的 `context/message`、`InjectOptions`、`HookContext`，以及 `dsh-agent-loop` 中 `inject()`/`additionalContexts` 的相關管線。`agent-instructions` 不再請求 `'raw'`；它自帶框架的內容渲染方式不變。`renderTagged`/`renderContextEnvelope` 輔助函式被刪除。`context/message.meta` 仍攜帶持久的、對模型隱藏的 JSON 狀態。

封套曾攜帶的 `source` 來源資訊並未丟失——它仍保留在持久事件上；只是不再渲染進 transcript。

## 權衡的替代方案

- **保留 `<context>` 封套，只對 steering（中途引導）去封套** —— 會為一個沒有模型會讀的框架位保留 `ContextEnvelope`/`envelope` 機制，並保留主要生產方本就退出的那種不一致。
- **僅對外掛程式來源的內容保留 envelope 欄位** —— 會按 `source.kind` 把一條投影拆成兩條，卻沒有觀察到任何收益；外掛程式引導 agent 時（掛鉤橋接器的輪次續行原因）同樣希望指令被遵從，而不是被貼標籤。
- **把去封套的邏輯移入配接器** —— 規範投影就是模型可見約定（「模型可見 ⟺ 已記錄」）；讓各配接器在框架上各行其是，會使派生的 transcript 相依性於配接器。呼叫方確實想要的框架應放進呼叫方自己的內容裡，而不是配接器。

## 結果

- 中途引導與注入的上下文以與普通使用者提示詞相同的權重到達模型。
- transcript 不再區分注入內容與使用者訊息；需要這一區分的消費端讀取持久事件日誌，其中事件類型、`source` 和 `meta` 完整保留。
- `hook-{cc,codex}-stop-continue` ACP（Agent Client Protocol）快照已重新錄制：舊錄制捕獲的是模型把 steering 當作第三方元資料而拒絕服從，正是本次修復針對的失敗模式。
- [內容區塊詞彙表 Agent Note](../architecture/2026-06-11-content-block-vocabulary.md) 中關於帶標籤封套的條款已修訂為指向本文。

## 推遲事項

`agent-instructions` 已經自行為內容加框架：它把一個完整的 `<system-reminder>…</system-reminder>` 塊作為訊息內容寄出，而不相依性表層封套。這種呼叫方自有的模式纔是應保留的——表層逐字透傳內容，任何框架都住在生產方自己的內容裡。

曾經存在兩條框架路徑——呼叫方自行加框架（`agent-instructions` 的 `<system-reminder>`），以及表層封套（`deriveEventMessage` 加上的 `<context>`/`<steering>`）。本次變更移除了後者，只留下呼叫方自有的框架。如果未來又需要帶標籤的框架，應由事件的 `meta` map（生產方附加、對模型隱藏的元資料欄位）來統一它，交給專門的渲染器或配接器消費，而不是在 `deriveEventMessage` 中重新硬編碼標籤。生產方在 `meta` 中聲明所需的框架，由一個渲染器統一施加；工作階段表層的投影始終保持逐字透傳。
