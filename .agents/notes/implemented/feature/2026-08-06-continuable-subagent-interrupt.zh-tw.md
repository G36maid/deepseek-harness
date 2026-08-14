# Agent Note: Continuable subagent 當前輪次中斷

Status: implemented

[English](2026-08-06-continuable-subagent-interrupt.md) | [简体中文](2026-08-06-continuable-subagent-interrupt.zh.md) | 繁體中文

## 問題

一個正在執行的 continuable subagent 無法在不銷毀它的前提下被停止。繼續執行管理器只在整個 Activation 拆除（結帳、drain、scoped drain）內部取消子 Agent，`send_message`／`subagent.prompt` 只能增加工作，而 Web composer 的 Stop 按鈕被刻意限制在普通工作階段。使用者看到 continuable child 在錯誤路徑上持續消耗 token 時，除了終止整個 parent 樹別無手段；當直接 parent Agent 離線時，即使 child 的 Activation 仍然線上，也完全無法對其進行控制。一次性執行有持有方擁有的 disposal 和 task-kill；continuable child 沒有對應的當前輪次控制。

## 決策

`ctx.subagents.interrupt(targetSessionId, authority)` 只停止線上目標的當前輪次。管理器原語同步完成鑒權，呼叫現有的 `Agent.cancel(cause, { keepInbox: true })`，然後返回 `void`——fire-and-return：保證取消訊號已寄出，但不等待目標完全靜止。其餘一切不變：不 dispose Activation、不釋放 handle、不級聯後代、不清空 inbox，也不改動 `AgentLoop` 或 `CancelOptions`。由於 `keepInbox` 讓尚未領取的待處理佇列停在 idle，中斷絕不會自動啟動下一個排隊的 follow-up；已被領取進入中斷輪次的工作屬於該輪次，不會重新入隊。被中斷的 driver 進入 idle 後，一次顯式喚醒傳送會按保留的 FIFO 順序復原。

授權是一個封閉的雙變體 union，刻意比投遞權限更寬，因為停止一個輪次是冪等的且不投遞任何內容：

- `{ kind: 'user', parentSessionId }`——人類出示持久化直接 parent 地址。線上目標的 `session.header.parentSession` 必須匹配；不涉及線上 parent Agent、目錄讀取或持久化訪問，這正是 parent Agent 離線時線上 child 仍可被停止的原因。取消 cause 為 `user`。
- `{ kind: 'ancestor', agent }`——一個確切線上的 ancestor Agent（直接 parent 或更深）。呼叫方必須是登錄檔中其 id 的當前條目（過期呼叫方即使目標不存在也被拒絕），不得是目標本身，並且必須出現在 Activation 物化時記錄的 `ancestry` WeakSet 中。取消 cause 為 `parent`。

目標只在管理器行程本機的 Activation map 中解析。不存在的 id——未知、一次性或已自然結帳——是被接受的 no-op，統一覆蓋完成競態和重複請求而不洩露持久化目錄資訊；disposal 交易已打開的目標在鑒權後同樣是被接受的 no-op。一次性生命週期（持有方 `dispose()`、task-kill）不受影響。`SubagentRuntime.interrupt()` 把未綁定管理器的組合視為被接受的 no-op 而不是 `CONTINUATION_UNAVAILABLE`，因為沒有管理器就不可能存在管理器擁有的線上 Activation。

Host RPC `subagent.interrupt` 接收 continuable 的 `SubagentAddress` 並返回 `{ accepted: true }`。它的實作只以 `user` 授權呼叫核心原語——刻意不呼叫 `catalogChild()`、`listChildren()`、`sessionQuery` 或 parent 登錄檔尋找。parent 地址不匹配的線上目標對映為 `subagent-unauthorized`；意外失敗對映為 `internal`，不把錯誤文字洩漏到 wire。

## 曾考慮的替代方案

**讓人類中斷走 `session.cancel`。** 通用工作階段取消要求附著的普通工作階段並拒絕 subagent 擁有的工作階段；放寬它會把 subagent 權限規則纏進普通工作階段路由。subagent 域的 RPC 讓基於地址的鑒權和 parent 離線保證保持顯式。

**等待目標靜止並返回輪次結果。** 取消是協作式的，靜止時間無上界；讓 RPC（以及一個 `ChildLock` 槽位）保持打開會招致逾時並與投遞、disposal 形成排隊。呼叫方需要的唯一事實是訊號已被接受，而競態（自然完成、disposal）本就冪等收斂。

**複用整個 Activation 的 disposal 來做中斷。** disposal 的取消不帶 `keepInbox`，還會 flush、capture 並釋放 handle——它銷毀排隊工作和 child 的駐留。中斷是針對一個輪次的控制操作，不是針對 Activation 的生命週期操作。

