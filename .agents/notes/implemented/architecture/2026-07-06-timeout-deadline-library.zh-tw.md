# Agent Note: 共享的逾時/截止時間原語，硬終止留給各能力自行實作

Status: implemented

[English](2026-07-06-timeout-deadline-library.md) | [简体中文](2026-07-06-timeout-deadline-library.zh.md) | 繁體中文

## 問題

逾時處理在各個承載工具的能力之間逐漸分化，而且這種分化並非表面的：同一套邏輯被以三種方式重新實作，各自帶有微妙的正確性負擔。

- **bash**（當時位於 bash-local 實作的 `run.ts`）在行程管道內部有一套完整、正確的逾時實作：一個經設定鉗位的 `timeoutMs`，兩個獨立觸發器（用於逾時的 `killTimer` 和用於上游取消的 `onAbort` 監聽器），各自呼叫同一個 `kill()` 閉包對行程組執行 SIGTERM→寬限期→SIGKILL 升級，以及兩個正交的結果布林值（`timedOut`、`aborted`）獨立鎖存。經此次整合之後，這套管道——今天位於 [packages/subprocess/subprocess-local/src/spawn.ts](../../../../packages/subprocess/subprocess-local/src/spawn.ts)——只回應中止；[packages/shell/bash-local/src/index.ts](../../../../packages/shell/bash-local/src/index.ts) 擁有融合的 deadline 以及 `timedOut`/`aborted` 分類。
- **web_fetch**（[packages/web/web-fetch-http/src/provider.ts](../../../../packages/web/web-fetch-http/src/provider.ts)）有一套正確但*手寫*的逾時：構造一個 `AbortController`，連線 `setTimeout(() => controller.abort(new WebError(…, 'WEB_FETCH_TIMEOUT')))`，手動新增和移除上游訊號監聽器，在 `finally` 中清除定時器，並在 `translateAbortOrNetwork` 輔助函式中從 `signal.reason` 復原逾時原因（因為 reader 只拋出裸 `AbortError`）。
- **web_search**（[packages/web/tool-web/src/search.ts](../../../../packages/web/tool-web/src/search.ts)）**完全沒有逾時**：`WebSearchRequest`（[packages/web/web/src/types.ts](../../../../packages/web/web/src/types.ts)）不攜帶 `timeoutMs` 欄位，各提供方的 `search()` 只轉發 `exec.signal`。（web_search 在本次設計中保持無逾時——見「後果」。）

每個新的外部行程或網路工具都要重新推導同樣四件事：鉗位請求值、啟動定時器、將逾時與上游取消融合、在出口處區分「逾時」與「已取消」。而融合與原因復原恰恰是最容易出微妙錯誤的部分（web_fetch 的 `signal.reason` 處理就是證據）。與此同時，各能力執行的*終止*操作不可歸約地不同：bash 殺死一個 OS 行程組（工作執行在子行程中，在本執行時期之外，只能透過訊號觸達），而 web 中止一個行程內的 `fetch`（undici 拆除 socket）。不存在一個能停止所有能力工作的單一機制。

## 決策

`@deepseek-ai/dsh-timeout` 位於 `packages/util/`（與 `dsh-brand` 同級），負責逾時的*計時與分類*這一半；*終止*那一半——硬終止——留在各能力的實作中。它是一個純函式庫，**不是** Cordis 服務或外掛程式：不接收 `ctx`、不註冊任何東西、不持有跨呼叫狀態、不發射事件。這裡刻意不設中央「逾時服務」，因為那樣的服務必須知道如何停止每個能力的工作——而這正是微核心要排除在共享層之外的知識，也是 Codex 將 `ExecExpiration` 限定於 exec 族所示範的原則。

### 庫的對外介面

四個函式、一個 watchdog 介面加一個 reason 類型：

```ts ignore-check
/** The internal reason attached to a timeout abort, so consumers can classify it after the fact. */
export class TimeoutReason extends Error {
  override name = 'TimeoutReason'

  constructor(readonly code: string, readonly timeoutMs: number) {
    super(`${code} after ${timeoutMs}ms`)
  }
}

/** Validate/fill a caller's optional positive hint from the backend's default, then cap at its max. */
export function clampTimeout(
  requested: number | undefined,
  def: number,
  max: number,
  name = 'timeoutMs',
): number

/**
 * Build a deadline signal that aborts on upstream cancellation OR on timeout,
 * with the timeout carrying a `TimeoutReason`. `timeoutMs <= 0` means "no
 * timeout" (background jobs): forward only the upstream signal, arm no timer.
 * The returned object's `[Symbol.dispose]` clears the timer — `using` for a
 * scope-lifetime consumer, a manual call for an event-lifetime one.
 */
export function deadline(
  upstream: AbortSignal | undefined,
  timeoutMs: number,
  code: string,
): { signal: AbortSignal; [Symbol.dispose](): void }

/** A stable signal plus one-at-a-time, timer-guarded async-iterator demand. */
export interface IdleWatchdog {
  readonly signal: AbortSignal
  next<T>(iterator: AsyncIterator<T>): Promise<IteratorResult<T>>
  pulse(): void
  [Symbol.dispose](): void
}

/** Arm only while one iterator `next()` is outstanding; rearm on later demand or out-of-band activity. */
export function idleWatchdog(
  upstream: AbortSignal | undefined,
  timeoutMs: number,
  code: string,
): IdleWatchdog

/** Recover the TimeoutReason from an aborted signal (or error); `code` scopes the match to this deadline's timer. */
export function timeoutOf(x: AbortSignal | { reason?: unknown }, code?: string): TimeoutReason | undefined
```

