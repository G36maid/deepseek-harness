# @deepseek-ai/dsh-host-apiproxy

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

所有用戶端共用的 API 閘道由三部分組成：TypeScript API 約定（`src/api/`，不相依性 Node，可從瀏覽器匯入）、fetch 載體對（`src/fetch/`：宿主側的 `toFetchHandler`，以及用戶端側的 `AbstractApiClient` 與平臺子類）和宿主側實作（`src/api-proxy.ts`：`createApiProxy` 加上預設匯出的 `ApiProxyService` 閘道外掛程式，其設定為 `{nativeOpen?, sessionExportCompressionLevel?, coldBlankProbeMaxBytes?}`，提供 `ctx.apiProxy`）。該包不註冊任何路由；HTTP 等載體自行包裝 `ctx.apiProxy`。隨發行版交付的 Web 組合位於 [`packages/bundle/web-app/cordis.patch.yml`](../../bundle/web-app/cordis.patch.yml)，其預設 Agent（代理）模型選擇屬於 base 組合包中的 [`@deepseek-ai/dsh-agent-default-model`](../../core/agent-default-model/README.md)。

## 共享 Agent 預設值（`agent-default-model` Settings 分節）

`ApiProxyService` 消費 `ctx.agentDefaultModel`；它不持有提供方／模型設定或 Settings 分節。共享服務在 `agent-default-model` 下註冊 `{provider, model, reasoningEffort?}`：base 組合包的組合條目是底層，`settings.yaml` 把使用者選擇疊加其上。

工作階段每次訪問時都按三級解析模型選擇：本行程內作出的選擇，其次是該工作階段日誌中最新的 `request/header`，最後是這個預設值。已經跑過一輪的工作階段從自己的日誌推導選擇，空白工作階段則能觀察到建立之後保存的預設值。

`session.selectModel` 會把接受的切換儲存為部署預設值；沒有單獨的選擇動作。它儲存已解析的 `ModelSelection`，包括配接器實體化的預設推理（reasoning）強度。完整分節寫入會在所選模型沒有推理強度時清除已存值。儲存失敗只記日誌，不會撤銷工作階段選擇。沒有設定提供方的部署保留組合條目，切換只對當前工作階段生效。

Settings 分節中的 `reasoningEffort` 在 agent-default-model 外掛程式設定中刻意沒有對應欄位：seam 按欄位把使用者層合併到組合條目之上，因此缺席的鍵無法覆蓋已有鍵，組合層中的推理強度會在以後選擇沒有推理強度的模型時繼續存在。推理強度的部署預設值屬於按模型解析的配接器 profile。

儲存的選擇獨立於目錄成員關係。預設值指向不可用的提供方時，它仍會作為工作階段的 `current` 送到 `session.models`，讓選擇器請求使用者重新選擇，而不是靜默選用其他模型。反過來，配接器也可以服務其目錄中未公佈的模型。

## 約定層（`/api`）

協定訊息組成一個四象限可辨識聯合：發起方 × 請求／回應，與物理通道解耦。四種訊息分別是 `ClientRequest`（POST `/api/<method>` 的請求體）、`ServerResponse`（該 POST 的回應體）、`ServerRequest`（SSE（Server-Sent Events）幀）和 `ClientResponse`（POST `/api/respond` 的請求體）。回應始終回顯對應請求的 `rpcId`，絕不簽發新值。方法的參數與回傳值結構只存在於領域介面簽名（`SessionsApi`、`HostApi`、`EventsApi`）中；`RpcMethodMap` 註冊方法，其他所有位置均透過 `RequestPayload<K>`／`ResponseValue<K>` 派生。Zod schema 以 `satisfies z.ZodType<Wire<T>>` 錨定類型，並分兩層解析：先解析信封，再解析業務載荷，隨後按方法分發。業務錯誤由 `RpcResult` 的錯誤分支承載（`RpcErrorDetailsMap` 封閉錯誤碼集合）；HTTP 狀態只表達載體層結果。每個 `/api` POST 都必須聲明 `application/json` 媒體類型——否則在分發前即以 415 拒絕，因此跨站「簡單請求」（瀏覽器不經 CORS 預檢就會發出）永遠無法盲目執行有副作用的方法。

