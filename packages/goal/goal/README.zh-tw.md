# @deepseek-ai/dsh-goal

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

事件溯源的同工作階段目標狀態。該服務在 agent（代理）的現有工作階段中保留一個當前待完成目標，同時將繼續執行的權限作為行程本機續行啟用狀態。[goal 領域 Agent Note](../../../.agents/notes/implemented/feature/2026-07-19-persisted-same-session-goal-domain.md) 負責設計理由；[goal 類型目錄](../../../docs/subsystems/goal.md)記錄具體的資料形狀。

## 設定

```yaml
- id: goal
  name: '@deepseek-ai/dsh-goal'
  config:
    defaultMaxGoalRounds: 256
```

`defaultMaxGoalRounds` 必須是正的安全整數。`create()` 會在提交目標前於內部物化這項部署預設值；請求級取值可以覆蓋它。

## 服務約定

`ctx.goals` 只接受以對應 id 註冊的完全相同的活躍 `Agent` 實例。`get()` 返回與內部狀態脫離的 `GoalView`；變更以 `GoalRef { id, revision }` 作為比較並設定防護，並拒絕過時引用。服務透過 [goal.md](../../../docs/subsystems/goal.md#cordis-surface) 的生成區塊公開 create、edit、pause、resume、complete、block 和 clear 動詞。建立預設值在內部解析。`disarm()` 是僅供生命週期使用的例外：它移除行程本機續行權限，不寫入新 revision，也不寄出變更事件。

最多隻有一個當前目標。建立操作會生成 revision 為 1、phase 為 active 的目標並啟用續行。未完成的目標必須編輯、轉換或清除；已完成目標可以由擁有全域性未使用過的 id 的目標替換。編輯會保留 phase、blocker reason 與 activation。暫停、完成、阻塞和清除都會停用續行。阻塞會記錄策略自有的 lower-kebab-case 程式碼和規範化的自由文字說明；提供方限制、設定預算、執行錯誤與請求人工輸入都使用這一種持久 phase，不會擴增生命週期狀態。只有設定的 Round 上限仍有剩餘容量時，resume 才接受已停止 phase 或 phase 為 active 但已停用續行的目標；它會清除原 blocker reason。phase 為 active 且已啟用續行的目標會拒絕冗餘操作。

每次變更都會追加持久的 `goal/change` 事件，其中攜帶變更後的完整快照；clear 使用帶 revision 的 tombstone。因此，goal 狀態不相依性 inbox 放置、領取、准入或丟棄。工作階段日誌是唯一的持久權威。

嚴格重播只從 `goal/change` 派生生命週期變更，並拒絕形狀錯誤、不連續 revision、非法生命週期轉換、每目標時間戳非單調，以及不連續的已准入 Goal Round。只有來源為 goal 且已准入的 `user/message` 事件會推進正數 Round。掛鐘時間倒退時，變更時間戳會限制在不早於上一次目標更新的值。增量重播會把遊標保留在第一個損壞事件處；`goal/changed` 會在持久事件提交後觸發，監聽器失敗會被隔離處理。

續行啟用狀態絕不持久化。新快取與每次觸發 `agent/session-start` 時都會停用續行，即使重播找到了持久 phase 為 active 的目標。續行驅動器在解除安裝前或持久性不確定後也會呼叫 `disarm()`。因此，工作階段復原、fork 與驅動器替換會保留目標、phase、revision 和已准入 Round 數量，卻不會啟動工作；之後必須透過顯式 resume 變更重新啟用續行。

單獨發布的 `./invariant` 配套模組會為每個已掛接工作階段維護獨立摺疊。它會在候選事件進入持久日誌前拒絕格式錯誤的 goal 變更、不連續 revision、非法生命週期轉換、時間戳回退，以及不連續的已准入 Round。

## 擴充點

策略外掛程式呼叫服務動詞，並回應限定範圍的 `goal/changed` 事件。續行消費端將 Round 准入為 `user/message` 事件，並攜帶 `GoalMessageSource`；普通的人類輪次絕不會增加 `roundsStarted`。消費端使用 `Agent` 介面和事件，不匯入 `dsh-agent-loop`。

## 模型體驗

### 目標狀態變更

#### 模型看到的內容

Goal 變更不會注入模型上下文。`get_goal` 等工具返回當前狀態；繼續執行消費端可以在調度模型工作時算繪目標描述與 Round 狀態。未來如果需要始終可見的 goal 上下文，應由獨立上下文外掛程式實作，而不是放在持久化路徑中。

#### Token 影響

Goal 變更事件本身不增加模型 token。工具結果和續行調度提示詞各自暴露的狀態會分別計入 token 用量。

#### KV Cache 影響

在其他元件把 goal 狀態暴露為模型可見輸入之前，不會影響 KV Cache。

## 已知限制與暫緩事項

- **只負責狀態，不負責任務調度**：此包不決定已啟用續行的目標何時繼續，不重試例外失敗，也不取消活躍輪次；這些策略屬於 agent seam 消費端。
- **只有 Round 數量預算**：`maxGoalRounds` 不計量 token、貨幣、掛鐘時間或提供方配額。
- **沒有獨立評估器**：記錄完成或阻塞的呼叫方擁有最終決定權；由評估器支援的驗證暫緩到獨立策略層。
- **只有一個當前目標**：系統有意不支援平行目標或獨立目標資料庫；替換或清除後，歷史仍可在工作階段日誌中讀取。
- **信任行程內生產方**：能直接訪問 `Session` 的外掛程式可以追加偽造的 `goal/change` 資料。嚴格重播會偵測格式錯誤或不一致的記錄，並使 goal 訪問從該記錄起失敗，直到日誌修復；這是完整性偵測，不是外掛程式隔離。
