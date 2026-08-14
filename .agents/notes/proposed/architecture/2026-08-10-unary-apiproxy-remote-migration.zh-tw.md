# Agent Note: 將簡單的一元 API Proxy 呼叫遷移到業務 Remote 服務

Status: proposed

[English](2026-08-10-unary-apiproxy-remote-migration.md) | [简体中文](2026-08-10-unary-apiproxy-remote-migration.zh.md) | 繁體中文

## 問題

Host API Proxy 仍承載許多一元方法。這些方法的實作僅執行服務尋找、參數投影、一次業務呼叫和回應投影。儘管 [Typert Remote 呼叫](../../implemented/architecture/2026-08-02-typert-remote-method-calls.md)已經允許業務包承載此類呼叫，這種做法仍會在業務服務、API Proxy 介面、Zod schema、路由表、用戶端 stub 和 Client 呼叫方之間重複定義同一約定。

僅機械遷移方法並不足夠。與 Agent 綁定的 API Proxy 方法會呼叫 `agentFor()`：它複用 live Agent，使用普通冷 Session 中記錄的 preset 復原該 Session，對並行復原去重，並拒絕由 subagent 擁有的 identity。如果 Remote 方法以不同方式解析 `Agent` 或 `Session`，即使最終業務呼叫看起來相同，也會改變生命週期行為。

API Proxy 還包含一些不以業務方法為約定的 BFF 操作：Session 生命週期與 transcript（文字記錄）組裝、模型選擇狀態、僅限 live 的輸入控制、設定過濾、skill（技能）呈現、Host 組合資訊和原生桌面操作。有狀態互動與流又具有不同的生命週期。若把一元呼叫的文法一概視為方法簡單的依據，就會把產品策略移入任意服務包，或者迫使系統新增沒有獨立業務所有者的包。

最後，Connection 目前在 API Proxy 回退路徑內執行僅限環回地址的特權方法清單。Typert interceptor 會先於該回退路徑認領自己的端點，因此，如果遷移憑據或 preset 創作呼叫時不一並遷移權限檢查，受信任的局域網呼叫方就會獲得目前僅向環回呼用方開放的操作權限。

## 提案

只遷移符合以下條件的一元呼叫：其業務操作已經有自然歸屬的服務，且其餘適配只是少量參數或結果投影。當現有方法的簽名就是預期的消費端約定時，服務應綁定 Typert namespace，並直接使用 `@Remote` 裝飾現有方法。只有執行實質性適配時纔有理由新增方法；不得新增只做恆等轉發的 `remote*` 包裝層。

`@deepseek-ai/dsh-api-remotes/client` 將掛載所選各業務包生成的 `/remote` 貢獻。Client 業務包將呼叫 `ctx.remote.<service>`，並在包內執行歸 Client 所有的關聯或呈現投影。對應的 API Proxy 介面成員、schema、路由、處理程序、生成的用戶端方法、fixture（測試前置資料）實作和生產呼叫點，將在該服務的縱向提交中一並移除。

大型 BFF 方法仍留在 `dsh-host-apiproxy` 中。如果實作過程中發現某個方法包含端點特有的生命週期策略、大量編排、Client 相依性僅存在於協議層的錯誤區分，或者其傳輸資料結構無法用歸屬方的小型配接器表達，則該方法不在此次遷移範圍內。

## 遷移集合

