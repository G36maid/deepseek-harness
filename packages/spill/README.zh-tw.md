# spill/：工具輸出 spill 能力家族

[English](README.md) | 繁體中文

本家族持久化過大的工具輸出，並以有界預覽和取回定位資訊替換內聯結果。

| 包 | 職責 | ctx 鍵 |
|---|---|---|
| [`spill/`](spill/README.md) | 定義 spill 儲存 | `ctx.spillStore` |
| [`spill-local/`](spill-local/README.md) | 在工作階段範圍的本機文件中儲存 spill 文字 | 註冊到 `ctx.spillStore` |
| [`spill-policy/`](spill-policy/README.md) | 應用執行後 spill 策略 | 監聽 `ctx.tools` |

參見[工具輸出 spill 決策](../../.agents/notes/implemented/architecture/2026-07-08-tool-output-spill-files.md)，其中記錄了儲存、保留和工具自有輸出處理之間的邊界。

子系統參考——`SaveTextSpill`、所有者/來源、品牌化定位符——見 [docs/subsystems/spill.md](../../docs/subsystems/spill.md)；依據見[工具輸出 spill Agent Note](../../.agents/notes/implemented/architecture/2026-07-08-tool-output-spill-files.md)。
