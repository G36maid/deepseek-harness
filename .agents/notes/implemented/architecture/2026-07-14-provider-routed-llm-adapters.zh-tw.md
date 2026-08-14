# Agent Note: 基於提供方路由的 LLM 配接器與通用 pi-ai 後端

Status: implemented

[English](2026-07-14-provider-routed-llm-adapters.md) | [简体中文](2026-07-14-provider-routed-llm-adapters.zh.md) | 繁體中文

## 問題

`dsh-llm` 按精確模型名稱註冊配接器。外掛程式在 Cordis 啟動時提供模型清單，`LlmRuntime` 為清單中的每個字串保存一個配接器，`GenerateOptions.model` 同時選擇配接器與提供方模型。兩個隨附的配接器都只面向相同的兩個 DeepSeek 模型時，這種方式可以工作，但它混淆了兩個獨立決策：由哪個上游提供方承接請求，以及該提供方應執行哪個模型。

這種混淆使提供方閘道無法提供開放的模型目錄。例如，OpenRouter 是一個包含大量模型 ID 的提供方，私有 OpenAI 相容端點也可能在不修改 Harness 外掛程式樹的情況下增加模型。目前，每個新選擇的模型都必須在外掛程式啟動期間完成註冊。同一個模型 ID 還可能存在於多個提供方中，因此僅按模型註冊無法表達呼叫方預期使用的提供方。

`dsh-llm-pi-ai` 沒有暴露 pi-ai 的提供方抽象。它以內聯方式構造 DeepSeek `openai-completions` 模型，應用 DeepSeek 專用的 payload 修補程式，並將每條重播的助手訊息標記為 DeepSeek。pi-ai 自身提供提供方/模型目錄，能夠選擇 `openai-responses`、`anthropic-messages`、`google-generative-ai` 等 API，並保留提供方專用的回應 ID，以及後續輪次所需的推理和工具簽名。Harness 轉換丟棄了提供方／模型路由和提供方回應欄位，因此僅將內聯模型替換為目錄查詢，會導致同模型重播與跨提供方移交不完整。

配接器設定同樣假定只存在一個 DeepSeek API 金鑰和端點。通用後端需要為各提供方分別設定憑據和端點覆蓋，同時繼續由 pi-ai 處理 AWS、Google ADC、OAuth 等環境認證機制。

## 決策

### 提供方作為配接器註冊鍵

`GenerateOptions` 與 `LlmCallConfig` 在 `model: string` 之外攜帶 `provider: string`，`AgentOptions` 則攜帶對應的選填建立欄位。只有兩個值都非空時，agent loop（代理循環）請求才有效；兩個值也都會寫入請求標頭日誌。`agent/request` 可以在任意步驟返回替換後的欄位組合，因此工作階段可以切換提供方與模型，無需改變 Cordis 外掛程式生命週期。

`LlmRuntime` 按提供方註冊和解析配接器。`registerAdapter(providers, adapter)` 在修改登錄檔前檢查整個提供方清單，遇到重複項時返回 `DUPLICATE_ADAPTER`，並以一個 effect 為單位整體 dispose（資源釋放）。模型 ID 不作為註冊鍵；仍由選中的配接器負責驗證或轉發。後續的 [LLM 目錄與 ACP 模型選擇 Agent Note](2026-07-15-llm-model-catalog-and-acp-selection.md) 增加了建議性的 `listProviders()` / `listModels()` 發現介面，但不會把目錄成員關係變成請求校驗規則。

在一個 Cordis 上下文中，一個提供方只能有一個配接器所有者。`dsh-llm-deepseek` 註冊 `deepseek`；`dsh-llm-pi-ai` 也可以註冊 `deepseek`，但同時載入兩個所有者屬於設定錯誤，不採用順序規則或回退行為。若部署選擇手寫的 DeepSeek 實作，需從 pi-ai 設定中排除 `deepseek`；若部署選擇 pi-ai 的 DeepSeek 實作，則不掛載 `dsh-llm-deepseek`。

