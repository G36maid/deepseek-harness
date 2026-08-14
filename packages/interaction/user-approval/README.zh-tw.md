# @deepseek-ai/dsh-user-approval

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

與通道無關的一次性審批 seam。`ctx.approval.request(req)` 返回 `allowed-once`、`rejected`、`cancelled` 或 `unavailable`；應答者缺失或失敗時會以拒絕方式關閉，授權也只適用於所請求的操作。確切事件簽名見 [approval.md](../../../docs/subsystems/approval.md#cordis-surface) 的生成區塊。

每個請求都必須屬於一個尚未結束的 agent（代理）輪次。服務會追加一對 `approval/asked` 與 `approval/decided` 審計記錄，而模型只會看到由此產生且已寫入日誌的工具結果。已中止的請求會解析為 `cancelled`；如果審計記錄的追加在提交前失敗，Promise 會被拒絕，而不會返回一項未記錄的決定。

應答者是 `approval/request` waterfall（瀑布式事件）監聽器。要回答其負責的 agent 請求，請返回一個結果；否則呼叫 `next()` 委託。限定到 agent 的監聽器只接收該 agent 的請求；每項部署應當組合一個最終應答者，因為同級監聽器的順序不是策略優先級機制。ACP（Agent Client Protocol）自動化橋接層為其負責的工作階段提供一次性機器決定。

`ApprovalPolicy` 為 `'ask'` 或 `'never'`。實際值取最後一條 `approval/policy` 事件，並回退到設定；`setApprovalPolicy()` 是寫入路徑。`'never'` 會在互動式分發之前拒絕請求。兩種策略都會將各自完整的當前含義貢獻給快取安全的執行時期上下文快照。

工具管線透過此 seam 路由 `ask` 決定，並在該 seam 缺失時以拒絕方式關閉；沙盒 bash 工具也會將它用於升權重試。ACP 自動化橋接層根據用戶端的機器策略，回答其自有 agent 的呼叫。審計事件仍只寫入日誌，因此模型只會看到發起請求的消費端所返回的結果。詳見[審批 seam Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-approval-seam.md)和[沙盒 Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md)。

## 模型體驗

### 當前審批策略上下文

#### 模型看到的內容

首次請求和有效策略每次變化時，都會在保留的歷史後追加一份完整執行時期上下文快照。在 `ask` 下，審批上下文內容會說明系統可以諮詢已設定的應答者，缺少可用應答者時則以拒絕方式關閉。在 `never` 下，它會說明確定性的拒絕與非升權後果。未變化的請求會保留先前快照，不增加另一則訊息。

##### Ask 策略貢獻

```markdown
Approval policy: ask. Operations that require approval may ask through the configured answerers; without an available answerer, the request fails closed.
```

##### Never 策略貢獻

```markdown
Approval prompts are disabled in this session: actions that require approval are rejected automatically — do not request sandbox escalation (do not set `sandbox_permissions`).
```

#### Token 影響

首次請求和策略實際變化時增加一條簡潔的上下文訊息；未變化的請求不增加重複的策略 token。

#### KV Cache 影響

在保留的歷史之後僅附加。`ask`／`never` 切換會保留穩定的系統與對話前綴，而不會改寫第一條 wire 訊息。

### 工具結果

#### 模型看到的內容

`approval/asked` 和 `approval/decided` 只寫入日誌。模型只會看到發起請求的消費端最終給出的允許、拒絕、取消或不可用工具結果；面向人類的權限 UI 不屬於上下文。

#### Token 影響

不會產生重複的審計 token。拒絕可能以一條簡短且會保留的錯誤資訊替換正常工具結果，而允許會保留消費端的普通結果。

#### KV Cache 影響

僅附加；新出現的可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **請求只在尚未結束的輪次內有效**：在空閒時或輪次之間發起呼叫，會在審計前拋出例外；持久化的輪次外審批工作流程仍屬暫緩事項。
- **僅存在一次性授權**：結果詞彙包含 `allowed-once`，但不含 `allow-always`、已記住的規則、撤銷或授權儲存；工作階段策略只有 `ask`／`never`。
- **請求不攜帶工具參數**：應答者會看到工具名稱、原因和選填呼叫 id；ACP 機器通道要求呼叫 id，並會委託不含 id 的請求。
- **沒有內建應答者**：無頭或組合不完整的部署會返回 `unavailable` 並以拒絕方式關閉；服務自身絕不會提示人類。
