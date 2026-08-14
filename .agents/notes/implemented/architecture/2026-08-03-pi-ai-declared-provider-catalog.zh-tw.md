# Agent Note: pi-ai 路由是被聲明的提供方，而不是 catalog 查表

Status: implemented

[English](2026-08-03-pi-ai-declared-provider-catalog.md) | [简体中文](2026-08-03-pi-ai-declared-provider-catalog.zh.md) | 繁體中文

## Problem

`dsh-llm-pi-ai` 把 pi-ai 包生成的 catalog 當成了可設定範圍的邊界。路由鍵必須點名一個已安裝提供方（`resolveProfiles` 拒絕其餘一切），模型列舉原樣返回 `getBuiltinModels(provider)`，請求期的模型解析又在同一份 catalog 裡查這個 id、且只覆蓋 `baseURL`。由此產生三個後果，而且三個都是死路而非缺口：OpenAI 相容閘道、自建服務，或比已安裝 catalog 更新的提供方，根本無法設定；catalog 尚未跟上的模型即便端點正確也會以 `UNKNOWN_MODEL` 失敗；模型的上下文視窗與輸出上限完全由鎖定的 pi-ai 版本決定，部署既無法更正過時值，也無法為 pi-ai 從未描述過的模型補上。要動其中任何一條，只能升級相依性。

配接器還經 `@earendil-works/pi-ai/compat` 的 `streamSimple` 發起流式請求，而該入口自己的模組文件聲明它是臨時相容面——其 catalog 讀取標了 `@deprecated`，並會在 pi-ai 完成 `ModelManager` 遷移時被刪除。這三條設定限制與這個廢棄相依性的解法是同一個，因為 pi-ai 受支持的執行時期（`createModels()` / `createProvider()`）正是圍繞「提供方是被*聲明*出來的，而非查出來的」建立的。

## Decision

提供方路由是一份**聲明**，已安裝 catalog 是它的預設值。`resolveProfiles` 不再拿路由鍵去核對 `getBuiltinProviders()`，而是把每條路由解析成一份物化模型清單，外加服務它的 pi-ai `Provider`：

- `catalog.ts` 把已安裝 catalog 合併到 profile 自身條目之下。profile 的 `models` 清單*替換*該路由的 catalog（清單缺席或為空則原樣服務），每個條目從同 `id` 的已安裝模型繼承自身未設定的欄位。只有 harness 會消費的欄位可設定——`id`、`name`、`contextWindow`、`maxTokens`；[[2026-08-08-pi-ai-per-model-reasoning-declarations]] 之後加入了 `reasoningEfforts` 與 `compat`，當初「推理（reasoning）沿用已安裝條目或直接缺席」的立場也在那裡被重新審視（孤立的能力布林量仍被拒絕；帶 wire 拼寫的逐檔位完整聲明沒有它那個問題）。輸入模態後來被開放，形態是條目上的 `input` 加路由級 `defaultInput`——圖片准入點使得「未被報告的模態」變成部署無法解除的拒絕之後（[[2026-08-12-pi-ai-route-default-input-modalities]]）；當初「沒有任何讀取方」那句論證描述的其實是 `llm-deepseek` 的序列化器，而不是這條路由，它的轉接器能攜帶圖片。定價仍因原有理由不出現在設定面：`replay.ts` 把 pi-ai 的成本元資料清零，且沒有任何消費端報告開銷。物化時以已安裝條目鋪底、再覆蓋已設定的欄位，而不是逐欄位枚舉結果：枚舉式重建會靜默丟棄本包未建模的每一個 `Model` 欄位——`headers` 就是這樣從某條 nvidia 路由上消失過一次。
- `provider.ts` 構造路由的 `Provider`。保持 catalog 協議不變的 catalog 路由會**複用**已安裝提供方，只替換 `getModels()`；其餘路由都由 `createProvider()` 基於一張協議表構造，表中條目正是 pi-ai 自己的提供方工廠所用的 `@earendil-works/pi-ai/api/*.lazy` factory。該表刻意窄於 pi-ai 的完整 API 集合——只保留 profile 能用金鑰、端點與標頭完整描述的協議，因此 Bedrock（SigV4 加 region）、Vertex（project、location、ADC）、Azure（提供方環境加 api-version）與 Codex（OAuth）不在其中，而不是被當作無法認證的路由提供出去。catalog 路由仍可經自己的 provider 抵達它們；被拒的只有顯式覆蓋。
- `adapter.ts` 把每次解析變成一份**不可變快照**——profiles 加上持有這些 provider 的 `createModels()` 集合——每個操作都在自己第一個 `await` 之前整體捕獲一份。

