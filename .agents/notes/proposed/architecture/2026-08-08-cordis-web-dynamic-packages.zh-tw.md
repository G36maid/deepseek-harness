# Agent Note: Cordis Host/Client 動態外掛程式執行體系

Status: proposed

[English](2026-08-08-cordis-web-dynamic-packages.md) | [简体中文](2026-08-08-cordis-web-dynamic-packages.zh.md) | 繁體中文

## Problem

模型需要在不修改倉庫原始碼、不重新建置應用、不刷新瀏覽器的前提下，臨時擴充當前 DSH 行程。擴充既可能執行在 Host 的 Node.js 行程，也可能執行在 Client 瀏覽器頁面，還可能由 Host 取數、Client 展示，共同組成一個外掛程式。

這項能力不能只是“執行一段程式碼”。模型需要在寫程式碼前發現兩端允許使用的 Service、Event、Builtin、Slot 和主題 token；使用者需要先預覽程式碼，再決定是否允許 Client 程式碼進入頁面；同一個外掛程式需要追加不可變版本、失敗後重試或回退；執行後的非同步錯誤需要回到模型，而不是隻留在伺服器端日誌或瀏覽器主控臺。

如果把定義、審批、執行、版本切換、能力發現和 UI 狀態塞進一個動作，會產生無法穩定解釋的狀態：定義成功是否等於執行成功，升級失敗後哪個版本仍是成功版本，頁面沒有回應時 Tool 應等待多久，同一個 Package 多次執行時期哪張歷史卡片承載業務 UI，以及 Client 頁面區域性裝載狀態是否能代表 Host 的行程級狀態。

## Proposal

### 核心原則

- Host 保存 Plugin、Package、Run、審批和版本指針的唯一行程級權威狀態。
- Client 只保存當前頁面的審批互動、裝載結果、Slot 貢獻、業務檢視表和頁面區域性錯誤。
- Define 只建立不可變程式碼版本；Run 只啟用一個已定義版本。
- 版本切換只有在目標 Package 完成要求的 Host/Client 啟用後才提交 `currentPackageId`。
- 模型寫程式碼前透過 Inspect Provider 查詢能力；Inspect 結果只輔助編碼，不作為外掛程式執行時期業務資料。
- Host 與 Client 動態程式碼都使用受限的 plain JavaScript 上下文，並把可撤銷副作用掛到 Cordis 生命週期。
- Client 程式碼進入頁面前需要使用者授權；授權範圍可以是單個 Package，也可以是同一 Plugin 的後續版本。
- Tool 呼叫不等待當前輪結束後纔可能發生的審批或瀏覽器操作；非同步結局透過狀態儲存和模型 steering 回饋。

### 包職責與相依性方向

動態執行體系由 `packages/self-modification/` 下四個包組成：

| 包 | npm 包名 | 職責 |
| --- | --- | --- |
| `tool-cordis` | `@deepseek-ai/dsh-tool-cordis` | 註冊 System Prompt、七個模型 Tool、Host Inspect Provider、`@pluginId` 上下文注入和 Tool 展示元資料 |
| `cordis-host-runner` | `@deepseek-ai/dsh-cordis-host-runner` | 保存權威 Registry，分配 ID，執行 Host 程式碼，管理版本、審批、Run、私有 handler、Inspect 路由和模型回饋 |
| `cordis-client-runner` | `@deepseek-ai/dsh-cordis-client-runner` | 在瀏覽器同步 Inspect manifest，編排審批後的 Host→Client 啟用，求值 Client 程式碼，管理 Guard、Loader/Fiber、timer、樣式和 teardown |
| `ui-cordis` | `@deepseek-ai/dsh-client-ui-cordis` | 展示 Define/Run Tool 卡片、全域性 Cordis 面板、審批控制元件、版本選擇、執行狀態和 Package 自訂業務檢視表 |

`tool-cordis` 只相依性 Host Runner 的行程內服務，不匯入 Client 實作。`ui-cordis` 只消費 Client Runner face 和 Client-safe wire 類型，不匯入 Host 實作。Host 與 Client 的執行控制透過已有生成 Remote 面和轉發事件連線，閘道不擁有動態 Plugin 的領域邏輯。

### 領域對象

#### Plugin

