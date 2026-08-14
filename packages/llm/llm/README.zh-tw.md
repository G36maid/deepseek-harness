# dsh-llm

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

提供方無關的 LLM（大型語言模型）詞彙與抽象服務。本包定義 agent loop（代理循環）、工作階段日誌和所有外掛程式共同使用的規範詞彙。

## 服務：`LlmRuntime`（ctx key：`llm`）

一個配接器登錄檔加單一流式呼叫介面，可透過 waterfall（瀑布式事件）攔截。

### 公開 API

- `ctx.llm.registerAdapter(providers: string[], adapter: LlmAdapter): AdapterRegistrationHandle` 為給定提供方路由註冊一個配接器實例。註冊要麼全部成功，要麼全部不生效，並且會隨呼叫 fiber 一起 dispose（資源釋放）。返回的控制代碼還提供 `replace(providers)`：候選路由集合會在註冊狀態發生任何變化前完成整體驗證，因此與另一配接器發生衝突時，當前路由仍保持註冊並繼續提供服務。替換會在一次同步操作中完成，不會出現可觀察的空檔。`replace([])` 合法，表示保留註冊但不持有任何路由；初始註冊則不得為空。
- `ctx.llm.listProviders(): LlmProviderInfo[]` 按註冊順序描述已註冊提供方路由。
- `ctx.llm.registerConfigurableProviders(entries: readonly LlmConfigurableProvider[]): DirectoryRegistrationHandle` 聲明配接器外掛程式可透過設定啟用的提供方路由——無論已註冊還是休眠——每個條目指明其所屬 settings namespace，以及 profile 在該分節內的路徑。要麼全部成功，要麼全部不生效（`INVALID_DIRECTORY`/`DUPLICATE_DIRECTORY`），並隨呼叫 fiber dispose。該控制代碼還帶 `replace(entries)`：候選集合會先被整體校驗，因此其中若有條目已被另一個註冊聲明，當前集合原封不動；此處允許傳空陣列。聲明集合隨設定變化的外掛程式必須使用 `replace`，而不是先 dispose 再重新註冊——後者會在新集合被拒時讓目錄整個落空。
- `ctx.llm.listConfigurableProviders(): LlmConfigurableProvider[]` 按聲明順序列出可設定提供方目錄；設定介面將其與 `listProviders()` 合併，為每個條目標注存活或休眠。條目可攜帶 `declared`，表示擁有該路由的配接器是否只因設定點名才知道它。只有配接器能回答這一點：該欄位缺失時，只表示該配接器不區分這兩種來源，不能據此判斷路由是否隨產品交付。
- `ctx.llm.registerModelDiscovery(settingsNs: string, discover): () => void` 為本外掛程式擁有的 settings namespace 提供查詢提供方端點的能力。每個 namespace 只能有一個（`INVALID_DISCOVERY`/`DUPLICATE_DISCOVERY`），並隨呼叫 fiber dispose。
- `ctx.llm.listModelDiscoveryNamespaces(): string[]` 列出可以詢問端點的 namespace，讓介面只在可用之處提供該動作。
- `ctx.llm.discoverModels(settingsNs: string, request: LlmModelDiscoveryRequest): Promise<LlmDiscoveredModel[]>` 詢問某個端點它公佈了哪些模型。
- `ctx.llm.providerRetryPolicy(provider: string): ResolvedRetryPolicy` 返回註冊時捕獲的提供方自身的重試策略，並解析 normal 預設值。
- `ctx.llm.listModels(provider: string): Promise<LlmModelInfo[]>` 發現某個已註冊提供方當前公佈的模型。
- `ctx.llm.resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>` 從擁有該精確路由的配接器中，解析並校驗確切模型身份，以及可用上下文、輸出預設值和推理（reasoning）中繼資料；非同步配接器選填地支援取消。
- `ctx.llm.resolveCallConfig(config: LlmCallConfig, signal?: AbortSignal): Promise<LlmCallConfig>` 校驗顯式推理強度，並填入配接器設定的呼叫預設值，但不自動調整。
- `ctx.llm.prepareCall(config: LlmCallConfig, signal?: AbortSignal): Promise<PreparedLlmCall>` 在一次精確模型查詢中解析設定、脫耦的上下文中繼資料以及標明哪些欄位由配接器預設值填入的標記，再將當前配接器註冊和不可變重試策略捕獲為一次可取消、一次性呼叫。
- `ctx.llm.stream(options: GenerateOptions): AsyncIterable<StreamChunk>` 將一次模型呼叫流式輸出為原始區塊（token 級增量）。消費端使用 `BlockAssembler` 將區塊組裝為塊／訊息。

