# Agent Note: 用於結構化工作階段互動的 Task Surface

Status: proposed

[English](2026-08-04-task-surface.md) | [简体中文](2026-08-04-task-surface.zh.md) | 繁體中文

## 問題

有些任務很難透過交替傳送文字訊息來完成。比較多個選項、調整計畫順序、審閱表格，或填寫一小組關聯欄位，都更適合在一次結構化互動中處理。目前，agent（代理）可以描述這類互動，但若不增加永久的產品元件或生成可執行的用戶端外掛程式程式碼，就無法要求 Web 用戶端渲染這類互動。

這兩種變通方案的職責歸屬都不合理。產品專用元件要求每種任務形態都新增觸發方式並行布新版本。對於只需一個輪次的表單，生成程式碼所擁有的權限和生命週期成本都遠超實際需要。這樣做還會把展示介面而非使用者結論變成持久產物。

目前缺少這樣一份約定：用有界、可重播的描述來定義臨時 UI，並讓它只屬於一個工作階段和一次工具呼叫實例。產品應當負責校驗、放置、互動機制和提交；agent 應當負責特定任務的文案、資料，以及從受支持元件中作出選擇。

## 提案

新增 **Task Surface**：一種由普通 Web 用戶端外掛程式渲染、帶版本的聲明式模型。面向模型提供一個穩定工具 `show_task_surface`，用於發布該模型。呼叫成功後，當前輪次結束。使用者編輯並提交渲染出的面板；Host 將提交內容記錄為一條普通的可見使用者訊息，並開始下一輪。

同時滿足以下條件時，Task Surface 是默認的結構化 UI 路徑：

- 互動屬於當前工作階段和當前任務；
- 行為可以由已聲明的元件集合表達；
- 不需要後臺執行或新增執行時期權限；
- 有價值的持久結果是使用者提交的結論，而不是面板本身。

這裡定義的是一個觸發方式，不是一組產品啟發式規則。agent 會顯式呼叫 `show_task_surface`。使用者可以透過普通語言要求 agent 使用 Task Surface。產品不會根據工具名稱或任務主題打開專用面板；重複使用也不會自動把 Task Surface 轉為外掛程式。

簡短的阻塞式問題仍由 [`ask_user_question`](../../implemented/feature/2026-07-29-ask-question-web-presentation.md) 處理。純文字說明仍留在聊天中。跨工作階段導覽、後臺行為、新服務或持久自訂 UI 則屬於 Generated Client Plugin 工作流程。

## 聲明式模型

`TaskSurfaceModelV1` 使用 JSON。它包含內容區塊、輸入欄位和一個提交標籤；不包含程式碼、回呼、選擇器、HTML、CSS、可執行產物的 URL，也不包含表達式語言。該類型與核心工作階段中現有的 `SurfaceManager`/`SurfaceOp` 訊息歸約類型無關；Task Surface 是一套產品互動協議。

```ts
interface TaskSurfaceModelV1 {
  version: 1
  title: string
  description?: string
  sections: TaskSurfaceSection[]
  fields?: TaskSurfaceField[]
  submit: { label: string }
}

interface TaskSurfaceSection {
  id: string
  title?: string
  layout?: TaskSurfaceLayout
  blocks: TaskSurfaceBlock[]
}

type TaskSurfaceLayout =
  | { kind: 'stack' }
  | { kind: 'grid'; columns: 2 | 3 }

type TaskSurfaceBlock =
  | { kind: 'markdown'; text: string }
  | { kind: 'metrics'; items: { label: string; value: string; detail?: string }[] }
  | { kind: 'table'; columns: { id: string; label: string }[]; rows: Record<string, string | number | boolean | null>[] }
  | { kind: 'diff'; path?: string; before: string | null; after: string; language?: string }
  | { kind: 'notice'; tone: 'neutral' | 'info' | 'warning'; text: string }

type TaskSurfaceField =
  | { kind: 'text'; id: string; label: string; multiline?: boolean; required?: boolean; initial?: string }
  | { kind: 'choice'; id: string; label: string; options: TaskSurfaceOption[]; initial?: string }
  | { kind: 'multi-choice'; id: string; label: string; options: TaskSurfaceOption[]; initial?: string[] }
  | { kind: 'toggle'; id: string; label: string; initial?: boolean }
  | { kind: 'order'; id: string; label: string; options: TaskSurfaceOption[]; initial?: string[] }

interface TaskSurfaceOption { id: string; label: string; detail?: string }
```