Plugin 是可持續修改的動態外掛程式實例，由品牌類型 `CordisDynamicPluginId` 標識，例如 `clock-1`。新建 Plugin 時，模型只提交 3 至 6 位小寫英文語義前綴；Host 新增行程內唯一數字後綴。完整 `pluginId` 不能由模型指定。

Plugin 屬於定義它的 Session。模型 Tool 只能讀取和操作當前 Session 的 Plugin；全域性 Client 面板可以列出所有 Session 的 Plugin，但每個動作仍使用該行攜帶的 owner Session 執行。

#### Package

Package 是 Plugin 下的不可變程式碼版本，由 `CordisDynamicPackageId` 標識，例如 `pkg-2`。它包含名稱、用途、選填 Host 程式碼和選填 Client 程式碼，且至少包含一側。每次 `cordis_define` 都建立新 Package；已有 Package 不允許原地修改。

同一個 Plugin 可以擁有多個 Package，但同一時刻最多隻有一個物理 Run。Package 是否含 Host 或 Client 半隻決定啟用步驟，不改變版本身份。

#### Plugin Run

Plugin Run 是一次具體啟用嘗試，由 `CordisDynamicPluginRunId` 標識，例如 `run-3`。每次新的啟用嘗試都會分配新 ID，包括審批後失敗、重試同一 Package 和版本更新。`pluginRunId` 把審批、Host 啟用、Client 裝載、私有 RPC、Tool 卡片和錯誤關聯到同一次嘗試。

Host 分開保存當前物理 Run 與 `latestRun`。物理 Run 表示此刻仍可呼叫和撤銷的啟用；`latestRun` 表示最近一次嘗試的審批、階段、兩側狀態和診斷。一次失敗可以沒有存活的物理 Run，但仍留下可查詢的 attempt。

#### 版本指針

- `currentPackageId` 是最近一次完成要求的啟用流程的 Package。停止外掛程式、開始更新或更新失敗都不清除它。
- `nextPackageId` 是正在等待審批、正在啟用、等待 Client、或最近失敗的目標 Package。目標成功提交為 current 後清除。

Host-only Package 在 Host 成功建立 Fiber 後提交 current。包含 Client 的 Package 在 Host 啟用成功且至少一個 Client 成功建立對應裝載後提交 current。因硬相依性缺失而被 Cordis park 為 waiting 的 Fiber仍是成功建立的生命週期對象，不等同於解析或 `apply` 失敗。

更新目標失敗時不自動重新啟動舊物理 Run。舊 `currentPackageId` 繼續表示最後成功版本，失敗目標保留為 `nextPackageId`。使用者或模型可以重試 next，也可以以 `mode: "run"` 重新啟用 current 完成回退。

### Host 權威狀態與持久性

`DynamicCordisRunnerService` 及其內部 Registry 是當前 DSH 行程內的唯一權威，保存：

- Plugin 的 Session 歸屬和不可變 Package 集合；
- `currentPackageId`、`nextPackageId`、物理 Run 和 `latestRun`；
- 單 Package 授權與 Plugin 跨版本授權；
- 待處理的 Client 啟用請求；
- Host Fiber、Package 私有 handler、等待中的 Service 和最近診斷；
- Host 與 Client Inspect Registry 的目錄和查詢路由。

這些對象不寫入設定或磁碟，也不在行程重新啟動後復原。Session Log 可以保留 Tool 呼叫、結果和卡片所需元資料，但不會重放動態程式碼來復原 Registry。行程重新啟動後歷史卡片仍可作為對話記錄存在，原 `pluginId` 和 `packageId` 不再可執行。

執行態不作為可復原狀態寫入 Session projection。頁面刷新或新頁面打開不會自動復原 Client 半；自動復原會重新引入連線身份、啟動期 baseline 和跨頁面一致性協議，不屬於當前設計。

### Define、Run 與版本切換

`cordis_define` 有兩種模式：新建 Plugin 時提交 `idPrefix`；修改現有 Plugin 時提交精確 `pluginId`。程式碼統一為 `code: { host?, client? }`。Define 只校驗參數和 plain JavaScript 文法，記錄不可變原始碼並返回最終 ID。它不執行 `apply`、不產生審批、不改變版本指針，也不隱式執行。

