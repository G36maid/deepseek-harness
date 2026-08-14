# Agent Note: dsh-hooks-claude-code + dsh-hooks-codex —— Claude Code / Codex 掛鉤橋接外掛程式

Status: implemented

[English](2026-06-30-hook-bridges.md) | [简体中文](2026-06-30-hook-bridges.zh.md) | 繁體中文

## 問題

harness 的擴充面是其類型化攔截點（見[攔截擴充點 Agent Note](2026-06-30-interception-extension-points.md)）：所謂「原生掛鉤」不過是一個普通的 Cordis 外掛程式，訂閱 `agent/session-start`、`agent/pre-step`、`tools/pre-execute`、`tools/post-execute`、`agent/turn-stopping`、`subagent/start` 或 `subagent/end`。但使用者帶著**既有的** Claude Code（CC）和 Codex 掛鉤設定到來，一個 `hooks.json`（或 settings 文件中的 `hooks` 鍵）裡滿是 shell 命令掛鉤，並希望它們原樣執行。本 Agent Note 引入兩個**橋接外掛程式**，將外部 shell 掛鉤協議翻譯到類型化擴充點上，建置於共享的協定格式（wire format）庫之上（見 [hook-protocol-lib Agent Note](2026-06-30-hook-protocol-lib.md)）。

核心規則是：**橋接是相容性配接器，不是進階工具。** 橋接能做的事（阻止工具、注入上下文、強制繼續、觀察 subagent），原生 Cordis 外掛程式都能做得更強——類型化回傳值、完整 `ctx`、無序列化邊界。橋接存在的理由是執行外部 CC/Codex 命令掛鉤中被明確支持的子集。這使每個橋接保持精簡：解析設定、選擇匹配模式、建置每事件的 payload、呼叫共享庫的 `runHook` + `mergeHookOutputs`，再將中性結果對映為類型化 Decision。各包的 README 維護著當前不支持的事件和部分支持的欄位的完整清單，以官方協議為參照。

## 決策

`packages/hooks/` 組下兩個獨立外掛程式，各為 function/namespace 外掛程式（`name`/`inject`/`Config`/`apply`，無 default export——見[事後檢討（postmortem）0001](../../../../docs/postmortem/0001-acp-default-export-drops-inject.md)），僅注入 `bash`：

- **`dsh-hooks-claude-code`**——CC 方言。Claude Code 當前掛鉤點中的七個：`SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop`、`SubagentStart` 和 `SubagentStop`。負責建置 CC 形態的逐事件 stdin payload（基礎欄位 `session_id`/`transcript_path`/`cwd`/`hook_event_name` 加每事件欄位）、`CLAUDE_PROJECT_DIR` 環境變數加 `${CLAUDE_PLUGIN_ROOT}`/`${CLAUDE_PROJECT_DIR}` 替換，以及字面量或正則的匹配模式。`transcript_path` 是持久化定位器結果或 `''`；stdin 帶有**尾部換行**。
- **`dsh-hooks-codex`**——Codex 當前掛鉤點中的五個：`PreToolUse`、`PostToolUse`、`SessionStart`、`UserPromptSubmit` 和 `Stop`。它使用始終按正則解釋的 matcher，輸出 Codex 形態的 snake_case payload（含 `turn_id`/`model`/`permission_mode` 額外欄位）且寫入時不帶尾部換行，不注入 Codex 外掛程式環境變數，不做設定時佔位符替換，也沒有 pre-tool 審批或重寫路徑。`transcript_path` 是同一定位器結果或 `null`；工具 payload 在精簡後的 `tool_input: { command }` 形態中攜帶真實的 `tool_name`。

### Outcome → Decision 對映

每個橋接將共享庫返回的中性 `MergedHookOutcome` 對映到各擴充點的類型化 Decision：

