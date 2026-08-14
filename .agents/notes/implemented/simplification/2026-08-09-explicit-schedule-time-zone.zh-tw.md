# Agent Note: 顯式 Schedule 時區邊界

Status: implemented

[English](2026-08-09-explicit-schedule-time-zone.md) | [简体中文](2026-08-09-explicit-schedule-time-zone.zh.md) | 繁體中文

## 問題

隱式本機 `at` 輸入把瀏覽器事實變成了共享產品狀態。在 Session 建立時捕獲默認時區，需要增加新的 Session header、create／resume／fork 衝突規則、JSONL metadata、SQLite migration、client 建立 plumbing、Host 比較，以及與 time-context 標記耦合的 Schedule 邏輯。隨後，旅行、並行 tab、缺失 provenance 和舊 Session 都需要一套確認協議，僅僅為了判斷省略欄位是否安全。

大部分複雜度都位於 Schedule 之外。模型在呼叫工具前已經解釋自然語言，因此持久 Session 預設值只是重複了一個假設，並沒有強化絕對時間邊界。

## 決策

瀏覽器時區是請求本機的 provenance。Web client 會為每條提示詞取樣 `Intl.DateTimeFormat().resolvedOptions().timeZone`。Host 接受選填的 `clientTimeZone`，在 RPC 邊界校驗並規範化 `UTC` 或 IANA Area/Location，再將其記錄在確切的那條 `user-rpc` 訊息上。無效值會使提示詞准入被拒絕。非瀏覽器 client 可以省略它。

Time-context 從 open turn 中的原始 user-rpc 訊息派生唯一、混合或缺失的瀏覽器事實。唯一時區會用於格式化時鐘，並告訴模型把未明確限定時區的日期和時間解釋為該時區。provenance 混合或缺失時，模型會被告知詢問使用者。設定或行程時區只作為顯示 fallback，絕不會被呈現為使用者權威。

Schedule 不接受隱式本機時區。`at` 要麼是帶顯式偏移量且嚴格符合 RFC 3339 的字串，要麼是精確的 `{ date, time, time_zone }`。即使 time-context 剛向模型展示了瀏覽器時區，結構化形式仍要求自己的時區。Schedule 不匯入 time-context、不檢查 user message provenance、不讀取 Session header，也不產生確認錯誤。它的 parser 會校驗顯式值、拒絕夏令時缺口、在重疊時選擇第一個時點，並且只儲存規範化後的 UTC `scheduledAt`。

不再保留 Session 時區欄位、create／resume／fork 時區衝突、JSONL header 欄位、SQLite column 或 migration、連線預設值，也不再保留 Schedule 專屬的 Host／client 呈現。瀏覽器假設只會透過模型的顯式工具參數跨入 Schedule。

## 已考慮的替代方案

**把第一個瀏覽器時區持久化為不可變的 Session 預設值。** 這會使後續本機輸入具有確定性，卻把歸屬擴散到 core 和 persistence；旅行與並行 tab 仍然需要不匹配處理。

**把最近的瀏覽器時區用作可變 Session 狀態。** 這會減少確認提示，卻允許一個 tab 悄然改變另一個 tab 的解釋，並使重播相依性更新順序。

**讓 Schedule 檢查最新的 time-context 訊息。** prose snapshot（文字快照）是模型可見證據，而不是有類型的包 seam。消費它會使 Schedule 與 AgentLoop history 耦合，並針對原始 provenance 重複校驗。

**讓 Host 向工具呼叫注入 `time_zone`。** Host 無法知道模型解釋的是哪個自然語言表達式，也無法知道使用者是否指定了另一個時區。重寫模型參數會在錯誤的邊界隱藏含義。

**要求模型對每個未限定時區的時間都詢問使用者。** 這樣做是安全的，卻會不必要地打斷常見的瀏覽器本機場景。請求本機指令提供預期假設，而 provenance 混合或缺失時仍會詢問使用者。

## 驗證

Host 測試固定別名的規範化、可省略行為和進入 Agent（代理）前的拒絕。client 測試固定每條提示詞進行一次瀏覽器時區取樣。Time-context 測試固定當前 turn 中唯一、混合與缺失情況的派生，以及精確模型策略。Schedule 測試固定必需的 `time_zone`、嚴格偏移量、日曆校驗、規範時區、缺口拒絕、重疊時選擇第一個時點，以及不存在隱式上下文路徑。組裝 Web 場景把 Playwright 固定到 `Asia/Shanghai`，透過真實 composer 傳送提示詞，在模型請求中觀察同一時區，驗證顯式本機工具呼叫，並對普通提醒回應執行 snapshot。

原始碼審計會拒絕 `SessionHeader.timeZone`、persistence `time_zone` column、確認錯誤、Schedule 對 time-context 的匯入，以及獨立回執機制。

## 後果

- 無需持久 Session 時區子系統，瀏覽器本機自然語言也能工作。
- Schedule 具有一個顯式且可獨立測試的絕對時間邊界。
- 旅行與並行 tab 隻影響各自的提示詞；provenance 混合的 turn 會詢問使用者，而不是改變共享狀態。
- 非瀏覽器 client 仍然有效，但必須提供足夠的自然語言上下文或顯式工具參數。
- 模型仍可能產生解釋錯誤；工具只保證顯式日曆值有效且具有確定性。
