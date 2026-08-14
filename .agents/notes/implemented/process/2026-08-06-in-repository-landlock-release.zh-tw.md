# Agent Note: 倉庫內 Landlock 發布

Status: implemented

[English](2026-08-06-in-repository-landlock-release.md) | [简体中文](2026-08-06-in-repository-landlock-release.zh.md) | 繁體中文

## 問題

`@deepseek-ai/node-addon-landlock-run` 原始碼已經與其 DeepSeek Harness 消費端一同位於 `native/landlock-run` 下，但此前仍保留獨立的 pnpm workspace 和鎖定檔，並相依性一個獨立倉庫發布到 npm。Harness 包使用 npm 登錄檔中的固定版本，因此同一個 PR（Pull Request）可以同時修改啟動器約定及其消費端，卻無法一起測試這些改動。原始碼倉庫的原生工作流程可以演練打包流程，但不會發布它實際測試過的產物。

發布映像檔還造成重複的發布協調工作：匯出原始碼、更新另一份鎖定檔、執行另一套發布工作流程、發布原生包家族，然後回到本倉庫更新登錄檔相依性。npm 使用者的實際需求並未改變，這種拆分卻讓每個二進位更難對應到其源提交，也讓發布回滾和安全修復協調更困難。

現有的非 scoped npm 包名歸獨立發布帳號所有，而不屬於 `@deepseek-ai` 組織。因此，僅遷移工作流程仍會讓發布相依性倉庫發布歸屬之外的個人憑證。

此次整合必須保留平臺選擇機制。公開分發有意採用一個 JavaScript 入口包，並為 Linux x64 和 arm64 分別提供二進位包；合併倉庫歸屬並不意味著要把所有二進位檔案放進同一個 tarball，也不意味著要按照啟動器版本發布所有 DeepSeek Harness 包。

## 決策

`native/landlock-run` 和 `native/landlock-run/packages/*` 屬於倉庫根 pnpm workspace，並使用根 `pnpm-lock.yaml`。Harness 消費端將 `@deepseek-ai/node-addon-landlock-run` 聲明為 `workspace:*`，因此開發、型別檢查、建置和 PR 測試都會從同一個 checkout 解析入口包。根 TypeScript 項目圖會先建置該入口包，再建置消費端；倉庫清理器負責清理其直接生成的 `lib/` 輸出目錄。

公開 npm 分發邊界由 3 個歸組織所有的包組成，它們共用一個啟動器包家族版本：`@deepseek-ai/node-addon-landlock-run`、`@deepseek-ai/node-addon-landlock-run-linux-x64` 和 `@deepseek-ai/node-addon-landlock-run-linux-arm64`。入口包繼續透過 `optionalDependencies` 聲明兩個平臺包；它們在 manifest（中繼資料清單）中的 `os` 和 `cpu` 欄位讓 npm 只安裝相容的包。倉庫約束要求這 3 個包名設定 `publishConfig.access: public`，並要求其版本與私有啟動器 workspace 根包一致。原先的非 scoped 包名不屬於本倉庫的發布目標。這 3 個已不再是唯一的公開包：[按序列區分 access 的決策](2026-08-13-public-vendor-and-native-sequences.md)讓 vendored 框架九包也公開發布，而 dsh 族保持受限。

主倉庫同時負責原生 CI 和發布。`Landlock Run` 會為相關 PR 和 `master` 推送執行，並在各自匹配的原生 runner 上建置每個平臺包。手動觸發的 `Landlock Run Release` 工作流程會建置兩個平臺的二進位檔案，將其作為工作流程產物傳遞，組裝並驗證完整的包家族，打包出內容不可變的 npm tarball，安裝並實際執行這些 tarball，之後才允許受保護的發布作業執行。發布順序是平臺 tarball 在前，最後發布將它們列為選填相依性的入口 tarball。發布使用 `landlock-run-vX.Y.Z` tag，避免啟動器版本與 monorepo 中其他發布家族發生衝突；預發布版本使用 npm 的 `next` dist-tag。

