# Agent Note: API extractor 報告

Status: proposed

[English](2026-06-11-api-extractor-reports.md) | [简体中文](2026-06-11-api-extractor-reports.zh.md) | 繁體中文

> 文件塊型別檢查與事件分類體系兩部分已交付（[doc-sync（文件同步閘門）強制](../../archived/process/2026-06-11-doc-sync-enforcement.md)）；剩餘的 API 報告部分作為獨立提案被推遲。

## 問題

公開 API 的變更是不可見的：沒有任何機制將「此次提交改變了公開介面」變為一個顯式、可評審的事實。評審者閱讀 diff 時可能遺漏某個匯出類型新增了欄位，或某個方法簽名發生了變化。

## 提案

使用 api-extractor（或 `tsc --emitDeclarationOnly` 加一份規範化的公開 API 清單）為每個包生成一份簽入倉庫的 `etc/<pkg>.api.md`；CI 在重新生成結果與已簽入報告不一致時失敗。這樣，每一次公開 API 變更都會成為評審者（或評審 agent（代理））必須看到的一行 diff。

## 曾考慮的替代方案

**`tsc --emitDeclarationOnly` 加規範化的公開 API 清單**：如果 api-extractor 過於笨重，這是更輕量的機制；兩者都能滿足提案所需的「簽入倉庫、可 diff」的報告形態。

## 驗收標準

- 每個包都有一份簽入倉庫的 `etc/<pkg>.api.md`；CI 在重新生成結果與已提交報告不一致時失敗。
- 公開 API 變更（新增匯出、欄位放寬、簽名變化）在評審中以報告 diff 行的形式可見。

## 風險

該相依性笨重且難以調教（這正是它被推遲的原因），且報告格式會隨編譯器升級而變動，增加一個維護面；在各包尚未發布的階段，收益有限。

## 推遲原因

在 doc-sync 落地時被推遲：對於一個內部 monorepo，評審者已經能看到原始碼 diff，價值不高；且相依性笨重、難以調教。如果各包將來對外發布，再重新評估——屆時一份穩定、可 diff 的公開介面報告才值得其維護成本。
