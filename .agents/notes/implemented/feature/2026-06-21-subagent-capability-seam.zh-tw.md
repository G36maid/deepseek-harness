# Agent Note: subagent 能力 seam

Status: implemented

[English](2026-06-21-subagent-capability-seam.md) | [简体中文](2026-06-21-subagent-capability-seam.zh.md) | 繁體中文

> 完整 seam 已交付：`dsh-subagent` 介面與 `dsh-tool-subagent` 消費端；兩個行程內後端（`dsh-subagent-spawn-in-process`、`dsh-subagent-fork-in-process`）；巢狀 agent（代理）快照基礎設施（[逐工作階段快照重播](../testing/2026-06-22-subagent-snapshot-replay.md)）；以及行程外的 ACP（Agent Client Protocol）、Codex 與 Claude Code 後端（[ACP Agent Note](2026-06-22-acp-subagent-backend.md)、[產品提供方 Agent Note](2026-08-04-claude-code-and-codex-subagent-backends.md)）。

## 問題

harness 有一個長期擱置的 seam 用於 **subagent**：一個 agent 將工作委派給另一個 agent。這一意圖在 `Agent`/`AgentLoop` 介面中已有草案（[packages/core/agent/src/types.ts](../../../../packages/core/agent/src/types.ts)、[packages/core/agent-loop/src/index.ts](../../../../packages/core/agent-loop/src/index.ts)）：一個建立選項引用父 agent（fork = 用父工作階段的事件日誌初始化子工作階段；spawn = 全新工作階段），子 agent 以 `Agent` 控制代碼返回，使 steering（中途引導）和事件訂閱可以統一工作。

**多種 subagent 實作必須在執行時期共存。**一個父 agent 可能在同一個工作階段中既需要一個廉價的行程內子 agent 處理有限範圍的子任務，又需要一個隔離的行程外子 agent（透過 ACP）。傳輸方式：

- **行程內**：在同一個 `Context` 上建立一個具體的子 `Agent`（最廉價，且鑑於現有 agent 工廠幾乎零成本）；
- **ACP**：作為 ACP *用戶端*驅動另一個 agent 行程（可以是自身的另一個實例）；
- **Codex app-server 與 Claude Code Agent SDK**：當前的一次性同類提供方，將同一個命名提供方約定應用於官方產品行程（[產品提供方 Agent Note](2026-08-04-claude-code-and-codex-subagent-backends.md)）；
- 後續：**A2A**，採用同樣的行程外形態：「啟動子 agent、傳送提示詞、結帳、取消」。

## 曾考慮的替代方案

### 為何不採用 bash seam 的形狀

bash seam（[能力 seam](../architecture/2026-06-13-capability-seams.md)）在每個上下文中只註冊恰好一個 `ShellExecutor`；載入第二個會拋例外。這對 bash 是正確的（一臺機器、一種執行命令的方式），但對這裡是錯誤的：共存纔是需求。因此 subagent 服務是一個**命名提供方登錄檔**——每個實作以唯一名稱註冊，呼叫方按名稱選擇——映像檔 **LLM（大型語言模型）配接器登錄檔**（`LlmRuntime.registerAdapter`），而非單服務的 bash 執行器。seam 仍然是由三類包構成的結構（Service Definition / Service Provider / Consumer）；只是「一個 vs. 多個實作」這個維度不同。

## 決策

### 由三類包構成的邊界

新建包組 `packages/subagent/`：

| 包 | 角色 |
|---|---|
| `@deepseek-ai/dsh-subagent` | 介面：`SubagentRuntime`（`ctx.subagents`）、`SubagentProvider`、`SubagentRun`、請求、結果、能力詞彙、`subagent/*` 事件 |
| `@deepseek-ai/dsh-subagent-spawn-in-process` | 實作：透過 `ctx.agents.create` 建立全新的行程內子 agent |
| `@deepseek-ai/dsh-subagent-fork-in-process` | 實作：用父 agent 日誌快照初始化的行程內子 agent |
| `@deepseek-ai/dsh-subagent-acp` | 實作：作為 ACP 用戶端驅動已設定的子行程 |
| `@deepseek-ai/dsh-subagent-codex` | 實作：一次性官方 Codex app-server 行程 |
| `@deepseek-ai/dsh-subagent-claude-code` | 實作：透過 Agent SDK 執行的一次性官方 Claude Code 行程 |
| `@deepseek-ai/dsh-tool-subagent` | 消費端：基於 `ctx.subagents` 的面向模型的 `subagent` 工具 |

### 原語：非同步 `start → SubagentRun`

提供方暴露 `start(request) → Promise<SubagentRun>`。完成時發布一個子 agent，並將其執行控制代碼轉交給呼叫方。發布前失敗的工作會拒絕 `start()`，而發布後的提示詞、輪次、取消與基礎設施結果會透過 `run.result` 結帳，且不會隱藏 child id。同一個訊號覆蓋發布前後的取消；`dispose()`（資源釋放）取消剩餘工作並等待完全靜止。啟動被拒絕時會清理未發布資源，且不寄出生命週期事件；發布後的結果失敗則會結束已經發布的生命週期事件對。`start` 與傳輸方式無關；`spawn` 僅指代全新的行程內後端。

