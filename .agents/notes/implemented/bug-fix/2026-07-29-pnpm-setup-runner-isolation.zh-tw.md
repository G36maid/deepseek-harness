# Agent Note: 按 GitHub Actions runner 隔離 pnpm 設定

Status: implemented

[English](2026-07-29-pnpm-setup-runner-isolation.md) | [简体中文](2026-07-29-pnpm-setup-runner-isolation.zh.md) | 繁體中文

## 問題

`pnpm/action-setup@v4` 的安裝目標目錄預設為 `~/setup-pnpm`，並會在設定期間替換該目錄。自託管 CI 故障切換在同一個 VM 使用者下執行六個 GitHub Actions runner 服務，因此並行作業會共用同一目標目錄。在復現執行中，三個作業在 73 毫秒內進入 pnpm 設定；其中一個設定過程刪除了另一個行程的當前工作目錄，導致兩個作業在 Node 的 `uv_cwd` 初始化階段失敗。換到另一臺 runner 重試後透過，說明該故障取決於時序，並非倉庫測試回歸。

## 決策

[主 CI 工作流程](../../../../.github/workflows/ci.yml)中的每個 `pnpm/action-setup` 步驟都設定 `dest: ${{ runner.temp }}/setup-pnpm`。每個 runner 服務獨佔自己的臨時目錄，因此一個設定過程無法替換另一個 runner 的安裝目錄。持久 store 的複用仍由 `PNPM_CONFIG_STORE_DIR` 獨立處理，遵循 [pnpm 設定決策](../process/2026-07-26-pnpm-action-setup-for-symmetric-ci-caching.md)。

[工作流程回歸測試](../../../../scripts/ci-workflow.spec.ts)會找出 `ci.yml` 中的每個 `pnpm/action-setup` 步驟，並拒絕缺少 runner 專屬目標目錄的步驟。這可確保後續新增的作業也處於同一隔離邊界內。

## 曾考慮的替代方案

**序列執行故障切換作業。** 否決：這會犧牲由六個 runner 組成的池所具備的預期平行能力，並把 action 內部的目錄衝突變成原本相互獨立作業之間的佇列等待。

**為每個 runner 服務分配獨立的 Unix 使用者。** 這同樣能夠隔離 `HOME`，但會把該不變數轉移到外部 VM 設定中，並使刻意共享的持久 pnpm store 的所有權變得複雜。工作流程已經獲得 runner 專屬臨時目錄。

**重試失敗的設定步驟。** 否決：重試只能降低觀測到的衝突發生率；另一個並行設定過程仍可能再次刪除同一個共享目錄。

## 後果

pnpm 可執行文件採用臨時安裝，並按 runner 隔離；包下載仍使用已設定的持久或快取 store。託管作業使用相同的顯式目標目錄，不改變快取政策。工作流程中的每個設定步驟因此增加三行設定；只有在 pnpm 設定有意改用另一種隔離機制時，才需要更新回歸測試。