- 模型**顯式設定**的 `maxTokens` 會成為 seam 的 `defaultMaxTokens`；從已安裝 catalog 繼承來的那份不會：pi-ai 要求 `Model.maxTokens` 表示模型的輸出*能力*，而 `defaultMaxTokens` 是部署選定、發給未點名上限的請求的那個值，把前者物化成後者會讓每個請求都被一個無人選擇的數字封頂。

### 快照，而不是共享集合

`Models.streamSimple()` 惰性解析提供方——在返回的流首次被消費時，而那已在配接器 await 路由憑據之後。因此就地改動的單一集合，會讓一個在舊設定下開始的請求在新設定下結束，或者撞上一個已不存在的提供方，儘管 `llm.prepareCall()` 早已凍結了該步的 config 並捕獲了其配接器註冊。設定變化改為構造*新*集合，正在被使用的那個原封不動，於是 seam 的每步凍結得以貫通到底：回覆途中切換模型在下一步生效，絕不影響運送中的那一步。

### 目錄原子替換

可設定提供方目錄跟隨 profiles，因此每當一條聲明路由出現或離開它都會變化。「撤銷舊註冊再新建一個」表達不了這件事：登錄檔拒絕的候選集合——比如一份鍵為 `deepseek-official` 的 profile，而 `llm-deepseek` 已聲明瞭它——會讓本外掛程式的整個目錄被撤走、Models 頁變空，而且是靜默的，因為 settings 變更回呼把失敗容住了。因此 `registerConfigurableProviders` 改為返回帶 `replace(entries)` 的控制代碼，其「候選集先整體校驗」的原子性與 `registerAdapter` 相同，外掛程式改用它。被拒的替換只付出一條診斷；先前的條目繼續服務。

解析失敗得響亮，並點名出問題的路由與模型：catalog 未描述的模型會回落到該路由自己的 `defaultContextWindow`／`defaultMaxTokens`，因此只公佈 id 的清單也能得到可服務的路由；catalog 未提供的路由需要 `api`、`baseURL` 和非空的 `models` 清單。由於構造出的 `Provider` 是解析結果的一部分，協議或模型出錯時最後可用的路由集合會繼續服務——與此前壞的 settings 快照的行為完全一致。

可設定提供方目錄現在是已安裝 catalog **與**當前 profile 聲明的每條路由的並集，並在該集合變化時重新登記。沒有這個並集，手工聲明的路由就沒有 settings 地址，任何設定介面都無法展示或編輯它。

### 唯一檔位什麼也做不到的能力，報告為不可用

pi-ai 把沒有推理元資料的模型報告為只支持 `off` 一檔，而配接器此前原樣透傳。它抵達 seam 時是一個單元素的 effort 清單，任何介面都會把它渲染成一個只有一項選填控制元件的選擇器——而這個控制元件在撒謊：`off` 在派發時變成被*省略*的推理選項，與「不點名任何檔位」產出的請求逐位元組相同。自身默認就在思考的提供方會繼續思考，介面卻顯示 `off` 已選中。

因此只要 `model.reasoning` 為假，`reasoningInfo` 就省略 Service Definition 的 `reasoning` 欄位。判據是模型自身的元資料，而非模型的來源，所以它覆蓋條目未聲明 `reasoningEfforts` 的每一個手工聲明模型（[[2026-08-08-pi-ai-per-model-reasoning-declarations]] 讓聲明的檔位攜帶這份元資料）**以及** pi-ai 標記為不具備推理能力的那 251 個已安裝 catalog 模型。它們此前提供那個孤零零的 `off`，現在什麼也不提供，介面只剩提供方默認。攜帶推理元資料的模型不受影響——其檔位清單仍不經篩選地穿過 seam、`off` 也在內，因為在那裡它是在真實備選之間做選擇。

