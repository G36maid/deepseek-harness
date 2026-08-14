# @deepseek-ai/dsh-subagent-dsh-sdk

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

SDK 提供方會在全新的子行程中把每個 subagent 作為完整的 DeepSeek Harness 執行時期執行，並經由 [TypeScript SDK 用戶端](../../sdk/client/README.md) 透過 stdio JSON-RPC 驅動程式。它是 [`subagent-acp`](../subagent-acp/README.md) 之外的第二個行程外後端，差異在協定格式（wire format）和子行程約定：ACP（Agent Client Protocol）後端能驅動程式任何 Agent Client Protocol agent（代理）；本後端專門驅動程式 harness SDK 執行時期（`dsh-jsonrpc-agent` bin 或打包後的可執行文件），因此子行程是一個完整的對等 harness，擁有由 `cordis.yml` 決定的組合、工作階段持久化、模型路由和工具。

## 啟動與所有權

`start(request)` 先解析子行程工作目錄，透過 `DeepSeekHarness` spawn 執行時期，並在履行前完成 `initialize` 握手（攜帶設定的 `provider`/`model` 路由及選填的 `maxTokens` 輸出上限）。因此，履行意味著子執行時期已就緒、所有權已移交給呼叫方。spawn、握手或發布前取消失敗時，只會在子行程被回收後拒絕；工作目錄解析失敗則會在尚未 spawn 任何內容時拒絕。

工作目錄的解析與 ACP 後端完全一致，並使用 seam 共享的行程外輔助工具（[`dsh-subagent`](../subagent/README.md)）：設定了 `cwd` 覆蓋值時使用該值（載入時校驗一次），否則使用發起委派的父工作階段 cwd，絕不使用伺服器行程自身的 cwd。解析出的路徑同時成為子行程 cwd 和其 SDK 工作階段的工作區 cwd。

返回的 run id 在父級命名空間中生成；子執行時期的工作階段 id 只存在於子行程內部。發布後，提供方擁有一段 SDK 活動，並從子工作階段事件中讀取答案：最後一條完整且非空的 `assistant/message`（記錄 usage 的空內容訊息會被跳過）；若沒有這類訊息，則取累積的 `text-delta` 流。取消或發生錯誤後，部分輸出仍然可用。

`dispose()`（資源釋放）是冪等的：先在本機把結果確定為 `aborted`（協議層面沒有提示詞取消機制），再關閉執行時期，即先發出一次有界的協議 `shutdown` 請求，隨後透過共享的 stdin-EOF → SIGTERM → SIGKILL 階梯使行程實際退出。

## 停止原因對映

SDK 用戶端返回自有子活動，而不是提示詞結果。提供方讀取該活動內最後一個已持久化的 `turn/end`，並將其對映為 seam 詞彙：`completed` → `completed`，`max-tokens` → `max-tokens`，`aborted` → `aborted`；其餘情況，包括 `error`、`interrupted`、`disposed`、未來變體或不含輪次的活動，均對映為 `error`，因此非正常停止絕不會報告為成功。發布後的傳輸層失敗會透過 `onError` 診斷接收器（連線到 `ctx.logger.warn`）壓平為 `stopReason: 'error'`；seam 約定禁止 `result` 被拒絕。

## 能力與上下文

Provider 不宣告任何啟動期能力（`outputSchema`/`depthLimit`/`toolFilter`/`persona` 全為 false），且 `inheritsParentContext: false`：子行程是另一行程裡的全新執行時期，唯一來自父方的輸入是工作區 cwd。基於本 provider 的 `dsh-tool-subagent` 部署應設定 `maxDepth: 'provider-managed'`——子 harness 擁有自己的遞迴預算。

## 設定