**順手把 `send_message`／`followup` 權限擴充到 ancestor。** 投遞向對話注入內容且不冪等；其確切直接 parent 權限保持不變。只有中斷獲得更寬的 ancestor 與基於地址的使用者授權。

**中斷後自動復原被暫停的佇列。** 在中止 A 後立即啟動排隊的 follow-up B 會讓中斷看起來被忽略，並奪走人類重新引導 child 的視窗。暫停到顯式喚醒傳送為止，讓停止可觀察且 FIFO 順序完整。

## 後果

人類或 ancestor 可以停止一個失控的 continuable 輪次，而不丟失 child、其尚未領取的排隊工作或正在執行的後代；代價是一個刻意保持弱的後置條件（`accepted` 表示“訊號已寄出”，目標在觀察到訊號前可能仍顯示 `running`），用戶端必須如實呈現。暫停佇列規則意味著被中斷的 child 會帶著保留的工作停在 idle，直到 driver 進入 idle 後收到喚醒訊息——這是有意的 human-in-the-loop 暫停，不是調度器缺陷。在 abort 收斂期間被接受的喚醒傳送目前會保持排隊而不鎖存 wake；Issue #1838 跟蹤共享的 agent-loop 修正。

僅憑地址的 RPC 會暴露一項關於線上駐留狀態的二值資訊：不存在的目標會被接受，而 parent 不匹配的線上目標會返回 `subagent-unauthorized`。單使用者本機 Host 的信任模型接受這種可觀察性；未來的多主體 Host 必須重新審視權限和回應不可區分性。

在 Web 側，正在執行的 continuable child 使用相互獨立的 Send 與 Stop 操作：用戶端 `Session.cancel()` 將 Stop 路由到 `subagent.interrupt`（one-shot 地址保持不可取消，普通工作階段仍透過 `session.cancel` 保留既有的 primary Send/Stop 切換），同時 Send 繼續將後續訊息加入佇列。parent 離線但仍在執行的 continuable child 保留默認 composer，停用輸入區與 Send，但 Stop 仍然可達；停止後復原為只讀接管介面（周邊目錄與 composer 約定由 [Web subagent 對話](2026-07-27-web-subagent-conversations.md)擁有）。

`dsh-tool-subagent-control` 中面向模型的 `interrupt_agent(agent_id)` 工具把 `exec.agent` 作為 `ancestor` 授權傳入，自身不增加任何權限：核心原語校驗線上登錄檔身份與記錄的 lineage，因此該工具可以用同一個通用 `agent_id` 參數指定直接 child 或更深的後代——刻意不用會暗示僅限直接 child 的 `subagent_id`。發現相依性 `list_agents({ scope: 'descendants' })`，其底層是新的 `SubagentRuntime.listDescendants()` 單次追蹤 pre-order 遍歷，每個條目帶經校驗的 `parentId`／`depth`（清單約定由[持久化目錄 note](2026-07-22-durable-subagent-catalog-and-list-agents.md)擁有）；發現只是提示，絕非權限。`send_message` 保持其確切直接 parent 權限——只有中斷是 ancestor 級的。

## 測試

`packages/subagent/subagent/tests/continuation.spec.ts` 中的核心覆蓋證明瞭持久化 `turn/end` 中止、佇列先暫停後按 FIFO 復原、後代不受影響、兩種授權及其取消 cause、self/sibling/stale/非 ancestor 拒絕、absent/一次性/disposal 競態 no-op，以及 `keepInbox` 迴圈行為不變。`packages/host/apiproxy/tests` 中的 Host 覆蓋證明 RPC 只調用核心原語（不讀 agents/目錄/歷史）、`subagent-unauthorized`／`internal` 對映、wire schema 的 continuable 模式圍欄以及 carrier 往返。用戶端覆蓋固定按地址路由的 `Session.cancel()`、InputBar 的獨立 Send 與 Stop 操作及 parent 離線時鎖定輸入區和 Send 的狀態，以及只讀 composer selector 的執行例外；keyless 組裝 Web 場景（`apps/web/tests/subagent-interrupt.e2e.ts`、`subagent-interrupt-ui.e2e.ts`）透過多條 replay hang 條目保持多個真實 child 輪次打開，端到端證明 parent 離線時從 UI 到 RPC 的中止路徑、Send 入隊、follow-up 暫停以及 FIFO 復原。`packages/subagent/tool-subagent-control/tests` 中的工具覆蓋證明直接與更深 ancestor 以 `parent` cause 中斷並暫停佇列、self/sibling/陌生呼叫方被拒絕且不觸碰目標、目標不存在時 no-op 且不冷復原，以及 descendants 清單的 pre-order 位置；keyless ACP 快照透過組裝應用，針對一個已結帳的 child 執行 `list_agents({ scope: 'descendants' })` 與 `interrupt_agent`，同時已錄制的請求 header 仍固定這兩個 schema。
