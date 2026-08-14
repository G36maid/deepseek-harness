# @deepseek-ai/dsh-hooks-codex

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

一個 Cordis 外掛程式，在 harness 的規範攔截點上執行使用者現有 **Codex** hook 設定的受支援子集。它是 hooks 子系統中採用 **Codex 方言** 的一側。方言無關原語來自 [`@deepseek-ai/dsh-hook-protocol`](../hook-protocol/README.md)；該橋接負責處理 Codex 形狀的 payload、matcher 模式和決策對映。

該橋接實作 Codex 當前 hook 協定的一個有意選取的子集：

- **10 個 hook 點中的 5 個：** `PreToolUse`、`PostToolUse`、`SessionStart`、`UserPromptSubmit` 和 `Stop`。
- **僅使用正則的 matcher**（沒有字面量快速路徑；matcher 始終是未錨定正則）。
- **snake_case stdin payload**，攜帶 `turn_id`／`model` 額外欄位，寫入時**不帶**尾隨換行符。
- **沒有 Codex 外掛程式 env 注入，也沒有設定時 placeholder 替換**（命令仍會接收執行器環境，並透過其 shell 執行）。
- **沒有工具前審批或改寫路徑**：hook 可以阻塞，但橋接不會預審批或替換工具輸入。

原生 Cordis 外掛程式可以完成此橋接的所有工作，並且功能更強；該橋接只是已對映 Codex 子集的相容路徑（見 [攔截擴充點 Agent Note](../../../.agents/notes/implemented/feature/2026-06-30-interception-extension-points.md)）。

## 設定

```ts
import type { Config } from '@deepseek-ai/dsh-hooks-codex'
const config: Config = {
  configPath: '/path/to/.codex/hooks.json', // required
  model: 'deepseek-v4',                      // optional: stamped on every payload (Codex includes `model`)
  defaultTimeoutMs: 600_000,                 // optional: per-hook timeout when a hook sets none
  stderrSummaryMaxChars: 500,                // optional: char cap on the hook/result event's persisted stderr summary
}
```

在 `cordis.yml` 中：

```yaml
- dsh-hooks-codex:
    configPath: ./.codex/hooks.json
    model: deepseek-v4
```

設定只在載入時解析**一次**。`configPath` 是**行程級**設定：相對路徑在載入時根據行程啟動 cwd 解析，而非每工作階段解析（`TODO(per-session-hook-config)`）。讀取／解析失敗會被隔離處理（記錄 + 不註冊任何內容）；實際消費 matcher 的事件所帶的無效 matcher 正則屬於此類失敗，並報告其 pattern 與事件。只執行同步 `type: 'command'` hook；非 command 或 `async: true` hook 會被解析並跳過，同時記錄警告。hook 接受 `timeout` 或 `timeoutSec` alias；兩者都未設定時，使用協定參考預設值 `DEFAULT_HOOK_TIMEOUT_MS`（來自 `dsh-hook-protocol`，10 分鐘）。五個橋接支援點之外的事件會在解析時丟棄。

hook 本身會在 agent（代理）的工作階段工作區中執行：對 agent scope 點，橋接會將工作階段 `cwd` 作為 hook 行程工作目錄，因此 hook 作用於使用者項目樹，而非伺服器啟動目錄。

## Hook 點 → 類型化 Decision

| Codex hook | Harness 點 | 對映 |
|---|---|---|
| `SessionStart` | `agent/session-start`（emit） | 純 stdout hook 的輸出 → additionalContext → `agent.inject()` |
| `UserPromptSubmit` | `agent/pre-step`（waterfall，瀑布式事件） | `block`（結束碼 2）→ `PreStepDecision.reject`；僅 additionalContext → 透過 `next()` 委託，再向下游 `enter` 決策追加一條單獨標記來源的訊息 |
| `PreToolUse` | `tools/pre-execute`（waterfall） | `block` → `PreToolDecision.deny`（沒有 `allow`／`ask`） |
| `PostToolUse` | `tools/post-execute`（waterfall） | `block` → 帶回饋的 `block`；僅 additionalContext → 透過 `next()` 委託，再將一個單獨標記源的上下文前置到下游決策；Code Mode 將子呼叫上下文延遲到外層 `run_code` 結果 |
| `Stop` | `agent/turn-stopping`（serial） | 阻塞 Stop hook 透過 `steer()` 送入其原因，強制再執行一步 |

工具呼叫的 payload 攜帶真實 `tool_name`（matcher 測試的相同值）與 Codex `tool_input: { command }` 形狀（存在 `command` arg 時使用該值，否則使用 `''`）。matcher subject 是工具名稱（`PreToolUse`／`PostToolUse`）或工作階段源（`SessionStart`）；`UserPromptSubmit`／`Stop` 忽略 matcher。

