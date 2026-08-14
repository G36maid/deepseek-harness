# Agent Note: 由事件直接指定的 PR 評審狀態命令

Status: implemented

[English](2026-08-10-event-directed-pr-review-status.md) | [简体中文](2026-08-10-event-directed-pr-review-status.zh.md) | 繁體中文

## 問題

Issue 所在 Project 中的狀態記錄瞭解決工作的下一步由誰負責。PR（Pull Request）的彙總評審狀態可以回答 GitHub 是否認為該 PR 可合併，卻無法表示這次交接：作者修復程式碼並重新請求評審後，先前的 `CHANGES_REQUESTED` 評審仍可能繼續生效。

單調投影也無法在評審人提出修改要求時，將由自動化管理的 Issue 從 `In review` 退回 `In progress`。重建評審輪次或評審人阻塞項會引入既定雙事件約定並不需要的狀態。

## 決策

Issue 生命週期工作流程把評審 webhook 視為命令。`pull_request.review_requested`（包括重複請求）將目標狀態指定為 `In review`。`pull_request_review.submitted` 將目標狀態指定為 `In progress`，但僅在 `review.state` 為 `changes_requested` 時生效；submitted 事件仍不可省略，因為評審人即使沒有先觸發 review-request 事件，也可以直接提出修改要求。對於 approved 和 commented 提交，工作流程會在生命週期作業建立 Project token 前跳過該作業；dismissed 評審則不在訂閱範圍內。

工作流程訂閱的普通 PR 事件仍是隻向前推進的實作訊號：它們可以將 `Inbox`、`Backlog` 或 `Ready` 推進至 `In progress`，但不能讓 `In review` 倒退。請求評審命令可將任意較早的活躍狀態推進至 `In review`。請求修改命令可將較早的活躍狀態推進至 `In progress`；它也可以讓 `In review` 狀態回退，但僅在目標 Project 的最新狀態事件由設定的生命週期執行主體寫入時進行。若最新狀態事件的執行主體是人工使用者或未知主體，則保留當前狀態。

處理器僅解析同一倉庫內嚴格匹配的 `Fixes`、`Closes` 或 `Resolves` 引用。它不會更改終態、將沒有 Project 狀態的 Issue 新增到 Project、相依性 PR 元資料是否有效、查詢 `reviewDecision`、重建評審輪次、從 Issue 反向尋找 PR，或執行定時協調器。

[Issue 生命週期](../../../../.github/workflows/issue-lifecycle.yml)仍不訂閱 `pull_request.ready_for_review`；兩條事件命令均不相依性該動作。[Issue 策略](../../../../.github/workflows/issue-policy.yml)保留 `ready_for_review`，因為人工提交的 PR 進入評審時，該工作流程負責執行必需檢查閘門。

## 驗證

[Issue 管理測試](../../../../.github/issue-management/policy.test.mjs)鎖定事件到命令的對映、請求修改命令後重複請求評審所觸發的狀態轉換、請求修改後的狀態回退、終態保護，以及保留人工覆蓋狀態。[工作流程測試](../../../../scripts/ci-workflow.spec.ts)鎖定訂閱事件、請求修改作業的條件，以及獨立的 `ready_for_review` 策略觸發器。

## 考慮過的替代方案

**根據 `reviewDecision` 或重建的評審輪次派生狀態。** GitHub 的彙總狀態在重複請求評審後仍可能保持為 `CHANGES_REQUESTED`，而輪次歸約器會引入超出兩個顯式交接動作所需範圍的評審人語義和順序語義。

**保留只向前推進的投影。** 單調推進可保護較後的狀態不被回退，但作者正在按要求修改程式碼時，Issue 會一直停留在 `In review`。

**無條件應用每條評審命令。** 這是最精簡的事件處理器，但會讓自動化覆蓋由人工管理的 Project 狀態。因此，處理器透過目標 Project 最新狀態事件的執行主體保護唯一允許的回退轉換。

**復原 `ready_for_review` 或新增防抖佇列。** Ready 狀態並不表示兩種評審交接中的任何一種；新增佇列只會增加延遲和控制平面狀態，不會改變任一命令。

## 後果

即使 GitHub 仍報告一個較早的阻塞性評審，重複請求評審也會將正由當前 PR 解決且由自動化管理的 Issue 推進至 `In review`。後續提出修改要求的評審會將其退回 `In progress`；批准、評論、撤銷評審、推送和移除評審人都不會改變最近一條命令設定的狀態。

投影仍由事件驅動；如果某個事件從未觸發工作流程執行，投影不會自行修復。重播舊的工作流程執行可能會再次執行其中的舊命令；ProjectV2 仍不提供在學取最新狀態與執行變更之間進行原子比較並交換（compare-and-swap）的能力。以單個 PR 為粒度的工作流程並行控制和人工狀態所有權保護機制可減少這些競態，而無需引入持久化生命週期狀態。
