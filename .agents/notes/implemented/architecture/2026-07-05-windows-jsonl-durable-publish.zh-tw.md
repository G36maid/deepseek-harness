# Agent Note: Windows 原生持久 JSONL 發布

Status: implemented

[English](2026-07-05-windows-jsonl-durable-publish.md) | [简体中文](2026-07-05-windows-jsonl-durable-publish.zh.md) | 繁體中文

## 問題

`dsh-session-persistence-jsonl` 在首次追加時延遲發布工作階段日誌。POSIX 協議會寫入暫存檔，對其執行 fsync，將其連結至最終名稱，對父目錄執行 fsync，然後移除臨時連結。對父目錄執行 fsync 是持久性約定的一部分：命名空間變更後發生崩潰時，已經提交的最終名稱不能丟失，否則呼叫方會誤以為工作階段日誌已經物化。

Windows 具備原子命名空間操作，但 Node 沒有暴露與 POSIX 等價的父目錄 fsync 約定。如果把 Windows 目錄同步失敗視為成功，就會在無提示的情況下削弱持久化後端。因此，Windows 路徑需要採用不同的發布原語，而不是在 POSIX 的 `syncDir` 輔助函式中新增條件分支。

## 決策

JSONL 後端會在 `materialize()` 內部、任何命名空間變更之前分流。共享程式碼計算工作階段目錄、最終日誌路徑，以及編碼後的 header 和初始事件批次；隨後 POSIX 與 Windows 分別執行各自的發布協議。

POSIX 保留現有協議：建立根目錄、項目目錄與工作階段目錄，並對其父目錄執行 fsync；寫入暫存檔並對其執行 fsync；使用 `link()` 發布，確保絕不覆蓋已有的最終日誌；對工作階段目錄執行 fsync；最後移除多餘的臨時硬連結。

Windows 透過持久的暫存發布來建立缺失目錄：建立一個以固定的 `.dsh-mkdir-` 為前綴的隨機同級目錄，其名稱與目標基本名無關；隨後使用 `MoveFileExW(..., MOVEFILE_WRITE_THROUGH)` 將其發布為最終目錄名稱，且不使用 `MOVEFILE_REPLACE_EXISTING` 或 `MOVEFILE_COPY_ALLOWED`。文件物化先寫入臨時日誌並對其執行 fsync，再以同一個啟用寫穿透的 `MoveFileExW` 呼叫將暫存檔發布到最終路徑，並且同樣不允許替換。`koffi` 是覆蓋這組 API 所需的最小 Win32 橋接層；`pnpm-workspace.yaml` 允許執行它的安裝指令碼，因為該包會分發原生 loader 和預建置的平臺模組。

## 考慮過的替代方案

**忽略 Windows 目錄同步失敗。** 不予採納，因為這會在沒有強制將已發布的命名空間條目寫入穩定儲存時，就把首次追加報告為持久化成功。

**使用 `CreateHardLinkW`。** 不予採納，因為硬連結相依性檔案系統、不能發布目錄，並且沒有提供寫穿透選項。

**使用替換或交易型 API。** `ReplaceFileW` 的替換語義與拒絕同一 id 衝突的要求相悖，而新應用設計不應使用 Transactional NTFS。

## 影響

該後端在各平臺上維持同一項外部約定：首次追加要麼把完整日誌發布到最終名稱，要麼失敗且不覆蓋已有日誌。平臺分流只是實作細節；`SessionPersistence` API 和 JSONL 邏輯記錄格式均不改變。後續的 [Zstandard 編碼決策](2026-07-19-zstandard-jsonl-session-logs.md)會先作用於不透明位元組，然後才由任一平臺執行發布。

Windows 測試會在原生 Windows 上執行真實的 Win32 發布路徑。斷電行為屬於 API 約定屬性，單元測試無法證明；可測試的不變數包括：Windows 物化不會呼叫目錄 fsync、最終路徑衝突會失敗、達到最大長度的目標路徑元件仍可物化、臨時日誌在發布前已經執行 fsync，並且生成的日誌可以正常載入。

兩個平臺的追加和修復仍使用普通文件控制代碼 fsync。追加失敗後，系統會關閉僅附加控制代碼，以讀寫模式重新打開日誌，將文件截斷到追加前的大小，並對回滾結果執行 fsync，因為 Windows 不允許在僅附加控制代碼上呼叫 `ftruncate`。
