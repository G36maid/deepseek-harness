# bundle/ — profile 外掛程式組合包

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

Profile 組合包：在 manifest（中繼資料清單）中聲明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 的 npm 包，因此可作為 patch 層安裝進 `dsh --profile` 組合（[profile 約定](../boot/app-boot/README.md#profiles)）。組合包的實體是它的 patch 清單；有些組合包還附帶由其 patch 掛載的執行時期粘合外掛程式。

| 包 | 職責 | ctx key |
|---|---|---|
| [`base/`](base/README.md) | 每個 profile 最先應用的共享 dsh 核心 | —（僅 patch） |
| [`web-app/`](web-app/README.md) | 瀏覽器表層：web patch 層 + 執行時期粘合外掛程式 | 掛載多條設定行 |
| [`headless/`](headless/README.md) | 直接執行在 base 之上的一次性任務模式，不含 Host 或 Web 層 | 掛載 `headless-runner` |

內建組合包從 dsh 安裝目錄解析；樹外（out-of-tree）組合包透過 `dsh plugin --profile <name> add <package>` 安裝進 profile。
