# Agent Note: Agent 生命週期與所有權約定

Status: implemented

[English](2026-06-18-agent-lifecycle-and-ownership-contracts.md) | [简体中文](2026-06-18-agent-lifecycle-and-ownership-contracts.zh.md) | 繁體中文

## 問題

ACP（Agent Client Protocol）與 tool-bash 的若干限制是同一個所有權約定缺失的症狀：外掛程式可以透過 `ctx.agents` 建立或復原 agent（代理），但無法獨立擁有和 dispose（資源釋放）單個 agent，而長時間執行的 bash 任務在執行器中也沒有穩定的所有者。ACP 在斷連時中止並等待 agent，卻無法僅註銷該工作階段的 agent；`session/cancel` 無法取消已入隊但尚未開始的工作；`tool-bash` 將任務所有權保存在外掛程式本機的 `Map` 中，因此一次 HMR（熱模組替換）重載就可能讓舊任務看起來無主。

## 決策

三項約定變更：佇列感知的取消、`AgentHandle` 釋放器，以及 bash 所有者權杖。

### 1. 佇列感知的 `Agent.cancel(cause?)`

`Agent` 介面新增 `cancel()` 動詞——唯一的公開停止原語。（它最初與範圍更窄、僅作用於步驟的 `abort()` 一同交付；後者後來因無人使用而移除，使 `cancel()` 成為唯一公開的停止工作方式。）它清空 inbox 的 queued + steering FIFO，在存在活躍輪次時中止它，並保留一個不帶 cause 的 pre-run 標記，使在被領取前被取消的提示詞永不執行，而後來的提示詞仍保持獨立。有效呼叫會在清空或中止前寄出 `agent/cancel-requested`，攜帶類型化的 `user | parent` cause；空閒取消不寄出任何事件，也不會使下一條提示詞擱淺。`whenIdle()` 會在取消後達到完全靜止，ACP 的 `session/cancel` 對映到 `user`。[顯式輪次取消決策](2026-07-16-explicit-turn-cancellation.md)規定了當前的 cause、signal 生命週期與協作式結帳約定。

### 2. `AgentHandle` 非同步釋放器

`ctx.agents.create`/`resume`（以及 `AgentFactory` 介面）返回 `AgentHandle = { agent: Agent; dispose(): Promise<void> }`。釋放器是一種**消費端能力**——僅持有裸 `Agent` 的登錄檔觀察者無法將其拆除。呼叫方 fiber 和已註冊的 factory 提供方是結構上的共同所有者：呼叫方解除安裝強制結構化所有權，而提供方解除安裝必須停止舊實例，因為其實例作用域的相依性 surface 透過該提供方解析。三條路徑都會進入同一個記憶化的拆除過程：停止迴圈、等待其退出與空閒刷寫完成（完全靜止，而非僅把狀態翻轉為 `disposed`）、分離 agent、分離其工作階段，然後解除其 scope。每個公開 ID 在其精確登錄檔條目分離時變得可複用；不存在獨立的保留釋放階段。由設定建立的 agent 已歸 `AgentLoop` fiber 所有（handle 被丟棄）。ACP 在其 `SessionRecord` 中保存每個全新工作階段的釋放器，並在斷連或外掛程式拆除時執行它，因此單純的用戶端斷連不會留下已註冊 agent 或工作階段儲存條目。在與關閉的競態中落敗的建立流程會 dispose 其尚未發布的 handle。

**拆除順序對持久性至關重要**，實作將工作階段生命週期摺疊進 agent 的單個複合 Cordis effect（`SessionStore.prepare`/`enter`/`announce`，取代兄弟 effect 拆分）。fiber 解除安裝會並行釋放兄弟 effect（`Promise.all`），這會讓工作階段儲存的 append 發布掛鉤移除與迴圈關閉時的 `session/flush` 競爭，從而丟失關閉的 `turn/end`；在一個 effect 內，釋放器作為有序的 LIFO 鏈執行（停止迴圈 + `await agent.done` 在工作階段分離之前），因此無論 handle 的 `dispose()` 還是 fiber 解除安裝，都會捕獲迴圈的最終刷寫。被隔離的 `agent/disposed` 和 `session/disposed` 通知無法拒絕該鏈或跳過後續拆除。

### 3. Service Definition 中的 Bash 所有者權杖

