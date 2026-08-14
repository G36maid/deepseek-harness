# Agent Note: 透過發現機製取得包清單，而非維護靜態清單

Status: proposed

[English](2026-06-20-discover-package-inventory.md) | [简体中文](2026-06-20-discover-package-inventory.zh.md) | 繁體中文

## 問題

包與閘門清單在 TypeScript project references、包文件、CI 描述和 Knip 覆蓋項中反覆出現。大多數只是重述包版面配置、manifest（中繼資料清單）資料或聚合命令內容。因此每新增一個包都會產生本可避免的同步點。

[包層級結構](../../archived/architecture/2026-06-20-package-hierarchy.md)已經手動消除了其中若干：`scripts/publint-all.ts` 現在從 `packages/<group>/<pkg>` 版面配置推導清單，兩份 `tsconfig` 的 `paths` 對映也合併為一個 `@deepseek-ai/dsh-*` 萬用字元。剩下的是無法用 glob 消除的清單，主要是聚合設定（`tsconfig.host.json`、`tsconfig.client.json`）中的項目引用（`references`）——TypeScript 要求它們是顯式陣列（沒有萬用字元形式）。

當靜態清單編碼的是策略時，它們是合理的；當它們只是重複 `package.json`、workspace glob 或包層級結構中已有的 manifest 資料或版面配置事實時，就是不必要的摩擦。

## 提案

讓剩餘的包與閘門清單可被發現。唯一真源，即 `packages/<group>/<pkg>` 層級結構加上包 manifest，應當驅動程式聚合設定的 `references`、模組圖以及任何全量包清單，並配合一個生成加校驗步驟（沿用現有的 `gen-module-graph` / `gen-cordis-catalog` 模式：生成器寫出產物，`--check` 模式在 `hygiene` / `doc-sync`（文件同步閘門）中發現已提交副本過時時失敗）。模組圖生成已經在學取包 manifest。`doc-sync` 應當成為定義並列印其子閘門的唯一命令，文件連結到該命令，而非重述第二份清單。

層級結構不需要編碼關於包的所有事實，但應當編碼寬泛的維護策略：core/product 包、整合包、能力 seam 包與 support/test/example 包不應在指令碼能區分它們之前先要求一份手工維護的例外清單。

有一項已編目的內容根本不需要生成器：將 e2e 入口 glob 折入 Knip 的預設配置段，即可直接刪除逐包的重複聲明。

## 驗收標準

- 聚合設定的項目引用（`references`）由層級結構生成（生成器輸出它們；`--check` 閘門在提交副本過時時報錯），而非手工維護。
- 新增一個包時，不需要為任何閘門編輯靜態包清單。
- 文件描述真源，而非重複生成的清單。
- CI 呼叫聚合命令，由這些命令自行管理其子閘門清單。
- `knip.json` 僅在編碼真實資訊（額外入口文件、被忽略的相依性）時才攜帶逐包覆蓋項，絕不重述預設配置段。

## 風險

發現指令碼可能變得過於精巧。實作應當保持樸素：讀取 manifest、按顯式欄位過濾、列印解析後的清單，並在出錯時明確失敗。收益在於消除手工清單的漂移，而非發明一套建置系統。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
