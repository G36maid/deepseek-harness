# Agent Note: 以 solution 根文件統轄兩個聚合 program

Status: implemented

[English](2026-07-22-tsconfig-solution-root-two-aggregates.md) | 繁體中文

## 問題

GUI 拆分引入了第二個聚合 program（`tsconfig.client.json`，見[分層 RFC](../architecture/2026-07-19-gui-layering-and-rpc-protocol.md)），根 `tsconfig.json` 則繼續兼任宿主側聚合，`tsconfig.build.json` 還是第三份手工維護的全量 emit 圖。三處帳本平行，造成四個具體的不對稱：

- 型別檢查與建置的 references 清單逐漸脫節（`packages/goal/command-goal` 在型別檢查圖裡，建置圖裡卻沒有）。
- lefthook 的 pre-push 掛鉤只執行 `tsc -b tsconfig.json`，用戶端側的類型破壞因此透過本機檢查點，直到 CI 才暴露。
- tsserver 只發現名為 `tsconfig.json` 的設定，用戶端測試文件不在任何可發現的設定鏈上，回落到推斷項目（inferred project），既沒有 paths，lib/jsx 也不對。
- 各 vitest 設定指向三個不同的解析來源（`tsconfig.vitest.json`、根設定，外加一處手寫別名）。

## 決策

一個 solution 根文件，兩個檢查單元，一對共享 base，不再單設 build 或 vitest 設定：

| 文件 | 角色 | 是否構成 program？ |
|---|---|---|
| `tsconfig.json` | solution 根文件：`extends` base、`files: []`、兩條 references；同時是全倉 `tsc -b tsconfig.json` 圖、tsserver 入口，以及 get-tsconfig 消費端（tsx 執行 `examples/`、`scripts/`、文件圍欄程式碼區塊）就近命中的設定，其裸 workspace 匯入經繼承來的 `paths` 解析 | 否 |
| `tsconfig.base.json` | 共享 compilerOptions 與原始碼 `paths` 對映；兼任 vite-tsconfig-paths 的解析門面（不含 `include`，因此對每個匯入方都生效） | 否 |
| `tsconfig.base.client.json` | 瀏覽器側編譯形態（`jsx: react-jsx`、DOM lib、`types: []`），由用戶端聚合與每個 `packages/client/*` 包共享 | 否 |
| `tsconfig.host.json` | 原根聚合原樣遷入：宿主各包、examples、測試、scripts、website；排除 `packages/client` | 是 |
| `tsconfig.client.json` | 用戶端各包及其測試；透過 `extends` 繼承 `tsconfig.base.client.json` | 是 |

整個方案立足的原則：**cordis `Context` 的聲明合併衝突只存在於同一個 `ts.Program` 內部，從不發生在模組解析中。** solution 文件不構成 program，因此從一個根文件同時引用兩個聚合不會讓兩側的聲明合併相撞；vite-tsconfig-paths 只讀取 `paths` 與 `include`、丟棄全部類型資訊，因此一個門面可以橫跨兩側。唯一會爆炸的做法是把兩側壓平進同一個 program，由此推出兩條派生紀律：`tsconfig.base.json` 永遠不得新增 `include`/`files`（否則會洩漏進每個繼承它的包，並收窄門面範圍）；每個全倉級 `ts.Program` 消費端（`scripts/ts-project.ts`、doc-typecheck 獨立模式）都顯式以 `tsconfig.host.json` 或 `tsconfig.client.json` 為種子，絕不使用根 solution。基於 program 的生成器與語義閘門有意只留在宿主側；用戶端側只有在真實需求出現時才引入基於 program 的閘門。

根 `tsconfig.json` 仍是顯式執行完整 Project Reference 圖的 solution 入口，lefthook pre-push 透過 `tsc -b tsconfig.json --pretty false` 增量覆蓋兩側。倉庫的 `build` 與 `typecheck` 命令因 Client 相依性 Host tsdown 生成的 Remote 約定而按 Host、Client 順序執行，具體編排由 [API Remotes 建置 Note](2026-08-08-api-remotes-generated-contract-build.md)負責。`tsconfig.build.json` 與 `tsconfig.vitest.json` 已刪除；所有 vitest 設定都把 vite-tsconfig-paths 指向 `tsconfig.base.json`。

solution 根文件刻意 `extends` base：`examples/` 與 `scripts/` 沒有更近的 tsconfig，tsx（get-tsconfig）透過根文件解析它們的 workspace 匯入。`extends` 把 `paths` 對映帶回根文件，`files: []` 則讓它始終不構成 program。這不影響兩者的*型別檢查*：examples、scripts 與 website 的文件由宿主聚合納入。

## 考慮過的替代方案

- **把 `tsconfig.build.json` 改名為 `tsconfig.host.json`**——不予採納：建置圖是包含全部用戶端包的全量 emit 圖，不是宿主圖；`tsconfig.host.json` 這個名字對應的是原根聚合，而建置圖本身已被 solution 吸收。
- **讓 vitest 指向根 solution**——不予採納：solution 既沒有 `paths` 也沒有 `include`，解析結果將取決於外掛程式沿 references 走多遠；且用戶端聚合的 include 只收測試、不收 src，傳遞的 src→src 匯入會失去對映，回落到 `exports`，載入出模組單例的第二份副本。
- **保留 `tsconfig.vitest.json` 作為專用門面**——僅保留為後備方案：若 vite-tsconfig-paths 處理不了無 include 的設定再啟用；base 文件已經攜帶 paths 對映，而無 include 的設定處處生效，嚴格寬於該門面手工維護的 include 清單。

## 後果

- `docs/development.md#typescript-project-layout` 是權威描述；根 `AGENTS.md` 以約定形式收錄上述兩條紀律。
- [ts-build-config Agent Note](2026-06-17-ts-build-config.md) 繼續擁有 tsc 先行的建置管線（tsc 負責輸出，tsdown 負責打包，`.ts` 說明符配合 `rewriteRelativeImportExtensions`）；其原先「單一根型別檢查項目」的形態由本文取代。
- 新增一個普通 package 只登記進恰好一個 aggregate 的 references（Host package 進 `tsconfig.host.json`，Client package 進 `tsconfig.client.json`）。`api/remotes` 因 Host 生成約定與 Client 消費約定的順序關係成為唯一顯式拆分例外；其兩個具體 project 分別登記，包根 solution 不進入任一 aggregate。
- Host 與 Client 建置階段必須序列：Host tsdown 生成約定後 Client tsc 才能開始。各階段複用各 project 的增量狀態，不透過並行重複處理同一張圖。
