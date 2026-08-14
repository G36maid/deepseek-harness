# Agent Note: 工具呼叫逾時策略作為外掛程式

Status: implemented

[English](2026-07-07-tool-call-timeout-policy.md) | [简体中文](2026-07-07-tool-call-timeout-policy.zh.md) | 繁體中文

## 問題

[逾時/截止時間 Agent Note](2026-07-06-timeout-deadline-library.md) 將計時與分類原語提取到了 `@deepseek-ai/dsh-timeout`，但逾時策略仍然附著在各個能力和麵向模型的 schema 上。`bash` 暴露了 `timeoutMs`；`web_fetch` 暴露了 `timeout_ms`；`web_search` 沒有面向模型的逾時參數，儘管提供方已經遵循 `exec.signal`；未來的 grep/glob 工具要麼直接匯入逾時庫，要麼自行發明逾時策略。對於一個外掛程式 SDK 來說，這是錯誤的編寫範式：工具作者通常只需將 `exec.signal` 轉發給其呼叫的實作，而部署策略來決定預算。

與此同時，倉庫中並非所有逾時都是面向模型的工具呼叫預算。掛鉤透過直接呼叫 `ctx.shell` 執行命令掛鉤，而非透過 `ctx.tools.execute()`；`bash` 模型工具透過同一個後端複用前臺執行、後臺啟動、後臺輪詢和掛鉤複用。一步到位地將所有逾時移入工具外掛程式會混淆這些路徑，並有破壞掛鉤逾時語義的風險。

## 決策

工具呼叫逾時是僅適用於面向模型的工具執行的策略，由三部分組成：

- `@deepseek-ai/dsh-timeout` 仍是擁有 `deadline()` 和 `timeoutOf()` 的共享庫。
- `@deepseek-ai/dsh-tools` 在 `tools/pre-execute` 和 `tools/post-execute` 之間有一個環繞分發的 waterfall（瀑布式事件）`tools/execute`。
- [倉庫命名約定](2026-08-11-repository-naming-contract-and-rename-ledger.md)使用 `@deepseek-ai/dsh-tool-call-timeout-policy`，準確說明該策略所限制的操作。外掛程式從 runtime 讀取每個工具聲明的 `timeoutMs`，並透過派生新的 `exec.signal` 來包裝有此聲明的呼叫。

執行管線如下：

```text
ctx.tools.execute(exec)
  -> tools/pre-execute
  -> tools/execute
       -> registry dispatch (the base next())
            -> tool.execute(args, exec)
            -> thrown tool errors normalize to ToolExecutionResult
  -> tools/post-execute
```

默認行為是保守的：未聲明 `timeoutMs` 的工具不會從該外掛程式收到 `TOOL_TIMEOUT` 截止訊號。

### `tools/execute` 環繞分發擴充點

`@deepseek-ai/dsh-tools` 聲明瞭一個 `tools/execute` waterfall，其基礎 `next()` 是帶規範化的分發 thunk——即同一個內部 `try`/`catch`，將拋出的工具錯誤（或未知工具錯誤）轉換為 `isError` 的 `ToolExecutionResult`。監聽器接收 `(exec, next)`：呼叫 `next()` 委託給分發（返回其結果，選填地包裝），或返回替代結果以短路分發。整個管線仍位於 `execute` 的外層 try/catch 內，因此拋出例外的監聽器會變成 `isError` 結果，而非輪次失敗。

catch 是基礎 `next`（而非 waterfall 之外的東西）這一點至關重要：當提供方看到逾時訊號並拋出自己的上游中止錯誤時，登錄檔分發首先將其轉換為普通錯誤結果，然後 `timeout-policy` 才能將最終結果替換為 `TOOL_TIMEOUT`。

### `timeout-policy` 外掛程式

該外掛程式是 `@deepseek-ai/dsh-tool-call-timeout-policy`，一個零設定的函式/命名空間外掛程式（`name` / `inject` / `apply`），位於 `packages/guard/` 組。每個工具的預算聲明在工具自身，而非本外掛程式：`ToolDefinition` 攜帶一個選填的 `timeoutMs`，由擁有該工具的外掛程式從自身設定中設定。例如 `dsh-tool-web` 將 `fetchTimeoutMs` / `searchTimeoutMs`（默認 30000）解析到 `web_fetch` / `web_search` 的定義上：

```yaml
- id: timeout-policy
  name: '@deepseek-ai/dsh-tool-call-timeout-policy'
- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
  config:
    fetchTimeoutMs: 30000
    searchTimeoutMs: 30000
```

