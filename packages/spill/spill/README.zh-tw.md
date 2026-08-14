# @deepseek-ai/dsh-spill

[English](README.md) | 繁體中文

**`SpillStore`**（`ctx.spillStore`）定義 spill 後端做什麼，即持久化某個工具過大的文字，並返回面向模型的定位資訊與取回指引；它不規定如何實作。

該包是 spill 能力的三個組成部分之一。拆分後，各項關注點可獨立演進和替換：

| 包 | 職責 |
|---|---|
| `@deepseek-ai/dsh-spill`（本包） | Service Definition：抽象服務與詞彙類型 |
| `@deepseek-ai/dsh-spill-local` | Service Provider：位於宿主檔案系統中的私有工作階段級文件 |
| `@deepseek-ai/dsh-spill-policy` | Consumer：對過大最終結果執行 spill 的工具結果策略 |

這種拆分方式與 shell/fs seam 相同。未來的遠端或虛擬後端（例如 `spill://…` URI、資料庫鍵或後端專用取回工具）可實作此 Service Definition，無需修改策略外掛程式。

## 服務 API（`ctx.spillStore`）

| 成員 | 語義 |
|---|---|
| `saveText(input)` | 逐字保存 `input.content`；成功時返回 `SpillRef`（不透明定位資訊、寫入的精確位元組數和取回指引）。**發生真實儲存故障時，呼叫會以拒絕狀態結束**（權限、ENOSPC、後端不可用）；由呼叫方決定如何降級。 |

儲存操作以請求的 `owner` 工作階段作為保存時命名空間進行分組；後端自行選擇私有表示，並可以從呼叫方的 `suggestedName` 派生名稱，但絕不能將其當作可信路徑。該 seam 只負責儲存：不提供保留策略（由 [`@deepseek-ai/dsh-output-retention`](../../util/output-retention) 負責），不替換工具結果（由 `@deepseek-ai/dsh-spill-policy` 負責），也不提供取回/搜尋 API（後端的 `retrievalHint` 會告訴模型如何使用定位資訊）。

## 詞彙

`SaveTextSpill`（owner、source、suggestedName、content）是請求；`SpillRef`（locator、bytes、retrievalHint）是結果。`SpillLocator` 是[帶品牌類型](../../util/brand)的值，並以不透明字串的形式呈現給模型；對 `dsh-spill-local` 而言它是本機路徑，但未來的後端可以返回 URI、鍵或命令 token，無需修改策略／工具消費端。`SpillOwner.sessionId` 是保存時儲存命名空間：fork 後的工作階段會從種子日誌繼承現有定位資訊，無需複製或更改其歸屬；fork 後新產生的 spill 使用子工作階段 id。`SpillSource` 記錄產生該 spill 的 `toolName`、`callId` 和 `label`，供後端命名和檢查使用，不用於訪問控制。完整約定見 `src/types.ts`。

設計原理見[工具輸出 spill Agent Note](../../../.agents/notes/implemented/architecture/2026-07-08-tool-output-spill-files.md)，其中說明瞭為什麼建立操作應由執行時期 spill seam 而非面向模型的 `write` 工具承擔。

## 模型體驗

透過渲染後端定位資訊和取回指引的 spill 消費端間接影響模型。

#### KV Cache 影響

不會直接導致 KV Cache 失效；請求前綴變更由上述消費端負責。

## 已知限制與暫緩事項

- **該 seam 沒有取回或刪除 API**：消費端只能渲染後端的定位資訊與指引；生命週期和訪問語義仍由後端自行決定。
- **儲存不等於訪問控制**：`SpillOwner` 會區分寫入命名空間，但不會授予透過定位資訊讀取內容的權限；每個後端和取回消費端都必須自行強制執行訪問邊界。
