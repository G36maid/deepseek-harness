# storage/：非工作階段儲存家族

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

本家族透過具名後端和類型化資料形式，持久化工作階段事件日誌以外的應用資料。

| 包 | 職責 | ctx key |
|---|---|---|
| [`storage/`](storage/README.md) | 將已註冊後端與類型化資料形式連線起來 | `ctx.storage` |
| [`storage-json/`](storage-json/README.md) | 在 JSON 文件中儲存資料 | 註冊後端 `json` |
| [`storage-sqlite/`](storage-sqlite/README.md) | 在 SQLite 中儲存資料 | 註冊後端 `sqlite` |
| [`storage-domain/`](storage-domain/README.md) | 提供經過驗證的領域記錄儲存 | `ctx.storageDomain` |

消費端使用資料形式，而不是直接訪問後端。[領域儲存決策](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md)記錄了該家族的設計。

子系統參考——後端約定、`StorageForms`、`DomainSpec`/`Domain`、`domain/changed`——見 [docs/subsystems/storage.md](../../docs/subsystems/storage.md)。