每個 agent scope stdin payload 都攜帶 `session_id` 和 `transcript_path`。可用時，橋接透過 `ctx.sessionPersistence.locate(session.header)` 解析後者，否則傳送 `null`，保留 Codex `string | null` 形狀。尋找不會建立或 flush 產物，因此在第一個輪次結束檢查點之前，路徑可能尚不存在，或其指向的 transcript（文字記錄）可能尚未包含當前未結束的輪次。

`SessionStart` 是唯一的 emit 點，它會脫離執行。每條執行鏈都會被跟蹤；對橋接執行 dispose（資源釋放）會中止仍在執行的 hook 行程，再排空 continuation，之後 dispose 才會完成（`createDetachedRuns`，位於 `dsh-hook-protocol`）。

## 上下文源

注入上下文攜帶顯式 `{ kind: 'plugin', plugin: 'hooks-codex' }` 來源，因此持久訊息絕不會被誤認為使用者提示詞。

## 模型體驗

### Hook 提供的上下文

#### 模型看到的內容

`SessionStart`、已接受提示詞和工具後 hook 可以新增帶源歸因的上下文訊息；阻塞 `Stop` hook 將其原因新增為下一步 steering（中途引導）。

#### Token 影響

hook 不返回上下文時沒有成本。Hook 文字取決於資料，會被記錄，並重發直到壓縮（compaction）。

#### KV Cache 影響

僅附加；新可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

### 已阻塞提示詞或工具結果

#### 模型看到的內容

提供方提供的原因逐字傳遞。缺失原因時，已阻塞提示詞精確使用 `blocked by UserPromptSubmit hook`，已拒絕工具變為 `Error: blocked by PreToolUse hook`，已阻塞工具後回饋精確為 `blocked by PostToolUse hook`，阻塞 stop 則精確新增 steering `continue: blocked by Stop hook`。Codex `systemMessage` 不會呈現。

#### Token 影響

阻塞提示詞不會產生該提示詞對應的模型請求 token；拒絕或回饋會新增保留的回退或提供方文字；強制 continuation 需要另一個完整請求。

#### KV Cache 影響

已阻塞提示詞不傳送請求，不會導致失效。拒絕、回饋與強制 continuation 上下文會追加在可複用前綴之後，不改寫前綴。

## 已知限制與暫緩事項

- **不支援的 hook 事件（Codex 當前 10 項中的 5 項）：** `PermissionRequest`、`PreCompact`、`PostCompact`、`SubagentStart` 和 `SubagentStop`。這些事件的設定會在解析期間靜默丟棄。比較基線是 Codex [官方 hook 參考](https://learn.chatgpt.com/docs/hooks)。
- **`SessionStart` 只支援部分功能：** 支援純 stdout 與 JSON `additionalContext`，但 hook 脫離執行，因此上下文可能錯過第一個請求（`TODO(session-start-gating)`）。
- **`UserPromptSubmit` 只支援部分功能：** 支援阻塞加純 stdout 或 JSON 上下文，但不會強制執行通用 `systemMessage` 和 `{"continue": false}` 控制。
- **`PreToolUse` 只支援部分功能：** 支援阻塞，但會忽略 `additionalContext`、`permissionDecision: "allow"` 和 `updatedInput`。每個工具都表示為 `tool_input: { command }`，因此非 shell 工具參數不會如實公開給 hook。
- **`PostToolUse` 只支援部分功能：** 支援阻塞回饋與 JSON `additionalContext`，但不會強制執行 `{"continue": false}`，非 shell 工具參數會縮減為 `{ command }`，結構化工具輸出會在 `tool_response` 中展平為文字。
- **`Stop` 只支援部分功能：** 阻塞會強制另一個模型輪次，但 `stop_hook_active` 始終為 `false`，`last_assistant_message` 始終為 `null`，且不會強制執行 `{"continue": false}`。因此，無條件阻塞 hook 會在每個步驟中強制 continuation，除非它自我限制（`TODO(stop-loop-guard)`）。
- **通用 payload 與輸出欄位只支援部分功能：** 每個已對映事件都報告靜態設定的 `model` 與 `permission_mode: "default"`，而非當前 Codex 執行時期值。`systemMessage` 會被記錄並觸發警告，但不呈現，`{"continue": false}` 會被記錄但不會應用 Codex 事件特定停止行為（`TODO(hook-continue-false)`）。
- **設定載入與執行只支援部分功能：** 一個行程級 `configPath` 會在載入時解析；尚未實作 Codex 的活動使用者層、項目層、工作階段層、系統／託管層和外掛程式層、信任控制與內聯 `config.toml` hook 形式（`TODO(per-session-hook-config)`）。只執行同步 `command` handler，忽略 `statusMessage` 與 `commandWindows` 等當前中繼資料，匹配 handler 序列執行，而非使用 Codex 的並行啟動語義。
