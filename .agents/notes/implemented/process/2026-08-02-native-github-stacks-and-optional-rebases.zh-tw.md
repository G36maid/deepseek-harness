# Agent Note: GitHub 原生堆疊與選填 PR rebase

Status: implemented

[English](2026-08-02-native-github-stacks-and-optional-rebases.md) | [简体中文](2026-08-02-native-github-stacks-and-optional-rebases.zh.md) | 繁體中文

## 問題

僅以 base 分支表示的相依性 PR（Pull Request）鏈沒有官方的堆疊身份。要讓它落地，就必須逐個手動合併 PR、保留中間分支、調整每個子 PR 的 base，並重新查證這條鏈是否仍然完整。GitHub 原生的堆疊 PR 功能則會承載順序，對每一層應用 trunk 規則和 CI，並負責自底向上的合併與 base 調整。

一概禁止改寫已評審分支，也會排除原生的 `gh stack` 同步工作流程：該工作流程透過級聯 rebase 更新每個活躍層，並在 lease 保護下發布。如果只在堆疊之外實施這項禁令，就會讓獨立 PR 和堆疊 PR 面臨不一致的歷史選擇。

## 決策

同一倉庫內由兩個或更多個相互相依性的 PR 組成的每條鏈，在落地前都必須使用 GitHub 的官方 stack 對象。以即時 `PullRequest.stack` 和 `stackEntry.position` 欄位為權威依據。對於尚未形成官方堆疊且所有 PR 作者相同的鏈，系統使用 `gh stack link` 按自底向上的順序自動關聯；作者不一或作者資訊不可用時，必須取得使用者確認。缺少原生支持或跨 fork 的鏈會使流程硬性停止。如果現有成員屬於相互衝突的堆疊，或者官方順序與分支拓撲不一致，則在解散或重建任何堆疊之前都必須取得使用者指示。

「落地堆疊」透過 `gh stack merge <stack-number> --yes --merge` 合併整個官方堆疊。部分落地需要明確指定邊界 PR，並合併從底部到該 PR 的前綴。工作流程絕不回退到逐個執行 `gh pr merge` 和手動調整 base。原生直接合併要麼全部成功，要麼全部不合併；合併佇列可能分組處理所選 PR，因此只有每個所選 PR 都分別達到 `MERGED`，落地纔算完成。

merge-forward 和 rebase 都可以作為獨立 PR 與官方堆疊 PR 的歷史刷新方式，包括評審後。改寫遠端歷史時，必須使用精確 lease 或受 lease 保護的 `gh stack` 推送路徑；如果遠端已經發生變化，操作必須中止。禁止直接使用 `--force`。[增量更新 base 的決策](2026-07-26-incremental-pr-base-retargeting.md)仍負責 merge-forward 選項。

相關檢查通常在發布前執行。`gh stack sync` 是明確的例外，因為它在一次操作中完成取得、級聯 rebase 和推送：隨後立即驗證每個已改寫的層；這些驗證透過前，不得合併任何受影響的 PR。每次改寫推送後，都要重新審計當前 head、未解決的評審執行緒、批准狀態、可合併性和檢查結果，因為先前的 commit OID 和內聯錨點可能已經過時。

## 驗證

[堆疊落地 skill（技能）](../../../skills/dsh-merging-stacked-prs/SKILL.md)驗證原生支持、同倉庫分支、即時作者資訊、官方成員關係與順序、合併範圍以及最終合併狀態。[堆疊評審指南](../../../../docs/cookbook/responding-to-pr-review-on-a-stack.md)讓修復留在引入問題的層，並涵蓋兩種用於傳播修復的歷史策略。[推送前工作流程](../../../skills/dsh-pre-push-checks/SKILL.md)負責 lease 保護和同步後立即驗證所得的證據。

## 曾考慮的替代方案

**僅以分支鏈表示堆疊。** 這種做法保留手動流程，但 GitHub 沒有 stack 對象可用於展示順序、對每一層執行 trunk 規則或以原子操作合併整個範圍。

**採用原生堆疊，但禁止在評審後使用其 rebase 命令。** 這會保持 commit OID 穩定，但也會在堆疊正在接受評審時停用官方同步路徑，並讓獨立 PR 遵循不同的政策。

**要求每次刷新 PR 都使用 rebase。** 線性歷史很有價值，但當保存已經完成的衝突解決及其復原點比緊湊歷史更重要時，合併檢查點仍然是有效選擇。

**自動解散相互衝突的堆疊。** 這會讓本機分支推斷凌駕於共享的 GitHub 元資料之上，並可能幹擾所請求鏈之外的 PR 或作者；已經合併或進入佇列的條目不一定都能移除。

## 後果

- 評審者和自動化會獲得 GitHub 的堆疊圖、覆蓋整個堆疊的規則、CI 和原生合併狀態。
- 同一作者的殘留鏈無需額外詢問即可成為官方堆疊；鏈由多名作者共同擁有或元資料發生衝突時，仍保留人工決策邊界。
- 評審後，rebase 可能使 commit hash、批准狀態或評論錨點失效，因此每次改寫推送後都要對即時評審狀態和檢查結果進行審計。
- `gh stack sync` 可能短暫發布本機驗證仍待完成的程式碼；受影響的 PR 在同步後立即驗證透過前仍禁止合併。
- merge-forward 仍然可用，並以增加合併提交為代價保留已完成的檢查點。