分層與協定決策記錄在 [GUI 分層與 RPC 協定 RFC](../../../.agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md) 中；瀏覽器側消費架構記錄在 [Web 用戶端架構 RFC](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) 中。

首個回答認領待處理請求之前，系統會對照該請求校驗問題回應。多選題的回答項可以同時攜帶 `selected` 中的請求選項標籤與非空 `custom` 文字；單選題的回答項必須二選一。標籤重複、標籤未知、id 不匹配、批次不完整以及自訂文字為空都會以 `bad-response` 拒絕。

`session.history` 會讀取已附加 Session 的記憶體狀態，或透過持久化檢查冷日誌，而不會復原或發布 agent，然後按追加來源的訊息邊界分頁：`maxMessages` 統計以追加方式進入 surface 的 `user/message` 和 `assistant/message` 事件，因此僅供模型使用的替換副本不佔用配額。每一頁仍是一段連續的原始事件區間，從而讓壓縮（compaction）的僅日誌 `compaction/summary` 記錄與引用它的替換留在同一頁。

`session.history` 的尾頁（不帶 `beforeSeq`）額外攜帶一個選填的 `projections` 塊——`ctx.sessionProjections`（`@deepseek-ai/dsh-session-projection`）上每個已註冊單元的水位線快照，`asOfSeq` = 這些值共同反映到的最後一個事件 seq（空日誌為 `-1`）。閘道還訂閱登錄檔的變更流，為每個狀態發生變化的單元生成一個 `session/projection` mux 幀（`{sessionId, key, value, seq}`——即時推送狀態，絕不入日誌；用戶端按 seq 高者勝維護一個按工作階段的通用值倉）。載體不持有其他領域的知識（每個值在登錄檔內部已過其單元自己的 schema；協定 schema 對 `values`/`value` 保持寬鬆）；loadOlder 頁永不攜帶該塊，未裝登錄檔的組合則兩個面都不提供。閘道擁有兩個單元：`sessionListMetadata` 快取用於 `session.list` 的單調 blank→nonblank 轉換與最新真人 prompt 時間；`imageLimits` 則把 prompt 准入時執行的 attachments 設定作為每次啟動恆定的值發布（`apply` 保持狀態引用不變，因此只靠基線攜帶、絕不產生變更幀），供用戶端在提交前拒絕超限的加入並給上傳入口標註上限，後者僅在登錄檔與 attachments 服務同時組合時啟用。

工作階段日誌匯出是宿主側的下載面，不是 RPC：`GET /api/session.export?sessionId=…&includeDescendants=true` 流式返回一個 ZIP，其中每個文件都是工作階段儲存工件的逐字原文（持久化後端的 `readRaw`——按物理編碼解碼的確切持久化位元組，絕非從解析後事件重建），根工作階段放在其原始基礎檔名下，每個子代理後代放在 `subagents/<id>/` 下，每個被任何包含的日誌引用的圖片放在 `media/<attachmentId>.<ext>` 下（從附件儲存讀取並校驗；共享圖片只出現一次）。`HEAD` 會執行相同的根工件準備，並在沒有回應 body 的情況下返回狀態與回應標頭，使瀏覽器 Client 可以在把 GET 交給原生下載管理器前發現流式傳輸前的失敗。每個即時根工作階段或後代都會在學取原始工件前立即透過權威的 `SessionStore.flush` 持久性屏障；冷工作階段沒有需要 flush 的記憶體工作。壓縮在宿主側使用 fflate 流式 Zip API 和已驗證的 `sessionExportCompressionLevel` 0–9（預設 6），使部署可以在 CPU／延遲與封存大小之間取捨；回應邊生成邊分塊寫出，宿主從不把整個封存放進單個緩衝區。回應佇列達到 64 KiB 位元組高水位後，生產會等待 Consumer pull 復原正容量；fflate 的同步回呼最多隻會讓該界限多出一次有界輸入 push 的輸出。請求中止或回應 body 取消會停止血緣與工件工作、終止活躍壓縮器，並繼續按取消傳播，而不會變成 HTTP 500。它要求同時掛載持久化、session-query 與附件服務：任一缺失應答 500，持久化後端不提供每工作階段原始工件時應答 501，根工作階段缺失時應答 404，後代缺少儲存工件或引用的圖片無法讀取則整個流失敗（fail-loud，絕不靜默少匯出）。端點由傳輸層掛載，`ApiProxy.downloads.sessionLog` 實作它。