`dsh-llm-deepseek` 移除模型註冊清單，接受透過 `deepseek` 提供方路由的任意模型字串。其請求序列化、`/chat/completions` 端點、thinking 選項、SSE（Server-Sent Events）解析和錯誤行為保持不變；`options.model` 仍會原樣傳送。

### 顯式 pi-ai 提供方設定

`dsh-llm-pi-ai` 接受一個非空的提供方設定清單。清單內的提供方名稱必須唯一，並且存在於 pi-ai 的 `getProviders()` 結果中。每項設定包含提供方名稱，以及選填的 `apiKey`、`baseURL`、headers、推理等級和預算、快取保留設定、傳輸方式、SDK 逾時、Harness 流空閒逾時，以及由提供方擁有的 `retryPolicy`。配接器強制將 pi-ai 的 `maxRetries` 設為零，使一次 `stream()` 呼叫只發起一次可見的提供方請求；`dsh-llm-retry` 則在 agent 失敗步驟擴充點上執行解析後的策略。憑據不設全域性值：顯式金鑰僅對所屬設定生效；未提供金鑰時，pi-ai 使用標準環境變數、OAuth token、AWS 憑據鏈、Google ADC 或其他提供方原生環境認證。顯式空金鑰屬於無效設定，不會回退到環境認證。

外掛程式透過一次全有或全無呼叫，將所有已設定的提供方名稱註冊到同一個 `PiAiAdapter`。請求按 provider 選擇對應設定，並在 `getModels(provider)` 中尋找模型以取得目錄描述符。未知提供方會在外掛程式載入時失敗；未知模型會在網路 I/O 前以 `UNKNOWN_MODEL` 失敗。配接器不會修改目錄對象。當設定提供 `baseURL` 時，配接器複製選中的描述符，僅覆蓋 `baseUrl`，使私有端點保留 pi-ai 的 API、能力、相容標志、上下文限制與推理對映。私有端點必須實作所選提供方的協議，模型 ID 也仍須存在於已安裝的 pi-ai 目錄中。

配接器呼叫 pi-ai 的 `streamSimple()`，因此每個目錄模型會選擇其註冊的 API 實作；描述符為 `openai-responses` 時使用 OpenAI Responses，而非 Chat Completions。Harness 的 temperature、最大 token 數、signal、session ID，以及提供方設定中的通用流選項均直接傳遞。設定 headers 與 Harness 強制歸因 headers 合併；發生保留名稱衝突時，以 Harness 歸因為準。配接器不再維護 DeepSeek 專用 payload 重寫或提供方協議矩陣。

pi-ai 的通用流選項不支持停止序列。若 Harness `stop` 選項已定義，`dsh-llm-pi-ai` 會以 `UNSUPPORTED_OPTION` 拒絕請求，不會靜默忽略，也不會增加第二套提供方專用 payload 實作。`dsh-llm-deepseek` 繼續透過原生請求序列化器支持 `stop`。

### 已記錄的助手路由與重播狀態

助手訊息攜帶請求的 `provider` 和 `model`，以及選填的 JSON 可序列化配接器重播狀態。成功的 `assistant/message` 工作階段事件記錄這些欄位，`deriveMessages()` 返回助手訊息時也會包含它們。使用者、系統、上下文與工具結果訊息不攜帶助手路由欄位。提供方/模型欄位是 agent loop 的權威資料；配接器僅擁有其不透明重播狀態 payload。

成功的終止 `finish` 區塊可以攜帶回放狀態，`BlockAssembler` 會將其與 token 用量和結束原因一起保留。agent loop 會把該狀態附加到已組裝助手訊息的模型來源中，但不公開回應改寫掛鉤。錯誤或中止回應不會生成正常助手訊息，因此不會進入後續模型歷史。

