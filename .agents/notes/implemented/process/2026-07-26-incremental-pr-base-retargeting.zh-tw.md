# Agent Note: 增量更新 PR 的 base 分支

Status: implemented

[English](2026-07-26-incremental-pr-base-retargeting.md) | [简体中文](2026-07-26-incremental-pr-base-retargeting.zh.md) | 繁體中文

## 問題

將 PR（Pull Request）的 base 分支當前頂端提交合入 PR 分支的過程中，base 分支可能繼續前移。若改從新的頂端提交重新開始，就會丟棄已經完成的衝突解決和驗證工作。重寫已經推送的合併還會抹去可供評審的歷史記錄。

## 決策

選擇 merge-forward 時，每次觀察到的 base 分支頂端提交都保留為獨立的合併檢查點。如果處理期間 base 分支繼續前移，先完成並驗證正在進行的合併，再將其提交；任務授權推送時，還要完成推送。完成這些步驟後，才能取得較新的 base，並透過單獨的合併提交將其合入。在這條 merge-forward 序列中，不得放棄或重寫任何檢查點。

[原生堆疊與選填 rebase 決策](2026-08-02-native-github-stacks-and-optional-rebases.md)也允許獨立或堆疊 PR 使用受 lease 保護的 rebase，評審後同樣如此。本文只負責 merge-forward 路徑。[堆疊 PR 落地 skill（技能）](../../../skills/dsh-merging-stacked-prs/SKILL.md)根據根 [AGENTS.md](../../../../AGENTS.md) 選擇其中一種歷史更新方式，[堆疊評審指南](../../../../docs/cookbook/responding-to-pr-review-on-a-stack.md)則負責說明如何在相依性層之間傳播修復。

## 曾考慮的替代方案

**中止當前工作，改從最新 base 重新開始。** 這會丟棄已經解決的衝突和完成的驗證，重複勞動，並失去一個有用的復原點。

**重寫為一次同時包含兩個 base 分支頂端的合併。** 這會掩蓋衝突解決的順序；如果第一次合併已經推送，還必須重寫遠端歷史。

## 後果

- PR 的 base 多次前移時，這個 PR 可以包含多個用於合併 base 的提交。
- 已完成的工作不會被丟棄，而是保持可供評審和復原。
- 合入較新的 base 會改變合併後的文件樹，因此相關檢查會在下一次推送前重新執行。
