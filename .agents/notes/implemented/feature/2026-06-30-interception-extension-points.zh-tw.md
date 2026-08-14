# Agent Note: 攔截擴充點——掛鉤程式設計所面對的類型化 Decision 介面

Status: implemented

[English](2026-06-30-interception-extension-points.md) | [简体中文](2026-06-30-interception-extension-points.zh.md) | 繁體中文

## 問題

harness 需要一套掛鉤子系統：使用者像 Claude Code（CC）和 Codex 那樣在生命週期節點擴充或管控 agent（代理）。驅動本設計的關鍵視角轉換是：**「原生掛鉤」不是一個包**——原生掛鉤只是一個普通的 Cordis 外掛程式，訂閱規範的生命週期事件。因此真正的產品是一個*強大、類型完備的規範事件介面*；CC/Codex 橋接（`dsh-hooks-claude-code` / `dsh-hooks-codex` 包）只是將外部 shell 掛鉤協議對映到同一介面的翻譯層。橋接能做的事，普通外掛程式可以直接做——而且更強大（無序列化邊界、完整 `ctx`、類型化回傳值）。

該介面需要為以下場景提供各自獨立的約定：逐提示詞策略（CC 的 `UserPromptSubmit`）、工作階段啟動觀測（CC 的 `SessionStart`）、工具執行前策略、環繞調度控制、工具執行後變換、最終結果觀測，以及攜帶面向模型的原因的繼續執行。如果把這些階段混為一談，外掛程式就會獲得不需要的 mutation 通道，而終結性將相依性監聽器的註冊順序。[事件域語義 Agent Note](../architecture/2026-06-30-event-domain-semantics.md) 提供了三域規則與類型化 Decision 慣用法；本 Agent Note 將其應用於生命週期擴充點。

## 決策

規範介面將可變換策略、環繞調度控制與僅觀測通知分離。策略 waterfall（瀑布式事件）返回小型的、擴充點專屬的**類型化 Decision 聯合類型**；包裝層返回規範化結果；通知接收不可變快照，無法影響結果。覆蓋的掛鉤點包括 `session-start`、`prompt-submit`、`pre-tool`、`post-tool`、透過 continuation 實作的 `stop`，同時將非掛鉤的執行策略留作獨立可組合。

**Agent 事件**（`dsh-agent`）：
- `agent/session-start({ agent, source })` ——emit，在第 1 輪次之前觸發一次，攜帶 `SessionStartSource`（`startup` 表示全新/fork 建立，`resume` 表示重新載入的持久化工作階段；`clear`/`compact` 保留）。純通知，不能阻塞啟動（這是有意的空白：橋接可以記錄/注入，但不管控啟動）。監聽器透過 `agent.inject()` 注入上下文。
- `agent/pre-step({ agent, messages, turn, step, signal }, next) → PreStepDecision` ——waterfall，在每個擬議步驟之前、迴圈原子移除其獨佔 inbox 批次後觸發。payload 攜帶該請求的 `turn`、`step` 與取消 `signal`（已退役的 `PreStepContext` 字段位於 payload 中；參見 [payload-object 事件決策](../architecture/2026-08-06-agent-event-payload-objects.md)）；沒有中途輸入的工具續步會收到空批次。`enter` 返回完整訊息批次，其中包括監聽器為當前請求貢獻的上下文；`reject` 不打開步驟，並讓已領取消息保持已刪除。

**`agent/turn-stopping`** 是自然停止邊界上的一次 awaited 通知。需要再執行一步的監聽器呼叫 `agent.steer()`，傳入來源顯式的 steering（中途引導）內容供模型使用；迴圈隨後重新讀取 outbox，繼續執行或關閉輪次。

### 工具管線為每個階段賦予一種權限

每次呼叫遵循 `tools/pre-execute` → guards → `tools/execute` → dispatch → `tools/post-execute` → 由工具定義負責的 `finalizeContent` → `tools/result`。登錄檔對呼叫方輸入建立快照、實體化並凍結參數、分配一個不透明 token，並在策略開始前對可見定義的最終內容回呼建立快照。巢狀呼叫僅攜帶父 token。身份始終不可變；只有 `signal` 可在環繞調度時改變。日誌、UI 和工具體因此對「執行了什麼」達成一致。

