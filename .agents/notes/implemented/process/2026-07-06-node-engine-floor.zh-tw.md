# Agent Note: 將 Node LTS 引擎下限提升至 22.19

Status: implemented

[English](2026-07-06-node-engine-floor.md) | [简体中文](2026-07-06-node-engine-floor.zh.md) | 繁體中文

## 問題

根 `engines.node` 範圍中的 Node 22 分支是對安裝後工作區的約定，而不僅僅是 harness 原始碼直接呼叫的執行時期 API 的約定。它不得低於工作區在該分支上安裝的相依性包所聲明的 `engines.node`；否則 `pnpm install --engine-strict` 會在一個已宣傳的 LTS 版本上失敗，而非嚴格模式下的安裝結果則會在相依性所支持的執行時期範圍之外執行。

## 決策

將 `engines.node` 設為 `^22.19.0 || >=24.0.0`，並在 `['22.19', 24, 26]` 上執行 keyless CI。主要的 Node 24 任務負責整套型別檢查和單元測試覆蓋率任務；三個版本均執行 source-worker、Zstandard、source-launch 和 [jsdom 儲存](../testing/2026-07-30-vitest-jsdom-webstorage-ownership.md) 專項冒煙測試，不重複這套型別檢查和覆蓋率任務。真實 API 的 e2e 工作流程保持在 Node 24 上，因為它驗證的是 API 整合而非執行時期下限。

兩個 Node 特性決定了原始碼執行時期的門檻：

- **`node:sqlite`**：`packages/session/session-persistence-sqlite` 在頂層執行 `import { DatabaseSync } from 'node:sqlite'`。該模組在 **22.13**（LTS）和 **23.4**（Current）取消了 `--experimental-sqlite` 標志要求；在此之前，匯入它會在載入時拋出例外。
- **原生 TypeScript 類型剝離**——建置模式的 `examples/headless-agent/tests/keyless-smoke.e2e.ts` 冒煙測試使用純 `node`（無 tsx）啟動該示例未匯出的 `.ts` driver，並載入示例的 `.ts` 測試配接器（`cli-mock-llm.ts`）。類型剝離從 **22.18**（LTS）和 **23.6**（Current）起成為默認行為；更早版本需要 `--experimental-strip-types`。

這些原始碼特性在 22.x 線上於 **22.18** 全部就緒，但已安裝的 Pi 配接器相依性將宣傳的 LTS 下限進一步提高。`@deepseek-ai/dsh-llm-pi-ai` 相依性 `@earendil-works/pi-ai@0.79.3`，後者的包聲明 `engines.node >=22.19.0`，因此 LTS 下限為 **22.19**。24.x 分支保持 `>=24.0.0`。該不相交範圍完全排除了 Node 23：Node 23.0–23.5 至少還有一個原始碼特性需要標志，而 23 線是非 LTS/已 EOL 的，宣傳 `>=23.6` 會增加一條已終止的發布線和一條 CI 分支，而沒有任何部署應當使用它。

`@types/node` 繼續固定在 22.x 線（`^22.20.0`），以匹配 LTS 支持線：使用 Node 23+/24+/25+ 的 API 會在所有機器和型別檢查閘門中導致 `tsc` 失敗，而不是先編譯透過，直到下限矩陣分支執行時期才暴露錯誤。目前整個程式碼樹針對 Node 22 類型 API 的型別檢查全部透過，因此固定該版本不產生任何代價。

## 後果

- 宣傳的 LTS 分支不再低於 Pi 配接器相依性的下限。
- CI 透過 Node 22.19 直接驗證 Node 22 LTS 下限，將主要覆蓋率任務保留在 `node: 24`，並用 Node 26 驗證下一個偶數線；三個版本均執行聚焦的相容性冒煙測試。
- 建置模式冒煙測試無需版本條件標志：在 22.19 上類型剝離已是默認行為，因此示例自有的 TypeScript driver 保持使用純 `node fixture.ts` 路徑。
- 未來若相依性或原始碼 API 提高執行時期下限，必須在同一變更中同步調整 `engines.node`、相容性矩陣和本 Agent Note。

## 曾考慮的替代方案

- **保持 `^22.18.0 || >=24.0.0`。** 否決：它宣傳的 LTS 版本低於 Pi 配接器相依性的下限。`@earendil-works/pi-ai@0.79.3` 要求 `>=22.19.0`。
- **降級或固定 `@earendil-works/pi-ai` 以保留 22.18 的宣傳範圍。** 否決：當前 Pi 配接器相依性是預期工作區的一部分，且 22.19 仍在 Node 22 LTS 線內。
- **下限 `>=22.13`（`node:sqlite` 邊界）加上在 22.13–22.17 的 built-bin 冒煙測試中使用 `--experimental-strip-types`。** 否決：它為一個狹窄範圍增加了版本條件測試標志，並將實驗性標志相依性包裝為正式支持。Pi 配接器相依性已經要求更高的 LTS 下限。
- **使用無上限的 `>=22.19`。** 否決：它宣傳支持 Node 23.0–23.5，而在這些版本上 `node:sqlite`（直到 23.4）或類型剝離（直到 23.6）仍需標志。
- **包含 Node 23.6+（`^22.19.0 || >=23.6.0`）。** 否決：23.6+ 確實能無標志執行兩個原始碼特性，但 Node 23 已結束生命週期（EOL）；宣傳一條已終止的發布線會增加一個範圍項和一條 CI 分支，而沒有任何部署應當使用該執行時期。
- **矩陣 `[22, 24, 26]` 而非固定 `22.19`。** 否決：浮動的主版本號條目會隨時間上漂，悄然不再驗證所聲明的 LTS 下限。
- **保持 `@types/node` 超前於執行時期下限（`^25`）。** 否決：類型定義超前於執行時期下限會讓僅 Node 24/25 纔有的 API 編譯透過，僅在 22.x 上執行時期才失敗。將 `@types/node` 固定在 22.x 線上可將此類問題轉化為所有環境下的編譯錯誤。
