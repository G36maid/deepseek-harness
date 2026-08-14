# @deepseek-ai/dsh-subagent-acp

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

ACP（Agent Client Protocol）提供方會在全新的子行程中執行每個 subagent，並作為 Agent Client Protocol 用戶端驅動它。這是 spawn 與 fork 的行程外替代方案：子 agent（代理）擁有自己的執行時期、工作階段、模型設定和工具。

## 啟動與所有權

`start(request)` 先解析子 agent 的工作目錄，再依次執行 `spawn` → ACP `initialize` → `newSession`，然後才兌現。因此，兌現表示遠端工作階段已就緒，所有權也已轉移給呼叫方。spawn 失敗、初始化失敗、新建工作階段失敗或因發布前取消而失敗時，只有在子行程已回收後才會拒絕；工作目錄解析失敗則會在尚未 spawn 任何行程時拒絕。

工作目錄優先使用已設定的 `cwd` 覆蓋值，否則使用執行委派的父工作階段 cwd，絕不使用伺服器行程自身的 cwd，因為同一個伺服器行程會服務來自多個工作區的工作階段。從父級取得的值必須是絕對路徑，指向 harness 可以進入的目錄（具備搜尋權限，這是子行程 cwd 的要求）；解析後的同一路徑同時作為子行程 cwd 和 ACP `session/new` 工作區。

返回的執行 id 在父級命名空間中生成。子伺服器的工作階段 id 只用於 ACP 協議呼叫，因為 ACP 只保證它在該全新子行程中唯一；若將其用作父級生命週期 id，可能與另一個遠端執行或本機 agent 衝突。

發布後，提供方傳送提示詞，並把流式 `agent_message_chunk` 文字收集到 `SubagentResult.output`。提示詞/傳輸失敗會以 `stopReason: 'error'` 兌現；如果必需的請求訊號或 dispose（資源釋放）請求了取消，則以 `aborted` 兌現。

`dispose()` 是冪等的。它會移除訊號監聽器，在可行時請求 ACP 取消，然後使用該 seam 定義的操作執行本後端自有的拆卸階梯（`disposeAcpChild`）：先關閉 stdin 並等待 `disposeEofGraceMs` 讓子行程協作式完全靜止，再觸發控制代碼的 `terminate()` 升級（SIGTERM、spawn 寬限期、SIGKILL——Windows 直接強制終止），並等待子行程責任方給出整棵行程樹的退出證明。每次執行都使用全新行程；尚未實作行程池。

## 能力與上下文

ACP 不聲明任何啟動時能力，因為當前行程無法強制執行遠端子 agent 的深度、工具過濾、persona 或結構化輸出執行時期。它也報告 `inheritsParentContext: false`：遠端工作階段從全新狀態開始，唯一源自父級的輸入是上述工作區 cwd；對話上下文不會跨越行程邊界。

## 設定

| 鍵 | 預設值 | 含義 |
|---|---|---|
| `providerName` | `acp` | `ctx.subagents` 上的登錄檔名稱。 |
| `command` | 必填 | 每次執行時期 spawn 的可執行文件。 |
| `args` | `[]` | 命令參數。 |
| `cwd` | 父工作階段 cwd | 子行程及其 ACP 工作階段的工作目錄覆蓋值；不得為空。相對值會在載入時以 harness 啟動目錄為基準解析，結果必須指向 harness 可以進入的目錄。 |
| `permission` | `reject` | 自動回答權限請求：拒絕，或選擇第一個 `allow_once` 或 `allow_always` 選項。 |
| `env` | `{}` | 顯式子行程環境，疊加到已清理憑據的父行程環境之上。 |
| `disposeEofGraceMs` | `6000` | stdin EOF 之後、平臺終止之前的寬限時間須為正值，且不得大於 [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md)。 |
| `disposeGraceMs` | `3000` | POSIX 在 SIGTERM 後、SIGKILL 前的寬限時間（Windows 直接強制終止），須為正值且不得大於 [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md)。 |

