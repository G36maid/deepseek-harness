# Agent Note: 將 Cordis 以原始碼形式收錄，而非作為 NPM 相依性

Status: implemented

[English](2026-06-11-vendor-cordis-as-source.md) | [简体中文](2026-06-11-vendor-cordis-as-source.zh.md) | 繁體中文

## 問題

DeepSeek Harness 建置於 Cordis 框架之上。本倉庫啟動時，Cordis core 處於 4.0.0-rc.6（一個候選發布版本）；harness 相依性框架內部實作（fiber 生命週期、dispose（資源釋放）、waterfall（瀑布式事件）分發），其確切行為直接關係到 agent loop（代理循環）的正確性保證。

## 決策

將所需的 Cordis 包（core、loader、include、group、timer、hmr、logger-console）與 cordiverse 基礎庫（cosmokit、schemastery）以原始碼形式複製到 `vendor/`，扁平化放置，保留其原始 npm 包名以實作透明的 workspace 解析。`pnpm-workspace.yaml` 設定 `linkWorkspacePackages: true`，所以只要上游 semver 範圍匹配，無論以原始碼執行還是以建置產物執行，相依性都會解析到這些固定版本的 workspace。真正的第三方相依性（js-yaml、chokidar、@standard-schema/spec 等）仍從 npm 取得。

`vendor/README.md` 是 manifest（中繼資料清單）：記錄每個包的上游倉庫和 commit SHA，以及一份詳盡的本機修改日誌。pre-commit 守衛（`scripts/check-vendor-manifest.sh`）會拒絕未在同一次提交中更新 manifest 的 vendor 原始碼變更。

## 曾考慮的替代方案

- **相依性 npm 包**：否決。core 處於候選發布階段，harness 相依性框架內部實作（fiber 生命週期、dispose、waterfall 分發），agent loop 的正確性保證取決於這些行為的確切表現；上游 RC 版本升級可能在沒有本機修復路徑的情況下破壞它們。
- **遞迴收錄所有傳遞相依性**：否決。真正的第三方相依性（js-yaml、chokidar、@standard-schema/spec 等）仍從 npm 取得；只有內部實作對我們有影響的框架層才需要自行持有。

## 後果

- harness 完全持有其框架層：可審計、可打修補程式、版本鎖定。上游 RC 無法導致本項目故障，框架 bug 可以在倉庫內直接修復。
- 建置後的包與原始碼測試執行的是同一版收錄的 Cordis；移除 workspace 連結後，建置後的包會在包名不變的情況下靜默改用 npm 副本。
- 上游同步是手動操作（流程記錄在 manifest 中）。修改日誌使 diff 範圍始終可知。
- 收錄的包保留上游程式碼風格；lint 與嚴格性閘門將其排除（它們的 tsconfig 在本機放寬了我們較新的編譯器選項）。
- 從第一天起就有一個本機修補程式：移除了 hmr 的 locale-YAML 匯入（執行時期 YAML 匯入掛鉤未被收錄）。