不提供獨立 `cordis_update`。`cordis_run` 透過 `mode` 表達啟用意圖：

| 版本關係 | `mode` |
| --- | --- |
| 尚無 `currentPackageId` | `run` |
| 目標等於 current，包括重新啟動、重試或回退 | `run` |
| 目標與已有 current 不同 | `update` |
| 更新失敗後重試 `nextPackageId` | `update` |

Run 先驗證 Plugin/Package 歸屬、版本關係和是否已有轉換在進行，再建立 `pluginRunId`、寫入 `latestRun` 和 `nextPackageId`。

Host-only Package 在 Tool 呼叫內完成 Host 啟用，並同步返回 `running` 或失敗。包含 Client 的 Package不在 Tool 呼叫內等待瀏覽器終局：未授權時登記審批並返回 `awaiting-approval`；已授權時登記自動 Client 啟用並返回 `starting`。這兩種返回都表示請求已建立，不表示完整啟用成功。

目標真正開始啟用時，Host 先停止舊物理 Run，再執行目標 Host 半。Host 成功後才允許 Client 取得精確 `pluginRunId` 對應的原始碼並裝載。Client 成功後 Host 提交版本指針；任何階段失敗都記錄到該 attempt，不把舊版本重新啟動偽裝成目標成功。

`cordis_stop` 撤銷當前 Host/Client Run 及待審批請求，但保留 Plugin、Package、授權和版本指針。`cordis_undefine` 先停止，再刪除 Plugin、Package、授權和版本指針；刪除後歷史卡片只顯示“外掛程式已移除”。

### Client 審批與授權

包含 Client 程式碼的 Package 在第一次啟用前需要使用者授權，因為它將在使用者頁面中執行模型生成的程式碼。審批面板提供三個動作：

- 單勾允許當前 Package；同一 Package 後續重跑不再審批，新 Package 仍需審批。
- 雙勾允許當前 Plugin 的後續版本；新 Package、更新、重試和回退不再逐版本審批。
- 拒絕結束當前請求，不執行 Host 或 Client 程式碼；模型不得在使用者沒有新要求時立即重複申請。

授權在使用者允許時寫入 Host Registry，即使隨後發生技術失敗也保留。面板直接執行 Package 時，使用者點擊本身授權該 Package。

待審批行只顯示單次允許、跨版本允許和拒絕，不同時提供執行、停止或刪除。發現新審批時面板自動展開；自動展開失敗或被收起時，固定入口和行狀態仍顯示待審批數量與狀態。

### Client 啟用編排

Host 透過 `cordis/request-run` 傳送 Client 啟用請求。請求只包含請求身份、Session、Plugin、Package、mode、名稱、用途和是否需要審批，不廣播原始碼。

獲得授權的頁面按固定順序執行：

1. 呼叫 `runHostHalf`，啟動目標 Host 半或綁定同一次 attempt 已啟動的 Host Run。
2. Host 成功後，以 `pluginId + pluginRunId` 呼叫 `getClientCode`，只取得當前精確 Run 的 Client 原始碼。
3. Client Runner 在頁面求值外掛程式，建立 Loader entry/Fiber，安裝 Guard、樣式、Slot 和頁面區域性狀態。
4. 頁面呼叫 `resolveRequestRun` 或 `settleUserRun` 回報成功、waiting 或失敗。
5. Host 接受仍有效的精確 Run 回報，提交 current 或保存診斷，並廣播請求結束，其他頁面清理活動。

Host 啟用先於 Client，避免 Client 在所需 Host handler 尚未存在時啟動。只有本次請求實際建立的 Host Run 才能因本頁 Client 失敗而撤銷；只是綁定既有 Run 的頁面沒有其所有權。

Client Orchestrator 按 `pluginId` 保存待審批和正在編排的活動，同一個 Plugin 不並行執行兩次頁面啟用。Host inventory 可重建遺漏的待審批項和無需審批的自動啟用請求。

Client 裝載狀態是頁面區域性事實。Host active 不代表當前頁面已裝載 Client 半。UI 使用三種主要狀態：無物理 Run為灰色“待啟用”，Host 已執行但當前頁面 Client 未成功裝載為黃色“Client 待啟用”，當前頁面兩側可用為綠色“執行中”。審批中和失敗作為額外狀態顯示。

