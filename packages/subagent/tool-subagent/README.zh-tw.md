# @deepseek-ai/dsh-tool-subagent

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

基於一個已設定 `ctx.subagents` 提供方、面向模型的委派工具。更換提供方只會改變傳輸，不會改變執行約定。

## 提供方選擇與生命週期

每個外掛程式實例把一個 `provider` 綁定到一個 `toolName`；模型不會收到提供方選擇器。如需公開另一種傳輸，請載入另一個名稱不同的實例。工具只在其提供方存在時註冊，從而避免對同級載入順序和提供方重新載入的相依性。工具描述遵循 `provider.inheritsParentContext`：新建子 agent（代理）需要獨立提示詞，而 fork 子 agent 已能看到父級已完成輪次。

前臺呼叫會讓執行訊號貫穿啟動和執行，等待 `run.result`，並且在返回前總會等待 `run.dispose()`。只有 `completed` 會返回規範值 `{ kind: 'foreground', runId, output: JsonValue[] }`，並渲染為相同的最終文字；中止、拒絕、token 上限和其他失敗都會變成出錯的工具結果，其訊息在終止原因標題之後附帶子 agent 保留下來的部分文字（即 `SubagentResult.output` 的選取結果）——被截斷的回答不會被報告為成功，也絕不會被悄悄丟棄。如果結果收集與 dispose（資源釋放）都 reject，出錯的結果會保留兩項診斷資訊。

`backgroundMode` 同時選擇後臺路由與省略 `run_in_background` 時的默認行為。`one-shot` 默認在前臺等待；顯式傳入 `true` 時，它會註冊一個歸父級所有的普通 Task，並返回規範值 `{ kind: 'background', jobId }`，渲染為 `started background subagent job <id>`，即使提供方支持可繼續子 agent 也不例外。通用 Task 工具負責其後續狀態、收集、取消和通知。`continuable` 在參數省略或為 `true` 時於後臺執行；顯式傳入 `false` 時則在前臺等待結果。其後臺路由要求提供方具備 `prepareContinuable` 能力，呼叫 `ctx.subagents.startContinuable()`，並返回 `{ kind: 'continuable', subagentId }`，渲染為 `started subagent <childId>`。該路由在 inbox 接受時結帳：子 agent 自此擁有自己的輪次，因此該呼叫既不等待也不收集結果。透過該 id 查看其 transcript（文字記錄）仍是其詳細輸出的來源，選填的全域性 `send_message` 工具則向其傳送更多工作。每當子 agent 的 Activation 結束，繼續執行服務都會投遞一條結帳通知，其中包含結束結果及可能存在的最終 assistant 訊息，且這項投遞不相依性 `report`。啟動可繼續工作不要求載入 `send_message`。見[後臺 subagent Agent Note](../../../.agents/notes/implemented/feature/2026-07-08-background-subagent-tasks.md)、[可繼續的 subagent Agent Note](../../../.agents/notes/implemented/feature/2026-07-28-continuable-subagent-conversations.md)和[後臺優先委派 Agent Note](../../../.agents/notes/implemented/feature/2026-08-11-background-first-continuable-delegation.md)。