| 擴充點 | CC | Codex |
|---|---|---|
| `agent/session-start`（emit） | additionalContext → `agent.inject()` | 純 stdout 輸出 → additionalContext → `agent.inject()` |
| `agent/pre-step` | `deny`→`reject`；僅上下文→委託並摺疊到 `enter` | `block`→`reject`；僅上下文→委託並摺疊到 `enter` |
| `tools/pre-execute` | `deny`→`deny`；`ask`→`ask` | `block`→`deny`（無 allow/ask） |
| `tools/post-execute` | `deny`→`block`+回饋；僅上下文→委託並摺疊 | 同上 |
| `agent/turn-stopping` | 阻塞的 Stop → 下一步 steering（中途引導） | 同上 |
| `subagent/start`（emit） | additionalContext → 注入到存活的行程內 subagent；遠端 subagent 無本機注入目標 | 本橋接不支持 |
| `subagent/end`（emit） | 僅觀察 | 本橋接不支持 |

CC 橋接的 `ask` 結果是一條真正的權限路徑，而非終態橋接決策：`dsh-tools` 透過選填的[審批 seam](2026-07-06-approval-seam.md) 來解析它。ACP（Agent Client Protocol）自動化用戶端可以應答所屬工作階段的一次性機器策略請求，`allowed-once` 後繼續執行；如果沒有 ApprovalService 或應答器，呼叫以 `deny` 安全關閉。

### 上下文來源始終是外掛程式（誤標籤防護）

每個橋接的 `inject()` 和 additional-context 輸入都顯式傳入 `{ kind: 'plugin', plugin: 'hooks-claude-code' | 'hooks-codex' }`。單元測試固定驗證結果中的 `user/message.source` 為外掛程式而非使用者。

`UserPromptSubmit` 在 `turn/start` 之後的 pre-step 執行，因此每次呼叫都會寫入輪次範圍的 `hook/invoked` / `hook/result` 對。拒絕會使已領取的輸入維持移除狀態，將輪次關閉為已阻止狀態且不包含步驟，並保留該掛鉤對作為持久決策證據。Codex payload 會收到這個已打開輪次的 `turn_id`。

### 新增上下文不是否決——先 delegate，再 prepend

僅附加 `additionalContext`（沒有 block/deny）的掛鉤並不是橋接可以獨自返回的決策：在 waterfall（瀑布式事件）監聽器中不呼叫 `next()` 就返回 `enter`，會短路其後的每個 `agent/pre-step` / `tools/post-execute` 監聽器，使註冊在橋接之後的策略/沙盒外掛程式看不到該提示詞。因此，每個橋接都會先透過 `next()` 委託，再將自身上下文加入下游 enter 決策。橋接會保留所有下游訊息；下游 pre-step reject 會丟棄整個已領取批次，因為步驟從未打開。工具後決策仍保留獨立的有序 `additionalContexts` 語義，包括 Code Mode 透過外層 `run_code` 結果延遲上下文。只有掛鉤本身真正返回 `deny`/`block` 才會短路。測試斷言：僅上下文掛鉤之後，較晚的監聽器仍能 reject 提示詞，且保留的提示詞和工具後上下文仍彼此分離。

### CLAUDE_PROJECT_DIR 預設為工作階段工作區

Claude Code 始終匯出 `CLAUDE_PROJECT_DIR`，常見的未修改掛鉤引用 `$CLAUDE_PROJECT_DIR` 來構造項目相對路徑。顯式的 `config.projectDir` 優先；當它被省略時（默認 ACP 接線只設定 `configPath`），橋接將該環境變數按每次執行預設為 agent（代理）的工作階段工作區——即掛鉤已經在其中執行的 `session.header.cwd`——而非留空。這樣，一個標準的項目相對路徑掛鉤在預設配置下即可正常工作。

### 隔離

設定在載入時一次性解析；讀取/解析失敗時記錄日誌並不註冊任何內容，而非導致啟動崩潰（一個拼錯的路徑不應拖垮 agent）。CC 橋接只執行 shell 形式的 `type: 'command'` 掛鉤；`http`、`mcp_tool`、`prompt` 和 `agent` 處理器被解析後跳過。Codex 橋接只執行同步命令處理器，跳過 `async: true` 或非命令條目。emit 監聽路徑（`session-start`、`subagent/start`）以 detached 方式執行，其 `inject` 包裹在 `.catch` 中記錄日誌（拋例外的 inject 不得中斷工作階段啟動或迴圈）。

