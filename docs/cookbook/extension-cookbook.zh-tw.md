# 實作手冊：擴充外掛程式形態

[English](extension-cookbook.md) | [简体中文](extension-cookbook.zh.md) | 繁體中文

harness 擴充的參考模式。程式碼片段省略了 import 和輔助實作，無法直接複製執行。具體編寫路徑見[包檢查清單](adding-a-package.md)、[第一個工具教程](../user/develop/basic/tool.md)、[工具參考](adding-a-tool.md)和 [LLM（大型語言模型）配接器指南](adding-an-llm-adapter.md)；系統與擴充點對映由[架構文件](../architecture.md)負責。

## 工具外掛程式

工具在 `ctx.tools` 上註冊。帶註解的 `defineTool` 示例（類型化的 `execute` 參數、結果構造、`run_in_background` 模式）見 [adding-a-tool.md](adding-a-tool.md)——該指南是工具定義的真源。`ctx.tools.register()` 也直接接受原始 JSON Schema `ToolDefinition`（MCP 來源的工具就是這樣到達的）；`defineTool` 是第一方工具使用的類型化輔助函式。

<a id="a-hook-plugin-permission-gate-example"></a>

## 掛鉤外掛程式（以權限閘門為例）

這個權限閘門是掛鉤外掛程式的一個示例。它從 `tools/pre-execute` 閘門返回一個類型化的決策，用於允許或拒絕一次呼叫；沙盒、權限和 plan-mode 外掛程式都可以使用該擴充點。掛鉤外掛程式也可以攔截其他擴充點，本身並不等同於權限閘門。「原生掛鉤」是在攔截點上執行的普通 Cordis 外掛程式，不需要外部協議。

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

declare function isAllowed(exec: ToolExecution): Promise<boolean>

export const name = 'permission-gate'

export function apply(ctx: Context) {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (!(await isAllowed(exec))) {
      return { kind: 'deny', reason: 'Denied by policy.' }
    }
    return next()
  })
}
```

這個 waterfall（瀑布式事件）是可重排的策略層。當不變式需要單調的最終拒絕時使用 `ctx.tools.guard()`；當外掛程式需要包裹實際分發生命週期時（逾時/重試/指標；僅 `exec.signal` 可替換）使用 `tools/execute`；顯式結果變換使用 `tools/post-execute`；對不可變最終結果的受限觀察使用 `tools/result`。選擇規則見[新增工具指南](adding-a-tool.md#execution-policy-and-observation)。

## UI 外掛程式

UI 外掛程式從 `session/event` 事件串流渲染（助手 token 流以 `assistant/chunk` 形式到達，加上輪次/步驟邊界與工具活動），並透過 `agent.followup()` / `agent.steer()` 將輸入驅動程式回去。如果瀏覽器外掛程式要向內建 Web Client 貢獻業務行，則應註冊 `ConversationNodeDefinition` 與 keyed Chat renderer；具體步驟見 [Conversation Node 指南](adding-a-conversation-node.md)。

```ts
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'

declare function render(text: string): void
declare function onUserInput(handler: (text: string) => void): void

export const name = 'my-ui'
export const inject = ['agents']

