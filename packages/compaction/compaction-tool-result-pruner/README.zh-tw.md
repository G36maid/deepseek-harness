# @deepseek-ai/dsh-compaction-tool-result-pruner

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

可安全重播、不相依性模型的剪枝服務（`ctx.toolResultPruner`）。它會將超出預算的 `tool/result` 表層節點改寫為長度受限的頭部、固定省略標記和長度受限的尾部，同時在僅附加工作階段日誌中保留完整原始事件。

這是 [`dsh-compaction-basic`](../compaction-basic/README.md) 的具體配套服務，不是壓縮（compaction）後端或面向模型的工具。Compact-basic 透過選填的 `ctx.get('toolResultPruner')` 讀取它，因此這兩個包仍可各自獨立組合。

## 服務 API

`pruneSession(session)` 會掃描當前表層的一個穩定快照。每個超出預算的工具結果都會被一個新追加的 `tool/result` 替換，其攜帶 `{ surfaceOp: { op: 'replace', start: originalSeq, end: originalSeq }, sourceEventSeqs: [originalSeq] }`。替換會展開完整原始資料，只更改 `content`，保留 `turn`、`step`、`callId`、錯誤欄位、`meta` 以及以後新增的資料欄位。原始事件仍可用於持久化、重播和精確日誌檢查。

當工作階段拒絕替換時，該方法會同步拋出例外。本次掃描中先前已提交的替換仍會保留。

`measureContent(blocks)` 會統計 `text` 塊中的 Unicode 碼點。`pruneContent(blocks)` 會返回長度受限的替換；如果內容已在閾值內，則返回 `null`。非文字塊保持原始相對位置；文字切片絕不會拆分 UTF-16 代理項對，但可能拆分由多個碼點組成的字素簇。

每個寄出的結果在文字碼點上都精確包含已設定的頭部預算、固定標記和尾部預算，不大於 `thresholdChars`，且嚴格小於觸發輸入。因此第二次掃描不會發出替換。

## 設定

無法識別的設定鍵會使外掛程式在構造時失敗。已解析設定與輸入脫離，並且深度不可變。

| 設定鍵 | 必填 | 含義 |
|---|---|---|
| `thresholdChars` | 否（默認 `8192`） | 合併文字超過此 Unicode 碼點數時剪枝。 |
| `headChars` | 否（默認 `4096`） | 保留的開頭 Unicode 碼點數。 |
| `tailChars` | 否（默認 `1024`） | 保留的末尾 Unicode 碼點數。 |

所有值都必須是整數；閾值必須為正數，頭部／尾部必須為非負數。`headChars + marker + tailChars` 之和不得超過 `thresholdChars`，因此有效設定可以剪枝每個超出預算的結果，不會成長或重複改寫。

## 用法

```ts
import type { Context } from '@deepseek-ai/cordis'
import ToolResultPruner from '@deepseek-ai/dsh-compaction-tool-result-pruner'

export function apply(ctx: Context): void {
  ctx.plugin(ToolResultPruner)
}
```

## 模型體驗

### 已剪枝的工具結果

#### 模型看到的內容

一旦滿足壓縮觸發條件，後續請求看到的將是保留的頭部、`\n\n[... tool result middle pruned ...]\n\n` 和保留的尾部，而非被移除的文字。非文字塊保持原有順序。模型不會看到原文的第二份副本。

#### Token 影響

每個已改寫工具結果最多包含 `thresholdChars` 個文字碼點。剪枝本身不會發起模型呼叫；重新測量的請求低於壓力閾值時，compaction-basic 會跳過摘要，否則摘要器會讀取已剪枝的表層。

#### KV Cache 影響

替換較早的結果會使從第一個改變的 token 起的複用失效。當其路由、envelope 與之前的歷史保持一致時，已剪枝前綴可以複用。

## 已知限制與暫緩事項

- **字元預算不是 token 預算**：不同提供方的 token 密度各異，因此 `ctx.tokenMeter` 仍負責判定剪枝是否緩解了請求壓力。
- **剪枝只基於文法**：它保留開頭與結尾，不解釋中間哪些行在語義上重要。
- **字素簇可能被拆分**：按碼點切片可保護代理項對，但不會執行感知區域設定的字素簇分割。
