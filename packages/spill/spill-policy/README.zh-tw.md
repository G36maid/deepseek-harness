# @deepseek-ai/dsh-spill-policy

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

**工具結果 spill 策略**：一個 `tools/post-execute` 轉接器，用於防止過大的純文字工具結果進入模型上下文。當最終結果超過 `maxInlineBytes` 時，它會透過 [`ctx.spillStore`](../spill) 保存完整文字，並將面向模型的結果替換為有界的首尾預覽、後端定位資訊與取回指引。

該外掛程式**不註冊任何服務**，也不負責儲存或預覽機制：預覽由 [`@deepseek-ai/dsh-output-retention`](../../util/output-retention)（`TextRetainer`）負責，儲存由 `ctx.spillStore` 負責。它只決定何時 spill，並組合通知。

## 設定

| 鍵 | 預設值 | 含義 |
|---|---|---|
| `maxInlineBytes` | *（省略）* | 面向模型的純文字結果上下文上限，以 UTF-8 位元組數計（在載入時驗證為非負整數）。**省略時完全停用該策略**（外掛程式不註冊任何內容）。設定後，超過該上限的結果會被 spill，並替換為從同一預算派生的預覽（首尾拆分）。 |

## 行為

1. 允許工具執行（透過 `next()` 委託，因此可以限制任何下游掛鉤接受的結果）。
2. 跳過巢狀執行（存在 `exec.parent`——其持久化副本由下方的 dispatch-log 分支設界）、已接受的值替換（登錄檔必須重新驗證並重新渲染它們）、`read`（避免 `read → spill → read again` 迴圈）以及任何非 `accept` 決策（`block` 的糾正回饋會原樣透過）。
3. 僅在已接受的內容為**純文字**（全部都是 `text` 塊）時才將其展平；包含任何非文字塊的結果都保持不變。
4. 如果 UTF-8 大小為 `≤ maxInlineBytes`，則保持不變。
5. 否則，保存完整文字，並將結果替換為預覽和以下通知。系統會調整大小，使整個替換內容（預覽、空行和通知）不超過 `maxInlineBytes`：先從預算中保留通知所需位元組，再縮小預覽以適配剩餘空間，因此面向模型的結果絕不會超過上限：

   ```text
   <retained head/tail preview>

   (Omitted N bytes. Full formatted result stored at: /…/session-…/…-web_fetch.txt. Use read with offset/limit, or grep this path to search within it.)
   ```

   當通知本身已佔滿預算時（上限極小或定位資訊很長），預覽為空，只返回通知。如果僅通知的替換內容仍會超過 `maxInlineBytes`，策略將保留內聯結果；它絕不會發出超過上限的替換內容（而且上限內的替換內容總比原結果更小，因此這也意味著 spill 絕不會增加位元組數）。

**盡力而為**：沒有工作階段所有者、沒有 `ctx.spillStore` 後端，或 `saveText` 返回拒絕 ⇒ 策略記錄警告並返回原始結果。spill 失敗絕不會將成功呼叫變為 `isError`，也不會隱藏內聯結果。成功替換時只會更改 `content`；規範的程序化值保持不變。

**dispatch-log 分支：**註冊在 `tools/code-dispatch-log` 上的第二個監聽器，把同一套上限、替換管線與盡力而為的回退應用到每個 `run_code` 子呼叫結果的持久化副本上（產物標籤為 `dispatch`，按子呼叫 id 歸檔）。程序的值不受影響，因為它早已完整跨過 worker 邊界；`read` 子呼叫同樣設界：日誌副本不是模型上下文，因此不會發生 read-again 迴圈，而 `read` 恰恰是最容易產生巨型日誌的工具（[原理](../../../.agents/notes/implemented/feature/2026-07-26-code-dispatch-log-spill.md)）。

## 範圍

該策略只能看到最終格式化的呈現結果，看不到工具的內部資源或規範值。如果提供方已經截斷內容（例如 `web-fetch-http.maxBodyChars`），spill 產物保存的是工具返回的完整格式化結果，而非完整原始源。提供方／資源上限仍然是必需的，並且與該策略相互獨立。`glob`/`grep` 負責對項級呈現結果執行 spill，因為渲染前仍然存在完整的已取得值；bash 流負責在取得時 spill。通用策略預先註冊自己的 waterfall（瀑布式事件）監聽器，然後再委託，因此無論外掛程式載入順序如何，普通工具自身的非同步投影都會在通用位元組限制之前完成。詳見[工具輸出 spill Agent Note](../../../.agents/notes/implemented/architecture/2026-07-08-tool-output-spill-files.md)。

## 模型體驗

### 過大的純文字結果

#### 模型看到的內容

大小不超過 `maxInlineBytes` 的結果、巢狀結果、`read` 結果、被阻止的決策和包含非文字塊的結果都保持不變。過大的純文字呈現結果會變為有界的首尾預覽，後面附加 `(Omitted <bytes> bytes. Full formatted result stored at: <locator>. <retrievalHint>)`；儲存失敗或沒有工作階段所有者時，原始結果仍然可見。

#### Token 影響

成功替換後的內容最多為 `maxInlineBytes` 個 UTF-8 位元組，並會保留在歷史中直到壓縮（compaction）；完整 spill 文字不會重新發送給模型。

#### KV Cache 影響

僅附加；新可見內容位於可重用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **只能對最終純文字結果執行 spill**：混合內容結果、阻止回饋和 `read` 會原樣透過；無法在此復原先前已經發生的提供方截斷或工具自身執行的保留處理。
- **通知無法容納時，該次呼叫的替換功能會停用**：當上限極小或定位資訊很長時，後端已經保存了無引用的 spill，但過大的原始結果仍會保留在內聯位置。
