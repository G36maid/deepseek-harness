# `@deepseek-ai/dsh-llm-retry`

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

一個函式外掛程式，透過 agent loop（代理循環）在已關閉步驟上觸發的 `agent/request-error` waterfall（瀑布式事件）應用確切提供方重試策略。它不包裝 `ctx.llm.stream()`：每次配接器呼叫仍是一次提供方嘗試，每次重試都會開啟新的編號輪次。

每個提供方配接器都擁有選填的巢狀 `retryPolicy`；路由在 `ctx.llm` 上註冊時會捕獲該策略，任何到達該註冊最終配接器邊界的呼叫都會攜帶它。如果之後釋放或替換路由，進行中的失敗仍會保留當時為其提供服務的策略；在選中任何最終配接器前發生的失敗沒有提供方策略，會繼續委託。省略策略時使用 normal mode：為 `EMPTY_RESPONSE`、`RATE_LIMIT`、`SERVER`、`TIMEOUT` 和 `TRANSPORT` 重試兩次，並採用從 500 ms 到 10 秒的有界指數退避與 10% jitter。`EMPTY_RESPONSE` 是配接器對未產生任何持久內容的退化提供方完成所作的分類，因此可安全重複。normal 策略可以更改其有限預算、符合條件的 code 和退避設定。always mode 會先請求下游復原，再無次數上限地重試每個模型請求失敗；成功、取消或外掛程式 dispose（資源釋放）會在活躍的委託復原完全靜止後終止它。

兩種 mode 都使用帶對稱 jitter 的有界指數退避。有效 `providerRetryAfterMs` 不超過 `maxDelayMs` 時會替換本機退避，並且不加 jitter。超出上限的提供方延遲會使 normal mode 繼續委託；always mode 則改用已設定的本機退避，避免該指令終止重試。

等待前，外掛程式會追加一條不進入表層的 `llm/retry` 事件，其中包含共享 `retryId`、提供方、mode、已解析策略的規範 key、失敗和計畫延遲。該載荷由可安全用於瀏覽器的 `@deepseek-ai/dsh-llm-retry/types` 子路徑匯出，因此遠端渲染器無需載入策略執行時期即可使用該持久狀態。該 key 包含所有影響行為的欄位，並對 normal mode 的 code 排序，因為合格性採用集合成員關係判斷。只有提供方與完整策略 key 都相同的事件才會延續重試編號；因此，用限制、code 成員關係或退避不同的路由替換後，會開始自己的歷史。normal 事件包含有限上限；always 事件省略該上限，UI 會渲染 `∞`。等待完成時，外掛程式會在返回 `{ kind: 'retry' }` 前立即追加 `llm/retry-started`，其中帶有相同的 `retryId`、輪次、步驟與重試編號；退避期間取消則不會寫入 started 事件。隨後迴圈關閉失敗輪次，並在同一持久歷史上開啟重試輪次。取消與外掛程式 dispose 會中止活躍退避，在應用中止前等待活躍的委託復原結帳，並使 dispose 前捕獲的 callback 只能以失敗結束。

單獨發布的 `./invariant` 配套模組會檢查每個已調度重試是否指向當前開啟輪次及其最新已關閉步驟，是否與失敗請求的持久提供方匹配，是否攜帶非空的提供方與策略標識，是否滿足 mode 特定邊界，是否擁有唯一步驟記錄和正確的提供方策略重試編號，以及是否攜帶有界定時器延遲。它還要求每個 `llm/retry-started` 事件透過相同的 `retryId`、輪次、步驟與重試編號指向一個先前調度的嘗試，並拒絕重複的 started 事件。full jitter 可以在下界調度為零毫秒。

```yaml
- name: '@deepseek-ai/dsh-llm-deepseek'
  config:
    apiKeyEnv: DEEPSEEK_API_KEY
    retryPolicy:
      mode: always
      backoff:
        initialDelayMs: 1000
        maxDelayMs: 30000
        jitterRatio: 0.2

- name: '@deepseek-ai/dsh-llm-retry'
```

執行器沒有策略設定。`dsh-llm-pi-ai` 等多提供方配接器會把 `retryPolicy` 放在每個提供方 profile 內，避免維護第二份提供方名稱清單。

## 模型體驗

### 模型請求復原

#### 模型看到的內容

模型不會看到重試事件、延遲、提供方錯誤或失敗的部分輸出。重試輪次會從持久表層歷史中重建相同的顯式提供方／模型請求，除非下游復原策略有意更改該表層；失敗區塊絕不會進入派生訊息。

#### Token 影響

每次重試都是新的提供方請求，可能重複計費輸入 token。normal mode 具有有限預算；always mode 可以在成功或取消前消耗無界數量的請求。`llm/retry` 自身不產生 token。

#### KV Cache 影響

重建請求保留之前的前綴，並可根據該提供方的規則複用 cache。非表層重試事件不會改變 cache 身份。

## 已知限制與暫緩事項

- **agent 輪次是唯一重試邊界**：直接 `ctx.llm.stream()` 消費端仍只嘗試一次，因為原始流無法持久地區分各次嘗試已經寄出的區塊。
- **always mode 會重試永久性失敗**：身分驗證、配額、無效請求、協議和無法復原的上下文錯誤都會繼續重試，直至成功、取消或 dispose；部署負責提供方特定的成本與延遲控制。
- **有限外掛程式預算可疊加**：normal mode 只統計已設定 code 和確切提供方策略，上下文溢位壓縮（compaction）則擁有獨立預算。任何重疊策略都必須定義註冊順序行為。
- **復原策略按 waterfall 順序組合**：always mode 會先接受下游重試，再應用自己的回退。後續策略如果忽略取消且永不結帳，也會阻止回退、輪次完全靜止和外掛程式 dispose 完成。
- **`llm/retry` 記錄調度，不是完成**：後續步驟與輪次事件用於確立成功、耗盡或取消。
