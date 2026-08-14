# @deepseek-ai/dsh-commands

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

由外掛程式負責、供互動式 UI 配接器使用的面向使用者命令登錄檔。[外掛程式命令註冊 Agent Note](../../../.agents/notes/implemented/feature/2026-07-19-plugin-command-registration.md)定義了其邊界與分發約定。

## 服務約定

`ctx.commands.register(definition)` 註冊一個小寫命令名稱、描述、選填的非結構化輸入提示、選填的 `recordInput` 策略，以及可中止的處理器。`recordInput` 預設為 true；若載荷由命令的權威領域事件持有，該命令會將 `recordInput` 設為 false，讓 `command/run` 省略 `args`，避免重複記錄輸入。每個已註冊命令都可供所有已組合的命令配接器使用；與某項部署不相容的外掛程式不會在此註冊。普通上下文中的註冊全域性生效。在 `agent.ctx` 下掛載的命令生產外掛程式會聲明自身的 `commands` 注入，並建立精確限定到該 agent（代理）的定義；該定義會遮蔽同名的全域性定義。這種子級注入形態保留了 agent 作用域，同時不會讓核心 agent loop（代理循環）相依性 UI 服務。同一層中的名稱重複會在註冊時失敗。每個 disposer 都是 Cordis effect 返回的確切 disposer；註冊或移除命令時，系統會通知每個 `commands/change` 觀察者，使執行中的配接器能夠刷新發現結果。觀察者失敗會寫入日誌，既不能否決登錄檔變更，也不能阻止後續觀察者執行。

`list(agent)` 在應用作用域遮蔽後，返回按名稱排序的不可變描述符。`find(agent, name)` 返回相應定義。`execute(agent, line, signal)` 使用 `parseCommand()`，且只執行已知命令，返回已結帳的 `CommandExecution`（規範化結果加生命週期配對 `commandId`）；文法無效或名稱未知時返回 `undefined`。已解析命令的生命週期會以 log-only 事件對的形式記錄在接收 agent 的工作階段日誌中：`command/run`（進入處理器前記錄，攜帶新生成的 `commandId`、解析器的結構化名稱、發起方 `CommandSource`，以及 `args`（`recordInput` 為 false 時省略））與 `command/done`（結帳時記錄，攜帶結果類型與原樣文字；成功結果還可透過 `sourceEventSeq` 指向更早的一條非命令權威領域事件；處理器拋出或被中止時以 `kind: 'error'` 結帳）。未透過准入的輸入不記錄任何事件。兩者都直接獨立追加到接收 agent 的工作階段中：沒有輪次包裹它們，持久化機制會在常規檢查點和銷毀期間排空這些事件。

`parseCommand()` 識別位於第 0 位元組的斜槓、由小寫字母、數字、`_` 或 `-` 構成的名稱，以及名稱後緊接輸入末尾或空白的形式。它將名稱後的每個位元組作為 `rawInput` 返回，其中包括分隔空白；消費端負責各命令專用的文法，只能執行該文法允許的規範化。

處理器返回 `success` 或 `error`，並可附帶 UI 文字。若更豐富的呈現由一條更早的領域事件持有，成功的處理器還可返回 `sourceEventSeq`；生命週期不變數要求該引用指向同一工作階段中更早的一條非命令事件。配接器直接渲染結果，結果絕不進入模型歷史。登錄檔絕不會隱式地把 `rawInput` 提交給 agent；命令生產方可以透過接收命令的 `Agent` 顯式安排模型可見工作，此時該生產方負責由此產生的訊息約定。登錄檔會同時等待處理器完成和所提供的中止訊號，以先發生者為準，但不回應中止的處理器可能在呼叫方停止等待後繼續產生自身的外部副作用。

## 組合

隨產品交付的 `dsh` 基礎組合會掛載此服務，Web 用戶端透過它分派命令。無 UI 的演示主幹和 ACP（Agent Client Protocol）自動化不提供命令配接器。自訂互動式組合與命令生產方會顯式掛載 `@deepseek-ai/dsh-commands`。

## 模型體驗

### 直接面向使用者的命令

#### 模型看到的內容

登錄檔自身不會提交任何內容。已知斜槓命令在 UI 命令平面執行，其 `CommandResult` 文字不會作為使用者訊息提交。已交付的配接器會拒絕未知斜槓命令輸入，而不是將其變成模型提示詞。命令生產方可以顯式使用接收命令的 `Agent`；例如，[`dsh-plan-mode`](../../plan/plan-mode/README.md#model-and-human-interactions)在選擇 plan mode 後，會提交 `/plan [message]` 中的選填訊息。

#### Token 影響

命令發現、執行和 UI 輸出不會增加模型 token。命令生產方顯式安排的 agent 工作與相應 agent 輸入具有相同的 token 影響。

#### KV Cache 影響

登錄檔元資料、命令輸入和直接輸出絕不會進入模型請求，也不會影響其快取。發生變更的領域負責之後產生的所有快取影響。

## 已知限制與暫緩事項

- **僅支持非結構化文字輸入**：表單、補全 schema 和類型化參數仍由各命令自行解析。
- **副作用採用協作式取消**：中止後，分發會停止等待；處理器必須遵循訊號，才能停止已經進入外部系統的工作。