`LlmRuntime` 將最終配接器選擇、同步分發、迭代器構造和迭代期間的失敗，統一轉換為流協定唯一的終止形式：`finish { kind: 'error' | 'aborted', failure }`。部分增量輸出後發生失敗時，內容區塊可能仍未閉合；消費端會丟棄這些不完整輸出。`llm/stream` middleware、巢狀呼叫、配接器清理和下游消費端的錯誤仍會拋出，因為它們屬於外掛程式或消費端失敗，而非模型請求結果。已準備呼叫會暴露隨其確切配接器註冊一同捕獲的不可變重試策略；完全由 middleware 處理的路由沒有服務策略。

詢問端點屬於設定期針對**草稿**的操作，以 settings namespace 而非提供方路由為鍵——介面正在新增的提供方還不存在，也就沒有路由可點名。但請求仍可**點名**它正在編輯的路由，而已經描述該路由的配接器會用自己的知識作答，無需聯網；路由名稱和 `baseURL` 至少需要提供一項。除此之外，請求攜帶端點、協定，以及一條 harness 只用於這一次詢問、絕不儲存的憑據。這裡既不讀取也不寫入 settings 或 credentials；返回內容是介面可以提供給使用者採納的候選中繼資料，而不是已註冊的 catalog。`LlmDiscoveredModel` 除 `id` 外每個欄位都是選填的，因為大多數提供方清單只公佈 id；採納其中一條的介面仍要補上其配接器所需的容量。重複與不可用的 id 會被丟棄，無人服務的 namespace 以 `NO_DISCOVERY` 失敗，既不點名路由也不給端點的請求以 `INVALID_DISCOVERY` 失敗。

提供方和模型中繼資料用於發現，不構成路由白名單。`registerAdapter()` 仍擁有提供方路由的排他性，並為每條路由捕獲配接器的重試策略；配接器可以接受未出現在 `listModels()` 中的模型 id，消費端不得僅因模型未列出而拒絕請求。返回的 selector 中繼資料已分離；無效或重複的配接器條目會以 `INVALID_ADAPTER` 或 `INVALID_CATALOG` 失敗。

每個拓撲提交點——配接器路由註冊或 dispose、目錄條目出現或撤回——都會在變更之後寄出無載荷的 `llm/adapters-updated` 事件，消費端因此會重新讀取 `listProviders()`/`listModels()`/`listConfigurableProviders()`，而不是輪詢。觀察者故障會被記錄並隔離，不能否決變更；只有帶 `INVARIANT` 碼的故障會在通知完所有觀察者後重新拋出。

確切模型中繼資料是獨立的正確性查詢，不是 catalog 裝飾或全域性 LLM 設定。`resolveModelInfo()` 會向擁有精確提供方／模型路由的配接器查詢一次；配接器可以描述未列出的動態模型。缺少 `context` 表示模型容量未知；缺少 `defaultMaxTokens` 表示繼續沿用提供方自身的輸出預設值；缺少 `reasoning` 則表示推理能力不可用。無效的身份、上下文、輸出預設值或推理中繼資料會以 `INVALID_MODEL_INFO`、`INVALID_MODEL_CONTEXT`、`INVALID_MODEL_MAX_TOKENS` 或 `INVALID_MODEL_REASONING` 失敗。

`defaultMaxTokens` 是配接器設定的單次請求輸出上限，不是模型硬上限。僅當請求省略 `maxTokens` 時，`resolveCallConfig()` 才會填入該值；顯式上限優先。推理識別符號是由配接器定義的不透明字串，而非核心枚舉：同一次解析只接受與已公佈識別符號完全一致的值，在存在 `defaultEffort` 時填入它，否則保留提供方預設值。非同步模型解析器會接收呼叫方訊號，並且必須在取消後儘快結帳。`prepareCall()` 還會返回同一次查詢得到的、與配接器內部狀態分離的上下文中繼資料，透過 `adapterDefaults` 標明填入了哪些 `maxTokens` 和 `reasoningEffort` 欄位，並在請求標頭記錄和最終分發期間始終保留同一項精確的配接器註冊。因此，HMR（熱模組替換）不會把一個配接器的能力結果與另一個配接器的請求混用；複用其一次性控制代碼或更改呼叫設定欄位會以 `INVALID_PREPARED_CALL` 失敗。不支援的顯式或設定推理強度會在提供方 I/O 前以 `UNSUPPORTED_REASONING_EFFORT` 失敗。