當前版本不建立 per-connection 身份或多頁面法定人數。第一個仍有效的 Client 成功回報可以提交行程級 current；其他頁面是否裝載由各自頁面 store 表示。

### Package 私有 Client→Host 通訊

動態 Package 透過私有 JSON 通道從 Client 呼叫 Host：Host 使用 `harness.handle(method, handler)` 註冊當前 Run 的方法，Client 使用 `host.call(method, args)` 呼叫。每次呼叫關聯 `pluginId + pluginRunId`，Host 拒絕已停止或過期 Run。參數和回傳值必須是無損 JSON，不允許函式、React 元素、Context、Service 實例或類對象。

該通道只服務同一 Package 的 Client→Host 呼叫，不使用公開 Remote Service 或動態程式碼中的 `ctx.remote`。公開 Remote 面只承載 Runner 自己的控制協議，不向動態 Package 暴露。

### 動態程式碼、Guard 與生命週期

Host 和 Client 都只執行 plain JavaScript 函式體，不經過 TypeScript、JSX 或 bundler 轉譯。Host 執行在 `node:vm`，Client 在受限閉包中求值。兩端上下文用於減少誤用並提供教學錯誤，不是惡意程式碼安全邊界。

模型默認透過 `ctx.get('serviceName')` 讀取選填 Service 並判斷 `undefined`。只有 Service 是硬相依性、缺失時 Package 必須 waiting 並在 Service 出現後重新啟用時，纔在外掛程式對象聲明 `inject`。直接訪問 `ctx.serviceName` 只在同一外掛程式聲明對應 inject 時允許。

Host 與 Client 的 `timer` 都是同名 Cordis Service，使用一致介面，不是全域性 Builtin。需要 timer 的外掛程式必須聲明 `inject: ['timer']`；React effect 中建立的 timer 把 disposer 作為 cleanup 返回。

所有註冊和可撤銷副作用由當前 Fiber 擁有。Event listener、Service、Tool、handler、timer、Slot、樣式和主題覆蓋透過 `ctx.effect()`、`ctx.on()` 或返回 disposer 的官方 API 註冊。停止、更新、失敗回滾或 undefine 時撤銷兩端貢獻。Theme override 必須按 source 分層並返回 disposer，使解除安裝後復原此前主題值。

宿主、DSH、Cordis 及其 Service、Event payload、Slot props、Session/Conversation Snapshot、Tool 狀態和其他執行時期對象是內部 live data。動態程式碼不得對這些對象或其子對象執行 `JSON.stringify`、`structuredClone`、遞迴枚舉、全量複製或整體展示；只能讀取當前任務所需葉子欄位，構造不含宿主引用的最小自有資料。

### Inspect Provider 與 Catalog

能力發現分為三個 Tool：`cordis_inspect_list` 列 Host/Client Provider manifest；`cordis_inspect_query` 執行指定平臺的顯式只讀查詢；`cordis_inspect_self` 查詢當前 Session 的 Plugin、Package、原始碼、版本指針和執行診斷。

Host 和 Client 各自擁有 `CordisInspectRegistry`。Provider 註冊平臺內唯一 ID、說明、method、輸入 schema 和輸出 schema。Provider method 是顯式白名單查詢，不是任意 Service 方法透傳；Registry 不維護分層 target，也不自動把業務 Service 方法變成可執行 Inspect method。

首批 Provider 為：

| Platform | Provider.method | 資料來源 |
| --- | --- | --- |
| Host / Client | `Service.listService` | 各平臺 Service 靜態 Catalog |
| Host / Client | `Event.listEvents` | 各平臺 Event 靜態 Catalog |
| Host / Client | `Builtin.listBuiltins` | evaluator/Guard 附近的手工定義 |
| Host | `Tool.listTools` | 當前 Agent 真正可見的 Tool Registry |
| Client | `Slots.listSubTree` | Slot 靜態 Catalog與頁面 live subtree/occupants |
| Client | `Theme.listTokens` | ThemeService 的只讀 inspect export |

Client Registry 變化後向 Host 同步完整 manifest，不按 Session 保存重複目錄。Host query 本機執行；Client query 由 Host 廣播 request ID，頁面呼叫本機 Provider 後回送。Host 只接受第一個透過輸出 schema 校驗的成功結果；失敗頁面不搶佔請求。沒有頁面成功回答時 Tool 保持 pending，直到後續成功或 Tool call 取消。

