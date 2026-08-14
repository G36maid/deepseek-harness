# 在堆疊 PR 鏈中回應評審意見

[English](responding-to-pr-review-on-a-stack.md) | [简体中文](responding-to-pr-review-on-a-stack.zh.md) | 繁體中文

評審意見可能同時針對一條相依性堆疊（`A ← B ← C …`）中的多個 PR（Pull Request）。請透過 GitHub 官方的堆疊 PR 功能保持這條鏈的關聯。本指南負責評審修復的歸屬與傳播；[dsh-merging-stacked-prs](../../.agents/skills/dsh-merging-stacked-prs/SKILL.md) skill（技能）負責檢查關聯關係和落地。

## 基本規則

1. **每個 PR 分支一個 worktree。** 每個 PR 的修復在該 PR 自己的 worktree 中進行；平行修復絕不共享同一個 checkout。
2. **GitHub 的 stack 對象是權威依據。** base 分支確定預期的相依性順序，`PullRequest.stack` 和 `stackEntry.position` 則證明 GitHub 已識別該堆疊。未經檢查這些欄位，不得僅憑分支鏈吻合就將其視為官方堆疊。
3. **修復落在引入問題的那個 PR 上，然後沿堆疊向上流動。** 當 PR `B` 上的評論指向 `B` 引入的程式碼時，在 `B` 上修復，再將 `B` 的變更傳播到 `C`，即使 `C` 也包含該文件。把修復發起在下游會導致 `B` 帶著未修復的程式碼交付，並對 `B` 的評審者隱藏修復。
4. **每項評審修復都保留為獨立 commit。** 後續 rebase 可能改變其 OID，但不得透過 amend 把已經評審的修復從分支歷史中抹去。只有你自己尚未推送且尚未評審的工作纔可以 amend。
5. **明確選擇 merge-forward 或 rebase。** 評審後允許採用這兩種歷史更新方式。改寫歷史的推送必須受 lease 保護；如果遠端 head 在此期間前移，操作必須中止，不得將其覆蓋。禁止直接使用 `--force`。

## 沿堆疊解決評審意見

1. 在行動之前先就事論事地審視每條評論：對照程式碼驗證其論斷——評審者指出了正確的症狀，但仍可能誤診原因。
2. 將每個被接受的發現對映到引入該問題的 PR，並在那裡修復。
3. 將修復後的層按順序傳播到每個受影響的子 PR：
   - **Merge-forward：** 將修復後的父分支合併到其子分支，驗證子分支，然後繼續沿堆疊向上傳播。依照[增量更新 base 的決策](../../.agents/notes/implemented/process/2026-07-26-incremental-pr-base-retargeting.md)，保留每個正在處理的檢查點。
   - **原生級聯 rebase：** 使用 `gh stack rebase`，驗證所有已改寫的層，然後透過 `gh stack push` 發布；也可以使用 `gh stack sync`，該命令可能先發布，因此必須按照 [dsh-pre-push-checks](../../.agents/skills/dsh-pre-push-checks/SKILL.md) 在同步後立即驗證。
4. 委派的修復需要信任但驗證：subagent 的報告描述的是意圖，不一定是實際落地的內容。請親自在實際程式碼樹上重新執行閘門；對於回歸守衛，要證明它在未修復的程式碼上**失敗**（引入回歸、觀察變紅、再還原）——兩種情況都透過的守衛什麼也守不住。subagent 將問題重新定性為「已處理」時，這是一個需要親自深入的訊號。
5. 在評審執行緒中回覆（`gh api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies`），而非發頂層評論；說明修復內容及當前承載修復的 commit 或 head。
6. 每次改寫推送後，都要重新讀取未解決執行緒、批准狀態、可合併性和檢查結果。經 force-push 改寫的 commit OID 或已過時的內聯錨點，都不足以證明該發現當前仍處於已解決狀態。
7. 僅可透過官方堆疊流程落地。如果這些 PR 尚未關聯，落地 skill 會自動關聯作者相同的鏈；如果作者不同，則先詢問使用者；如果原生堆疊支援不可用，則硬性停止流程。

## 驗證

- 每個已修復 PR 的當前 diff 都在引入問題的那一層包含預期修正。
- GraphQL 報告的官方堆疊只有一個且順序符合預期；每個子 PR 相對於父 PR 的 diff 只顯示該子 PR 自身的變更。
- 每次改寫推送後，均重新審計了未解決執行緒、批准狀態、可合併性和檢查結果。
- 相關閘門在堆疊中的每個受影響 PR 上都透過，而不僅僅是頂部。
