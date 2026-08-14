# @deepseek-ai/dsh-tool-terminal

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

基於 `ctx.terminals` 提供 6 個面向模型的工具：`terminal_open`、`terminal_send`、`terminal_read`、`terminal_signal`、`terminal_close` 和 `terminal_list`。每項操作都要求提供完全相同的發起 `Agent`，因此即使模型獲知另一個 agent（代理）的 id，也無法操作其終端機。

`terminal_send(run_in_background: true)` 會複用 `ctx.jobs`；任務預檢和 PTY 服務對每個工作階段的獨佔傳送預留都發生在返回 job id 之前。系統透過 `job_output` 收集完成結果，`job_kill` 則向前臺行程組傳送 `SIGINT`。前臺傳送使用終端機呼叫／結果卡片。後臺傳送使用通用執行卡片；打開、讀取、傳送訊號、關閉和列出操作則分別使用通用 `execute`、`read`、`execute`、`delete` 和 `read` 卡片。所有操作都不聲明源位置。

## 設定

| 鍵 | 預設值 | 含義 |
|---|---:|---|
| `enableRunInBackground` | `true` | 公開並接受 `run_in_background`；設為 false 時，schema 會省略該欄位，並拒絕強行傳入未聲明的參數 |
| `maxResultBytes` | `262144` | 每個完整終端機結果或 PTY 任務輸出的 UTF-8 上限（最小值 `64`）；在等待、工作階段、分頁、截斷和任務狀態元資料全部加入後計算 |

兩個值都會在載入時驗證。最小結果上限可保證登錄檔簽發的每個工作階段或 job id 都能出現在建立確認中。結果超過 `maxResultBytes` 時，只要空間允許，渲染會為控制元資料和截斷標記預留空間；截斷會保留 UTF-8 邊界。每個終端機定義的最終內容回呼都會應用同一個上限，涵蓋經過規範化的 pre-execute、around-execute 與 post-execute 策略失敗、拒絕、短路、替換或阻止；結構化的多塊策略結果保留其結構。

## 模型體驗

### 系統提示詞

#### 模型看到的內容

該外掛程式貢獻以下固定指引章節：

##### 終端機指引

```markdown
Use a terminal session only when work needs persistent terminal state or interactive stdin; prefer shell/read/write/edit for bounded one-shot operations. Track every terminal session id and close sessions that no longer matter. An inferred_idle or timeout result does not prove the foreground command exited.
```

#### Token 影響

外掛程式活躍期間，每次請求都會產生少量固定輸入成本。

#### KV Cache 影響

註冊範圍和指引文字不變時，前綴保持穩定。

### 工具 schema

#### 模型看到的內容

6 個生成的 schema 列在 [`dsh-tool-terminal` 目錄章節](../../../docs/tool-catalog.md#deepseek-aidsh-tool-terminal)中。此外掛程式活躍時，請求中會包含它們的固定 schema token；按 agent 範圍過濾工具時可能隱藏這些 schema。

#### Token 影響

工具可見的請求會產生固定的 schema 成本。

#### KV Cache 影響

工具可見性與定義不變時，前綴保持穩定。

### 工具結果與任務上下文

#### 模型看到的內容

spawn 會返回 id 和有界 MOTD。傳送／讀取會返回有界終端機文字以及就緒／歷史標記。後臺模式返回通用 job id。所有終端機自身或策略產生的單文字結果，在經過規範化的工具或管線錯誤、拒絕、短路、替換、阻止與通用任務狀態文字之後，都受 `maxResultBytes` 限制。結構化的多塊策略結果保留其結構。結果會保留在工作階段歷史中直到壓縮（compaction）；增量任務讀取不會重複已經消費的輸出。程式設計呼叫方會收到帶類型的工作階段快照、有界的提供方讀取／傳送 DTO、訊號與關閉結果，或 `{ kind: "background", jobId }`；Native 渲染會應用上述呈現上限。

#### Token 影響

終端機自身與策略產生的單文字結果隨資料變化，並受 `maxResultBytes` 限制；如果策略有意替換為結構化多塊內容，則由該策略負責限制內容。每個返回結果都會保留在歷史中直到壓縮。

#### KV Cache 影響

僅附加；新結果位於可複用請求前綴之後。

## 已知限制與暫緩事項

- 不公開具名按鍵序列、TUI、BEL、調整大小、自動啟動或跨 agent 共享 schema。
- 後臺模式同時相依性 `@deepseek-ai/dsh-jobs` 及其面向模型的控制器。
