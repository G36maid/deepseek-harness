# sdk/：從另一行程驅動 Harness 執行時期

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

本組包含用於從另一行程驅動 Harness 執行時期的協定棧。呼叫方提供執行時期可執行文件及其 `cordis.yml`；本組不建立、設定、建置或啟動開發者項目。[TypeScript SDK 決策](../../.agents/notes/implemented/feature/2026-07-27-typescript-sdk-and-sdk-subagent-backend.md)負責用戶端約定，[工具鏈移除](../../.agents/notes/implemented/simplification/2026-08-11-remove-sdk-project-toolchain.md)負責產品邊界。

| 包 | 職責 |
|---|---|
| [`protocol/`](protocol/README.md) | 定義 SDK 執行時期通訊協定 |
| [`client/`](client/README.md) | 透過 TypeScript 用戶端 API 驅動 Harness 執行時期 |
| [`server/`](server/README.md) | 透過 stdio JSON-RPC 為行程外 SDK 用戶端提供服務 |
