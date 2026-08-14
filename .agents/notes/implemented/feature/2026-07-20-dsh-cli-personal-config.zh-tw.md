# Agent Note: dsh CLI 與來自 Harness home 的個人設定 overlay

Status: implemented

[English](2026-07-20-dsh-cli-personal-config.md) | [简体中文](2026-07-20-dsh-cli-personal-config.zh.md) | 繁體中文

## 問題

開發者自己的偏好——TUI 使用哪個提供方和模型、個人憑證、私有的配接器路由——除了改動已提交的文件之外無處安放。要把 TUI 示例指向個人的 Anthropic 代理 Opus 路由，只能在工作區裡改 `examples/tui-agent/cordis.yml` 和 `.env`，既有提交金鑰的風險，又要在每個 checkout 裡重複一遍。也沒有可安裝的命令：想在任意項目目錄裡執行這個 agent（代理），必須回到倉庫根目錄呼叫示例指令碼。Loader 元資料是靜態的——條目 `disabled` 欄位除外（見 [loader `disabled` 插值決策](../architecture/2026-08-11-loader-entry-disabled-interpolation.md)）——所以「條件組合使用 overlay」（AGENTS.md）；但 overlay 此前只以已提交的同級文件形式存在，沒有機器級的層。

## 決策

下文的各入口模式，以及個人文件的名稱與位置，已被 [profile 外掛程式組合包決策](../architecture/2026-08-05-profile-plugin-bundles.md)取代：`dsh` 啟動 profile，個人層變成逐 profile 與 home 級的 `cordis.patch.yml`。保留不變的是本筆記的實質：以 Harness home 作為機器級層的根目錄、在隨附組合之上使用 patch 語義，以及解析失敗時明確報錯。

兩個耦合的部分，與 `dsh web` PR（#443）提出的 `apps/` 裝配層對齊：

**`dsh` CLI（命令列介面；`apps/cli`，npm 名 `@deepseek-ai/dsh`）。** `apps/*` 是位於 `packages/*` 庫之上的產品組裝層。一個 bin 負責分發默認互動式 TUI、`-p`/`--prompt` 無頭輪次和 `web` 介面。TUI 以呼叫目錄為 workspace，啟動 `examples/tui-agent/cordis.yml`（或 `--config` 指定的設定）。在原始碼檢出中，根目錄的 `pnpm dsh` 指令碼不執行建置，直接使用 tsx 的 ESM hook 執行同一入口；執行方式由[原始碼啟動決策](../architecture/2026-07-29-dsh-source-launch-tsx-esm.md)規定，產物生成由[原始碼啟動與建置分離決策](../simplification/2026-08-12-separate-source-launch-from-build.md)規定。

**個人設定（`dsh-app-boot`）。** 個人 overlay 存放在 Harness home——`$DSH_HOME`，否則 `~/.dsh`——由共享的 [`resolveDshHome`](../architecture/2026-07-24-single-harness-home-resolver.md)（`@deepseek-ai/dsh-home-paths`）解析，與 skill（技能）、AGENTS.md 解析所依據的單一根目錄相同。dsh 的 TUI、Web 和無頭介面使用其中兩個選填文件；各示例 bin 仍然逐位元組按已提交的設定樹啟動：

- `.env`——在呼叫目錄的 `.env` 之後載入；`process.loadEnvFile` 從不覆蓋已有值，因此優先級為環境變數 > 項目 `.env` > 個人 `.env`。
- `config.yaml`——頂層 YAML 陣列，元素為 `@cordisjs/plugin-include` 的 `PatchOptions`，用 include 自己的 `!!js` 方言解析（`loadPersonalPatches`）並傳給 `boot()`，由它作為根 include 的 `patches` 轉發。修補程式語義與交付的 surface overlay 一致：按 id 定位的修補程式替換該設定項的整個 `config`，`insert` 追加設定項，未匹配的 id 靜默不執行任何操作。外部包作為 [profile 組合包](../simplification/2026-08-09-remove-repository-plugin.md)安裝；這個個人層負責設定這些組合包提供的 Loader 設定項。
- 文件缺失即無 overlay；文件存在但不可讀、不可解析或非陣列則在啟動時拋出（設定錯誤會明確報錯，絕不靜默跳過）。

