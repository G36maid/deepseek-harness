# Agent Note: 詢問草稿中的提供方端點

Status: implemented

[English](2026-08-04-draft-provider-endpoint-interrogation.md) | [简体中文](2026-08-04-draft-provider-endpoint-interrogation.zh.md) | 繁體中文

## Problem

當 pi-ai 路由變成[一份聲明而非 catalog 查表](2026-08-03-pi-ai-declared-provider-catalog.md)之後，要接入一個 OpenAI 相容閘道的人，必須先知道它的模型 id 才能完成設定。配接器不再把人限制在已安裝 catalog 裡——這正是那次改動的目的——但也意味著沒有任何東西告訴使用者該端點究竟服務什麼，而這類端點大多在 `GET /models` 上公佈了這份清單。

顯而易見的答案——後臺刷新的執行時期動態 catalog——已隨下層一並被拒絕：它會把路由的模型清單變成需要快取、失效語義與離線路徑的外部可變狀態，而產品需求要窄得多。真正需要的是*一次性詢問*，其答案由使用者採納進 `settings.yaml`，從而讓 `settings.yaml` 始終是決定路由服務內容的唯一真源。

麻煩之處在於，被問的對象還不存在。正在新增的提供方沒有路由、沒有已存 profile、也沒有已存憑據；端點與金鑰都是使用者尚在輸入的表單值。而現有的每個 LLM（大型語言模型）Service Definition 操作都以已註冊的提供方路由為鍵，因此沒有一個能承載它。

## Decision

詢問以 **settings namespace** 為鍵，而不是提供方路由：

- `ctx.llm.registerModelDiscovery(settingsNs, discover)` 讓配接器外掛程式為自己擁有的 namespace 提供「詢問端點」的能力，`ctx.llm.discoverModels(settingsNs, request)` 發起詢問。沒有任何辦法枚舉哪些 namespace 註冊過：詢問不了的介面會從那句拒絕裡知道，而一份無人消費的清單只會變成一個什麼都不做的必填協議欄位。以 namespace 為鍵是對的，因為設定介面已經從可設定提供方目錄裡拿到了它，也因為正在新增的提供方沒有路由可點名。
- `LlmModelDiscoveryRequest` 攜帶草稿——選填的 `provider`、選填的 `baseURL`、選填的 `api`、選填的 `apiKey`，以及一個 signal——且 `provider` 與 `baseURL` 至少要有一個，纔有東西可答。`provider` 之所以存在，是因為配接器已經描述過的路由直接由它自己的登錄檔作答、完全不聯網；只有它未描述的路由才會抵達某個端點。這條路徑不寫 settings 與 credentials。唯一的讀取是請求所點名路由的憑據：設定介面拿到的是脫敏描述符而非已存的機密，因此草稿裡的 `apiKey` 只在使用者正鍵入時才存在；沒有這次讀取，已設定好的路由就會被不帶認證地詢問，只換回一個 401。鍵入的金鑰優先，因為那正是被測試的那一把。
- `LlmDiscoveredModel` 除 `id` 外每個欄位都選填，因為大多數清單只公佈 id。回覆是候選而非 catalog：採納其中一條的介面仍要補上配接器所需的容量。
- `llm.discoverModels` 把同一份草稿送過協議層。它的 `apiKey` 是可承載機密的第三個、也是最後一個載荷（另兩個是 `settings.update`/`mutate` 與 `credentials.set`），且絕不被儲存或回顯。它確實會像其他承載機密的載荷一樣隨用戶端外發信封同行，`subscribeEnvelopes()` 觀察者看得到；把那個抽頭脫敏是整個設定面的改動，不該由這一個方法獨自決定。除金鑰之外，將它限制為僅可透過回環訪問還有第二個理由：它讓宿主向呼叫方選定的 URL 發起 GET 並回報結果，這是匿名 LAN 呼叫者不該擁有的探測能力。每一種拒絕都摺疊為 `model-discovery-failed`，其訊息是配接器自己的文字，details 點名被詢問的端點，絕不點名所提供的憑據。

`dsh-llm-pi-ai` 的實作只是一次樸素的 `GET {baseURL}/models`，且僅限 OpenAI 相容協議。它們的清單形狀是閘道、自建服務與官方端點三方一致認可的那一種，而這正是該動作存在的場景。其餘協議一律以 `DISCOVERY_UNSUPPORTED` 回答，讓介面回退到手工填寫，而不是把猜錯的回應形狀報成一個空提供方。`baseURL` 按前綴而非待解析 URL 處理，因此 `https://gateway.example/openai/v1` 這類部署路徑會保留其路徑段。回覆在四兆位元組上限下讀取，且上限落在實際收到的位元組上——端點是使用者自己填的 URL，因此會先看聲明的 `content-length` 作為善意提示，但絕不把它當作邊界；這與 `dsh-web-fetch` 面對自己的呼叫方提供 URL 時所用的兩段式形狀一致。