渲染器控制字體排印、間距、響應式版面配置、焦點順序、鍵盤行為和主題 token。未指定版面配置時使用 `stack`；`grid` 版面配置自帶列數，可用寬度無法容納時會摺疊。遇到未知版本或聯合類型分支時，系統使用通用工具結果回退，而不是隻解釋其中一部分。

`markdown` 塊複用 `MarkdownText`，並顯式指定模型 URL 策略。`MarkdownText` 新增 `remoteImages: 'render' | 'alt-only'`，普通場景仍默認使用 `render`；Task Surface 始終傳入 `alt-only`，因此圖片文法只渲染替代文字。原始 HTML 和嵌入式媒體仍會被省略，不生成自動連結預覽；未經使用者顯式操作，不會解引用模型提供的任何 URL。普通 HTTP(S) 連結仍可在使用者選擇後導覽。文法高亮區塊等固定應用資源繼續遵循產品的常規載入策略。

版本 1 有意不支持條件欄位、用戶端資料取得、圖表、文件上傳和任意事件處理器。新增任何塊或欄位類型都屬於協議變更，必須在同一變更中加入解析器、渲染器、無障礙行為、回退方式和重播 fixture（測試前置資料）。

Task Surface 服務透過受 schema 校驗的設定定義限制。初始預設值為：規範化模型不超過 64 KiB、塊不超過 64 個、欄位不超過 32 個、表格行不超過 200 行、提交內容不超過 32 KiB。模型內的 ID 必須唯一；欄位值必須符合其聲明；未知欄位會被拒絕。這些限制約束日誌、DOM 和提示詞成本，但不改變協議。

## 工具與呈現約定

`show_task_surface` 接收 `{ model: TaskSurfaceModelV1 }`。Host 解析並規範化完整模型；若該工作階段已有一個打開的 Task Surface，則拒絕呼叫；否則生成 `surfaceId`，並返回帶規範化模型的規範值 `{ surfaceId, model }`。`presentationMeta` 持久化 `value.model`，使投影器和執行器不會對規範化結果產生分歧。Native 結果會指明該 Surface，並說明用戶端無法渲染面板時，可以透過普通訊息繞過它。隨後工具呼叫 `exec.concludeTurn()`，防止 agent 越過所要求的人工檢查點繼續執行。

工具定義省略 `isConcurrencySafe`。根據現有工具登錄檔約定，省略該欄位會將每次呼叫歸類為獨佔排序屏障，無需新增 `ToolDefinition` 欄位。該工具只會組裝到同時掛載 Host 服務和 Web 渲染器的 Web profile 中。版本 1 支持 `native` 和 `both` 工具模式；僅支持 `code` 的 profile 不會向模型公佈該工具，因為 Code Mode 分發屬於巢狀呼叫，無法把呈現元資料傳到外層結果。

瀏覽器安全的領域包從 `@deepseek-ai/dsh-brand` 以僅類型方式匯入 `Branded` 原語，並擁有全部三個 Task Surface ID。根據[規範工具輸出約定](../../implemented/architecture/2026-07-20-canonical-tool-output-contract.md)，規範值僅存在於本次執行中。因此，重播透過 `output.presentationMeta(args, value)` 將以下帶標籤的載荷隨 `tool/result.meta` 一並持久化：

```ts
import type { Branded } from '@deepseek-ai/dsh-brand'

type TaskSurfaceId = Branded<'TaskSurfaceId'>
type TaskSurfaceSubmissionId = Branded<'TaskSurfaceSubmissionId'>
type TaskSurfaceDismissalId = Branded<'TaskSurfaceDismissalId'>

interface TaskSurfacePresentationMeta {
  kind: 'dsh/task-surface'
  version: 1
  surfaceId: TaskSurfaceId
  model: TaskSurfaceModelV1
}
```