工作階段標題與其他所有領域一樣搭乘這對通用投影機制——歷史尾頁的 `projections` 塊外加 `title` 鍵下的 `session/projection` 幀。標題不會加入 `session.list`；冷工作階段在其中仍只有中繼資料，直到打開或復原操作附加其日誌。`session.rename` 接受使用者顯式標題（冷工作階段先復原），委託給 `ctx.sessionTitle.rename`——被接受的 `session/title` 事件將標題釘住、不再被自動生成覆蓋——並返回規範化後的標題及其事件 seq，讓 client 在推送幀到達前就結帳自己的 `title` 投影格；規範化後為空的標題返回 `title-invalid`。

`session.fork` 將選填事件錨點對映到該錨點處或其後的首個 `turn/end`，使訊息操作可包含該訊息所在的完整輪次。錨點省略或超過末尾時，選擇最後一個已完成輪次；若錨點已在日誌中，而其所在輪次仍開放，則返回 `fork-unavailable`，不會向較早位置裁剪。發布後的子工作階段會先繼承源工作階段的種子歷史、cwd、日誌中最新的 `ModelSelection` 及譜系，再加入源 Workspace。如果附加到 Workspace 失敗，`workspace-attach-failed` 會攜帶已發布的子工作階段 id，供用戶端對帳。[SessionStore fork 決策](../../../.agents/notes/implemented/feature/2026-06-30-session-store-fork-api.md)記錄了為何錨點要對映到該 `turn/end`。

工作階段模型選擇屬於工作階段領域約定。`session.models` 將當前 `ModelSelection` 與按提供方分組的建議性模型、精確模型的推理中繼資料和逐提供方查詢失敗記錄分開返回。該選擇可能不在這些分組中，也絕不會作為合成行注入；用戶端可以提示使用者作出另一項選擇，而無需把目錄變成路由白名單。`session.selectModel` 校驗由配接器持有的選填推理強度，並指定下次組裝提示詞時使用的完整選擇。目錄成員關係不構成校驗：配接器可以解析未列出的模型，而不可用的提供方或不受支援的推理強度會返回 `model-unavailable`。`session.models` 還會報告 `routable`，即當前是否有配接器為所選提供方提供服務。該值刻意不從分組推導，因為配接器可以服務未公佈的模型。`session.prompt` 會依據同一事實，在開啟輪次之前以 `model-unavailable` 拒絕；用戶端停用 composer 只是提示性設計，這個方法始終可被呼叫。

`session.prompt` 和 `subagent.prompt` 接受選填的請求本機 `clientTimeZone` 來源資訊。若提供該值，Host 會在進入 Agent 前校驗 `UTC` 或 IANA Area/Location 並將其規範化；無效輸入以 `invalid-time-zone` 拒絕，規範值則與 `rpcId` 一起記錄在這條確切的 `user-rpc` 訊息上。該值不屬於 Session、連線、create、resume 或 fork 狀態；非瀏覽器呼叫方可以省略它。

待處理的 queued 輸入屬於即時控制平面約定，而非對話歷史。閘道根據持久 `agent/inbox/spliced` 變更派生完整的 `next-turn` 佇列，並在每次變更後及重連時廣播權威 `session/queue` 快照；待處理的 `next-step` steering（中途引導）不進入此 Web 投影。在 `next-step` 內，使用者來源的訊息攜帶 `steering` placement，而注入上下文（審批通知、任務完成、附加快照）攜帶 `context`，領取前不對外呈現。面向單則訊息的 `agent/inbox/inserted`、`claimed` 與 `discarded` 通知仍供生命週期觀察方使用，但不用於建置佇列檢視表。`session.updateQueue` 透過 `MessageId` 尋址單個項；編輯和移除經已掛載 Agent 的 `Inbox.splice()` 修改佇列。認領操作的純刪除 splice 會在 pre-step 准入前贏得競態，因此之後的操作返回 `queue-item-not-found`。`session.cancel` 僅中止活動輪次並保留待處理 inbox 工作；取消達到完全靜止且結束中的輪次完成 flush 後，AgentLoop 按 FIFO 順序認領下一條可喚醒訊息，瀏覽器絕不重發或提升它。佇列操作絕不復原冷工作階段，用戶端也絕不根據輪次或狀態事件推斷某項已結束佇列。

