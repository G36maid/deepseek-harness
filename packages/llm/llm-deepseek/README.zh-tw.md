# @deepseek-ai/dsh-llm-deepseek

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

harness LLM（大型語言模型）seam 的 DeepSeek chat-completions 配接器：直接 `fetch` + SSE（Server-Sent Events，由 `eventsource-parser` 分幀），將官方協定格式（wire format；真源：API 文件 guides/thinking_mode、guides/tool_calls、api/create-chat-completion）轉換為 `StreamChunk` 協議。

同一 seam 的第二個基於庫的實作位於 `@deepseek-ai/dsh-llm-pi-ai`。本包擁有 `deepseek-official` 提供方路由——刻意區別於 pi-ai 的 catalog 名稱 `deepseek`，因此同一組合可以並排掛載兩條 DeepSeek 路徑；而為 `deepseek-official` 本身註冊另一個配接器仍會拋出 `LlmError('DUPLICATE_ADAPTER')`。

包根入口匯出 Cordis 外掛程式約定與 `DeepSeekAdapter`；協議序列化、SSE 解析與區塊轉換 helper 不屬於該根約定。

## 設定

```yaml
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek'
  config:
    apiKeyEnv: DEEPSEEK_API_KEY  # default; resolved per request via ctx.credentials, then the environment
    baseURL: https://api.deepseek.com # optional; $DEEPSEEK_BASE_URL then the public API when omitted
    thinking: enabled        # optional; provider default is enabled
    reasoningEffort: high    # optional; off | high | max — omitted ⇒ high
    maxTokens: 256000        # optional positive per-request output cap; this is the default
    streamIdleTimeoutMs: 300000 # optional; positive finite Node timer delay; five-minute default
    retryPolicy:             # optional; omission uses bounded normal defaults
      mode: always           # normal | always
      backoff:
        initialDelayMs: 500
        maxDelayMs: 10000
        jitterRatio: 0.1
    defaultContextWindow: 1000000 # optional positive-integer fallback; this is the default
    models:                  # optional; defaults to V4 Flash and V4 Pro
      - id: deepseek-v4-flash
        name: DeepSeek-V4-Flash
      - id: private-reasoner
        description: Company-hosted reasoning model
        contextWindow: 512000
```

該外掛程式註冊唯一提供方路由 `deepseek-official`，同時註冊解析後的 `retryPolicy`。請求使用 `provider: deepseek-official` 選擇該路由；其 `model` 會作為協議 `model` 字串原樣傳遞，因此更改 DeepSeek 模型不需要生命週期時註冊。省略 `models` 會公佈 `deepseek-v4-flash`（名稱為 `DeepSeek-V4-Flash`）和 `deepseek-v4-pro`（名稱為 `DeepSeek-V4-Pro`），兩者的上下文視窗均為 1,000,000 token；顯式清單會替換這些預設值，`models: []` 則不公佈任何模型。Catalog 設定項透過 `ctx.llm.listModels('deepseek-official')` 公開給 ACP（Agent Client Protocol）編輯器和 Web 選擇器等用戶端，但仍只提供建議：未列出模型 id 仍原樣傳遞。省略設定項 name 預設為其 id。

`contextWindow` 對每個已設定模型都選填，不會透過建議 catalog 公開。`ctx.llm.resolveModelInfo('deepseek-official', model).context` 先返回精確模型值，再對不含容量的設定項或未列出原樣傳遞 id 返回 `defaultContextWindow`。配接器預設值為 1,000,000；因此，壓力敏感外掛程式可以獲得由部署決定的容量，不會將模型 selector 視為權威。為 `deepseek-official` 註冊另一個配接器會拋出 `LlmError('DUPLICATE_ADAPTER')`。

`maxTokens` 是配接器為對話請求設定的輸出上限，預設值為 256,000。Catalog 設定項可以自帶 `maxTokens`，它對該模型勝出；不含該上限的設定項以及任何未列出原樣傳遞 id 都解析為 profile 值，因此新增按模型的上限只改變一個模型，而非整條路由。確切模型解析會將勝出值公開為 `defaultMaxTokens`；`LlmRuntime` 會在 agent loop（代理循環）寫入 `request/header` 前，將該值填入 `GenerateOptions.maxTokens`，從而仍可根據持久記錄重建協議請求。顯式的請求值或 `AgentOptions.maxTokens` 值優先，並會序列化為 `max_tokens`。配接器不會根據 `contextWindow` 自動調低該請求預算；上下文或提供方輸出上限較小的部署必須設定與其相容的 `maxTokens`。

同一確切模型結果會在部署策略允許思考時，為每個原樣傳遞模型在 `reasoning` 下公開有序的 `off`、`high` 和 `max` 推理（reasoning）強度。`reasoningEffort` 選擇部署預設值，省略時回退為 `high`。`agent/request` 可以在每個工作階段步驟替換它；解析後的值會記錄在 `request/header`。`high` 和 `max` 會啟用思考，並序列化為官方頂層 `reasoning_effort`；配接器持有的 `off` 則序列化為 `thinking.type: disabled`，且省略 `reasoning_effort`。不支持的值會在網路 I/O 前以 `UNSUPPORTED_REASONING_EFFORT` 失敗。