`toolFilter` 會改變子 agent 的全域性工具層，但不是從父級派生的權限上限。見 [agent 作用域的安全非目標](../../../.agents/notes/implemented/architecture/2026-07-08-agent-scope-contexts.md#security-and-authority-are-non-goals)。

## 設定

| 鍵 | 含義 |
|---|---|
| `provider`（必填） | 提供方名稱（`spawn`、`fork`、`acp` 等）。 |
| `toolName` | 面向模型的名稱，默認 `subagent`；每個已載入實例必須不同。 |
| `enableRunInBackground` | 公開後臺模式，默認 `true`；停用時也會拒絕強制後臺呼叫。 |
| `backgroundMode` | 後臺生命週期策略，默認 `one-shot`。`one-shot` 默認前臺呼叫；`continuable` 默認後臺呼叫，要求提供方具備 `prepareContinuable` 能力，並返回持久化子 agent ID，且不要求載入後續訊息工具。 |
| `agentOptions` | 傳給具體提供方的子 agent `provider`、`model` 和正整數 `maxTokens`；行程內提供方會用顯式值覆蓋繼承的父級選項。 |
| `persona` | 每個子 agent 獨立的 persona；要求提供方具備 `persona` 能力。 |
| `toolFilter` | 每個子 agent 獨立的全域性工具限制；要求提供方具備 `toolFilter` 能力。 |
| `maxDepth` | 絕對委派深度上限，默認 `3`（`0` 禁止委派）；數值上限要求 `depthLimit` 能力，缺失時掛載失敗。對於預算由子 harness 擁有的行程外提供方，`'provider-managed'` 不傳送上限。工具在達到上限時仍然可見；每次嘗試啟動都會檢查呼叫 agent 的當前深度，被拒絕時返回出錯的工具結果。 |

## 並行

前臺呼叫和後臺呼叫均並行安全：同一條 assistant 訊息中的同級委派會在迴圈的滾動池（`maxParallelToolCalls`）下重疊執行，結果仍按模型順序提交。子 agent 在各自的工作階段中工作，一次執行絕不變更父工作階段；一次性後臺形態對父級擁有狀態的唯一寫入是註冊一個 Task——這是一次同步、可交換、能容忍並行分發的插入，因此重疊的後臺呼叫按分發競態順序獲得各自的 job id。協調同級工作區效果由模型負責，正如模型已經對後臺和可繼續子 agent 所承擔的那樣。見 [平行 subagent Agent Note](../../../.agents/notes/implemented/feature/2026-08-09-parallel-subagent-delegations.md) 和 [平行工具呼叫 Agent Note](../../../.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.md)。

## 模型體驗

### 工具 schema

#### 模型看到的內容

當提供方存在時，以當前實例設定的名稱公開已生成的默認 [`subagent` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-subagent)。提供方是否繼承上下文會改變工具描述和提示詞描述。啟用後臺模式會新增 `run_in_background`：可繼續模式會記錄其預設值為 `true`、執行時期結帳通知與顯式前臺覆蓋；一次性模式會記錄其預設值為 `false`，以及用 `job_output` 收集或用 `job_kill` 停止的 job id。當工具在本次組裝的作用域中可見時，一個 `tool:<toolName>` 系統提示詞 section 會指示模型同時啟動相互獨立的可繼續委派、在它們執行時期繼續工作，並且僅當下一步動作相依性結果時選擇前臺；工具限制會同時移除其 schema 和這段指引。

#### Token 影響

每個父級請求都會產生固定的 schema token 開銷；每個提供方實例增加一個 schema，每個可繼續實例還會增加一個簡短的系統提示詞 section。

#### KV Cache 影響

只要提供方實例、名稱、描述和 schema 不變，前綴就保持穩定。提供方註冊生命週期可能從首個變化的工具定義開始，使父級複用失效。

### 前臺結果

#### 模型看到的內容

呼叫會保留描述和提示詞。成功時只包含子 agent 的最終文字；其他結果變為 `Error: <message>`。子 agent 中間步驟不會進入父級。

#### Token 影響

提示詞和結果會留在父級歷史中，直到上下文壓縮（context compaction）；子 agent 工作上下文留在子 agent 中。

#### KV Cache 影響

僅附加；新增可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

### 後臺結果

#### 模型看到的內容

在設定的可繼續模式下，啟動時返回內容恰為 `started subagent <childId>`；在設定的一次性模式下，則返回 `started background subagent job <id>`。一次性模式下，通用 Task 介面提供後續狀態、最終輸出、取消回應和通知。可繼續模式下，本工具不返回自己的結果；子 agent 的結帳會以[服務負責的通知](../subagent/README.md#settlement-notice)到達父級，獨立載入的 `send_message` 工具會投遞後續訊息，而透過其 id 查看子 agent 的 transcript 即是其詳細輸出來源。

#### Token 影響

確認訊息會被保留；一次性最終輸出只在收集或注入時進入父級歷史，而可繼續子 agent 的輸出絕不會透過本工具返回——其結帳通知獨立於任何工具結果到達。

#### KV Cache 影響

僅附加；新增可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **後臺執行不透過本工具公開結果**：一次性任務的最終輸出透過通用 Task 介面收集，可繼續子 agent 的輸出留在其自身工作階段中，按其 subagent id 讀取。結帳通知會說明該子 agent 如何結束，並攜帶可能存在的最終 assistant 訊息，但它不是本次呼叫的回傳值，也無法在此等待。
- **等待中的一次性實例較晚才發現重複名稱**（`TODO(subagent-dup-toolname)`）：可繼續實例會在外掛程式應用期間預留提示詞 section 名稱，但若要阻止等待中的一次性實例回滾提供方註冊，仍需要一份預期名稱登錄檔。
- **每個實例的子 agent 策略固定**：其他模型、persona、工具過濾器或深度上限都需要另一個名稱不同的工具。