```yaml
- id: subagent-acp
  name: '@deepseek-ai/dsh-subagent-acp'
  config:
    providerName: acp
    command: node
    args: ['--import', 'tsx', './packages/examples/acp-demo/src/bin.ts', '--config', './examples/acp-agent/cordis.yml']
    permission: reject
    env:
      DEEPSEEK_API_KEY: !!js process.env.DEEPSEEK_API_KEY
```

## 結束原因對映

| ACP | Harness |
|---|---|
| `end_turn` | `completed` |
| `max_tokens` | `max-tokens` |
| `refusal` | `refusal` |
| `cancelled` | `aborted` |
| `max_turn_requests` 或未知值 | `error` |

## 行程邊界

子行程經由 [`dsh-subprocess`](../../subprocess/subprocess/README.md) seam spawn：共享的憑據清除先移除疑似憑據的環境變數和環境中已有的 `DSH_*` 名稱，顯式 `config.env` 值在清除之後合併（有意轉發的 `DEEPSEEK_API_KEY` 會保留下來，`DSH_PERMISSION_MODE` 這類 `DSH_*` 部署事實也以同樣的方式到達子行程——清除只丟棄其過時的同名環境值），stderr 會繼承到父行程自身的流，dispose 則先應用本外掛程式的 EOF 時間窗，再由子行程責任方執行 SIGTERM→SIGKILL 升級並等待整棵行程樹退出。ACP 協定格式（wire format）是真正的序列化邊界；同進程 subagent 值不會為防禦目的而克隆。

本包沒有默認匯出。否則 Cordis loader 的解包會隱藏具名 `inject` 元資料；見[事後檢討（postmortem）0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)。

## 模型體驗

### 子 agent 請求

#### 模型看到的內容

遠端子 agent 透過 ACP 接收獨立任務內容，並使用其自身行程設定的系統提示詞、工具和全新工作階段。它不接收父級對話。該提供方不聲明任何選填啟動時能力，因此本機服務會拒絕要求 persona、工具過濾、深度強制或結構化輸出的請求，而不是靜默省略這些要求。

#### Token 影響

子 agent 為獨立的完整上下文及其多步驟歷史付款 token 成本。這些 token 絕不會進入父級上下文。

#### KV Cache 影響

與父級請求快取相互獨立。每個 ACP 子 agent 只能在其自身提供方、模型、組合和歷史均相同時複用前綴；其餘情況下，子 agent 步驟僅附加成長。

### 父級工具結果（間接）

#### 模型看到的內容

透過 `dsh-tool-subagent`，父級只接收子 agent 最終的流式 assistant 文字，或該消費端給出的精確結束原因錯誤；不接收中間訊息或工具流量。發布前已經取消的請求會精確變為 `Error: subagent request was aborted before the ACP child started`；其他啟動失敗按原樣傳遞為 `Error: <message>`。

#### Token 影響

父級輸入只增加最終結果或錯誤，其內容相依性資料，並保留到壓縮（compaction）為止。該提供方自身不會新增父級 schema。

#### KV Cache 影響

僅附加；新增可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **每次執行使用全新行程**：持久行程池屬於後續最佳化（見 [seam Agent Note](../../../.agents/notes/implemented/feature/2026-06-21-subagent-capability-seam.md)）。
- **僅支持本機工作區**：解析後的 cwd 是交給同一臺機器上子行程的本機路徑；遠端 ACP agent 的工作區對映需要獨立的後端能力，此處尚未設計這種能力。
- **不支持選填啟動時能力**：該提供方無法在遠端行程內應用本機 harness 的 `outputSchema`、深度上限、工具過濾器或 persona，因此不會聲明這些能力；服務會拒絕需要它們的請求。
- **只收集已提交的 `agent_message_chunk` 文字**：自動化伺服器把推理（reasoning）、工具活動、計畫和其他 trace 資料保留在子 agent 工作階段日誌中，不透過 ACP 寄出。
- **權限提示自動回答**（`permission: allow | reject`）：不會把子 agent 的 `session/request_permission` 呈現給人。
