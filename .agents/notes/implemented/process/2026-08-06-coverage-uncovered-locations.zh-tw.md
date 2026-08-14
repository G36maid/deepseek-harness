# Agent Note: 覆蓋率未達標時輸出精確未覆蓋位置

Status: implemented

[English](2026-08-06-coverage-uncovered-locations.md) | [简体中文](2026-08-06-coverage-uncovered-locations.zh.md) | 繁體中文

## 問題

per-file 100% 覆蓋率閘門失敗時，vitest 只輸出文件級錯誤行（`ERROR: Coverage for lines (…) does not meet global threshold (100%) for <file>`）——知道哪個文件沒達標，不知道差在哪幾行。內建 `text` 報表雖有 Uncovered Line #s 列，但它是全倉幾百個文件的大表：該列按表寬截斷、只有行號沒有列號、不區分語句/分支/函式，且達標文件同樣佔行。結果是 CI 上的覆蓋率紅報無法直接據此處理，定位具體缺口只能本機重跑一遍 html 報表。

## 決策

`scripts/coverage-uncovered-locations.cjs` 是一個自訂 istanbul reporter（`ReportBase` 子類）：對每個低於 100% 的文件，為每個未覆蓋語句、每條未走的分支路徑和每個未呼叫函式各輸出一條自含的單行記錄 `<path>:<line>:<col> uncovered <kind> …`——terminal 與 CI 日誌中可直接點擊跳轉，也便於 grep。全部文件達標時零輸出。istanbul 報表生成先於 threshold 校驗，因此記錄恰好落在既有 ERROR 行上方。

接線是單點的：根 `vitest.config.ts` 的 coverage 塊是全倉唯一覆蓋率設定，CI lane（`run-gates ci-coverage`）、本機 `test:coverage` 與聚焦跑（`--coverage.include`）共用它。該 reporter 以絕對路徑（`fileURLToPath`）加入 CI 與本機兩個 reporter 陣列——istanbul-reports 的 `create()` 對非內建名回退為裸 `require(name)`，相對路徑會按 istanbul 自己的包目錄解析。

輸出約定：

- istanbul 的 0 基列號轉為 1 基（編輯器與終端機連結的約定）。
- v8 對整行語句給出 `end.column = Infinity`：跨行時降級為只帶行號的 `(to <line>)` 後綴，單行時省略後綴。
- 隱式分支臂（如缺少 else 的情況）可能不帶位置，reporter 會回退到分支自身的 span，保證記錄仍可點擊；分支記錄標注類型與 `path k/n`。
- 同文件內記錄按行、列排序；不設條數上限。

配套兩處：根 `package.json` 增補 devDependency `istanbul-lib-report`（pnpm 嚴格版面配置下 `scripts/` 摸不到巢狀相依性）；`knip.json` 根 workspace 的 entry/project 通配增加 `scripts/**/*.cjs`，使該文件及其相依性對 hygiene 閘門可見。

CJS 是被迫的形態，也是 ESM-everywhere 紀律的一個有據例外：istanbul 在 tsx/Vite 管線之外用裸 `require()` 裝載自訂 reporter，TypeScript 無法參與；`require(esm)` 返回的命名空間對象也過不了它的 `new Cons(cfg)` 構造，CommonJS 是唯一可靠形態。

## 考慮過的替代方案

- **相依性內建 `text` 報表的 Uncovered Line #s 列。** 正是問題現狀：全倉大表、列寬截斷、只有行號、不分種類、達標文件同列——無法直接根據 CI 日誌處理。
- **加 `json` reporter，另寫包裝指令碼失敗後讀 `coverage-final.json` 後處理。** 純 ESM/TS 可行，但包裝指令碼必須同時包住 `package.json` 的 `test:coverage` 與 run-gates 的 gate 兩個入口，命令形狀隨之改變；自訂 reporter 路線只動一處設定，兩個入口自動生效。
- **用 TypeScript/ESM 寫 reporter。** istanbul 的裝載機制（管線外裸 `require`）決定了不可行，見上；為一個報表文件把裝載機制換掉，代價不成比例。

## 驗證

本機矩陣：故意製造未達標時三類記錄齊全、位置與埋點一致；混合執行只輸出未達標文件（同跑內 100% 的文件靜默）；全綠跑零輸出、退出碼 0。CI 實證：臨時在 `clampTimeout` 埋入一處不可達語句/分支/函式後，coverage lane 在全部測試透過（632 文件 / 10326 用例）、僅 threshold 失敗的隔離條件下，把 4 條記錄列印在 ERROR 行上方；埋入的失敗並不在已提交的程式碼樹中。

## 後果

- 覆蓋率紅報自足：日誌直接給出精確行列號與缺口種類，不再需要本機重跑 html 報表定位。
- 代價是一個 CJS 文件的紀律例外與一個根 devDependency；全綠執行零輸出，不增加日誌噪音。
- 整文件零覆蓋時輸出條數與該文件語句數同階（刻意不設上限）：閘門要求零缺口，全量列出即是行動清單，vitest 自身的 ERROR 行已按文件彙總兜底。
