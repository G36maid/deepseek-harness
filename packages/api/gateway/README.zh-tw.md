# @deepseek-ai/dsh-api-gateway

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

為 Host 與 Client 兩側的 Cordis 環境提供 Typert RPC endpoint。Host 入口提供 `ctx.typertGateway`，`@deepseek-ai/dsh-api-gateway/client` 則提供 `ctx.remote`；兩者使用同一份生成的 `InvocationDescriptor` 約定，並將業務選擇交給 API Remotes，將傳輸、請求關聯、信任和回應封裝交給 Connection。

## Host 服務：`TypertGatewayService`（ctx key：`typertGateway`）

每次呼叫時，`ctx.typertGateway.invoke()` 都會解析當前的描述符和 Cordis 服務，校驗具名參數是否完全匹配，解析已註冊的對象或 Context 身份標識，呼叫公開的業務方法，並校驗其結果。業務服務繼承 [`dsh-typert-protocol`](../../typert/protocol/README.md) 的 `TypertRemoteService`，並用 `@Remote` 或 `@RemoteScope` 標記方法；已有其他基類時仍可改用 `bindTypertRemote()`。

嚴格模式從 `ctx.typert.local` 讀取生成的呼叫描述符。尋找參數使用 `ctx.typert.lookups` 中當前有效的 resolver：業務包註冊穩定聲明與預設策略，Host 組合可用 effect-scoped `configure()` 覆蓋解析行為；`@RemoteScope` 則透過已註冊的 Host Context 提供方解析其接收者。SRC 模式是開發階段的回退路徑，適用於從未具備嚴格定義的端點；它解析簡單參數名，並且只允許非尋找參數使用可安全表示為 JSON 的值。已觀測到的嚴格定義一旦撤回，系統會直接報錯，而不會降低校驗強度。

Connection 可用時，Host 入口會在 Connection 共享的 `/api` FetchHandler 上註冊 trusted-host interceptor。Connection 把這個複合 handler 交給 HTTP bridge；handler 將已認領 endpoint 分發給 Gateway，未認領 endpoint 則交給 API Proxy。直接呼叫 `invoke()` 會保留業務錯誤；`TypertGatewayError` 可區分分發、綁定、提供方、尋找、Context、參數和編解碼器各自負責的故障。resolver 可以用 `TypertLookupFailure` 攜帶既有 RPC error，使冷復原失敗或 ownership fence 等策略拒絕保持原錯誤碼。

支援取消的 Remote 方法會把 `signal: AbortSignal` 聲明為最後一個 Host 參數。signal 是 descriptor 中繼資料，而不是 wire 參數：Connection 將它提供給 Gateway，Gateway 則在已解碼的業務參數之後注入它。SRC 識別這個保留的末位參數名，嚴格生成還要求它具有全域性 `AbortSignal` 類型。

## Client 服務：`ClientRemote`（ctx key：`remote`）

`ctx.remote.$mount()` 會校驗並註冊生成的 Host-for-Client 貢獻項，然後為發起呼叫的 Cordis fiber 安裝具體的直接方法和作用域方法。每個 namespace 都是可追蹤的 `remote.<namespace>` 子 Service，並在最後一個方法撤回後解除安裝。重複端點、命名空間衝突，以及缺少生成的嚴格編解碼器的描述符，都會在方法可呼叫前報錯。

每次呼叫都會校驗位置參數，構造與描述符完全匹配的具名 `args`，再透過 `ctx.connection.rpc.call('/api', endpoint, ...)` 傳送。生成的支援取消的方法接受最後一個選填 `AbortSignal`；Client 會在呼叫 Connection 前將它與貢獻項的掛載生命週期合併。回傳值經過校驗後才會交給應用程式碼。撤回貢獻項會同時移除其描述符和方法、中止正在進行的呼叫，並使外部仍持有的方法控制代碼在呼叫時返回拒絕。

`ctx.remote.$on()` 訂閱一條被轉發的 Host 事件。它的合法鍵恰好等於 Host 裝配聲明的轉發選擇，listener 類型就是事件所屬包自己的 Cordis `Events` 聲明，因此不存在會與之漂移的第二份簽名。每個訂閱歸屬發起呼叫的 fiber，並隨該 fiber 一起消失。投遞是單向的，並按註冊順序進行；拋錯的 listener 會被記錄並與其餘 listener 隔離，絕不影響幀泵。`ctx.remote.$dispatch()` 是該面的另一半，且屬於載體：持有 Host 幀 sink 的 Client 半把每個解碼後的幀交進來，收到無人訂閱的事件名即丟棄，因為 wire 上出現什麼取決於 Host 的轉發選擇。消費端只訂閱，絕不呼叫它。

生成的聲明合併透過共享的 `TypertClientRemote` 約定提供 TypeScript API。Client 入口不包含 Host 服務或 Host Cordis 介面合併；方法尋找和呼叫使用普通對象與函式，而不使用 JavaScript Proxy。

## 模型體驗

無，因為該包分發應用呼叫，不註冊任何提示詞、工具或工作階段事件。

#### KV Cache 影響

無直接影響；被呼叫的業務服務負責產生任何模型可見結果。

## 已知限制與延期工作

- Connection 配接器將普通分發故障和業務例外對映為 RPC 的 `internal` 程式碼，且不附帶詳細資訊；`TypertLookupFailure` 攜帶的 lookup 策略錯誤會原樣返回。結構化的 `TypertGatewayError` 類別僅供同行程呼叫方使用。
- SRC 模式僅支援名稱唯一的識別符號參數，不支援解構、預設值或剩餘參數。它只校驗值能否安全表示為 JSON，不校驗生成的業務類型，也絕不會推斷選填欄位。
- Client 側只能掛載嚴格模式生成的貢獻項。SRC 標記不具備 Client 編解碼器或類型投影。
- 該包只分發一元方法。增量工作階段資料透過同一個 Connection 上獨立的具名流協定傳輸。
- lookup resolver 按 key 設定；當前無法讓單個 Remote 參數或 endpoint 在同一 `agent`/`session` key 下選擇 live-only 策略。
- 被轉發的事件原樣到達 `$on`：沒有載荷投影或脫敏，不支援 Scope 化訂閱，重連後也不重放。