export function apply(ctx: Context) {
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'assistant/chunk' && event.data.chunk.type === 'text-delta') {
      render(event.data.chunk.text)
    }
  })
  onUserInput(text => ctx.agents.get(SessionId('client-session'))?.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })))
}
```

## 外部協議驅動程式

*協議驅動程式*將協議對端接入 `ctx.agents`；它可以服務於 UI 或自動化用戶端。stdio 驅動程式擁有 stdout，透過工廠建立或復原 agent（代理），並將協議請求對映為 `followup()` 或 `cancel()`。底層提示詞請求返回其持久入隊回執；它不會透過關聯 `MessageId` 與 `turn/end` 獲得結果。整個 agent 的狀態應單獨發布。自動化方法可以從回執等待到下一次 idle，並概括這一顯式擁有的區間；UI 通常則會持續觀察開放式事件串流。透過 `AgentHandle.dispose()` 拆除 agent，以使 dispose（資源釋放）達到完全靜止。

[`packages/acp/acp`](../../packages/acp/acp) 是僅面向自動化的完整示例：它透過 ACP（Agent Client Protocol）JSON-RPC stdio 提供全新文字工作階段，寄出已提交的助手文字，並為其擁有的 agent 註冊一次性機器權限應答器。其 [README](../../packages/acp/acp/README.md) 定義確切的方法、事件順序和生命週期約定。

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-protocol-bridge'
export const inject = ['agents', 'sessions', 'sessionPersistence']

export function apply(ctx: Context) {
  // Stream every logged assistant text/reasoning delta out to the client.
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'assistant/chunk') {
      const chunk = event.data.chunk
      if (chunk.type === 'text-delta') {
        // sendToClient({ kind: 'message_chunk', text: chunk.text })
      }
    }
  })
  // Inbound "prompt": create/resume an agent, feed it, and return its enqueue receipt.
  // Whole-agent status is a separate notification; no turn end belongs to this prompt.
  // Teardown reaches quiescence via AgentHandle.dispose() (stop + await exit).
}
```

## 可執行的組裝示例

可執行葉子從 `examples/*/cordis.yml` 載入各自的外掛程式樹；根目錄的 `demo:*` 指令碼和這些葉子目錄是權威清單。產品 `dsh` 啟動器負責 Web 和一次性 headless 執行，ACP 葉子使用 [`@deepseek-ai/dsh-acp-demo`](../../packages/examples/acp-demo)，JSON-RPC 葉子使用 [`@deepseek-ai/dsh-sdk-jsonrpc-demo`](../../packages/examples/jsonrpc-demo)。headless 快照葉節點顯式掛載 [`@deepseek-ai/dsh-agent-spine-demo`](../../packages/examples/agent-spine-demo) 和 JSONL 持久化，再透過示例自有的測試 fixture（測試前置資料）驅動程式這些元件，而不是透過已交付的 app 包。

## 功能→機制對映

每個產品功能都對映到一個文件化擴充點上的監聽器——微核心聲明由此可驗證（[微核心 Agent Note](../../.agents/notes/implemented/architecture/2026-06-11-microkernel-event-taxonomy.md)）。沒有任何一行修改迴圈本身。

`system-prompt/assemble` 是一個專家協作式的整體裝配變換：其返回的裝配結果具有權威性，因此監聽器作者有責任保留活躍的 Code Mode 和結構化輸出協議的貢獻。對於需要在展示、尋找和執行之間保持對齊的工具過濾，優先使用 `ctx.tools.restrict()`。

