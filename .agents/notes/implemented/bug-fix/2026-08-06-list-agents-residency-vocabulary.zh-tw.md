# Agent Note: `list_agents` uses `ready` for resumable children

Status: implemented

[English](2026-08-06-list-agents-residency-vocabulary.md) | [简体中文](2026-08-06-list-agents-residency-vocabulary.zh.md) | 繁體中文

## 問題

`list_agents` 把可繼續 child 的行程駐留狀態投影為 `running | idle | complete`。`complete` 讀起來像一項終態工作，且結果就在某處，但底層事實只表示沒有駐留的 Activation：對話完好無損，`send_message` 可以繼續它，而且它對 child 的結果不作任何斷言。讀到 `complete` 的模型會合理地尋找可收集結果，或向一個它以為已經結束的對話傳送替代工作。

這個詞與[由管理器負責的結帳投遞](../feature/2026-08-06-manager-owned-subagent-settlement-delivery.md)同時出現時尤其容易誤導。完成會以通知到達 parent；清單用於回憶持久化對話，而不是輪詢該通知。

## 決策

面向模型的投影報告 `running | idle | ready`：

- **`running`** 表示駐留 Agent 存在活躍 driver。
- **`idle`** 表示 Agent 駐留但處於輪次之間，也可能正在等待它啟動的 agent。
- **`ready`** 表示只剩下持久化對話。`send_message` 會在同一對話上啟動下一輪；該狀態表示可復原而非終態，也不表示有結果等待收集。

工具描述會陳述這些區別，並引導模型遠離輪詢：它說明 child 結束時 parent 會收到通知，而清單用於回憶自己啟動過哪些 child。由於任一快照都可能與另一行程或後續訊息競態，`send_message` 仍是投遞時的權威檢查。

服務層不變。`SubagentListEntry.activity` 保留 `'running' | 'inactive'`，對 UI 等消費端而言，這準確描述了語料駐留狀態。面向模型的配接器把 `inactive` 對映為 `ready`，因為這個詞表達了模型可執行的操作，而沒有虛構結果。

## 考慮過的替代方案

**保留 `complete`，並在描述中限定它。** 一段解釋 `complete` 不代表完成的描述，每次被讀取時都在與渲染狀態對抗。模型掃讀的那一行必須自身表達正確區別。

**使用 `active | dormant`。** 這會刪除處於輪次之間的駐留 Agent 與僅存於儲存的對話之間的有效區別，並讓僅存於儲存的狀態聽起來不可用。`ready` 直接表達有用事實：同一對話可以接受下一輪。

**完全移除狀態。** parent 決定是否傳送更多工作時，駐留狀態依然有用。移除它只是用沒有訊號替代一個誤導性狀態。

**重新命名服務活動值。** `running | inactive` 在服務層是正確的，並且有非模型消費端。為了修復一個配接器的呈現而攪動通用契約並不合理；[持久化目錄 Agent Note](../feature/2026-07-22-durable-subagent-catalog-and-list-agents.md) 繼續擁有該服務詞彙。

## 後果

- 渲染行使用 `<id> [running] — <label>`、`<id> [idle] — <label>` 或 `<id> [ready] — <label>`。
- 輸出 schema 的 `status` 枚舉與渲染契約一同變化。生成的工具目錄會帶上新描述；它只渲染每個工具的 `parameters`，從來不收錄輸出 schema。
- 單元覆蓋固定三種對映，以及引導模型等待結帳通知而非輪詢本工具的描述條款。
- 整體組裝的 ACP `subagent-list-agents` 場景會為已結帳且可復原的 child 渲染 `ready`。
