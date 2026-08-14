# @deepseek-ai/dsh-repeat-tool-reminder

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

這是一個僅提供建議的迴圈中斷器，而非面向模型的工具：它不會出現在工具清單中，不會否決或改寫呼叫，只增加一種行為。它監視每個 agent（代理）的工具呼叫流，統計以完全相同的規範化參數連續呼叫同一工具的次數；達到所設定的連續次數時，它會注入逐級增強的提示，要求模型停止重複、重新閱讀上一次結果，並改用其他方案或結束任務。究竟是換一種方式重試、收集更多證據還是完成任務，仍完全由模型決定：合理的重複呼叫既不會延遲，也不會受阻。決策記錄見 [repeat-tool-reminder Agent Note](../../../.agents/notes/archived/feature/2026-07-08-repeat-tool-guard.md)。

## 設定

```yaml
- id: repeat-tool-reminder
  name: '@deepseek-ai/dsh-repeat-tool-reminder'
  config:
    thresholds: [3, 5, 8]        # default; consecutive counts that trigger a reminder
    include: []                  # tool-name patterns to track; empty ⇒ all tools
    exclude: [todo_write]        # tool-name patterns transparent to the chain
    argumentsPreviewChars: 500   # default; cap on arguments quoted in the detailed reminder
```

外掛程式載入時，`thresholds` 會對錯誤設定快速失敗：空清單、非整數、小於 2 的值或重複值都會拋出錯誤，絕不靜默回退到預設值；`argumentsPreviewChars` 同樣只接受大於等於 1 的整數。系統會將清單按升序規範化；第一個閾值只發送簡短的通用提醒，後續每個閾值都會發送詳細版本，列出工具、連續次數和規範參數。參數內容擷取前 `argumentsPreviewChars` 個字元，並附帶省略字元數標記，避免迴圈中的 `write`／`edit` 載荷無限制進入下一次請求（鏈鍵始終比較完整的規範字符串；此上限只約束提醒，不影響偵測）。

`include`／`exclude` 條目支援 `*` 萬用字元，並針對呼叫時實際存在的工具執行謂詞判斷，而不是引用登錄檔條目。因此，與當前任何已註冊工具都不匹配的模式並非錯誤（未載入 MCP 工具的部署中，`exclude: [mcp_*]` 仍然有效）；這與 `toolOrder` 的引用目標檢查不同。

## 鏈語義

鏈鍵為「`(tool name, canonical arguments)`」：規範化程序會對鍵進行深度排序，然後執行 `JSON.stringify`，因此僅屬性順序不同的參數對象會視為相同。若某次呼叫與上一條受跟蹤呼叫相同，該 agent 的連續計數器遞增；換成另一條受跟蹤呼叫則重設為 1。

- **不受跟蹤的呼叫對鏈透明。** 被 `include`／`exclude` 排除的呼叫既不遞增計數器，也不重設計數器；因此，`grep X → todo_write → grep X` 仍算作連續兩次 `grep X`，即使 `todo_write` 已被排除。這正是排除機制的價值：迴圈中穿插的記錄類工具不能掩蓋迴圈。
- **被拒絕的呼叫也計數。** 偵測位於 `tools/post-execute`；即便呼叫被 `tools/pre-execute` 監聽器拒絕，該事件也會執行。模型反覆嘗試被拒絕的呼叫，恰恰是需要打斷的迴圈。
- **忽略沒有 agent 的呼叫。** 直接呼叫 `ctx.tools.execute()` 的呼叫方沒有需要提醒的模型，也沒有可作為鍵的活躍 agent 對象。
- **按 agent 分鍵。** 工具登錄檔位於上下文層級，subagent 會交錯透過同一個 waterfall（瀑布式事件），因此每條鏈使用 `WeakMap<Agent, Chain>`，以活躍 agent 對象為鍵。一個 agent 的重複呼叫絕不會觸發另一個 agent 的提醒。使用者提示詞（`agent/pre-step`）會重設提交該提示詞的 agent 鏈；對象生命週期會自然限制弱引用條目的壽命，無需 dispose（資源釋放）監聽器。
- **僅駐留記憶體。** 從持久化復原的工作階段會從一條全新的鏈開始：guard 是啟發式提醒，並非有日誌記錄的不變數；提醒會延後，這是可接受的代價。

## 提醒傳遞

提醒透過 post-execute 決策中的 `additionalContexts`（來源為 `{kind: 'plugin', plugin: 'repeat-tool-reminder'}`）傳遞，絕不替換 `content`；用於審計的 `tool/result` 事件仍保留工具自己的輸出。迴圈會緩衝這段上下文，並在該步驟的工具結果之後將其作為注入的 `user/message` 追加；工作階段會將它算繪為普通的合成使用者訊息。因此，提醒對模型可見、帶有來源歸屬，並且無需增加工作階段事件即可從工作階段日誌重建。guard 始終透過 `next()` 委派，並將自己的提醒放在下游決策的上下文陣列之前（兩種結果都適用：被阻止的呼叫也會收到提醒）；每個條目保留自己的來源和中繼資料。

## 模型體驗

### 首個閾值的上下文訊息

#### 模型看到的內容

達到第一個設定的連續重複閾值時，對應 agent 會收到以下提醒。系統不會新增工具 schema 或正常呼叫文字。

##### 首個閾值提醒

```markdown
You are repeating the exact same tool call with identical arguments. Carefully analyze the previous result before calling again: if the task is not complete, try a different approach or different arguments instead of repeating the call.
```

#### Token 影響

達到閾值前為零 token。提醒會作為該 agent 的歷史記錄保留。

#### KV Cache 影響

僅附加；新出現的內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

### 後續閾值的上下文訊息

#### 模型看到的內容

達到後續閾值時，agent 會收到以下詳細提醒樣板。受上限約束的參數預覽嚴格以 `… (+<omitted> more chars)` 結尾。

##### 後續閾值提醒

```markdown
Repeated tool call detected:
- tool: <toolName>
- consecutive_calls: <count>
- arguments: <canonicalArguments>
The repeated calls are not making progress. Do not call this tool with these exact arguments again. Inspect the latest result and choose a different action, different arguments, or finish the task if enough evidence has been gathered.
```

#### Token 影響

每條提醒都會作為歷史記錄保留；`argumentsPreviewChars` 會限制隨資料變化的參數文字長度，而各 agent 仍使用獨立計數器。

#### KV Cache 影響

僅附加；新出現的內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **僅偵測精確匹配**：規範化程序會對鍵進行深度排序，因此近似變體（稍作修改的路徑、值內增加的空白）可以繞過鏈；在沒有需求證據前，不採用模糊匹配。
- **壓縮（compaction）不會重設鏈**：跨越壓縮檢查點的鏈會繼續計數。
- **僅提供建議**：尚未實作達到較高閾值後升級為 `block`，但 `PostToolDecision` 已支援阻止呼叫。
- **subagent 之間不共享鏈**：鏈始終按 agent 隔離；即使父 agent 與其 subagent 重複相同調用，也不會合並計數。
- **合理的冪等輪詢超過閾值後仍會收到提醒**：可透過 `thresholds`／`exclude` 設定釋放壓力。
- **超過最高閾值後鏈不再提醒**：提醒只在精確達到所設定的次數時觸發，超過後不會繼續傳送。