`deadline` 透過 `AbortSignal.any` 將上游訊號與一次性定時器融合，附加一個類型化的 `TimeoutReason`，並暴露可 dispose（資源釋放）的定時器清理。非正數逾時是內部的「無逾時」哨兵，用於後端擁有的背景工作；外部提示經過 `clampTimeout`，必須為正有限值。既無定時器也無上游訊號時，函式返回一個永不中止的訊號，具有相同的 disposal 形狀。`idleWatchdog` 則要求正有限的間隔，在整個流期間保持一個穩定的融合訊號，並且只在一個迭代器 `next()` 尚未結帳時啟動定時器；結帳會解除定時器，後續 demand 會重新啟動，帶外傳輸活動發生後，`pulse()` 則會為同一個尚未結帳的 demand 重新啟動定時器。若沒有尚未結帳的 demand，或已經 dispose，pulse 不執行任何操作；並行 demand 會失敗，dispose 會清除當前 arm。提供方將逾時原因轉譯為 seam 特定的結果。`timeoutOf(signal, code)` 限定分類範圍，使外層巢狀的 deadline 被視為上游取消而非內層能力自身的逾時。

### 職責劃分

| 關注點 | 負責方 |
|---|---|
| 校驗請求提示並鉗位預設值/最大值 | `dsh-timeout`（`clampTimeout`）：純算術加共享的正有限請求約定 |
| 啟動一次性定時器、到期中止、攜帶 reason、與上游取消融合 | `dsh-timeout`（`deadline`） |
| 僅圍繞未結帳的迭代器 demand 啟動和重新啟動，帶外活動也會觸發重新啟動 | `dsh-timeout`（`idleWatchdog`） |
| 清除定時器 | `dsh-timeout`（任一原語的 `[Symbol.dispose]`） |
| 中止後對首個 abort reason 進行分類 | `dsh-timeout`（`timeoutOf`） |
| **實際終止工作** | 各能力的實作 |
| 預設值/最大值*數值* | 各能力的設定 |
| 逾時 `code` 字串 | 各能力（`WEB_FETCH_TIMEOUT` ≠ `BASH_TIMEOUT`） |

訊號只*通知*；終止始終是監聽方的職責，而監聽方因能力而異。bash 自行編寫 `addEventListener('abort', kill)`，因為 OS 行程存在於本執行時期之外，沒有別的東西會殺死它；web 將 `d.signal` 交給 `fetch`，由 undici 拆除 socket。這也是文件讀/寫/編輯**不接受** `timeoutMs` 的原因：本機系統呼叫最多隻能盡力中止，逾時無法強制 `fsync`/`rename` 停止，新增逾時將是一個違反「顯式優於隱式」的隱式預設值。兩個參考 agent（代理）出於同樣的原因對文件 I/O 不設逾時。

### 各能力如何消費該庫

- **web_fetch**：工具層保持校驗並轉發；提供方手寫的 controller + `setTimeout` + 手動監聽器 + `finally` + `signal.reason` 復原被替換為提供方自有的 `deadline`/`timeoutOf`。已預先中止的上游訊號仍然立即拋出 `WEB_ABORTED`；否則 `fetch` 使用融合後的 `d.signal` 執行，`translateAbortOrNetwork` 根據訊號分類拋出的錯誤（`timeoutOf` → `WEB_FETCH_TIMEOUT`，否則已中止 → `WEB_ABORTED`，否則網路錯誤 → `WEB_PROVIDER_ERROR`）。公開的錯誤碼約定不變，`TimeoutReason` 永遠不會作為公開錯誤跨越 web seam。
- **bash**：`resolve()` 將請求鉗位為顯式規格。前臺 `run()` 建立 deadline 並將其訊號傳給行程執行，後者既有的 abort 監聽器執行行程組 kill。執行器將首個 abort 分類為逾時或取消。後臺啟動保持無逾時，僅轉發上游取消。
- **LLM（大型語言模型）配接器**：`dsh-llm-deepseek` 和 `dsh-llm-pi-ai` 用 `idleWatchdog` 包裝實際的傳輸迭代。設定的五分鐘間隔只覆蓋尚未結帳的提供方 demand，不包括下游消費端在區塊之間花費的時間。DeepSeek 直連配接器還會在其 SSE（Server-Sent Events）解析器觀察到註釋時，對該項尚未結帳的 demand 呼叫 `pulse()`；該註釋既不會作為 `StreamChunk` 產出，也不會寫入工作階段日誌。pi-ai SDK 不會向其配接器暴露註釋活動，因此該路徑只能在 SDK 產出值時重新啟動定時器。穩定訊號在整個呼叫期間傳給 `fetch` 或 SDK，因此逾時會關閉底層請求並對映為 `TIMEOUT`，而更早的呼叫方中止對映為 `ABORTED`。

