# Agent Note: 平行 pre-push 閘門

Status: implemented

[English](2026-07-06-parallel-pre-push-gates.md) | [简体中文](2026-07-06-parallel-pre-push-gates.zh.md) | 繁體中文

本記錄中的本機掛鉤部分已由[快速本機 Git 掛鉤](2026-07-22-fast-local-git-hooks.md) 取代。有界閘門調度器和包級 `publint` 平行機制仍用於 CI、`doc-sync` 和顯式本機命令。

## 問題

文件同步等聚合任務隱藏了很長的序列鏈，其中各項檢查只讀且相互獨立。在工作流程 YAML 中重複這些葉子清單，會使未來指令碼變更有多個位置可以發生漂移；而序列執行包發布檢查，會使一道閘門的耗時與包數量成正比。

## 決策

[scripts/run-gates.ts](../../../../scripts/run-gates.ts) 擁有 CI、`doc-sync` 和按需啟用的 `check:all` 命令所使用的有界調度器。它將具名模式展開為葉子閘門，在啟動子行程前拒絕空的或有歧義的相依性圖，遵守產物相依性，緩衝可歸因的輸出，分別報告行程退出與訊號終止結果，並在呼叫方需要不同 worker 上限時接受 `DSH_GATE_CONCURRENCY`。

Node 24 消費端任務採用單個包含七道閘門的模式，而非由 shell 管理的行程池。其默認 worker 數等於閘門數，但閘門是否就緒由相依性關係控制：`publint` 先於已建置包不變式驗證執行，快照重播、NodeNext 型別檢查、built-bin 冒煙測試和 lint 則等待該驗證完成。lint 之所以等待，是因為不變式驗證器會臨時暫存包檢視表，而 linter 不得遍歷這些檢視表；原始碼相容性檢查可以與這條驗證鏈重疊執行。

[scripts/publint-all.ts](../../../../scripts/publint-all.ts) 從 `packages/<group>/<pkg>` 發現包，並以根據 `availableParallelism()` 確定大小的 worker 池執行 `publint`。`DSH_PUBLINT_CONCURRENCY` 可以針對資源設定不同的本機機器和 CI runner 限制或提高 worker 數量。結果按包緩衝，並按確定性的包順序列印，因此平行執行不會打亂各包的日誌塊。

各閘門的包指令碼仍是臨時本機執行所用的命令入口。`hygiene` 繼續作為聚合 `&&` 鏈，而 `doc-sync` 的成員清單由調度器管理（[透過閘門調度器執行 doc-sync](../../archived/process/2026-07-21-doc-sync-through-gate-scheduler.md)）。

## 驗證

[scripts/run-gates.spec.ts](../../../../scripts/run-gates.spec.ts) 在執行器執行前拒絕無效圖，鎖定消費端清單和相依性邊，並透過真實子行程驗證訊號終止。[scripts/publint-all.spec.ts](../../../../scripts/publint-all.spec.ts) 在下游產物消費端執行前拒絕缺失的公開匯出。

## 曾考慮的替代方案

- **保持聚合 job 序列**：執行更簡單，但牆鐘時間等於各獨立檢查之和，並重複啟動命令包裝器。
- **每個葉子閘門聲明一個 CI job**：暴露最大工作流程平行度，但會重複 checkout、設定和安裝開銷，並在 YAML 中複製調度器清單。
- **在 shell 指令碼內後臺執行子命令**：可以平行處理，但會失去各閘門計時、確定性的失敗分組和直接的訊號處理。
- **每個包聲明一個 `publint` job**：暴露最大包級平行度，但會建立手工維護的包清單，包發生變化時就會漂移。
- **以無界並行執行 `publint`**：雖能最大限度縮短小型倉庫的耗時，卻會拿行程數量、記憶體壓力、包 tarball 建立開銷和日誌可讀性冒險。

## 後果

由調度器支持的命令耗時取決於最慢的相依性鏈，而非各獨立閘門耗時之和，並會報告決定總耗時的閘門。無效圖會直接失敗，不會先執行其中一部分。代價是維護一個具有顯式模式清單的訂製調度器。

這條驗證鏈會讓使用已復原產物的下游消費端和 lint 延後啟動，直至共享產物檢視表經確認有效且臨時暫存已清除；這些下游閘門仍可彼此重疊執行。

`publint-all.ts` 採用非同步執行並緩衝命令輸出，而不是即時繼承 stdio。換來的是具有穩定輸出順序的包級平行，以及用於資源調節的單一環境變數。
