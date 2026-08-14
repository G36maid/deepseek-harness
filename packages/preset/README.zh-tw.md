# preset/：按工作階段組裝 agent

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

**agent preset** 是一個目錄，其中放置一份 `agent.cordis.yml`。把它掛載到某個 agent（代理）的 scope 上下文之下，該工作階段就獲得自己的工具與提示詞段落，而其他在執行的工作階段各自保持不變，因此一個行程可以同時執行多個組裝方式不同的 agent。

| 包 | 職責 | ctx 鍵 |
|---|---|---|
| `agent-presets/` | preset 詞彙體系、對受信任根目錄和使用者自訂根目錄的檔案系統發現，以及受防護的按 agent 掛載 | `ctx.agentPresets` |
| `persona/` | 把 agent 人設做成可組裝的行，使 preset 不止能改工具、也能改身份 | — |

部署交付哪些 preset，看 [`apps/cli/config/agent-presets/`](../../apps/cli/config/agent-presets)——一個 preset 一個目錄，那份目錄清單就是清單。在這裡再列一遍只會多出一份需要同步的名單，而且總是它先過時。

本組假定的組裝劃分是：登錄檔與跨工作階段設施是行程單例，留在宿主組裝中；preset 只承載單個 agent 對它們的貢獻。若 preset 中某一行發布了行程級全域性服務，掛載時即被拒絕，而不是留到與下一個工作階段相撞。

設計詳見 [按工作階段組裝 agent preset 的 Agent Note](../../.agents/notes/implemented/architecture/2026-08-03-per-session-agent-presets.md)。