沙盒打包安裝演練不再允許 npm 登錄檔提供啟動器。它會將當前 checkout 的入口包、匹配的原生包和 harness 相依性閉包一起打包，把這些本機 tarball 安裝到倉庫外部的純 Node 消費端中，並在測試約束效果或失敗閉合行為之前，證明所安裝的啟動器可執行、與原生建置產物位元組完全一致，且具有正確的 ELF 架構。

## 曾考慮的替代方案

- **保留獨立倉庫作為發布映像檔**：不予採納，因為在權威原始碼已經遷入本倉庫後，這仍會保留拆分的鎖定檔、原始碼匯出、測試使用過時登錄檔版本的時間窗，以及跨倉庫發布序列。
- **發布一個包含所有平臺二進位檔案的 npm 包**：不予採納，因為使用者會下載無法在其主機上執行的二進位檔案，而且 npm 無法再利用包級 `os`／`cpu` 篩選。倉庫歸屬與 npm 包版面配置是兩個彼此獨立的選擇。
- **讓啟動器使用 DeepSeek Harness 根版本，並遞迴發布整個 monorepo**：不予採納，因為本次改動負責的是一個由 3 個包組成的公開包家族，而不是獨立的 `@deepseek-ai/dsh-*` 基線。[產物優先的 npm 基線提案](../../proposed/process/2026-08-04-artifact-first-npm-baseline-publication.md)明確將原生 workspace 排除在其目標集合之外。
- **在一個發布作業中交叉編譯兩個二進位檔案**：不予採納，因為倉庫內已提交的包矩陣已經為每種架構分配了原生 GitHub runner，無需再把交叉工具鏈納入信任邊界。

## 後果

同一個 PR 可以同時修改啟動器協議、TypeScript 入口程式碼、原生原始碼、harness 消費端式和發布路徑測試，並從同一份鎖定檔解析這些內容。發布 tag 現在標識原始碼、消費端整合、建置指令，以及主倉庫測試過的 tarball。獨立映像檔已不再屬於發布路徑，可以在第一次成功從本倉庫發布後歸檔。

npm 消費端改為安裝 `@deepseek-ai/node-addon-landlock-run`；原先的非 scoped 包名不會被靜默重定向。受支持的 Linux 主機會下載 scoped 入口包及與其架構匹配的包，並跳過另一架構的包。不受支持的主機不會收到平臺二進位檔案，並繼續沿用現有的確定性失敗閉合探測路徑。

實作涉及的文件比只修改一行相依性更多，因為倉庫還必須負責 workspace 約束、TypeScript 建置順序、清理、CI 觸發條件、發布 tag、鎖定檔生成、將已安裝二進位與 workspace 建置進行比較、發布文件和生成的第三方聲明。行為邊界仍然很窄：此次改動隻影響 Landlock 包家族及其 3 個直接 workspace 消費端，不改變其他 DeepSeek Harness 包的版本或發布狀態。

第一次發布 scoped 包時，必須透過 `npm-publish` 環境的 `NPM_TOKEN` 使用 `@deepseek-ai` 組織 token，因為 npm 只有在包已經存在後才能設定 trusted publishing。完成 bootstrap 後，必須讓 3 個包都授權本倉庫的發布工作流程，才能移除後備 token。npm 仍會按順序發布各個包，且不提供跨包交易，因此發布失敗可能留下只完成了一部分的版本。由於 npm 會拒絕已經發布的同名同版本包，操作人員必須檢查登錄檔並只發布缺失的 tarball，而不能原樣重新執行工作流程。Linux x64 和 arm64 runner 仍提供權威的二進位建置與真實核心檢查；macOS checkout 可以驗證入口包和不受支持平臺上的行為，但不能取代這些作業。

本說明僅取代[沙盒 Agent Note](../feature/2026-07-06-sandbox.md)中有關發布映像檔和開發原始碼時相依性登錄檔固定版本的表述；該 Agent Note 仍負責沙盒行為、runner 選擇和強制執行語義。
