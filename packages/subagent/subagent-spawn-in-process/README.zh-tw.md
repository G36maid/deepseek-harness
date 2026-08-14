# @deepseek-ai/dsh-subagent-spawn-in-process

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

spawn 提供方會在當前行程中建立一個全新的子 `Agent`。子 agent（代理）有自己的工作階段，看不到父 agent 的對話歷史，並複用宿主的 agent 工廠及 LLM（大型語言模型）/工具服務。

## 行為

`start(request)` 不傳入 seed，直接委託給 [`startInProcessRun`](../subagent-in-process-driver/README.md)，並在子 agent 發布後才返回。子 agent 獲得父 agent 的工作目錄/工作階段譜系，並默認繼承父 agent 模型（除非覆蓋），但以空對話開始執行。

共享驅動器負責深度檢查、persona 與工具過濾器設定、結構化輸出、透過必需的訊號執行取消、單次執行、結果讀取和完全靜止後的 dispose（資源釋放）。啟動遭拒不會留下已發布的子 agent；啟動呼叫兌現後解除安裝提供方，也不會撤銷由持有方擁有的執行。

## 能力

spawn 聲明 `{ outputSchema: true, depthLimit: true, toolFilter: true, persona: true }`，因為它控制子 agent 的建立視窗，能夠強制執行全部四項功能。

## 設定

| 鍵 | 含義 |
|---|---|
| `providerName` | `ctx.subagents` 上的登錄檔名稱（默認 `spawn`）。 |

## 模型體驗

### 子 agent 請求

#### 模型看到的內容

全新的子 agent 逐字接收獨立任務內容，默認繼承父 agent 的模型和工作區，並看到帶有已設定子 agent 作用域 persona 遮蔽的全域性提示詞。工具過濾器會為該子 agent 移除全域性協議 schema、可執行工具尋找和 Code Mode SDK 綁定，但保留獨立註冊的指導內容。它不接收任何父 agent 對話訊息；過濾控制的是可見性與組合，並非從父 agent 繼承的權限授予。

#### Token 影響

子 agent 會為全新的獨立上下文和歷史消耗 token；不會複製父 agent 歷史的 token。persona 會改變該子 agent 反覆使用的提示詞成本，過濾則會改變其 schema 或生成 SDK 的成本。

#### KV Cache 影響

與父 agent 請求快取相互獨立。子 agent 歷史僅附加；persona、工具過濾、生成 SDK、提供方或模型變化會建立不同的子 agent 前綴。

### 父 agent 工具結果（間接）

#### 模型看到的內容

透過 `dsh-tool-subagent`，父 agent 只接收子 agent 的最終輸出或結束原因錯誤。

#### Token 影響

父 agent 輸入會增加一個取決於資料的結果，並保留到壓縮（compaction）為止。

#### KV Cache 影響

僅附加；新增可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **全新表示不含父 agent transcript（文字記錄）**：子 agent 會繼承 cwd、譜系、模型及顯式設定的 persona/工具限制，但不繼承父 agent 的任何對話；需要已完成輪次上下文時，請使用 fork 提供方。