該工具保留通用 [render intent](../../implemented/architecture/2026-07-02-tool-render-intent-union.md)。帶 key 的 Web 行讀取 `ToolResultNode` 上已經保留的帶標籤元資料，無需新增 render-intent 分支或呈現登錄檔。不支持 Task Surface 的用戶端會渲染普通結果內容。

Web 外掛程式按照 [toolview](../../implemented/architecture/2026-07-23-toolview-dissolution.md) 和 [slot 註冊](../../implemented/architecture/2026-07-22-slot-type-chain-implementation.md)約定，提供兩個靜態的工作階段作用域註冊項。一個以 `show_task_surface` 為 key 的 `conversation.chat.toolview` 條目將持久 transcript（文字記錄）呼叫實例渲染為簡潔摘要和只讀重播。現有 `conversation.input.dock` 中的一個 `TaskSurfaceDock` 條目是唯一可操作的掛載點：它讀取活動投影，針對確切身份呼叫 `getActive`，並擁有欄位、草稿、提交和關閉操作。Dock 與 transcript 分頁相互獨立，因此即使 `ToolResultNode` 位於已載入歷史視窗之外，活動 Surface 仍可操作。

Dock 遵循現有 composer chain 的回退語義。任何 `conversation.composer` 接管都會隱藏包括 `TaskSurfaceDock` 在內的回退 composer 棧，但不會將其解除安裝；接管結束後，同一個草稿所有者會重新出現。接管方不會獲得 Task Surface 操作，也不會建立另一個編輯器。

模型不能選擇工作階段分頁標籤、Dock 順序、詳情欄、模態對話框、畫素位置或 z-index。以後即使改變放置位置，也只是渲染器的決策，不會改變日誌中記錄的模型。transcript 行絕不會成為第二個編輯器，因此同一個 Surface 不會出現相互競爭的草稿或提交所有者。

## 提交約定

Task Surface 領域透過 Host 傳輸層公開三個操作。只有 `submit` 會接納使用者訊息：

```ts ignore-check
type TaskSurfaceSubmissionPhase = 'queued' | 'claiming'

interface TaskSurfacePendingSubmission {
  submissionId: TaskSurfaceSubmissionId
  messageId: MessageId
  phase: TaskSurfaceSubmissionPhase
}

interface TaskSurfaceService {
  getActive(input: { sessionId: SessionId; surfaceId: TaskSurfaceId }): Promise<GetActiveTaskSurfaceResult>
  submit(input: SubmitTaskSurfaceRequest): Promise<SubmitTaskSurfaceResult>
  dismiss(input: DismissTaskSurfaceRequest): Promise<DismissTaskSurfaceResult>
}

interface SubmitTaskSurfaceRequest {
  sessionId: SessionId
  surfaceId: TaskSurfaceId
  submissionId: TaskSurfaceSubmissionId
  values: Record<string, JsonValue>
  note?: string
}

type SubmitTaskSurfaceResult =
  | { accepted: true; messageId: MessageId; phase: 'queued' }
  | { accepted: false; reason: 'not-open' | 'stale' | 'invalid-submission' | 'submission-pending' }

type GetActiveTaskSurfaceResult =
  | {
      active: true
      callId: CallId
      surfaceId: TaskSurfaceId
      model: TaskSurfaceModelV1
      pending: TaskSurfacePendingSubmission | null
    }
  | { active: false; reason: 'not-open' }

interface DismissTaskSurfaceRequest {
  sessionId: SessionId
  surfaceId: TaskSurfaceId
  dismissalId: TaskSurfaceDismissalId
}

type DismissTaskSurfaceResult =
  | { dismissed: true; eventSeq: number }
  | { dismissed: false; reason: 'not-open' | 'stale' | 'submission-pending' }
```

