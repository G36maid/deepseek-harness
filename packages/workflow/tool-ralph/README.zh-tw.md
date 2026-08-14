# @deepseek-ai/dsh-tool-ralph

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

面向模型的 `ralph` 工具執行固定的前臺工作流程，把一個不可變目標依次交給多個全新子 agent（代理）。它展示如何把專用編排策略實作為基於 [`ctx.workflowEngine`](../workflow/README.md) 和 [`ctx.subagents`](../../subagent/subagent/README.md) 的普通外掛程式：不會向 `agent-loop` 新增 Ralph 模式或全新 agent loop（代理循環），同工作階段的[目標領域](../../goal/goal/README.md)也保持獨立。策略和暫緩事項由 [Ralph Agent Note（agent 決策記錄）](../../../.agents/notes/implemented/feature/2026-07-19-fresh-agent-ralph-workflow-tool.md)負責。

## 契約

`ralph({ objective, maxRounds? })` 會等待整個執行完成。部署設定中的 `maxRounds` 既是預設值，也是呼叫覆蓋值的上限。每個 Ralph Round 透過 `subagentProvider` 啟動一個子 agent；該提供方必須存在、支持結構化輸出，並報告 `inheritsParentContext: false`。已設定的提供方以 `WorkflowStartRequest.subagentProvider` 傳遞，使固定指令碼無法檢查或更改路由，普通的模型編寫 `workflow` 工具也不會因此獲得提供方選擇器。解析後的 Round 上限還會作為 `WorkflowStartRequest.maxTotalAgents` 傳遞，使固定迴圈與引擎的子 agent 總數後備上限協同；Ralph 上限超過引擎部署上限時，引擎會在發布執行前拒絕。

每個子 agent 只接收不可變目標、當前 Ralph Round 及其上限、一條「共享工作區是權威狀態」指令，以及上一個結構化交接內容。工作區是長期記憶；不會把父級對話或先前子 agent 工作階段作為初始內容。報告包含 `status: continue | complete | blocked`、非空摘要、證據、後續步驟和阻塞文字。固定工作流程內部及消費端邊界都會校驗特定狀態的語義和序列化後的 `maxHandoffChars` 上限。無效、缺失或過大的報告會使工作流程失敗，而不會被截斷或誤認為上限耗盡。

成功的終態工具結果為 `complete`、`blocked` 或 `budget-limited`，並包含最後一份有界報告和已啟動的 Round 數量。規範包絡為 `{ runId, agentsStarted, result }`；Native 渲染器中的完成與阻塞標籤會明確說明結果由 worker 報告，而非獨立認證。`maxResultChars` 只限制包含截斷標記的渲染文字，不會改變規範值中經過校驗的報告或跨 Round 交接內容。

普通子 agent 失敗會產生錯誤，其中標明失敗的 Round；如果已有上一次成功交接，也會保留它。Ralph 不會重試該 Round。致命的提供方啟動、傳輸、worker 或工作流程失敗仍是工作流程錯誤，並可能在固定指令碼返回交接內容前結帳。取消同樣屬於錯誤；區域性輸出絕不會視為成功。

## 生命週期與取消

呼叫方 agent 是每個全新子 agent 的父級，因此會保留 cwd 和譜系，但不會複製其對話。`exec.signal` 進入工作流程引擎，同時也橋接到 `run.cancel()`，以便不相依性具體實作。工具等待 `run.result` 並呼叫 `run.dispose()`，後一個呼叫位於 `finally` 中，因此取消的父級步驟會等到引擎完成有界終止且子 agent 完全靜止後才返回。

## 渲染意圖

待處理呼叫使用 `generic` 卡片，標題為 `ralph`；不可變目標作為其 `rawInput`。結果繼續使用 generic 卡片。兩個呈現函式都只相依性工具參數和已結帳的工具包絡。

## 設定

| 鍵 | 預設值 | 含義 |
|---|---|---|
| `subagentProvider` | `spawn` | 每個 Round 使用的全新結構化輸出提供方。 |
| `maxRounds` | `256` | 一次 Ralph 執行的預設值和部署上限。 |
| `maxHandoffChars` | `16384` | 一份 Round 報告序列化後的最大字元數。 |
| `maxResultChars` | `16384` | 返回給父級的完整成功結果最大字元數。 |

外掛程式應用時會規範化並校驗所有設定值，也包括繞過 Loader schema 規範化而直接應用的情況。每次呼叫前都會立即解析提供方能力，因為提供方註冊可能隨外掛程式生命週期和熱模組替換（HMR）變化。

## 模型體驗

### 系統提示詞

#### 模型看到的內容

在該外掛程式的註冊作用域內，每個父級請求都會收到下方的固定路由指導。

##### Ralph 指導

```markdown
Use the ralph tool ONLY when the direct human explicitly asks for a Ralph loop or fresh-agent iterative execution. Each Ralph round starts a fresh child with no conversation seed and uses the shared workspace as durable memory. Completion and blockers are worker reports, not independent evaluation. Use same-session goal tools for ordinary long-running objectives, and plain subagents or workflowEngine for bounded delegation and fan-out.
```

#### Token 影響

外掛程式啟用期間，每個請求都會產生少量固定的指導 token 開銷。

#### KV Cache 影響

只要外掛程式作用域和指導文字不變，前綴就保持穩定。啟用或 dispose（資源釋放）可能會使從該提示詞段起的快取複用失效。

### 工具 schema

#### 模型看到的內容

已生成的 [`ralph` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-ralph)公開一個必填 `objective` 字串和一個選填 `maxRounds` 數字。提供方選擇、交接大小、報告 schema、工作流程指令碼和編排行為均由部署側控制，不在呼叫 schema 中。

#### Token 影響

工具可見時，每個請求都會產生少量固定的 schema token 開銷。

#### KV Cache 影響

只要定義和可見性不變，前綴就保持穩定。

### 子 agent 請求與父級結果

#### 模型看到的內容

每個子 agent 都會看到獨立的固定 Round 提示詞和結構化輸出捕獲契約。父級只看到原始呼叫和一個終態結果，其中包含 worker 報告的狀態、Round 數量及經過美化列印的最終報告；中間子 agent 訊息和報告不會進入父級對話。普通子 agent 失敗時會改為產生錯誤，其中包含對應 Round 編號；從第二個 Round 起，還會包含上一次成功交接。

#### Token 影響

每個 Round 都會付款全新子 agent 上下文的成本。`maxHandoffChars` 限制跨 Round 狀態，`maxResultChars` 獨立限制完整的父級成功文字；子 agent 工作留在父級上下文之外。

#### KV Cache 影響

每個全新子 agent 都有獨立的請求快取。父級結果追加在可複用請求前綴之後。

## 已知限制與暫緩事項

- **完成由 worker 自行聲明**：沒有獨立的評估器或驗證器判斷目標是否實際完成；評估器策略及評估器驅動的延續均暫緩處理。
- **僅支持前臺**：沒有 job id、後臺收集、行程復原檢查點、調度器或基於掛鐘時間的啟動策略。
- **工作區是唯一的跨 Round 長期記憶**：一份有界報告作為顯式交接內容，每個子 agent 結束後，未提交的對話推理都會消失。
- **一個 Round 對應一個全新子 agent**：Round 內沒有扇出、模型/提供方切換、fork 上下文或由模型呼叫選擇的提供方。
- **普通子 agent 失敗會終止執行**：固定指令碼報告失敗的 Round 和上一次成功交接，但不會重試；致命的工作流程基礎設施失敗可能在該狀態返回前結束。
- **聚合工作量僅受 Round 數量限制**：token、價格和耗時預算均暫緩處理。
