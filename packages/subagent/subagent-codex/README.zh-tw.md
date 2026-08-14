# @deepseek-ai/dsh-subagent-codex

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

本包註冊固定的 `codex` subagent 提供方。每次接受執行請求後，它都會在發起委託的工作階段工作區中啟動官方 `codex app-server --stdio` 命令，建立一個臨時 Codex 執行緒，提交一個自包含的文字任務，並透過共享的 [`dsh-subagent`](../subagent/README.md) 結果約定僅返回最終答案。

## 啟動與所有權

`start(request)` 只接受非空的文字塊序列，並根據父工作階段確定子級 cwd。隨後，它透過 [`dsh-subprocess`](../../subprocess/subprocess/README.md) spawn 固定命令，依次執行 `initialize` → `initialized` → `thread/start { cwd, ephemeral: true }`，且僅在 Codex 返回有效的臨時執行緒後才發布此次執行。若在發布前發生失敗或取消，它會關閉通訊鏈路、終止受管行程樹並等待其結束，然後拒絕 `start()` 呼叫。

已發布的 `run.result` 恰好啟動一個輪次。它只接受與此次執行的執行緒和輪次匹配的通知，隨後等待權威的終止通知 `turn/completed`。以最後一條 `phase: "final_answer"` 的 `agentMessage` 為準；若 Codex 沒有寄出明確的最終階段，則以最後一條 `phase: null` 的訊息作為相容性回退。過程說明絕不會取代上述任一答案；成功完成的輪次若沒有非空白答案，結果也會判為錯誤。

對於命令與文件審批，無人值守的提供方會從請求給出的決策選項中選擇一項不予批准的決策，並優先選擇 `cancel`；穩定的 0.147.0 請求形態沒有決策選項清單，因此回退到 `decline`。它對權限請求返回作用域限於當前輪次的空權限集，不向使用者輸入請求提供任何答案，並拒絕 MCP elicitation。若請求在無人值守模式下沒有合法回應，或是未知伺服器請求，此次執行就會失敗。

本機取消會在結果競態中勝出並對映為 `aborted`。失敗輪次的 `codexErrorInfo` 若為 `contextWindowExceeded`，則對映為 `max-tokens`；其他任何遠端中斷或失敗輪次都對映為 `error`，且該提供方不會產生 `refusal`。`dispose()`（資源釋放）具有冪等性：如果當前的兩個識別符號均已知，它會盡力請求 `turn/interrupt`，關閉 JSON-RPC 通訊鏈路，結束標準輸入，呼叫共享的行程樹逐級終止機制，並等待整棵行程樹結束。結果失敗與獨立的清理失敗仍彼此分離。

## 能力與上下文

本提供方不聲明任何選填的啟動時能力，並報告 `inheritsParentContext: false`。Codex 會接收獨立文字任務和父工作階段 cwd，但不會接收父工作階段的對話、角色設定、工具篩選器、深度策略或結構化輸出約定。臨時 Codex 執行緒 ID 與輪次 ID 僅在此次執行內部可見，絕不會持久化到父工作階段。

## 設定

| 設定鍵 | 預設值 | 含義 |
|---|---|---|
| `env` | `{}` | 顯式指定的子行程環境，疊加在由子行程 seam 清除憑證後的父環境之上。 |
| `disposeGraceMs` | `3000` | 共享行程樹責任方各終止層級之間的寬限期，單位為毫秒且須為正有限值，並不得大於倉庫共享的 [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md)；隨後資源釋放會等待整棵行程樹結束。 |

生產環境會從 `PATH` 中解析 `codex`，並使用宿主機原生的 Codex 設定與身分驗證。本外掛程式不安裝 Codex、不選擇模型、不建立 `CODEX_HOME`、不執行登入，也不探測版本。子行程 seam 會移除具有憑證特徵的環境變數，因此供子行程使用的 API 金鑰必須在 `env` 中顯式提供；除非被覆蓋，`PATH` 和 `HOME` 等普通環境變數值仍然可用。

隨附 profile 會在宿主上載入一次該提供方，而且在工具被呼叫前不會啟動 Codex 行程。完整 Agent Preset 攜帶下列工具行並設定 `disabled: true`；複製一個 preset 後刪除該欄位，即可只向由該副本組裝的 agent 暴露 `subagent_codex`。自訂宿主組裝仍可直接使用兩條設定行。

```yaml
- id: subagent-codex
  name: '@deepseek-ai/dsh-subagent-codex'
  config:
    env:
      OPENAI_API_KEY: !!js process.env.OPENAI_API_KEY

- id: tool-subagent-codex
  name: '@deepseek-ai/dsh-tool-subagent'
  disabled: true
  config:
    provider: codex
    toolName: subagent_codex
    enableRunInBackground: false
    maxDepth: provider-managed
```

## 產品相容性與證據

生產環境的協定層有意只實作這一單次執行約定所需的 app-server 方法。開發證據鎖定在 `@openai/codex@0.147.0` / `codex-cli 0.147.0`；該 NPM 包僅作為測試相依性，部署環境仍需透過 `PATH` 提供 `codex`。

## 模型體驗

### 子級請求

#### 模型看到的內容

Codex 子級會在一個全新的臨時執行緒中，以單個輪次接收這些獨立文字塊。它的工作區是父工作階段 cwd；其模型、系統指令、工具、沙盒和身分驗證來自原生 Codex 安裝與設定。

#### 對 token 的影響

子級需為獨立的 Codex 上下文和輪次承擔 token 開銷。子級 token 不會進入父級上下文。

#### 對 KV Cache 的影響

這與父請求快取相互獨立。能否複用只取決於 Codex 自身的提供方、模型、指令、工具和臨時執行緒請求。

### 父級工具結果（間接）

#### 模型看到的內容

透過 `dsh-tool-subagent`，父級模型只會看到選定的 Codex 最終答案，或者看到消費端針對未成功完成的結果給出的原樣錯誤。Codex 的過程說明、推理（reasoning）、工具活動、stderr、工作區差異和產品識別符號均不會複製到父工作階段。

#### 對 token 的影響

父級輸入只會增加工具結果中保留的最終答案或錯誤內容。本提供方自身不新增父級工具 schema。

#### 對 KV Cache 的影響

僅附加：新的工具結果接在可複用的父請求前綴之後。

## 已知限制與後續工作

- **每次執行均新建一個行程、一個執行緒和一個輪次**：不支援續接、復原、池化、進度流或產品工作階段持久化。
- **產品安裝和帳戶狀態由宿主管理**：`codex` 缺失或不相容、設定錯誤或身分驗證失敗，都會呈現為啟動錯誤或執行錯誤；本外掛程式不提供安裝程序、登入流程或執行時期版本閘門。
- **相容性由開發證據鎖定**：若要從已驗證的 0.147.0 協定基線升級，必須重新生成上游 schema 證據，並重新執行握手、答案選擇、審批、取消、無金鑰真實產品以及帶金鑰的 DeepSeek 隨機數測試。
- **沒有人工審批路徑**：已知的無人值守審批請求會被拒絕，未知伺服器請求會以預設拒絕方式使執行失敗；部署方無法透過本包設定允許策略。
- **僅返回最終文字**：推理、過程說明、中間訊息、工具通訊、用量資訊、stderr 和工作區差異仍只保留在產品內部。
- **沒有選填的共享能力**：對於本提供方，共享服務會拒絕輸出 schema、子任務角色設定、工具篩選和 harness 深度強制約束。
- **沒有按實際經過時間觸發的逾時或副作用回滾**：長時間執行的工作由呼叫方取消，且取消前已更改的文件或外部系統不會復原原狀。