背景工作沿用同一種即時推送姿態。當組閤中有 `ctx.jobs` 時，閘道訂閱它的變更訂閱，並在登錄檔每一次改變某個工作階段可見內容的提交後——註冊、轉入 stopping、結帳，以及 owner 銷毀時的移除——廣播一份完整的 `session/jobs` 快照，另外為每個已經有任務的工作階段傳送訂閱 baseline（沒有 baseline 即表示空集；把集合清空的那次變更仍然傳送 `[]`）。帶 owner 的變更透過那個確切的 `Agent` 讀取，因此推送在其 scope 拆除期間依然正確；baseline 讀 `ctx.agents.get(sessionId)`，對沒有活體 Agent 的工作階段只得到無主任務，且絕不復原冷工作階段。無主變更向每一個已訂閱工作階段扇出，因為無主任務對所有呼叫方可見。線路上的 `JobView` 丟棄 `ownerSession`、`reported` 和 `outputLimitBytes`：第一個由幀自身的 `sessionId` 攜帶，另外兩個分別是內部通知位和模型呈現策略。沒有該登錄檔的組合不寄出這類幀。

Workspace 清單與 Session 清單是相互獨立的重連基線。`workspace.create({ path })` 會接納已有的規範目錄，並允許由 basename 派生的標題重複。`workspace.insertBefore({ workspaceId, beforeWorkspaceId? })` 提交一次登錄檔順序移動並應答完整順序；單純重排序會透過 `host/workspace-order-changed` 推送同一份完整順序，而未知來源或錨點返回 `workspace-not-found`。`workspace.delete` 只移除 Workspace 註冊記錄，`session.create` 接受選填的預分配 Session id，`host/workspace-changed`、`host/workspace-removed` 與 `host/session-added` 則以任意到達順序攜帶已提交的增量。`workspace.archiveSession` 向登錄檔級全域性封存集合新增一個工作階段，並應答完整的更新後集合；`workspace.list` 攜帶該集合作為重連基線，`host/archived-sessions-changed` 在每次持久變更後推送完整快照。封存只把工作階段從各分組檢視表中隱藏，不觸碰其日誌和 workspace 記帳；既非活動工作階段也未持久化的工作階段以 `session-not-found` 失敗。刪除註冊記錄會保留目錄和工作階段日誌；相關 Session 仍留在 `session.list` 中，並進入 Ungrouped。`SessionSummary.blank` 與 `host/session-added` 幀攜帶是否已開始過輪次：用戶端隱藏空白工作階段並按 workspace 複用它們，在首個 `host/session-status(running:true)` 時翻轉 blank，並以 `session.list` 作為重連權威。已附加摘要摺疊即時日誌。冷摘要信任快取的 `blank: false`，但把快取的 `true` 與 cache miss 都視為未經驗證；當 `locate()` 報告的工件不大於 `coldBlankProbeMaxBytes` 資格閾值（預設 1 KiB）時，閘道透過 `readFrom()` 讀取該 Session，同時摺疊空白狀態與最新真人 prompt。更大、無位置、已消失或不可讀的工件保持可見。非同步冷讀取結束後，期間已附加的 Session 會改用即時日誌生成摘要。`updatedAt` 依次採用即時摺疊、小工件精確摺疊或 projection cache，缺失時回退到 `createdAt`；拾起邊界及其他寫入都不會提升 Session 排序。

