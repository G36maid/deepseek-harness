# Agent Note: 移除打包工作階段 fixture 分支遷移器

Status: proposed

[English](2026-07-26-remove-packed-session-fixture-migrator.md) | [简体中文](2026-07-26-remove-packed-session-fixture-migrator.zh.md) | 繁體中文

## 問題

倉庫的默認寫入器和快照檢查會使工作階段 fixture（測試前置資料）保持規範打包行版面配置。在永久強制機制之外仍保留 `pnpm run migrate:packed-session-fixtures`，唯一原因是讓攜帶舊版 fixture 改動的運送中分支可以合併當前 `master`，並在不重新錄制模型輸出的情況下透過機械轉換收斂。

一旦每個此類分支均已合併、關閉或符合規範，寫入命令及其分支收斂指引便不再有持續維護者。過渡結束後繼續保留會修改倉庫內容的命令，會在永久只讀快照檢查旁增加第二條看似有效的維護路徑。

## 提案

在即時清單確認不再有任何開放 PR（Pull Request）需要轉換工作階段格式 JSONL 後，移除臨時 CLI `scripts/migrate-packed-session-fixtures.ts`，以及根包提供的 `migrate:packed-session-fixtures` 命令。在同一變更中，移除測試政策、ACP 快照 README 和已實作打包行 Agent Note 中指向該過渡命令的連結，並將 `scripts/session-fixture-layout.snapshot.ts` 中僅適用於該命令的修復指引替換為與具體命令無關的規範版面配置指引。

保留 `scripts/session-fixture-layout.ts`、其單元測試和 `scripts/session-fixture-layout.snapshot.ts`。它們定義並強制執行永久規範版面配置；只有面向分支的寫入器是臨時機制。

移除命令前，每個受影響分支都要合併當前 `master`，執行一次遷移器，將由此產生且僅包含 fixture 重寫的改動單獨提交，並驗證倉庫級快照版面配置檢查透過。已關閉或被取代的分支無需遷移。

## 曾考慮的替代方案

**無限期保留該命令。** 這會讓舊 fixture 轉換更方便，但也會在唯一已知遷移視窗關閉後，留下一個倉庫級寫入工具。只讀閘門已經提供可長期保留的行為與診斷。

**隨 CLI 一同移除規範版面配置轉換模組。** 該模組不是過渡殘留：快照 CI 使用它發現未來 fixture、解碼混合物理記錄，並與規範打包表示進行比較。移除該模組也會移除強制機制。

**打包行進入 `master` 後立即刪除命令。** 較舊的開放分支在調整目標分支後，只能使用臨時指令碼或手動重新生成快照，這會增加衝突風險，也會讓解碼事件保真度更難評審。

## 驗收標準

- 即時開放 PR 清單未發現任何仍相依性臨時遷移命令處理工作階段格式 JSONL 改動的分支。
- 臨時 CLI、根包命令、所有分支收斂連結與僅適用於該命令的閘門診斷均不存在；永久規範版面配置轉接器、單元測試和快照檢查仍然保留。
- `pnpm run test:snapshot`、`pnpm run doc-sync`、lint 和空白校驗在沒有臨時命令的情況下透過。
- 當前文件僅描述打包預設值和永久規範版面配置強制機制。

## 風險

若開放分支清單不完整，命令消失後，貢獻者可能會陷入大規模的非打包 fixture 衝突。因此，移除操作取決於即時 PR 證據，而不是經過的時間。保留命令過久的運維成本較低，但會模糊哪一種機制纔是永久機制。
