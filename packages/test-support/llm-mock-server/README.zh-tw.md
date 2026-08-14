# `@deepseek-ai/dsh-llm-mock-server`

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

可編指令碼的 OpenAI 相容 HTTP／SSE（Server-Sent Events）伺服器，用於在無提供方金鑰的情況下測試真實 LLM（大型語言模型）配接器、agent loop（代理循環）和復原策略。它接受 `POST /chat/completions` 和 `POST /v1/chat/completions`；每個已接受請求按到達順序消費一個已設定行為。無效的請求方法、路徑、Bearer token 和 JSON 不會消費指令碼條目。

庫入口匯出 `startMockLlmServer(options)`、行為類型和遙測（telemetry）類型、默認隨機壓力權重、Node 定時器允許的上限，以及帶有綁定 `baseURL`、自動生成或顯式設定 `randomSeed`、已捕獲請求和冪等 `close()` 的執行控制代碼。關閉會強制終止停滯連線。

## 獨立使用

從本倉庫執行源入口：

```sh
pnpm run mock:llm -- \
  --port 8000 \
  --api-key mock-key \
  --sequence partial_disconnect,success \
  --partial-text "discard this half"
```

將發布的 DeepSeek 配接器指向伺服器；它會將 `/chat/completions` 追加到已設定 base：

```sh
DEEPSEEK_BASE_URL=http://127.0.0.1:8000/v1 \
DEEPSEEK_API_KEY=mock-key \
pnpm dsh --profile headless "test provider recovery"
```

倉庫指令碼將 JSONL 寫入 stdout：`ready` 記錄攜帶以 `/v1` 結尾的基礎 URL 和隨機種子，後續請求/結果記錄同時命名指令碼行為和實際選中的具體行為。這個私有支持包不公開可安裝的二進位命令。

## 行為指令碼

`--sequence` 是逗號分隔的 FIFO。耗盡時返回結構化 HTTP 500；`--repeat-last` 顯式重用最後一項。

| 行為 | 協議結果 |
|---|---|
| `connection_reset` | 在傳送 HTTP 標頭前銷毀 socket |
| `stream_disconnect` | 傳送 SSE 標頭，然後在第一個事件前重設連線 |
| `partial_disconnect` | 傳送文字增量，然後重設 socket |
| `stall` | 傳送 SSE header，並保持空閒，直到用戶端／伺服器取消 |
| `empty` | 傳送有效的無內容 stop 和 `[DONE]` |
| `empty_body` / `stream_eof` / `partial_eof` | 正常結束，但缺少必需的 `[DONE]` 邊界 |
| `malformed_json` / `malformed_event` | 傳送無效 SSE JSON 或無效提供方區塊形態 |
| `rate_limit` / `server_error` / `service_unavailable` | 返回面向重試的 429/500/503 JSON 錯誤 |
| `auth_error` / `invalid_request` / `context_overflow` / `quota_exceeded` | 返回終止性錯誤或需要單獨復原的提供方錯誤 |
| `success` / `slow_success` / `reasoning_success` | 流式傳送完整文字回應，選填延遲或先發送 reasoning |
| `tool_call_success` / `max_tokens` | 以工具呼叫或結束原因 `length` 完成 |
| `wrong_content_type` | 以 `application/json` 內容類型傳送有效 SSE 正文 |
| `random` | 按帶權重的種子隨機選擇具體請求行為 |

`connection_refused` 只能在 CLI 中使用，且必須是第一個條目。它會延遲綁定呼叫方指定的非零埠，因此 `--listen-delay-ms` 期間的請求會收到真實 TCP 拒絕；其餘條目在 listener 啟動後開始。

## 隨機模式

使用重複 `random` 條目執行開放式混合執行：

```sh
pnpm run mock:llm -- \
  --port 8000 \
  --sequence random \
  --repeat-last \
  --seed 42 \
  --random-weights 'success=60,slow_success=10,connection_reset=5,stream_disconnect=5,partial_disconnect=10,empty=5,server_error=5'
```

省略 `--seed` 會生成種子，並在 `ready` 記錄中列印。`--random-weights` 接受非負的相對 `behavior=weight` 條目，並要求至少一個正權重具體行為。匯出預設值是一個成功佔主導的壓力分佈，包含 reset、disconnect、部分輸出、空完成、stall、429/5xx、乾淨截斷和格式錯誤的 JSON；它用於施加測試壓力，而非估計生產事故頻率。`connection_refused` 被排除，因為已綁定的請求處理器無法產生真實拒絕。

隨機權重包含 `stall` 時，為待測用戶端設定較短的流空閒逾時，使場景及時結束。

## 時序與內容控制

CLI 公開 `--success-text`、`--partial-text`、`--reasoning-text`、`--chunk-size`、`--chunk-delay-ms`、`--disconnect-delay-ms`、`--retry-after-ms`、`--request-id`、`--tool-name` 和 `--tool-arguments`。毫秒延遲是 Node timer 範圍內的有界整數；`retryAfterMs` 還必須為正數。庫接受相同的 camel-case 選項。選填的 `apiKey` 會精確驗證 `Authorization: Bearer <token>`；省略時接受任何 token。

## 模型體驗

無。該測試伺服器替代提供方協議行為，而不呼叫真實模型。

#### KV Cache 影響

無；請求在本機終止，絕不會到達提供方快取。

## 已知限制與暫緩事項

- **隨機權重建模測試壓力，而非生產事故頻率**：需要環境專用分佈的呼叫方必須提供已測量權重，並記錄寄出的種子。
- **請求指令碼按到達順序執行**：並行呼叫方共享一個遊標，因此確定性的每工作階段故障分配需要獨立伺服器實例。
- **真實連線拒絕發生在監聽器生命週期階段**：CLI 延遲必須與用戶端嘗試重疊；請求級隨機選擇只能重設已接受的連線。