`thinking: disabled` 是部署鎖定：它只公佈 `off`，並以 `off` 為預設值。省略 `reasoningEffort` 或將其設定為 `off` 均有效；設定 `high` 或 `max` 會使外掛程式載入失敗，直接按請求啟用思考也會在網路 I/O 前失敗。攜帶 `GenerateOptions.purpose: 'session-title'` 的請求也會強制停用思考並省略已解析的推理強度，將有界輸出保留給可見標題文字，不改變工作階段或壓縮（compaction）預設值。

`streamIdleTimeoutMs` 會限制每次未完成提供方讀取，包括初始 `fetch`，但不計入消費端在區塊間花費的時間。DeepSeek SSE 註釋會作為傳輸活動使尚未完成的讀取重新佈防，但絕不會成為 `StreamChunk` 值或工作階段日誌事件。同一個穩定的 abort 訊號會在整個呼叫期間傳遞給請求與 body reader；過期會停止傳輸並拋出 `LlmError('TIMEOUT')`，較早的呼叫方 abort 則拋出 `LlmError('ABORTED')`。配接器每次 `stream()` 呼叫恰好發起一次提供方請求；它把已設定策略註冊為提供方元資料，再由 `dsh-llm-retry` 在持久化的 agent（代理）步驟邊界單獨執行該策略。

## 動態設定（settings + credentials）

連線事實不在載入時凍結。`resolveAdapterOptions` 是從原始設定到已校驗事實的唯一顯式 resolve 步驟，配接器經由一個 thunk **每操作重讀一次**：base URL、catalog、請求預設值與 idle 預算都在下一次請求生效，進行中的流則保持其起始事實。兩個選填 seam 供給該 thunk：

- **`ctx.settings`**——外掛程式用同一份 `Config` schema 註冊 `llm-deepseek` namespace，並以其 `cordis.yml` 條目為組合 `base`，因此使用者設定文件中的 `llm-deepseek:` 分節可以免重新啟動覆蓋任何欄位。未掛載 settings 服務時，僅由 entry 設定驅動程式配接器，行為不變。存活 settings 快照若透過 schema 卻違反 schema 之外的約束（重複的 catalog id、無法成立的 thinking／推理強度組合），則保留最後可用事實並記錄失敗；entry 設定本身仍會使外掛程式載入失敗。
- **`ctx.credentials`**——API 金鑰按每次 stream 呼叫解析，取自與端點*同一*份解析後的快照。設定只攜帶 `apiKeyEnv`，從不攜帶字面金鑰：該引用經憑據 seam 解析，未掛載 seam 時則經受信環境層解析。由於憑據事實與連線事實同行，被 resolver 拒絕的 settings 快照既不貢獻自己的端點，也不貢獻自己的金鑰：整個先前世代繼續服務。每個解析出的金鑰在使用前都會被校驗格式，因此 HTTP 標頭無法承載的值會以 `LlmError('INVALID_CREDENTIAL')` 被拒絕，點名失敗的入口，但絕不透露金鑰的任何部分，而不是以語義不明的 `fetch` `TypeError` 形式浮現。任何地方都沒有金鑰的請求以 `MISSING_CREDENTIAL` 失敗，並點名每個設定入口，同時路由保持註冊、catalog 保持可瀏覽——首次執行的上手流程就是「瀏覽模型、存入金鑰、再次發起提示」，中間無需任何重新啟動。

唯一在註冊期捕獲的事實是重試策略：其解析值變化時，外掛程式原地重新註冊該路由（同一配接器實例、一個同步區段），因此 `ctx.llm.providerRetryPolicy('deepseek-official')` 始終報告當前策略。

該外掛程式還會在可設定提供方目錄（`ctx.llm.listConfigurableProviders()`）中聲明自己的路由：提供方為 `deepseek-official`，settings namespace 為 `llm-deepseek`，settings path 為空——整個分節就是 profile。設定介面藉助該條目，把本配接器與休眠的 pi-ai 提供方一並呈現。

## 應用歸因

