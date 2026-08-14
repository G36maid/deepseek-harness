# Agent Note: 審批 seam——基於 waterfall（瀑布式事件）應答者的一次性權限決策

Status: implemented

[English](2026-07-06-approval-seam.md) | [简体中文](2026-07-06-approval-seam.zh.md) | 繁體中文

## 問題

兩個呼叫方需要同一個封閉決策——「這個具體操作可以繼續嗎？」：`tools/pre-execute` 的 `ask` 決策（包括 Claude-Code 掛鉤橋的 `permissionDecision: ask`）以及[沙盒 Agent Note](2026-07-06-sandbox.md) 中拒絕後的一次性升級重試。一個共享的 seam 使它們無需各自發明獨立的結果詞彙、通道路由、取消機制和審計軌跡，同時保證沒有應答者的部署永遠不會批准一個無法應答的請求。應答者可以是互動式宿主，也可以是自動化控制器。

路由問題的核心是歸屬：權限請求必須到達擁有發起請求的 agent（代理）的通道，對無人擁有的 agent 失敗關閉，並且不侵入沒有組合應答者的部署。

## 決策

一個包 `dsh-user-approval`（`packages/interaction/user-approval`）負責定義詞彙表和 `ctx.approval` 服務——即機制。策略——誰來應答、某個工作階段是否需要被詢問——不在其中：應答者是 `approval/request` waterfall 監聽器，由擁有通道的外掛程式註冊（ACP（Agent Client Protocol）橋、宿主配接器、測試指令碼），而每工作階段的策略層可以在任何通道介入之前做出決定。消費端（`dsh-tools` 的 ask 路由和沙盒升級閘門）將問題解析為一個封閉結果，並從中派生各自的工具結果。刻意設計為一個包，而非能力 seam 的三包拆分（見「替代方案」）。

### 部署如何使用它

一條 `cordis.yml` 條目掛載該 seam。不載入它就是默認拒絕請求的退出方式：即使沒有註冊任何審批程式碼，消費端也會拒絕無法應答的請求。

```yaml
- id: approval
  name: '@deepseek-ai/dsh-user-approval'
  # config:
  #   policy: never   # deployment default for sessions without an override; 'ask' when omitted
```

僅有這條條目只提供機制，不提供通道：沒有組合應答者時，每次 ask 都解析為 `unavailable`，發起請求的工具呼叫會被拒絕——無需設定即可做到故障時默認拒絕。組合 ACP 應用（`@deepseek-ai/dsh-acp-demo`，如 [acp-agent 示例的默認樹](../../../../examples/acp-agent/README.md)）即可閉環：其[僅面向自動化的橋接層](../simplification/2026-07-23-acp-automation-only-protocol.md)註冊一個應答者，向擁有該工作階段的用戶端傳送 `session/request_permission`，攜帶精確的工具呼叫 id 和一次性 allow/reject 選項。`policy: never` 是無人值守姿態：每次 ask 都會被確定性地自動拒絕，當前值也會加入執行時期上下文快照。`policy` 在外掛程式載入時對照封閉清單校驗；非法值直接拋例外。

組合部署的可觀測行為：`allowed-once` 僅允許該次呼叫繼續；拒絕、關閉和通道缺失以三種不同原因拒絕，模型可以區分；輪次內成功的請求會在發起請求的 agent 的工作階段日誌上落一對持久化的 `approval/asked`/`approval/decided` 事件；授權不會在發起請求的呼叫結束後繼續存在。空閒時的請求或審計追加失敗會拒絕，而不會返回未經審計的決策。

以下是該組合下的一次 ask，取自沙盒示例錄制的 `escalation-approved` 場景——模型請求沙盒升級，閘門發起 ask，自動化用戶端選擇 Allow once：

```
tool/call        bash {"command": "printf 'escalated\n' > escalated.txt && cat escalated.txt",
                       "sandbox_permissions": "workspace-write",
                       "justification": "the user asked to write escalated.txt in the workspace"}
approval/asked   {"toolName": "bash", "callId": "call_00_…",
                  "reason": "escalate sandbox to workspace-write: the user asked to write escalated.txt in the workspace"}
  → session/request_permission {"toolCall": {"toolCallId": "call_00_…"},
                  "options": [{"optionId": "allow-once", "name": "Allow once", "kind": "allow_once"},
                              {"optionId": "reject-once", "name": "Reject",     "kind": "reject_once"}]}
  ← the client selects "Allow once"
approval/decided {"outcome": "allowed-once"}
tool/result      "escalated" — this one call ran under the wider mode; the grant died with it
```

