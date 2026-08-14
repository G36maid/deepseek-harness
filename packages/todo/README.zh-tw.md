# todo/：todo／規劃能力家族

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

面向模型的 todo 能力。它是單一**產品**包，因為一個 agent（代理）工作階段擁有該清單；不存在可替換的提供方約定。

| 包 | 職責 | ctx 鍵 |
|---|---|---|
| [`tool-todo/`](tool-todo/README.md) | 儲存並公開工作階段的 todo 清單。 | （註冊到 `ctx.tools`） |

子級 README 負責工具、持久化和渲染約定。

事件載荷記錄在 [docs/subsystems/session.md](../../docs/subsystems/session.md)。