Host 解析出 `show_task_surface` 的確切成功呼叫實例，依據其已持久化模型重新校驗提交值，並透過普通工作階段佇列接納回應。該回應成為一條使用者角色訊息，並使用可合併擴充的訊息來源：

```ts ignore-check
interface TaskSurfaceCorrelation {
  version: 1
  submissionId: TaskSurfaceSubmissionId
  callId: CallId
  surfaceId: TaskSurfaceId
  values: Record<string, JsonValue>
}

interface TaskSurfaceUserMessageSource {
  kind: 'user'
  rpcId: RpcId
  taskSurface: TaskSurfaceCorrelation
}
```

`session/queue` 協議條目已經攜帶完整 `Message`。用戶端投影會顯式擴充以保留其來源，不再丟失關聯資訊：

```ts ignore-check
interface QueuedMessage {
  id: InboxItemId
  messageId: MessageId
  placement: 'queued' | 'steering'
  source: MessageSource
  content: readonly ContentBlock[]
  preview: string
  text: string | null
}
```

瀏覽器安全的領域包擁有 `TaskSurfaceId`、提交和關閉 ID、`TaskSurfaceCorrelation`，以及待處理提交的形態。ApiProxy 擁有傳輸擴充，負責將關聯資訊與 `rpcId` 組合。保留 `kind: 'user'` 可維持普通使用者訊息氣泡和提示詞語義，額外欄位則提供持久關聯資訊。訊息內容是由產品格式化的可讀摘要，包括面板標題、標籤和提交值，以及選填備注。模型接收相同的文字。結構化來源不是第二條隱藏指令。

產品外殼負責收起和關閉。收起屬於本機檢視表狀態，不會發送任何內容。沒有待處理提交時，`taskSurface.dismiss({ sessionId, surfaceId, dismissalId })` 會追加一個 `task-surface/dismissed` 工作階段事件，但不啟動輪次；該精確事件會關閉投影，並更新 Dock 和 transcript 行。重試會複用 `dismissalId` 並返回原始結果，不會再追加事件。提交處於 `queued` 或 `claiming` 階段時，關閉操作會被停用，Host 也會以 `submission-pending` 拒絕這類請求。

用戶端邊界上的提交具有交易性。接納成功會返回處於 `queued` 階段的確切 `messageId`；在 `queued` 和 `claiming` 兩個階段中，Dock 會停用所有變更，並且只有匹配的使用者訊息持久化後，才會清除已持久化的草稿。若請求被拒絕，則保留值供使用者繼續編輯，並顯示返回的原因。雙擊和傳輸重試會複用 `submissionId` 並返回第一次呼叫的結果；只要第一次提交仍在處理中，另一個提交 ID 就會收到 `submission-pending`。對於一個已接受的 Surface，Host 只會接納一條使用者訊息。

Task Surface 服務將已接受提交的協調狀態記錄為 `pending.phase: 'queued'`，用戶端則可透過仍在佇列中的行所保留的 `source` 關聯它。當 Agent 從佇列取出該呼叫實例進行普通提示詞接納時，服務會先同步把同一份待處理記錄改為 `claiming`，然後 ApiProxy 才發布不再包含已認領行的普通佇列快照。服務會在非同步接納和重新連線期間一直保留這份行程內認領狀態，直到匹配的持久 `user/message` 發布，或 Agent 報告終態丟棄。

匹配的 `user/message` 會關閉持久投影並清除認領狀態。在持久化之前發生拒絕、取消或 dispose（資源釋放）時，系統會報告丟棄、清除認領狀態，並讓 Surface 保持打開。Dock 絕不會把佇列行消失解讀為其中任一結果，而會重新讀取 `getActive`：`pending.phase: 'claiming'` 會維持停用狀態，`pending: null` 會復原草稿，`not-open` 會關閉 Dock。`getActive` 會把由日誌推導的活動呼叫實例與這唯一一份行程內待處理記錄合併。該記錄屬於協調狀態，不是第二個持久權威來源；Host 重新啟動後，未提交的認領狀態不復存在，日誌中仍然打開的 Surface 會復原為可編輯狀態。

