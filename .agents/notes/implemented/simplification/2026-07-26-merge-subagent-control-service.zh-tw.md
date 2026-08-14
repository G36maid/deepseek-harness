# Agent Note: 將 subagent 控制合併到 subagent 服務

Status: implemented

[English](2026-07-26-merge-subagent-control-service.md) | [简体中文](2026-07-26-merge-subagent-control-service.zh.md) | 繁體中文

公開操作集合由[以意圖命名的 subagent 繼續執行操作](2026-07-27-intent-named-subagent-continuation-operations.md)進一步細化，並由[可繼續的 subagent](../feature/2026-07-28-continuable-subagent-conversations.md)再次細化——後者保留這一個合併後的服務，同時移除提供方 `resume` 派發和基於 Task 的繼續執行生命週期。

## 問題

可繼續 child 的編排最初位於原始 `ctx.subagents` 提供方約定之上的獨立 `ctx.subagentControl` 服務中。該拆分使提供方分發與 Task 和持久化無關，並為模型配接器與面向人類的配接器提供統一的編排約定。實踐中，兩個服務屬於同一組能力，每個可繼續呼叫方都需要二者，而綁定提供方的委派工具必須根據 `provider.resume` 推斷策略，並檢查控制服務與 `send_message` 工具是否碰巧已載入。如此一來，配套外掛程式是否存在會決定執行語義，並將可繼續工作的啟動耦合到選填的後續操作介面。

## 決策

`SubagentRuntime` 是唯一的公開服務。它公開普通的 `start(name, request)`、由 Task 支撐的 `startContinuable(spec)`，以及按意圖命名的 `followup(...)`；提供方的 resume 分發仍封裝在其繼續執行管理器內部。獨立的 `@deepseek-ai/dsh-subagent-control` 包和 `ctx.subagentControl` 鍵均不存在；選填的 `@deepseek-ai/dsh-tool-subagent-control` 包則直接注入 `ctx.subagents`。

合併後的服務及其提供方公開一套 `SubagentError` 分類體系。穩定錯誤碼把提供方尋找失敗和能力相關失敗，與繼續執行路由、鑒權、取消、持久化和送達失敗區分開來；已移除的服務不保留單獨的錯誤類。

繼續執行的實作仍是內部管理器，不會擴充提供方登錄檔的核心狀態。`SubagentRuntime` 透過 `ctx.inject(['tasks', 'agents'], ...)` 建立該管理器，因此注入的 Cordis child fiber 擁有自身的 Task 完成監聽器和拆卸 effect。載入提供方登錄檔不要求 Task 或持久化。只有 Task 和 Agent 可用時，該管理器才會存在；每項繼續執行操作都在需要持久性時解析工作階段持久化服務。dispose（資源釋放）該 fiber 會先取消並結帳活躍的繼續執行，再釋放其關聯。

`startContinuable` 與底層 `start` 保持分離，因為二者的所有權與時序約定不同：前者分配持久化 child id、建立 Task，並同步返回兩個 id，而啟動過程繼續在 Task 內執行；底層 `start` 則等待提供方發布，並移交一個由持有方負責的 run。若透過標志或回傳值聯合類型將該方法並入 `start`，會擴大底層約定，改動反而多於保留現有的顯式入口。

每個 `@deepseek-ai/dsh-tool-subagent` 實例都會選擇 `backgroundMode: 'one-shot' | 'continuable'`，預設值為 `one-shot`。這項設定表示策略；`provider.resume` 只用於檢查所設定的可繼續模式是否受提供方支持。因此，可復原的提供方仍可執行一次性後臺工作。`send_message` 工具是獨立配接器：載入或省略該工具既不會啟用也不會停用 `startContinuable`。

## 已考慮的替代方案

**保留獨立服務。** 這樣能保持最嚴格的相依性分離，但每條生產環境中的可繼續路徑都要組合兩個服務，而額外的公開鍵會暴露呼叫方並不需要的架構差異。內部管理器無需第二個服務，也能保留選填的 Task 和持久化相依性。

**根據 `provider.resume` 推斷可繼續模式。** 方法是否存在可以準確表示從持久化儲存復原的能力，卻不能表示部署策略。這會迫使每個可復原的提供方都採用可繼續後臺語義，並使配套外掛程式缺失成為執行時期錯誤。顯式的工具設定將選擇與能力分離。

**註冊繼續執行訪問入口，或檢查後續操作工具。** 登錄檔可以告訴委派工具繼續執行介面是否存在，但啟動具備持久性的工作不需要任何後續操作配接器。這樣的登錄檔會把 UI 組合編碼進執行策略，並以另一個名稱重新建立外掛程式間相依性關係。

**將底層啟動與可繼續啟動合併為一個方法。** `start` 上的標志會使該方法返回已發布的一次性 run，或立即返回 Task 和 child 標識，從而削弱簡單的所有權邊界。保留 `startContinuable` 改動更小，也能明確保留兩項約定。

## 影響

- 服務拓撲少了一個公開鍵和一個包，同時底層提供方分發仍可在沒有 Task 或持久化時使用。
- 設定的提供方缺少 `resume` 時，可繼續模式會在提供方掛載階段失敗；缺少 Task、Agent 或持久化時，仍會在需要它們的最早操作處失敗。
- 後續訊息投遞仍為選填功能。部署可以透過 Task 工具啟動並收集可繼續工作，而不公開 `send_message`。
- `dsh-subagent` 包內的繼續執行管理器仍然感知 Task 和持久化，因此該包會將這些服務聲明為選填的對等相依性（peer dependency），即使普通的 `start` 呼叫方並不需要它們。
- 現有的繼續執行競態、授權、持久性、取消及先結帳再 dispose 的語義均保持不變，並繼續由遷移後的 `subagent` 測試固定。
