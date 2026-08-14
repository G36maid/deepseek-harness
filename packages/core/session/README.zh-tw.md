# dsh-session

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

事件溯源的工作階段日誌和記憶體儲存。`Session` 是 agent（代理）全部互動歷史的僅附加真源，LLM（大型語言模型）訊息歷史由它*派生*。原始日誌之上維護一個 **surface** 層（產生訊息事件的有序投影），以便高效派生和壓縮（compaction）。

選填配套入口 `@deepseek-ai/dsh-session/invariant` 將此包的關係軌跡檢查註冊到 `ctx.invariants`：序號單調遞增、輪次／步驟閉合，以及同一步驟內的工具呼叫／結果配對。載入或重新載入時，它會重播現有工作階段；儲存校驗、快照、凍結、被引用的源事件校驗和 surface 准入仍始終由根工作階段包負責。

## 服務：`SessionStore`（ctx 鍵：`sessions`）

建立並持有事件溯源的 `Session` 實例。這裡有意不實作持久化：外掛程式訂閱 `session/event`，在 `session/flush` 時刷新，並可映像檔成對的 `session/created`／`session/disposed` 生命週期。

### 公共 API

- `ctx.sessions.create(id?, { seed?, meta? }?)` 校驗持久種子／頭部資料並生成脫離副本，補齊版本和 id，在未提供 `createdAt` 時使用當前時間，發布工作階段並將其綁定到呼叫方 fiber。持久化重建會提供原始的 `createdAt`、`seedLength` 和 `delegationDepth`。
- `ctx.sessions.flush(session)` 透過工作階段捕獲的作用域分發一個需等待完成的平行持久性檢查點。每個監聽器都會啟動；呼叫會等待全部結帳後才報告失敗。未發布、已脫離和過時的對象會被拒絕。
- `ctx.sessions.fork(source, boundary?, childSessionId?): Session`：解析即時工作階段對象或 id，選取截至 `boundary` 事件序號（含該事件）的種子（預設為當前最後一個事件），要求所選前綴結束時沒有開放輪次，再建立帶譜系中繼資料的即時子工作階段。
- `ctx.sessions.get(id: SessionId): Session | undefined`
- `ctx.sessions.list(): Session[]`

#### 進階：有序清理生命週期原語

僅在清理必須與另一項資源排序時使用拆分生命週期：

- `prepare(id?, options?)` 校驗並構造，但不發布。
- `enter(session)` 執行衝突檢查，在不通知的情況下發布，並返回一個綁定到該條目的冪等脫離函式。允許並行準備相同 id，但只有一個條目能夠成功進入；過時的脫離函式無法移除其替代項。
- `announce(session)` 寄出唯一一次建立邊，並拒絕重複或重入通知。該次分發期間請求的脫離操作會延後，之後再發出成對的釋放邊；未通知的條目不會發出任何生命週期邊。

`dsh-agent-loop` 使用這一拆分，以保證迴圈的最終刷新先於工作階段脫離；詳見[所有權 Agent Note](../../../.agents/notes/implemented/architecture/2026-06-18-agent-lifecycle-and-ownership-contracts.md)。

### 即時服務事件