pi-ai 重播狀態是其成功 `AssistantMessage` 的帶版本最小投影，包含源 API/提供方/模型、回應 ID/模型、停止原因，以及按索引對齊的文字簽名、thinking 簽名和工具呼叫簽名。它不會重複 Harness 內容區塊中已有的文字或工具參數，也不包含診斷資訊、時間戳、用量或錯誤。後續請求中，只有歷史提供方和目標提供方當前歸同一個配接器實例所有時，`LlmRuntime` 才會把重播狀態交給目標配接器。配接器在能夠復原歷史回應時，將 Harness 記錄的內容與重播狀態組合，並負責所需的跨模型或跨提供方轉換。配接器收到未知版本或塊形狀不匹配的重播狀態時會顯式失敗；其他配接器只能收到提供方無關的內容以及提供方/模型欄位。

該狀態屬於模型可見的重播輸入，因此遵循現有的[請求可重建規則](2026-07-05-reconstructable-requests.md)：它同時存在於終止 `finish` 區塊和驅動程式派生的已組裝 `assistant/message` 模型來源中。復原和 fork 會原樣保留該狀態。壓縮（compaction）遮蔽助手訊息時，也會從活動 surface 中移除其重播狀態；摘要屬於普通的提供方無關內容。

### 在所有請求生產方中傳播目標

每條模型選擇路徑都同時攜帶 provider 與 model：聲明式 agent、ACP（Agent Client Protocol）和 stdio 應用設定、JSON-RPC initialize 請求、subagent 覆蓋與繼承、工作流程子 agent 覆蓋，以及直接壓縮摘要。subagent 先從父 agent 繼承兩個欄位，再應用請求覆蓋。系統提示詞變數集合在 `model` 之外增加 `provider`。

壓縮設定在 `summarizationModel` 之外增加 `summarizationProvider`。兩個值均為空時繼承，均非空時選擇顯式目標；只設定其中一個會導致載入失敗。繼承優先使用最近一次記錄的請求目標，沒有時回退到 agent 建立選項。`compaction/summary` 使用現有模型呼叫 envelope 記錄兩個欄位。

JSON-RPC 執行時期顯式接收提供方與模型。僅當 `deepseek` 提供方沒有註冊所有者時，其便利回退才會掛載 `dsh-llm-deepseek`；其他缺失的提供方會直接失敗，不會猜測配接器。

磁碟工作階段格式仍使用預發布階段固定的版本 `0`，且不承諾相容性。seed/load 驗證會拒絕省略必需提供方/模型欄位的請求標頭和助手訊息，不會接受已無法重建請求的舊格式。

## 考慮過的替代方案

**繼續以模型名稱作為登錄檔鍵，並增加通配配接器。** 通配機制會在精確註冊與兜底外掛程式之間引入回退順序，使重複所有權取決於監聽器順序；若不再增加其他約定，仍無法區分不同提供方中相同的模型 ID。

**將提供方與模型編碼到一個字串中。** OpenRouter 的 `openai/gpt-*` 等值已經包含類似提供方的前綴和斜槓。分隔符約定會把路由文法洩漏到每個模型選擇器，並需要轉義規則；兩個顯式欄位更清晰，也可以分別記錄日誌。

**增加 `backend + provider + model`。** backend 鍵可以讓 `dsh-llm-deepseek` 與 pi-ai 的 DeepSeek 實作共存，並按請求切換。最終採用的部署規則是一個提供方對應一個配接器所有者：同一上游的不同實作屬於由外掛程式組合選定的替代項。第三個路由維度會增加每個請求與設定的負擔，卻沒有當前消費端。

**讓 `dsh-llm-pi-ai` 自動註冊所有 pi-ai 提供方。** 這種方式會佔用部署無意暴露的環境憑據和提供方名稱，並與 `dsh-llm-deepseek` 等原生配接器衝突。顯式設定可以審查能力和憑據範圍。

