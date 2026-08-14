# @deepseek-ai/dsh-hooks-claude-code

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

一個 Cordis 外掛程式，在 harness 的規範攔截點上執行使用者現有 **Claude Code** hook 設定（`hooks.json` 或 settings 文件的 `hooks` key）中受支援的 command hook 子集。它是 hooks 子系統的 **CC 方言**部分，負責橋接中 CC 格式的逐事件 stdin payload、CC 的 env 和 `${CLAUDE_PLUGIN_ROOT}`／`${CLAUDE_PROJECT_DIR}` 替換，以及將 hook 的中性結果對映為 harness 的類型化 Decision。方言無關原語（matcher、結束碼／stdout codec、`ctx.shell` 執行、最嚴格合併、`hook/*` 事件）來自 [`@deepseek-ai/dsh-hook-protocol`](../hook-protocol/README.md)。

原生 Cordis 外掛程式可以完成此橋接的所有工作，功能更強，且具有類型化返回，沒有序列化邊界。**該橋接只是已對映 CC command hook 子集的相容路徑**；所有訂製行為都應當使用相同擴充點上的原生外掛程式（見 [攔截擴充點 Agent Note](../../../.agents/notes/implemented/feature/2026-06-30-interception-extension-points.md)）。

## 設定

```ts
import type { Config } from '@deepseek-ai/dsh-hooks-claude-code'
const config: Config = {
  configPath: '/path/to/hooks.json', // required: a hooks.json or a settings file with a `hooks` key
  pluginRoot: '/path/to/plugin',     // optional: replaces ${CLAUDE_PLUGIN_ROOT} in command strings
  projectDir: '/path/to/project',    // optional: replaces ${CLAUDE_PROJECT_DIR} AND sets the hook env var; defaults to the session cwd when omitted
  defaultTimeoutMs: 600_000,         // optional: per-hook timeout when a hook sets none (CC default)
  stderrSummaryMaxChars: 500,        // optional: char cap on the hook/result event's persisted stderr summary
}
```

在 `cordis.yml` 中：

```yaml
- dsh-hooks-claude-code:
    configPath: ./.claude/hooks.json
    pluginRoot: ./.claude/plugins/my-plugin
    projectDir: .
```

設定只在載入時解析**一次**。`configPath` 是**行程級**設定：相對路徑在載入時根據行程啟動 cwd 解析，因此一份設定應用於整個行程。尚未進行每工作階段（`session/new.cwd`）設定發現（`TODO(per-session-hook-config)`）。讀取／解析失敗會被隔離處理，其中包括實際消費 matcher 的事件所帶的無效 matcher 正則（會報告其 pattern 與事件）：橋接記錄警告且不註冊任何內容，而不是使啟動崩潰（路徑拼寫錯誤不應使 agent（代理）停止）。只執行 shell 形式 `type: 'command'` hook；`http`／`mcp_tool`／`prompt`／`agent` hook 會被解析並跳過，同時記錄警告。沒有每 hook `timeout` 的 hook 會使用協定參考預設值 `DEFAULT_HOOK_TIMEOUT_MS`（來自 `dsh-hook-protocol`，10 分鐘，即 CC 預設值）。

hook **本身**會在 agent 的工作階段工作區中執行：對 agent scope 點，橋接會將工作階段 `cwd`（`session/new.cwd`）作為 hook 行程工作目錄，因此 hook 的 `pwd`／相對路徑／marker 作用於使用者項目樹，而非伺服器啟動目錄。

## Hook 點 → 類型化 Decision

