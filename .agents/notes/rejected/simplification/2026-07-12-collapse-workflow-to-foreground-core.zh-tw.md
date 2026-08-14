# Agent Note: 將工作流程收縮至已使用的前臺核心

Status: rejected — 工作流程進度是有意設計的觀測介面；應透過消費端使其發揮作用，而非刪除它。

[English](2026-07-12-collapse-workflow-to-foreground-core.md) | [简体中文](2026-07-12-collapse-workflow-to-foreground-core.zh.md) | 繁體中文

## 問題

工作流程能力在前臺執行用於編排 subagent 的 JavaScript，但它同時攜帶了一套無人消費的進度觀測系統。沒有任何生產環境的監聽器訂閱六個 `workflow/*` 事件中的任何一個；監聽器僅存在於工作流程測試中。儘管如此，seam 定義了 run/phase/agent（代理）outcome 載荷，worker 傳送 phase/log/agent 生命週期協議訊息，host 透過一個 `liveAgents` 配對帳本轉發它們，引擎維護 run id 僅僅是為了關聯這些通知。

這套進度詞彙不僅僅是未被使用；它在不經重新設計的情況下也無法服務於其唯一已命名的未來消費端。`WorkflowRunInfo` 包含 `{id, meta}` 但沒有父 agent、工作階段或工具呼叫標識，而面向模型的工具也從不暴露 run id。一個全域性 ACP（Agent Client Protocol）監聽器無法將事件路由到正確的用戶端工作階段。`meta.phases` 從未被查詢，`phase(title)` 不對其做校驗，phase 的 `detail`/`model` 和 agent 的 `label`/`phase` 僅供事件消費，`whenToUse` 被校驗和複製但從未被渲染或用於選擇。`phase()` 和 `log()` 仍然跨越 worker 邊界，儘管沒有接收方。

這些觀測者移除後，live handle 仍重複攜帶事件機制所需的資料。`WorkflowRun.id` 沒有非事件消費端，而工具讀取 `run.meta.name` 只是為了渲染一個它已經以 `args.meta.name` 形式持有的值；兩者都不屬於執行/取消 handle。

取消機制也為一個同步啟動提供了兩條公開通道。`WorkflowStartRequest.signal` 被傳遞給 worker host，而唯一的生產呼叫方另外將同一個 signal 橋接到 `WorkflowRun.cancel()`。因為 `start()` 在控制權讓出之前就返回了 run，不存在需要請求時取消的就緒視窗；重複的 signal 增加了 host 的 listener/disarm 狀態卻沒有封堵任何競態。

`WorkflowError.fatal` 是同一種推測性分支的微縮版：生產程式碼中的構造全都採用 fatal 模式，`fatal: false` 僅存在於測試中，組合子已經透過 `instanceof` 區分工作流程失敗。

## 提案

保留已使用的核心：`agent(prompt, { schema, model })`、`parallel`、`pipeline`、`args`、並行/agent 上限、取消、有界 dispose（資源釋放）、結構化結果、worker 隔離與前臺工具收集。移除所有 `workflow/*` 事件及其僅供事件使用的 info/outcome 類型；移除 `phase()`、`log()`、agent 的 `label`/`phase`、phase 聲明、`whenToUse` 及其 worker 訊息/host 觀測者；將工作流程元資料收縮為工具實際使用的 name；移除僅供事件使用的 run id/meta 快照與合成的 agent-end 帳本。將 `WorkflowRun` 收縮為 `result`、`cancel()` 和 `dispose()`；工具渲染請求中已有的 name。移除 `WorkflowStartRequest.signal` 及 worker host 的 input-signal listener/disarm 狀態，保留呼叫方從其 abort signal 到 `run.cancel()` 的橋接。將 `WorkflowError` 變為單一的 fatal 錯誤類，不再有布林模式或 `isFatalWorkflowError()` 輔助函式。

修訂已實施的動態工作流程 Agent Note，並更新 seam/工具/worker README、工具 schema、生成的 catalog 與包相依性圖、worker type-equiv 記錄、單元測試以及工作流程快照/header fixture（測試前置資料）。如果進度 UI 工作被立項，應從一份命名了父 agent/工作階段/工具呼叫的關聯約定出發，而非原樣復活這套協議。

## 曾考慮的替代方案

**為未來 UI 保留預建的觀測詞彙。** 當前形態類似 Claude Code 的動態工作流程元資料，host 有意地將每個轉發的 agent start 與 worker 的 end 或一個合成的終止 end 配對。移除它意味著放棄形態相容性，使進度 UI 成為一項全新的設計任務；但現有載荷仍缺少可路由的歸屬資訊，因此僅靠成對完整的生命週期也無法在不重新設計的情況下讓已命名的 ACP 消費端可行。

## 驗收標準

- 工作流程公開約定僅包含有生產消費端的執行、取消、結果與 dispose 約定。
- 不再保留任何工作流程事件、phase/log 協議訊息、run-id 生成器、僅供進度使用的元資料、host 配對帳本或 fatal 模式分支。
- run handle 不再有 id/meta 回顯，取消在同步 `start()` 返回後只有一條持有者擁有的通道。
- parallel/pipeline 行為、上限、取消後的完全靜止、worker 隔離、結構化輸出與面向模型的工作流程場景保持測試覆蓋。
- 型別檢查、覆蓋率、快照、doc-sync（文件同步閘門）、module-graph 校驗、建置與 hygiene 全部透過。

## 風險

這是對工作流程 DSL、事件分類體系、handle 與 start request 的編譯可見收縮。現有提供描述性元資料的工作流程呼叫，以及使用 `phase`、`log` 或 label 的指令碼，都必須相應精簡；程序化呼叫方需自行將 abort source 橋接到返回的 handle；未來的觀測者必須新增一個關聯性更好的事件約定。使工作流程有用的執行語義不變。