對於帶有 Task Surface 關聯資訊的行，`session.updateQueue` 會拒絕 `edit` 和 `steer`。編輯會讓格式化內容與訊息來源所攜帶的結構化值脫節，而 steering（中途引導）會持久化一條不符合提交生命週期的 `steering/message`。該行仍在佇列中時允許 `remove`；它會報告丟棄並復原為打開的 Surface。行被認領後即已離開通用佇列，佇列變更會返回 `queue-item-not-found`。Task Surface 服務會持有一份 single-flight 待處理記錄，直至提交或丟棄。

## 生命週期與復原

工作階段日誌是真源。現有[工作階段投影系統](../architecture/2026-07-27-session-projection-and-command-log.md)中的一個小型 `taskSurface` 單元會摺疊成功呼叫的 Surface 結果元資料和後續使用者訊息來源，得到以下狀態：

```ts ignore-check
interface TaskSurfaceProjection {
  active: { callId: CallId; surfaceId: TaskSurfaceId } | null
}
```

一個工作階段最多隻能有一個打開的 Task Surface。成功的結果會打開它；匹配的 Task Surface 使用者訊息或關閉事件會將其關閉。後續的普通使用者訊息也會將其關閉，這是一條顯式的繞過路徑；在以上任一事件關閉活動呼叫實例前，再次呼叫 `show_task_surface` 都會失敗。回退和 fork 會透過摺疊相應日誌推匯出活動呼叫實例；瞬態佇列階段不會被複制，也不會有獨立的 Surface 資料庫參與其中。

完整模型仍存放在對應的 `tool/result.meta` 中；投影只攜帶活動身份。`TaskSurfaceDock` 獨立於歷史行存在，並會回應該身份。`taskSurface.getActive({ sessionId, surfaceId })` 會從工作階段日誌中讀取確切呼叫實例，重新校驗其元資料，合併 Task Surface 服務的待處理協調記錄，並返回 `{ callId, surfaceId, model, pending }`。呼叫實例不存在或已經關閉時返回 `not-open`。因此，即使結果位於歷史尾段之外，刷新和重新連線仍能復原可操作的 Surface 及其同進程待處理階段，而無需把模型複製到每一個投影基線中。

Web 外掛程式將未提交值保存在一個有界、按工作階段持久化的 slot store 中，並以 `surfaceId` 為 key；這些值永遠不會進入工作階段日誌、提示詞或長期記憶。已提交值存放在接納的使用者訊息中，因此即使瀏覽器草稿丟失，也不會抹去結論。

## 包邊界與相依性

該能力在職責變化處拆分為多個包：

| 包 | 職責 |
|---|---|
| `packages/core/agent` 和 `packages/core/agent-loop` | 為已認領的下一輪 inbox 條目提供通用終態結果，讓 Host 觀察方無需使用 Task Surface 專用類型，即可區分持久接納和丟棄 |
| `packages/task-surface/task-surface` | 瀏覽器安全的模型、帶品牌類型的 ID、關聯和待處理類型、解析器、限制、提交校驗器／格式化器、工作階段事件擴充、投影單元，以及 Host 服務約定 |
| `packages/task-surface/tool-task-surface` | `show_task_surface`、規範輸出、呈現元資料、通用 render intent、活動 Surface 檢查和 `concludeTurn()` 行為 |
| `packages/client/runtime` | 通用排隊訊息 `source` 投影和工作階段作用域的活動投影訪問 |
| `packages/client/ui-primitives` | 與 Task Surface 無關的 `MarkdownText.remoteImages` 策略，包括 `alt-only` 圖片分支和 URL 策略測試 |
| `packages/client/ui-task-surface` | 靜態且可操作的 `TaskSurfaceDock`、帶 key 的只讀 transcript 行、消費 Task Surface 模型並以 `alt-only` 模式使用 `MarkdownText` 的聲明式 Web 渲染器、按工作階段劃分的草稿 store，以及提交用戶端 |
| `packages/host/apiproxy` | 類型化的活動 Surface 讀取／提交／關閉傳輸、使用者訊息來源擴充與傳遞、佇列操作限制，以及認領和終態結果的路由；將校驗、待處理協調和接納委託給 Task Surface 服務 |