`session.search` 是以 `session.list` 所列工作階段為範圍的有界內容搜尋投影。閘道向選填的 `ctx.sessionQuery` 服務請求全域性排序後的當前內容檢視表中的 user、assistant 和 steering 匹配項，並持續消費該結果流，直到獲得至多 20 個可見工作階段／snippet 對及一個前瞻項；返回前仍會依據從清單推導的授權集合重新校驗每個命中。提供方分頁初始請求 20 個命中；如果第一頁請求因這一上限被拒絕，閘道會依次探測 10、5、2、1，並在續傳和過時世代重新啟動中沿用探測所得的頁面大小。返回的 snippet 最多包含 240 個 Unicode 碼點，回應 schema 則會在每個用戶端邊界獨立強制執行該上限。將授權集合保留在宿主記憶體中，可在不削弱可見性或排序的前提下避開有效大型語料庫的 SQLite 變數上限。

過時的續傳會丟棄該提供方嘗試中的所有部分結果、去重條目和遊標，然後依據最初從清單推導的可見性快照從第一頁重新開始，但不會丟棄探測所得的提供方頁面大小。上限探測與過時重試共用最多 100 次提供方呼叫的限制（因此最多檢查 2,000 個命中）；如果某頁命中數超過其請求的上限、續傳遊標重複，或用盡該呼叫預算後結果流仍未耗盡，都會直接返回 `internal` 業務錯誤，不返回部分結果。載體請求訊號可取消持久化清單枚舉、冷工作階段摘要收集和每一次搜尋呼叫；即使同時收到上限拒絕或過時拒絕，也以取消為準。部署若未掛載該服務，或索引／查詢故障無法復原，也會返回 `internal` 業務錯誤，以便用戶端保留僅基於中繼資料的匹配項。

目錄選擇委託給組合的 `ctx.directoryPicker` 後端（[目錄選擇 seam](../directory-picker/README.md)）；呼叫組合能力 kind 之外的方法會以 `directory-picker-unavailable` 失敗（用戶端不需要廣播——組合的選擇器包自己的 client half 算繪匹配的互動）。在 `native` 下，`host.pickDirectory` 打開一個原生選擇器並返回選中路徑（取消為 `null`）；該方法需等待使用者完成操作，不使用預設的 30 秒一元呼叫逾時，而呼叫方與連線的中止仍會傳播至原生行程。在 `browse` 下，`host.listDirectory` 返回一個按名稱排序的目錄層級，攜帶麵包屑導覽祖先鏈、`home` 錨點與宿主判定的 `hidden` 標志（不帶路徑即家目錄），`host.createDirectory` 建立一個經校驗的子段；後端的類型化失敗 1:1 對映為 `directory-unreadable`／`directory-exists`／`directory-create-failed` 錯誤碼。瀏覽器載體的前綴級信任柵欄（dsh-client-connection）像覆蓋其他所有 `/api` 請求一樣覆蓋上述全部方法。

`host.openPath` 會用作業系統的預設應用打開一個檔案系統路徑（macOS 為 `open`，Windows 為 `Invoke-Item`，桌面 Linux 為 `xdg-open`）。對於 `.html`、`.htm`、`.xhtml` 與 `.svg`，macOS 和桌面 Linux 會優先使用能夠確定的預設瀏覽器；無法確定時回退到上述應用交接。WSL 會透過 `wslpath -w` 轉換每個 Linux 路徑，並將所得 Windows/UNC 路徑交給 Windows `Invoke-Item`，瀏覽器可算繪的文件也不例外，而非假定存在 Linux 桌面文件關聯。`host.describe.canOpenPath` 會宣告這次交接能否抵達使用者可見的桌面：閘道顯式設定的 `nativeOpen` 優先，注入的 opener 按定義可用，否則平臺偵測接受 macOS、Windows、WSL 或帶 display 的 Linux，並拒絕 headless／容器 Linux。瀏覽器載體對其施加與 `host.pickDirectory` 相同的回環、同源限制；用戶端會組合這兩個事實後再呈現原生操作。