| CC hook | Harness 點 | 對映 |
|---|---|---|
| `SessionStart` | `agent/session-start`（emit） | additionalContext → `agent.inject()` 到新工作階段（無法阻塞） |
| `UserPromptSubmit` | `agent/pre-step`（waterfall（瀑布式事件）） | `deny` → `PreStepDecision.reject`；僅 additionalContext → 透過 `next()` 委託，再向下游 `enter` 決策追加一條單獨標記來源的訊息（後續外層 listener 仍可 reject／改寫） |
| `PreToolUse` | `tools/pre-execute`（waterfall） | `deny` → `PreToolDecision.deny`；`ask` → `PreToolDecision.ask` |
| `PostToolUse` | `tools/post-execute`（waterfall） | `deny` → 帶回饋的 `block`；僅 additionalContext → 透過 `next()` 委託，再將一個單獨標記源的上下文前置到下游決策；Code Mode 將子呼叫上下文延遲到外層 `run_code` 結果 |
| `Stop` | `agent/turn-stopping`（serial） | 阻塞 Stop hook 透過 `steer()` 送入其原因，強制再執行一步 |
| `SubagentStart` | `subagent/start`（emit） | additionalContext → `agent.inject()` 到仍在執行的同行程 child；遠端 child 沒有本機注入目標 |
| `SubagentStop` | `subagent/end`（emit） | 只觀測 |

三個 emit 點都以分離方式執行：沒有擴充點會等待 `SessionStart`／`SubagentStart`／`SubagentStop` hook。每條執行鏈都會被跟蹤；對橋接執行 dispose（資源釋放）時，會中止仍在執行的 hook 行程，並在 dispose 完成前排空 continuation（`createDetachedRuns`，位於 `dsh-hook-protocol`）。

matcher subject 是工具名稱（`PreToolUse`／`PostToolUse`）、工作階段源（`SessionStart`），或常數 `agent_type`，其值為 `general-purpose`（`SubagentStart`／`SubagentStop`）。harness subagent seam 不攜帶每 kind label，因此橋接報告 Claude Code 自身 Task 工具預設值；預設／`*`／空 `agent_type` matcher 會觸發，特定 kind matcher 不會觸發。`UserPromptSubmit`／`Stop` 忽略 matcher。一個點上文件設定的多個 hook 會**按設定順序序列執行**，並按最嚴格方式摺疊（`deny > ask > allow`，見 `dsh-hook-protocol`）。序列使每個 hook 的 `hook/invoked`／`hook/result` 對在日誌中相鄰，權限決策的摺疊結果與順序無關（見 Agent Note 的「run serially, not concurrently」說明）。

每個 agent scope stdin payload 都攜帶 `session_id` 與字串形式的 `transcript_path`。可用時，橋接透過 `ctx.sessionPersistence.locate(session.header)` 解析後者，否則傳送 `''`。尋找不會建立或 flush 產物，因此第一個輪次結束檢查點之前路徑可能不存在，也可能省略當前開啟輪次。

## 上下文源

注入上下文攜帶顯式 `{ kind: 'plugin', plugin: 'hooks-claude-code' }` 來源，因此持久訊息絕不會被誤認為使用者提示詞。

## 模型體驗

### Hook 提供的上下文

#### 模型看到的內容

`SessionStart`、已接受提示詞、工具後和即時同行程 subagent-start hook 可以新增帶源歸因的上下文訊息；阻塞 `Stop` hook 將原因新增為下一步 steering（中途引導）。遠端 child 注入沒有本機目標。

#### Token 影響

hook 不返回上下文時沒有成本。Hook 文字取決於資料，會被記錄，並在後續工作階段請求中重發，直到壓縮（compaction）。

#### KV Cache 影響

僅附加；新可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

### 已阻塞提示詞或工具結果

#### 模型看到的內容

提供方提供的原因逐字傳遞。缺失原因時，已阻塞提示詞精確使用 `blocked by UserPromptSubmit hook`，已拒絕工具變為 `Error: blocked by PreToolUse hook`，已阻塞工具後回饋精確為 `blocked by PostToolUse hook`，阻塞 stop 則精確新增 steering `continue: blocked by Stop hook`。`systemMessage` 與 `updatedInput` 會被記錄或警告，但在此實作中對模型不可見。

#### Token 影響

阻塞提示詞不會產生該提示詞對應的模型請求 token；拒絕或回饋會新增保留的回退或提供方文字；強制 continuation 需要另一個完整請求。

#### KV Cache 影響

已阻塞提示詞不傳送請求，不會導致失效。拒絕、回饋與強制 continuation 上下文會追加在可複用前綴之後，不改寫前綴。

## 已知限制與暫緩事項

