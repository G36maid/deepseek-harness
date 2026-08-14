# Agent Note: 移除 bash 完整輸出 spill 文件

Status: rejected — 完整輸出復原是真實的 bash 行為。未來的產物／blob 服務或許能將其泛化，但在替代方案就位前刪除 spill 文件會丟失有用的命令輸出。

[English](2026-06-20-drop-bash-output-spill-files.md) | [简体中文](2026-06-20-drop-bash-output-spill-files.zh.md) | 繁體中文

## 問題

`dsh-bash-local` 在記憶體中保留有界的輸出，並將大體量的 stdout/stderr 流寫入私有臨時 spill 文件。這要求一個私有目錄、隨機建立僅所有者可訪問的文件、關閉失敗處理、基於位元組偏移的增量讀取、有損讀取報告、在面向模型的文字中渲染路徑，以及清理紀律。當輸出被截斷時，該工具會告知模型去讀取一個本機 spill 路徑。

這解決了一個真實問題，但方式狹隘且有洩漏。spill 路徑是一項暴露給模型的行程本機檔案系統產物，而非具有作用域訪問控制、保留策略或 UI 支持的持久化 harness 產物。它還使背景工作的讀取變得複雜，因為有損增量讀取必須指向一個或兩個 spill 文件。

## 提案

保留尾部截斷，移除完整輸出 spill 文件。bash 結果包含有界的尾部內容加一個明確的截斷標記；不輸出路徑。如果使用者需要復原完整輸出，則新增一個通用的產物／blob 服務（具有明確的所有權、清理和 UI 渲染），然後讓 bash 將大體量輸出附加到該服務。

本提案可以獨立於[通用長時間執行工具執行時期](../../implemented/architecture/2026-06-20-generic-long-running-tool-runtime.md)落地。如果背景工作保留，`bash_output` 仍應報告輸出已被丟棄，但不再提供 spill 路徑。

## 驗收標準

- `CollectedOutput` 不再攜帶 spill 路徑。
- `OutputCollector` 僅保留有界緩衝區，刪除暫存檔機制。
- `renderResult()` 報告截斷時不包含檔案系統路徑。
- 測試覆蓋尾部截斷，不再斷言完整輸出文件的內容。
- [docs/defensive-patterns.md](../../../../docs/defensive-patterns.md) 中的安全指導不再將私有 spill 文件視為面向模型的介面。

## 放棄的能力

模型或使用者無法再從暫存檔復原大體量命令輸出中被省略的前綴。在真正的產物服務出現之前，這是可以接受的。當前的 spill 路徑為一個生命週期和權限均未經設計的功能引入了過多的專用機制。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