**每個提供方掛載一個 pi-ai 外掛程式實例。** 獨立實例可以隔離設定，但會重複外掛程式聲明，也無法實作設定註冊的原子性。每個請求本就向同一個配接器提供提供方，因此經過驗證的設定對映具有更小的生命週期介面。

**接受任意內聯 pi-ai 模型描述符。** 這種方式可支持目錄外的私有模型 ID，但會將 pi-ai 的模型與相容性 schema 暴露為 Harness 設定，並要求配接器驗證協議專用組合。當前版本透過覆蓋目錄模型的 `baseURL` 支持自訂端點；只有實際出現目錄外部署需求後，才會另行決策是否支持自訂描述符。

## 影響

- 提供方名稱是部署範圍內的路由所有權鍵：兩個提供方可以使用相同的模型字串，但為同一個提供方掛載兩個配接器會在載入時失敗，不會形成回退順序。
- 模型選擇不再改變 Cordis 外掛程式圖。目錄型配接器可以接受啟動後選擇的任意已安裝目錄模型，原生 DeepSeek 配接器則會轉發任意 DeepSeek 模型 ID。
- 自訂 `baseURL` 會保留所選目錄模型的協議與能力，但不會讓目錄外模型 ID 變為有效。私有端點必須實作該目錄項對應的協議。
- pi-ai 憑據、傳輸選項、SDK 逾時，以及默認五分鐘的 `streamIdleTimeoutMs` 空閒逾時機制均按提供方設定隔離。系統停用隱藏的提供方重試；有界重試由單獨組合的 agent 復原策略負責。
- pi-ai 的通用流 API 無法表達停止序列，因此 `dsh-llm-pi-ai` 會拒絕停止序列；原生 DeepSeek 配接器仍支持停止序列。
- 僅當歷史提供方與目標提供方歸同一個配接器實例所有時，重播狀態纔可移植。配接器負責跨提供方和跨模型復原；其他配接器只接收不含不透明狀態的提供方無關歷史。
- 當前預發布工作階段 JSONL 要求請求標頭和助手訊息都包含提供方/模型。舊格式仍使用版本 `0`，但會被拒絕，不執行遷移。

## 測試

- 單元測試覆蓋登錄檔衝突、請求重建、工作階段驗證、設定解析、單次請求的選項轉發、包括 OpenAI Responses 在內的原生 API 選擇、轉換、重播驗證、錯誤對映、呼叫方取消、空閒逾時導致的傳輸終止、內容重寫，以及同一實例與不同實例間的重播分發。
- 無金鑰的 agent loop/工作階段測試和 ACP 快照覆蓋持久化提供方/模型元資料、復原與 fork 傳播、工作流程/subagent 覆蓋，以及不變的使用者可見 transcript（文字記錄）；金鑰門控的 DeepSeek e2e 測試保留真實提供方的流式輸出與工具後續呼叫覆蓋率。
- 公共 JSDoc、package README、架構與子系統文件、生成目錄、示例、工作階段 fixture（測試前置資料）和 Python SDK 配對文件統一使用提供方/模型目標，並由倉庫文件與類型等價閘門校驗。

## 風險

這是一次覆蓋全倉庫的預發布 API 破壞性變更：僅模型的請求構造、配接器註冊、應用協議、fixture，以及持久化版本 0 事件格式會同時變化，不提供相容別名。提供方排他規則有意禁止同一上游的兩個實作共存於同一上下文。pi-ai 相依性升級可能改變可接受的提供方/模型目錄，因此鎖定檔與配接器 e2e 矩陣定義已驗證集合。自訂 `baseURL` 端點會繼承所選目錄模型的協議假設，無法修復不相容的代理。目錄外模型描述符與多模態內容仍不受支持。pi-ai 重播狀態可能包含不透明的加密推理簽名；提供方需要該資訊維持連續性，因此係統會持久化該狀態，但不會在現有工作階段記錄之外渲染或記錄它。
