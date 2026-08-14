# boot/：共享的 app bin 啟動粘合層

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

由 `apps/cli` 和 [`examples/`](../examples/README.md) demo bin 共享、與渠道無關的啟動庫。

| 包 | 職責 | ctx 鍵 |
|---|---|---|
| `app-boot/` | app bin 的共享啟動粘合層：載入 `.env`、會明確報錯的 Loader 保護機制、感知快照的設定解析，以及等待整棵樹停穩的啟動序列 | （供各 bin 使用的庫） |
| `cmdline/` | 啟動器到應用的命令列交接，以及由應用持有的啟動解析 | `cmdlineArgs`、`appExit` |

啟動序列與個人設定約定見 [`app-boot/README.md`](app-boot/README.md)；由應用持有的命令列見 [`cmdline/README.md`](cmdline/README.md)。
