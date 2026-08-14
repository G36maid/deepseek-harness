# @deepseek-ai/dsh-tool-session-query

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

位於 `ctx.sessionQuery` 之上、經工作區授權的模型工具。該 opt-in 包只相依性統一介面，並註冊 `session_search`、`session_event_search`、`session_trace`、`session_event_trace` 和 `session_event_read`；已發布的宿主組合預設不掛載它。

## 設定

| 鍵 | 預設值 | 含義 |
|---|---:|---|
| `maxSearchResults` | `100` | 在內部提供方分頁中收集的最大已授權非自身命中數 |
| `searchTimeoutMs` | `30000` | 附加到兩個全文搜尋工具的協作式截止時間 |

呼叫方只能來自 `ToolExecution.exec.agent`。跨工作階段訪問要求目標和呼叫方工作階段的 `cwd` 值嚴格相等；沒有 `cwd` 的呼叫方只能檢查自己。搜尋絕不公開提供方遊標、偏移、分頁大小或模型可控上限。由於一次搜尋會在內部消費與世代綁定的提供方遊標，兩個搜尋工具都與同級工具呼叫排他執行；三個精確跟蹤/讀取工具選擇平行執行。每個精確執行器都將未更改的執行訊號傳遞給授權和服務跟蹤/讀取，因此取消會等待協作式持久化清理，並保留訊號的精確原因。工具邊界上的時間戳要求顯式 `Z` 或數字偏移，並轉換為包含端點的 epoch 毫秒過濾器。

`session_search` 始終省略呼叫方工作階段。請求的父 id 會被去重，並在 FTS 前根據呼叫方工作區權限檢查；只有已授權 id 會到達提供方，而缺失猜測和跨工作區猜測的行為完全相同，root 標記仍獨立使用 OR。當前工作階段中的 `session_event_search` 會在呼叫它的步驟之前立即停止，因此當前 assistant 輸出和已記錄工具呼叫無法匹配自身。直接目標在跟蹤、事件或標題讀取前完成授權。血緣輸出會用不含隱藏工作階段 id 的標記替換未授權祖先和後代邊界。

每個可信 `ctx.sessionQuery` 呼叫都會經過一個模型邊界淨化器。首先檢查呼叫方取消，並精確保留。可取得的語料庫診斷資訊和提供方診斷資訊（包括可安全檢查的巢狀原因）會盡力記錄到內部日誌；不可列印的失敗使用固定日誌預留位置。診斷格式化和錯誤分類各自獨立受保護，因此不可列印的原因無法逃逸，也無法阻止已安全分類的外層錯誤；不安全的分類或日誌記錄則回退到固定 `SESSION_QUERY_TOOL_FAILED` 程式碼和訊息。本機參數驗證和授權錯誤保留精確的工具自有訊息。

該包刻意不執行位元組或字元截斷，也不匯入 spill 後端。需要限制內聯輸出的部署應掛載 `@deepseek-ai/dsh-spill-policy`，它可在執行後替換已算繪文字，同時保留完整結果。

## 模型體驗

### 系統提示詞

#### 模型看到的內容

模型會收到一個固定的既往歷史指引章節。

##### 既往歷史指引

```markdown
Use session_search to find relevant work from prior sessions, or session_event_search to search earlier events in one session. Search results are cursor-free and workspace-scoped. Follow a useful hit with session_trace, session_event_trace, or session_event_read when you need lineage, relationships, or exact data.
```

#### Token 影響

外掛程式掛載期間，每次請求都存在一個固定精簡章節。

#### KV Cache 影響

外掛程式和指引文字不變時，前綴穩定。

### 工具 schema

#### 模型看到的內容

模型會看到生成的 [`session_search`、`session_event_search`、`session_trace`、`session_event_trace` 和 `session_event_read` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-session-query)。搜尋過濾器會增加固定 schema token，而遊標、工作區路徑、輸出分頁和模型可控結果上限仍不存在。

#### Token 影響

可見期間，每次請求都會發送 5 個固定只讀 schema。

#### KV Cache 影響

工具可見性和定義不變時，前綴穩定。

### 工具結果

#### 模型看到的內容

每次成功呼叫都會發出一個純文字塊。搜尋結果包含標題和最佳匹配摘錄；跟蹤包含全部已授權關係；事件讀取包含未經刪節的目標 JSON。通用 spill 策略可以將過大的內聯文字替換為預覽、不透明定位資訊和取回指引。

#### Token 影響

結果取決於資料，並保留在已記錄工具歷史中直到壓縮（compaction）；`maxSearchResults` 限制搜尋命中數。

#### KV Cache 影響

僅附加的結果文字位於可重用請求前綴之後，不會使較早的快取條目失效。

## 已知限制與暫緩事項

- 搜尋最多返回部署上限，匹配更多時會請模型縮小查詢；不提供延續 token。
- 工作區身份使用保守的字串精確 `cwd` 相等性，因此符號連結等價的路徑不共享權限。
- 未掛載通用 spill 策略的自訂組合會以內聯方式接收完整跟蹤和事件載荷。