| 舊 RPC | Remote 目標 | Host 方法 | 適配 |
|---|---|---|---|
| `session.rename` | `ctx.remote.sessionTitle`，位於 `@deepseek-ai/dsh-session-title` | `SessionTitleService.rename(Session, title)` | 直接使用 `@Remote`；Client 將 `eventSeq` 對映到自身的標題投影序列。 |
| `command.list`、`command.execute` | `ctx.remote.commands`，位於 `@deepseek-ai/dsh-commands` | `CommandRuntime.list(Agent)`、`execute(Agent, line, signal)` | 直接使用 `@Remote`；Client 將 `undefined` 對映為未匹配結果，並保留呼叫方的取消行為。 |
| `llm.providers` | `ctx.remote.llm`，位於 `@deepseek-ai/dsh-llm` | `LlmRuntime.listProviders()`、`listConfigurableProviders()` | 兩項讀取都直接使用 `@Remote`；Client 關聯註冊行與設定目錄行。 |
| `credentials.describe`、`credentials.set`、`credentials.unset` | `ctx.remote.credentials`，位於 `@deepseek-ai/dsh-credentials-local` | `LocalCredentialProvider.describe(ref)`、`set(ref, value)`、`unset(ref)` | 直接使用 `@Remote`；當 UI 請求多個 ref 時，Client 批次發起 `describe` 呼叫。 |
| `agentPreset.read`、`agentPreset.copy`、`agentPreset.remove` | `ctx.remote.agentPresets`，位於 `@deepseek-ai/dsh-agent-presets` | `readDocument(id)`、`copy(from, id, name?)`、`remove(id)` | `copy` 和 `remove` 直接暴露現有方法；`readDocument` 將儲存的內容與一次即時發現取得的元資料組合。 |
| `subagent.interrupt` | `ctx.remote.subagents`，位於 `@deepseek-ai/dsh-subagent` | `interruptByParent(targetSessionId, parentSessionId)` | 配接器構造內部的使用者權限變體，不解析也不復原任一 Agent。 |
| `workspace.list`、`workspace.insertSessionBefore`、`workspace.archiveSession` | `ctx.remote.workspace`，位於 `@deepseek-ai/dsh-workspace` | `snapshot()`、`insertSessionBefore(workspaceId, sessionId, before?)`、`archiveSession(sessionId)` | 登錄檔配接器分離可變實體，並返回已完成更新的 workspace 或歸檔快照。 |

Remote API 有意採用服務名稱，而不保留舊 RPC 的點分名稱。例如，Session 重新命名將變為 `ctx.remote.sessionTitle.rename(...)`。

## 暫緩遷移的 API Proxy 領域

| 領域 | 方法 | 保留在 API Proxy 中的原因 |
|---|---|---|
| Session Host 生命週期 | `session.list`、`search`、`create`、`fork` | 跨 Agent 持久化、Workspace 分配、preset 組合和建立策略。 |
| Session transcript | `session.history`、`attachment`、`subagent.history` | cold／live 日誌、分頁、投影、呈現器和附件授權。 |
| Agent 模型選擇 | `session.models`、`selectModel` | 各 Agent 的狀態、模型校驗和預設值持久化屬於 BFF 策略。 |
| Agent 輸入與控制 | `session.prompt`、`updateQueue`、`cancel` | 圖片准入、Inbox 變更和端點特有的僅限 live 語義。 |
| 設定 Remote | `settings.describe`、`openDocument`、`update`、`replace`、`mutate` | namespace 暴露、脫敏、修訂檢查和原生打開操作屬於產品策略。 |
| Session skill 目錄 | `skill.list` | 不得復原冷 Session；preset 的常駐 scope 和呈現器過濾屬於 BFF 關聯操作。 |
| Host 執行時期資訊 | `host.describe` | 版本、cwd、默認模型和當前已附加的 Session 數量來自多個 Host 所有者。 |
| Host 路徑打開 | `host.openPath`、`agentPreset.openDocument` | 原生桌面權限和取消屬於 Host 組合。 |
| 其餘 preset、subagent 和 workspace 呼叫 | `agentPreset.list`、`select`；`subagent.list`、`history`、`prompt`；`workspace.create`、`rename`、`delete` | 這些呼叫包含名單策略、live／cold 關聯、授權或多項操作的序列執行順序。 |
| 有狀態協議和流式協議 | 審批、問題、回應、mux 和 Host 流 | 它們不是一次請求／一次結果的業務呼叫。 |

`workspace.delete` 與 `create` 和 `rename` 保持在一起，因為三者都參與同一條序列的建立／命名／刪除操作鏈。單獨遷出一個方法會使服務與 API Proxy 觀察到不同的操作順序。

