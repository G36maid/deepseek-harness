# @deepseek-ai/dsh-session-stats

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

註冊 `sessionStats` projection 單元的函式外掛程式：從步邊界、流式 chunk、工具配對與已組裝的 assistant 訊息摺疊出全日誌工作階段數字——輪/步計數以及 LLM、工具、首 token、解碼牆鐘時間——經 session-projection 縫對外提供（registry 快照、變更流，以及每一個 projection 載體：history 尾頁、`session/projection` 推送幀、工作階段清單行）。用戶端由此算繪分頁與壓縮都無法改變的全工作階段數字；參考消費者是 Web 聊天統計條，其視窗摺疊以相同欄位名充當無單元時的回退。

## 摺疊語義

- `steps` 統計 `step/end` 事件。agent loop 對每個進入的步在 `finally` 中恰好追加一條，因此完成、失敗、取消、max-tokens 的步全部計入。若改按已組裝的 assistant 訊息計數，則會多算 max-tokens 的 usage 宿主訊息（空內容、被排除在 surface 之外），並少算被取消的步（在訊息組裝前已中止）。
- `turns` 統計含至少一個已關閉步的不同 turn；被拒絕或空輪（未進入任何步即關閉）不計。turn 號由宿主分配、按工作階段單調遞增，因此摺疊只需保留最近計入的 turn。
- `llmMs` 按步累加 `step/start` → `assistant/message`（組裝出訊息的步；步內重試的等待與視窗摺疊一樣計入模型時間）。
- `ttftMs`/`ttftSteps` 累加並統計 `step/start` → 首個非空 delta chunk；首次嘗試的邊界在步內 `llm/retry` 後保留（與視窗 `resetForRetry` 對齊）。
- `decodeMs`/`decodeTokens` 累加首 token → 已組裝訊息的時長與提供方上報的輸出 token，僅統計兩者兼備的步。
- `toolMs` 按 callId 配對累加 `tool/call` → `tool/result`；未解決的呼叫在 `turn/end` 時丟棄（結果總在其輪內落地）。
- 每個欄位在首個貢獻事件之前均為 0。已裝配的 registry 恆提供該鍵，用戶端讀取值本身，而非鍵的存在性。

## 組合

```yaml
- id: session-stats
  name: '@deepseek-ai/dsh-session-stats'
```

注入 `sessionProjections`——這是外掛程式的全部用途；在沒有 registry 的裝配中 fiber 保持掛起，不註冊任何內容。

## 模型體驗

無，因為外掛程式只計算面向用戶端的、由已寫入日誌的工作階段事件派生的讀模型，不觸碰任何提示詞、訊息、schema、流或工具結果。

#### KV Cache 影響

無；外掛程式從不組裝或傳送提供方請求。

## 已知侷限與延後工作

- **步數統計的是已發生的工作，而非可見輸出**——在產生任何可見內容前就失敗的步仍以 `step/end` 關閉並計入；被崩潰打斷的步在工作階段重新載入後計入，屆時當機復原為其補寫合成的 `step/end`（dsh-session 的 `interruptedTurnClosers`）。
- **被取消的步計數但不計時**——沒有組裝出 assistant 訊息，其部分流式時間不進入任何牆鐘數字，與視窗摺疊的無計時 interrupted 節點一致；反之 max-tokens 的 usage 宿主訊息貢獻 surface 上看不到的模型時間。
- **計數是日誌口徑，不是 surface 口徑**——訊息後來被壓縮掉的步仍然計入；數字描述整個工作階段，而非當前模型可見 surface。
- **僅掛載於 web-app bundle**——其他裝配不提供 `sessionStats` 鍵，其消費者回退到視窗口徑計數（Web 統計條的回退路徑）。
