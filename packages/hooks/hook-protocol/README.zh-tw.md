# @deepseek-ai/dsh-hook-protocol

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

Claude Code／Codex hook 協定格式（wire format）的**共享核心**。它不是 Cordis 外掛程式：不註冊也不注入任何內容。它是一個**庫**，提供兩個橋接外掛程式（`@deepseek-ai/dsh-hooks-claude-code`、`@deepseek-ai/dsh-hooks-codex`）匯入的方言無關原語，使兩者都無需重複實作協議中相同的部分。

Codex 有意重新實作了 Claude Code hook 協議的一個*子集*，包括相同的 `hooks.json` matcher group 結構、相同的退出碼／stdout 輸出約定以及相同的 command hook 執行模式。真正共享的部分位於此處；每個橋接只負責不同的部分。

## 共享內容（此處）與各方言內容（橋接）

| 關注點 | 此處（`dsh-hook-protocol`） | 橋接（`dsh-hooks-claude-code` / `-codex`） |
|---|---|---|
| Matcher 校驗與匹配判斷 | `matcherDiagnostic(pattern, mode)` 用於解析時診斷；`matchesMatcher(pattern, query, mode)` 用於隔離的執行時期匹配 | 選擇自身的 `mode`（`claude` = 字面量或正則，`codex` = 始終使用正則），並拒絕帶有診斷的設定組 |
| 執行 hook | `runHook(bash, hook, opts, now)`：透過 `ctx.shell` 提供 stdin payload + env，再解碼 | 構造每個事件的 stdin **payload** + 該方言的 **env** |
| 解碼輸出 | `parseHookOutput(exit, stdout, stderr)` → 中性 `HookOutput` | 將中性 `HookOutput` 對映到擴充點特定的類型化 Decision |
| 合併 N 個 hook | `mergeHookOutputs(outputs)` → 最嚴格的 `MergedHookOutcome` | （無） |
| 持久記錄 | `appendHookInvoked` / `appendHookResult`（`hook/*` 工作階段事件；結果的 `decision`／`stderrSummary` 從此處的 `HookOutput` 派生） | 在每次呼叫前後呼叫它們 |
| 脫離執行的完全靜止 | `createDetachedRuns()`：跟蹤觸發後不等待的執行鏈；`drain()` 先 abort，再等待它們 | 將 `signal` 傳給每個脫離的 `runHook`，並將 `drain` 註冊為 effect disposer |

## 原語

- **`matcherDiagnostic(matcher, mode)` / `matchesMatcher(matcher, query, mode)`**：缺失、`''` 或 `'*'` 時匹配全部；`claude` mode 將純 `[A-Za-z0-9_|]+` pattern 視為字面量（管道符 = 精確匹配交替），其他 pattern 視為正則；`codex` mode 始終使用未錨定正則。橋接解析器會丟棄沒有 matcher 匹配對象的事件所帶的 matcher 欄位，再用 `matcherDiagnostic` 拒絕事件實際使用的無效正則，並在註冊任何掛鉤之前給出穩定診斷。執行時期謂詞仍會將無效 pattern 隔離為不匹配，因此直接呼叫本庫不會向 agent loop（代理循環）拋例外。
- **`runHook(bash, hook, options, now)`**：要求並轉發呼叫方擁有的 `options.signal`，將 `options.payload` 序列化到 hook stdin（當且僅當 `options.trailingNewline` 時新增尾隨換行符），在執行器憑證清理後合併 `options.env`（`dsh-shell` 受信任外掛程式介面），遵循 hook 的 `timeoutSec`（否則使用 `options.defaultTimeoutMs`；預設值屬於橋接，其設定預設為 lib 的 `DEFAULT_HOOK_TIMEOUT_MS` 10 分鐘參考值），再解碼結果（將 `options.expectedEventName` 傳遞給 codec）。因此取消會到達執行器的行程組終止與 join 邊界。它絕不拋出例外：執行器拒絕（基礎設施故障）會變為 `HookOutput`，其 `exitCode: undefined`（非阻塞錯誤）。`now` 會被注入，以便測試持續時間。
- **`parseHookOutput(exitCode, stdout, stderr, expectedEventName?)`** 解碼退出狀態與結構化 stdout。退出碼為 2 時，會以 stderr 內容阻止執行；其他失敗不阻塞。匹配的 hook 特定權限決策會覆蓋殘留頂層決策；事件判別欄位不匹配或缺失只會抑制事件特定欄位。頂層欄位仍與事件無關，成功但非 JSON 的輸出會留給橋接處理。
- **`mergeHookOutputs(outputs)`**：摺疊在一個點上匹配的每個 hook 結果：權限優先級為 **deny > ask > allow**，從首個 `continue:false` 起，halt 狀態保持不變，阻塞原因用 `\n\n` 連線，`additionalContext`／`systemMessages` 按順序累積。
- **`createDetachedRuns()`**：跟蹤以 emit 形式脫離執行的點是否完全靜止（沒有擴充點等待它們）。橋接會跟蹤每條執行鏈，包括 hook 執行及其 continuation，並將 `drain()` 註冊為 effect disposer。drain 會觸發 tracker 的 abort `signal`（因此仍在執行的 hook 行程會透過 `runHook` 終止，而不是等待到逾時），隨後在所有已跟蹤鏈結帳後 resolve。因此 `fiber.dispose()` resolve 時，不會殘留任何可能作用於已 dispose（資源釋放）的上下文的脫離 hook 工作（見 [防禦模式](../../../docs/defensive-patterns.md)：dispose 必須達到完全靜止）。

## `hook/*` 工作階段事件

透過 declaration merging 合併到 `SessionEventMap`（僅日誌，與 `compaction/*` 相同；不是 `SurfaceEventType`，沒有 `surfaceOp`）：`hook/invoked`（hook 命令已執行）與 `hook/result`（其結果，按 `handlerId` 配對，決策規則由 `appendHookResult` 負責）。Payload 與每事件 JSDoc 位於生成的 [持久化日誌事件目錄](../../../docs/persistence-catalog.md)；`stderrSummary` 會截斷到記錄的 `stderrSummaryMaxChars`（橋接設定，參考預設值 `DEFAULT_STDERR_SUMMARY_MAX_CHARS` = 500；為空時省略）。

Hook 呼叫／結果記錄必須位於一個尚未結束的輪次內。`UserPromptSubmit`、`PreToolUse`、`PostToolUse` 與 `Stop` 按構造滿足這條由所有者定義的關係。`SessionStart` 在輪次 1 之前執行，因此沒有 `hook/*` 記錄；其獲準的上下文會在 inbox 中保持待處理，直到喚醒交付打開一個輪次，詳見 hooks Agent Note。

## 模型體驗

透過 `dsh-hooks-claude-code` 與 `dsh-hooks-codex` 間接影響；它們可以將解析後 hook 輸出轉為提示詞上下文、已阻塞結果或 continuation 回饋。

#### KV Cache 影響

不會直接失效；請求前綴變更由上述消費端負責。

## 已知限制與暫緩事項

- **`HookOutput.updatedInput` 會被解析但不會應用**：輸入改寫是已暫緩的一致性設計問題（見 [pre-tool-input-rewrite Agent Note](../../../.agents/notes/proposed/feature/2026-06-30-pre-tool-input-rewrite.md)）；當 hook 設定它時，橋接會記錄 + 警告。完整約定見 `src/types.ts`。
