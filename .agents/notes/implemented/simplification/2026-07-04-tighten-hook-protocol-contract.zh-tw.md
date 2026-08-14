# Agent Note: 收緊 hook-protocol 約定——dialect、被丟棄的欄位、雙重預設值與 lib 擁有的 `hook/result` 語義

Status: implemented

[English](2026-07-04-tighten-hook-protocol-contract.md) | [简体中文](2026-07-04-tighten-hook-protocol-contract.zh.md) | 繁體中文

## 問題

`dsh-hook-protocol`/bridge 約定中有四部分沒有遵守 [subagent observe/enrich Agent Note](../../archived/feature/2026-06-30-subagent-observe-enrich.md) 記下的準則——後者因缺少消費端而刪除 `agentType` 生命週期欄位，以下各項沒有透過同一檢驗：

1. **`HookDialect` 的 `'native'` 變體**（`packages/hooks/hook-protocol/src/types.ts`）沒有生產者——bridge 會標記 `'claude'` 和 `'codex'`；所有位置中唯一構造 `'native'` 的是該庫自己的單元測試。欄位自身的 JSDoc 將 `dialect` 定義為「執行它的 bridge」，而 native 不是 bridge：[攔截擴充點 Agent Note](../feature/2026-06-30-interception-extension-points.md) 記載 native 掛鉤不是一個包，並且「native 外掛程式無需持久掛鉤日誌即可使用類型化 Decision」；旗艦 native 外掛程式實踐示例恰好斷言了這一點（完全沒有 `hook/*` 事件）。
2. **`HookOutput.suppressOutput`**（同一文件）被 codec 解析後在所有路徑上均被丟棄：沒有 bridge 分支處理它、沒有合併 fold、沒有 warn、沒有 deferred-list 行——在所有「被解析但未兌現」的同類欄位中它是唯一沒有明確延期聲明的（`updatedInput` → 一條 warn 日誌加 [pre-tool-input-rewrite 提案](../../proposed/feature/2026-06-30-pre-tool-input-rewrite.md)；`systemMessage` → 一條 warn 日誌加 README deferred 行；`continue`/`stopReason` → 一個 `TODO(hook-continue-false)` 錨點加 `'stop'` decision 記錄）。從結構上看根本無物可抑制：掛鉤 stdout 從不進入任何 transcript（文字記錄）；上下文僅透過 `additionalContext` 流入，日誌也只記錄 `decision`/`stderrSummary`。因此，掛鉤作者設定 `suppressOutput: true` 得到的是無聲的空操作，且無任何警告。
3. **`defaultTimeoutMs` 在兩個 bridge 設定中都以遊離的字面量重複設定了預設值**——schema 的 `.default(600_000)` 加上一個 `?? 600_000` 回退（`packages/hooks/hooks-claude-code/src/index.ts`、`packages/hooks/hooks-codex/src/index.ts`），一個協議級常數在每個 bridge 中有兩個歸屬地，兩個 bridge 可能在共享預設值上悄然分歧。*按 no-hardcoded-tunables 規則，該旋鈕保留為 bridge 擁有的顯式設定（旁邊有 `stderrSummaryMaxChars`）；要修的是字面量的歸屬地。*
4. **`hook/result` 的語義存在於兩個 bridge 中（各一份），而非擁有該事件的 lib。** `summarize()`——stderr 截斷規則——在 `packages/hooks/hooks-claude-code/src/index.ts` 與 `packages/hooks/hooks-codex/src/index.ts` 中逐位元組相同；decision 字串規則 `output.decision ?? (output.continue === false ? 'stop' : 'pass')` 同樣如此。然而 `dsh-hook-protocol` 聲明瞭 `hook/result`、在文件中將 `stderrSummary` 描述為「已截斷」卻不擁有截斷邏輯，記錄了 decision 值卻不擁有對映邏輯。如果某個 bridge 漂移（不同的上限、不同的回退），共享持久化事件的語義就會悄然分叉。

## 決策

`HookDialect` 是封閉的 bridge 集合：`'claude' | 'codex'`；`HookOutput` 移除了不受支持的 `suppressOutput`。`hook/result.durationMs` 保留為持久化的審計計時，僅在快照中做歸一化。參考預設值各只存在一處：`DEFAULT_HOOK_TIMEOUT_MS` 與 `DEFAULT_STDERR_SUMMARY_MAX_CHARS`。`HookResultRecord` 與 `appendHookResult` 共同負責兩個 bridge 的 stderr 摘要化和 decision 推導邏輯。`BLOCKING_EXIT_CODE` 為 codec 內部常數。

## 曾考慮的替代方案

### 為什麼不保留它們？

不受支持的詞彙可以在真正有消費端時回歸。`durationMs` 保留，因為持久化的審計計時獨立於當前是否有讀取方而有價值。Bridge 特有的 payload 構造留在各自 bridge 中，而共享持久化事件的歸一化屬於協議庫。

## 驗證

`HookDialect` 僅包含 Claude 和 Codex，`suppressOutput` 在原始碼、已解析欄位文件和歸一化邏輯中均不存在。`durationMs` 保留在事件和 fixture（測試前置資料）中，重播時做清洗。`600_000` 和 `500` 兩個預設值各只在協議庫中出現一次；每個掛鉤的逾時覆蓋仍然生效；兩個 bridge 的測試套件均驗證了由庫擁有的 stderr 截斷和 decision 規則。

## 後果

`dialect`、`suppressOutput`、可調參數和語義變更在協定格式（wire format）和預期輸出中均不可見。代價是 `dsh-hook-protocol` 和兩個 bridge 中的改動——在預發布立場下成本很低，也比讓一項持久事件語義的兩個副本各自老化更便宜。