`agentPreset.list` 領域向瀏覽器暴露部署的 preset 名單，使其在開啟工作階段時能夠提供選擇；每一行攜帶它的 `trust`（`user` preset 的權限恰好等於它所引用的外掛程式）、它是否為當前預設值，以及——當該 preset 無法組裝工作階段時——一條 `broken` 原因：損壞的目錄仍佔著它的 id，介面必須能展示並刪除它，而不是把它端出來然後在工作階段啟動時失敗。未組裝任何 preset 的部署返回空名單而非錯誤，因為共用宿主組裝本身就是一種有效部署。`agentPreset.select` 用另一個 preset 重組某個工作階段的 agent，且僅在工作階段空白時允許：一旦跑過任何輪次，那段歷史就是在該 preset 的工具下產生的，替換會留下無法執行的已記錄的工具呼叫，此時返回 `agent-preset-locked`。agent 與工作階段都不銷毀——只替換組裝，且替換失敗會復原原來的組裝。

`agentPreset.read`、`copy`、`openDocument` 與 `remove` 負責管理組裝本身。`read` 返迴文本連同它的 `trust`，供只讀查看器使用。創作只有複製一種寫入：`copy` 接收 `{ from, agentPreset, name? }`——兩個由 Host 對照自身根目錄解析的 id 加一個選填顯示名——並整目錄複製來源，因此組裝文字不經過傳輸層，副本與其來源同等可載入；不可約束或已被佔用的 id 回答 `agent-preset-invalid`，`remove` 對隨附 preset 回答 `agent-preset-read-only`。`openDocument` 把一個本機創作 preset 的**目錄**交給平臺打開器——請求只攜帶 id、絕不攜帶路徑，因此沒有任何瀏覽器載荷能選中任意檔案系統目標；部署沒有原生打開器時回答 `{ opened: false, path }` 供介面以文字展示，隨附 preset 與 `remove` 一樣被拒絕，而閘道的 `nativeOpen` 設定可在平臺探測（`canOpenNativePath`）失真處釘死該能力。這四個方法在 [`dsh-client-connection`](../../client/connection/README.md) 中被固定在環回地址：組裝指明瞭一個工作階段所執行的外掛程式，因此讀取它是偵察，而 copy/remove/openDocument 管理名單並驅動宿主桌面。`list` 與 `select` 保持為普通方法——名單只攜帶 id 與信任等級，每個 preset 選擇器都需要它；而選擇一個 preset 並不比 `session.create` 自帶的 `agentPreset` 多給任何能力，何況預設 preset 本就帶著 bash。`list` 報告兩個不含路徑的能力標志：`authorable`，即部署是否設定了可供複製新 preset 的根目錄；`hasDocument`，即 `openDocument` 會原生打開、還是回答一個路徑。

`command.*` 與 `skill.*` 領域向用戶端暴露宿主命令登錄檔和 skill（技能）目錄。每個方法都透過 `sessionId` 尋址一個工作階段的 Agent（被服務的工作階段必有 Agent；`command.*` 經由與 `session.*` 相同的路徑復原冷工作階段，而 `skill.list` 從工作階段頭解析項目根目錄，不觸碰 Agent 登錄檔）。`skill.list` 服務於 composer 的選單：它返回每一個使用者可呼叫的 skill 及其 `modelInvocable` 標志，讓選單能夠標出僅限使用者（`disable-model-invocation`）的條目——斜槓手勢是這類條目唯一的呼叫路徑。清單是 skill 領域唯一的 RPC——呼叫本身就是一次普通的 `session.prompt`，`dsh-tool-skill` 會在 pre-step 邊界識別其中以空白為界的 `/name` token，並以注入的 `<skill_content>` 上下文作答，因此所有入口（Web、TUI 與 ACP（Agent Client Protocol））共享同一條確定性路徑，手動鍵入的文字也走該路徑，且沒有專設的呼叫協定。`command.execute` 在宿主側執行一條斜槓命令列，語義為純准入：回應報告該行是否解析到處理器，並在解析到時回帶鑄造的生命週期 `commandId`（將本次確認與流節點關聯）；結局經由持久落帳並在 mux 流廣播的 `command/run`/`command/done` 生命週期事件對承載。命令處理器執行超過 30 秒的傳輸健康時限仍屬正常，因此 `command.execute` 僅攜帶呼叫方／連線取消訊號；該訊號可取消正在執行的處理器。`commands/change` 搭乘轉發事件幀作為登錄檔級目錄失效訊號：用戶端重新拉取 `command.list` 而不是做差分。轉發的 `agent-preset/selected` 是它按工作階段粒度的對應物，由落帳的選擇提交點發出：重組空工作階段的 agent 只是重新掛接其 scope，不產生任何註冊，因此該工作階段組成所決定的兩份目錄（`command.list`、`skill.list`）都會失效，卻沒有任何登錄檔變化來宣告它。

