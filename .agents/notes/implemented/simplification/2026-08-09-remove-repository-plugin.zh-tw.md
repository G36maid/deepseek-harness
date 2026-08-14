# Agent Note: 移除專用 repository 外掛程式路徑

Status: implemented

[English](2026-08-09-remove-repository-plugin.md) | [简体中文](2026-08-09-remove-repository-plugin.zh.md) | 繁體中文

## 問題

repository 外掛程式路徑與 profile 組合包路徑重複實作了第三方包的安裝和組合。它增加了 `.dsh-plugin` manifest（中繼資料清單）、生成的包裝層、準備工作可執行文件、第二套 Git／包快取、Loader 內建項，以及 repository 專用的 skill（技能）和 MCP 配接器。profile 組合包已經能透過 profile 套件管理員安裝 npm 或 Git 包說明符，保留正常的相依性與生命週期語義，並提供一個有序 `cordis.patch.yml` 層，其中可以掛載普通 Cordis 外掛程式。

重複的路徑所能提供的設定也少於組合包。其 `repositories` 清單選擇源字串，但生成的包裝層掛載程式碼入口時無法傳入使用者提供的外掛程式設定。因此，repository 專用的準備流程增加了大量程式碼和 CI 工作，卻沒有成為通用的外部外掛程式分發機制。

## 決策

DeepSeek Harness 只保留一種獨立的外部外掛程式分發路徑：可安裝的 profile 組合包。`dsh plugin --profile <name> add <package-or-git-spec>` 將相依性記錄到 profile 包中，安裝的包透過聲明 `dsh.bundle.patch` 提供自己的 patch 層。套件管理員負責取得源、管理版本和相依性、執行建置生命週期，並維護鎖定檔。組合包 patch 負責選擇 Cordis 外掛程式並提供完整的外掛程式設定。

移除 `@deepseek-ai/dsh-repository-plugin` 包、`.dsh-plugin` 編寫格式、`dsh-plugin-prepare` 可執行文件、生成的包裝層、不可變 repository 快取、base 中的 `repository-plugins` 設定項，以及專用 GitHub 驗收管線。vendor 中未再使用的 `@cordisjs/plugin-loader/repository` 子路徑及其隨附的 pnpm 相依性，也隨唯一消費端一並移除。現有 repository 快取目錄只是不會再產生作用的使用者資料；DSH 既不會讀取，也不會刪除這些目錄。

組合包直接組合現有歸屬方。提供 skill 的組合包掛載 `@deepseek-ai/dsh-skill-filesystem`；提供 MCP 伺服器的組合包掛載 `@deepseek-ai/dsh-mcp-client`；原生行為則掛載普通的已編譯 Cordis 外掛程式。這些包繼續保有各自的校驗、生命週期、註冊和 teardown 契約。根據預發布相容政策，不保留針對 `.dsh-plugin` 的相容解析器或遷移機制。

本說明整合了已移除的 repository 快取、靜態格式、純設定整合、由 npm 支持的準備流程和受信任程式碼入口決策。其原始動機保留於此：獨立使用者需要由套件管理員負責的外部組合方式；Git 和 npm 相依性可以執行受信任的生命週期程式碼；靜態 skill 與 MCP 貢獻應複用現有歸屬方；來源標識應位於 profile 的相依性說明符和鎖定檔中。相應實作特有的包裝層、快取 generation 和準備協議不再約束產品。

## 曾考慮的替代方案

**保留 repository 外掛程式，將其作為組合包的便利包裝層。** 不予採納，因為這會為同一個包保留兩條安裝命令、兩種 manifest 格式，以及兩套失敗／快取標識。如果一層便利包裝不能傳遞普通的外掛程式設定，其能力仍然不及它所包裝的機制。

**讓 repository 包裝層載入組合包 patch。** 不予採納，因為 repository 快取和準備協議仍會重複 profile 相依性安裝。組合包已經可以透過 pnpm 接受 npm、Git、file 和 link 說明符。

**為未來可能出現的消費端保留通用 Loader repository 快取。** 不予採納，因為在移除相關包後，它已無當前消費端，卻仍讓一個 vendor 中與瀏覽器相鄰的包攜帶固定版本的套件管理員執行時期。只有當無需顯式安裝即可在設定階段啟用這一能力成為 profile 相依性無法滿足的產品需求時，纔有理由重新引入專用快取；屆時該消費端可以選擇自己的快取約定。

**停用 repository 外掛程式，但保留其磁碟格式以供遷移。** 根據預發布方針，不予採納。保留解析器或相容 loader 會在沒有外部相容義務的情況下，讓已移除的契約繼續存在。

## 後果

- 第三方包統一使用一種安裝與組合模型，採用普通相依性聲明和完整的 patch 層外掛程式設定。
- 安裝或更新外部組合包時，必須顯式透過 `dsh plugin` 執行套件管理員操作，而不是編輯受監聽的源清單。使用者 patch 的 HMR（熱模組替換）仍可設定已安裝組合包所提供的設定項。
- 安裝 profile 時，宿主機的 `PATH` 中必須提供 `pnpm`。對於顯式的包管理操作，這一要求可以接受，並且可避免僅為設定階段啟用而隨產品交付已移除快取所使用的固定版本套件管理員執行時期。
- `.dsh-plugin` 包和現有 repository 源清單 patch 停止工作。使用者仍可自行刪除其快取文件，但系統不會遷移或自動刪除這些文件。
- 專用 pnpm 執行時期、準備工作可執行文件、包裝層生成器、Git 憑據 CI 設定、repository 快取和 repository 專用測試全部消失。
- 靜態資源需要一種由組合包擁有、可相對於包解析的路徑形式，使聲明式組合包可以將 `dsh-skill-filesystem`、`dsh-mcp-client` 或其他外掛程式指向它隨包交付的文件，而無需訂製執行時期程式碼。該能力歸組合包格式所有，而不是 repository 配接器。

## 測試

靜態閘門會拒絕殘留的包、設定、文件、圖和 workspace 引用。現有 `dsh plugin` 已建置 CLI（命令列介面）驗收測試覆蓋 profile 初始化、套件管理員安裝、組合包發現和層調和。聲明式、相對於包解析的 skill 與 MCP 組合包資源仍是本移除層中已明確記錄的覆蓋缺口。
