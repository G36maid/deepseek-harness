# @deepseek-ai/dsh-acp

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

透過 JSON-RPC stdio 提供的僅面向自動化的 [ACP（Agent Client Protocol）](https://agentclientprotocol.com) 伺服器。程序化用戶端可以建立新 harness agent（代理）、傳送文字提示詞、收集已提交的 assistant 文字、按策略回應一次性權限請求並取消工作。倉庫中的主要用戶端是 [`dsh-subagent-acp`](../../subagent/subagent-acp/README.md)。

此包是傳輸配接器，而非 UI 整合或能力 seam。它不公開編輯器導覽、transcript（文字記錄）重播、命令、模式、設定選擇器、資訊徵集、推理（reasoning）、計畫、標題或工具展示。互動式算繪與向使用者提問屬於 Web 宿主和用戶端模組。

## 外掛程式

`apply(ctx, config)` 在 stdin/stdout 上打開 `AgentSideConnection` 並驅動 `ctx.agents`。Stdout 專用於協定幀。

| 設定 | 預設值 | 含義 |
|---|---|---|
| `provider` | 無 | 每個已建立 agent 的初始提供方路由。 |
| `model` | 無 | 每個已建立 agent 的初始模型。 |

兩個欄位都是選填的，以便由另一個 agent/request 監聽器提供目標。可執行的 ACP 組合同時要求兩者。

## 協定約定

| 方法 | 行為 |
|---|---|
| `initialize` | 協商受支援的版本，並僅公佈基線提示詞（無影像、音訊或嵌入上下文能力）。不公佈工作階段、編輯器、終端機、檔案系統或 MCP 能力。 |
| `authenticate` | 空操作，因為伺服器不公佈身分驗證方法。 |
| `session/new` | 以絕對路徑作為主 `cwd` 建立新 agent；接受空的 `additionalDirectories` 和 `mcpServers`，拒絕非空值。 |
| `session/prompt` | 拼接文字塊，將基線資源連結算繪為帶方括號的文字引用，拒絕空輸入或超出基線的輸入，每個工作階段只允許一個正在處理的請求，並等待整個 agent 進入空閒狀態。正常完全靜止時報告 `end_turn`；顯式 ACP 取消、資源釋放，或准入被丟棄的提示詞（無輪次槽位）時報告 `cancelled`。 |
| `session/cancel` | 僅取消指定的 agent，並將其待處理提示詞結帳為 `cancelled`；未知 id 為空操作。 |
| `session/update` | 為每個非空文字塊寄出一個 `agent_message_chunk`；這些文字塊來自已提交的 `assistant/message`。省略原始增量和非訊息事件。 |
| `session/request_permission` | 為攜帶工具呼叫 id、由橋接層擁有的批准請求提供一次性允許／拒絕選項。用戶端可以自動回答。 |

一個連線可以擁有多個工作階段。橋接層以帶品牌的工作階段 id 作為記錄鍵，並在路由事件或權限請求前檢查 agent 是否為同一對象。每個工作階段都有獨立的提示詞槽位、工作區、取消路徑和資源釋放器。

已提交訊息輸出有意犧牲逐 token 輸出的低延遲，以換取乾淨的自動化結果。未提交的提供方區塊和重試嘗試無法洩漏部分文字；推理與工具活動仍保留在工作階段日誌中，以便其他介面觀測。

## 生命週期

用戶端中斷連線與 Cordis 釋放共用同一個記憶化清理流程。橋接層先拒絕新工作階段和提示詞，結帳待處理提示詞，然後只 drain 此連線確切擁有的 Agent 之下的可繼續後代，再平行釋放這些 handle，並等待全部結果結帳後才報告失敗。其他共享該上下文的前端會保留其可繼續森林和准入。因此，僅 ACP 的外掛程式重載不會殘留 agent。

ACP 要求每個提示詞回應都攜帶 `stopReason`，但橋接層不聲稱它表示提示詞專屬的輪次結果。已提交的 assistant 訊息會在整個自有活動期間流式輸出，agent 進入空閒狀態前發生的 steering（中途引導）或注入工作也可能參與其中。因此，因 token 上限而結束的輪次不會成為提示詞級 ACP 停止原因（它們以 `end_turn` 結帳）；關聯輪次上的模型錯誤會立即拒絕該提示詞。

## 執行

`pnpm --dir /path/to/deepseek-harness run demo:acp` 啟動倉庫的自動化伺服器組合。父 harness 可以透過 [`@deepseek-ai/dsh-subagent-acp`](../../subagent/subagent-acp/README.md) spawn 它；其他 ACP 用戶端只需上述核心方法。

## 模型體驗

### 提示詞文字

#### 模型看到的內容

`session/prompt` 文字塊會原樣拼接為一條使用者訊息；基線資源連結會在該訊息中表示為帶方括號的 `[resource_link name=… uri=…]` 引用，模型可以使用自身工具打開它。協定中繼資料、用戶端能力、權限選擇和工作階段 id 絕不進入模型請求。

#### Token 影響

提示詞 token 取決於資料，並保留在該工作階段的歷史中直到上下文壓縮（context compaction）。並行 ACP 工作階段保留獨立上下文。

#### KV Cache 影響

僅附加；新使用者訊息位於可複用請求前綴之後，不會使先前快取條目失效。

### 權限決策

#### 模型看到的內容

不會直接看到任何內容。所屬工具透過常規工具結果路徑記錄其結果：允許、拒絕、取消或不可用。

#### Token 影響

只有所屬工具的結果會貢獻 token。

#### KV Cache 影響

僅透過所屬工具的結果追加。

## 已知限制與暫緩事項

- **僅新工作階段**：不支援載入、列出、復原、刪除和 fork。
- **僅基線提示詞和一個 workspace**：影像、音訊、嵌入資源、非空附加目錄和 MCP 伺服器都會被拒絕；資源連結只會展平為文字引用，不會取得其內容。
- **僅已提交答案**：即時進度、推理、工具活動、計畫、標題和用量不會透過協定傳輸。
- **由連線管理的生命週期**：一個連線會釋放其所有工作階段；尚未實作單個工作階段關閉功能。
