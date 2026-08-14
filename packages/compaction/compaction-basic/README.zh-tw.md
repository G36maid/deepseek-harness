# @deepseek-ai/dsh-compaction-basic

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

**基礎壓縮（compaction）後端**：`BasicCompactionEngine` 實作 `@deepseek-ai/dsh-compaction` Service Definition，使用可複用的 `ctx.tokenMeter` 壓力、token 預算保留與摘要。摘要是直接的一次性 `ctx.llm.stream()` 呼叫，它會重播工作階段前綴以複用提供方的 KV Cache（可在 `llm/stream` 處攔截）。

本包承擔壓縮能力的 Service Provider 角色；其約定見 [Service Definition 包](../compaction/README.md)，設計見 [能力 seam Agent Note](../../../.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md)。

## 擁有的職責

該後端擁有壓縮策略：

- **測量**：單例 `ctx.tokenMeter` 會在同一個已消費日誌 revision 上，計量最新一份規範化已記錄 envelope 與當前表層的 token 用量。因此，步驟邊界的壓力計量會包含實際系統提示詞、工具、路由、assistant 完成、工具結果、緩衝上下文與 steering（中途引導）。
- **路由策略**：主動壓力從擁有最新持久提供方／模型路由的配接器解析容量，再將預設策略與選填的精確目標覆蓋縮放為具體 token 預算。模型發現仍僅供參考，不參與此處的策略解析。
- **不相依性模型的剪枝**：在壓力或規範溢位符合條件後，選填的 [`ctx.toolResultPruner`](../compaction-tool-result-pruner/README.md) 服務會在選擇範圍之前改寫超大工具結果。Compact-basic 透過 `ctx.tokenMeter` 重新測量；如果壓力已回到安全範圍，就跳過摘要，否則對已剪枝的表層進行摘要。低於壓力的步驟檢查絕不剪枝。
- **保留**：壓縮最舊的完整表層單元，同時保留近期尾部，並透過 [`dsh-compaction` 邊界 helper](../compaction/README.md#tool-pairing-boundaries) 將切分點調整到工具呼叫／結果配對平衡的位置。輪次邊界不會保護失控輪次內的舊步驟。尚未閉合且不可分的尾部會在閉合前拒絕壓縮。當閉合的超大工具單元以文字型結果為可移除主體時，選填 pruner 可以修復它；不可分的非工具單元與不可剪枝的工具剩餘部分不在範圍內。
- **收斂**：最多按 `compactionRetries` 重試頭部檢查點壓縮；拒絕不能縮小源內容的摘要，如果重試仍無法回到閾值以下，則拋出例外。
- **摘要**：直接 `llm/stream` 呼叫使用已設定的提供方／模型對與上限，回退到最新已記錄請求目標，然後再回退到 agent（代理）目標，而不執行僅用於 agent loop 的 `agent/request` 擴充點。該呼叫會逐字重播工作階段自身的系統提示詞、工具與已遮蔽區域訊息（包括圖片引用），並將壓縮指令作為最後一條 user 訊息追加，從而複用提供方的熱前綴 cache，而非使它失效。所選配接器必須解析或明確拒絕這些圖片。它將 `GenerateOptions.purpose` 設為 `compaction`，配接器可將其作為請求歸因轉發（DeepSeek 配接器傳送 `x-deepseek-harness-compact: 1`），但不會觸碰模型可見的請求體。只有返回的文字會進入檢查點；推理（reasoning）和工具呼叫都會被排除，以免洩露私有推理或產生殘留呼叫；圖片輸出會以 `UNSUPPORTED_CONTENT` 失敗，而不是消失。
- **框定**：替換 user 訊息使用 `<compacted-summary>` 標籤標記已建立的檢查點上下文。原始摘要保留在 `compaction/summary` 事件上，後續自動週期會合並之前的檢查點。
- **生命週期**：所有入口點共享一個先記錄標記的區域交易。它會驗證範圍與活動鎖，同步追加 `compaction/start`，準備並等待摘要，重新驗證，再追加 `compaction/summary` 和替換，最後恰好進行一次閉合嘗試。自動呼叫和顯式範圍呼叫要求數字標識的開放輪次歸屬，並要求整個表層保持穩定；序列 `agent/pre-step` listener 會在派生請求之前檢查壓力，而規範提供方溢位則經由 `agent/request-error` 進入，並且只在表層取得持久進展後才允許重試。`compactNow()` 會預留空閒接納，使用 `turn: null`，允許所選 span 之外追加僅附加上下文，flush 每次已閉合嘗試，並在 `finally` 中釋放接納預留。
- **溢位復原**：提供方已確認的溢位不需容量中繼資料。它會繞過常規壓力與保留，執行剪枝，再嘗試一次最大平衡頭部縮減，並留下最新不可分單元。只要 `surface.replaceGeneration` 前進，就允許重試，包括剪枝在後續摘要工作拋出例外前已落地的情況。如果沒有替換、目標特定上限已耗盡、已取消，或遇到未知／非規範錯誤，則保留原始提供方失敗。
- **失敗處理**：活動的未匹配 `compaction/start` 是持久鎖。位於較新 `session/end-seed` 之前的未匹配標記，是先前生命週期留下的過時證據，不會阻塞；位於該邊界之後的標記報告 `busy`。摘要和 span 變更失敗會以錯誤閉合，並保持工作階段表層不變，但日誌中仍保留該嘗試。閉合失敗會有意留下阻塞性的未匹配標記。壓力檢查中的執行故障會發出警告並繼續；只有此前沒有替換推進表層時，溢位復原失敗才保留原始提供方錯誤。完成清理與持久化後，取消仍具有最終決定權。

受保護的 `summarize()` 方法是唯一的子類掛鉤。基於樣板或遠端摘要器的子類可以覆蓋該方法，同時壓力、保留、被引用的源事件、縮減驗證與已遮蔽 token 計量仍由 `ctx.tokenMeter` 負責。掛鉤返回安全摘要，以及完整提供方輸出、呼叫 envelope 和可用時的 usage（`{ summary, rawOutput?, llmStreamCall?, provider, model, maxTokens?, usage? }`）；`llmStreamCall: true` 表示生成該結果時恰好透過此上下文的 `ctx.llm.stream()` 發起了一次呼叫，且必須提供完整的 `rawOutput`；未帶標記的 `rawOutput` 並不能判定呼叫路徑。交易會在 `compaction/summary` 上保留這些欄位。

## 設定（`BasicCompactionConfig`）

所有設定都選填。頂層策略欄位是每個已路由模型的預設值；`modelPolicies` 對精確提供方／模型對應用部分覆蓋。出現壓力時，compaction-basic 會請求所屬 LLM（大型語言模型）配接器提供該路由的上下文容量，並解析絕對預算。無法識別的設定鍵、重複目標、互斥保留形式，以及合併後的 `retainRatio` 不低於 `thresholdRatio`，都會使外掛程式載入失敗。不低於縮放後閾值的絕對 `retainTokens` 預算會在首次解析出目標時導致失敗，因為該比較需要模型容量。

| Key | 必填 | 含義 |
|---|---|---|
| `thresholdRatio` | 否（預設 `0.8`） | 在 `floor(routedContextWindow × ratio)` 處壓縮。 |
| `retainRatio` | 否（預設 `0.16`） | 以已路由上下文視窗的一部分表示逐字保留的近期表層預算；與 `retainTokens` 互斥。 |
| `retainTokens` | 否 | 逐字保留的近期表層絕對預算；與 `retainRatio` 互斥，並且必須低於已解析閾值。 |
| `summarizationProvider` | 否（預設 `''`） | 與 `summarizationModel` 一起設定；空對會解析為最新已記錄請求目標，再回退到 `AgentOptions` 對。 |
| `summarizationModel` | 否（預設 `''`） | 與 `summarizationProvider` 一起設定；空對會解析為最新已記錄請求目標，再回退到 `AgentOptions` 對。 |
| `maxTokens` | 否（預設 `8192`） | 摘要呼叫的提供方生成上限；可包含推理 token。 |
| `compactionRetries` | 否（預設 `1`） | 壓力仍高於閾值時，在首次嘗試後進行的額外嘗試次數。 |
| `maxOverflowRetries` | 否（預設 `1`） | 規範上下文視窗溢位後的最大重試次數；`0` 只停用復原。 |
| `modelPolicies` | 否（預設 `[]`） | 精確的 `{ provider, model, ...partialPolicy }` 覆蓋；匹配使用兩個欄位，不相依性 `listModels()`。 |
| `auto` | 否（預設 `true`） | 註冊步驟邊界壓力與溢位復原 listener。設為 `false` 則僅手動執行。 |

每個 `modelPolicies` 設定項都接受上述策略欄位，但不接受 `auto` 和 `modelPolicies` 自身。如果設定項提供任意一個保留欄位，就替換預設策略的保留選擇；否則繼承保留設定。摘要提供方／模型在每個設定項內仍然成對。

配接器可能無法為有效動態路由返回容量，已解析容量也可能暴露無效的絕對保留預算。此時手動壓力檢查會拋出目標特定設定錯誤；自動 listener 會對該精確目標警告一次，並攜帶完整歷史繼續。不相關的操作性失敗仍會獨立可見。規範提供方溢位仍會嘗試復原，因為提供方已確立壓縮的必要性。

## 用法

`BasicCompactionEngine` 需要 `ctx.llm`、`ctx.tokenMeter` 和 `ctx.sessions`。以下組合從其宿主接收 `ctx.llm`，並安裝另外兩項服務：

```ts
import type { Context } from '@deepseek-ai/cordis'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import SessionStore from '@deepseek-ai/dsh-session'
import TokenMeter from '@deepseek-ai/dsh-token-meter'

export const name = 'compaction-basic'
export const inject = ['llm']

export function apply(ctx: Context): void {
  ctx.plugin(SessionStore)
  ctx.plugin(TokenMeter)
  ctx.plugin(BasicCompactionEngine)
}
```

載入外掛程式會註冊 `ctx.compaction`。在該外掛程式之前新增同級 [`dsh-compaction-tool-result-pruner`](../compaction-tool-result-pruner/README.md) 以啟用選填的不相依性模型的處理階段。當 `auto: true`（預設）時，它會在 token 壓力下自動壓縮。同級 [`dsh-command-compact`](../command-compact/README.md) 呼叫 `ctx.compaction.compactNow(...)`；程式設計呼叫方也可以直接使用任一 seam 操作。

例如，同一個壓縮外掛程式可以安全服務於容量不同的模型，並應用一項目標特定策略：

```yaml
- name: '@deepseek-ai/dsh-compaction-basic'
  config:
    thresholdRatio: 0.8
    retainRatio: 0.16
    modelPolicies:
      - provider: local
        model: small-context
        thresholdRatio: 0.7
        retainTokens: 2048
```

## 模型體驗

### 工作階段歷史

#### 模型看到的內容

成功步驟越過閾值後，如果已載入選填 pruner，超大工具結果會先被改寫。如果仍需摘要，下一個請求會收到下方檢查點前導、一個空行、`<compacted-summary>`、根據資料生成的摘要以及 `</compacted-summary>`。溢位復原會根據使表層前進的任何替換重建立即重試。檢查點會替換已選較早範圍，後面跟隨已保留的近期單元。

##### 工作階段檢查點前導

```markdown
This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.
```

#### Token 影響

不相依性模型的剪枝可以完全避免輔助呼叫；否則它會在摘要替換較早範圍之前縮減該呼叫的 transcript（文字記錄）。替換會縮減未來輸入歷史，而非追加第二份副本。摘要會保留到後續壓縮將其替換，但不可分的非工具單元仍可能超出預算。

#### KV Cache 影響

它是替換，而非僅附加。每個檢查點都會使從第一個已替換歷史 token 起的複用失效；該範圍之前未更改的請求前綴仍可複用。

### 輔助摘要器請求

#### 模型看到的內容

摘要模型會接收逐字重播的工作階段：與上次已路由請求為已遮蔽區域傳送的相同系統提示詞、工具 schema 與訊息，後面跟隨一條最終 user 訊息，即下方壓縮指令。工作階段模型絕不會看到該私有請求或其推理；只有返迴文本會被儲存。

##### 壓縮指令（最終 user 訊息）

```markdown
You are now acting as a compaction engine for this AI coding assistant. Condense the conversation ABOVE into a structured checkpoint that lets another model resume the work with no loss of essential context.

Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write "(none)" for an empty section — never drop a section.

## Primary Request and Intent
- [the user's original and evolving goals; quote verbatim where the exact wording matters]

## Key Technical Concepts
- [technologies, frameworks, patterns, and conventions in play]

## Files and Code
- [exact path: why it matters, key changes or snippets]

## Errors and Fixes
- [error: how it was resolved, plus any related user feedback]

## Pending Jobs
- [explicitly requested work not yet completed]

## Current Work
- [precisely what was in progress at this checkpoint]

## Next Step
- [the single next action, directly in line with the most recent request, or "(none)"]

## Critical Context
- [decisions and their rationale, constraints, user preferences, open questions, data needed to continue]

Rules:
- Write concise English engineering prose. Preserve exact file paths, commands, error strings, identifiers, numeric values, function signatures, and syntax fragments.
- Capture user feedback and explicit instructions faithfully, especially corrections.
- Do NOT mention this summarization request or that the context was compacted.
- Output only the checkpoint text: do not call any tool or take any other action.
- If the conversation already contains a <compacted-summary> block, it is a PRIOR checkpoint. Do not copy it forward verbatim: preserve still-true facts, drop stale ones, and merge newer information into a single consolidated summary under the same structure.
```

#### Token 影響

這是一次獨立模型呼叫：輸入是已重播工作階段前綴加固定指令，輸出受 `maxTokens` 限制。收斂重試可能多次付款這項成本。

#### KV Cache 影響

已重播系統提示詞、工具與已遮蔽區域訊息與工作階段最後一個已路由請求逐字匹配，因此提供方的熱前綴 cache 可複用至尾隨指令之前；只有該指令與摘要輸出未快取。將摘要器路由到不同提供方／模型，或壓縮非頭部範圍，都會放棄該複用。

## 已知限制與暫緩事項

- **計量準確度取決於固定啟發式規則**：可複用提供方用量缺失時，會回退到字元數加結構開銷，而非精確的 token 化。
- **溢位分類由配接器維護**：提供方措辭可能改變；兩個 DeepSeek 配接器將當前可識別的上下文限制失敗規範化為 `CONTEXT_WINDOW_EXCEEDED`。
- **部分不可分單元與僅 envelope 溢位仍不在表層壓縮範圍內**：復原無法縮減系統／工具／前綴、拆分不可分的非工具節點，或修復不可剪枝剩餘部分仍超出視窗的工具單元。選填 pruner 可以縮減原本不可分工具對內的文字型工具結果主體。
- **`compactRegion` 要求存在未結束的輪次**：在完全關閉的工作階段上手動呼叫會拋出例外（「no open turn」），而不是執行壓縮。
- **摘要失敗會保留最新持久表層**：任何替換前，自動路徑會記錄警告，並攜帶完整超預算歷史繼續。如果剪枝已落地，後續摘要失敗會從該持久剪枝表層繼續。因達到 `maxTokens` 而發生的摘要截斷（隱藏推理 token 可能會耗盡該額度）遵循同一規則。
