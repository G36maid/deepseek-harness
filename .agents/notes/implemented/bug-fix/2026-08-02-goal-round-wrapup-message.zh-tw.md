# Agent Note：Goal Round 收尾訊息

Status: implemented

[English](2026-08-02-goal-round-wrapup-message.md) | [简体中文](2026-08-02-goal-round-wrapup-message.zh.md) | 繁體中文

## 問題

自主 Goal Round 報告 `update_goal` `complete` 或 `blocked` 時，物理輪次在工具結果處直接終結，模型在呼叫之後再無發言機會。工作階段終止在一張裸的 `update_goal` 卡片上，內測同學的觀感是 agent 話說到一半戛然而止：模型呼叫前的文字通常預告了一份彙報（“目標達成，標記完成：”）卻永遠沒有下文，因為標準 tool-use 預期是工具結果之後還有一條 assistant 訊息，而 Goal Round 提示詞與工具描述都沒有說明這次呼叫是終點。硬停止來自 [goal 工具決策](../feature/2026-07-19-model-facing-goal-tools.md)，本 note 取代其中的輪次停止條款。

## 決策

Goal Round 的 `complete` 或 `blocked` 成功不再呼叫 `concludeTurn()`。工具改為在自己的結果上附帶一條收尾上下文：以 `{ kind: 'plugin', plugin: 'tool-goal' }` 為 source 的 user 訊息，攜帶 `<goal_complete>`/`<goal_blocked>` 指令，要求模型向使用者寫出有依據的收尾訊息且不再呼叫工具。之後輪次經由 agent loop 常規的無工具呼叫停止路徑結束，因此不存在新的 loop 原語，steering 語義不受影響。人類直接變更保持原樣、不注入指令。代價是每個 goal 生命週期一次額外模型請求，而非每輪一次。

指令措辭透過在 `deepseek-v4-pro` 上用重構的 Goal Round 轉錄做 A/B 取樣選定：結構化指令（結果、驗證、產物、後續）在完整度上穩定優於極簡“總結一下”；補充“以工作階段內證據為準”的 grounding 條款讓無依據細節從斷言事實退為帶保留的建議；而無指令對照組的收尾方差很大，包括言之鑿鑿的文件級細節編造。

為讓 keyless 證明可指令碼化，快照設施補了一項能力：`dsh-llm-replay` 會針對即時請求解析指令碼條目中的 `{{fromRequest:<regex>}}` 佔位符，因為靜態伴隨檔案不可能預知模型必須回填進 `update_goal` 的隨機生成 goal id。

## 驗證

`tool-goal` 包測試釘住兩個終態 action 注入的上下文（source、標籤、objective、禁止再調工具條款）與不存在的 `concludesTurn`，以及人類直接 pause 與 complete 的不注入路徑，文件覆蓋率 100%。`llm-replay` 單元測試釘住佔位符約定：最後一次匹配取勝的捕獲、無捕獲組時整體匹配回退，以及未匹配、非法、未閉合模式的明確報錯。新增 keyless ACP 快照 `goal-wrapup` 驅動成品應用走完 create → 第一輪 → 自主 complete，並在持久工作階段日誌與 ACP stdout 流中同時斷言 plugin 來源的收尾註入、同輪內的收尾 assistant 訊息與 `completed` 輪次結束。

## 曾考慮的替代方案

- **在 `update_goal` 的 UI 卡片上展示完成文字** — 拒絕：`complete` 如今不攜帶任何自由文字；新增 `summary` 參數會讓面向使用者的彙報走工具參數通道，而且依然砍掉了模型在結果之後的自然發言。
- **保留 `concludeTurn()` 並新增“再多一步純文字”的 loop 原語** — 拒絕：為常規停止路徑已經能提供的行為（只要沒有結果終結輪次）增加新的 `agent-loop` 機制。
- **把指令寫進工具結果內容** — 拒絕：goal 工具的規範輸出是被程序化消費的緊湊 JSON；在其中混入散文指令會把模型側約定和工具的可重播值攪在一起。

## Consequences

每個自主 goal 都以一條面向使用者的收尾訊息結束，而非一張裸工具卡片，代價是每個 goal 生命週期一次模型請求。`concludeTurn()` 保留其 loop 語義，但在 subagent 結構化輸出之外失去了唯一的一方呼叫者。快照場景現在可以透過 `{{fromRequest:...}}` 指令碼化只在執行時期才存在的值，為任何“回顯 id”類工具流程（不限於 goal）解除鎖定 keyless 覆蓋。
