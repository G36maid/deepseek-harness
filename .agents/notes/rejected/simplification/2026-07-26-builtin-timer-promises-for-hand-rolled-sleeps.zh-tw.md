# Agent Note: 用 node:timers/promises 替代手寫的可取消休眠

Status: rejected — 實作（PR #679）證偽了行為等價前提：vitest 的假時鐘不攔截 `node:timers/promises`，這次替換用確定性的快速測試換來約 10 行刪除，得不償失

[English](2026-07-26-builtin-timer-promises-for-hand-rolled-sleeps.md) | [简体中文](2026-07-26-builtin-timer-promises-for-hand-rolled-sleeps.zh.md) | 繁體中文

## 問題

三個包手寫了用 promise 包裝的定時器，而 `node:timers/promises` 內建模組早已提供同等能力；其他包（`dsh-llm-mock-server` 的 `pause()`、`dsh-lsp-stdio`、`dsh-acp-snapshot`）已經在使用該內建模組，因此這些手寫副本同時也是一處一致性缺口：

- `packages/llm/llm-retry/src/index.ts` 的 `cancellableDelay()`（約 14 行）：`new Promise` + `setTimeout` + 手動新增和移除中止監聽器，定時器觸發時 resolve 為 `true`、被中止時 resolve 為 `false`，僅在退避等待處消費一次。
- `packages/workflow/workflow-worker-thread/src/host.ts` 的 `sleep()`（約 7 行）：promise 包裝、已 unref 的 `setTimeout`，用作 dispose（資源釋放）寬限的時間上界。
- `packages/terminal/terminal-bash/src/session.ts` 的 `delay()`（約 4 行）：樸素的 promise 包裝 `setTimeout`，用於輪詢與拆卸等待。

## 提案

用 `import { setTimeout } from 'node:timers/promises'` 替換這三處實作：

- llm-retry：`try { await setTimeout(delayMs, undefined, { signal }); /* retry */ } catch { /* abort → fail */ }`。傳入 signal 後，該 promise 只會因中止錯誤而拒絕，已提前中止的 signal 則立即拒絕；行為完全一致，包括中止時清除定時器。按倉庫的空 catch 規則，這個空 `catch` 註明其吞下的是 abort 拒絕。
- workflow-worker-thread：`setTimeout(ms, undefined, { ref: false })`，語義完全等價，包括不會讓事件迴圈保持存活。
- terminal-bash：`import { setTimeout as delay } from 'node:timers/promises'`，簽名完全相同，呼叫點無需改動。

沒有專屬測試固定這些輔助函式本身；各包的行為測試套件繼續透過。

## 曾考慮的替代方案

- **`p-timeout`/`p-defer` 一類的包。** 不予採納：內建模組恰好精確覆蓋這些呼叫點；為一行 await 引入外部包是負收益。
- **維持現狀。** 不予採納，但理由較弱：成本確實很小，但倉庫其他地方已經在用這一內建慣用法，而同一內建能力存在兩個手寫變體，就會招來第三個。

## 驗收標準

- 這三個包都不再各自訂 promise 包裝的 `setTimeout` 輔助函式，而是都從 `node:timers/promises` 匯入。
- `llm-retry`、`workflow-worker-thread` 與 `terminal-bash` 的測試套件原樣透過（行為等價）。

## 風險

基本沒有風險：不涉及模型可見的輸出，沒有平臺顧慮，也不新增相依性。llm-retry 的改寫把一個返回布林值的輔助函式變成 try/catch 控制流，這是一項區域性可讀性判斷，由實施 PR（Pull Request）裁量。
