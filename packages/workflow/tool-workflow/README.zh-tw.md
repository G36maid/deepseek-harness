# @deepseek-ai/dsh-tool-workflow

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

面向模型的 **`workflow` 工具**：執行一段扇出 subagent 的 JavaScript 編排指令碼，並返回指令碼的最終值。本包負責基於 [`ctx.workflowEngine`](../workflow/README.md) 定義面向模型的 schema 和執行生命週期；指令碼解析、執行、上限與取消位於 seam 之後，消費端仍負責面向父級的 schema 和結果包絡。

## 模型看到的內容

工具有三個參數：`meta`（必需的身份資料：`name`、`description` 和選填的進度註解）、`script`（必需的純 JavaScript 指令碼體，不含 `export const meta` 語句；工具描述包含完整的編寫約定）以及 `args`（選填 JSON 對象，作為全域性變數 `args` 向指令碼公開；裸清單應包裝到欄位中，使協定 schema 如實表達形態）。外掛程式還會貢獻一個 `tool:<toolName>` 系統提示詞段，其中包含使用策略：只有使用者明確要求工作流程／大型編排時才使用該工具；一兩項委派優先使用普通 subagent 呼叫。這遵循工具指導隨工具外掛程式交付、絕不放入部署 persona 的約定。

## 生命週期

收集是同步的（類似 [`dsh-tool-subagent`](../../subagent/tool-subagent/README.md)）：`execute` 啟動執行並等待 `run.result`；這些操作位於 `try/finally` 中，該結構總會 dispose（資源釋放）執行，使指令碼及其子 agent（代理）在每條路徑上完全靜止。`exec.signal` 會橋接到 `run.cancel()`，包括啟動前已經中止的情況。非 `completed` 結束原因會對映為報告原因的 `isError` 結果，絕不會把區域性輸出當作成功；`start()` 同步拋出的解析／meta 失敗會變成模型可據以修正的 `isError`。完成時返回規範值 `{ runId, agentsStarted, result }`；Native 算繪器保留 meta 名稱、agent 數量和 JSON 值，只會在 `maxResultChars` 處截斷該投影。

對於根 transport 執行（`exec.parent` 預設），工具還會把執行投影到呼叫 Agent 的 Session：`start()` 返回後寫 run-start，只記錄 `run.id` 匹配的成員開始與結束，並且只在 `run.result` 已取得且 `dispose()` 完全靜止後寫 run-end。巢狀 transport 呼叫照常執行，但不寫工作流程記錄。任一次 Session append 首次失敗後，本執行會停止後續記錄並只告警一次，留下空記錄或合法連續前綴，同時不改變工具結果和清理。

瀏覽器安全的 `@deepseek-ai/dsh-tool-workflow/types` 子路徑擁有這四類 log-only 事件 payload 及其 `SessionEventMap` 聲明。包 invariant 會在冷載入和即時追加時拒絕重複 start、未配對成員、仍有開放成員的終點和 run-end 後更新，同時允許缺失終態後綴的連續前綴。

## 算繪意圖

算繪意圖預先確定（見[算繪意圖 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-02-tool-render-intent-union.md)）：使用一個 `generic` 卡片，標題為 `workflow: <meta.name>`，直接從 `args.meta.name` 讀取（呈現是參數的純函式，不要求引擎解析）；指令碼文字作為 `rawInput` 攜帶。結果繼續使用 generic 卡片。

## 設定

| 鍵 | 預設值 | 含義 |
|---|---|---|
| `toolName` | `workflow` | 要註冊的面向模型工具名稱。 |
| `maxResultChars` | `50000` | 算繪結果上限；更長的 JSON 會被截斷並附上提示。 |

## 模型體驗

### 系統提示詞

#### 模型看到的內容

在該外掛程式的註冊作用域內，每個父級請求都會收到下方的工作流程指導。作用域工具限制可以隱藏 schema，而不移除這段獨立註冊的指導。

##### 工作流程指導

```markdown
Use the <toolName> tool ONLY when the user explicitly asks for a workflow or for large multi-agent orchestration: you write a JavaScript script (the tool description documents the exact format) that fans work out across many subagents with phases and structured results. For one or two delegations, prefer plain subagent calls.
```

#### Token 影響

外掛程式啟用期間，每個請求都會產生少量固定的指導 token 開銷。

#### KV Cache 影響

只要外掛程式作用域和指導文字不變，前綴就保持穩定。啟用或 dispose 可能會使從該提示詞段起的快取複用失效。

### 工具 schema

#### 模型看到的內容

工具可見時，已生成的預設 [`workflow` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-workflow) 包含完整的 JavaScript 掛鉤與中繼資料約定；`toolName` 可以重新命名該定義，模型會提交指令碼、中繼資料和選填 args。

#### Token 影響

工具可見時，每個請求都會產生較大的固定 schema token 開銷。

#### KV Cache 影響

只要 `toolName`、定義和可見性不變，前綴就保持穩定。重新命名、外掛程式生命週期或作用域限制可能會使從該 schema 起的快取複用失效。

### 工具呼叫歷史與結果

#### 模型看到的內容

由模型編寫的完整指令碼、中繼資料和 args 會保留在 assistant 工具呼叫中。成功結果精確為 `workflow "<name>" completed (<count> agent<optional-s>).`、換行、`Return value:`、換行，以及經過美化列印且相依性資料的 JSON；達到上限時，會在新行新增 `… [truncated: <omitted> more characters]`。失敗結果精確為 `Error: workflow run was cancelled`（可以追加後綴 ` (<error>)`）、`Error: workflow run failed: <error-or-unknown error>` 或防禦性的 `Error: workflow run ended abnormally (<reason>)`；沒有所屬 agent 的呼叫變為 `Error: workflow tool requires a calling agent (exec.agent was undefined)`。中間子 agent 訊息會被省略。

#### Token 影響

呼叫 token 可能很多，並會保留到壓縮（compaction）為止。結果算繪受 `maxResultChars` 限制；子模型 token 與父級保留的上下文相互獨立。

#### KV Cache 影響

僅附加；新增可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **父級輪次會阻塞到整個工作流程結帳**：沒有後臺啟動／輪詢介面，取消會丟棄區域性輸出並返回錯誤。
- **`args` 必須是對象，Native 結果文字有界**：呼叫方把頂層陣列／標量包裝到欄位中；規範工作流程結果保持完整，超過 `maxResultChars` 的 JSON 會在面向模型的投影中截斷，而不是儲存在檢索控制代碼背後。
- **每次工具註冊的工作流程策略固定**：提供方選擇、上限和工具名稱屬於部署設定，不是模型呼叫參數。
- **持久記錄只覆蓋頂層且只供觀察**：巢狀 Code Mode dispatch 不記錄；記錄故障會刻意退化為不完整前綴，而不改變執行。
