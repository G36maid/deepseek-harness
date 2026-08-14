# @deepseek-ai/dsh-llm-pi-ai

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

基於 [`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai) 的 harness LLM（大型語言模型）seam 通用多提供方配接器。一個外掛程式實例擁有一份以路由為鍵的提供方 profile 字典；每個請求使用 `GenerateOptions.provider` 選擇 profile，並針對該路由已設定的 catalog 解析 `GenerateOptions.model`。點名了已安裝 pi-ai 提供方的路由會繼承其端點、協定格式（wire format）與模型 catalog 作為預設值，並逐欄位覆蓋；pi-ai 未提供的路由則整體聲明出來，因此接入 OpenAI 相容閘道、自建服務，或比已安裝 catalog 更新的提供方，都屬於設定而非改程式碼。

包根入口匯出 Cordis 外掛程式約定、`PiAiAdapter` 與 `supportedProtocols()`；profile 解析、catalog 物化、提供方構造、重播轉換和流轉換保留在包內部。

## 設定

按提供方設定憑據、模型 catalog 與部署特定傳輸設定，並以提供方路由本身為鍵。`apiKeyEnv` 是按請求解析的憑據*引用*，因此機密不進入該文件。省略它會讓該路由處於未認證狀態；對已安裝 catalog 路由而言，這意味著交給 pi-ai 的提供方原生環境發現。已設定卻解析不出任何值的引用則相反，會讓請求以 `MISSING_CREDENTIAL` 失敗，因為放行下去就會用環境裡恰好持有的某個無關金鑰完成認證。一條憑據服務該路由下的全部模型。

```yaml
- id: llm
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      # Catalog route: endpoint, protocol, and models all come from pi-ai.
      openai:
        apiKeyEnv: OPENAI_API_KEY
        baseURL: https://proxy.example.com:8443
        reasoning: high
        retryPolicy:
          mode: normal
          maxRetries: 3
          backoff:
            initialDelayMs: 500
            maxDelayMs: 10000
            jitterRatio: 0.1
      # Catalog route with its catalog narrowed to one model and that model's
      # capacity corrected; every unset field still comes from the catalog.
      anthropic:
        apiKeyEnv: ANTHROPIC_API_KEY
        streamIdleTimeoutMs: 300000
        models:
          - id: claude-sonnet-4-5
            contextWindow: 200000
      # Catalog route with one model reshaped in place; the rest of the
      # catalog keeps serving (a models list would replace it instead).
      deepseek:
        apiKeyEnv: DEEPSEEK_API_KEY
        modelOverrides:
          deepseek-v4-pro:
            reasoningEfforts:
              off:
              high: high
      # Hand-declared route: pi-ai ships nothing under this key, so the profile
      # supplies the whole provider.
      acme-gateway:
        displayName: Acme Gateway
        apiKeyEnv: ACME_GATEWAY_API_KEY
        api: openai-completions
        baseURL: https://gateway.acme.example/v1
        # Reasoning dialect for an endpoint whose URL pi-ai cannot recognize.
        compat:
          thinkingFormat: deepseek
        models:
          - id: acme-large
            name: Acme Large
            contextWindow: 65536
            maxTokens: 4096
          - id: acme-think
            name: Acme Think
            contextWindow: 262144
            maxTokens: 32768
            # key = selectable level, value = its wire spelling; only off may
            # leave the value empty (supported, send nothing).
            reasoningEfforts:
              off:
              high: high
              max: ultra
```

字典形狀使重複路由無法表示，發布前的陣列形狀（每個 profile 攜帶 `provider` 欄位）會載入失敗並給出遷移指引。`providers` 也可以為空或整體省略：配接器將以**休眠**姿態掛載——零路由、模型選擇器不多一條——一旦 `llm-pi-ai:` settings 分節提供了 profile 就即時註冊路由，分節清空時隨之撤銷。無論是否休眠，外掛程式都會在可設定提供方目錄（`ctx.llm.listConfigurableProviders()`，settings 路徑 `providers.<provider>`）中聲明每個已安裝 catalog 提供方，並與當前 profile 聲明的每條路由取並集，因此設定介面既能在任何路由存在之前就提供完整 catalog，也能尋址一條手工聲明的路由。每個條目都帶上 `declared`：pi-ai 在這個鍵下是否什麼都沒有。它跟隨已安裝 catalog 而非設定文件，因為收窄一個內建提供方的模型同樣會存下 profile，而那條路由仍然是 pi-ai 認識的——只有配接器分得清兩者，所以由目錄直接給出答案，而不是留給介面去猜。哪些配接器存在歸組合面；哪些提供方在執行可以完全交給使用者的設定文件。向 `ctx.llm` 註冊具有原子性：如果與另一配接器已擁有的任何提供方路由衝突，外掛程式會載入失敗，不註冊剩餘路由。模型 id 不是生命週期設定；路由未設定的模型會在發起任何提供方請求前以 `LlmError('UNKNOWN_MODEL')` 失敗。

## Catalog 解析

profile 的 `models` 清單是*替換*該路由已安裝 catalog，而不是擴充它；省略它（或留空）則原樣服務該 catalog。每個條目都會從同 `id` 的已安裝模型繼承自身未設定的欄位，因此把 catalog 路由收窄到兩個模型、更正某個容量，或加入一個比已安裝 catalog 更新的模型，都是一行編輯——但一旦聲明瞭 `models` 清單，該路由要繼續服務的每個模型就都必須出現在其中，條目哪怕只寫一個 `id` 也足夠。可設定的條目欄位是 `id`、`name`、`contextWindow`、`maxTokens`、`reasoningEfforts` 與 `compat`。定價與輸入模態沒有 harness 消費端，因此沿用已安裝條目或直接缺席。

`modelOverrides` 無需這份代價就能就地重塑單個已安裝 catalog 模型：每個鍵是一個 catalog 模型 id，每個值可寫 `models` 條目接受的同一批欄位，只是 id 落在鍵上，而 catalog 的其餘部分原樣繼續服務——「改一個模型、其餘三十七個原樣保留」只是一次三行編輯。一條覆蓋會成為該 catalog 條目的設定，因此容量、檔位與 compat 沿與 `models` 條目相同的路徑解析，攜帶相同的診斷與相同的請求預設值語義。覆蓋只在正服務自身 catalog 的 catalog 路由上纔有意義：與 `models` 清單並存的一份（該清單本就替換了 catalog）、落在手工聲明路由上的一份（其模型已在 `models` 中完整寫出），或點名了 catalog 未描述模型的一份，都會被拒絕而非跳過，因為一個靜默保持原樣的模型，就是一個否則要有人費力追查的筆誤。

### 按模型的推理（reasoning）檔位

`reasoningEfforts` 聲明模型選填的思考等級：每個鍵是選擇器提供的一個檔位，其值是分派在協議中傳送的拼寫，因此 `high: high` 原樣透傳規範名稱，而 `max: ultra` 則為使用自有詞彙的閘道改名。鍵取自 pi-ai 的檔位集合（`off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`）；未聲明的檔位不會被提供。省略該欄位會保留已安裝 catalog 條目的能力（手工聲明的模型沒有這份能力，也不推理）；`false` 聲明一個不具備推理能力的模型，profile 正是以此從其閘道無法服務的 catalog 模型上剝除推理；空聲明會被拒絕，而不是在這兩種含義之間去猜。

該聲明會轉換為 pi-ai 的 `Model.reasoning` + `thinkingLevelMap`，其中每個檔位都被顯式決定——未聲明的檔位一律固定為不支持，而不是留給 pi-ai 自己的默認規則：那套規則並不對稱（鍵缺席對五個基礎檔位意味著「支持」，對 `xhigh`/`max` 卻意味著「不支持」），也本不該要求 profile 作者瞭解。`off` 是唯一的三態鍵：不寫它，選擇器不提供 Off，顯式請求 Off 會被拒絕——不點名任何檔位的請求仍會在不帶該參數的情況下發出，提供方隨後做什麼是它自己的默認行為；聲明而不給值（`off:`），則會提供 Off，選中它時什麼也不傳送——對 `deepseek` 方言則是一個顯式的 `thinking: {type: "disabled"}`——這同時覆蓋完全不點名任何檔位的請求；聲明並給值（`off: none`），該值就會作為檔位參數在協議中傳送。沒有任何寫法能把 catalog 對映中的鍵復原為「未設定」：這份聲明就是對外提供的全部，因此把你要保留的 catalog 檔位重述出來。

### 推理分派的 compat 開關

思考等級如何在協議中傳輸——單獨一個 `reasoning_effort`、DeepSeek 的 `thinking: {type}` 加上檔位、z.ai 的 `thinking` 對象，諸如此類——就是 pi-ai 的 `compat.thinkingFormat`，pi-ai 會從端點 URL 猜測它；私有閘道的 URL 什麼也說明不了，於是說 DeepSeek 方言的閘道只會收到 OpenAI 方言的請求，且無從更正。因此 `compat.thinkingFormat` 與 `compat.supportsReasoningEffort` 既可設定在路由上（作為其模型的預設值），也可按模型設定（逐欄位勝出），解析順序為模型 → 路由 → 已安裝 catalog 條目 → pi-ai 按 URL 得出的猜測；設定路由級開關會為路由上的每個模型遮蔽 catalog 條目的值，而且除了重述其值，沒有任何寫法能把某個欄位交還給 catalog。`thinkingFormat` 接受 pi-ai 可分派的各種格式，但不含兩個 `chat-template` 變體：它們需要的 `chatTemplateKwargs` 本設定並不暴露。兩個開關都只存在於 `openai-completions` 上——其餘協議的推理形狀由協議本身承載——因此在其他協議的模型上設定模型級開關會使解析失敗，路由級開關會跳過其他協議的模型，而完全沒有 `openai-completions` 模型的路由則會被拒絕。pi-ai compat 面的其餘部分（`supportsStore`、`maxTokensField`……）保持自動偵測，特意不在此處開放設定。

條目與已安裝 catalog 都沒有給出尺寸的模型，會採用該路由的 `defaultContextWindow`（262,144）與 `defaultMaxTokens`（32,768），因此一份只公佈 id 的清單同樣能產出可服務的路由。兩個回退值本質上都是猜測，這正是它們作為路由欄位、供閘道服務更小模型的部署一次性更正的原因，而不是埋在配接器裡的常數；回退值只用於給模型定尺寸，絕不會變成單次請求上限。

請求模態的解析順序是：條目的 `input` → 已安裝 catalog 條目 → 路由的 `defaultInput`（默認 `[text]`），與上面兩個容量欄位的順序和「回退值」定位完全一致。因此 catalog 模型保留 catalog 為它記錄的模態，更窄的路由預設值也絕不會把它剝掉；而**未被 catalog 描述的**模型全都接受圖片的閘道，只需在路由上寫一次 `[text, image]`，不必逐條目寫。條目的空清單與預設同義——它描述的是一個什麼都不接受的模型，因此不作答，解析繼續往下走——這正是當 `models` 條目點到某個 catalog 模型卻不聲明模態時，該模型仍保留 catalog 自有模態的原因。路由的那個則不得為空，因為它下面已經沒有可以代為作答的層級。

`[text]` 是「尚未聲明」，而不是對端點的猜測——這也是為什麼這裡的回退值取保守值，而兩個容量回退值只是取一個說得過去的值。這裡沒有任何環節會去詢問閘道實際接受什麼，而兩種猜錯的代價並不對等：模態中不含圖片時，Harness 會在圖片被附加之前就拒絕，因此少聲明的代價是一次點名該模型的拒絕；而多聲明會接納一張圖片、再由提供方在輪次中途拒絕——此時訊息已經持久化，工作階段便會不斷重複一個不可能成功的請求。

路由完全無法服務時解析仍會失敗得響亮，並點名出問題的路由與模型：catalog 未提供的路由需要 `api`、`baseURL`，以及一個由唯一標識的模型組成的非空 `models` 清單。該解析在分節 schema 內部執行，因此無法服務的 profile 會在**寫入之處**被拒絕——`settings.mutate` 以 `settings-rejected` 點名路由與模型——而不是先存下來、再悄悄讓該 namespace 下每條路由失效。對於已經存下的、在此失敗的分節，settings seam 會保留該 namespace 上一份可用值，因此這不會把部署卡死。`api` 接受 `supportedProtocols()` 中的協議，且僅在 catalog 無法提供協議時才需要：catalog 中不存在的模型會繼承其同門模型一致同意的協議，因此向單協議 catalog 路由新增模型無需重述任何內容。


`baseURL` 設定該路由下每個模型的端點，因此仍支持 `https://proxy.example.com:8443` 等私有 proxy；省略它的 catalog 路由會保留每個 catalog 模型自己的端點。在 catalog 路由上點名 `api` 會把整條路由改指到該協議，這正是部署把某個提供方在 Responses 與 Chat Completions 之間遷移的方式。

`supportedProtocols()` 刻意窄於 pi-ai 的完整流式 API 集合：它只保留 profile 能用金鑰、端點與標頭**完整描述**的那些協議。Bedrock 要用 AWS 憑據與 region 做 SigV4 簽名，Vertex 需要 project、location 與應用默認憑據，Azure 需要提供方環境外加 api-version，Codex 走 OAuth——提供它們只會交回一個無法完成認證的路由。catalog 路由仍可經自己的 provider 抵達這些協議；被拒絕的只有顯式覆蓋。

## 動態設定（settings + credentials）

配接器經由一個 thunk **每操作讀取一次** profile，而非在構造期凍結。外掛程式在選填的 `ctx.settings` seam 上用同一份 `Config` schema 註冊 `llm-pi-ai` namespace，並以其 `cordis.yml` 條目為組合 `base`；由於 `providers` 是字典，base 與使用者的 `llm-pi-ai:` settings 分節**按提供方**合併：使用者可以新增路由、覆蓋組合路由的單個欄位，或把路由指向另一個 proxy，全部在下一次請求生效，無需重新啟動。未掛載 settings 服務時，僅由 entry 設定驅動程式配接器，行為不變。

憑據在每次流呼叫時透過 `apiKeyEnv` 與選填的 `ctx.credentials` seam 解析；未掛載該 seam 時，配接器只讀取該引用指向的環境變數。只有完全沒有點名任何憑據的 profile——僅限這一種情況——才交給 pi-ai 的環境發現。每個解析出的金鑰都會在使用前去除首尾空白並校驗格式，因此 HTTP 標頭無法承載的值會被拒絕，而不是以語義不明的 `fetch` `TypeError` 形式浮現；這種拒絕會拋出 `LlmError('INVALID_CREDENTIAL')`，點名失敗的路由與憑據引用，但絕不透露金鑰的任何部分。路由集合與每條路由捕獲的重試策略是註冊級事實：兩者任一變化時，外掛程式都會原子地替換自己的註冊（同一配接器實例，候選集合先經校驗），因此某條路由若已被另一配接器佔有，先前的路由會繼續服務，而改回可用設定時註冊會重新生效。提供方鍵的順序絕不算作變化。本配接器無法服務的分節會在寫入處被拒——註冊的 `validate` 會解析整份 profile 集合，因此 `ctx.settings.mutate` 以 resolver 自身的錯誤拒絕（該協議將其報為 `settings-rejected`），什麼都不會儲存。已儲存分節若因其他途徑變得不可服務——比如外部編輯了 `settings.yaml`——則由 settings seam 保留該 namespace 最後可用的值並告警。entry 設定本身仍會使外掛程式載入失敗；而 llm 登錄檔拒絕的路由（已被另一配接器族佔有的那種）會被記錄下來，先前註冊的路由繼續服務。

配接器透過 `ctx.llm.listModels(provider)` 公開每條已設定路由的模型。這是從請求路徑所用的同一個 pi-ai `Models` 集合讀取的提供方無關 selector 元資料，因此發現不會建立第二個模型登錄檔。`ctx.llm.resolveModelInfo(provider, model)` 會執行一次精確 descriptor 尋找，並返回其身份、上下文視窗、已設定輸出上限和選填思考等級，讓權威元資料保留在擁有路由的配接器上，而非消費端。模型**已設定**的 `maxTokens` 會成為 seam 的 `defaultMaxTokens`，因此未點名輸出上限的請求會攜帶部署選定的那一個；而從已安裝 catalog 繼承來的值是模型的輸出**能力**，絕不會自行變成請求預設值。

攜帶推理元資料的模型——來自已安裝 catalog，或來自其條目的 `reasoningEfforts`——會公開 pi-ai 有序的 `getSupportedThinkingLevels(model)` 結果，不經篩選或規範化，其中包括 `off`，以及模型對 `xhigh` 或 `max` 的特定支持。Harness 將每個規範 pi-ai 等級公開為不透明 ID；提供方／模型在協定格式中的表示仍保留在 pi-ai 的 `thinkingLevelMap` 中。

**沒有**這份元資料的模型——條目未聲明 `reasoningEfforts` 的手工聲明模型，以及 pi-ai 標記為不具備推理能力的 catalog 模型——完全不公開 `reasoning`。pi-ai 會把這類模型報告為只支持 `off` 一檔，但 `off` 會被翻譯成*省略* reasoning 選項，而那與「不點名任何檔位」產出的請求逐位元組相同：選它關不掉任何東西，於是自身默認就在思考的提供方，會在介面顯示 `off` 被選中的同時繼續思考。把該能力報告為不可用，介面就只剩提供方默認這一項，不會再出現自相矛盾的控制元件。設定 profile 的 `reasoning` 值（包括 `off`）在存在時是部署預設值；省略它會保留提供方預設值。每次請求的 `GenerateOptions.reasoningEffort` 優先；未出現在確切模型能力中的檔位會讓**請求**在網路 I/O 前以 `UNSUPPORTED_REASONING_EFFORT` 失敗，而不會被自動調整。**描述**一個模型則從不這樣失敗：同一提供方下各模型接受的檔位並不一致，因此 `resolveModel` 對該模型拿不下的 profile 檔位報告為「沒有預設值」，而不是拋錯。在那裡拋錯會讓整個提供方從任何基於它建置的模型目錄中消失——一個配錯的 profile 欄位連支持該檔位的模型也一並藏起來——所以壞設定暴露在被執行處，而不是被描述處。pi-ai 的通用流選項透過省略 `reasoning` 表示 `off`。

受支持的 profile 欄位是 `apiKeyEnv`、`displayName`、`api`、`baseURL`、`models`、`modelOverrides`、`compat`、`defaultContextWindow`、`defaultMaxTokens`、`defaultInput`、`headers`、`reasoning`、`thinkingBudgets`、`cacheRetention`、`transport`、`timeoutMs`、`websocketConnectTimeoutMs`、`streamIdleTimeoutMs` 和 `retryPolicy`。每個 profile 的選填重試策略都會與該提供方路由一同捕獲；省略時使用有界的常規預設值。流空閒間隔必須是正的有限 Node 定時器延遲，預設為五分鐘，且只覆蓋未完成提供方讀取，不包括消費端思考時間。若已設定標頭中有同名項，則以 Harness 應用歸因為準。

配接器強制 pi-ai SDK `maxRetries` 為零，因此一次 `stream()` 呼叫只會發起一次提供方請求。已移除 profile 欄位 `maxRetries` 和 `maxRetryDelayMs` 會使載入失敗，而不是靜默倍增或隱藏單獨組合的 agent（代理）級重試預算。空閒逾時會 abort SDK 的穩定請求訊號，並以 `TIMEOUT` 呈現；較早的呼叫方 abort 仍為 `ABORTED`。

## 端點詢問

外掛程式提供 `ctx.llm.registerModelDiscovery('llm-pi-ai', …)`，用來回答「這個提供方能服務哪些模型？」——針對設定介面正在編輯或起草的路由。它刻意**不是** catalog 刷新：什麼都不儲存，回覆是介面供使用者採納的候選。`settings.yaml` 始終是唯一決定路由服務什麼的東西。

點名了**已安裝 catalog 所提供路由**的請求，直接由該 catalog 作答，完全不聯網：pi-ai 的登錄檔纔是它自家提供方的權威清單，且攜帶清單端點不會公佈的上下文視窗與輸出上限。這類路由根本不需要 `baseURL`。只有 catalog 未描述的路由——閘道、自建服務——才會經協議層詢問；若它也沒給端點，則會被告知去設定一個或手工填寫模型。

草稿攜帶的是使用者當下鍵入的憑據（如果有）；已經存好憑據的路由，在設定介面上只呈現一個脫敏描述符，因此詢問會解析該路由的 `apiKeyEnv`，而不是不帶認證寄出去、再把端點的 401 報成金鑰不對。鍵入的金鑰優先，因為那正是被測試的那一把。解析只發生在真正要聯網的路徑上，因此 catalog 路由作答時完全不會觸碰憑據。使用者提供或已儲存的探測金鑰也會經過同樣的去除空白與格式校驗：HTTP 標頭無法承載的值會被立即以 `LlmError('INVALID_CREDENTIAL')` 拒絕，而不會傳到 `fetch`——否則會呈現為一個和端點不可達難以區分的、語義不明的 `ByteString` 失敗。

詢問只讀 `openai-completions` 與 `openai-responses`，它們「`GET /models` + bearer 認證」的形狀是閘道、自建服務與官方端點三方一致認可的那一種。Azure 儘管出身 OpenAI 也被排除——它用 `api-key` 標頭認證並要求 `api-version` 查詢參數——Codex 則走 OAuth；其餘協議一律以 `DISCOVERY_UNSUPPORTED` 回答，讓介面回退到手工填寫，而不是把認證失敗報成一個沒有模型的提供方。`baseURL` 按前綴而非待解析 URL 處理，因此 `https://gateway.example/openai/v1` 這類部署路徑會保留其路徑段。

多數清單只公佈 id；`context_window`/`context_length` 與 `max_output_tokens`/`max_tokens` 在閘道提供時會被讀取，沒有可用 id 的條目會被跳過而不是讓整份清單失敗，其餘仍由採納方補齊。回覆在四兆位元組上限下讀取，且上限落在實際收到的位元組上——端點是使用者自己填的 URL，因此會先看聲明長度，但絕不把它當作邊界。端點不可達、憑據被拒、回應非 JSON、以及回應沒有 `data` 陣列，都會以 `DISCOVERY_FAILED` 失敗，訊息點名端點；僅當 401 或 403 時才點名憑據。讀取回應體期間被取消會呈現為 `ABORTED`，與請求寄出之前被取消一致。

## 提供方／模型路由與重播

每次解析產出一份**不可變**快照——profiles 加上一個持有各路由所建 `Provider` 的 `createModels()` 集合——每個操作都在自己第一個 `await` 之前整體捕獲一份快照。設定變化會構造**新**集合，而不是改動正在被使用的那個：`Models.streamSimple()` 是惰性的，它在流首次被消費時才解析 provider，而那已在 credential await 之後，因此改動共享集合會讓一個在舊設定下開始的請求在新設定下結束，或者撞上一個已不存在的 provider。這正是 seam 的每步呼叫凍結（`llm.prepareCall()`）能貫通到底的原因——回覆途中切換模型會在下一步生效，絕不會影響運送中的那一步。請求經 `Models.streamSimple()` 抵達提供方。保持 catalog 協議不變的 catalog 路由會**複用**已安裝提供方，只替換其模型清單，因為該提供方持有本包無法重建的 API 實作——Bedrock 經由獨立入口載入其 Smithy 模組——從零件重建會靜默收窄可用提供方的範圍。其餘路由都由 `createProvider()` 基於 `supportedProtocols()` 背後的協議表構造，表中條目正是 pi-ai 自己的提供方工廠所用的同一批 factory。

憑據絕不進入該集合。harness 在請求抵達 pi-ai 之前經自身 seam 解析路由金鑰，並作為請求的 `apiKey` 選項傳入，而 pi-ai 將其視為優先級最高的 auth 覆蓋；因此 `Models` 不持有任何憑據儲存，harness 也保住了自己明確失敗的引用語義。沒有點名任何憑據的路由會解析為「已設定但無金鑰」，把該要求留給協議——那纔是它真正所在的位置。

所選模型 descriptor 提供協議實作。這包括原生 API 差異，例如 descriptor 使用 Responses API 而非 Chat Completions 的 OpenAI 模型；harness 配接器不會按模型名稱硬編碼端點選擇。

成功的 assistant 回應會將經版本化的無損 JSON 重播狀態與生成該回應的提供方和模型一同儲存。請求時，`LlmRuntime` 只有在歷史提供方路由與目標提供方路由當前由同一個 `PiAiAdapter` 實例擁有時，才會傳遞重播狀態。即使目標提供方或模型改變，配接器也會驗證狀態並復原 pi-ai 回應 id 與提供方 signature；隨後由 pi-ai 判定目標 API 可以複用哪些元資料。沒有重播狀態的歷史會被轉換為外來的、與提供方無關的內容，絕不偽裝為原生 pi-ai 回應。

如果 listener 改寫已組裝 assistant 內容，loop 會在記錄訊息前丟棄重播狀態，因為其提供方元資料不再描述該內容。無效版本、格式錯誤元資料、訊息與重播狀態之間的提供方／模型不匹配，以及內容／塊不匹配都會顯式以 `LlmError('INVALID_REPLAY_STATE')` 失敗。

## 詞彙差異

- pi-ai 工具呼叫參數是已解析對象；harness 儲存原始 JSON 字串。配接器會解析輸入，並將輸出重新字串化。
- pi-ai 將失敗報告為流內錯誤事件；它們會對映到 `finish {kind:'error'|'aborted', failure}` 區塊。提供方特定錯誤文字會區分終止型 `QUOTA` 與暫時型 `RATE_LIMIT`，針對已解析模型上下文視窗評估的文字與 usage 訊號則將溢位規範化為 `CONTEXT_WINDOW_EXCEEDED`。終止時的 `stop` 若訊息不含內容區塊，則會對映為 `finish {kind:'error'}`，code 為 `EMPTY_RESPONSE`（默認策略會重試），而非成功空訊息。
- pi-ai 將推理 token 摺疊到輸出 usage 中；沒有可對映的獨立推理計數。
- pi-ai 的 `off` 思考等級會原樣穿過 Harness 能力 seam，並在分派時變為被省略的 pi-ai 通用 `reasoning` 選項。
- `GenerateOptions.stop` 會以 `UNSUPPORTED_OPTION` 被拒絕，因為 pi-ai 的通用流式輸出介面無法保證所有提供方都支持它。

## 應用歸因

每個請求都攜帶 dsh-llm `attributionHeaders()` 的共享歸因標頭，並透過 pi-ai `headers` 流選項合併。不會合成提供方特定應用歸因標頭。詳見 [dsh-llm § 應用歸因](../llm/README.md#app-attribution-attributionts)。

## 相依性體量

pi-ai 會安裝多個提供方 SDK，並延遲載入 catalog 模型所選的 SDK。該選填配接器包將相依性體量隔離在自身範圍內。

## 模型體驗

### 透過 pi-ai 發起的提供方請求

#### 模型看到的內容

所選 catalog 模型會收到 `GenerateOptions.system`、歷史、工具，以及 pi-ai 通用流式 API 支持的取樣欄位。本包不新增提示詞文字。只有當配接器驗證提供方原生重播元資料與歷史內容匹配時，才會復原這些元資料。

#### Token 影響

精確輸入取決於提供方 tokenization。轉換不新增模型可見文字；重播元資料可能讓原生 API 複用提供方側狀態。

#### KV Cache 影響

轉換保留邏輯請求順序，不新增文字；複用取決於所選提供方的序列化與重播狀態。更改配接器實例、提供方、模型或任何上游請求 token，都可能使複用從首個出現差異的 token 起失效。

### 提供方回應

#### 模型看到的內容

pi-ai 事件會變為 harness 推理、文字、工具呼叫、usage 與 finish 區塊。配接器把解析後的工具參數作為原始 JSON 字串傳給 harness。

#### Token 影響

只有在 loop 記錄生成內容後，它才會影響後續輸入。提供方不單獨報告推理 token 時，pi-ai 會將其摺疊到輸出 usage 中。

#### KV Cache 影響

已記錄回應內容會追加到下一個請求，不會使其較早可複用前綴失效。未記錄傳輸元資料與 usage 計量不影響 cache 身份。

## 已知限制與暫緩事項

- **僅以 OAuth 認證的提供方不予提供**：pi-ai 的 OAuth 只從*已儲存*的 OAuth 憑據解析，而本配接器構造 `Models` 集合時不注入憑據儲存、也不執行登入流程，因此這類路由的每個請求都會在寄出之前以 `Provider is not configured` 失敗。可設定提供方目錄因此不列出它們；已安裝 catalog 中只有 `openai-codex` 屬於此類。settings 文件已經寫過的路由仍保留目錄條目，設定介面據此可以編輯或刪除；`apiKeyEnv` 也仍能用該金鑰完成認證——對 Codex 而言那是一個會過期、且這裡沒有任何環節會去刷新的 token。
- **提供方自帶的憑據發現只讀行程環境**：不指定憑據的路由交由 catalog 提供方自行解析，而它探測的是環境變數（`AZURE_OPENAI_API_KEY`、`AWS_PROFILE`、`AWS_ACCESS_KEY_ID` 以及各提供方自己的那一組）。它不讀任何本機憑據目錄，因此只有 `~/.aws/credentials` 而未匯出 `AWS_PROFILE` 會被解析為未設定；由 harness 憑據 seam 保管的值，除非行程環境裡也有，否則對它不可見。
- **settings 能新增或覆蓋路由，但不能移除組合路由**：使用者層合併在組合 `base` 之上，因此刪除 `cordis.yml` 提供的提供方屬於組合變更；對該 namespace 執行 `replace` 只會重設使用者層。
- **分層合併對字典鍵沒有刪除語義**：settings seam 把組合 `base` 與使用者層按鍵遞迴合併，因此 base 聲明的某個 `reasoningEfforts` 檔位、`modelOverrides` 條目或 `compat` 欄位，使用者層只能覆蓋、無法移除——而 `reasoningEfforts` 裡缺席本身*就是*語義（「不提供」），於是 base 聲明過的檔位會一直被提供。只有 `cordis.yml` entry config 為使用者層正在編輯的同一模型聲明瞭按模型推理欄位才會觸發；受支持的姿態是把這些欄位留給 settings 文件（shipped 組合以 dormant 方式掛載該配接器），且 `models` 清單是陣列、整體替換，這是帶內的解決辦法。
- **`headers` 可能承載一條脫敏器看不見的憑據**：profile 的 `headers` 是純字串字典，因此設在其中的 `Authorization` 或 `api-key` 會被脫敏後的 `describe()` 原樣返回，並被任何設定 UI 渲染出來。請把憑據存為 `apiKeyEnv` 引用；把該字典整體改為只寫與其餘[協議邊界工作](../llm/README.md#known-limitations-and-deferred-work)一並暫緩。
- **路由的 catalog 不會自我刷新**：catalog 就是 `settings.yaml` 所寫的內容，因此模型清單的新鮮度只到最近一次編輯為止。這裡沒有任何環節會去問提供方它服務哪些模型；路由要多一個模型，得有人寫進去。
- **每條路由只有一種協定格式**：`api` 作用於整條路由，因此混合協議的 catalog 路由（跨 Responses 與 Chat Completions 的 OpenAI 式 catalog）無法承載另一種協議的模型，向這類路由新增它未描述的模型必須點名 `api` 並把全部模型一起遷過去。把該提供方拆成兩個路由鍵是變通辦法。
- **模態聲明不經驗證，且多聲明的後果超出本輪**：沒有任何環節會去詢問端點接受什麼，因此聲明瞭閘道並不提供的 `image` 的模型不會在這裡被攔下，而是由提供方在輪次中途拒絕。prompt 准入在構造請求之前就把使用者訊息持久化提交，於是被拒絕的圖片留在工作階段日誌裡：該模型會不斷重發它，而模型選擇拒絕切換到任何純文字模型。復原途徑是換一個確實支持圖片的模型、fork 到圖片之前，或開啟新工作階段；傳送失敗時把尚未消費的圖片訊息從日誌中回滾出去這件事已暫緩。
- **未認證路由取決於其協議**：不點名憑據會讓路由解析為「已設定但無金鑰」，但 pi-ai 的 OpenAI 相容實作仍要求 API key 或 `Authorization` 標頭，因此無鑒權的本機服務需要一個由 `apiKeyEnv` 引用的佔位憑據，或在 `headers` 中給出 `Authorization` 條目。
- **不支持 `GenerateOptions.stop`**：pi-ai 的通用流選項無法保證所有提供方都支持 stop sequence，因此配接器會拒絕該欄位。
- **歷史中的 `system` 訊息使用 pi-ai 通用上下文轉換**：提供方特定位置由 pi-ai 決定，而非由 harness 擁有的協議覆蓋決定。
- **無法取得提供方 HTTP 狀態**：pi-ai 錯誤事件不會在所有提供方上公開穩定 HTTP 狀態；失敗只公開穩定 harness 錯誤 code。
- **重試策略由提供方持有，而不是 SDK 重試**：每個提供方 profile 都可以設定巢狀的 `retryPolicy`，由 `dsh-llm-retry` 在 agent 的失敗步驟擴充點上執行；pi-ai SDK 重試仍保持停用，因此持久化的 agent 步驟與 `llm/retry` 事件記錄每次可見嘗試，直接 `ctx.llm.stream()` 呼叫仍只嘗試一次。