### 為什麼不用 pi-ai 自己的 refresh 機制

pi-ai 提供了 `createProvider({ fetchModels })` 加上 `Models.refresh()` 與 `ModelsStore`，而下層本來就在構造 pi-ai `Provider` 對象。把詢問接到它們上面，意味著每問一次就要構造一個用完即棄的提供方與集合，而那個 store 的全部目的——跨執行持久化 catalog——恰恰與「`settings.yaml` 擁有 catalog」的決定相牴觸。而且它什麼也換不來：**沒有任何一個 pi-ai 內建提供方實作了 `fetchModels`**，因此 HTTP 呼叫及其回應解析無論如何都是本包的程式碼。直接 fetch 才如實說出正在發生的事。路由已存的憑據由本外掛程式自己那套逐請求解析器取出，且只在真正要聯網的那條分支上進行，因此 catalog 路由作答時既不觸碰憑據，也不會因為一把這次詢問根本用不上的金鑰而失敗。

## Alternatives considered

**以提供方路由為鍵。** 與其他每個 LLM Service Definition 操作對稱，也能讓請求省去端點。但催生該功能的場景——新增提供方——沒有路由，於是這個操作只對已設定好的提供方可用，而它們恰恰最不需要它。

**把能力掛在 `LlmAdapter` 上。** 配接器要經由路由註冊才能抵達，因此問題相同；而且這會讓一個配接器實例去回答它並不服務的端點的問題。

**讓 host 讀已存 profile，而不是接受草稿。** 對已設定好的提供方來說，不會有機密跨越協議層。但這樣一來新增提供方就必須先保存一份不可用的設定，而端點已改卻尚未保存的表單會靜默地去詢問舊地址。接受草稿讓使用者看見的與被詢問的保持一致——憑據是唯一的例外，因為它是從不向介面展示、因而永遠無法放進草稿的那個欄位。

**詢問 pi-ai 的每一種協議。** Anthropic 的清單恰好與 OpenAI 共用同一層信封，而 Google 的不是。只支持容易的那幾種會讓覆蓋範圍變得任意；更糟的是，猜錯的回應形狀會與「該提供方沒有模型」無法區分。一個明說自己無法被詢問的協議，會把使用者送去手工填寫——那正是既定的回退路徑。

**用 `response.text()` 緩衝整個回覆再判斷長度。** 更簡單，但上限會在位元組已經到達之後才生效，而端點是使用者隨手填的任意 URL。

## Consequences

接入閘道的人可以直接問它服務什麼，而不必去翻它的文件；答案以候選形式抵達，由使用者自己挑選，而不是被背著寫進設定。seam 因此多了一個刻意保持很小的登錄檔：每個 namespace 一份、不儲存、生命週期不超出 fiber。

代價是：協議層多了第三個承載機密的載荷，設定面的只寫介面從兩個方法變成三個。發現覆蓋範圍按協議而非按提供方劃分——一個 Anthropic 相容閘道即便其清單能被解析，也仍須手工填寫。而且由於沒有任何環節會重跑該詢問，模型清單的新鮮度依舊只到最近一次編輯為止；這與下層刻意做出的取捨是同一個。

## Testing

`packages/llm/llm/tests/topology.spec.ts` 覆蓋登錄檔：每個 namespace 一份、隨 fiber dispose（資源釋放）、丟棄重複與不可用 id 且不憑空補容量的歸一化，以及 `NO_DISCOVERY`/`INVALID_DISCOVERY` 兩種拒絕。`packages/llm/llm-pi-ai/tests/discovery.spec.ts` 針對本機 HTTP 伺服器驅動探測——含與不含公佈容量的清單、被保留的部署路徑、無憑據、草稿沒帶金鑰時已設定路由自行取用憑據且鍵入的金鑰壓過它、catalog 路由完全不解析憑據即作答、被丟棄的行、401/403 與伺服器故障之別、非清單與非 JSON 回應、不可達端點、呼叫方取消、不支持的協議，以及尺寸上限的「聲明長度」與「流式」兩種形態。`packages/host/apiproxy/tests/api-proxy-config.spec.ts` 在真實 proxy 上覆蓋該 RPC：草稿完整抵達其 namespace、缺席欄位保持缺席、沒有 namespace 或憑據被寫入，以及失敗以 `model-discovery-failed` 呈現且序列化後的錯誤裡不含憑據。