### 憑據留在 pi-ai 之外

pi-ai 的 `Models` 自帶一套憑據概念——按提供方 ID 索引的 `CredentialStore`，配合 `envApiKeyAuth` 解析 `credential.key ?? env(VAR)`。採用它會在 `ctx.credentials` 之外製造第二個憑據真源，更糟的是會把 harness 明確禁止的環境回落重新引進來：點名了卻取不到的 `apiKeyEnv` 必須以 `MISSING_CREDENTIAL` 失敗，而不是用環境裡恰好持有的某個無關金鑰完成認證。

`ModelsImpl.applyAuth` 會把 `options.apiKey` 當作該請求的金鑰，但這條路必須經由一個聲明瞭 api-key 方法的提供方：`resolveProviderAuth` 在覆蓋存在時短路到該方法，否則依次落到憑據儲存與環境發現；若提供方壓根沒有 api-key 方法，它返回空，請求隨即以 `Provider is not configured` 失敗。因此 harness 一如既往經自身 seam 解析路由金鑰，並把結果作為請求的 `apiKey` 傳入；該集合構造時不帶任何憑據儲存。

路由的 auth 由此推出。catalog 路由保留已安裝提供方自己的 `auth`，從而為不點名憑據的 profile 保住其提供方原生環境發現，且在 `api` 覆蓋之下同樣保留：提供方讀哪個環境是提供方自身的屬性，而非其模型所講協定格式（wire format）的屬性。例外是沒有 api-key 方法的 catalog 提供方——`openai-codex` 只走 OAuth——此時點名了憑據的 profile 會在提供方原有 auth 之外再獲得 harness 的方法，否則它設定的金鑰會在任何請求寄出之前被拒。這類路由上不點名憑據的 profile 什麼也不加、並保留那句誠實的拒絕：本配接器沒有可供解析的 OAuth 儲存。手工聲明的路由則獲得一個 harness 自有的 `ApiKeyAuth`，它報告「已設定但無金鑰」而非「未設定」，把該要求留給協議——那纔是它真正所在的位置：pi-ai 的 OpenAI 相容實作仍要求金鑰或 `Authorization` 標頭，並且會自己說出來。

## Alternatives considered

- **保留 `createProvider()` 但不建 `Models` 集合**，改由 `provider.streamSimple(model, ctx, {apiKey})` 發起。改動最小且憑據路徑原封不動，但 `createProvider` 的 `auth` 是必填欄位，這條路上它永遠不會被呼叫——一份因簽名而必填、卻沒有呼叫方的實作。它還讓 `refreshModels` 需要手工構造 `RefreshModelsContext`，並使配接器始終不在 pi-ai 真正支持的執行時期上。
- **catalog 路由複用已安裝提供方，只有聲明式路由走 `createProvider()`**，且兩者不共享解析。對 catalog 行為零風險，但 catalog 物化、端點覆蓋與每模型設定這三件事都要各寫兩遍，而改指協議的 catalog 路由還得在解析中途跳到另一條路徑。已採納的拆法把不對稱收斂在提供方構造這一處——那裡的不對稱是 pi-ai 不暴露已構造提供方的 API 實作所強加的。
- **讓每條路由都經 `createProvider()` 重建**，包括 catalog 路由。完全對稱，但已構造的 `Provider` 不暴露自己的 `api`，於是協議表會成為「哪些提供方能用」的天花板——Bedrock 經獨立入口載入其 Smithy 模組，會因此靜默失效。
- **完整暴露 pi-ai 的 `Model` 形狀**（成本、輸入模態、`thinkingLevelMap`、`compat`）。可設定性最大，但這些欄位當時沒有任何讀取方，因此配了價格或模態什麼也不會改變，卻看起來像是受支持的。這條否決裡由消費端驅動的那一半後來逐欄位兌現了，每次都等到出現真實讀取方：[[2026-08-08-pi-ai-per-model-reasoning-declarations]] 在選擇器與分派真正消費之後開放了推理（以 `reasoningEfforts` 的形態，而非裸 `thinkingLevelMap`）和兩個推理分派 `compat` 開關；[[2026-08-12-pi-ai-route-default-input-modalities]] 在圖片准入點開始讀取之後開放了模態（以 `input` 與 `defaultInput` 的形態，而非裸 `Model.input` 直通）。成本仍因原有理由保持關閉。

