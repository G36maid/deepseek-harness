# Agent Note: 版本化 GUI 歡迎引導

Status: implemented

[English](2026-07-30-versioned-gui-welcome-onboarding.md) | 繁體中文

## 問題

GUI 的憑據引導從 DeepSeek 專用的就緒狀態檢查開始，但內部測試通知適用於每位使用者，即使憑據已經設定，也必須先於提供方設定顯示。若把兩者作為獨立浮層處理，多個對話框可能同時出現；僅存於行程內的關閉標記既無法區分通知已完成確認還是視窗在確認前已關閉，也無法在文案有意修訂後重新顯示一次通知。

## 決策

**設定外殼協調有序步驟。** `settings.onboarding` 仍是根作用域 list，但 `ui-settings` 會把其中各條目的 id 和順序投影到一個協調器中，並且只掛載第一個未完成的步驟。當前註冊方會收到 `complete()` 和 `openSection(id)`；所有權轉移前，不會掛載後續步驟。`ui-settings-models` 現在以順序 `-100` 註冊復原後的歡迎聲明，以順序 `0` 註冊 DeepSeek 條件式憑據步驟；兩者當前的共用展示由[共用彈出視窗引導決策](2026-08-13-shared-modal-product-onboarding.md)持有。

**產品歡迎步驟按版本管理並歸功能外掛程式所有。** 該聲明曾由[移除首次啟動內測聲明](../simplification/2026-08-13-remove-first-run-beta-notice.md)歷史決策移除，現在以新的測試階段文案復原在 `ui-settings-models` 中。`ui-settings-general` 仍不註冊任何引導步驟；持有當前兩個步驟的外掛程式也持有文案、store 和共用彈出視窗。

**持久化的 `ui-onboarding` 分節持有確認狀態。** 宿主端在 user-settings seam 中註冊它，存入當前 `$DSH_HOME/settings.yaml`；當前歡迎 store 透過既有公開 settings API 讀寫其中的 `welcomeNoticeVersion`。connection 外掛程式透過 `ctx.connection.isLoopback` 統一發布當前頁面是否使用 loopback authority；hostname 判定留在 connection 包內，其他用戶端外掛程式只消費服務狀態，而不匯入其實作。API Proxy 在可設定提供方 namespace 之外，透過封閉的允許清單暴露這一個產品 namespace，同時不會把它的變更視為模型目錄失效事件。

**可見引導使用同一個彈出視窗契約。** 當前兩個步驟都透過 body portal 的同一個 `OnboardingModal` 渲染，且只在彈出視窗可見期間把下層應用根節點設為 inert。步驟載入私有事實時，外殼不渲染任何包裝。明確操作會移交協調器所有權；Escape 和點擊遮罩都不會確認或跳過步驟。

## 曾考慮的替代方案

**瀏覽器本機儲存**：不予採用，因為確認狀態會跟隨某個瀏覽器 profile，而不是 `$DSH_HOME`；全新的 Harness profile 可能錯誤繼承此前的確認狀態，外部 profile 編輯也沒有權威更新流。因此，非 loopback 的回退保持為行程內狀態，而不是瀏覽器 profile 狀態。

**在 `ui-settings-general` 中再增加一個獨立模態視窗**：不予採用，因為歡迎通知和憑據就緒狀態同時為真時，list 註冊方仍會堆疊。聲明並渲染該 list 的外殼應當持有有序所有權。

**在渲染或視窗關閉時持久化**：不予採用，因為看見通知不等於確認，視窗關閉事件也無法可靠送達。只有顯式提交「繼續」才能阻止通知在下次啟動時再次顯示。

**通用的公開設定暴露標志**：不予採用，因為一個產品 namespace 不足以證明應當擴大每個 settings 註冊方的公開設定面。該 API Proxy 保留顯式的封閉允許清單。

## 後果

全新 profile 會先看到當前測試階段聲明；當沒有任何可用提供方時，再看到條件式 DeepSeek 金鑰彈出視窗。定向 store 與 React 測試固定精確版本確認、協調器順序、條件式移交、共用彈出視窗行為與 HMR 清理。真實 Chromium 場景會在隔離的 harness 家目錄下啟動已發布 Web 組合，驗證兩個彈出視窗，透過既有憑據邊界寫入金鑰，並檢查 secret 未進入 DOM、ARIA 或瀏覽器主控臺。
