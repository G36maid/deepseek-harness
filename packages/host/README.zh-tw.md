# host/ — Web GUI 宿主側

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

dsh Web GUI 的宿主側：所有用戶端形態共享的 API 閘道，以及承載它的普通 HTTP 伺服器。瀏覽器側位於 [`client/`](../client/README.md)；組合應用是 [`apps/cli`](../../apps/cli/README.md)，它啟動 [`dsh-base` 組合包](../bundle/base/cordis.patch.yml) 來提供 [`apps/web`](../../apps/web/)。這些全是**產品**包。

| 包 | 職責 | ctx key |
|---|---|---|
| [`apiproxy/`](apiproxy/README.md) | 共享宿主 API 閘道和協定約定 | `ctx.apiProxy` |
| [`webserver/`](webserver/README.md) | HTTP 路由載體 | `ctx.webServer` |
| [`frontend-static/`](frontend-static/README.md) | 佔據 webserver 回退席位的 SPA dist 伺服器 | 消費 `ctx.webServer` |
| [`directory-picker/`](directory-picker/README.md) | 工作區目錄選擇 seam | `ctx.directoryPicker` |
| [`directory-picker-native/`](directory-picker-native/README.md) | 原生目錄選擇器後端和瀏覽器互動 | 註冊 `ctx.directoryPicker` |
| [`directory-picker-browse/`](directory-picker-browse/README.md) | 應用內目錄瀏覽器後端和互動 | 註冊 `ctx.directoryPicker` |
| [`directory-picker-auto/`](directory-picker-auto/README.md) | 宿主自適應選擇器組合 | 掛載一個後端 |
| [`plugin-inventory/`](plugin-inventory/README.md) | 當前 Loader 條目的只讀投影 | Remote `pluginInventory/list` |

`apiproxy` 保持傳輸無關；[`client/connection`](../client/connection/README.md) 提供瀏覽器／HTTP 載體。選擇器實作可在共享 seam 後互相替換。

子系統參考：[web-server.md](../../docs/subsystems/web-server.md) 與 [workspace.md](../../docs/subsystems/workspace.md)（選擇器 seam）。