### 事件

| 事件 | 模式 | 用途 |
|---|---|---|
| `llm/stream` | waterfall | 攔截／包裝每次流式模型呼叫，用於快取、日誌或路由 |

### 擴充點

- 繼承 `LlmAdapter` 並呼叫 `ctx.llm.registerAdapter(providers, adapter)`，新增一條或多條提供方路由。`GenerateOptions.provider` 選擇配接器；`GenerateOptions.model` 屬於配接器，可以動態解析。覆蓋 `providerRetryPolicy()` 以提供由提供方定義的復原設定，覆蓋 `providerInfo()` 和非同步 `listModels()` 以公開 selector 中繼資料；精確身份、容量、輸出預設值或選填推理強度可用時，實作 `resolveModel()`；非同步解析器必須回應其選填的取消 signal。預設實作使用有界的 normal 重試策略，將路由和模型 id 用作名稱，不公佈模型，也不返回容量、輸出預設值或推理中繼資料。
- 包裝 `llm/stream` 時，透過 `ctx.on()` waterfall listener 實作快取、日誌或路由。包裝層如果在已經寄出區塊後重試，就沒有可持久記錄的嘗試邊界；因此，隨產品交付的 agent 重試策略改用 `agent/request-error`。

### 訊息（`message.ts`）與內容區塊（`types.ts`）

`Message` 是投遞、持久歷史和模型請求共享的不可變值。每則訊息從建立起都必須具有 `MessageId`、角色、內容和帶類型的來源。`createMessage(input)` 生成標識，並返回與輸入分離且深度凍結的值；`createUserMessage({ content, source })` 固定 user 角色；`createAssistantMessage({ content, source })` 固定 assistant 角色與模型來源類別；`createToolResultMessage({ callId, content, isError })` 固定 user 角色，並將工具來源與其結果塊耦合；`freezeMessage(message)` 匯入已有標識，絕不將其替換。改寫訊息時會保留標識，並產生另一個凍結值。瀏覽器端程式碼會從相依性最少的 `@deepseek-ai/dsh-llm/message` 入口匯入這些值構造函式，而不是從包含服務的包根入口匯入。

訊息內容是類型化內容區塊陣列：`text`、`reasoning`、`tool-call`、`tool-result`。聯合從可合併擴充的 `ContentBlockMap` 派生，因此外掛程式可以透過 declaration merging 新增塊類型。assistant 訊息使用模型來源，其中攜帶生成該訊息的提供方和模型，以及選填的配接器私有重播狀態。dispatch 前，`LlmRuntime` 只在歷史提供方路由與目標提供方路由當前由完全相同的配接器實例擁有時才保留該狀態；隨後由配接器判定能否在模型／提供方間復原或轉換該狀態。核心塊集只包含每條已發布路徑都支援的塊。多模態內容（影像、音訊等）沒有核心塊類型；需要它的功能會透過 map 新增，並一並新增相應的配接器／UI／壓縮（compaction）支援。

流式輸出是原始區塊協定（`block-start`、`text-delta`、`reasoning-delta`、`tool-call-delta`、`block-end`、`usage`、`finish`）。每個配接器結果都以一個終止 `finish` 到達消費端；執行故障使用 `error` 或 `aborted` 作為結束原因，而不會跨流 API 拋出。`BlockAssembler` 是將區塊組裝為塊／訊息的唯一共享實作。

### 呼叫設定（`call-config.ts`）