逾時放在工具定義上而非自由文字名稱對映中，消除了拼錯名稱導致策略不生效的問題。`defineTool` 校驗預算為正有限數。分發期間，執行器派生截止訊號並將其賦給 `exec.signal`；登錄檔依據[工具取消約定](2026-07-19-cooperative-tool-cancellation.md)，在執行工具體之前將該截止訊號與呼叫方的原始訊號融合。執行器隨後復原呼叫方訊號，並將自身的逾時轉換為 `TOOL_TIMEOUT`；沒有預算的工具原樣透過。

訊號替換採用**就地修改 `exec.signal`** 的方式，而非向 `next()` 傳遞新對象。Cordis 的 waterfall `next()` 忽略傳入的任何參數，並以共享的 payload 陣列重新呼叫下游監聽器（`vendor/cordis/src/events.ts`），因此修改共享對象是包裝器向登錄檔提供截止訊號的方式。登錄檔會在進入工具體前再次融合已捕獲的呼叫方訊號；外掛程式則在 `finally` 中將 `exec.signal` 復原為呼叫方的原始值，使 `tools/post-execute` 永遠不會看到本外掛程式的截止訊號。

`timeout-policy` 擁有 `TOOL_TIMEOUT` 程式碼的兩種用途：傳遞給 `deadline()`/`timeoutOf()` 的內部截止程式碼（有作用域，使巢狀的外層截止被識別為普通取消）和結構化工具結果錯誤程式碼。其替換結果為：

```ts ignore-check
function toolTimeoutResult(timeoutMs: number): ToolExecutionResult {
  return {
    content: [{ type: 'text', text: `Error: tool call timed out after ${timeoutMs}ms` }],
    isError: true,
    error: {
      message: `tool call timed out after ${timeoutMs}ms`,
      info: { name: 'ToolTimeoutError', code: 'TOOL_TIMEOUT' },
    },
  }
}
```

這是一個協作式截止。它不會透過競爭工具 promise 來殺死任意工作；工具或其呼叫的能力必須遵循 `exec.signal` 並達到完全靜止。因此聲明 `timeoutMs` 意味著「此工具與 `exec.signal` 協作」，外掛程式 README 將此作為其約定。

無需新的工作階段事件來保證可重建性：`TOOL_TIMEOUT` 是該呼叫的最終面向模型的 `tool/result`，因此現有工作階段日誌已經記錄了下一次模型請求所見的內容和結構化 `{ name, code }` 錯誤。

### 現有工具適配

`web_fetch` 和 `web_search` 已遷移。`dsh-tool-web` 保留對其面向模型 schema 的所有權，這些 schema 不暴露逾時旋鈕：`web_fetch` 移除了 `timeout_ms` 參數以匹配參考 agent（代理）的形狀，`web_search` 保持僅查詢。工具體不匯入 `@deepseek-ai/dsh-timeout`；它們將 `exec.signal` 轉發給 `ctx.web`。

`dsh-web-fetch-http` 保留一個在提供方層面設定的 `timeoutMs`，作為較大的資源兜底值，服務於直接呼叫 `ctx.web.fetch()` 的呼叫方和設定錯誤的部署；它不擁有面向模型的逾時。當 `TOOL_TIMEOUT` 訊號先到達 fetch 提供方時，提供方作用域的分類將其視為上游 `WEB_ABORTED`，而外層 `tools/execute` 包裝器將最終工具結果替換為 `TOOL_TIMEOUT`。一個已發布的 web 工具部署將提供方兜底設定為高於 `timeout-policy` 預算，使工具呼叫策略在模型呼叫中通常勝出。

`bash` 保持當前的後端逾時路徑。`dsh-tool-bash` 繼續暴露 `timeoutMs` 和 `run_in_background`；`dsh-bash-local` 繼續使用 `@deepseek-ai/dsh-timeout` 處理 `BASH_TIMEOUT`；掛鉤橋接繼續呼叫 `runHook()` 並透過 `ctx.shell` 傳遞 `timeoutMs`。這保持了前臺/後臺/掛鉤行為的穩定。

`read`、`write`、`edit`、`todo_write`、`job_list` 和 `job_kill` 不加入工具呼叫逾時。`job_output` 自己擁有有界等待，因為等待逾時是成功的即時狀態結果，而非工具失敗。

未來面向模型的 grep/glob 工具可以基於 `ctx.shell` 實作而無需匯入 `@deepseek-ai/dsh-timeout`：它將 `exec.signal` 轉發給 `ctx.shell`，並聲明自己的 `timeoutMs`（來自其外掛程式設定）供執行器應用。如果 bash-local 的後端逾時對這類工具造成問題，bash seam 可以後續新增呼叫方自有截止模式；那是一項獨立的決策。

## 曾考慮的替代方案

