# Agent Note: dsh 透過 tsx ESM 掛鉤原始碼啟動

Status: implemented

[English](2026-07-29-dsh-source-launch-tsx-esm.md) | [简体中文](2026-07-29-dsh-source-launch-tsx-esm.zh.md) | 繁體中文

> 取代[原生 TypeScript 原始碼啟動](../../archived/architecture/2026-07-28-dsh-native-typescript-source-launch.md)：Node 移除了該決策所相依性的能力。

## 問題

[已歸檔的原生原始碼啟動決策](../../archived/architecture/2026-07-28-dsh-native-typescript-source-launch.md)讓 `apps/cli/src/bin.ts` 在 `node --experimental-transform-types` 下執行，配合一個只做解析的 paths loader，由 Node 負責 TypeScript 轉換。Node 26.0.0 移除了 `--experimental-transform-types`（行程以 `bad option` 拒絕該 flag），只保留 strip 模式，而 strip 模式無法接受這個原始碼圖必需的文法：vendor Cordis 中的參數屬性（`constructor(private ctx: Context)`）、`vendor/hmr` 中的 `@Inject` 裝飾器，以及遍佈 `vendor/` 與 `packages/workflow` 的執行時期 enum/namespace。倉庫的 engines 範圍（`^22.19.0 || >=24.0.0`）包含 Node 26，因此原生啟動鏈在其上完全無法啟動——且沒有任何 CI 任務執行過真實啟動向量，這一不相容悄然發布。

啟動延遲同樣是問題：off-thread 的 `module.register()` 掛鉤工作執行緒把每次解析都跨執行緒序列化（TUI 啟動期間約 440ms 的 `makeSyncRequest` 等待），而完整的 tsx 默認形態（`--import tsx`）會因其 CJS 掛鉤放大解析開銷而多花約 0.4s。

## 決策

`dsh` 的 TUI、Web 與無頭原始碼啟動執行 `node --import tsx/esm`：由 tsx 的 ESM-only 掛鉤同時負責 TypeScript 轉換與 tsconfig `paths` 投影。根目錄的 `dsh` 指令碼直接從倉庫根目錄使用同一啟動方式；產物生成是獨立操作，由[原始碼啟動與建置分離決策](../simplification/2026-08-12-separate-source-launch-from-build.md)規定。CJS 掛鉤保持關閉，因為 CLI（命令列介面）原始碼圖是純 ESM；實測執行時期啟動至 TUI banner 耗時約 0.7s，對比完整 tsx 默認形態約 1.1s、已移除的原生鏈約 0.75s。

`scripts/tspath-loader.ts` 與 `apps/cli/src/tsconfig-paths-loader.ts` 已刪除。隨之消失的還有該 loader「僅為已聲明執行時期相依性對映 workspace import」的執行時期規則——tsx 無條件應用 `paths` 對映。聲明完整性現在僅由靜態閘門保障：設定的裸外掛程式走 `verify-cordis-config`，manifest（中繼資料清單）走 workspace constraints。（該執行時期規則確實發現過真實缺陷：`dsh-plan-mode` 與 `dsh-tool-jobs` 匯入 `@deepseek-ai/dsh-llm` 卻只聲明在 devDependencies；後已修復。）

node-compat CI 矩陣（Node 22.19 與 26）新增 `dsh-source-launch-smoke`（`apps/cli/tests/source-launch.compat.spec.ts`）：以精確的生產執行時期啟動向量做 keyless 管道 stdio 啟動，斷言行程會因 TTY 拒絕而以非零狀態退出。未來 Node 對模組掛鉤或 TypeScript 處理的任何改動都會讓該閘門變紅，而不是破壞開發者的 `pnpm dsh`。

## 備選方案

**在 Node ≤25 保留原生鏈並按版本分叉。** 拒絕：兩套轉換語義（amaro 與 esbuild）在邊緣文法上會分歧，啟動器要加版本探測，node-compat 矩陣要覆蓋兩條路徑——為一個已經變動過的 experimental flag 付出沉重維護。而且 amaro 也不支持 `vendor/hmr` 使用的 `@Inject` 裝飾器，原生路徑本來就無法啟動隨附的默認 TUI 設定。

**把原始碼圖改成 erasable-only 以適配 Node 26 strip 模式。** 拒絕：參數屬性與值 namespace 遍佈 vendor 的 Cordis/cosmokit/loader/schemastery；改寫是無界 churn，且每次 vendor sync 都要重做。

**倉庫自有的同線程 loader（`module.registerHooks()` + esbuild 或 `@swc/core` 轉換）。** 暫拒：原型實測約 0.45s（esbuild 路徑未端到端驗證；SWC 在 `vendor/hmr` 的裝飾器 + namespace 合併上兩種裝飾器模式都會崩），但這意味著要自行負責轉換正確性，以及實作 tsx 已經提供的解析掛鉤。僅當約 0.3s 的差距成為真實成本時再重新考慮；效能分析證據在 PR 討論中。

**Node 26 執行建置產物 `lib/`，24 保留原生。** 拒絕：在最新 Node 版本線上失去零建置開發迴圈，且混淆原始碼面與產物面。

## 結果

- 整個 engines 範圍（包括未來改變原生 TypeScript 支持的 Node 版本線）只有一個啟動向量；冒煙閘門按矩陣行強制執行。
- TypeScript 轉換重新委託給 tsx/esbuild，逆轉了前一篇 Agent Note「證明 Node 原生轉換可用」的目標；在 vendor 原始碼使用不可擦除文法且 Node 不再提供 transform 模式的情況下，該目標不可達。
- 原始碼啟動中的執行時期相依性聲明強制不復存在；未聲明的 workspace import 現在只能透過靜態閘門或建置模式的解析失敗暴露。
- 執行時期啟動相比完整 tsx 默認形態快約 0.4s；ACP（Agent Client Protocol）保留 `--import tsx`，因為它的相依性圖尚未就 CJS 掛鉤相依性性做審計，且其啟動延遲不在互動路徑上。
