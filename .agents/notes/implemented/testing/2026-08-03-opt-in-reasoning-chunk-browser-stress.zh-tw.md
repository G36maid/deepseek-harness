# Agent Note: 推理（reasoning）區塊的逐幀累計發布與瀏覽器壓力驗證

Status: implemented

[English](2026-08-03-opt-in-reasoning-chunk-browser-stress.md) | [简体中文](2026-08-03-opt-in-reasoning-chunk-browser-stress.zh.md) | 繁體中文

## 問題

長推理流會連續產生大量 `assistant/chunk`。這些原始事件必須逐個完成排序、日誌記錄和 `PartialAccumulator` 摺疊，以保持重放保真度和最終內容完整；但 React 只需要看到當前累計結果，不需要觀察同一瀏覽器幀內的每個中間態。

非同步流的每次 `yield` 都可能形成新的微任務邊界，因此僅靠微任務合批的 `Notifier.markDirty()` 會退化為每個區塊重建一次 `ConversationSnapshot`、通知一次 `useSyncExternalStore` 並執行一次 React render。即使即時 Think 行保持摺疊，100,000 個推理區塊仍會讓協調、提交和版面配置工作壓住主線程。效能邊界必須位於工作階段接收與 React 發布之間，不能透過減慢生產方或丟棄原始事件來掩蓋問題。

## 決策

`Session.acceptLiveEvent()` 立即追加每個原始事件，並同步更新 transcript（文字記錄）、`PartialAccumulator` 及其他工作階段派生狀態。可見的 `block-start`、`text-delta`、`reasoning-delta`、`tool-call-delta` 和 `block-end` 區塊透過 `Notifier.markFrameDirty()` 發布：第一項變化調度一次 `requestAnimationFrame`，後續區塊只繼續更新累積器；幀回呼從最新狀態重建一個累計快照並通知訂閱者一次。`usage`、`finish` 及未知的不可見區塊保留在事件視窗中，但不觸發無效的 React 通知。工作階段與歷史檢查共用同一可見區塊分類。

`Notifier` 用調度種類和代際標記管理待發布工作。普通結構事件繼續透過 `markDirty()` 在微任務中發布；如果定稿訊息、工具事件或錯誤到達時仍有待執行的幀發布，微任務會取代它，舊幀回呼因代際不匹配而失效。`notifyNow()` 同樣使舊調度失效，以保留受控輸入的同步回響。沒有 `requestAnimationFrame` 的環境退回微任務合批。定稿事件可以跳過一次尚未顯示的中間 partial，但發布的定稿內容和原始事件序列保持完整。

即時 Think 行對累計文字的橫向跟尾屬於純視覺對齊，不需要在每次 React 提交中同步讀取版面配置。元件內調度器將連續請求合併為每三幀一次，從最新 DOM 讀取 `scrollWidth` 和 `clientWidth` 並將 `scrollLeft` 直接更新到最新位置；固定的視覺節奏讓摘要變化可讀，又不會積壓瀏覽器平滑滾動動畫。該節流只作用於 Think 的橫向摘要，不延遲 Chat 正文滾動、歷史 prepend 錨定或使用者觸發的 `scrollIntoView`。

`pnpm run test:web:stress` 保留為無金鑰、需顯式啟用的瀏覽器效能證據。確定性的 `?fixture` 工作階段以獨立於繪製的節奏寄出 100,000 個 `reasoning-delta`，結尾標記證明事件經過生產工作階段歸並並到達即時 Think 行；50 毫秒心跳和預先調度的 DOM 事件分別測量主線程停頓與互動延遲，250 毫秒預算用於識別明顯回歸。`DSH_WEB_STRESS_HEADFUL=1` 允許開發者在可見瀏覽器中使用 Performance 面板分析同一場景。該壓力車道是手動效能診斷與修復驗收的證據，不是默認 CI 閘門，也不替代確定性的調度單元測試。

聚焦測試固定 `Notifier` 的逐幀合併、結構事件搶佔、失效回呼和無 rAF 回退，並在 `Session` 層證明一幀只發布一次最新累計文字且定稿不會被舊幀回呼重複通知。fixture（測試前置資料）的小型單元測試繼續固定輸入校驗、外部到達節奏、並行拒絕、精確事件數和結尾標記交付，無需把 100,000 區塊工作負載帶入默認測試套件。

## 曾考慮的替代方案

**在 React 內對快照使用 transition、deferred value 或元件節流。** 不予採納：工作階段源仍會逐區塊通知 `useSyncExternalStore`，React render 在元件決定延後展示之前已經發生，且多個消費同一快照的元件需要重複實作策略。Think 摘要的視覺跟尾節流位於快照發布之後，只減少同步版面配置頻率，不承擔資料發布策略。

**在接收或日誌層丟棄、抽樣或拼接原始區塊。** 不予採納：原始 `assistant/chunk` 是可重放的工作階段事實，改變它會損失診斷與 UI 保真度，並把展示頻率策略混入資料權威層。

**只使用微任務合批。** 不予採納：連續非同步 `yield` 會在相鄰區塊間排空微任務佇列，使微任務合批近似退化為每個區塊通知一次。

**按動畫幀控制測試生產方節奏。** 不予採納：生產方會在渲染變慢時同步減速，使頁面獲得真實網路流不存在的隱式背壓，並掩蓋主線程飢餓。

**真實模型或錄制的 HTTP 位元組流。** 不予採納：即時模型不具確定性，HTTP/SSE（Server-Sent Events）錄制也不會改進目標斷言。記憶體 fixture 保留逐個非同步工作階段事件、生產用戶端歸並和 React 渲染路徑，同時控制工作負載與到達節奏。

## 後果

流式 `ConversationSnapshot` 的發布頻率受瀏覽器繪製頻率約束，React 每幀至多處理一個包含全部已接收文字的累計 partial；結構事件仍可更快發布。接收、排序、日誌記錄、字串拼接和累積器更新仍按原始區塊執行，因此該決策降低的是快照重建與 React 工作，不把原始流解析成本偽裝成已解決。

摺疊 Think 摘要的橫向版面配置讀寫最多每三幀執行一次，並直接追上該時刻的最新位置；React 仍按累計快照正常提交，定稿時摘要復原到首行。該區域性視覺策略不會改變正文滾動和使用者互動的即時性。

瀏覽器壓力車道繼續提供真實組裝應用上的回應性訊號和可見 profiling 入口，但硬體與調度差異使其只適合作為顯式效能證據。確定性的 focused tests 負責守住發布次數、累計內容與搶佔順序，默認測試車道保持快速。
