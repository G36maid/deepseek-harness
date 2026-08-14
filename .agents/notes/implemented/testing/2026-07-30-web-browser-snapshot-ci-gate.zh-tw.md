# Agent Note: Web 瀏覽器預期輸出的必需 CI 閘門

Status: implemented

[English](2026-07-30-web-browser-snapshot-ci-gate.md) | [简体中文](2026-07-30-web-browser-snapshot-ci-gate.zh.md) | 繁體中文

## 問題

[無金鑰 Web 瀏覽器 e2e 車道](2026-07-24-web-gui-browser-e2e-lane.md)只由本機 `pnpm run test:web` 執行，PR CI 不比較 `apps/web/tests/snapshots/**/*.expected.md`。因此，改變使用者可見 Web 輸出的 PR 可以在漏刷預期輸出時保持綠色；後來任意分支顯式執行 `DSH_SNAPSHOT=refresh`，都會替前序變更補帳並產生與本分支無關的 diff。普通本機執行已經默認使用只讀 replay，缺口是 PR 級的強制執行，而不是禁止 refresh 寫入。

## 決策

Linux PR 的 `node 24 / snapshots and artifacts` 必須執行完整 Web 瀏覽器 replay/compare。`scripts/run-gates.ts` 把 `test:web:built` 作為 `ci-consumers` 的一個 gate，並顯式注入 `DSH_SNAPSHOT=replay`；CI 永不以 `record` 或 `refresh` 模式執行，因此提交的 golden 與當前組裝應用不一致時測試直接失敗，不會在 runner 內靜默改寫後透過。

消費端 job 在[消費端獨立建置](../process/2026-07-30-independent-ci-consumer-build.md)中負責唯一一次 Linux 建置，因此 `apps/web/dist` 和包的 `lib/` 目錄會保留在其工作區中，供瀏覽器套件使用。在託管執行器上，CI 按鎖定檔中的 Playwright 版本安裝 Chromium 及其系統相依性。在持久化故障切換 VM 上，映像檔負責預裝 Linux 系統套件，CI 只安裝 Chromium，避免每次執行都透過 `apt` 改動系統。託管的默認分支 Linux 序列 job 執行該套件，並生成以作業系統和鎖定檔為鍵的瀏覽器快取；PR 復原該快取，使必需路徑無需承擔壓縮和上傳開銷，並可在鎖定檔變化時按作業系統前綴回退。自託管熱備執行相同的比較，但不執行託管快取操作。

本機 `pnpm run test:web` 仍先建置再執行完整的瀏覽器套件；`test:web:built` 是已有建置產物的執行入口。開發者只在確認使用者可見輸出有意變化後顯式執行 `DSH_SNAPSHOT=refresh pnpm run test:web`，評審每一處預期輸出 diff，再以 replay 模式複驗不再寫文件。

對 PR 而言，閘門僅在 Linux 消費端 job 中執行：這些場景面向 POSIX，其他 PR job 不安裝 Chromium。託管和自託管的默認分支 Linux 序列聚合作業也包含該比較，而 macOS 和 Windows 序列 job 仍不使用瀏覽器。PR 的 `all checks passed` 已相依性消費端 job，因此瀏覽器比較失敗會阻止合併，無需新增 branch-protection check 名稱。

一次自託管消費端執行中，`web-snapshot` 實測耗時 112.15 秒，完整消費端聚合實測耗時 114.97 秒。gate 調度器會在 `built-package-invariants` 成功後立即啟動它，並行執行彼此獨立的 gate，因此既不需要專用 job 逾時，也不需要手動制定 YAML 順序規則。

## 曾考慮的替代方案

**繼續只要求本機執行。** 已否決：執行相依性開發者記憶，正是過時 golden 跨 PR 漂移的原因，不能保證產生行為變化的 PR 自己攜帶預期輸出 diff。

**讓 CI 以 `refresh` 模式執行後檢查工作樹。** 已否決：寫後比較把斷言機制變成生成器，若工作樹檢查接入有誤，就可能把回歸變成能夠透過的預期輸出更新；replay 直接比較已有 golden，失敗面更小。

**新建獨立 browser job 並重新建置全倉。** 已否決：它會重複相依性安裝和發布建置。現有 Linux 消費端 job 已負責該建置，並已被統一的 required verdict 聚合。

**用 jsdom 快照代替真實 Chromium。** 已否決：jsdom 不覆蓋瀏覽器、HTTP/SSE 承載及真實用戶端外掛程式包的組合；它仍可用於快速的下層回饋，但不能替代組裝後的瀏覽器鏈路。

## 後果

每個 PR 都在合併前證明當前 Web 組裝與所有已提交的瀏覽器預期輸出一致，漏刷從“後續 PR 的無關變化”變成引入 PR 自己的失敗。成本是消費端 job 需要安裝 Chromium，並序列執行一輪瀏覽器場景；消費端獨立建置與瀏覽器快取避免重跑時重複建置和下載。閘門仍不聲稱跨平臺瀏覽器一致性，Playwright/Chromium 升級若改變 ARIA 格式，升級 PR 必須顯式 refresh 並評審 churn。
