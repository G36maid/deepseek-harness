# Agent Note: 供應鏈檢查與 vendor 漂移驗證

Status: proposed

[English](2026-06-11-supply-chain-and-vendor-drift.md) | [简体中文](2026-06-11-supply-chain-and-vendor-drift.zh.md) | 繁體中文

## 問題

vendor manifest（中繼資料清單）（見[引入 vendor 的決策](../../implemented/process/2026-06-11-vendor-cordis-as-source.md)）在提交時僅在*正向*強制執行（vendor 變更 ⇒ manifest 更新），但沒有任何機制驗證 manifest 的*聲明*：即 vendor/ 確實等於上游指定 SHA 的內容加上所記錄的修改。此外，少量真正的 NPM 相依性也沒有安全公告監控或更新節奏。

## 提案

1. **Vendor 漂移檢查**（夜間 CI）：以 manifest 中記錄的 SHA 淺克隆上游倉庫，複製對應的包原始碼，與 `vendor/*/src` 做 diff。除非 diff 與已記錄的本機修改一致（每項修改以簽入的 patch 文件保存——日誌條目從行文描述變為可驗證的產物），否則任務失敗。
2. **相依性安全公告**：對 lockfile 執行 osv-scanner（或 `pnpm audit`），按計畫定期執行，並在涉及 lockfile 變更的 PR（Pull Request）上觸發。
3. **授權條款清單**：一個指令碼斷言每個 vendor 包都攜帶其 LICENSE 文件，且 package.json 的 `license` 欄位與 vendor/README.md 中的清單一致（我們混合了 vendor 的 MIT 與自有的 BSD-3）——作為 CI 步驟執行。
4. **Renovate**（或定時 agent（代理）任務）以小 PR 的形式提議 NPM 相依性更新，這些 PR 走完整閘門套件；vendor 包不在其列（它們的更新遵循 manifest 同步流程，理想情況下是半自動化的 agent 工作流程：拉取上游、重新應用 patch、執行閘門、以更新後的 manifest 表格開 PR）。

## 計畫

第 3 項最簡單，先做。第 1 項需要 CI 能透過網路訪問上游倉庫（私有倉庫，需要 token），並將現有兩項已記錄的修改轉換為 patch 文件。第 2 項和第 4 項是設定工作。

## 曾考慮的替代方案

- **用 `pnpm audit` 替代 osv-scanner**：兩者都滿足安全公告掃描的需求；具體選擇推遲到實作階段決定。
- **用定時 agent 任務替代 Renovate**：在提議小型更新 PR 並走完整閘門套件方面效果等價；vendor 包無論哪種方案都不在其列（它們的更新遵循 manifest 同步流程）。

## 驗收標準

- 授權條款清單指令碼在 CI 中執行，缺少 LICENSE 或 `license` 欄位與 `vendor/README.md` 中的清單矛盾時失敗。
- 夜間漂移任務從 manifest SHA 加簽入的 patch 文件重建 `vendor/`，出現任何無法解釋的 diff 時失敗。
- 安全公告掃描按計畫定期執行，並在涉及 lockfile 變更的 PR 上執行。

## 風險

上游倉庫是私有映像檔；CI 憑證與可用性是漂移檢查的主要阻力。如果受阻，可改為本機定時 agent 任務而非 CI。
