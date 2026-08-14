# @deepseek-ai/dsh-llm-replay

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

用於無金鑰快照測試的 LLM（大型語言模型）重播外掛程式。它根據已記錄的**工作階段 JSONL** fixture（測試前置資料）重建模型流，使測試無需 API 金鑰即可針對固定的模型 transcript（文字記錄）啟動真實 agent（代理）。設定 `providers` 後，它會註冊僅用於重播的配接器，其模型目錄可供測試模型發現功能的場景使用；未設定 `providers` 時，它會安裝無需模型發現功能的測試所用 catch-all `llm/stream` waterfall（瀑布式事件）。

其消費端包括 ACP（Agent Client Protocol）與 headless `stream-json` 快照套件，以及 Web 瀏覽器 e2e 管線。Loader 驅動的套件使用此外掛程式替代真實 LLM 配接器；Web 管線直接安裝它，以保留清理階段的消費檢查控制代碼。

## fixture 的工作方式

fixture 就是持久化的工作階段日誌（`<scenario>/session.jsonl`）。其 `assistant/chunk` 事件包含每個 `StreamChunk`，因此按 `(turn, step)` 分組即可重建每次 agent loop（代理循環）的 `stream()` 呼叫的區塊序列。壓縮（compaction）摘要器成功時，日誌記錄方式有所不同：當 `compaction/summary` 攜帶 `llmStreamCall: true` 和完整的 `rawOutput` 時，重播會在該事件的位置重建一條規範成功流，其中每個塊各使用一對 `block-start`/`block-end`，帶上已記錄的用量（如有），並以 `stop` 終止。提供方增量的精確切分不屬於持久壓縮結果。不帶該標記的 `rawOutput` 並不意味著發生了本機 LLM 呼叫，因為範本摘要器和遠端摘要器即使未使用此上下文的配接器，也可能保留完整輸出。

因此，錄制就是「執行一次真實 agent 並收集 `.jsonl`」，由快照 harness 完成；該外掛程式本身不錄制。fixture 的 `request/header` 內容可能被標記化為 `{{system}}`/`{{tools}}`（harness 會在一個場景中固定該內容，並清除其餘場景中的內容）；重播不受影響，因為派生過程只讀取 `assistant/chunk` 和 `compaction/summary` 事件以及第 0 行的工作階段 header。

有兩種失敗模式無法僅根據 `assistant/chunk` 重建：在產生任何區塊前直接拋出例外（例如 HTTP 401，此時日誌只有 `turn/end {error}` 而沒有區塊），以及取消或掛起（差異在時序，而非區塊內容）。需要這些行為的場景可提供伴隨檔案（`<scenario>/replay.override.json`）：它可以替換派生指令碼（裸 `ReplayEntry[]`），也可以增補派生指令碼（`{ patches: [{ at, entry }] }`：保留所有從 JSONL 派生的呼叫，只替換指定的從 0 開始計數的呼叫索引；當 `at` 等於派生長度時，則在注入瞬態例外後的重試位置追加一次呼叫）。修補程式索引不得重複。文件載入時會校驗覆寫文件、每個修補程式和條目，以及每個區塊的判別標籤。`hang` 條目可以指定 `readyFile`；當前綴區塊到達迴圈後、開始等待取消前，重播會寫入這個空標記，使外部驅動程式無需觀察展示層更新即可確定性地取消。

指令碼字串可以內嵌 `{{fromRequest:<regex>}}`，用來填入靜態伴隨檔案不可能預知的值——例如模型必須原樣回填到 `update_goal` 的隨機生成 goal id。重播時每個佔位符針對即時請求解析：語料是請求訊息的所有字串葉子按換行拼接的結果，取該模式在語料中的最後一次匹配，用其第一個捕獲組（無捕獲組時用整個匹配）原位替換。模式匹配不到內容、模式非法、佔位符未閉合都會明確報錯。連續右花括號串的最後兩個花括號纔是佔位符結束符，因此模式可以以花括號量詞收尾（如 `[0-9a-f]{4}`），但不能在 `}}` 之後還有後續模式內容。解析作用於所有指令碼條目，包括從已記錄 JSONL 派生的條目——若錄制文字本身合法地含有該字面量標記，需改用不含標記的伴隨檔案表達。

## 巢狀 agent：每工作階段鍵控

父 agent 委託給行程內 subagent 的場景會記錄多個日誌：父工作階段使用 `session.jsonl`，每個子工作階段各使用一個日誌（`session.1.jsonl` 等）。每個 agent 都在同一上下文中作為獨立的 `Session` 執行，因此重播必須為每個 agent 提供各自的指令碼。

重播根據發起呼叫的工作階段 id 為每次呼叫建立鍵（`GenerateOptions.sessionId` 由 agent loop 寫入）。即時工作階段 id 每次執行時期都會重新隨機生成，絕不會等於記錄中的 id，因此即時工作階段按**首次呼叫順序**綁定到已記錄指令碼：指令碼按 header 中的 `createdAt` 排序（父工作階段在前，因為它必須先開始流式輸出才能委託）；第一個發起呼叫的即時工作階段取得第一個指令碼，下一個新工作階段取得下一個指令碼，以此類推。此後每個工作階段分別推進自己的遊標。沒有 `sessionId` 的呼叫視為一個綁定主指令碼的匿名工作階段。不同即時工作階段的數量超過已記錄指令碼數時會明確報錯。