`LlmCallConfig` 記錄一個工作階段的模型請求所使用的提供方、模型、由配接器定義的選填推理強度，以及取樣參數（`provider`、`model`、`reasoningEffort`、`temperature`、`maxTokens`、`stop`，分別與同名 `GenerateOptions` 欄位一一對應）。它是作為請求標頭一部分記錄在工作階段日誌中的每工作階段狀態（見 dsh-session `request/header` 事件），絕不是可靜默調整的每次呼叫旋鈕：`agent/request` waterfall 會提議替換，`prepareCall()` 在輪次 signal 控制下校驗它並填入配接器預設值，loop 隨後記錄生效值以及標明哪些欄位由配接器預設值填入的標記，再使用已準備呼叫中與註冊綁定的流。下一次提議會省略帶標記的預設值，使變更後的路由解析自身的值；未帶標記的顯式欄位會保留。`callConfigEquals(a, b)` 是逐欄位真實變更偵測器；`deepFreeze(value)` 是 loop 使用的請求所有權輔助函式：每個構造完成的請求都會在分發前深度凍結；`llm/stream` 監聽器和配接器只能讀取，絕不能改寫。`markAgentLoopRequest()` 將該精確對象標記為由行程本機 agent loop 建立，`isAgentLoopRequest()` 讓觀測方可以將其與同樣可能凍結並關聯工作階段、但獨立記錄的輔助呼叫區分。`GenerateOptions.purpose` 會對已記錄的輔助壓縮和工作階段標題呼叫進行分類，使配接器可以按呼叫目的應用不同的傳輸策略，而不改變普通工作階段請求。

### 應用歸因（`attribution.ts`）

每個產品配接器都會在提供方 HTTP 請求上傳送應用身份。`attributionHeaders(identity?)` 建置標準 `User-Agent`，預設為公開 `APP_IDENTITY`；白標部署可以替換它，但不能抑制它。配接器會直接驗證 wire 標頭，或透過自身庫 hook 驗證。詳見 [歸因 Agent Note](../../../.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md)。

### API 金鑰校驗（`api-key.ts`）

每個要把憑據放進 HTTP 標頭的配接器，使用前都以同一套規則校驗它。`normalizeApiKey(raw)` 會先去除首尾空白，然後接受任意非空的可列印 ASCII 值（`/^[\x21-\x7E]+$/`，不含空格），或透過 `ApiKeyRejection`（`'empty'` | `'illegalCharacters'`）說明拒絕原因。這些結果一並包含在 `ApiKeyCheck` 中。缺失從不參與校驗：呼叫方會在詢問之前自行判斷是否提供了值——未點名憑據的 profile 會轉由提供方自身的環境發現或 OAuth 完成驗證。

### 類

- `LlmAdapter`：提供方配接器的抽象基類。唯一必需方法是 `stream()`。
- `BlockAssembler`：將原始區塊逐步組裝為完整內容區塊，並能據此建立帶標識且凍結的 assistant 訊息。agent loop 向它提供原始區塊（同時記錄以供重播），並讀取已組裝塊以建置歷史。
- `HarnessError`：harness 錯誤分類體系的基類，包含穩定 `code` 字串（與面向人的 `message` 不同）以及 `cause` 鏈。它位於所有其他包都從中匯入的葉子包中，因此可以共享單一基類，無需新的相依性邊。各包的錯誤（`LlmError`、`ToolArgsError`、`InvariantError` 等）都繼承自它。`isHarnessError(value)` 在行程邊界處收窄類型。
- `LlmError`：繼承自 `HarnessError`；其穩定 `code` 字串（`NO_ADAPTER`、`DUPLICATE_ADAPTER` 與 `AUTH`／`RATE_LIMIT` 等配接器 code）與凍結可序列化 `failure.code` 匹配。Payload 還可以保留已驗證狀態、`Retry-After` 和品牌化提供方請求 id 事實；策略位於錯誤之外。
- `errorChain(value)`：算繪拋出值的完整 `cause` 鏈與 AggregateError 成員，供診斷輸出使用，包括 UI 通知、logger 行和持久 `turn/end` 訊息。因此 undici 的 `TypeError: fetch failed` 等傳輸包裝層會顯示底層 `ECONNREFUSED`／DNS／TLS 詳細資訊，而不是將其遮蔽。該函式只負責生成診斷文字。呼叫方必須依據穩定的 `code` 選擇錯誤處理路徑，絕不能透過解析算繪後的文字作出判斷。
- `CONTEXT_WINDOW_EXCEEDED_CODE`：當請求超過模型上下文視窗時，無論透過 HTTP 例外拋出還是帶內 finish 交付，兩個 DeepSeek 配接器都使用的提供方無關 code。`isContextWindowExceededError(detail)` 是它們針對 OpenAI 相容提供方詳細資訊的共享保守分類器。
- `QUOTA_EXCEEDED_CODE`：帳戶配額、餘額、點數、預算或用量限制耗盡時使用的非暫時性提供方無關 code。`isQuotaExceededError(detail)` 使這些失敗與請求速率限制保持區分。
- `EMPTY_RESPONSE_CODE`：兩個配接器都使用的提供方無關 code，用於表示退化的提供方生成結果：一個未攜帶任何內容區塊的終止 `stop`。它會被分類為錯誤 finish（而非成功空訊息），因為嘗試未產生持久內容；`dsh-llm-retry` 預設重試它。
- `INVALID_CREDENTIAL_CODE`：已提供但無法使用的憑據所用的提供方無關 code——格式錯誤而非缺失，修復方式是改正已儲存的值，而不是補充一個憑據，這正是它與 `MISSING_CREDENTIAL` 的區別。它被刻意排除在預設可重試集合之外：格式錯誤的憑據每次嘗試都會以同樣方式失敗。`assertUsableApiKey(raw, pkg, ref)` 會以該 code 拋出 `LlmError`，是每個配接器判定已儲存憑據不可用時共用的診斷。