PTY 冒煙測試的啟動器把 `$DSH_HOME` 隔離到每個測試自己的目錄，與它已有的 `DSH_AGENTS_HOME` 隔離方式完全一致，開發者真實的個人 overlay 不可能洩漏進 fixture（測試前置資料）；只有 dsh CLI 讀取個人設定，因此其他測試啟動器無需改動。

TUI 和 Web 啟動後透過 Cordis HMR（熱模組替換）註冊確切的個人設定路徑。每次新增、變更或移除都會以交易方式透過啟動器自己的組合閉包重新組合完整 patch 清單，因此新的個人 patch 落在啟動時相同的層次位置。YAML 無效或 Loader 候選被拒時，最後一個可用樹保持活動狀態，並廣播 `hmr/config-update-failed(filename, Error)`；無頭介面只在啟動時讀取該文件。Include 在已提交設定檔刷新時也會重新應用其 patch（見[設定熱重新載入韌性 Agent Note](../bug-fix/2026-07-20-config-hot-reload-resilience.md)）。

## 考慮過的替代方案

**另設一個 `bin/dsh` 包裝指令碼並由其佔用 `dsh` 名稱。** 否決，因為 `apps/cli` 是統一的產品 CLI，負責分發默認 TUI、無頭和 Web 介面。兩個相互競爭的入口會在 `$PATH` 和產品身份上衝突。

**pi 風格的類型化設定文件（`defaultProvider`/`defaultModel`/`providers`）。** 否決，選擇修補程式語義（產品負責人決策）：個人文件是疊加在隨倉庫提供的預設配置之上的 cordis overlay，而不是需要另行擁有和翻譯的第二套設定詞彙。

**個人完整 `cordis.yml` 去 include 請求的設定。** 否決：個人文件將不得不寫死葉子設定的路徑，而該路徑隨 checkout 變化；修補程式反轉了相依性方向，bin 仍然選擇設定樹，個人層只做修正。

**把個人修補程式深合併進設定項設定。** 否決：會使修補程式語義與已提交 overlay 和 vendor 的 include 分叉；整個 `config` 替換已是成文約定。

**用環境變數開關代替存在性判斷。** 否決：預設關閉的個人設定永遠不會被用起來；存在即生效加上每個測試的顯式隔離，讓實際執行獲得 overlay、測試獲得封閉性。

## 後果

- 已安裝的 `dsh` 命令可從任意目錄執行，原始碼使用者則從 checkout 呼叫 `pnpm dsh`；兩者都無需修改 checkout 即可應用個人提供方、模型、已安裝組合包的設定項和其他 Loader 設定項。該行為已針對個人 Anthropic 代理與 Opus 4.8 端到端驗證，包括一次 bash 工具往返。
- 由於按 id 定位的修補程式替換整個 `config`，個人覆蓋必須複述它保留的基礎欄位，並可能隨基礎設定項形態變化而漂移；診斷手段是 loader 的「設定項未找到/名稱不匹配」警告和 [`dsh --dump-config`](../../../../apps/cli/README.md#profiles)（列印這些修補程式合成出的設定樹）。
- 個人修補程式只在被啟動文件自身的樹裡解析 id，因此巢狀 include 的 overlay（Code Mode）不會被個性化；這些葉子的實際執行等價性暫緩。
- `dsh-app-boot` 相依性 `js-yaml`，並直接匯入 include 的 `!!js` YAML 方言（`entryListSchema`）；與 `apps/cli` 一樣相依性 `@deepseek-ai/dsh-home-paths` 以取得 `resolveDshHome`。
- 只有長時間執行的 TUI 和 Web 行程進行即時監視。無頭自動化使用確定性的啟動設定，退出時不會保留 watcher。

## 測試

`packages/boot/app-boot/tests/user-patches.spec.ts` 固定解析、啟動時應用、確切路徑的新增、失敗、復原、移除、最後可用狀態回滾、失敗廣播以及應用自有 patch 的保留。`apps/cli/tests/built-bin.e2e.ts` 啟動真實 dsh bin 並基於 profile 端到端驗證即時 patch 層。測試啟動器會隔離 `$DSH_HOME`，因此開發者的真實 overlay 不會洩漏進 fixture。
