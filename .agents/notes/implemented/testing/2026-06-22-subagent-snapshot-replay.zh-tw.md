# Agent Note: 巢狀 agent 的逐工作階段快照重播

Status: implemented

[English](2026-06-22-subagent-snapshot-replay.md) | [简体中文](2026-06-22-subagent-snapshot-replay.zh.md) | 繁體中文

## 問題

快照層（`pnpm run test:snapshot`）會啟動真實 `acp-agent` 子行程，透過 [`dsh-llm-replay`](../../../../packages/test-support/llm-replay) 重播已記錄工作階段，並將規範化後的自動化協議輸出 + 重新持久化的工作階段日誌與已提交預期輸出進行 diff。大多數場景透過這條真實行程邊界測試組裝後的後端行為。

該層最初為每個行程只有一個工作階段而建置，這一假設硬編碼在兩處：

- **`dsh-llm-replay` 沒有做任何鍵控。** 它用一個全域性遊標，將第 N 次 `llm/stream` 呼叫對應到單一錄制序列的第 N 條。當父 agent（代理）和一個行程內 subagent 在同一個上下文上同時流式輸出時，呼叫交錯，單一遊標會把子 agent 的指令碼發給父 agent（反之亦然）。
- **harness 只收集一份日誌。** `findSessionLog` 遍歷 sessions 根目錄，返回找到的第一個 `.jsonl`。subagent 作為第二個 `Session` 執行並擁有自己的日誌，因此子 agent 的 transcript（文字記錄）被靜默丟棄。

這就是 [subagent seam Agent Note](../feature/2026-06-21-subagent-capability-seam.md) 中透過 `TODO(subagent-snapshots)` 推遲的工作：行程內後端落地時已有單元 + e2e 覆蓋，但在這套基礎設施落地前，完整 transcript 快照層無法表達巢狀 agent 形狀。

## 決策

重播按**呼叫方工作階段**鍵控，harness 收集**所有**工作階段日誌。

### 1. 呼叫方工作階段 id 附著在模型請求上

`GenerateOptions` 新增選填欄位 `sessionId`，在請求組裝時從 `agent.session.id` 賦值。配接器忽略它；`llm/stream` 監聽器用它按發起工作階段路由。其類型為 `Branded<'SessionId'>`（來自 `dsh-brand`）而非 `dsh-session` 的 `SessionId`，因為後者所在包匯入了 `dsh-llm` 的 `Message`，反向匯入會形成迴圈。兩個類型等價，因此工作階段 id 賦值無需類型轉換。將 brand 移到一個專用 ids 包屬於獨立工作，因為它會影響所有 id 匯入。

### 2. 重播按首次呼叫順序將活躍工作階段綁定到錄制指令碼

巢狀場景錄制多份日誌：父工作階段（`session.jsonl`）加每個 subagent 子工作階段各一份（`session.1.jsonl`……）。`dsh-llm-replay` 全部載入，為每個錄制工作階段派生一份指令碼，並按 header 中的 `createdAt` 排序（父工作階段先於子工作階段建立）。

活躍工作階段 id 每次執行都是全新隨機值，永遠不等於錄制時的 id，因此活躍工作階段無法透過 id 相等綁定到指令碼。取而代之的是**首次呼叫順序**綁定：第一個發起任何模型呼叫的活躍工作階段認領第一份有序指令碼（即父工作階段：`createdAt` 最早，且必然最先流式輸出，因為它必須先執行一個輪次才能委派），下一個新活躍工作階段認領下一份指令碼，依此類推。此後每個工作階段獨立推進自己的遊標。

這種方式按誰在呼叫鍵控，而非按全域性呼叫順序。因此即使 subagent 將來並行或在後臺執行（全域性遊標會導致交錯），它仍然正確。不攜帶 `sessionId` 的呼叫（直接在單元測試中呼叫 `stream()`）被視為一個匿名工作階段、綁定到主指令碼，因此單工作階段路徑與舊行為逐位元組一致。活躍工作階段數多於錄制指令碼數時會明確報錯（出現了未錄制的 subagent），絕不會靜默錯誤路由。

子 fixture（測試前置資料）按 `createdAt` 排序，在兄弟工作階段嚴格順序執行時與呼叫順序一致。id 決勝規則僅用於讓極端情況下的時間戳衝突獲得確定順序。並行或後臺子工作階段必須引入顯式的首次呼叫序號，而非相依性時間戳。

## 曾考慮的替代方案

曾考慮但否決的方案是：**將父子日誌按呼叫順序合併**為一份全域性指令碼（僅在行程內 subagent 執行嚴格巢狀——父 agent 阻塞等待子 agent——時才正確）。對當前的同步實作而言更簡單，但將「父阻塞於子」這一不變式固化了進去；未來若引入後臺/並行 subagent 就會失效。逐工作階段鍵控則不會。

### 3. harness 收集所有日誌，主工作階段優先

`harvestSessionLogs` 遞迴收集 sessions 根目錄下所有固定命名為 `session.jsonl` 的 transcript（JSONL 後端為每個父工作階段和子工作階段分別提供獨立的項目/工作階段目錄），解析各自的 header，並按主工作階段優先排序：頂層工作階段（無 `parentSession`）在前，各子工作階段按 `createdAt` 升序排列。`RunResult.sessionLogs` 包含多份日誌；spec 在錄制時將每份日誌寫回對應 fixture（`session.jsonl` + `session.<n>.jsonl`），在重播時將每份收集到的日誌與其 fixture 做 diff。歸一化器已支持多個工作階段 id 並會摺疊任何遊離 UUID，因此無需修改歸一化器。

### 4. 場景

新增兩個巢狀場景，均對真實 API 錄制：

- **`subagent-spawn-in-process`**：父 agent 透過 `subagent` 工具將一個子任務委派給一個新 spawn 的子 agent（2 個工作階段）。
- **`subagent-multi`**：父 agent 委派兩個子任務，各自交給自己的 spawn 子 agent（3 個工作階段），以三份獨立的逐工作階段指令碼和同一父 agent 下兩個子工作階段的 `createdAt` 排序來壓測逐工作階段鍵控。

兩者均在默認閘門中以 keyless 方式重播。

## 後果

- `TODO(subagent-snapshots)` 延期項已解決：巢狀 agent 的 transcript 現在是快照層的一等形態。
- `GenerateOptions.sessionId` 是一個小而誠實的 core API 新增，在重播之外同樣有用（遙測、請求路由）。
- `subagent` 工具綁定到單一提供方，因此 `subagent-multi` 中的兩個子 agent 都是 spawn（全新建立）。鍵控按工作階段路由而非按後端路由，因此對 fork 同樣正確。但指令碼*派生*邏輯此前不正確：fork 子工作階段的日誌以種子化的父前綴（父工作階段的 `assistant/chunk` 事件）開頭，如果從完整日誌派生指令碼，就會把父 agent 的回應當作子 agent 的來回放。這一正確性缺口透過持久化種子邊界來彌合——見[持久化 seed 邊界以確保 fork 子工作階段重播正確路由](2026-06-22-fork-child-replay-seed-boundary.md)——錄制的 fork 與混合 spawn+fork 場景現在透過一份 transcript 同時驗證兩種傳輸方式（見[記錄 fork 與混合 spawn+fork 快照場景](../../archived/testing/2026-06-22-fork-snapshot-scenarios.md)）。
- 行程外（ACP（Agent Client Protocol））subagent 是完全不同的重播形態（每個子 agent 是自己的行程、有自己的重播），作為 `TODO(acp-subagent-replay)` 記錄在 `subagent-acp` 中。