## Agent 與 Session lookup 等價性

`createApiRemoteAgentResolver()` 構造一個 resolver，並將其作為 API Proxy 的 `agentFor` 返回。同一個 closure 透過 `ctx.typert.lookups.configure('agent', ...)`、`ctx.typert.lookups.configure('session', ...)` 和 `ctx.typert.contexts.configureHost('agent', ...)` 安裝。因此，Remote `Agent` 或 `Session` 參數與舊版 `agentFor()` 呼叫共享同一套 live lookup、進行中的復原表、持久化檢查、感知 preset 的 setup 和 ownership fence。

遷移必須用整合測試固定以下結果：

- 直接複用普通的 live Agent，不執行復原；
- 根據持久化的 header、事件和已記錄的 preset setup 復原普通冷 Session；
- 對同一個 id 並行執行 Agent 與 Session lookup 時，共享同一次復原；
- 無論 live 還是 cold，由 subagent 擁有的 identity 都會在業務呼叫前以 `agent-busy` 失敗；
- 持久化儲存中不存在的 id 以 `session-not-found` 失敗；
- resolver 失敗會保留現有的 `RpcError`，並透過 `TypertLookupFailure` 傳遞。

Lookup 策略作用於整個 key，而非特定端點。提示詞輸入、佇列編輯、取消、模型選擇和 skill 清單等方法如果使用共享 `agent` 或 `session` lookup，就無法保留僅限 live 或禁止復原的行為，因此在 Typert 支持顯式的逐端點策略之前，這些方法仍留在 API Proxy 中。

簽名只包含 branded id 的方法不會呼叫 Typert 對象 lookup。`subagents.interruptByParent()` 必須保留現有的行程內 Activation lookup 和父級離線行為：它不會呼叫 `agentFor`、讀取目錄、檢查持久化，也不會冷復原父 Agent 或子 Agent。

## Client 與錯誤行為

生成的 Remote 方法返回業務值，並拋出一個 Error，其 `cause` 包含現有的 RPC 失敗。Client 業務服務負責適配到當前的結果／store 介面。它們必須像當前一樣讓成功結果立即生效，使事件幀仍是冪等重播，而非唯一的更新路徑。

Resolver 擁有的 `session-not-found` 和 `agent-busy` 錯誤保持穩定，因為共享 resolver 會拋出 `TypertLookupFailure`。普通業務例外會變成 Gateway 現有的 `internal` RPC 失敗。只有在選定的 Client 消費端不根據更具體的舊版業務錯誤碼進行分支時，才能遷移該呼叫；如果實作過程中發現這種分支，除非業務包新增與傳輸無關的類型化失敗，否則該 RPC 將退出此集合。

## 特權呼叫權限

Connection 必須在選擇 Typert interceptor 或 API Proxy 回退路徑之前檢查呼叫方是否有權訪問特權端點。該檢查必須同時識別舊式點分名稱和 Remote 斜槓端點，並保持以下已遷移操作僅限環回地址：

- `agentPresets/readDocument`、`agentPresets/copy` 和 `agentPresets/remove`；
- `credentials/describe`、`credentials/set` 和 `credentials/unset`。

貫穿整個載體的 trusted-host 和 origin 檢查保持不變。這是一項非升權要求：端點所有權可以變化，但獲準呼叫該操作的呼叫方集合不得擴大。

## 提交邊界

此次遷移將以一個 RFC 提交、每項服務各一個縱向提交，以及一個最終整合提交落地。服務提交包含其 Host 綁定與裝飾器、生成約定所需的包聲明、API Remotes 掛載、Client 業務接入，以及移除該服務的舊版 API Proxy 路由和生產用戶端呼叫。服務提交可能暫時無法透過閘門，因為生成產物和共享 fixture 將在最終整合提交中統一調整。

