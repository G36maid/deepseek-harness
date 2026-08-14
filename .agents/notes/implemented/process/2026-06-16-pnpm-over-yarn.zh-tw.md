# Agent Note: 使用 pnpm 替代 Yarn 4 作為套件管理員

Status: implemented

[English](2026-06-16-pnpm-over-yarn.md) | [简体中文](2026-06-16-pnpm-over-yarn.zh.md) | 繁體中文

## 問題

本倉庫最初使用 **Yarn 4** 搭配 `node-modules` 連結器。這是一個刻意保守的選擇：行為類似 npm 的扁平版面配置，同時享有 Yarn 的 workspaces 和 `yarn constraints`。它能正常工作。但 Yarn 4 源自 Plug'n'Play 的血統，使得 `node-modules` 連結器成為非主流模式；而更廣泛的 JS 生態——工具預設值、CI action、Corepack 示例、貢獻者的熟悉度——正日益以 pnpm 為中心。對於一個主要由 agent（代理）建置、偶爾有人類貢獻者閱讀的倉庫而言，「大多數工具和人所期望的套件管理員」具有實際價值：更少的意外、更成熟的故障路徑、更多可直接複用的解答。

切換成本目前處於最低點。本倉庫尚無任何包發布（每個包都是 `private: true`）；開發流程、測試和原始碼模式 demo 都透過各自聲明的 TypeScript 啟動器執行，產物檢查則會顯式建置。因此，套件管理員只需做到：（a）解析並連結 `node_modules`，（b）執行 workspace 指令碼，（c）強制執行 workspace 約束。唯一的 Yarn 特有資產是 `yarn.config.cjs`（`@yarnpkg/types` 約束引擎），體量小且可機械地重新表達。這與 [tsdown 決策](../../archived/process/2026-06-11-tsdown-over-dumble.md)的邏輯一致：在爆炸半徑尚小時，將承重工具換為生態更健康的選項。

## 決策

採用 **pnpm 11.7.0**，透過 `packageManager` 欄位固定版本，經 Corepack 安裝（與 Yarn 使用的機制相同）：

- **Workspaces** 從 `package.json` 的 `workspaces` 陣列 + `.yarnrc.yml` 遷移到 `pnpm-workspace.yaml`（`vendor/*`、`packages/*`——同樣的 glob；`examples/*` 保持非 workspace，與先前設定及 tsdown 的顯式 glob 一致）。
- **嚴格符號連結連結器**（pnpm 默認）取代 Yarn 的提升式 `node-modules` 連結器。我們刻意**不**新增 `node-linker=hoisted` / `shamefully-hoist` 逃生口：pnpm 的非扁平 `node_modules` 會使幻影相依性（引用未聲明的傳遞相依性）明確報錯，這對於一個以機械閘門為核心質量保障的倉庫（見[機械品質閘門](2026-06-11-quality-gates.md)）是一項*優勢*。閘門套件（型別檢查、lint、test、build、knip）是證明不存在此類幻影匯入的安全網。
- **建置指令碼白名單。** pnpm 10+ 不執行相依性的生命週期指令碼，除非將其加入白名單。`pnpm-workspace.yaml` 攜帶一份顯式的 `allowBuilds` 對映（`esbuild`、`lefthook`、`@google/genai`、`protobufjs`）——與本倉庫對模型/工具輸出已有的供應鏈加固姿態一致，現在也應用於安裝時的程式碼執行。`peerDependencyRules.allowedVersions.typescript: '>=5 <7'` 消除倉庫內 TypeScript 的良性 peer 範圍警告。
- **約束變為套件管理員無關。** `yarn.config.cjs`（匯入 `@yarnpkg/types`，使用 `Yarn.workspaces()` / `workspace.set()`）被 `scripts/check-workspace-constraints.ts` 取代——一個純 tsx 指令碼，透過 `pnpm run constraints` 執行。它在相同的 `vendor` + `packages` 範圍上強制執行完全相同的不變式：每個包 `private: true`；`@deepseek-ai/dsh-*` 包將 `cordis` 同時聲明為對等相依性（peer dependency）和 dev 相依性且範圍一致、使用根 `package.json` 的版本、設定 `type: module`；vendor 包僅檢查是否為私有。
- 所有 CI、lefthook 掛鉤、`package.json` 指令碼和文件中的 `yarn …` 動詞變為 `pnpm …` / `pnpm run …`。`yarn.lock` → `pnpm-lock.yaml`（lockfile v9）。`.gitignore` 將 `.yarn/` 換為 `.pnpm-store/`。vendor README（如 `vendor/cordis/README.md`）按 Vendoring Policy 保持其上游 `yarn` 示例不變。

## 曾考慮的替代方案

- **保留 Yarn 4**——零變動，但押注於使用率較低的連結器模式和一個綁定單一套件管理員的約束引擎。
- **npm workspaces**——無處不在，但沒有約束方案，monorepo 開發體驗也較差。
- **pnpm 搭配提升式連結器**——遷移更平滑，但放棄了幻影相依性安全性，而這正是遷移的核心正確性理由。

## 後果

約束檢查失去了 Yarn 的自動**修復**能力（`workspace.set()` 能原地改寫 manifest）；tsx 指令碼僅做檢查，不透過時以非零退出碼和訊息退出。這是可接受的：CI 從未執行過 `--fix`，且需要手動編輯的情況很少。貢獻者現在為 pnpm 而非 Yarn 執行 `corepack enable`；`pnpm exec lefthook install` 取代 `yarn lefthook install`（`postinstall` 掛鉤仍會執行 `lefthook install`）。

效能（遷移時在開發 NFS 檔案系統上測量；執行次數為個位數的樣本，方差大——僅供方向性參考，非基準測試套件）：

| 場景 | Yarn 4 | pnpm 11 |
|---|---|---|
| 冷啟動（空快取/store，無 `node_modules`） | ~14 s | ~16 s |
| 熱重連結（快取/store 已熱，`node_modules` 已刪除） | ~12–14 s | ~15–22 s |
| 凍結安裝，`node_modules` 存在（無操作重驗證） | ~2–8 s | ~0.5–7 s |

在快速本機磁碟上，pnpm 的內容尋址 store 通常在冷/熱安裝中勝出，尤其在多個檢出之間的**磁碟佔用**方面優勢明顯（一個全域性 store 透過硬連結接入每個 `node_modules`，而 Yarn 每個 worktree 複製約 279 MB——部分開發者經常為本倉庫保持約 10 個或更多 worktree）。該去重優勢在上述遷移時資料中**未能**體現，因為測試 store 和 `node_modules` 位於不同檔案系統，硬連結失效；在單檔案系統的開發機或 CI 快取上則適用。誠實的總結：在我們的 NFS 開發檔案系統上，安裝速度在噪聲範圍內不分伯仲；遷移的理由是生態對齊、幻影相依性安全性和跨檢出磁碟去重，而非原始安裝時間的勝出。

所有品質閘門（constraints、型別檢查、lint、doc-sync、達到 100% 的 test:coverage、建置、knip、publint 以及已建置應用的冒煙測試）均在 pnpm 下透過，證明更換連結器沒有引入幻影相依性故障。