`ui-task-surface` 相依性瀏覽器安全的 Task Surface 領域包、用戶端連線與執行時期、locale、`ui-conversation` 所聲明的 slot 約定、用於註冊的 `ui-slots`，以及 `ui-primitives`；`ui-primitives` 不反向相依性 Task Surface。ApiProxy 相依性 Task Surface 服務約定和通用 AgentLoop 終態結果。核心 Agent 包不匯入 Task Surface 類型。

該實作相依性現有的訊息日誌、規範工具輸出、帶標籤的 render intent、工作階段投影、按工作階段作用域聲明的 slot store 和 slot 生命週期，不相依性在執行時期建立用戶端外掛程式。Generated Client Plugin 工作流程可以使用 Task Surface 展示審閱表單，但兩個協議都不擁有或啟用另一個協議。

## 交付階段

1. 實作模型／解析器、`MarkdownText` 模型 URL 策略、投影單元、`show_task_surface`、呈現元資料、只讀 Web 行、靜態 `TaskSurfaceDock`、活動 Surface 讀取，以及帶只讀塊的通用回退。
2. 增加欄位、持久化草稿、經 Host 校驗的提交／關閉、帶品牌類型的關聯資訊、用戶端排隊來源傳遞、Task Surface `queued`/`claiming` 協調、已認領呼叫實例的終態報告、佇列操作限制，以及可見使用者訊息接納。
3. 只增加有實際任務依據，並且擁有至少兩個消費端或明確通用回退的元件類型。一個單獨的顯式使用者操作可以啟動生成用戶端外掛程式的編寫工作流程，但只會建立一個候選方案，絕不會直接將程式碼轉為正式實作。

## 考慮過的替代方案

**增加產品專用觸發方式和麵板。**不予採用，因為每種新任務形態都會把 agent 行為與已發布的產品元件耦合。產品程式碼應當定義一套接納的元件詞彙和放置策略；agent 則顯式地從中選擇。

**從工具呼叫中渲染任意 HTML、CSS 或 JavaScript。**不予採用，因為這會把臨時互動變成可執行的用戶端外掛程式程式碼，卻不具備程式碼所需的建置、預覽、評估、批准或回滾生命週期。

**使用大型表單擴充 `userInteraction.ask()`。**本約定不採用這種做法。`ask()` 是一種阻塞式請求／回應操作，適用於正在執行的工具必須先獲得簡短答案才能繼續執行的情況。Task Surface 會結束當前輪次，可以在刷新後繼續保持打開，並把結果提交為下一條可見使用者訊息。

**每次呼叫都註冊一個動態 `conversation.view`。**不予採用，因為檢視表帳本是全域性的，而其渲染作用域按工作階段劃分；同時，臨時任務身份會變成註冊身份。一個靜態的工作階段作用域 Dock 負責互動，一個靜態帶 key 的行概述已記錄的呼叫實例；兩個註冊項都不使用呼叫實例身份。

**只在規範工具值中保留模型。**不予採用，因為規範值不會持久化。重播要求將規範化模型寫入 `presentationMeta`。

**將面板存入長期記憶。**不予採用，因為版面配置和草稿狀態不是可複用事實。現有記憶策略可以保留使用者提交的結論。

## 驗收標準

