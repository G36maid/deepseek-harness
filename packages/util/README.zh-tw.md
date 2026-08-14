# util/：底層共享工具

[English](README.md) | 繁體中文

這些零相依性包提供由多個能力家族共享的小型原語。業務語義仍歸各個消費這些原語的能力所有。

| 包 | 職責 |
|---|---|
| [`brand/`](brand/README.md) | 提供帶名義品牌的類型 |
| [`paths/`](home-paths/README.md) | 解析 Harness 資料根目錄和共享路徑 |
| [`timeout/`](timeout/README.md) | 提供截止時間和逾時分類原語 |
| [`retention/`](output-retention/README.md) | 限制保留文字和項集合的大小 |
| [`atomic-write/`](atomic-write/README.md) | 以原子方式替換文件 |
| [`native-command/`](native-command/README.md) | 不經 shell 執行宿主原生命令 |