`settings.*`、`credentials.*` 與 `llm.*` 領域是設定頁協定。settings 領域服務於已註冊可設定提供方所指向的 namespace（`ctx.llm.listConfigurableProviders()`），並額外服務於一份小型、顯式的 allowlist——Web 偏好 `locale`、`permission`、`ui-conversation` 與 `ui-theme`、外掛程式設定頁所編輯的宿主平面外掛程式分節 `agent-loop`、`bash` 與 `web-search-deepseek`，以及產品持有的 `ui-onboarding`；僅新增一項 Settings 註冊，絕不會使其可被遠端讀取或寫入。其他任何 namespace 都只會得到 `settings-not-exposed`——未註冊的 namespace 得到的是同一個答覆，因此沒有呼叫方能靠逐個探測把登錄檔枚舉出來。`settings.describe` 為每個已暴露 namespace 提供其序列化 schemastery schema、脫敏後的分層值（resolved/`base`/`user`——欄位出現在 `user` 中即標記其被使用者覆蓋）、`secrets` 槽位清單、該分節的 `revision`，以及布林型 `hasDocument` 能力標志。瀏覽器不會收到 Host 路徑：無路徑參數的 `settings.openDocument` 會請求提供方準備文件，再把由 Host 解析出的結果交給原生打開器，因此任何瀏覽器載荷都無法選擇任意檔案系統目標。`settings.update`/`settings.replace` 寫入使用者層；`settings.mutate` 則在已存分節上施加路徑 op（`set`/`unset`），這是持有脫敏檢視表的用戶端的刪除路徑——據此重建分節再整體替換，會刪掉協定從未回傳過的那些機密。任何寫入都可攜帶 `expectedRevision`；過時的期望值會以 `settings-conflict` 連同兩個 revision 作答，而不是覆蓋先落地的那個寫方，其餘每種 seam 拒絕則摺疊為 `settings-rejected`。secret 角色的值絕不在任何一層搭乘任何回應；secret 只沿一個方向跨越協定——在 `update`/`mutate` 載荷或 `credentials.set` 之內。`credentials.describe` 返回不含值的檢視表（`configured`/`source`/`writable`），`credentials.set`/`credentials.unset` 則把被遮蔽引用的拒絕對映為 `credential-rejected`。`llm.providers` 把可設定提供方目錄與存活路由合併（休眠條目攜帶 `active: false`；未聲明的存活路由追加在後，不帶 settings 地址），`llm.models` 則是與工作階段無關的目錄。`llm.discoverModels` 詢問頁面尚在起草的提供方端點：`settingsNs` 選出懂得讀取該清單的配接器家族，端點、協定與金鑰則來自表單而非儲存。它什麼都不寫——回覆是候選，只有隨後的 `settings.mutate` 才決定路由服務什麼——因此其 `apiKey` 是 secret 可以搭乘的第三個載荷（另兩個是 `settings.update`/`mutate` 與 `credentials.set`），且絕不被儲存或回顯。host 從不儲存或回傳它；與另兩者一樣，它確實會搭乘用戶端的出站信封，`subscribeEnvelopes()` 的觀察者能看到——為該 tap 做脫敏是整個設定面的改動，而非本方法一家的事。每一種拒絕（無人服務的 namespace、沒有可讀清單的協定、不可達端點、被拒憑據）都摺疊為 `model-discovery-failed`，其訊息是配接器自己的文字，details 點名被詢問的端點，絕不點名所提供的憑據。失效通知讓每個面無需輪詢即保持收斂。`settings/document-updated` 與 `credentials/updated` 搭乘原樣轉發事件幀（見下），因此解析值未變的原始設定變更同樣能到達用戶端，憑據失效通知也仍然只帶引用名、絕不帶值。`llm/adapters-updated` 與 `settings/document-updated` 一並原樣轉發；具體模型消費端直接訂閱這兩個 owner 事件，因為拓撲提交和設定文件都能獨立改變其目錄。瀏覽器載體把整個設定面（含讀取與原生操作：`settings.describe`/`openDocument`/`update`/`replace`/`mutate` 與 `credentials.describe`/`set`/`unset`）限制為僅接受來自回環地址的同源請求——即 `host.pickDirectory` 所在的特權集合。未裝 settings 或憑據提供方的組合會以指名缺失外掛程式、包含解決建議的 `internal` 錯誤應答這些領域。

