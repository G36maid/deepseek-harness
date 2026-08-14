# Agent Note: dsh-hook-protocol——Claude Code / Codex 掛鉤協定格式共享核心庫

Status: implemented

[English](2026-06-30-hook-protocol-lib.md) | [简体中文](2026-06-30-hook-protocol-lib.zh.md) | 繁體中文

## 問題

掛鉤子系統提供兩個橋接外掛程式：一個執行使用者既有的 Claude Code（CC）掛鉤，另一個執行 Codex 掛鉤。參考實作（`~/repos/refs/claude-code`、`~/repos/refs/codex`）表明一個決定性事實：**Codex 有意重新實作了 CC 掛鉤協議的一個子集。** 它的引擎讀取相同的 `hooks.json`，使用相同的 matcher-group 形狀、相同的 exit-code/structured-stdout 輸出約定，以及相同的命令掛鉤執行模型。Codex 的原始碼甚至以 Claude 的引擎命名，並在註釋中標注了「有意偏離」之處。因此，如果不做抽取，兩個橋接外掛程式將大量重複協議邏輯。

本 Agent Note 引入 `@deepseek-ai/dsh-hook-protocol`，一個**庫**（不是外掛程式——它不註冊也不注入任何東西），持有兩個橋接外掛程式共同相依性的真正相同的原語。共享與方言專屬之間的分界是本設計的重心。

## 決策

在 `packages/hooks/` 分組下新建 `hook-protocol` 作為純庫。它負責四類原語和 `hook/*` 工作階段事件；每個橋接外掛程式（`dsh-hooks-claude-code`、`dsh-hooks-codex`）擁有真正不同的部分。

**共享（本庫）：**
- **Matcher** — `matcherDiagnostic(pattern, mode)` 與 `matchesMatcher(pattern, query, mode)`。兩種方言的唯一差異收斂到 `mode` 參數：`claude` 將純 `[A-Za-z0-9_|]+` pattern 視為字面量（管道符表示多個精確匹配備選項），其他 pattern 視為正則；`codex` 始終使用未錨定正則。預設/`''`/`'*'` 匹配一切。每個橋接外掛程式會在解析 group 前忽略不支持的事件，丟棄受支持但沒有 matcher 匹配對象的事件上的 matcher 欄位，校驗其餘可執行 group；其中任何無效正則都會導致整份設定載入失敗，並給出包含方言／pattern／事件的穩定診斷，不會註冊任何掛鉤監聽器。執行時期匹配仍會將無效正則隔離為不匹配，因此直接呼叫本庫絕不向 agent loop（代理循環）拋例外。
- **執行** — `runHook(bash, hook, options)`。透過 `ctx.shell` seam 而非自建 `spawn` 執行命令掛鉤：執行器已提供清洗但可覆蓋的 env、行程組 kill 和逾時，正是協議所需的能力；`dsh-shell` 的 `stdin`/`env` 欄位（正是為此新增的）是行程內橋接外掛程式被允許使用的受信外掛程式 API。它將橋接外掛程式建置的 payload 序列化到 stdin（僅 CC 時追加尾部換行），遵守掛鉤的 `timeoutSec`（否則使用 `DEFAULT_HOOK_TIMEOUT_MS`，即兩種方言共享的 10 分鐘參考預設值），且從不拋例外（執行器拒絕變為 non-blocking-error 的 `HookOutput`）。
- **解碼** — `parseHookOutput(exit, stdout, stderr)`，exit-code + structured-stdout 編解碼器，產出方言無關的 `HookOutput`。Exit `0` → 寬鬆 JSON 解析 stdout；exit `2` → blocking error，`stderr` 為原因（以 `decision: 'block'` 呈現，呼叫方無需單獨處理 exit-code 分支）；其他 → non-blocking error。解析 CC structured-stdout 中在某條路徑上有消費端的欄位（`continue`/`stopReason`/`decision`/`hookSpecificOutput.{permissionDecision,additionalContext,updatedInput}`/`systemMessage`）；橋接外掛程式只採納對其方言有意義的子集。在任何路徑上都沒有消費端的欄位不予解析（CC 的 `suppressOutput`——掛鉤 stdout 在此處從不進入 transcript（文字記錄），因此無需抑制；見 [收緊掛鉤協議約定 Agent Note](../simplification/2026-07-04-tighten-hook-protocol-contract.md)）。
- **合併** — `mergeHookOutputs(outputs)`，將多個匹配掛鉤的輸出摺疊為一個最嚴格的 `MergedHookOutcome`：權限優先級 **deny > ask > allow**，停止狀態從首個 `continue:false` 起保持不變，阻止原因以 `\n\n` 拼接，上下文/system-messages 按序累積。
- **`hook/*` 工作階段事件** — `hook/invoked` / `hook/result`，透過聲明合併進入 `SessionEventMap`（僅日誌，如 `compaction/*`——不是 `SurfaceEventType`），配有 `appendHookInvoked`/`appendHookResult` 輔助函式，確保 invoked/result 配對與由所有者定義的執行關係在各橋接外掛程式間保持一致。`appendHookResult` 還負責定義持久化記錄的語義：decision 字串（掛鉤解析出的 decision，否則 `continue:false` 時為 `'stop'`，否則為 `'pass'`）和 500 字元的 `stderrSummary` 截斷均從本庫的 `HookOutput` 派生，而非各橋接外掛程式各自實作。

**方言專屬（橋接外掛程式）：** 建置每個事件的 stdin payload（CC 的 base 欄位集+各事件欄位集 vs Codex 的 snake_case 加 `turn_id`/`model` 額外欄位）、CC 方言的 env 與 `${CLAUDE_PLUGIN_ROOT}` 替換，Codex 則兩者皆無，以及將方言無關的 `HookOutput`/`MergedHookOutcome` 對映為 harness 各擴充點專屬的類型化 Decision（`PreToolDecision`、`PreStepDecision`、`ContinuationDecision`、`PostToolDecision`）。

## 曾考慮的替代方案

**單一參數化引擎。** 否決，因為 payload 建置與 decision 對映在方言間確實不同。Matcher、編解碼器、執行、合併規則和事件保持共享；每個橋接外掛程式保留自己的 payload 和對映，使其協定格式行為在程式碼中可就地閱讀。

## 後果

每個橋接外掛程式以原子方式解析設定、建置方言 payload、呼叫共享的 runner 與合併邏輯、對映 decision、追加 `hook/*`。協議測試覆蓋每種 matcher 模式與診斷、exit-code 與編解碼器欄位、runner 接線、合併優先級和審計輔助函式，逐文件 100% 覆蓋率；橋接外掛程式測試驗證庫的載入路徑並鎖定精確警告。無金鑰 ACP（Agent Client Protocol）快照透過真實 Loader/app 路徑啟動兩個橋接外掛程式，在非法 matcher 之前放置一個合法的阻塞 group，然後證明請求仍到達重播模型且沒有持久化任何 `hook/*` 行，從而避免手工掛載的上下文掩蓋部分註冊。`updatedInput` 已解析但僅記錄日誌並行出警告，直到 [input-rewrite 提案](../../proposed/feature/2026-06-30-pre-tool-input-rewrite.md)落地。
