# Agent Note: Python SDK 遞迴工作階段通知

Status: implemented

[English](2026-07-24-recursive-python-sdk-session-notifications.md) | [简体中文](2026-07-24-recursive-python-sdk-session-notifications.zh.md) | 繁體中文

## 問題

Python SDK 過去透過將每條通知的 payload 與根工作階段 ID 直接比較來過濾輪次通知。直接子 agent 的生命週期通知因 parent ID 指向根工作階段而能夠透過，但孫級生命週期通知與所有後代 `session.event` 都會被拒絕。JSON-RPC 伺服器仍會發出這些通知，因此它們會堆積在底層全域性佇列中，而高層消費者會丟失巢狀軌跡的關係與結束狀態。

## 決策

`HarnessClient` 會在分發通知前，記錄每條有效 `subagent.started` 所包含的 child-to-parent（子到父）關係。後續的 `subagent.finished` 會依據自身不可變的 parent ID 路由，但不會改寫當前祖先關係，因此舊 run 即使在其 child ID 已被複用後才結束，也無法覆蓋替代它的新工作階段。其他工作階段通知會沿用戶端生命週期內保存的祖先關係圖回溯自身 session ID，判斷它們是否屬於請求的根工作階段。該關係圖會跨連續訂閱保留，因此某個後代即使在一次 `Session.run()` 結束後仍然存續，在後續輪次中寄出通知時仍能正確歸屬；用戶端啟動新的執行時期行程時會重設關係圖。

`Session.run()` 透過 `TurnResult.notifications` 與 `on_notification` 提供已發現工作階段樹的完整通知流。只有 `sessionId` 等於請求根工作階段的 `session.event` 才會進入 `TurnResult.events` 或參與最終回覆重建。因此呼叫方能夠觀察後代事件，同時子工作階段回覆不會覆蓋根工作階段回覆。

## 考慮過的替代方案

**在每條 JSON-RPC 通知中加入根工作階段 ID。** 伺服器已經提供精確的直接父子關係；線上路協議中重複傳遞祖先關係，會迫使每個生產者承擔用戶端訂閱狀態的職責。

**把 subagent 限制為一層。** 部署可以設定 `maxDepth: 1`，但讓 SDK 相依性該策略，會對合法的遞迴組合產生靜默誤報。

**只訂閱後代生命週期通知。** 這可以修復關係與結束狀態的上報，但後代工作階段事件仍會堆積在全域性佇列中，回呼看到的工作階段樹也不完整。

**在 JSON-RPC 線路上公開並索引每個 subagent run ID。** 當用戶端必須關聯同一 child 的兩個並行結果時，精確 run 身份很有價值；但工作階段樹路由已經擁有權威 start 關係和每條終止通知中不可變的 parent。沒有必要為這一歸屬決策擴充協議。

## 後果

高層消費端會按協議傳輸順序收到巢狀生命週期與工作階段通知，同時根輪次結果保持原有回覆語義。用戶端會為每個已觀察到的子工作階段保留一條當前父關係，直到執行時期重新啟動；祖先回溯能夠安全處理環，無關工作階段通知仍可從全域性佇列取得。無金鑰 Python 測試覆蓋兩層委派、根回覆隔離、工作階段樹通知不堆積、跨訂閱複用祖先關係，以及舊 run 亂序結束的複用 child ID。