### 真實配接器

兩個配接器使用不同內部機制實作 `LlmAdapter`：[`@deepseek-ai/dsh-llm-deepseek`](../llm-deepseek) 針對 `deepseek-official` 路由使用直接 fetch 加 `eventsource-parser` SSE（Server-Sent Events）分幀，[`@deepseek-ai/dsh-llm-pi-ai`](../llm-pi-ai) 則透過 `@earendil-works/pi-ai` 動態解析已設定提供方／模型對。兩者都遵循 `types.ts` 中的 `StreamChunk` 約定：usage 先於 finish，工具參數保持原始字串。配接器實作在內部可以拋出例外或寄出失敗 finish；`LlmRuntime` 會將兩者都暴露為終止失敗 finish。配接器理由見[雙 LLM 配接器](../../../.agents/notes/implemented/architecture/2026-06-13-twin-llm-adapters.md)，服務邊界見[終止失敗決策](../../../.agents/notes/implemented/architecture/2026-07-29-terminal-llm-stream-failures.md)。

## 模型體驗

無。服務不新增任何與模型綁定的文字、schema 或訊息；它只會填入並記錄配接器設定的推理強度。

#### KV Cache 影響

透傳；登錄檔保留已組裝請求前綴，cache 複用與路由邊界屬於所選配接器和提供方。

## 已知限制與暫緩事項

- **本服務不執行重試、快取或速率限制**：提供方註冊會儲存重試策略，但 `llm/stream` 仍是單次嘗試呼叫包裝層。agent loop 會將已驗證模型請求失敗單獨提供給 `agent/request-error`，其預設行為是保留原始失敗；`@deepseek-ai/dsh-llm-retry` 是共享示例主幹載入的選填執行器。
- **`GenerateOptions` 取樣只包含 `temperature`／`maxTokens`／`stop`**：沒有 `tool_choice`、`top_p` 或 penalty 欄位；有產生方落地時詞彙才會成長（見 [已刪除惰性旋鈕](../../../.agents/notes/archived/simplification/2026-07-04-drop-inert-request-knobs.md)）。
- **只有出現實際產生方後，相應變體才會加入**：`prefill`、逐工具 `strict`、內容區塊 `cache` 提示和 `agent` 訊息來源變體，都因當前沒有產生方而被移除（見 [Agent Note](../../../.agents/notes/archived/simplification/2026-07-04-prune-producerless-vocabulary-variants.md)）。
- **`BlockAssembler` 只處理核心塊類型**：如果外掛程式新增塊類型的流從未由 `block-end` 關閉，`blocks()` 會拋出例外。
- **`APP_IDENTITY.url` 指向一個尚不存在的倉庫**：該公開主頁必須在發布前可訪問。
- **`GenerateOptions.sessionId` 是本機聲明的品牌類型**：匯入 dsh-session 的 `SessionId` 會產生迴圈；未來擁有 id 的包可以消除該權宜之計。
