# @deepseek-ai/dsh-acp-demo

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

ACP（Agent Client Protocol）自動化伺服器應用：預設 agent（代理）主幹、用戶端透過 [`@deepseek-ai/dsh-acp`](../../acp/acp/README.md) 建立的 agent、JSONL 持久化，以及語義檢查點機制，並透過一個 JSON-RPC stdio bin 對外提供服務。程序化用戶端建立新工作階段；此包不掛載人工互動 UI。

## 組合

| 外掛程式 | 角色 |
|---|---|
| `@deepseek-ai/dsh-agent-spine-demo` | 不含提供方且不預建立 agent 的 agent 主幹；`session/new` 建立每個 agent。 |
| `@deepseek-ai/dsh-session-persistence-jsonl` | 檢查點、可觀測性和快照重播所使用的持久工作階段日誌。 |
| `@deepseek-ai/dsh-session-checkpoint-policy` | 在模型呼叫和頂層工具 effect 前建立持久性屏障，並為已完成步驟建立檢查點。 |
| `@deepseek-ai/dsh-session-query-sqlite` | 派生的精確／FTS 工作階段查詢服務；先於 ACP 傳輸打開，使葉節點消費端在首次模型請求前就緒。 |
| `@deepseek-ai/dsh-acp` | 透過 stdin／stdout 提供的純自動化 ACP 傳輸。 |

應用不安裝命令、使用者互動、工作階段導覽、設定選擇器或 stdout logger。它透過一個有序 effect 擁有這些外掛程式，因此查詢服務會在 ACP 接受工作前就緒，而 ACP 工作階段會在檢查點與持久化外掛程式解除安裝前完全靜止。葉節點設定負責提供 LLM（大型語言模型）、執行器、沙盒、審批、檔案系統和麵向模型的工具外掛程式。

## 設定

| 鍵 | 預設值 | 路由目標 |
|---|---|---|
| `provider` | 必填 | 每個由 ACP 建立的 agent 所用的提供方路由。 |
| `model` | 必填 | 每個由 ACP 建立的 agent 所用的模型。 |
| `maxParallelToolCalls` | agent loop（代理循環）預設值 | 正整數工具呼叫並行上限；`1` 表示序列。 |
| `persona` | 無 | 供 `dsh-system-prompt` 使用的部署 persona 樣板。 |
| `toolOrder` | 字典序 | 供 `dsh-system-prompt` 使用的顯式面向模型工具順序。 |
| `tools` | `{ mode: 'native' }` | Native、Code Mode 或組合式模型工具傳輸。 |
| `dshHome` | `$DSH_HOME` 或 `~/.dsh` | bash 與本機 skill（技能）發現共享的 harness 主目錄。 |
| `sessionTitle` | 主幹示例限制 | 持久後備標題限制；標題仍不會進入 ACP wire。 |
| `persistenceRoot` | `./.sessions` | JSONL 後端根目錄，以及派生 `session-query.db` 索引的父目錄。 |
| `packChunks` | `true` | 在儲存中打包連續的增量區塊事件。 |
| `persistenceCompression` | `zstd` | 帶校驗和的 Zstandard 幀，或原始 `none`。 |
| `workspaceContext` | 必填 | 工作區指令位元組預算／設定，或 `false`。 |
| `skills` | 擁有者預設值 | skill 登錄檔、本機提供方和麵向模型的 skill 工具。 |
| `toolBash` | 擁有者預設值 | 面向模型的 bash 工具設定。 |
| `jobs` | `{ maxConcurrentJobsPerOwner: 10 }` | 行程內按 owner 限制活動任務的准入設定。 |
| `toolJobs` | 擁有者預設值 | 通用背景工作控制設定，或 `false`。 |
| `goals` | 擁有者預設值 | 持久化的同工作階段目標領域與模型工具，或 `false`。 |

已交付的 [`examples/acp-agent/cordis.yml`](../../../examples/acp-agent/cordis.yml) 新增 DeepSeek 配接器、沙盒化 bash 與檔案系統提供方、一次性審批策略、壓縮（compaction）、subagent、工作流程、掛鉤，以及面向模型的工具。應用提供派生工作階段查詢索引，而面向模型的查詢消費端仍由葉節點顯式選用。快照 overlay 只替換非確定性提供方或策略值。

## Bin

`dsh-acp-demo [--config path-to-cordis.yml]`（短形式 `-c`；預設為 `./cordis.yml`）會載入 gitignore 排除的 `.env`，重播模式除外；`DSH_SNAPSHOT=replay` 選擇同級 `cordis.snapshot.yml`；stdin EOF 會在結束前 dispose（資源釋放）上下文並刷新工作階段。Loader 已安裝的選填對等相依性（peer dependency）`node-addon-require-builtin` 使純 Node 下建置後的 bin 可以解析裸外掛程式說明符。診斷使用 stderr，因為 stdout 是 ACP wire。

## 模型體驗

模型體驗由 `dsh-agent-spine-demo` 和葉節點的面向模型外掛程式間接提供。ACP 提示詞文字會成為普通的已記錄使用者訊息；協定中繼資料與權限選擇不會進入模型請求。

#### KV Cache 影響

每個工作階段僅附加；應用本身不新增請求前綴內容。

## 已知限制與暫緩事項

- **JSONL 持久化固定不變**：使用其他後端需要另一種組合。
- **同級外掛程式可能破壞 stdout**：應用無法阻止另一個 Cordis 設定項寫入非協定位元組。
- **只支援新建自動化工作階段**：復原和人工互動屬於其他執行入口。