- **保留單個可變 `Models` 集合併重新同步。** 分配更少，且對每個同步完成解析的操作都是正確的；唯獨對那個不同步的操作恰恰是錯的：`stream()` 會在捕獲模型與派發模型之間 await 一次憑據。
- **用「先 dispose 再註冊」模擬目錄原子替換。** 無需改 seam，且在新集合有效時確實可用——而那正是從不需要原子性的那種情形。
- **執行時期動態 catalog**——`fetchModels` 加 `ModelsStore`，後臺刷新。本次變更拒絕：它把模型清單變成需要快取、失效與離線路徑的外部可變狀態，而產品需求是一次性的發現動作、其結果由使用者採納進 `settings.yaml`。該動作屬於設定介面，與之一並暫緩；`settings.yaml` 始終是「路由服務什麼」的唯一真源。

## Consequences

設定一個提供方不再取決於 pi-ai 的發布節奏。閘道、自建服務，或比鎖定 catalog 更新的模型，都是一次 `settings.yaml` 編輯，過時的上下文視窗也能就地更正。廢棄的 `/compat` 匯入已經消失，因此 pi-ai 刪除它不再是破壞性事件。`defaultMaxTokens` 現在會在部署明確給出時從設定中傳入，不會從 catalog 元資料裡發明一個上限。

代價是：聲明式路由會讓 `settings.yaml` 變長，因為它必須自報端點、協議與模型 id。`api` 作用於整條路由，因此混合協議的 catalog 路由無法承載另一種協議的模型——把它拆成兩個路由鍵是變通辦法。沒有任何環節查詢提供方的 `/models`，因此模型清單的新鮮度只到最近一次編輯為止。有一種情形下報錯形狀發生變化：auth 解析不出任何值的路由，現在會在任何網路呼叫之前把 pi-ai 自己的診斷作為錯誤 `finish` 區塊呈現，而此前的配接器會發出無金鑰請求並呈現提供方的 401。

## Testing

`tests/catalog.spec.ts` 針對本機 mock 伺服器端到端覆蓋該約定：手工聲明的路由帶著自己的憑據流向自己的端點、它在可設定提供方目錄中的出現、每模型覆蓋從已安裝 catalog 繼承預設值、向 catalog 路由新增模型、帶與不帶端點覆蓋的協議改指、catalog 獨有元資料在覆蓋後存活、無金鑰姿態及其 `Authorization` 標頭變通、只走 OAuth 的 catalog 路由用 profile 點名的金鑰完成認證而無金鑰者保持未設定、改指協議的路由保留其 catalog auth，以及每一種點名路由或模型的解析失敗。`tests/catalog.spec.ts` 還釘住了快照與目錄兩項約定：運送中請求即便其路由集在 credential await 期間改變，仍抵達它解析時對應的端點；下一個請求取用新設定；衝突的聲明路由讓目錄保持完好；聲明路由的條目隨其 profile 出現與離開。`packages/llm/llm/tests/topology.spec.ts` 覆蓋 `replace`——拒絕他人已擁有的候選同時保住當前集合、接受對自身條目的替換、允許空集合，以及 dispose 之後失敗。`tests/sdk-options.spec.ts` 把 SDK 邊界從已移除的 `/compat` 匯入改指到協議表的 lazy api 模組，同時釘住「setup 失敗以終止性錯誤區塊而非拋出的形式抵達」。twin 的[設計驗證角色](2026-06-13-twin-llm-adapters.md)不變。