## 後果

- `runBash` 的結果不再獨立鎖存 `timedOut` 和 `aborted`；逾時與使用者中止在行程關閉前競爭時，現在報告單一的首個 abort 原因，而非兩者同時為 true。統一的 SIGTERM→寬限期→SIGKILL 終止路徑不變，Service Definition 類型 `ShellRunResult` 保留兩個布林值（現在互斥），因此 `dsh-tool-bash` 的結果渲染不受影響。
- `SpawnSpec.timeoutMs` 和 `SpawnOutcome.timedOut`/`aborted` 被移除，而非作為始終為零/始終為 false 的殘餘保留：由於 `runBash` 不再擁有定時器且執行器負責分類，這些欄位無處被讀取。一個始終為 0 且無處讀取的欄位在逐文件覆蓋率閘門下屬於死程式碼。
- web_fetch 去除了其訂製的 controller/timer/listener/reason-recovery；分類器現在基於 deadline 訊號（`timeoutOf` + `aborted`）而非拋出錯誤的形狀來判斷，這在請求階段的 reject-with-reason 和讀取階段的裸 `AbortError` 兩種情況下都是健壯的。
- `AbortSignal.any` 和 `using`/`Symbol.dispose` 在此首次進入本倉庫（Node ≥ 24 基線，已滿足）。
- 模型流現在共享一個可重新啟動的定時器約定，不會把滑動的空閒間隔變成總呼叫截止時間，也不會計入消費端思考時間。能夠觀察到帶外傳輸活動的配接器可以對尚未結帳的 demand 呼叫 `pulse()`；被封鎖的活動對 watchdog 仍不可見。該原語仍然只做通知；配接器測試證明其傳輸觀察到穩定訊號並終止。

以下內容不在本次範圍內，列出以標明邊界：`web_search` 可以在其工具 schema 和快照覆蓋規劃完成後獲得選填的面向模型的 `timeout_ms`；基於 ripgrep 的檔案系統發現工具（[打包的 ripgrep 搜尋](2026-08-01-packaged-ripgrep-search.md)）透過 `dsh-tool-call-timeout-policy` 和 `exec.signal` 消費同樣的提供方自有 deadline 形狀；`tools/execute` waterfall（瀑布式事件）中介軟體可以透過驅動 `exec.signal` 為每次工具呼叫設定默認 deadline——那將是一個*消費*本庫的外掛程式，仍然只做通知，硬終止仍是各能力自己的事。

## 曾考慮的替代方案

**統一的逾時*外掛程式* / `ctx.timeout` 服務。** 基於微核心原則否決。一個能停止任何工具工作的服務必須理解每個能力的終止機制（行程組 SIGKILL、socket 拆除、系統呼叫邊界檢查），這正是架構所禁止的「核心知道太多」。Codex 的 `ExecExpiration` 被限定於 exec 族，正是因為它驅動的 kill（`killpg`）是行程族特有的；MCP 和模型流各自保有自己的。不存在一個連貫的中間層能為所有東西擁有終止權，因此共享部分只能是純計時/分類那一半——一個庫，而非服務。

**每個工具各自實作逾時，不共享程式碼（先前的現狀，也是 Claude Code 的選擇）。** 否決，因為它已經在產生分化和重複的正確性負擔：web_fetch 手寫了與未來網路/行程類工具各自需要重新推導的完全相同的 controller/reason 邏輯，而融合 + `signal.reason` 復原正是容易出錯的部分。Claude Code 容忍完全重複；本倉庫有一個統一的共享 abort 通道（每次 `execute` 上的 `exec.signal`），使得採用一個小型共享原語明顯更簡潔，因此成本/收益不同。

**用 `withTimeout(promise, ms)` 包裝器代替訊號工廠。** 否決，因為讓 promise 與定時器競爭只是在截止時間到達時 resolve *工具呼叫*的 promise，而不會停止底層工作——子行程或 fetch socket 會洩漏。分發訊號並要求能力監聽，才能強制一條真實的終止路徑存在。這與「dispose 必須達到完全靜止，而非僅僅請求它」的防禦性規則一致。

**保留 bash 獨立的逾時和取消觸發器。** 否決，因為一個 deadline 訊號移除了定製定時器並標準化了分類。發生競爭時，報告先到達的那個 abort 作為原因，而既有的 SIGTERM→SIGKILL 終止路徑保持不變。