`escalation-rejected` 孿生場景以 `{"outcome": "rejected"}` 結束：不執行任何操作，模型的結果攜帶發起方的逐字失敗關閉文字（`the user rejected escalating this command to "workspace-write"`）。掛鉤的 `permissionDecision: ask` 走完全相同的協議；只有發起方和拒絕文字不同（§ dsh-tools 中的 Ask 路由）。沒有應答者時，同一請求直接結帳為 `unavailable`。

### 設計細節

#### seam：機制與策略分離

經過校驗並成功追加 `approval/asked` 後，服務將 `approval/request` waterfall 解析為 `allowed-once`、`rejected`、`cancelled` 或 `unavailable`。服務沿用只讀的請求標識和 signal，將中止視為 `cancelled`，把應答者失敗和無效返回統一轉換為 `unavailable`，丟棄遲到的應答，並追加配對的 `approval/decided` 事件。提交前的審計失敗會拒絕；追加後的觀察者失敗無法復原權威事件。`allowed-once` 僅授權所詢問的操作，而 `request()` 會拒絕進行中的輪次之外的呼叫，以保證審計對留在持久提交邊界內。

應答者是 `approval/request` waterfall 監聽器。零監聽器會直接落到 `unavailable`；識別該 agent 的監聽器佔用先到先得的決策槽，而不識別的監聽器必須呼叫 `next()` 委派。監聽器會隨其 fiber 一同 dispose（資源釋放），因此解除安裝通道後，請求會在故障時默認被拒絕。由於兄弟外掛程式的註冊順序不確定，部署應組合一個終端機應答者，並保留 `prepend` 給「決策或委派」閘門。

`ApprovalRequest` 攜帶發起請求的 `agent`、`toolName`、選填的精確 `callId`、人類可讀的 `reason` 和選填的 `signal`。它使用 `CallId` brand 而不匯入相依性本 seam 的 `dsh-tools`。通道配接器可按 `callId` 關聯任何更豐富的呼叫狀態；審批請求本身不重複攜帶工具參數。

#### dsh-tools 中的 Ask 路由

`ToolRuntime.execute()` 在派發前解析 `ask`：`allowed-once` 繼續執行，而拒絕、取消和通道不可用產生三種不同的拒絕原因。機會性消費 `ctx.get('approval')`，讓缺失或未掛載的服務失敗關閉而不阻塞登錄檔 fiber。無 agent 的執行同樣失敗關閉，因為它既沒有審計工作階段，也沒有通道所有者。

#### 每工作階段策略層

seam 還擁有[沙盒 Agent Note](2026-07-06-sandbox.md) 所描述的工作階段級 `'ask' | 'never'` 策略。生效策略由日誌中記錄的切換在部署預設值之上摺疊而成。`'never'` 會在任何應答者執行之前，於 `request()` 內部解析為 `rejected`；`'ask'` 則派發請求，否則一路委派至 `unavailable`。兩個當前值都會在每次模型請求前加入原子化的執行時期上下文快照，因此策略切換無需單獨敘述；每次審批請求仍會記錄審計對。

#### ACP 應答者

ACP 橋只應答其工作階段對映所擁有的精確 agent 對象。它攜帶既有 `callId` 傳送 `session/request_permission`，聲明一次性的 allow/reject 選項，單獨對映取消，並且絕不批准未知選項。不屬於該橋或沒有呼叫標識的請求會繼續委派；用戶端 RPC 失敗會轉換為 `unavailable`。掛鉤和 `tools/pre-execute` 決定一次呼叫是否需要詢問。該通道是自動化用戶端與其 agent 之間的機器策略，不是 ACP 展示層。

應答者透過[僅面向自動化的 ACP Agent Note](../simplification/2026-07-23-acp-automation-only-protocol.md)描述的橋精確 agent 歸屬檢查進行路由，保留了[多工作階段 Agent Note](2026-06-14-acp-multi-session.md) 要求的每工作階段權限歸屬。

#### 審計，以及模型看到什麼

`approval/asked` 和 `approval/decided` 是持久的僅日誌事件；模型只看到從結果派生出的普通工具結果。成功完成時，每個 `asked` 都提交一個 `decided`，包括取消以及已轉換為封閉結果的應答者失敗。空閒時的請求不追加任何事件；提交前失敗會拒絕，而第二次追加失敗可能留下一個已經提交但未匹配的 `asked`。

#### 實體與相依性

`dsh-user-approval` 相依性 Cordis，以及工作階段、agent 和帶 brand 的呼叫約定；`dsh-tools` 與 `dsh-acp` 消費它。沙盒執行器保持獨立，因為升級請求歸 `dsh-tool-bash` 所有。固定的派發與審計服務仍是一個包；可替換的應答者留在各自的通道所有者中。靜態能力授權和 `subagent-acp` 子側權限應答仍是獨立關注點。

### 測試

單元測試鎖定結果、先到先得的委派、錯誤轉換、取消、作用域路由、審計配對、不可繞過的 `'never'` 策略、工具拒絕原因，以及透過真實指令碼化橋實作的 ACP 歸屬／結果對映。