## 設定

| 鍵 | 類型 | 預設值 | 說明 |
|---|---|---|---|
| `file` | string | `$DSH_SNAPSHOT_FILE` | 主（父）`session.jsonl` fixture 的路徑。必需（設定或 env）。 |
| `overrideFile` | string | `$DSH_SNAPSHOT_OVERRIDE` | 主工作階段的選填 `ReplayOverrideDoc` 伴隨檔案：裸 `ReplayEntry[]` 替換其派生指令碼，`{ patches }` 則按呼叫索引增補該指令碼。 |
| `childFiles` | string[] | `$DSH_SNAPSHOT_CHILD_FILES`（以路徑分隔符分隔） | 巢狀場景中已記錄的 subagent 子工作階段日誌；單工作階段場景為空。 |
| `providers` | `ReplayProviderConfig[]` | 無 | 選填的僅重播提供方和模型目錄。每個提供方可以設定 `retryPolicy`，每個模型可以發布 `contextWindow` 和僅包含 `text`、`image` 的 `inputModalities` 陣列；模態設定無效時，外掛程式載入會失敗。已設定路由透過重播配接器分派，絕不執行提供方 I/O。 |
| `paceMs` | number | 無（突發） | 選填的每區塊延遲（單位為毫秒），使下游傳輸（例如真實瀏覽器觀察到的 Web SSE（Server-Sent Events）多路複用器）看到真正的增量傳遞。它只是用於提高真實性的調節項，測試不得相依性它保證正確性。值必須是非負整數；pace 等待期間中止會迅速取消流。 |

```yaml
- id: llm-replay
  name: '@deepseek-ai/dsh-llm-replay'
  config:
    providers:
      - id: deepseek-official
        name: DeepSeek
        retryPolicy:
          mode: normal
          backoff:
            initialDelayMs: 1
            maxDelayMs: 1
            jitterRatio: 0
        models:
          - id: deepseek-v4-flash
            contextWindow: 128000
          - id: deepseek-v4-pro
  # file/overrideFile/childFiles default to $DSH_SNAPSHOT_FILE /
  # $DSH_SNAPSHOT_OVERRIDE / $DSH_SNAPSHOT_CHILD_FILES, set by the snapshot
  # harness per scenario.
```

## 匯出項

- `installLlmReplay(ctx, config)`：安裝已設定重播配接器或 catch-all `llm/stream` 監聽器；返回 `ReplayHandle`（包含用於保證 HMR（熱模組替換）安全的 `dispose()`，以及清理階段執行的 `assertConsumed()` 檢查；後者確保每個已記錄指令碼都綁定到即時工作階段，且每個已綁定遊標都已耗盡，從而將場景靜默驅動的模型呼叫少於記錄數轉換為明確診斷）。在測試中使用它，可以不透過 Loader 或 env var 驅動重播。
- `loadSessionScripts(config)`：解析場景中有序的 `SessionScript[]`（主工作階段 + 子工作階段），準備按首次呼叫順序綁定到即時工作階段。
- `loadReplayScript(config)`：只解析主工作階段的 `ReplayEntry[]`（如果伴隨檔案存在，則使用經校驗的替換或修補程式；否則從 JSONL 派生；fixture 缺失時明確報錯）。
- `deriveReplayScript(events)` / `parseSessionLog(text)` / `parseSessionHeader(text)` / `resolveScriptedEntry(entry, messages)`：將已記錄工作階段日誌中的普通 loop 區塊和顯式標記的本機壓縮輸出轉換為指令碼、讀取其 header `id`/`createdAt`、並針對單次即時請求解析 `{{fromRequest:...}}` 佔位符的純輔助工具。派生的 assistant 分組必須以 `finish` 區塊結束；沒有該區塊的分組是 `stream()` 拋出例外的指紋，必須改用 override 伴隨檔案表達。
- 類型 `ReplayEntry` / `ReplayOverrideDoc` / `ReplayOverridePatch` / `SessionScript` / `ReplayConfig` / `ReplayProviderConfig` / `ReplayModelConfig` / `ReplayHandle` / `Config`。

## 外掛程式匯出形態

命名匯出 `name` / `inject` / `Config` / `apply`，且**沒有默認匯出**：Cordis Loader 的 `unwrapExports` 執行 `exports.default ?? exports`，因此意外的默認匯出會將模組摺疊為函式本身，並丟棄 `inject` 命名空間（見 [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)）。

## 模型體驗

無。該無金鑰測試配接器不向提供方模型傳送請求，只將已記錄 assistant 區塊重播到測試 loop 中。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **首次呼叫順序指令碼綁定假設序列委託**：一種並行執行同級 subagent 的實作會非確定性地將即時工作階段綁定到已記錄指令碼；在這種場景出現前暫不實作更強的鍵控（`XXX(concurrent-subagents)`）。
- **只有普通 loop 區塊和帶標記的本機壓縮輸出才能派生**：在產生區塊前直接拋出例外、取消/掛起，或未標記的外部摘要器呼叫場景需要 `replay.override.json` 伴隨檔案。替換和修補程式兩種形式都隻影響主工作階段；子工作階段指令碼仍從各自日誌派生。