Inspect 資料只用於寫程式碼前確認能力、簽名、類型和掛載協議。外掛程式執行時期需要業務資料時必須呼叫實際 Service 或監聽實際 Event，不能快取、展示或相依性 Inspect/Catalog 回傳值。

`CordisCatalogProjector` 使用 TypeRT 分別生成 Host/Client Service 與 Event Catalog；Slot AST 生成器掃描 `SlotMap`、註冊選項、standard props、owner props 和引用類型；Slots Provider 查詢時合併靜態 Catalog 與 live tree。Theme token 由 ThemeService 匯出，Builtin 在 evaluator/Guard 附近手工維護，Tool schema 來自 Registry。

Catalog 掃描真實原始碼簽名，再應用 model-visible 白名單。白名單可以隱藏 Service、成員、`@deprecated` API、Runner 自身服務和 `cordis/*` 控制 Event，但不能改寫剩餘 API 的方法名、參數和返回類型。Guard 可以拒絕參數、固定來源或封鎖成員，但必須尊重原始碼簽名。

模型可見 owner JSDoc 只要求完整 description、每個參數的 `@param`、非 void 返回的 `@returns`、Event 的 `@mode`，以及 Slot/props 欄位說明。呼叫推薦、反例和跨能力選擇放入 Skill，不在 Catalog 增加重複 example 欄位。

### 模型指導分層

模型指導分為四層：

- System Prompt 保存穩定執行模型、兩端限制、生命週期、審批、版本指針、最低程式碼規範和七個 Tool 的使用地圖。Skill 不可用時它仍須支持最低限度正確實作。
- `cordis-plugin-development` Skill 保存需求導覽、能力組合、推薦和反例，不複製完整 schema。
- 每個 Tool description 只說明該動作的前置條件、參數語義、同步/非同步結果和下一步。
- Provider/Catalog 返回當前精確名稱、簽名、參數、Slot props、token 和執行時期查詢結果。

System Prompt 要求先載入 Skill，再 list/query，之後 define/run。Skill 中 React 示例必須註冊到 Slot，不能從 `apply()` 直接返回 React Element；示例使用 `React.createElement`、正確 `ctx.get()`/`inject`、可逆 effect 和最小 JSON RPC。

### `@pluginId` 與 Tool UI

輸入系統為當前 Session 註冊 `@pluginId` mention。選擇後只注入 Plugin 身份、默認基準 Package、版本指針、活動 Run 和最近狀態，不注入原始碼。默認基準依次選擇 next、current、最近定義的 Package。模型必須先用 `cordis_inspect_self` 讀取原始碼，再以 existing 模式追加 Package；引用失效時不能靜默建立替代 Plugin。

`cordis_define` 卡片以 Host/Client 兩個子頁簽展示程式碼。`cordis_run` 卡片由 `pluginRunId` 關聯精確 attempt，並讀取 Client store 顯示待審批、Client 待啟用、執行中、失敗、已被後續 Run 替代或 Plugin 已移除。

Package 可以向 `tool.view.cordis` 註冊 `key: "self"`。執行時期把 self 綁定為 `pluginId + packageId`；業務 Slot key 不含 `pluginRunId`，但 owner props 仍提供精確 Run 身份。同一 Package 最新 Run 卡片承載業務 UI，更早卡片顯示已有更新執行。卡片透過 store 回應變化，不掃描後續 Session Log，也不互相通知。

全域性 Cordis 面板使用一個固定入口，按當前工作階段和其他工作階段分組。面板標題和收起操作固定，只有清單滾動。普通行選填擇 Package並執行、停止或刪除；失敗更新可重試 next 或選擇 current 回退；待審批行只提供兩個允許動作和拒絕。

### 錯誤與模型回饋

跨 Host/Client 的技術錯誤保留原始 `message`，並在錯誤對象提供時保留 `stack`。結構化診斷包含 `pluginId`、`packageId`、`pluginRunId` 和階段：approval、host-load、host-apply、client-load、client-apply 或 client-render。

