# @deepseek-ai/dsh-command-feedback

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

與觸發方式無關的工作階段回饋，以及面向使用者的 `/feedback` 採集。本包匯出 `recordFeedback(session, text)`；該函式會追加一個僅寫入日誌的 `feedback/record` 事件。該外掛程式透過 [`ctx.commands`](../../interaction/commands/README.md) 註冊一個全域性命令，因此每個已組合的命令配接器都能發現它；隨附的 Web 用戶端無需模型輪次即可執行。

## 命令約定

| 輸入 | 結果 |
|---|---|
| `/feedback <text>` | 追加 `feedback/record`，並以 `Feedback recorded for session {sessionId}`、`Anonymous user: {userId}` 加工作階段共享披露確認。 |
| `/feedback` | 返回一個直接用法錯誤。僅含空白的輸入視為空輸入。 |

前後空白會被丟棄，但除此之外，回饋內容不會被解析：不進行截斷或大小寫摺疊，也不識別控制詞。看起來像另一個命令的文字（例如 `/feedback /plan felt slow`）就是回饋內容。重複執行命令時，每次都會產生一個事件；不會發生替換或合併。

## 工作階段共享披露

確認文字會點名接收工作階段的 id，並報告該工作階段如何被共享；該資訊透過外掛程式上下文（`ctx.get('telemetry')`，絕不是聲明的注入）從已掛載的 [`telemetry`](../../session/session-telemetry/README.md) 服務讀取。披露是依據後端 [`SessionTelemetrySharingStatus`](../../session/session-telemetry/README.md) 選擇的一句話：

| 披露的狀態 | 確認文字中的句子 |
|---|---|
| `full` | `Session sharing is enabled.` |
| `feedback-only` | `Session sharing is feedback-gated; recording feedback releases the session prefix for sharing.` |
| `disabled` | `Session sharing is disabled.` |
| 無服務 | `Session sharing is not configured.` |

披露只陳述部署當前的共享策略，絕不承諾投遞或留存：在 `full` 或 `feedback-only` 下，記錄被交給後端的非阻塞入隊，批次處理、重試與丟失策略歸 SDK 負責，因此句子不聲稱任何內容已到達採集端；`disabled` 也不聲稱未來不會重新設定。披露不新增任何事件，也絕不會進入模型 surface。

## 本外掛程式做什麼、不做什麼

`recordFeedback(session, text)` 是不相依性命令的寫入路徑。它拒絕規範化後為空的文字，並追加 `feedback/record { text }`；其他 UI、掛鉤或 host 整合無需構造斜槓命令即可呼叫它。`/feedback` 處理器透過該函式寫入，且不啟動任何模型工作。選填的 [`dsh-session-telemetry-otel`](../../session/session-telemetry-otel) 消費端會觀察該事件，但不改變它的採集約定。

回饋文字只出現在一個持久載荷中：`feedback/record`。[`dsh-commands`](../../interaction/commands/README.md) 仍會追加通用的 `command/run` / `command/done` 配對，但此定義設定了 `recordInput: false`，因此 `command/run` 會省略 `args`；配對的 `command/done` 只攜帶結果。三個事件都僅寫入日誌，不出現在有序 surface、`deriveMessages()` 以及模型請求中。這些追加會啟動持久化的常規即時排空，但兩個生產方都不會強制 `session/flush`，因此確認文字表示回饋已進入日誌，而不表示它已經落盤。確認文字同時標明接收回饋的工作階段和[共享匿名使用者](../../identity/anonymous-user-id/)；對於某個 harness home，首次接受回饋時可能建立 `$DSH_HOME/.anonymous-user-id`。被拒絕的空輸入只會留下以 `kind: 'error'` 結帳的命令配對，不會產生 `feedback/record`，也不會尋找使用者 id。

權威記錄是該事件，而不是命令記錄，因為回饋可能來自 `/feedback` 之外的觸發方式。讓載荷不進入 `command/run`，可避免兩條記錄攜帶相同文字。

## 組合

生產方只注入 `commands`。自訂應用掛載登錄檔以及本外掛程式：

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: command-feedback
  name: '@deepseek-ai/dsh-command-feedback'
```

隨附的 `dsh` 基礎組合無條件掛載此命令；它沒有設定，也不相依性持久化 goal 棧。Web 用戶端透過命令配接器暴露該命令。無頭模式、ACP（Agent Client Protocol）自動化和 JSON-RPC 不提供命令配接器，因此不會暴露它。

## 模型體驗

### 使用者 `/feedback` 採集

#### 模型看到的內容

無。斜槓輸入、`feedback/record` 以及確認文字都不出現在模型請求中。回饋事件和登錄檔生命週期記錄僅寫入日誌且不攜帶 `surfaceOp`，因此它們絕不會進入有序 surface、`deriveMessages()` 或系統提示詞。在某個輪次中記錄回饋不會改變該輪次剩餘的請求。

#### Token 影響

無直接 token 影響。無論是已接受的條目還是用法錯誤，都不會在記錄所在輪次或此後任何輪次增加模型 token。

#### KV Cache 影響

與模型請求路徑無關。記錄只追加到工作階段日誌，不觸碰已經可複用的請求前綴。本包貢獻的任何內容都不會使快取複用失效。

## 已知限制與暫緩工作

- **沒有回饋檢索或管理 surface**：選填的 OTel 外掛程式僅將該事件用作共享觸發器。本包不為 `feedback/record` 提供檢索、聚合、分類或面向模型的工具。
- **沒有結構化欄位**：一條條目就是一個自由文字字串，沒有類別、嚴重程度或關聯事件連結，因此無法在不重讀文字的情況下按主題過濾回饋。
- **不支持修改或撤回**：工作階段日誌是僅附加的，本包也不新增 tombstone，因此錯誤的條目會一直保留在記錄中，只能由後續條目取代。
- **沒有顯式持久化屏障**：確認文字緊隨追加而非 flush，因此緊臨崩潰前記錄的條目可能與其他未 flush 的尾部一同丟失。為回饋強制同步寫盤並不值得；需要該保證的消費端可自行等待 `ctx.sessions.flush(session)`。
- **新工作階段上沒有可見的確認**：Web 轉錄只在工作階段啟用後渲染命令列，因此在仍為空白的新工作階段上執行 `/feedback` 會記錄事件但不會顯示確認行。傳送首則訊息後再記錄回饋即可正常渲染。
- **隨附的產品入口中只有 Web 使用此命令**：無頭模式、ACP（Agent Client Protocol）自動化和 JSON-RPC 不提供命令配接器，因此 `/feedback` 在那裡不可用。