- **`tools/pre-execute`** 是可擴充的 waterfall 閘門。其 `PreToolDecision` 允許、拒絕或詢問。拒絕跳過 `tools/execute` 與核心調度。詢問透過選填的審批 seam 解析：只有 `allowed-once` 繼續透過 guards 和調度；拒絕、取消、通道不可用、審批服務缺失或無 agent 呼叫均規範化為拒絕。每個已解析的 decision 仍會到達後置策略；監聽器拋出的例外會成為最終的規範化失敗。
- **`ctx.tools.guard()`** 在整個 pre-execute waterfall 之後安裝同步的、作用域感知的策略。guard 可以拒絕或棄權，永遠不能強制允許，因此監聽器順序無法復活一個被最終不變式禁止的操作。
- **`tools/execute`** 是用於逾時、重試和指標外掛程式的環繞調度 waterfall。包裝層透過 `next()` 委託給核心調度，在此之前可以替換並復原必需的 `exec.signal`，但不能移除它；包裝層接收拋出例外或未知工具產生的、已完成規範化的規範成功／失敗結果。包裝層自行產生的成功結果會短路調度，並透過已解析的輸出聲明重新規範化。
- **`tools/post-execute`** 是檢查／變換 waterfall。其 `PostToolDecision` 接受、以回饋阻止、替換呈現內容或規範值，或附加 `additionalContexts`。替換值會重新校驗並重新計算呈現；替換內容會保留程序化值，且不構成保密邊界。返回的 decision 是受支持的變換通道。
- **`ToolDefinition.finalizeContent`** 是一個選填、同步、對所有輸入都有定義且僅能處理內容的邊界，在呼叫建立時隨可見定義一起被快照。登錄檔將候選結果規範化並建立無損快照後，它恰好執行一次；候選結果包括繞過後續 waterfall 的 pre、around 或 post 監聽器失敗，以及為另一個結果欄位建立快照時發現的錯誤。它可以替換 `content`，也可返回 `undefined` 保留原內容，但不能重寫 `isError`、結構化錯誤身份、上下文或呈現元資料。工具在此執行自身最後一道內容不變式，而無需將策略失敗轉換為更弱的阻止 decision。
- **`tools/result`** 是在所有變換、無損 JSON 實體化和外層錯誤邊界之後的同步且故障受控的通知。它接收相同的凍結執行身份和權威結果的不可變快照；觀測者的失敗按監聽器隔離，無法改變或拒絕 `ToolRuntime.execute()` 返回的結果。

核心調度與工具體位於規範化邊界內部，因此工具、監聽器、無效規範值、渲染器／投影器、非 JSON 呈現和身份形狀錯誤均解析為 JSON 安全的 `isError` 結果，而非逃逸出輪次。post-execute 監聽器因此可以檢查一個拋出例外的工具；由工具定義負責的最終內容不變式也會覆蓋外層管線與候選結果實體化失敗；最終觀測者會同時看到執行期間的規範值，以及工作階段日誌能夠持久化的確切呈現欄位。[規範工具輸出約定](../architecture/2026-07-20-canonical-tool-output-contract.md)定義值／投影與持久性規則。

### 三個承重的迴圈決策

1. **在每個擬議步驟執行 pre-step 策略。** 迴圈會在首次領取和決策之前打開輪次，因此 reject 會關閉一個持久、blocked 且不含步驟或模型可見訊息的輪次。即使工具續步沒有新取得所有權的輸入，也會提交空批次，使逐請求上下文生產方可以把帶日誌的訊息加入這一次請求。enter 時，迴圈先開啟步驟，再把返回批次作為 `user/message` 追加，然後派生請求。依照[一次 send 對應一個輪次的簡化](../simplification/2026-07-17-one-send-one-turn.md)，每個已領取 follow-up 仍是其輪次中唯一的直接提示詞。

