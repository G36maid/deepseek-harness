# Agent Note: TSC 優先建置與編譯器單一歸屬

Status: implemented

[English](2026-06-17-ts-build-config.md) | [简体中文](2026-06-17-ts-build-config.zh.md) | 繁體中文

> 根項目拓撲由一個 solution 根文件統轄兩個 aggregate program；見 [solution 根文件 Agent Note](2026-07-22-tsconfig-solution-root-two-aggregates.md)。Host 生成 Remote 約定後再編譯 Client 的當前命令順序見 [API Remotes 建置 Agent Note](2026-08-08-api-remotes-generated-contract-build.md)。本文確定的 tsc-first 職責保持不變。

## 問題

此前的 TypeScript 建置與型別檢查設定存在以下問題：

- `build` 使用 `tsc` 將 `packages/<group>/<pkg>` 和 `vendor/*` 下的 `.ts` 轉換為 `.d.ts` 文件，然後使用 `tsdown` 將 `.ts` 轉換為打包後的 `.js` 文件。這導致兩個工具各自執行 TypeScript 轉換。
- `typecheck` 傾向於透過一個根目錄的型別檢查設定來校驗包、vendor 原始碼、示例、測試和指令碼。

建置與型別檢查使用一致的 tsconfig 邊界和 TypeScript 解析/轉換行為。建置透過單一編譯器和設定生成 `.js`、`.d.ts`、`.js.map` 和 `.d.ts.map`，使發布產物與類型校驗保持一致。

具體約束：

- `tsdown` 使用 `oxc` 進行 TypeScript 轉換，其行為與 `tsc` 不同。
    - `tsdown` 輸出的打包 `.d.ts` 與 Cordis 內部的相對模組增強（module augmentation）結構衝突。
    - tsc 的輸出受 `allowImportingTsExtensions` 影響：生成的 `.js` 文件不得匯入 `.ts` 文件，且生成的 `.d.ts` 文件必須保留 NodeNext/Node16 接受的顯式相對說明符。為此，包內相對匯入在 TypeScript 原始碼中使用顯式 `.ts` 說明符，由 `rewriteRelativeImportExtensions` 在輸出的 JS 中將其重寫為 `.js`。
    - `tsdown` 輸出的打包 `.js` 與 `tsc -b` 逐文件輸出的 `.js` 行為不同，例如裝飾器轉換行為。
- `vendor/*/src`、示例、測試和指令碼無法全部以 plain-include 方式納入一個根目錄的嚴格程序。
    - 在根目錄嚴格設定下直接對 `vendor/*/src` 做型別檢查，會觸發大量不屬於本項目所有權範圍的類型錯誤。
    - `packages/*/*` 對 `vendor` 的包相依性解析到 `vendor/*/lib`，以適應不同的 tsconfig 嚴格度。


## 決策

包內相對匯入使用顯式 `.ts` 說明符。

`pnpm run build` 依次執行 Host lib、Client lib 和 Web；每個 lib 階段都保持 tsc 先發射、tsdown 後打包：

- Host tsc 對 `tsconfig.host.json` 執行 `tsc -b`，把逐模組 `.js`、`.d.ts`、`.js.map` 與 `.d.ts.map` 輸出到 Host 圖各包的 `lib/types`；Host tsdown 隨後讀取這些 JS，生成發布入口並執行 Host Typert。
- Client tsc 在 Host Typert 已生成 Remote Client 聲明後對 `tsconfig.client.json` 執行 `tsc -b`；Client tsdown 再讀取 Client 圖發射的 JS，生成 Client 包的 Node loader 入口與 browser bundle。
- Web build 只在兩個 lib 階段完成後啟動。

`tsdown` 不再負責 TypeScript 編譯或聲明文件輸出。

`pnpm run typecheck` 先執行 Host lib 階段，以生成 Client 型別檢查所需的 Remote 聲明，再對 `tsconfig.client.json` 執行 `tsc -b`。兩個 aggregate 本身以 `noEmit` 方式檢查各自的示例、測試與指令碼；被引用的包項目和 vendor 項目保持與建置相同的發射行為。

