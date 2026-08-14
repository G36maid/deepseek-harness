# Agent Note: 透過 sessionStats 投影提供全工作階段統計條數字

Status: implemented

[English](2026-08-12-full-session-turn-step-counts.md) | [简体中文](2026-08-12-full-session-turn-step-counts.zh.md) | 繁體中文

## 問題

Web 聊天統計條的每個非 token 數字都折算自 `StatsLine` 已載入的工作階段視窗（`deriveStats` 遍歷 `chat.legacy.nodes`）：「N 輪 · M 步」計數、LLM 與工具牆鐘時間、TTFT／吞吐平均值。歷史按每頁 50 則訊息分頁，因此每點一次「載入更早」視窗變大、所有數字隨之成長——7 輪 · 44 步在翻一頁後變成 10 輪 · 89 步，LLM 時長同樣攀升。產品預期是與用戶端載入了多少歷史無關的全工作階段數字。同一統計條裡的 token 帳目早已採用正確架構：持久的 `tokenUsage` 投影。

## 決定

新的函式外掛程式 `@deepseek-ai/dsh-session-stats` 在 `ctx.sessionProjections` 上註冊 `sessionStats` 投影單元，作為 web-app bundle 行掛載。值攜帶統計條完整的非 token 數字集——`{ turns, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }`，欄位名與視窗摺疊一一對應以便整體互換。`steps` 統計 `step/end` 事件，`turns` 統計含至少一條該事件的不同 turn（turn 號單調遞增，一個 `lastTurn` 槽即可）；`llmMs` 累加 `step/start` → `assistant/message`；TTFT 記錄每步首個非空 delta chunk（在步內 `llm/retry` 後保留，與視窗 `resetForRetry` 對齊）；解碼時長覆蓋首 token → 已組裝訊息、僅統計上報 usage 的步；`toolMs` 按 callId 配對 `tool/call` → `tool/result`，未解決的呼叫在 `turn/end` 時丟棄。首 token 謂詞 `isTokenDelta` 移入 `@deepseek-ai/dsh-llm/message`（與其判別的 `StreamChunk` 類型同處），Host 摺疊與用戶端計時索引共用同一實作；client-runtime 轉發匯出。投遞完全複用現有投影縫——history 尾頁塊、`session/projection` 推送幀、清單行——apiproxy、wire schema 與用戶端執行時期零改動。`StatsLine` 讀取 `useProjection('sessionStats')`，鍵為 undefined（未組合該單元的裝配）時整體回退到視窗摺疊。用戶端 connection fixture 按其「映像檔每個已組合鍵」的既有紀律以 `sessionStatsOf` 平行實作該摺疊。

計數事件選 `step/end` 而非 `assistant/message`，源於評審直覺方案（按訊息計數）時發現的兩個正確性問題：

1. max-tokens 步會追加一條僅為承載 usage 而存在的空內容 `assistant/message`，它從不進入 surface；按訊息計數會把 transcript 上看不到的步計進去。
2. 被取消的步在訊息組裝前就中止（完全沒有 `assistant/message`），但用戶端會合成可見的 interrupted assistant 節點；按訊息計數會悄悄丟掉常見的取消步。

`step/end` 對每個進入的步在迴圈的 `finally` 中恰好追加一次，因此完成、失敗、取消、max-tokens 的步都恰好落一條——且計數在步結帳時推進，與視窗折算推進的時機相同，直播期行為不發生變化。

## 備選方案

**統計 `assistant/message` 事件。** 因上述兩個正確性缺陷否決（多計 usage 宿主訊息、少計被取消的步）。

**統計 `step/start` 事件。** 覆蓋等價（它先於每條 `step/end`），但計數會在步開始而非結帳時推進——一個沒有收益的可見直播期行為變化；`step/end` 的 `finally` 位置給出同等完整性。

**把單元註冊進 `core/agent-loop`（事件生產方）。** 迴圈是產品主幹；把 UI 讀模型放進去會給每個裝配加上 session-projection 相依性，違反「用外掛程式而非改迴圈」與「默認組合不帶選填項」。

**把單元註冊進 `token-meter`（摺疊同批事件的現有單元）。** 輪/步計數不是 token 度量；每個投影鍵都住在擁有其領域的包裡。

**在用戶端摺疊全量日誌。** 用戶端按設計只持有分頁視窗；投影 RFC 的「不在用戶端摺疊」規則正是為了讓數字在分頁、壓縮與冷讀之間存活。

**牆鐘時間、TTFT 與吞吐保持視窗口徑，解讀為「螢幕上有什麼」。** 否決：同樣的分頁問題一樣落在 LLM 時長上，且全量計數與視窗時間混在一條統計條裡讀起來是一套自相矛盾的數字。投影攜帶完整集合，視窗摺疊降級為無單元時的回退。

## 後果

統計條從第一個尾頁起就顯示全日誌數字；翻頁不再改變任何分組。與舊視窗語義的已定義邊緣差異記錄在包 README 中：未產生可見輸出的步（在內容之前失敗）仍計入；被崩潰打斷的步在重新載入、復原為其補寫合成 `step/end` 後計入（`interruptedTurnClosers`）；被取消的步計數但不計時（沒有組裝出訊息）；max-tokens 的 usage 宿主訊息貢獻 surface 上看不到的模型時間。每個 web 尾頁與清單行多攜帶一個小鍵，且單元內部狀態在步邊界與首 token chunk 處變化，變更流每步會多發幾幀值相同的推送；TUI 與 headless 裝配不提供 `sessionStats` 鍵，其消費者回退視窗摺疊。兩個曾把統計條當作已載入視窗探針解析的 e2e（`chat-scroll-contract`、`complex-history.perf`）改為統計已掛載的訊息流行／turn-tail 頁腳。`stats-paged-history` web 場景冷種一份 28 輪日誌，釘住整條統計條在不完整尾頁上即讀出全量數字、且「載入更早」前後不變。