快照記錄透過 `session/request_permission` 批准和拒絕沙盒升級，以及完整的 `'ask'` 與 `'never'` 執行時期上下文貢獻。沒有指令碼化應答的權限提示會取消並失敗關閉。

## 延後

- **`allow_always` 授權儲存**：兌現持久授權意味著設計儲存、作用域標識（呼叫？路徑？前綴？工作階段？時間視窗？）和撤銷；在設計完成之前，只展示一次性選項（[沙盒 Agent Note](2026-07-06-sandbox.md) § Escalation 記錄了開放的作用域問題）。
- **透過組合應答者錄制由掛鉤驅動的 `ask`**：權限協定格式（wire format）已透過沙盒示例的升級分支錄制。掛鉤矩陣中的 `hook-cc-pretool-ask` 固定無 ApprovalService 時的後備拒絕，而掛鉤生產者與應答者的組合仍留在單元測試層。
- **將子 agent 的審批路由到父工作階段**：`subagent-acp` 的子側自動應答自己的權限請求；將其委派給父控制器是獨立的設計。

## 曾考慮的替代方案

- **單一註冊提供方而非 waterfall 監聽器**：否決。`registerProvider()` API 迫使所有組合問題——允許清單預過濾、外部掛鉤決策者、指令碼化測試應答、人類前面的策略閘門——都塞進一個提供方實作。waterfall 直接複用執行時期已有的組合能力、缺失時默認拒絕行為和 HMR（熱模組替換）資源釋放機制；seam 的 JSDoc 以約定固定單決策槽語義，而非發明一個提供方登錄檔。
- **在 ACP 橋中內聯 `tools/pre-execute` 權限閘門**：否決。對橋擁有的每次呼叫都彈出提示，會將請求策略硬編碼進傳輸層，無法服務第二個發起方（沙盒升級發生在執行開始之後，沒有 pre-execute 時刻），且掛鉤產生的 `ask` 決策沒有共享機制。
- **通用使用者互動 seam（`ctx.userQuestions`）**：否決作為審批機制。二者骨架相似（按 agent 路由、阻塞等待人類、處理缺失），但審批的約定在每個關鍵維度上都更窄：封閉的結果詞彙而非自由文字、附著在工具呼叫上的協議原生提示而非通用表單、強制的缺失時失敗關閉、以及審計事件。因此審批不走已交付的 `packages/interaction/user-questions` / `ask_user_question` 資訊徵集路徑——資訊徵集表單不是權限提示，自由文字應答不是封閉結果；如果二者將來趨同，共享提供方管道仍然開放。
- **`dsh-tools` 中的靜態選填注入**：否決。vendor 的 Cordis `Inject` 類型沒有 optional 標志——對象形式將服務名對映到攔截設定，聲明的 inject 會阻塞 fiber。`ctx.get('approval')` 是文件化的機會性消費模式（`tool-bash` 的 owner-token 尋找、loop 的持久化探測），按呼叫讀取存在性，跨 HMR 正確降級，無需額外機制。
- **能力 seam 的三包拆分**：否決。Service Definition/Service Provider/Consumer 適合 Service Provider 可替換的 seam（bash-local vs bash-sandbox）。此處服務體是固定機制，可變部分是留在各自通道擁有者外掛程式中的監聽器——拆分只會製造一個空的 Service Provider 包（「不要預防性拆分」）。
- **現在就提供 `allow_always`**：否決。協議能表達它，但兌現它意味著設計授權儲存、作用域標識和撤銷（§ 延後）。展示 harness 無法兌現的選項只會製造註定失敗的授權。

## 後果

實作後的約定由「測試」一節所列套件固定：

- `allowed-once` 派發一次操作；其他所有結果都以不同原因拒絕，而 `'never'` 會在提示前拒絕。
- 缺失、外部、無 agent、拋例外、無效或中斷連線連線的應答路徑都會失敗關閉。
- 成功的請求按精確 agent 歸屬路由，並追加一對可重播、對模型不可見的審計事件；空閒時和提交前失敗的請求會拒絕。
- ACP 歸屬把決策限制在其工作階段內，而沒有該服務的部署不產生請求或審計事件。

代價與已接受的侷限：