- 在 `native` 或 `both` 工具模式下，真實模型可以呼叫一個穩定的 `show_task_surface` schema；呼叫結束當前輪次；具備相應能力的 Web 用戶端在即時執行和重播後都能渲染同一份規範化模型；僅支持 `code` 的模式不會向模型公佈該工具。
- 靜態 `TaskSurfaceDock` 是唯一的編輯器，即使活動結果位於已載入歷史視窗之外也仍可操作；帶 key 的 toolview 始終是 transcript 的只讀摘要和重播。composer 接管會隱藏仍處於掛載狀態的 Dock、保留其草稿，並在接管釋放後重新顯示同一個所有者。
- 每個 `submissionId` 的提交操作恰好生成一條可見使用者訊息，透過普通佇列接納開始下一輪，並在保留 `source.kind: 'user'` 的同時維持帶品牌類型的確切呼叫實例關聯；關閉操作記錄一條日誌事件，且不啟動輪次。
- 用戶端排隊行保留已關聯的訊息來源。`getActive` 可在同一行程的重新連線前後公開 `queued` 或 `claiming`；持久化完成後會關閉投影，顯式丟棄則會清除待處理狀態並讓 Surface 保持打開。佇列行消失本身不會改變任何 UI 狀態。系統會拒絕編輯和 steering，且移除操作只能在認領前成功。
- 刷新、重新連線、工作階段切換、fork 和回退都生成日誌所決定的生命週期狀態；`getActive` 可以復原歷史尾段之外的模型和待處理階段，任何面板、待處理狀態或草稿都不會洩漏到其他工作階段。
- 不受支持的版本、格式錯誤的元資料以及用戶端能力缺失時，系統回退到帶普通訊息繞過路徑的可讀工具結果內容；巢狀呼叫以及已有另一個活動 Surface 時發起的呼叫都無法打開 Surface，並以失敗結束。
- 協議 schema 會校驗 ID 字串，領域 API 始終公開帶品牌類型的 ID。模型解析器會在面板可互動前強制校驗帶標籤的版面配置形態、欄位值，以及設定的位元組數和數量限制。瀏覽器測試證明：圖片文法會變成替代文字，原始 HTML 和嵌入式媒體不會渲染，而且在使用者顯式操作前不會請求模型提供的 URL。
- 元件測試覆蓋純鍵盤操作、焦點復原、無障礙名稱、窄屏版面配置、兩種主題，以及中英文產品介面。
- 無金鑰瀏覽器組合測試覆蓋顯示、Dock 與只讀行的職責歸屬、視窗外復原、編輯、接納被拒後的重試、從 `queued` 到 `claiming` 的轉換、丟棄、沒有可編輯空檔的持久交接、禁止的佇列操作、關閉、重新連線和雙重提交冪等性。
- 前綴快照表明：無論任務特定模型如何變化，都只存在一個穩定的工具定義；只有呼叫參數和後續使用者結論發生變化。
- 解除安裝 Web 外掛程式時，其所屬 Fiber 會對 Dock、工具行和草稿 store 執行 dispose，但不會改變持久 transcript。

## 風險

第一批元件可能小到無法滿足實際任務，也可能大到足以演變成一個粗糙的應用框架。是否新增元件應由使用證據決定；v1 不提供表達式語言或網路行為。

Task Surface 的 Markdown 策略捨棄行內圖片、媒體和自動連結預覽。普通連結仍有用，但只有使用者顯式操作後，纔可以導覽或發起請求。

即使設定了位元組限制，大型表格和 Markdown 仍可能生成開銷較高的 DOM。渲染器必須按需虛擬化或截斷內容，同時保留可讀回退和明確計數。

填寫字段較多時，由產品格式化的提交訊息可能過長。格式化器需要使用確定性的緊湊格式，保留每一個提交值，同時避免重複完整顯示模型。

在完成持久交接之前一直持有行程內認領狀態，會新增一項終態不變數。每條接納退出路徑都必須產生匹配的 `user/message` 或顯式丟棄，否則重新連線可能會讓 Dock 永久處於停用狀態。

瀏覽器本機持久化的草稿可能保留敏感的未提交文字。store 需要遵守規定的位元組上限、使用按工作階段劃分的 key、在提交成功後顯式清除，並採用與現有工作階段草稿相同的儲存策略。

Dock 和 transcript 行以不同角色展示同一個呼叫實例。將工具行保持為只讀，並讓 Dock 成為唯一的變更所有者，可以避免草稿衝突，但代價是 Surface 活動期間會出現第二份簡潔表示。