## 載體層（`/client` + 根路徑）

`AbstractApiClient` 持有全部協定不變數：簽發 rpcId、包裝／解包信封、Zod 解析、SSE 幀解碼、一元請求逾時，以及按微任務批次處理的信封觀測（`subscribeEnvelopes`）；平臺子類只提供 `doFetch` 傳輸環節。`InProcessApiClient` 以 `toFetchHandler(api)` 為基礎，仍是同構接點：它執行完整的協定序列化與校驗路徑而不經過網路，供需要該路徑的呼叫方和載體測試使用。產品的 `dsh --profile headless` 是直連 core 的入口，不掛載本包。

## 模型體驗

無。該包定義用戶端與宿主間的 wire 約定和載體，其中沒有任何內容會進入模型請求。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **轉發的 Remote 事件寄居在這套 legacy 幀聯合裡**：`host/remote-event` 住在 `HostFrame` 中，是為了讓投遞路徑複用現有宿主流、不必新開第三條下行通道，因此讀起來像是本包擁有 Remote 事件契約。並非如此：名單歸 `dsh-api-remotes`，消費端動詞是 `ctx.remote.$on`。將來宿主流整體搬離本包時，該幀隨之搬走，消費端契約不受影響（[原委](../../../.agents/notes/implemented/architecture/2026-08-10-remote-event-delivery.md)）。
- **待處理互動狀態位於宿主側**：wire 使用 POST `/api/respond` 加 `RpcReceipt`；`src/api-proxy.ts` 中的表只處理問題，不包含審批條目。
- **預留 seam 不進入 `RpcMethodMap`**：`prompt.mode: 'inject'`、`job.list` 和描述欄位 `hostInstanceId` 都是已記錄的預留項；模型發現使用 `llm.models`。未知方法會在信封解析時直接失敗，而不會返回「尚未實作」錯誤碼。
- **沒有協定版本欄位**：用戶端與宿主一同發布；只有出現獨立發布的用戶端後，`host.describe` 才會增加版本協商欄位。
- **搜尋失敗會包含提供方診斷資訊**：閘道是單使用者本機服務。將其暴露給多名使用者的載體必須用可安全公開的診斷資訊替代內部搜尋細節。
- **Linux 原生選擇器相依性桌面工具**：在 `native` 能力下，Zenity 和 KDialog 均未安裝時，`host.pickDirectory` 會給出包含解決建議的錯誤提示；組合層面的回退是 browse 後端（見 [native 後端 README](../directory-picker-native/README.md)）。
- **冷清單提示只向“保持可見、排序偏舊”降級**：projection cache miss 或過時的 `lastPromptAt` 會回退到 `createdAt`，除非符合資格的小工件提供精確摺疊，因此最近工作過的大 Session 可能在下一個 checkpoint 前排得偏低。大於 `coldBlankProbeMaxBytes` 的空白工件，或來自不提供 `locate()` 的後端的空白工件會保持可見。該閾值在 `readFrom()` 前檢查，而非由 persistence 強制，因此工件並行成長可能增加一次探測的讀取成本，但不會改變空白狀態的安全方向。[有界空白驗證決策](../../../.agents/notes/implemented/bug-fix/2026-08-13-bounded-cold-blank-verification.md)規定了這個安全方向；權威且精確的最近時間索引仍屬於[最後活動索引提案](../../../.agents/notes/proposed/architecture/2026-07-29-durable-last-activity-index.md)的範圍。