- **兩個都會直接作出決策的應答者會競爭同一槽位。** 兄弟外掛程式的監聽器順序不確定，seam 無法仲裁競爭的終端機應答者。透過約定緩解（每個部署一個終端機應答者；僅對「先決策或委派」閘門使用 `prepend`），而非事件總線不具備的優先級機制。
- **生產路徑僅在一種組合下得到驗證。** `ask` 有兩個生產者家族——掛鉤橋透過 `tools/pre-execute`，沙盒升級透過自己的閘門——協定格式錄制在沙盒示例的快照套件中；因此在更多部署組合它之前，seam 的真實覆蓋面就是這一種組合。
- **歸屬以 `Agent` 對象標識為鍵。** 應答者先在 `agent.session.id` 處解析工作階段對映記錄，再要求該記錄擁有精確的 agent 對象；當前所有路徑在 loop 和各 seam 之間傳遞同一對象，但未來如果某個邊界克隆或代理了 agent，橋會委派並失敗關閉，屆時需要另一種歸屬約定。

## 常見問題

- **在完全沒有應答者的部署中（headless、CI）會發生什麼？** 每次 ask 都會沿空的 waterfall 落到 `unavailable`，工具呼叫以「no approval channel is available」原因被拒絕。失敗關閉是零監聽器的默認行為，不是設定。
- **授權能持久化嗎——「始終允許」？** 不能。`allowed-once` 僅授權單次被詢問的操作，服務在請求之間不儲存任何內容；`allow_always` 在授權儲存設計完成之前刻意不展示（§ 延後）。
- **模型看到審批的什麼？** 只看到發起方從結果派生的工具結果——審計對永遠不進入 transcript（文字記錄）。三種非授權原因各不相同，模型可以區分人類說「不」、提示被關閉、通道缺失。
- **誰決定一次呼叫是否需要 ask？** 策略生產者：返回 `permissionDecision: ask` 的掛鉤、任何 `tools/pre-execute` 監聽器、或沙盒升級閘門。seam 和橋只負責路由和應答；二者都不注入自己對「什麼值得彈出提示」的判斷。
- **使用者關閉提示或輪次在 ask 進行中中止時會發生什麼？** 關閉對映為 `cancelled` 並攜帶自己的拒絕文字。已中止的 signal 直接結帳為 `cancelled` 而不派發；ask 進行中的中止丟棄遲到的應答。當兩個審計追加都提交時，任一路徑都記錄恰好一對事件，絕不會兩對。
- **如果用戶端以 harness 從未提供的選項應答呢？** 除已提供的 `allow_once` 之外的任何選項都對映為 `rejected`——來自不合規用戶端的未知 optionId 永遠不能授權。
- **subagent 的審批如何路由？** 不路由：委派會把每個行程內子 agent 釘定為 `'never'`（[審批釘定決策](2026-08-10-subagent-approval-pinned-never.md)），因此子 agent 的每次 ask 都在任何應答者之前解析為 `rejected`，子 agent 則透過其執行時期上下文一開始就會得知。`subagent-acp` 的子側自動應答是獨立的；將子 agent 的 ask 路由到父控制器已延後（§ 延後）。
- **`policy: 'never'` 在執行時期實際改變了什麼？** 服務在派發任何應答者之前，將該工作階段的每次 ask 解析為 `rejected`（在服務內部，因此沒有註冊順序能繞過它）；下一份原子化的執行時期上下文快照會聲明該策略；每次成功的自動拒絕都會記錄審計對。
- **熱重新載入或應答者在工作階段中途解除安裝時會發生什麼？** 應答者隨其擁有的 fiber 一起 dispose，因此下一次 ask 降級為 `unavailable` 而非掛在死通道上；重新掛載會重新註冊應答者，無需追趕狀態。
- **用戶端從哪裡獲得審批上下文？** 請求攜帶精確的 `callId` 和發起方的人類可讀 `reason`；通道配接器可自行關聯更豐富的工具呼叫狀態，而無需在審批 seam 中重複攜帶參數。

## 先例

本設計複用或對照的倉庫內先例：

- `fs/write-intent` 閘門（`packages/fs/fs/`）——文件化的單佔用決策槽 waterfall 語義（先到先得，透過 `next()` 委派），應答者約定複用了它。
- `hook/invoked`/`hook/result`——僅日誌審計對先例，`approval/asked`/`approval/decided` 沿用了它；[掛鉤橋 Agent Note](2026-06-30-hook-bridges.md) 交付了 `permissionDecision: ask`，即第一個生產者。
- [攔截擴充點 Agent Note](2026-06-30-interception-extension-points.md)——`tools/pre-execute` 的 `allow`/`deny`/`ask` 詞彙，本 seam 服務其中的 `ask`。
- [僅面向自動化的 ACP Agent Note](../simplification/2026-07-23-acp-automation-only-protocol.md)——應答者路由時對工作階段對映執行的精確 agent 歸屬檢查；[多工作階段 Agent Note](2026-06-14-acp-multi-session.md)——本設計實作的每工作階段權限歸屬阻塞項。
- 機會性 `ctx.get()` 消費模式（`tool-bash` 的 owner-token 尋找、loop 的持久化探測）——`dsh-tools` 消費該 seam 而不阻塞其 fiber 的方式。