工作階段儲存會將已通知的建立與釋放配對，在提交後發布追加通知並逐個監聽器收容失敗，同時提供受等待的持久性檢查點。確切簽名和作用域行為見 [session.md](../../../docs/subsystems/session.md#cordis-surface) 的生成區塊；載荷見[持久化目錄](../../../docs/persistence-catalog.md)。

### 類：`Session`

普通類（不是 Cordis 服務）。活躍工作階段透過 `ctx.sessions.create()` 建立，脫離態的重播或檢查工作階段透過 `Session.create()` 建立；脫離態工廠不會發布生命週期事件，也不會將工作階段綁定到 fiber。

- `session.append(type, data, opts?)` 會為持久資料和 surface 中繼資料製作快照並凍結它們，校驗標記形態、被引用的源事件 seq、替換覆蓋完整性，以及僅修改內容的單個 `tool/result` 重寫，隨後同步提交，再在彼此獨立的失敗收容下通知觀察者。對已掛接工作階段的重入追加會被拒絕，執行時期檢查也覆蓋擴寬後的聯合類型和已載入日誌。
- `session.deriveMessages()` 對每個新的 surface 條目只做一次增量投影，並返回一個新陣列，其中包含這些條目儲存的完整、帶標識且凍結的訊息。assistant 訊息的模型來源會保留生成該訊息的提供方和模型，以及配接器私有重播狀態。surface 重寫會重建投影；不存在原始日誌回退。
- `session.deriveEventMessage(event)` 是重建和請求檢查使用的規範逐事件投影。
- `session.surface` 暴露只讀 `SessionSurface` 檢視表，由工作階段唯一的增量 surface 管理器所有；每次提交重寫，`replaceGeneration` 都會變化。
- `session.events` 是按追加失效的快取凍結快照；已接受事件保持深度凍結。
- `session.seq`、`session.id`：當前序號和只讀類型化身份。
- `session.header: SessionHeader`：脫離、深凍結的建立中繼資料（`version`、`id`、`createdAt`，以及選填的 `cwd`／`parentSession`／`seedLength`／`delegationDepth`）。構造時會校驗持久記錄，並要求其中的 id 與 `session.id` 一致。

### 無損 JSON 工具

持久值需要一種已接受的表示，不能先檢查再二次讀取。`isJsonValue(value)` 是布林判斷函式；`snapshotJsonValue(value)` 在一趟迭代中校驗並複製普通值，無效輸入返回 `undefined`，getter 拋出的例外則向外傳播。快照輔助函式接受除 `-0` 外的有限 JSON 數值（JSON 會將其改寫為 `0`）、稠密普通陣列、普通對象或 null 原型對象；它會在規範化前拒絕迴圈引用、不支援的標量和特殊原型，同時不施加呼叫棧深度限制。

工作階段事件匯入將所有權與訊息校驗分開處理。`snapshotSessionEvent(event)` 會先克隆借用的事件，再校驗並凍結其中帶標識的訊息。`adoptSessionEvent(event)` 原地執行相同的訊息處理並返回原事件；呼叫方只有在移交獨佔的對象圖，且該對象圖沒有與其他事件共享可變子對象時，纔可以使用此函式。

### 區塊行儲存編解碼器（`chunk-rows.ts`）

共享的[儲存編解碼器](src/chunk-rows.ts)在事件序列與緊湊行之間無損轉換。它會逐字保留無法識別的事件，並拒絕形態錯誤的編碼行；是否啟用打包寫入由持久化後端決定。

### Surface 類型

此包擁有有序 surface 投影、替換校驗、重播，以及區分追加來源事件與替換事件的類型守衛。[surface 類型目錄](../../../docs/subsystems/session.md#surface-types)擁有精確形狀與欄位語義。面向人的 transcript（文字記錄）必須投影追加來源事件，而不是 `session.surface`，因為已落地的替換會遮蔽讀者已經看到的歷史；面向模型的消費端繼續讀取 `session.surface`。

### 請求標頭重建（`request-header.ts`）

`request/header` 記錄非歷史請求封裝的完整規範快照，其原因為 `initial`、`resume` 或 `change`。其選填 `adapterDefaults` 對映會標記由精確模型解析填入的生效 `reasoningEffort` 或 `maxTokens` 值，使下一次請求提議能夠將它們與顯式對話設定區分開。`foldRequestHeader()` 選擇最新快照；舊版增量事件和已移除的 `fallback` 原因會被拒絕。詳見[可重建請求 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-05-reconstructable-requests.md)。

`user/message` 會直接儲存完整的 `UserMessage`，其中包括收件箱路由或進入步驟前建立的標識。無論它是直接人類提示詞、合成注入，還是已進入的 Goal Round，都會原樣呈現其 `content`；帶類型的 `source` 是區分三者的唯一通道，並攜帶各領域專有的持久事實。`assistant/message` 和 `tool/result` 也會儲存完整的訊息值。輪次執行仍由 `turn/start` 與 `turn/end` 包圍；`agent.inject()` 會把輸入排隊，直到後續某次 pre-step 領取它，並在 enter 決策中返回它。

`tool/result` 持久保存一條帶標識、user-role 的工具結果訊息，以及選填內部失敗標識和選填呈現中繼資料。工具成功時的規範 `value` 和便於人類閱讀的規範失敗訊息只存在於執行本機；算繪後的錯誤內容是重播權威訊息。

### 工作階段事件詞彙（`types.ts`）

生成的[持久化日誌事件目錄](../../../docs/persistence-catalog.md)逐成員列舉僅附加日誌的事件類型、載荷、surface 標記與聲明位置。Token 記帳讀取每個步驟的 `assistant/chunk { type: 'usage' }` 記錄；如果沒有用量區塊，則將 `assistant/message.usage` 作為已提交步驟的後備。失敗的模型請求嘗試沒有 assistant 訊息。每條 `assistant/message` 都會記錄提供方、模型和選填重播狀態。

`SessionEventMap` 可透過合併擴充：外掛程式使用聲明合併新增自身類型（壓縮 seam 的 `compaction/*`、有界復原的非 surface `llm/retry`、掛鉤橋接層的 `hook/*`）；合併成員會出現在同一目錄中。外掛程式擁有其合併事件的關係不變數，包括是否允許純日誌事件出現在輪次之間。需要持久性的生產方透過 `Session` 追加，再等待 `ctx.sessions.flush(session)`，無需虛構一個執行輪次。

此包還定義 `TurnEndReasonMap`，即用於輪次結束、可合併擴充且以 `kind` 為標籤的和類型。`turn/start` 只攜帶輪次編號；隨後已進入的 `user/message` 批次記錄其輸入，`llm/retry` 則記錄請求復原。

被中斷的即時輪次以 `{ kind: 'aborted', reason: AgentCancelCause }` 結束，在持久 transcript 中保留類型化取消原因。持久化會將受支援舊格式中的粗粒度中止結果匯入為 `{ kind: 'aborted', reason: { kind: 'legacy' } }`，因為該記錄沒有保留呼叫方。輪次失敗攜帶 `{ kind: 'error', error }`；只有當機復原會合成 `{ kind: 'interrupted' }`。

每個 `SessionEvent` 都有三個選填頂層欄位（結構中繼資料）：

- `sourceEventSeqs?: number[]`：被引用為來源的較早事件 seq（例如 `assistant/message` 引用的 `assistant/chunk` seq，或壓縮替換條目引用的已遮蔽條目）。對於 `assistant/message`，存在的 `[]` 表示已知提供方流為空；省略則表示舊版或外部事件沒有記錄源流。其他 surface 事件若有此欄位，則要求非空清單。
- `surfaceOp?: SurfaceOp`：事件進入 surface 的方式。非 surface 事件（邊界、區塊、用量、錯誤）不含該欄位。
- `ignorable?: true`：標記讀取器在不認識事件類型時可以安全跳過該事件；缺失表示必需，不認識的事件類型會使工作階段重建被拒絕（[機制](../../../.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md)）。

### 中繼資料類型（`types.ts`）

- `SessionHeader`：工作階段中繼資料，在發布為 `Session.header` 時寫入一次；脫離和深凍結保證執行時期不可變：`{ version, id, createdAt, cwd?, parentSession?, seedLength?, delegationDepth? }`。持久化 loader 可返回相同資料類型的可變脫離副本。該類型與 `SessionId` 一同歸此包所有，因為 `Session.header` 以它為類型；持久化後端只是重新匯出而不擁有它，否則會形成包迴圈相依性。

### 擴充點

- 持久化外掛程式：訂閱 `session/event`（延後寫入），並在 `session/flush`（受等待）及 fiber dispose（資源釋放）時排空。持久後端讀取日誌並重新載入到即時工作階段；這類後端會把中繼資料約定（`SessionHeader`、`session.header`）與日誌一同儲存。
- 重播／fork：`create(id, { seed })` 校驗並凍結連續的當前格式日誌，再重建 surface；請求標頭必須包含提供方／模型，assistant 訊息必須包含提供方／模型溯源資訊。持久化層在構造該當前格式 seed 前負責讀取相容性處理。`fork(source, boundary?, childSessionId?)` 選擇已完成輪次前綴並記錄譜系。
- 壓縮：`dsh-compaction-basic` 為摘要檢查點追加一個替換用 `user/message`，而 `dsh-compaction-tool-result-pruner` 追加僅修改內容的 `tool/result` 替換。工具配對邊界策略及其快取歸 [`dsh-compaction` seam](../../compaction/compaction/README.md) 所有；此包擁有有序 surface 成員關係、替換校驗與 `replaceGeneration`。

## 模型體驗

### 派生訊息歷史

#### 模型看到的內容

模型會原樣接收 `user/message`、`assistant/message` 和 `tool/result` surface 條目中的完整訊息。其標識、角色、來源和內容區塊都與建立時確定的值相同；投影不會生成標識。提示詞封裝只改變面向人的呈現；其前綴上下文和請求分隔符已經位於事件內容中。工具呼叫包含在 assistant 訊息內。區塊、邊界、用量、掛鉤記錄、todo 記錄以及其他僅日誌事件不會新增訊息。

#### Token 影響

追加的 surface 條目會在後續步驟中重新發送。`replace` surface 操作會從未來輸入中移除被遮蔽條目，但不刪除其原始日誌記錄。

#### KV Cache 影響

追加的 surface 條目會保留可複用前綴。即使底層事件日誌保持僅附加，`replace` 操作也會從首條被遮蔽訊息起使快取複用失效。

### 崩潰修復結果

#### 模型看到的內容

如果復原發現 assistant 工具請求沒有持久 `tool/call`，其合成 `TOOL_NOT_STARTED` 結果內容為 `The tool call was interrupted before the Harness recorded it as started. Retry it if it is still needed.`。如果持久 `tool/call` 沒有結果，其 `TOOL_OUTCOME_UNKNOWN` 結果內容為 `The tool call was interrupted after it was recorded, but no result was durably recorded. Its outcome is unknown. Decide whether to retry from the tool semantics: retry only if the operation is read-only or idempotent; if it may have side effects, first verify external state or ask the user. Do not retry blindly.`。

#### Token 影響

未受損工作階段的 token 增量為零。復原時，每個修復後的呼叫都會新增保留的、針對具體風險的錯誤文字。

#### KV Cache 影響

保持僅附加；新可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

### 已記錄的請求標頭

#### 模型看到的內容

工作階段會重建迴圈實際傳送的系統提示詞、工具 schema、呼叫設定和工作階段前綴。請求標頭事件不會向訊息歷史加入第二份副本；前綴在 `deriveMessages()` 外部前置。

#### Token 影響

日誌記錄不產生重複 token。重建的前綴、系統文字和 schema 仍會產生正常的逐請求開銷。

#### KV Cache 影響

記錄日誌不會導致失效，精確重建會保持請求前綴一致。後續請求標頭若更改前綴、提示詞或 schema，可能從第一處差異開始使複用失效。

## 已知限制與暫緩事項

- **工作階段分支／樹結構**（pi 風格條目樹）：除非需要超越基於邊界的 `fork()` 能力，否則暫緩。
- **`fork()` 僅在即時工作階段的穩定邊界處切分**：所選前綴結束時不得有開放輪次，且源工作階段必須位於儲存中；[fork API](../../../.agents/notes/implemented/feature/2026-06-30-session-store-fork-api.md) 不支援對已持久化但未載入的工作階段進行 fork。
- **`SESSION_FORMAT_VERSION` 固定為 `0`**：預發布階段不承諾廣泛相容性；`Session` 只接受當前 seed 形狀，後端拒絕其他任何版本並說明方向（更新的版本提示"由更新的 harness 寫入，請升級"；更舊的版本說明尚無升級路徑）。不認識的事件類型同樣被拒絕，除非信封帶 `ignorable` 標記；版本機制見 [session-log 版本機制 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md)。範圍受限的儲存匯入升級應由持久化邊界負責（[政策](../../../AGENTS.md)、[訊息標識機制引入前的訊息復原](../../../.agents/notes/implemented/bug-fix/2026-07-28-load-pre-identity-session-messages.md)）。
- **`TurnEndReasonMap` 不含 ACP（Agent Client Protocol）命名的 `refusal`／`max_turn_requests` 變體**：受生產方約束；只有當配接器或迴圈首次產生這些變體時才加入。