| 產品功能 | 外掛程式機制 |
|---|---|
| 掛鉤系統（使用者級 + 項目級） | `agent/session-start`、`agent/pre-step`、`agent/request`、`tools/pre-execute`、`tools/post-execute` 和 `agent/turn-stopping` 上的監聽器；waterfall 返回類型化決策，`agent/turn-stopping` 則可透過 steering（中途引導）觸發下一步；`dsh-hooks-claude-code` / `dsh-hooks-codex` 橋接器將掛鉤設定檔對映到這些擴充點上 |
| `/goal` | `ctx.goals` 管理持久狀態，`dsh-goal-round-driver` 透過公共 `Agent` 調度同工作階段 Round，獨立的命令/工具生產方分別提供人類/模型控制 |
| `/loop` | 在 `turn/end` 工作階段事件上 `followup()` 下一次迭代；或強制繼續 |
| 動態工作流程 | `ctx.workflowEngine` + worker-thread 引擎 + `workflow` 工具；結構化的行程內子任務透過作用域化的提示詞/工具註冊、單調工具守衛、最終 `tools/result` 提交（包括外層 `run_code`）和結構化輸出執行的單調 `concludeTurn()` 標記來強制輸出 |
| 排隊訊息 + steering | 核心 `Agent.followup()` / `Agent.steer()` |
| 上下文壓縮（context compaction）（自動 + 手動） | `ctx.compaction` seam + `dsh-compaction-basic`；自動壓力檢查執行在序列 `agent/pre-step`，標準的溢位復原機制執行在 `agent/request-error`，手動呼叫方使用同一個壓縮服務（[壓縮 Agent Note](../../.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md)） |
| 系統提示詞可設定性 | `ctx.systemPrompt.section()`，支持排序與作用域區域性覆蓋 |
| AGENTS.md（根目錄） | 一個讀取該文件的 section 提供方 |
| AGENTS.md（子目錄，按需觸發）+ 文件變更通知 | 從 watcher / 工具結果監聽器呼叫 `agent.inject()` |
| 內建工具 | `ctx.tools.register()`；schema 自動流入裝配——`dsh-tool-*` 系列（bash、fs、web、subagent、todo）是已交付的示例 |
| ToolSearch / 漸進式披露 | 當可見集變化時替換一個作用域化的 `ctx.tools.restrict()` 註冊；登錄檔保持展示、尋找和執行三者對齊 |
| 工具截止時間 / 重試 / 指標 | 用 `tools/execute` 包裹核心分發；包裝層可替換 `exec.signal`、委託執行，並在同一詞法生命週期內檢視規範化結果 |
| 最終工具結果指標 / 審計 / 捕獲 | 用 `tools/result` 觀察不可變的權威結果；僅當外掛程式需要變換結果或附加上下文時才使用 `tools/post-execute` |
| 單調終端機輪次策略 | 從成功的終端機工具呼叫 `ToolExecution.concludeTurn()`；同一回應中後續工具呼叫仍可由守衛阻止，迴圈在該步驟後停止 |
| 子行程沙盒（landlock / sandbox-exec） | 透過 `dsh-bash-sandbox` 使用 `ctx.sandbox` 後端；能力等級的拒絕使用 `tools/pre-execute` |
| 權限系統 / AskUserQuestion | 從 `tools/pre-execute` 返回 `ask` 並透過 `ctx.approval` 應答；為普通使用者提問註冊一個獨立的面向模型的 ask 工具 |
| Plan mode | [`@deepseek-ai/dsh-plan-mode`](../../packages/plan/plan-mode/README.md)：落日誌的 `plan/mode` 狀態、`plan:policy` 引導段、`/plan [message]` 入口、`/plan off` 直接退出，以及經使用者評審的 `exit_plan_mode` 出口；強制約束留在獨立的沙盒/審批軸上 |
| subagent 委派 | `ctx.subagents` 提供方登錄檔（`dsh-subagent-spawn-in-process`/`-fork`/`-acp`/`-codex`/`-claude-code`/`-dsh-sdk`）+ `dsh-tool-subagent` 向模型暴露一個已設定的提供方 |
| MCP | 每個伺服器一個外掛程式：發現工具 → `ctx.tools.register()` |
| skill（技能） | section + 工具註冊；呼叫時透過 `inject()` 注入 skill 內容 |
| 記憶 | section 提供方 + 工具 |
| 定時任務（cron） | 外掛程式註冊面向模型的調度工具；定時器觸發 → 空閒時 `followup(…, {source: {kind: 'cron', …}})`／忙碌時 `inject()` 通知 |
| UI（GUI；CLI（命令列介面）輸出 JSONL） | 監聽 `session/event`（助手區塊、邊界、工具活動）；輸入 → `followup()` |
| Web Client Chat 業務節點 | 註冊 `ConversationNodeDefinition` 與 `conversation.chat.node` keyed renderer |
| 遙測 / 可重播 trace | `session/event` → JSONL；重播 = `sessions.create(id, { seed })` |
| 模型配接器 | 透過 `registerAdapter` 註冊 `LlmAdapter` 子類（`dsh-llm-deepseek`、`dsh-llm-pi-ai`） |
| 外掛程式熱重新載入 | 每個註冊都是一個 `ctx.effect` → 隨倉庫提供的 HMR（熱模組替換）直接生效 |