每個請求都攜帶 dsh-llm `attributionHeaders()` 的共享歸因標頭，即用於識別 harness 的必需 `User-Agent` 基線（見 [dsh-llm § 應用歸因](../llm/README.md#app-attribution-attributionts)）。在該配接器約定（adapter contract）下，直接 DeepSeek 請求與 OpenAI 相容 gateway 請求都不會獲得提供方特定應用歸因標頭；OpenRouter 應用歸因暫緩到未來的顯式 OpenRouter 配接器或模式。`GenerateOptions.purpose` 為 `compaction` 的請求（dsh-compaction-basic 的輔助摘要呼叫）還會攜帶 `x-deepseek-harness-compact: 1`，讓宿主可以將壓縮流量與工作階段請求分開。

DeepSeek 請求身份獨立於應用歸因。憑據解析成功後，每個提供方請求都會透過 `x-deepseek-harness-user-id` 攜帶來自 [`@deepseek-ai/dsh-anonymous-user-id`](../../identity/anonymous-user-id/README.md) 的穩定匿名 id；攜帶 `GenerateOptions.sessionId` 的請求還會透過 `x-deepseek-harness-session-id` 傳送該確切值，缺少工作階段的直接呼叫則省略工作階段標頭。兩個標頭都會發送至解析後的 `baseURL`（包括已設定的 gateway），且不會進入請求正文或模型可見內容。

## 協定格式說明

- 只支持流式輸出（`stream_options.include_usage` 始終開啟）。`usage` 可能附著在 finish 區塊上，也可能作為尾隨的純 usage 區塊到達；轉接器會將兩者都延遲到 `[DONE]`，因此 `usage` 始終位於 `finish` 之前，`finish` 之後不會出現任何內容。
- 配接器持有的 `off` 推理強度對映為 `thinking: {type: 'disabled'}`，絕不會以 `reasoning_effort: 'off'` 透過協議傳送。
- 第一個思考模式區塊攜帶 `reasoning_content: ""`，系統會處理它（不會產生多餘 reasoning 塊）。
- **推理回傳規則**：對攜帶工具呼叫的 assistant 輪次，會將 `reasoning_content` 序列化回歷史（思考模式 API 必需）；對不含工具呼叫的輪次，它會被丟棄（不會使用，可節省 token）。
- Cache 計量：`cacheReadTokens` ← `prompt_cache_hit_tokens` / `prompt_tokens_details.cached_tokens`；DeepSeek 不報告 cache-write 指標。

## 錯誤

非 2xx 回應會拋出穩定 code 的 `LlmError`：`AUTH`（401/403）、`QUOTA`（提供方詳細資訊標識配額、餘額或點數耗盡的回應）、`RATE_LIMIT`（其他 429）、`CONTEXT_WINDOW_EXCEEDED`（提供方 code、type 或 message 標識上下文溢位的 400）、`INVALID_REQUEST`（其他 400）、`SERVER`（5xx），其他情況為 `HTTP_<status>`。其可序列化 `failure` 保留 HTTP 狀態，以及有效的正 `Retry-After` 秒數／日期延遲和存在時的 `x-request-id` / `x-deepseek-request-id`。回應前傳輸失敗（DNS、連線被拒絕、TLS、proxy）會拋出命名已設定端點的 `TRANSPORT`，並將原始拒絕作為 `cause`；呼叫方 abort 拋出 `ABORTED`，仍以 loop 的取消訊號為準。協議違例拋出 `STREAM_CLOSED`（沒有 `[DONE]`）或 `MALFORMED_RESPONSE`（JSON payload 格式錯誤）。未知協議 `finish_reason`（例如 `content_filter`、`insufficient_system_resource`）會變為 `finish {kind: 'error', failure}` 區塊；已完成流如果使用 `stop`（或缺失）finish 但沒有開啟內容區塊，就會變為 `finish {kind: 'error'}`，code 為 `EMPTY_RESPONSE`（默認策略會重試）。

## 模型體驗

### DeepSeek 請求

#### 模型看到的內容

所選 DeepSeek 模型會收到 harness 系統提示詞、訊息歷史、工具 schema、stop sequence 和呼叫設定，不含配接器撰寫的提示詞文字。當之前的 assistant 輪次包含工具呼叫時，會按要求回傳其推理內容；不含工具呼叫的輪次會省略推理。

#### Token 影響

精確輸入取決於提供方 tokenization。有條件推理回傳會增加工具往返上下文，丟棄其他推理則避免再次付款這些 token；可用時會報告 cache-read 用量。

#### KV Cache 影響

未更改的已組裝前綴可使用 DeepSeek cache 複用，配接器會在 usage 中報告它。模型路由變更，或任何上游提示詞、schema、前綴或歷史變更，都可能使從首個發生變化的 token 起的複用失效；推理回傳會在工具往返期間追加。

### DeepSeek 回應

#### 模型看到的內容

推理、文字與原始字串工具參數會轉換為 harness 區塊，供 loop 記錄和組裝。

#### Token 影響

生成 token 遵循請求中已記錄的推理強度和 `maxTokens`；只有 loop 保留的塊會影響後續輸入。

#### KV Cache 影響

loop 保留的回應塊會追加到下一個請求，並保留其較早可複用前綴；已丟棄塊不會影響後續 cache。更改提供方或模型會選擇不同 cache 域。

## 已知限制與暫緩事項

- **settings 的 `models` 清單會整體替換組合清單**：settings 層按欄位合併，而陣列是單個欄位；按條目合併 catalog 需要帶鍵的形狀。
- **未對映 `tool_choice`**：它不屬於核心詞彙（MVP 取捨，與 pi-ai twin 共享）。
- **請求使用原始 `fetch`，而非 `@cordisjs/plugin-http`**：沒有共享 proxy／攔截設定；採用暫緩到第二個配接器需要該功能時（`TODO(http)`）。
- **序列化會將 user 與工具結果內容展平為文字塊**：會跳過外掛程式新增的塊類型，空工具輸出會以字面 `(no output)` 透過協議傳送。