**將外掛程式命名為 `tool-timeout`。** 字面的 Agent Note 名稱匹配了 `gen-tool-catalog` 完整性守衛的 `packages/*/tool-*` glob，該 glob 要求每個匹配項註冊一個面向模型的工具。本外掛程式不註冊任何工具——它是一個 `tools/execute` 包裝器——因此 `tool-*` 名稱要麼導致 `verify-tool-catalog` 失敗，要麼強制產生一個誤導性的啟動條目。包為 `@deepseek-ai/dsh-tool-call-timeout-policy`，位於新的 `packages/guard/` 組；cordis.yml 的 `id` 仍可為 `timeout-policy`。

**僅保留逐工具的逾時處理。** 這是 `bash` 和 `web_fetch` 的既有形態，也與 Claude Code 和 Codex 對 shell 命令的做法一致。它對 web 類工具不利，因為每個新的支持逾時的工具都必須自行選擇校驗方式、上限語義、文件、快照和分類。外掛程式集中了策略和分類，讓每個工具的 schema 專注於業務輸入。

**立即將所有逾時策略移出 bash-local。** 長期來看更乾淨——bash-local 將成為純子行程執行器，所有呼叫方自行管理截止時間。但作為第一步不合適，因為掛鉤直接呼叫 `ctx.shell`，且 bash 模型工具的前臺/後臺語義與工具呼叫生命週期不同。保留 `BASH_TIMEOUT` 維持了這些路徑的穩定，同時讓工具呼叫逾時在更簡單的工具上先行驗證。

**為所有工具使用全域性默認預算。** 方便，但會讓工具作者意外：任何偶然執行超過全域性預算的工具在外掛程式載入後就會開始失敗。逐工具聲明預算使採納成為有意的行為。

**暴露面向模型的 `timeout_ms` 覆蓋參數。** Claude Code 的 `WebFetch`/`WebSearch` 和 Codex 的 web 工具將逾時排除在模型呼叫形狀之外。模型覆蓋會使逾時成為提示詞語義的一部分，並迫使 `timeout-policy` 引入 schema/參數剝離規則。Web 逾時僅作為部署策略。

**讓 `timeout-policy` 自行匹配工具參數。** 諸如「當 `bash.run_in_background` 為 true 時停用逾時」之類的規則引擎會讓策略外掛程式瞭解工具特定的參數語義。透過不將 bash 遷移到工具呼叫逾時來規避此問題。

**使用 `tools/pre-execute` 加 `tools/post-execute` 代替新的環繞分發擴充點。** pre 監聽器可以啟動截止時間並修改 `exec.signal`；post 監聽器可以分類並替換。這樣做的問題是截止時間的生命週期會跨越兩個獨立的 waterfall：需要 call-id 對映、在每條 pre-deny/tool-throw/post-throw/dispose（資源釋放）路徑上清理，以及與其他監聽器的排序規則。`tools/pre-execute` 也是允許/拒絕閘門，而非執行包裝器。`tools/execute` 給逾時一個詞法作用域：啟動、委託、分類、釋放。

**使用 `Promise.race` 對非協作工具強制逾時。** 與逾時庫 Agent Note 相同的理由否決：它在底層行程、fetch 或提供方操作可能仍在執行時期就將控制權返回給呼叫方。外掛程式只發送訊號；終止仍是實作方的責任。

## 後果

- `@deepseek-ai/dsh-tools` 在攔截點有意拆分 pre/post 工具掛鉤之後，獲得了一個環繞分發介面。其約定範圍很窄——包裝登錄檔分發，而非替代 pre 閘門或 post 結果策略——且基礎 `next()` 是帶規範化的分發，因此包裝器永遠不會看到未經處理的工具例外。
- 多個 `tools/execute` 監聽器按普通 Cordis waterfall 順序組合：呼叫 `next()` 的監聽器包裝下游監聽器加分發；不呼叫 `next()` 直接返回的監聽器短路它們。一個同時組合逾時與未來重試/沙盒/指標包裝器的部署透過註冊順序選擇語義（「逾時覆蓋整個重試」vs「逾時覆蓋每次嘗試」）。
- 透過聲明選擇加入會帶來一種有意接受的誤設定風險：工具可以聲明 `timeoutMs` 但不遵循 `exec.signal`，這樣的工具在逾時時不會停止。登錄檔會等待這個尚未完全靜止的工具體結束，而不是與它競速；同時外掛程式約定聲明：聲明預算意味著協作；web 工具在已轉發訊號的工具上驗證了這一模式。
- 過渡期間 `bash` 和已遷移的 web 工具有意使用不同的逾時路徑：`TOOL_TIMEOUT` 是面向模型的工具呼叫預算，而 `BASH_TIMEOUT` 仍是 bash 和掛鉤使用的 bash 後端逾時。