Host/Client Guard、Host 求值與 handler、Client 求值與 apply、Slot `onEntryError` 和 React ErrorBoundary 都把錯誤回到 owning Agent。Client 控制台同時以 `console.error` 列印原始 error 對象。渲染錯誤屬於精確 Run，不汙染不可變 Package。

模型發起的非同步 Run 在成功、拒絕或技術失敗後使用 `agent.steer` 喚醒 owning Agent。技術失敗要求讀取診斷、在同一 Plugin 修正並自主重試；使用者拒絕則禁止自動重複申請。使用者在面板手動執行、停止或移除透過 context injection 告知下一 step，但不主動喚醒模型。

## Alternatives considered

**Define 與 Run 合併。** 這會失去“已定義但未執行”的可預覽狀態，把文法錯誤、審批、執行錯誤和重試混成一個動作，因此拆為不可變 Define 和獨立 Run。

**Package ID 同時作為 Plugin ID。** 單層 ID 無法表達穩定實例下追加不可變版本，更新只能 stop、undefine、重新 define，歷史卡片和 `@` 引用也無法保持同一對象，因此採用 Plugin、Package、Run 三層身份。

**提供獨立 `cordis_update`。** Update 的裝載、審批、UI、診斷和 Run 相同，獨立 Tool 只複製協議，因此合併到 `cordis_run mode:"update"`。

**更新失敗後自動復原舊物理 Run。** 自動復原會把“目標失敗”和“舊版本重新成功”混成一個結果。當前設計保留舊 current 指針但不自動重新啟動，讓使用者明確選擇重試 next 或 run current。

**讓 `cordis_run` 阻塞到使用者審批和 Client 終局。** 審批或頁面操作可能只能在當前模型輪結束後發生，阻塞會形成死結，並在無頁面時無限佔用 Tool。當前設計立即返回，透過 store、Inspect 和 steering 報告終局。

**Host 廣播原始碼並用逾時等待 Client ack。** 廣播會在授權前把程式碼發給所有頁面；逾時無法區分沒有頁面、頁面慢和使用者未操作；Host 還要維護補償式回滾。當前協議只廣播元資料，由獲準頁面按精確 Run 拉取原始碼。

**頁面啟動時自動復原所有 Host active Package。** 這要求連線身份、啟動期 baseline 和跨頁面一致性。當前設計接受頁面區域性 Client 狀態，使用者可在面板重新裝載。

**透過公開 Remote Service 或 `ctx.remote` 連線 Package 兩半。** 這會把動態 Package 暴露到產品級 RPC 面。Package 私有 `harness.handle`/`host.call` 足以承載 Client→Host JSON 呼叫，並能按 `pluginRunId` 拒絕過時請求。

**把所有 Service 方法自動暴露成 Inspect query。** 這會把能力發現變成業務呼叫代理，繞過外掛程式審批和生命週期。Provider 只暴露策展的只讀查詢，Service Catalog 只描述業務方法簽名。

**把完整 API 寫進 System Prompt 或 Skill。** 固化文字會漂移並佔用上下文。System Prompt 保留穩定規則，Skill 負責需求導覽，精確簽名和執行時期目錄由 Provider/Catalog 返回。

**要求 Slot owner 在執行時期註冊 props schema。** Slot props 已存在於 TypeScript 類型和 JSDoc 中，重複註冊會製造第二份權威。當前設計用 Slot AST Catalog 提取靜態協議，只在查詢時合併 live tree。

**把執行態寫入 Session Log 並在 replay 復原。** 動態程式碼和 Fiber 是行程區域性對象，復原要求重新執行歷史程式碼並重新解釋審批。Session 只保留模型可見記錄，Registry 和頁面 Run 不復原。

**讓歷史 Run 卡片掃描後續 Session Log。** 這會讓 Tool view 相依性全量日誌順序和後續訊息結構。頁面 card index/store 已能按 Package 告知舊卡片被替代或 Plugin 被刪除。

## Acceptance criteria

