# Agent Note: 無需託管安裝器的原始碼執行

Status: implemented

[English](2026-08-10-source-run-without-managed-installer.md) | [简体中文](2026-08-10-source-run-without-managed-installer.zh.md) | 繁體中文

## 問題

倉庫自帶的原始碼安裝器可以提供穩定的啟動器、相互隔離的 staging worktree、原子升級、回滾儲存，以及用於個人訂製的共享維護工作流程。與此同時，倉庫還必須在套件管理員之外負責第二套生命週期：安裝宿主相依性、提示輸入憑證、接管檢出、管理符號連結歸屬、協調 staging 分支、處理升級復原，以及持續保持安裝器與隨附維護 skill（技能）的相容性。

從原始碼檢出執行或開發 DeepSeek Harness 並不需要這套生命週期。維護它會擴大需要支持的檔案系統和 Git 狀態空間，卻無法改進倉庫原生的執行路徑。

## 決策

倉庫透過根目錄的 `pnpm` 指令碼支持從原始碼執行。`package.json` 中的 `dsh` 項透過 `node --import tsx/esm` 直接啟動 `apps/cli/src/bin.ts`；產物生成是獨立的 `pnpm run build` 操作，由[原始碼啟動與建置分離決策](2026-08-12-separate-source-launch-from-build.md)規定。該包指令碼會轉發參數並繼承呼叫方環境；當支持環境代理的 Node 版本必須遵循 `HTTP_PROXY` 和 `HTTPS_PROXY` 時，呼叫方可設定 `NODE_USE_ENV_PROXY=1`。使用者使用 `pnpm dsh web` 選擇 Web，使用 `pnpm dsh --profile headless "task"` 選擇無頭執行。獨立的 ACP（Agent Client Protocol）示例仍可透過 `pnpm run demo:acp` 執行。

倉庫不分發原始碼安裝器、安裝器測試套件，也不分發相依性受管理的 `current` 符號連結和帶時間戳 staging worktree 的 skill。原始碼檢出的存放位置、Git 更新，以及使用者在倉庫外建立的任何啟動器均由使用者負責。

## 考慮過的備選方案

**保留安裝器，但將 `pnpm run` 記作另一條路徑。**這樣可以保留受管理的啟動器和回滾能力，但兩套生命週期約定仍會同時生效，其中包括安裝器測試和相依性 staging 版面配置的 skill。

**保留通用的訂製與上游發布 skill。**其中的安全規則也能用於 staging 版面配置之外，但現有工作流程共同構成了一套耦合的維護系統：訂製工作流程尋找已安裝的 staging 檢出，升級工作流程執行切換，上游發布工作流程則從這些個人修改中選擇發布內容。通用 Git 貢獻指南已經屬於倉庫指令，無需以產品隨附 skill 的形式提供。

**用更小的啟動器連結指令碼替換安裝器。**這樣可以簡化設定過程，但倉庫仍需負責修改宿主 PATH 和管理啟動器歸屬。原始碼指令碼無需引入這類狀態即可提供入口點。

## 影響

原始碼使用者透過倉庫指令碼執行程序，而非使用已安裝的 `dsh` 命令。倉庫不提供原子升級切換，也不保留 staging 回滾檢出；倉庫同樣不會自動整合個人原始碼修改或將其發布到上游。未來的分發機制必須說明為何應由其管理安裝和升級狀態，定義復原行為，並補充測試與使用者文件，同時不得讓原始碼執行路徑相依性該機制。未來任何發布工作流程都必須隔離出一項獲批功能，並在首次推送和建立草稿 PR（Pull Request）前取得明確批准。

驗證範圍包括倉庫內對已移除入口點的所有引用、文件連結、生成的第三方聲明文件的新鮮度、`package.json` 中的直接原始碼啟動命令，以及透過準確的 `node --import tsx/esm` 執行方式對原始碼 CLI 進行的冒煙測試。
