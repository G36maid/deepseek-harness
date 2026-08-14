# api/：Remote API 層

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

面向應用的 Remote 技術棧。`remotes` 負責 BFF 策略和選定的業務 API，`gateway` 則實作 Host 與 Client 環境共用的 Typert 一元 RPC endpoint。

| 包 | 職責 | ctx key |
|---|---|---|
| [`remotes/`](remotes/README.md) | Host Agent/Session lookup 策略與 Client Remote contribution 裝配 | 無服務；設定 `ctx.typert` 並消費 `ctx.remote` |
| [`gateway/`](gateway/README.md) | Host Typert 分發器與 Client Remote endpoint | `ctx.typertGateway` / `ctx.remote` |

執行時期相依性方向為 `remotes → gateway → connection → webserver`：BFF 消費共享的 `TypertClientRemote` 約定，Gateway 把傳輸交給 Connection，Connection 再掛載到 HTTP server。Cordis 服務注入與 Client 模組元資料在不讓 Remotes Client 入口匯入具體 Gateway 實作的前提下維持該順序。

## 已知限制與延期工作

- Connection 與 WebServer 仍位於 [`client/connection`](../client/connection/README.md) 和 [`host/webserver`](../host/webserver/README.md)；後續可以只移動包，將它們放到 `api/connection` 和 `api/webserver` 下，而無需改變服務約定。
- 舊 API Proxy 仍位於 [`host/apiproxy`](../host/apiproxy/README.md)，作為尚未遷移到 Remote 的方法的回退路徑。它使用由 `api-remotes` 持有的 Host resolver，使已遷移與舊方法共用同一套 Agent/Session 身份策略。