### 掛鉤在哪裡執行，設定從哪裡來

掛鉤在 agent 的工作階段工作區中執行，因此相對路徑指向使用者的項目。`configPath` 相對於行程啟動時的 cwd 解析一次，適用於所有工作階段。按工作階段的項目本機發現仍推遲在 `TODO(per-session-hook-config)` 下。

## 推遲的相容性缺口

- **工具輸入重寫。** CC/Codex 的 `updatedInput` 被記錄日誌並行出警告，但不予執行——輸入重寫是一個推遲的一致性設計問題（見 [pre-tool-input-rewrite Agent Note](../../proposed/feature/2026-06-30-pre-tool-input-rewrite.md)），因為 pre-execution 參數被 `tool/call` 審計、`assistant/message` 歷史和工具展示共同讀取，誠實的重寫是一個設計單元，而非一個欄位。
- **Stop 迴圈防護**（`TODO(stop-loop-guard)`）。Claude Code 提供 `stop_hook_active` 並在連續八次阻塞後覆蓋掛鉤；Codex 提供 `stop_hook_active` 但未記錄等效上限。兩個橋接始終報告 `false`，因此一個無條件阻塞的 Stop 掛鉤會在每一步強制繼續——在狀態追蹤落地之前，掛鉤作者必須自行限制。
- **掛鉤 `continue:false`（硬停止）。** 掛鉤可以請求終止整個執行（CC/Codex `continue:false`）；共享合併將其摺疊為 `MergedHookOutcome.stop`/`stopReason`，但沒有橋接對其採取行動（`TODO(hook-continue-false)`）——攔截點尚無「硬停止 agent」原語（Decision 阻塞/引導的是單個點，而非整個執行）。與迴圈防看護作一同推遲；輪中請求會將停止請求記錄在 `hook/result` 中，掛鉤在此期間保留其逐點效果（決策/上下文）。
- **設定發現。** 路徑在 `cordis.yml` 中顯式指定且為行程級（見上文）；完整的多層 CC/Codex 優先級遍歷、按工作階段的項目本機發現以及信任/hash 模型未被重新實作（`TODO(per-session-hook-config)`）。
- **Session-start / subagent-start 上下文為盡力而為（`TODO(session-start-gating)`）。** 兩個掛鉤以 detached 方式執行，不阻塞啟動流程，因此其上下文在就緒時注入，但可能錯過首個請求或短命的 subagent。要保證首請求送達，需要一個 awaited 的啟動擴充點。

## 曾考慮的替代方案

**每點掛鉤並行執行。** 參考引擎對一個點匹配到的掛鉤並行執行並摺疊結果。本橋接**序列**執行（匹配迴圈內每個掛鉤 `await`），並以相同的最嚴格合併策略摺疊。序列是刻意的：對輪次範圍的攔截點，它使每個掛鉤的 `hook/invoked`/`hook/result` 對相鄰且順序確定，而摺疊對決策是順序無關的（`deny > ask > allow`），因此結果一致。代價是延遲（掛鉤 *N* 等待掛鉤 *N−1*）以及每掛鉤逾時不重疊——對真實設定中的掛鉤數量可以接受；如果某設定的扇出大到影響總耗時，再重新評估。

## 後果

匹配語義、退出碼處理和合併優先級位於 `dsh-hook-protocol`；每個橋接只負責解析設定、建置方言 payload 和對映結果。逐文件覆蓋率包含設定分支以及透過真實迴圈、`dsh-bash-local` 和 shell 指令碼的端到端對映，同時一個真實 Loader 冒煙測試守護包的匯出形態。原生外掛程式繞過協定格式，直接返回類型化決策。
