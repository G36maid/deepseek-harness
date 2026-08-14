# web/：web 能力家族

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

本家族提供與提供方無關的 web 搜尋和抓取操作，以及消費這些操作的面向模型工具。

| 包 | 職責 | ctx key |
|---|---|---|
| [`web/`](web/README.md) | 定義 web 提供方註冊、選擇和共享錯誤 | `ctx.web` |
| [`web-search-exa/`](web-search-exa/README.md) | 透過 Exa 提供 web 搜尋 | 註冊到 `ctx.web` |
| [`web-search-perplexity/`](web-search-perplexity/README.md) | 透過 Perplexity 提供 web 搜尋 | 註冊到 `ctx.web` |
| [`web-search-deepseek/`](web-search-deepseek/README.md) | 提供 DeepSeek 原生 web 搜尋 | 註冊到 `ctx.web` |
| [`web-fetch-http/`](web-fetch-http/README.md) | 抓取公共 HTTP 和 HTTPS 資源 | 註冊到 `ctx.web` |
| [`tool-web/`](tool-web/README.md) | 向模型公開 web 搜尋和抓取 | 註冊到 `ctx.tools` |

[web 能力決策](../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)記錄了搜尋和抓取共用一項提供方選擇服務的原因。

子系統參考——搜尋/抓取請求與結果、可用性、`WebError`——見 [docs/subsystems/web.md](../../docs/subsystems/web.md)；依據（含延後的 SSRF 防護）見 [web 能力 seam Agent Note](../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)。