背景工作所有權從 `tool-bash` 外掛程式本機的 `Map<string, Agent>` 移入執行器。`ShellExecRequest` 新增選填的 `owner?: string`；解析後的 `ShellExecSpec` 將其作為必需但可空的 `owner: string | undefined` 攜帶（被遺忘的 owner 是可見的 `undefined`，而非靜默缺失的屬性）。執行器把 token 存在任務上，並透過新的 `ShellExecutor.ownerOf(id): string | undefined` 方法暴露它（不放在公開的 `BashTask` 上——只有一條讀取路徑，沒有冗餘 API）。`tool-bash` 完全刪除其 `Map`：它在 `start` 時將 `exec.agent?.id`（共享的登錄檔/工作階段 id）蓋章為 owner，`bash_output`/`bash_kill` 則以 `!== undefined` 語義把 `ctx.shell.ownerOf(id)` 與呼叫方 token 比較（空字串 token 仍是真實 owner）。完成通知透過掃描 `ctx.get('agents')?.list()` 尋找 `agent.id === ownerToken` 的存活 agent（經 `ctx.get` 讀取——`onJobDone` 執行在 bash fiber 這一外部 fiber 上，直接使用 `ctx.agents` proxy 會拋例外）。由於所有權現在保存在執行器的任務上（隨 `dsh-shell` fiber dispose），它能跨越 `tool-bash` HMR 重載，關閉舊的 `XXX(tool-bash-owner-hmr)` 缺口。（`onJobDone` 監聽器仍受 `tool-bash` 的 `apply` effect 約束，因此落在重載間隙的完成仍會丟失一條通知——既有的重載間隙丟失——但所有權隔離本身已經不受 HMR 影響。）

## 驗證

以下不變式已經成立，並由測試固定：

- ACP 斷連或外掛程式拆除後，任何由橋接層擁有的工作階段都不留下已註冊 agent 或工作階段儲存條目，包括與連線關閉競爭的建立流程。
- 已入隊的提示詞啟動前執行 `session/cancel`，能阻止該提示詞執行；後來接受的提示詞仍是獨立的已入隊輪次。
- `tool-bash` HMR 重載不會使另一個工作階段能夠讀取或終止已有的背景工作（所有權保留在執行器上）。
- 既有的非 ACP 演示無需顯式管理 handle 仍能工作；由設定建立的 agent 仍歸 `AgentLoop` 外掛程式 fiber 所有。

## 工作階段所有者權杖在存活 agent 中唯一

bash 所有者 token 比較相依性共享的 `Agent.id`/`SessionId` 在存活 agent 中唯一。並行的同 ID 操作可以都私下準備，但發布時會依次登記工作階段和 agent；`SessionStore.enter()` 拒絕重複的存活工作階段 id，每個失敗交易都回滾自己的私有狀態。因此程序化呼叫方無法發布兩個共享同一工作階段 token 的存活 agent。訪問*策略*（token 比較）留在 Consumer `tool-bash`；bash 能力只儲存不透明的 `owner` 字串且從不解釋它——這是正確的 Service Definition / Service Provider / Consumer 拆分。

## 曾考慮的替代方案

- **公開的 `BashTask.owner` 欄位**而非 `ShellExecutor.ownerOf(id)` Service Definition 方法：否決。一條讀取路徑即可，無需冗餘 API。
- **為 agent 的工作階段生命週期使用兄弟 Cordis effect**：否決。fiber 解除安裝時並行釋放兄弟 effect（`Promise.all`），store 擁有的 append 發布掛鉤的移除與迴圈的關閉 `session/flush` 產生競爭；單一複合 effect 的有序 LIFO 鏈才能在兩條釋放路徑上都捕獲關閉的 `turn/end`。
- **在 `cancel()` 之外另設一個僅中止步驟的 `abort()`**：最初發布過，後因無人使用而移除；`cancel()` 是唯一的公開停止原語（見[公開停止介面 Agent Note](../simplification/2026-06-20-public-agent-stop-api.md)）。

## 後果

本變更有意觸及公開介面（`Agent`、`AgentFactory`、bash seam），而非作為 ACP 的區域性修補程式。同步 agent 交付仍然簡單；非同步生命週期路徑是增量新增的，供需要它的所有者使用。