- **不支援的 hook 事件（Claude Code 當前 30 項中的 23 項）：** `Setup`、`InstructionsLoaded`、`UserPromptExpansion`、`MessageDisplay`、`PermissionRequest`、`PostToolUseFailure`、`PostToolBatch`、`PermissionDenied`、`Notification`、`TaskCreated`、`TaskCompleted`、`StopFailure`、`TeammateIdle`、`ConfigChange`、`CwdChanged`、`FileChanged`、`WorktreeCreate`、`WorktreeRemove`、`PreCompact`、`PostCompact`、`SessionEnd`、`Elicitation` 和 `ElicitationResult`。這些事件的設定會在設定組解析前被忽略，因此不支援的事件既不會使設定失效，也不會註冊 hook。比較基線是 Claude Code [官方 hook 事件參考](https://code.claude.com/docs/en/hooks#hook-events)。
- **`SessionStart` 只支援部分功能：** 會消費 JSON `additionalContext`，但不支援純 stdout 上下文、`initialUserMessage`、`sessionTitle`、`watchPaths`、`reloadSkills` 與 `CLAUDE_ENV_FILE`。hook 脫離執行，因此上下文可能錯過第一個請求（`TODO(session-start-gating)`），payload 會省略 `model`、`agent_type` 和 `session_title` 等當前選填欄位。
- **`UserPromptSubmit` 只支援部分功能：** 支援阻塞與 JSON `additionalContext`，但不支援純 stdout 上下文、`sessionTitle` 和 `suppressOriginalPrompt`。除非被覆蓋，否則橋接還會使用自身 600 秒預設值，而非 Claude Code 的事件特定 30 秒 command 逾時。
- **`PreToolUse` 只支援部分功能：** `deny` 與 `ask` 決策可用；`allow` 不會預審批，不支援 `defer`，`additionalContext` 會被忽略，`updatedInput` 會被記錄 + 警告但不應用（見 [pre-tool-input-rewrite Agent Note](../../../.agents/notes/proposed/feature/2026-06-30-pre-tool-input-rewrite.md)）。
- **`PostToolUse` 只支援部分功能：** 支援阻塞回饋與 JSON `additionalContext`，但不支援 `updatedToolOutput` 和 `updatedMCPToolOutput`，`tool_response` 會展平為文字。
- **`SubagentStart` 與 `SubagentStop` 只支援部分功能：** 兩者均報告常數 `agent_type`，其值為 `general-purpose`，並在 Claude Code 報告父工作階段的位置使用 child 工作階段 id。Start 上下文是盡力而為，且只能到達仍在執行的同行程 child；stop 只觀測，無法阻塞 subagent 或向其提供上下文。Start 省略 `transcript_path`；stop 還省略 `agent_transcript_path`、`last_assistant_message`、`background_tasks` 和 `session_crons`，並始終報告 `stop_hook_active: false`。
- **`Stop` 只支援部分功能：** 阻塞會強制另一個模型輪次，但 `stop_hook_active` 始終為 `false`，會省略 `last_assistant_message`、`background_tasks` 和 `session_crons`，且未實作連續阻塞上限（`TODO(stop-loop-guard)`）。因此，無條件阻塞 hook 會在每個步驟中強制 continuation，除非它自我限制。
- **通用 payload 與輸出欄位只支援部分功能：** 已對映事件會省略 Claude Code 原本會提供的 `prompt_id`、`transcript_path`、`permission_mode` 和 `effort`。`systemMessage` 會被記錄 + 警告但不呈現；`{"continue": false}` 會被記錄但不會停止執行；不會應用 `suppressOutput`、`stopReason` 和 `terminalSequence`（`TODO(hook-continue-false)`）。
- **Handler 與設定只支援部分功能：** 只執行 shell 形式 command handler。會跳過 `http`、`mcp_tool`、`prompt` 和 `agent` handler；不遵循 `args`、`async`、`asyncRewake`、`shell`、`if`、`once` 和 `statusMessage` 等 command handler 選項。匹配 handler 序列執行且不去重，而 Claude Code 會平行執行並對相同 handler 去重。一個行程級 `configPath` 會在載入時解析一次；尚未實作 Claude Code 的分層項目、使用者、外掛程式與策略發現和即時重新載入（`TODO(per-session-hook-config)`）。
