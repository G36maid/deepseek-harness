<!-- 英文原始檔由 scripts/gen-doc-graphs.ts 生成；本中文文件是透過雙語配對維護的經評審對側。
     更新時先執行 `pnpm run gen-doc-graphs` 更新英文，再更新本文件並執行 `pnpm run verify-translation-pairing --write docs/graph-atlas.md` 重新記錄配對。 -->

# 文件圖索引

[English](graph-atlas.md) | 繁體中文

這些圖展示生成目錄未包含的關係。可以用它們尋找包之間的關係、能力 seam、事件串流、面向模型的工具、應用組合和執行時期生命週期路徑。精確簽名和類型定義仍以[子系統頁面](subsystems/core.md)（類型和生成的 `cordis-surface` 區域）及[工具目錄](tool-catalog.md)為準。

本索引背後的流程決策記錄在[文件圖 Agent Note](../.agents/notes/archived/process/2026-07-03-documentation-graph-atlas.md)中。

| 圖 | 模式 |
| --- | --- |
| [模組相依性圖](module-graph.md) | `generated` |
| [工具 schema 目錄與包對映](tool-catalog.md) | `generated` |
| [能力 seam 與核心服務](capability-seams.md) | `hybrid generated` |
| [dsh 共享基礎組合](../apps/cli/composition.md) | `hybrid generated` |
| [headless-agent 應用組合](../examples/headless-agent/composition.md) | `hybrid generated` |
| [acp-agent 應用組合](../examples/acp-agent/composition.md) | `hybrid generated` |
| [事件生產方／消費端矩陣](event-producer-consumer.md) | `hybrid generated` |
| [agent（代理）輪次與步驟生命週期](agent-lifecycle.md) | `curated` |
| [工具執行管線](tool-execution-pipeline.md) | `curated` |

執行 `pnpm run gen-doc-graphs` 可重新生成英文原始檔；執行 `pnpm run verify-doc-graphs` 可驗證英文源的新鮮度，中文對側則透過雙語配對維護。

英文原始檔的維護模式為混合。每個連結頁面都會聲明其英文源模式為生成、混合或人工編寫；本中文文件是透過雙語配對維護的經評審對側。