2. **工具執行後的 `additionalContexts` 與非同步注入進入活躍批次 FIFO，並在該批次結帳時追加。** `content`/`feedback` 塑造 `execute()` 返回的結果，但每項上下文都是一條獨立的帶來源 `user/message`，而單個步驟或組合工具可以產生許多上下文。立即追加上下文會產生 `result(c1) → context → result(c2)` 的交錯，或把巢狀上下文放在外層結果之前，破壞工具呼叫／工具結果鄰接性。因此 `ToolRunContext.deferContext()` 會在失敗路徑上也收集巢狀調度上下文，`execute()` 在 `ToolExecutionResult` 上暴露有序陣列，迴圈再把它接納到與執行期間 `agent.inject()` 呼叫相同的 FIFO 中。FIFO 在批次結帳時，在所有已記錄結果之後追加，其中也包括被中斷輪次關閉之前。被接受的外層呼叫將 deferred contexts 保留在 decision contexts 之前；被外層阻止時則丟棄 deferred contexts，只暴露阻止 decision 顯式提供的上下文。

3. **stopping 監聽器透過 steering 通道請求繼續執行**，使得下一步驟在迴圈頂部排空時將其記錄為當前輪次的 steering——同一輪次內的下一*步驟* steering，而非下一*輪次*的提示詞。

### 工具執行前輸入重寫是一個獨立的一致性決策

`PreToolDecision` 不能重寫參數。歷史和審計呼叫在執行前記錄，UI 展示讀取相同的輸入，因此登錄檔在策略之前封存參數。有效的重寫必須在身份建立之前同時更新歷史、審計、展示和執行；該約定屬於[輸入重寫提案](../../proposed/feature/2026-06-30-pre-tool-input-rewrite.md)。

### 邊界

Service Definition 包**不**聲明 `hook/*` 工作階段事件（持久的掛鉤呼叫日誌）；那些屬於 `dsh-hook-protocol`，因為原生外掛程式使用類型化 decision 而無需外部掛鉤日誌。原生外掛程式整合測試（`packages/core/agent-loop/tests/interception.spec.ts`）透過真實迴圈組合這些擴充點，不涉及 `hook/*` 協議。壓縮（compaction）（`PreCompact`/`PostCompact`）、Notification 和 Codex `PermissionRequest` 不在本決策範圍內。[審批 seam](2026-07-06-approval-seam.md) 透過 `ctx.approval` 解析 `ask` decision；終結性的單調停止由工具結果資料表達，而 `agent/turn-stopping` 是引導再執行一步的最後機會。

## 曾考慮的替代方案

- **將工具執行前輸入重寫作為本擴充點集合的一部分發布**：推遲，視為越界訊號；上文已闡述一致性問題（審計、歷史和展示都讀取執行前記錄的 `tool/call.arguments`），[工具執行前輸入重寫提案](../../proposed/feature/2026-06-30-pre-tool-input-rewrite.md)負責該設計。
- **將持久的 `hook/*` SessionEvents 與擴充點一起聲明**：否決。原生外掛程式使用類型化 Decision 而完全不需要掛鉤日誌（實際示例已證明），因此持久日誌屬於[掛鉤協議庫](2026-06-30-hook-protocol-lib.md)，而非擴充介面。

## 後果

規範攔截介面具有統一的類型化，同時不給每個擴充相同的權力：掛鉤返回 decision，執行包裝層做包裝，終結 guard 只能拒絕，最終觀測者只能觀測。迴圈負責 session-start、pre-step 領取結帳、工具執行後上下文緩衝和 stopping；`dsh-tools` 負責身份封存與五階段執行管線。它們的約定記錄在 [architecture.md](../../../../docs/architecture.md)、各包 README、[核心攔截 decision](../../../../docs/subsystems/core.md#interception-decisions) 與[工具結構](../../../../docs/subsystems/tools.md)中。ACP 橋接會把 blocked 無步驟輪次中的首次 pre-step reject 結帳為 `end_turn`，而掛鉤驅動的快照端到端驗證可觀測的橋接行為。
