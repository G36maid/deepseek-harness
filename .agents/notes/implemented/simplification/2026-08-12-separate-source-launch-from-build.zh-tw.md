# Agent Note: 將原始碼啟動與倉庫建置分離

Status: implemented

[English](2026-08-12-separate-source-launch-from-build.md) | [简体中文](2026-08-12-separate-source-launch-from-build.zh.md) | 繁體中文

## 問題

TypeScript 原始碼啟動器無需在每次呼叫前完成整個倉庫的建置。Web 介面則需要已建置的前端與 Client plugin 產物。由同一個包指令碼同時負責這兩項操作，會讓重複啟動 TUI、無頭模式和 Web 時都承擔全倉庫建置延遲，也會掩蓋瀏覽器產物何時刷新。

經由 tsx 載入的原始碼模組與經由已建置組合包載入的瀏覽器模組具有不同的新鮮度表現。將兩條命令分離後，需要明確產物生成的責任，並準確說明產物缺失與過期時的失敗模式。

## 決策

根目錄的 `dsh` 指令碼只執行 `node --import tsx/esm apps/cli/src/bin.ts`。`pnpm run build` 仍是生成包與前端產物的獨立操作。原始碼使用者在首次進行類生產啟動前執行建置，並在前端或 Client plugin 產物需要刷新時再次執行。

Typert Host 產物缺失時，profile 啟動會因不含建置指引的模組解析錯誤而失敗。這些 Host 產物存在後，如果前端或 Client plugin 產物缺失，啟動會失敗，診斷資訊會指示使用者執行 `pnpm run build`。啟動器不會驗證產物是否為最新：已有的過時前端或 Client plugin 組合包仍會被接受，並可能繼續執行舊版瀏覽器程式碼，直至下次建置。各包的 Node 半側至少建置過一次後，`pnpm run dev:web` 只重建聲明瞭 `dsh.client` 的包；它會保持 Client plugin 組合包為最新狀態並啟用其熱重新載入路徑，但不會重建前端 shell。

本決策僅規定建置調度。[tsx ESM 原始碼啟動決策](../architecture/2026-07-29-dsh-source-launch-tsx-esm.md)規定 TypeScript 轉換與 workspace 解析，[原始碼執行決策](2026-08-10-source-run-without-managed-installer.md)規定以倉庫指令碼作為受支持的檢出入口，[個人設定決策](../feature/2026-07-20-dsh-cli-personal-config.md)規定機器級設定層。

## 考慮過的備選方案

**每次原始碼啟動前都執行建置。**這樣可提供最強的默認新鮮度保證，但即使相關產物已經是最新狀態，每次呼叫仍要承擔全倉庫產物生成的開銷。

**僅在產物缺失時執行建置。**這樣可避免部分啟動開銷，但無法發現過期產物，還會讓建置行為變成由當前檔案系統內容決定的隱式策略。

**由 `pnpm dsh` 啟動 Web 產物 watcher。**這樣可保持 Client plugin 組合包為最新狀態，卻會讓一次性啟動器負責另一個長時間執行的行程。顯式的 `pnpm run dev:web` 命令已經負責這套開發生命週期。

## 影響

- 重複的原始碼啟動無需等待完整的倉庫建置，建置輸出也不會與 CLI 輸出混在一起。
- 原始碼使用者負責產物新鮮度。產物缺失會阻止啟動，但只有前端與 Client plugin 產物缺失的錯誤會指示使用者執行 `pnpm run build`；已有的過期前端與 Client plugin 組合包可能靜默提供舊版瀏覽器程式碼。
- TUI、Web 與無頭模式選擇、參數轉發、環境繼承，以及 tsx ESM 啟動方式保持不變。
- 根目錄上手指南與 CLI 參考將建置和啟動列為獨立命令，並說明過期產物行為。

## 驗證

`apps/cli/tests/source-launch.compat.spec.ts` 固定根目錄包命令的準確內容，並執行生產原始碼啟動方式。`packages/bundle/web-app/tests/web-app.spec.ts` 與 `packages/client/modules/tests/node-half.client.spec.ts` 固定產物缺失診斷。
