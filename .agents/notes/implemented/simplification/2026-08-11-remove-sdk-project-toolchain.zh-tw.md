# Agent Note: 移除 SDK 項目工具鏈

Status: implemented

[English](2026-08-11-remove-sdk-project-toolchain.md) | [简体中文](2026-08-11-remove-sdk-project-toolchain.zh.md) | 繁體中文

## 問題

倉庫曾包含一套從未發布且沒有消費端的開發者項目產品。`@deepseek-ai/create-sdk` 用於生成可編輯的 Cordis 項目；`@deepseek-ai/dsh-scripts` 提供 `dsh-sdk` 的開發、建置、啟動、設定和外掛程式安裝命令；`@deepseek-ai/dsh-helper` 協調功能定義與多文件項目編輯；`@deepseek-ai/dsh-telemetry` 上報啟動器活動。該設計旨在讓生成的項目保持可編輯，並使項目建立與後續設定對相依性、Cordis 設定項、環境變數佔位符和歸屬文件採用同一套定義。

沒有任何項目是透過公開發布版建立的，當前倉庫和外部消費端也都不需要這套生命週期。保留它就意味著繼續維護 4 個包、2 套互動式命令產品、項目範本、套件管理員配接器、設定調和、啟動器遙測、1 個倉庫 skill（技能）及其測試和文件，卻沒有證據表明這項產品邊界應當存在。

同一 `scaffold/` 分組還包含各自獨立使用的 SDK 協議、TypeScript 用戶端和 JSON-RPC 伺服器。這些包為 Python SDK、`dsh-sdk` subagent 提供方和 JSON-RPC 示例提供支持；其執行時期協議不相依性生成的項目或被移除的啟動器。

## 決策

刪除 SDK 項目工具鏈。`@deepseek-ai/create-sdk`、`@deepseek-ai/dsh-scripts`、`@deepseek-ai/dsh-helper` 和 `@deepseek-ai/dsh-telemetry` 包及其二進位檔案、測試、範本、功能目錄、項目編輯模型、套件管理員支持、啟動器遙測和倉庫項目建立 skill 均不提供替代實作或相容層。與其對應的 workspace、建置、測試、打包、文件生成器、vendor scope 重寫和相依性記錄也一並移除。

保留執行時期 SDK。`@deepseek-ai/dsh-sdk-client`、`@deepseek-ai/dsh-sdk-protocol` 和 `@deepseek-ai/dsh-sdk-jsonrpc-server` 保持原樣，從 `packages/scaffold/` 移至 `packages/sdk/`；其 npm 名稱和協議互動行為保持不變。消費端繼續提供一個可執行文件和一份外接 `cordis.yml`，JSON-RPC 伺服器仍是由該設定選擇的普通外掛程式。[倉庫命名約定](../architecture/2026-08-11-repository-naming-contract-and-rename-ledger.md)負責規定 `SDK` 在倉庫中的唯一含義和保留的包名；本說明負責記錄已刪除的工具鏈。

被取消的開發者項目、項目編輯和後續能力提案予以刪除，而不是保留為活躍或已否決記錄。本 Agent Note 保留這些提案共有的動機、不交付該產品的決策、放棄的能力，以及重新考慮這一決定的條件。已凍結的歸檔 Agent Note 仍是歷史快照，不作修改。

## 驗證

workspace 中不再存在上述 4 個已刪除包名或 2 套已移除的命令產品。包聚合設定、原始碼路徑對映、包元資料、測試收集設定、發布約束、生成目錄、相依性聲明文件和鎖定檔都只解析 `packages/sdk/` 下的 3 個執行時期 SDK 包。執行時期 SDK 包測試、已建置伺服器的冒煙測試、TypeScript 消費端、倉庫文件閘門、建置和 hygiene 檢查共同固定了保留的行為，並確保不存在過時的包路徑。

## 考慮過的替代方案

**只刪除初始化器。** 不予採納，因為 `dsh-sdk`、共享項目模型和啟動器遙測都是為了操作該初始化器建立的項目，而現有項目均不需要這些能力。

**保留僅用於報錯的包或命令別名。** 不予採納，因為這些命令都從未公開發布。墓碑會在不存在相容義務的情況下保留包與可執行文件的介面範圍。

**同時刪除執行時期 SDK 棧。** 不予採納，因為 Python SDK、行程外 Harness subagent 提供方和 JSON-RPC 示例目前仍是協議、用戶端和伺服器的消費端。

**將執行時期棧繼續留在 `packages/scaffold/` 下。** 不予採納，因為該分組剩餘內容均不再負責搭建項目。`packages/sdk/` 直接說明瞭保留內容的職責，因為 `SDK` 在倉庫中只有一個含義：受支持的 Python 與 TypeScript SDK 所使用的 JSON-RPC 用戶端／伺服器協議。DeepSeek Harness 本身不是 SDK 項目。

## 後果

DeepSeek Harness 不再建立或管理獨立的開發者 SDK 項目。自動項目生成、功能樹設定、本機外掛程式腳手架、項目本機的開發、建置和啟動命令，以及面向開發週期的啟動器遙測均有意不再提供；普通應用和執行時期分發仍透過各自歸屬的包和 `cordis.yml` 文件組合外掛程式。

倉庫刪除完整的支持圖，而不是繼續保留休眠抽象。重新引入項目工具鏈必須先有真實消費端，並基於該消費端的工作流程提出新提案；預設情況下，不會復活這些包或已刪除且不承諾相容的格式。
