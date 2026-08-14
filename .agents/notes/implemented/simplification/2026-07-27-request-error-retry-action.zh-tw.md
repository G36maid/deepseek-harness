# Agent Note: 請求錯誤重試動作

Status: implemented

[English](2026-07-27-request-error-retry-action.md) | [简体中文](2026-07-27-request-error-retry-action.zh.md) | 繁體中文

## 問題

模型請求復原由 `agent/request-error` 內部決定，卻透過 `Agent.retry()` 傳達。這個公開命令只在一個狹窄的 waterfall（瀑布式事件）視窗內和空閒時有效，在其他執行狀態下會被拒絕，並要求 `ReactLoopAgent` 在 waterfall 結果旁保留一個可變的重試視窗。復原外掛程式是僅有的生產呼叫方，因此更寬泛的活躍 agent（代理）能力暴露了與其策略決策無關的狀態與行為。

## 決策

`agent/request-error` 返回 `RequestErrorAction`，其中負責處理的動作是 `{ kind: 'retry' }`；默認的 `undefined` 會讓失敗輪次保持終態。不擁有該失敗的監聽器呼叫 `next()`。擁有該失敗的監聽器執行所有需要等待的修復，然後直接返回重試動作而不繼續委託。

waterfall 結帳後，迴圈讀取該動作，關閉失敗輪次，並從持久歷史開啟一個重試輪次。迴圈在使用該動作時會再次檢查輪次訊號，因此即使監聽器隨後返回重試動作，復原期間發生的取消或 dispose（資源釋放）仍會阻止重試。拋出例外的復原不會產生動作。

`Agent` 與 `ReactLoopAgent` 均不暴露 `retry()` 方法。普通新工作透過 `followup()`、`steer()` 和 `inject()` 進入；只有已處理的模型請求失敗才能開啟沒有提示詞的重試輪次。

## 曾考慮的替代方案

**保留 `Agent.retry()` 作為復原命令。** 執行時期防護檢查可以將該命令限制在請求錯誤視窗內，但介面仍會暴露一個沒有生產消費端的空閒無提示詞再執行操作，迴圈也仍需透過可變的旁路狀態取回已由 waterfall 承載的決策。

**返回顯式終態動作。** `undefined` 已經表示 waterfall 未處理時的預設值，並可直接透過 `next()` 組合。再新增一個 `{ kind: 'fail' }` 值不會提供不同的行為或歸屬資訊。

## 後果

復原歸屬、非同步修復和重試決策共用一條類型化返迴路徑。活躍 agent 介面與具體迴圈不再具有空閒無提示詞再執行能力和重試視窗狀態。呼叫方如果不提交後續提示詞，就無法重新啟動任意失敗的非請求工作；瞬時策略與上下文溢位策略則保留編號重試輪次、從持久歷史重建、有限的策略私有預算和取消優先級。

聚焦的 agent-loop 測試固定了重試鏈、未處理失敗保持終態、復原失敗和取消競態。llm-retry 與 compaction-basic 測試套件固定其策略自有的動作返回，而 ACP（Agent Client Protocol）、goal-round-driver 和 plan-mode 整合測試固定後繼輪次承接。
