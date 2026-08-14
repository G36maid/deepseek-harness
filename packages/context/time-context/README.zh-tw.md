# @deepseek-ai/dsh-time-context

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

選填的持久上下文，包含當前帶時區時間、附加到當前開放請求的瀏覽器時區，以及在模型請求準備期間取樣的經過時長。預設組合不啟用它；Schedule Web overlay 會掛載它，使模型可以按使用者的瀏覽器時區解釋未明確限定時區的日期和時間。決策記錄：[持久 time-context Agent Note](../../../.agents/notes/implemented/feature/2026-07-16-durable-per-step-time-context.md)。

## 設定

```yaml
- id: time-context
  name: '@deepseek-ai/dsh-time-context'
  config:
    timeZone: Asia/Shanghai  # optional fallback when the request has no unique browser zone
    refreshIntervalMs: 60000 # optional; omit or set to 0 for every eligible attempt
```

當當前開放輪次只包含一個經 Host 校驗的瀏覽器時區時，使用該請求本機時區格式化時間戳。瀏覽器來源資訊缺失或混雜時，`timeZone` 提供顯示回退；省略它則會在外掛程式載入時解析一次 Node 行程時區。Node 遵循 `TZ`，每個顯式回退值都經 `Intl.DateTimeFormat` 校驗。

`refreshIntervalMs` 必須是非負安全整數。省略或設為 `0` 時，會為每個訊號尚未中止且將進入步驟的合格 pre-step 新增上下文。正數值只會在工作階段沒有更早的 time-context 注入、掛鐘時間倒退，或自最新注入起已經過至少相應毫秒數時新增上下文。

## 請求時區歸屬

瀏覽器會為每條提示詞取樣 `Intl.DateTimeFormat().resolvedOptions().timeZone`。Host 校驗並規範化該值，再將其綁定到確切的持久 `user-rpc` 訊息來源。Time-context 只檢查當前開放輪次中的這些來源：唯一一個時區可解析請求，多個時區記為 `mixed`，沒有時區則記為 `unavailable`。它不會讀取或修改工作階段標頭、連線狀態或 Schedule 記錄。

解析後的指令告訴模型，把未明確限定時區的日期和時間解釋為該瀏覽器時區。來源資訊為 mixed 或 unavailable 時，模型會收到要求使用者澄清的指令。這是自然語言上下文，並非另一個包邊界上的輸入預設值：接受本機日曆欄位的工具仍自行負責其顯式時區要求。

## 時序語義

該外掛程式會前置一個 `agent/pre-step` 監聽器，並先行委託下游。需要注入且下游決策進入步驟時，它會向返回批次追加一條帶來源的 `UserMessage`。AgentLoop 在 `step/start` 之後、請求派生之前記錄最終批次。決策被拒絕、監聽器失敗或訊號已經中止時，不會記錄任何內容。

每個讀數都使用確切的快照來源 `{ kind: 'plugin', plugin: 'time-context', form: 'snapshot', sections: [{ name: 'time-context', text: <same text> }] }`。`./invariant` 配套模組會校驗該形狀，根據原始 `user-rpc` 訊息重新派生當前輪次的瀏覽器策略，並檢查時間戳時區與經過時長基線。

正數間隔調度會掃描原始持久工作階段事件，尋找最新一條歸因於外掛程式的訊息，其中包括已被壓縮（compaction）遮蔽的讀數。因此，它無需行程本機快取也能在復原後繼續生效。正數間隔可以有意讓後續請求複用現有歷史，而不新增新讀數；Schedule Web overlay 會省略該間隔。

第 1 步從最新一條在其之前持久化的使用者、助手或工具結果訊息起測量。為該步驟擬議的提示詞尚未追加。後續步驟從同一輪次中前一個 time-context 事件起測量。缺少基線時報告 `unavailable`，掛鐘時間倒退時將經過時長限制為零。

讀數記錄的是已進入的步驟，不是已完成或已傳輸的請求。後續準備失敗時，該讀數可能留在歷史中。訊息會保留在派生工作階段歷史中，直到壓縮將其遮蔽；`request/header` 不含 time-context 狀態，請求重建會使用每個 `step/start` 之後的完整持久表層前綴。

## 模型體驗

### 準備期時間上下文

#### 模型看到的內容

每條注入訊息包含三行。`<timestamp>` 是帶數字偏移和 IANA 時區、形如 ISO 的時間戳；持續時間使用緊湊的整秒單位。

##### 第一步

```markdown
Time sampled while preparing turn <turn>, step 1: <timestamp>
Browser time zone for this request: <iana-zone-or-mixed-or-unavailable-policy>.
Elapsed since the preceding model-visible message: <duration-or-unavailable>.
```

##### 後續步驟

```markdown
Time sampled while preparing turn <turn>, step <step>: <timestamp>
Browser time zone for this request: <iana-zone-or-mixed-or-unavailable-policy>.
Elapsed since the preceding step context: <duration-or-unavailable>.
```

#### Token 影響

每個讀數都會累積，直到壓縮將其遮蔽。正數間隔會減少新增讀數；省略或設為 `0` 時，每次合格的準備嘗試都會新增一條。

#### KV Cache 影響

僅附加；新可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **僅限提示詞來源資訊**：瀏覽器時區上下文用於指導自然語言解釋，但不會悄然填入另一工具所要求的時區欄位。
- **混合輪次會詢問**：如果同一個開放輪次包含來自不同瀏覽器時區的提示詞，模型會收到要求澄清的指令，而不會猜測哪個時區擁有未限定的時間。
- **回退值不代表使用者權威**：瀏覽器來源資訊缺失或混雜時，設定或行程時區用於格式化時鐘，但面向模型的策略仍要求澄清。
- **整秒顯示**：時間戳與持續時間省略亞秒精度，儘管持久事件時間保留毫秒。
- **壓縮之間的歷史成本**：省略或設為 `0` 時，每次合格嘗試都會保留一條讀數；正數間隔可以降低但無法消除該成本，也可能使後續請求缺少新鮮的瀏覽器時區指導。