最終提交從乾淨狀態生成所有 `/remote` 產物，更新共享 fixture 和測試，將本文移至 `implemented`，更新中央一元呼叫所有權發生變化之處仍具權威性的協議文件，並執行選定的倉庫閘門。

## 考慮過的替代方案

**將簡單方法保留在中央 API Proxy 中。** 這會保留統一的傳輸外觀，但仍會延續 Typert 原本要消除的重複介面、schema、路由行、stub 和業務投影。

**遷移每一個一元 API Proxy 方法。** 一元呼叫形式並不表示行為只有一個所有者。Session 編排、僅限 live 的控制、設定暴露和原生 Host 操作要麼會把 BFF 策略洩漏到通用服務中，要麼會產生沒有所有者的包。

**為 Remote 方法提供單獨的復原實作。** 第二個 resolver 可能在 preset 復原、並行去重或 subagent 所有權方面出現偏差。與舊版 `agentFor()` 共享完全相同的 closure，使等價性成為實作事實，而不只是一項承諾。

**保留每一個舊版 RPC 名稱和回應 envelope。** 這會使業務包變成舊協議的副本。面向服務的名稱和業務值讓 Client 負責關聯操作，而 Connection 繼續負責統一的 RPC envelope。

**相依性 API Proxy 回退路徑強制執行特權方法權限。** interceptor 選擇會繞過該回退路徑，因此這會悄然擴大已遷移方法的權限範圍。

## 驗收標準

- 遷移表中的每個方法都可透過表中列出的 `ctx.remote` 服務呼叫，並且不存在生產環境中的舊版 API Proxy 路由、schema、對映錶行、用戶端 stub 或呼叫。
- 簽名匹配的現有方法直接帶有 `@Remote`；每個新增方法都執行表中所述的適配，且不保留只做恆等轉發的 `remote*` 包裝層。
- Agent／Session 整合測試證明共享 lookup 的各項結果，subagent 中斷測試證明不會發生冷復原。
- 已遷移的特權端點拒絕受信任的非環回呼用方，並接受環回呼用方，且該判定在任一分發路徑執行前完成。
- 每項已遷移呼叫的 Client 行為和立即提交狀態的行為保持等價，包括支持取消之處的取消行為。
- 暫緩遷移的方法及其現有行為仍保留在 API Proxy 上。
- 一次從乾淨狀態開始的生成與建置會生成並消費所選的每項 Remote 貢獻，且聚焦測試和最終倉庫閘門均透過。

## 風險

移除舊版 schema 也會移除其協議特有的錯誤分類。如果 Client 中存在相依性其中某個錯誤碼的隱蔽分支，該呼叫就不是簡單呼叫，必須在接受相應服務提交前發現它。

生成的 Remote 約定會為每個業務包引入建置順序要求和發布條目。如果遺漏執行時期掛載、聲明匯出、source map 來源、包相依性或 Project Reference 中的任何一項，區域性原始碼測試可能仍會透過，但從乾淨狀態開始的 Client 建置會失敗。

將權限強制執行移至複合分發會改變安全敏感的載體程式碼。測試必須覆蓋一個由 Remote 擁有的端點和一個舊版回退端點，確保兩條路徑都無法繞過環回判定。

本文應用現有 Typert Remote 架構，而非取代它。本文部分取代 [GUI RPC 協議筆記](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md)中的中央一元呼叫所有權和五步擴充檢查清單，以及 [Web 設定平面筆記](../../implemented/architecture/2026-07-30-web-config-plane.md)中的中央接線清單；對於已遷移方法之外的 Connection envelope 和設定行為，這些筆記仍具權威性。標題、命令、設定邊界、subagent 中斷和歸檔筆記繼續負責各自的業務行為，只需如實更新傳輸相關事實，無需歸檔。[瀏覽器信任邊界](../../implemented/architecture/2026-07-28-api-browser-trust-boundary.md)和[生成約定建置順序](../../implemented/process/2026-08-08-api-remotes-generated-contract-build.md)仍具權威性，無需執行歸檔操作。