- 新 Plugin 只能由 3 至 6 位小寫英文前綴建立，最終 Plugin、Package 和 Run ID 由 Host 分配並使用品牌類型。
- `cordis_define` 只做參數和 plain JavaScript 文法檢查，返回不可變 Package；同一 Plugin 可以追加版本，舊原始碼保持可 inspect。
- `cordis_run` 嚴格校驗 run/update；Host-only 同步完成，Client-bearing 返回 `awaiting-approval` 或 `starting`，不等待頁面終局。
- 單勾只授權當前 Package，雙勾授權同一 Plugin 後續版本；授權在技術失敗後仍保留，拒絕不執行兩側程式碼。
- Host 先啟用，Client 後取精確 Run 原始碼；Client 成功前不提交 Client-bearing Package 的 current，失敗後 current/next 可用於重試和回退。
- 一個 Plugin 同時最多一個物理 Run；stop 撤銷兩端貢獻但保留定義和指針，undefine 刪除全部 Package、授權和狀態。
- 當前頁面能區分“待啟用”“Client 待啟用”和“執行中”，待審批時只顯示審批動作。
- `tool.view.cordis` 的 self 綁定 Plugin + Package；同 Package 最新 Run 卡片獨佔業務 UI，舊卡片和已刪除 Plugin 有明確退化狀態。
- Host/Client Guard 拒絕 import、JSX、未聲明 Service 和不可用全域性；Service、timer、Slot、樣式、Tool、handler 和主題覆蓋隨 Run teardown。
- Package 私有 RPC 只允許 Client→Host 無損 JSON，並拒絕過時 `pluginRunId`。
- Inspect list 一次返回 Host/Client manifest；query 只調用顯式只讀方法，Client 查詢等待首個 schema-valid 成功結果或取消。
- Service/Event Catalog 分 Host/Client 生成並應用白名單，`@deprecated` API、Runner 自身服務和 `cordis/*` 控制 Event 不向模型暴露；Slot query 合併靜態 props 與 live subtree。
- `cordis_inspect_self` 分層返回清單、Package 摘要和精確原始碼/診斷；`@pluginId` 不直接注入原始碼且更新留在同一 Plugin。
- 非同步技術失敗、Host handler、Client Guard 和 React 渲染錯誤保留 message/stack 並 steering owning Agent；使用者面板操作只注入下一 step context。
- System Prompt、Skill、Tool description 和 Provider/Catalog 按本 Note 分層，Skill 不可用時 Prompt 仍足以生成最低限度正確的外掛程式。
- 相關工作區 `pnpm run build` 透過；實作階段補齊 Host/Client lifecycle、版本、審批、Inspect、Guard、Tool 卡片與真實應用快照覆蓋。

## Risks

- **行程重新啟動丟失全部動態對象。** 歷史 Tool 卡片仍在，但 Registry 不復原；使用者必須重新 define。
- **多頁面狀態不是強一致系統。** 第一個有效 Client 成功結果可以提交 current，各頁面的 Client 裝載和渲染狀態仍可能不同；當前不引入連線身份、法定人數或頁面聚合。
- **Client Inspect 可能長期 pending。** Host 保存最近 manifest，但沒有頁面成功執行 Provider 時不能用舊資料偽裝 live 結果；多個頁面都失敗時請求等待到取消。
- **跨版本授權擴大信任範圍。** 雙勾允許同一 Plugin 後續 Package 無需再次審批；UI 必須清楚區分單次和跨版本授權。
- **失敗更新可能留下 current 指向舊版本但舊版本未執行。** current 表示最後成功版本，不表示當前物理 Run；UI、Inspect 和提示必須同時展示 active、current 和 next。
- **受限上下文不是安全沙盒。** Host Service、文件、命令、網路和 Client UI 都是真實能力；白名單與審批降低誤用，不隔離惡意程式碼。
- **Catalog、Guard 和原始碼可能漂移。** 生成器、白名單和 owner JSDoc 必須共同維護；Guard 的隱藏策略不能產生另一套簽名。
- **Builtin 相依性手工聲明。** React、harness、host、styles 和 Context 方法沒有統一可掃描入口，注入實作與 Provider 定義必須放在同一維護位置。
- **Provider 輸出 schema 當前允許較寬的 JSON。** 首版優先完成 Provider 所有權、輸入校驗和 Host/Client 路由；更窄的輸出 schema 後續再收緊。
- **Host 與 Client Guard 存在平行實作。** 兩側開放環境和 Cordis 類型面不同，當前保留各自實作；公共規格只有在能減少程式碼且不隱藏安全策略時再提取。
