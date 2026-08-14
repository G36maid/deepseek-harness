# workspace/：workspace 實體家族

[English](README.md) | 繁體中文

本家族擁有持久 workspace：帶標題和有序工作階段成員關係的使用者目錄。

| 包 | 職責 | ctx 鍵 |
|---|---|---|
| [`workspace/`](workspace/README.md) | 註冊 workspace 並記錄其工作階段歸屬 | `ctx.workspaceRegistry` |

[workspace 包參考](workspace/README.md)負責生命週期、持久化和刪除語義。

子系統參考——實體、realpath 規範、註冊/解析——見 [docs/subsystems/workspace.md](../../docs/subsystems/workspace.md)；儲存設計見 [domain KV 儲存 Agent Note](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md)。
