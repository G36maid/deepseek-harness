# compaction/ — 壓縮能力家族

[English](README.md) | 繁體中文

一個壓縮（compaction）能力家族（參見[能力 seam](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)）：Service Definition、摘要提供方、無模型工具結果修剪配套工具，以及使用者命令 Consumer。這些全是**產品**包。

| 包 | 職責 | ctx key |
|---|---|---|
| [`compaction/`](compaction/README.md) | 壓縮 seam 與事件詞彙 | `ctx.compaction` |
| [`compaction-basic/`](compaction-basic/README.md) | token 壓力與摘要後端 | 註冊 `ctx.compaction` |
| [`compaction-tool-result-pruner/`](compaction-tool-result-pruner/README.md) | 選填的無模型工具結果修剪 | `ctx.toolResultPruner` |
| [`command-compact/`](command-compact/README.md) | 使用者壓縮命令 | 註冊到 `ctx.commands` |

後端、選填修剪器和使用者命令透過該 seam 組合；token 測量仍是獨立的 LLM（大型語言模型）家族服務。[壓縮能力 seam Agent Note](../../.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md) 負責說明相依性關係的設計依據。

子系統參考——`compaction/*` 事件、`CompactionResult`、服務、修剪結果——見 [docs/subsystems/compaction.md](../../docs/subsystems/compaction.md)；seam 有意相依性 `dsh-session`/`dsh-llm` 的決定記錄在[壓縮能力 seam Agent Note](../../.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md)。