### 兩類選填能力，兩種發現方式

- **啟動時功能**（`outputSchema`、`depthLimit`、`toolFilter`、`persona`）掛在靜態的 `provider.capabilities` 描述符上。服務在委派之前檢查每個被請求的功能，如果提供方不支持則**響亮拒絕**（`SubagentError('UNSUPPORTED_CAPABILITY')`），絕不接受後靜默忽略。這些功能必須在 run 存在之前檢查，因此不能是執行時期方法。
- **可繼續建立**使用選填的 `SubagentProvider.prepareContinuable` 方法；方法是否存在本身即為能力，TypeScript 類型收窄即為發現機制，因此不需要可能與實作失同步的獨立 flag。繼續執行管理器直接透過 `AgentHandle` 負責後續投遞與冷復原，而一次性 `SubagentRun` 沒有 steering 或 resume 操作，具體由[可繼續 subagent](2026-07-28-continuable-subagent-conversations.md) 細化。

### Fork 與 fresh 是獨立後端，而非一個 flag

全新子 agent 與 fork 子 agent 是獨立的提供方，而非請求中的一個 flag。`dsh-subagent-spawn-in-process` 啟動隔離的子 agent；`dsh-subagent-fork-in-process` 用一個平衡前綴初始化子 agent，該前綴僅包含已完成的父輪次。進行中的輪次被排除，因為其 subagent 呼叫尚無結果，無法構成有效的重播歷史。

### 子 agent 隔離與父日誌

每個行程內 subagent 執行在**自己的 `Session`** 中（獨立 id、`parentSession` 譜系），獨立持久化。遠端 ACP 和一次性產品提供方則會生成一個父級作用域的生命週期 id，且不暴露本機 `Agent` 或子 `Session`；其內部狀態留在遠端行程中。兩種形式下，父日誌都僅記錄 spawn `tool/call` 及其 `tool/result`（子 agent 的最終輸出），而子 agent 的步驟和工具呼叫均留在父日誌之外。

### 同步收集（首版）

`dsh-tool-subagent` 將其執行訊號傳給 `start()`，等待子 agent 結果，並在報告前 dispose 該 run。非完成態的結果變為錯誤結果，而非成功的部分輸出；結果與 dispose 的拒絕相互獨立，且兩項診斷資訊都會保留。

### 提供方選擇是設定，不面向模型

`dsh-tool-subagent` 綁定到恰好一個提供方名稱（`Config.provider`）；模型只看到 `{ description, prompt }`。若要暴露多種傳輸方式，請多次載入該工具外掛程式，每次綁定不同的提供方和不同的 `toolName`（工具登錄檔拒絕重名）。*服務*持有多提供方登錄檔；*工具*選擇其中一個——schema 中沒有提供方/type 參數。

## 測試

登錄檔與工具測試僅用包內指令碼化提供方替換非確定性的子 agent，同時測試真實的 `SubagentRuntime`、生命週期、任務整合和麵向模型的工具。loader 回歸測試仍覆蓋提供方與消費端的 export，以防止[事後檢討（postmortem）0001](../../../../docs/postmortem/0001-acp-default-export-drops-inject.md) 中描述的失敗。登錄檔測試覆蓋重載安全性、重名和啟動時能力拒絕；巢狀 agent 場景透過[逐工作階段快照重播](../testing/2026-06-22-subagent-snapshot-replay.md)進行無金鑰重播；行程內後端還有真實迴圈的單元測試和帶金鑰的 e2e 測試。

## 後果

- **遞迴。** 如果不設限制，行程內子 agent 能看到委派工具並遞迴呼叫。行程內後端實作了選填的絕對深度限制和有作用域的即時全域性 `toolFilter`；ACP 聲明這兩項能力為關閉狀態，並拒絕此類請求。[subagent 組合控制 Agent Note](2026-07-12-subagent-persona-tool-filter-and-depth.md) 負責定義它們的確切語義和安全邊界。
- **阻塞父輪次。** 前臺收集在子 agent 的整個持續時間內保持父 agent 的步驟打開。後臺委派使用共享的 `ctx.jobs` 執行時期與通用 `job_*` 工具，與後臺 bash 共用同一套收集機制；subagent seam 本身仍不感知任務。
- **即時進度。** 僅暴露生命週期事件與最終結果；逐區塊的子→父更新流推遲到後臺重新設計時一並處理。
- **ACP 用戶端介面。** 將 ACP 子 agent 的 `fs`/`terminal` 代理回父 agent（共享工作區模式）是後續工作；該後端不聲明這兩項能力，子 agent 在自己的行程中自行服務。