複合項目將增量建置資訊保存在各項目本機的 `lib/` 輸出中。`pnpm run clean` 會根據根 TypeScript project-reference 圖確定當前有效的輸出目錄，刪除殘留的根目錄建置資訊，並刪除已刪除包留下且僅包含已知生成殘留的 `packages/*/*` 目錄。在刪除現有目標前，該命令會解析目標父目錄的真實路徑；如果解析後的父目錄位於倉庫之外，則拒絕刪除，防止使用符號連結的 project reference 將清理操作重定向到工作副本之外。對於仍有 `package.json` 的每個包，該命令都會保留 `node_modules`；如果不含 `package.json` 的目錄中存在未知文件，則拒絕刪除。建置不會自動呼叫 clean，因此常規建置會保留增量狀態。

命令編排結構如下：

```sh
pnpm run build:
tsc -b tsconfig.host.json
tsdown --env.DSH_BUILD_FACE host
tsc -b tsconfig.client.json
tsdown --env.DSH_BUILD_FACE client
pnpm run build:web

pnpm run verify-node-next-types:
tsx scripts/verify-node-next-types.ts

pnpm run typecheck:
pnpm run build:lib:host
tsc -b tsconfig.client.json

pnpm run clean:
tsx scripts/clean.ts
```

原始碼模式 demo 透過各自聲明的 TypeScript 啟動器和根路徑對映執行。`dsh` TUI 鏈使用 Node 原生轉換及應用自有的路徑 loader，Web demo 在進入同一條 CLI 原始碼鏈路前先建置所需產物，其他原始碼 demo 繼續使用 tsx。

## 曾考慮的替代方案

- **繼續使用 `tsdown`/oxc 作為 TypeScript 轉接器**：oxc 的轉換行為與 `tsc` 不同（裝飾器轉換有差異、打包 JS 與逐文件輸出不同），且其打包 `.d.ts` 與 Cordis 內部的相對模組增強結構衝突。
- **用一個根目錄嚴格程序覆蓋包、vendor、示例、測試和指令碼**：vendor 原始碼在根目錄嚴格標志下會觸發不屬於本項目所有權範圍的類型錯誤；帶有逐項目嚴格度的 project references 纔是可行的邊界。
- **每次建置前都執行清理**：即使工作區版面配置沒有變化，這也會丟棄 `tsc` 和打包器擁有的增量狀態。
- **刪除所有包級 `node_modules`**：有效的包相依性連結不會導致工作區發現失敗，而刪除這些連結會使建置清理變成重新安裝相依性。

## 後果

建置職責更加清晰：

- `packages/<group>/<pkg>` 和 `vendor/*` 下的每個普通模組有一份本機 tsconfig，同時服務於建置、型別檢查和直接執行原始碼的工具（如 `dsh` 原始碼 loader、`tsx` 和 `vitest`）。`api/remotes` 因生成約定順序使用一個 solution 和兩個互斥的 emitting project，是唯一例外。
- `build` 命令依次執行 Host 和 Client 的 Project Reference 圖。每個階段都由 `tsc -b` 負責可發布的逐模組 `.js` 和 `.d.ts` 輸出，打包器僅負責發布 runtime bundle。
    - `lib/types/*.d.ts` 是發布用的聲明輸出；`.d.ts.map` 只作為本機編譯產物保留。
    - `lib/types/*.d.ts` 使用顯式 `.ts` 相對說明符，TypeScript 的 NodeNext/Node16 解析器會將其對映到同級的 `.d.ts` 文件。
    - `lib/types/*.js` 通常僅作為打包器輸入。只有顯式執行時期 export 指向該輸出樹時，才會發布這些文件。
    - `lib/index.*` 是發布用的執行時期輸出，由打包器（當前為 `tsdown`）生成。
- `pnpm run verify-node-next-types` 掃描建置出的聲明文件，檢查是否存在缺少文件擴充名的相對說明符，然後以 `moduleResolution: "NodeNext"` 對建置出的 `types`/`exports` 介面進行臨時外部 ESM 消費端的型別檢查，確保聲明說明符的回歸在發布前被捕獲。
- `typecheck` 命令使用 `tsconfig.json`。示例、測試和指令碼由根 no-emit 項目檢查，包和 vendor 模組保持與 `build` 相同的輸出行為。包和 vendor 原始碼始終處於 project-reference 邊界之後。
- 切換分支或更新工作副本後，如果其中刪除了包，貢獻者可在重新建置前執行 `pnpm run clean`，刪除過時的包目錄。不含 `package.json` 的包目錄如果存在未知文件，必須手動判定其類別，不能直接刪除。

Cordis 的 vendor 副本現在與上游多了一處類型結構差異。在上游同步時，該差異必須被重新應用或明確廢棄。