| 鍵 | 默認 | 含義 |
|---|---|---|
| `providerName` | `dsh-sdk` | `ctx.subagents` 上的註冊名。 |
| `command` | 必填 | 每次執行時期 spawn 的可執行文件（子執行時期 bin 或打包後的可執行文件）。 |
| `args` | `[]` | 命令參數（通常是子行程的 `cordis.yml` 路徑）。 |
| `cwd` | 父工作階段 cwd | 工作目錄覆蓋；校驗規則與 [`subagent-acp`](../subagent-acp/README.md) 相同。 |
| `provider` | `deepseek-official` | 寫入子行程 `initialize` 的提供方路由。 |
| `model` | `deepseek-v4-flash` | 寫入子行程 `initialize` 的模型。 |
| `maxTokens` | 配接器／提供方路由預設值 | 寫入子行程 `initialize` 的單次請求輸出 token 上限；對子執行時期的根 agent 及其行程內後代生效。 |
| `env` | `{}` | 在憑據擦除後的父環境之上疊加的顯式子環境（例如子行程自己的 `DEEPSEEK_API_KEY`，或 `DSH_CORDIS_CONFIG`）。 |
| `shutdownTimeoutMs` | `1000` | dispose 期間協議 `shutdown` 交換的時限。 |
| `disposeEofGraceMs` | `6000` | stdin EOF 之後、平臺終止之前的寬限。 |
| `disposeGraceMs` | `3000` | 終止後的退出確認視窗；POSIX 在 SIGTERM 之後、SIGKILL 之前也等待同樣時長。 |

```yaml
- id: subagent-dsh-sdk
  name: '@deepseek-ai/dsh-subagent-dsh-sdk'
  config:
    providerName: dsh-sdk
    command: node
    args: ['./packages/examples/jsonrpc-demo/lib/bin.js', './examples/jsonrpc-agent/cordis.yml']
    maxTokens: 49152
    env:
      DEEPSEEK_API_KEY: !!js process.env.DEEPSEEK_API_KEY
- id: tool-subagent
  name: '@deepseek-ai/dsh-tool-subagent'
  config: { provider: dsh-sdk, toolName: subagent, maxDepth: 'provider-managed' }
```

## 行程邊界

子行程環境以 [`dsh-subprocess`](../../subprocess/README.md) seam 的 `scrubbedParentEnv()` 為基礎，先移除疑似憑據和名稱為 `DSH_*` 的環境變數，再合併顯式 `config.env` 值。子行程由 SDK 用戶端 spawn，而不是經由 `ctx.subprocess` spawn（這是 subprocess README 中記錄的 SDK 託管傳輸例外），因此本後端會自行執行環境清理。JSON-RPC 協定格式纔是真正的序列化邊界。

本包沒有默認匯出。否則 Cordis loader 解包會隱藏具名 `inject` 元資料；見[事後檢討（postmortem）0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)。

## 模型體驗

### 子 agent 請求

#### 模型看到的內容

子執行時期的模型會收到作為使用者訊息的獨立任務，以及該執行時期自身設定的系統提示詞、工具和全新工作階段。它不會收到父級對話。本提供方不聲明選填的啟動時能力，因此本機服務會拒絕要求 persona、工具過濾、深度強制或結構化輸出的請求，而不是靜默省略這些要求。

#### Token 影響

子執行時期會為獨立的完整上下文及其多步驟歷史消耗 token。這些 token 絕不會進入父級上下文。

#### KV Cache 影響

與父級請求快取相互獨立。每個 SDK 子行程只能複用其自身提供方、模型、組合和歷史均相同時的前綴；除此之外，子 agent 的步驟僅附加成長。

### 父級工具結果（間接）

#### 模型看到的內容

經由 `dsh-tool-subagent`，父級只會收到子執行時期最終的 assistant 文字（或累積的部分文字），或該消費端給出的精確停止原因錯誤；不會收到中間訊息或工具流量。

#### Token 影響

父級輸入只增加最終結果或錯誤，其大小取決於資料，並保留到壓縮（compaction）為止。本提供方自身不會向父級新增任何 schema。

#### KV Cache 影響

僅附加；新增可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **每次執行都使用全新的執行時期行程**：不使用行程池；harness 執行時期需要啟動完整的外掛程式樹，因此每次執行的 spawn 成本高於 ACP 後端通常使用的子行程。
- **不支持選填的啟動時能力**：父級無法在子行程內強制執行 `outputSchema`、深度限制、工具過濾或 persona；應改為設定子行程自身的 `cordis.yml`。
- **子行程的 transcript（文字記錄）保留在其自身的工作階段根目錄中**：父級日誌只記錄委派工具呼叫／結果（seam 的子級隔離規則）；流式 `session.event` 通道只用於提取輸出，不會橋接到父級日誌中。
- **僅支持本機子行程**：解析出的 cwd 是本機路徑；遠端執行時期需要獨立的後端。
