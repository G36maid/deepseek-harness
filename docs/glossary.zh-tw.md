# 術語表

[English](glossary.md) | [简体中文](glossary.zh.md) | 繁體中文

DeepSeek Harness 的領域詞彙為每個概念規定一個規範術語。各術語透過標準 Markdown 錨點連結到相應條目；實作細節留在各包的 README 與 Agent Note 中。

## capability-seam

- **seam**：一種包含三種角色的*可替換能力*：**Service Definition**（擁有自身 `ctx.<key>` 和詞彙類型的 Cordis `Service`——可以是 `ShellExecutor` 這樣的抽象類，也可以是 `WebRuntime` 這樣的具體登錄檔，絕不是 TypeScript `interface`）、一個或多個 **Service Provider**，以及一個或多個注入該服務的 **Consumer**。`packages/shell` 是規範範例：`dsh-shell`（Service Definition）、`dsh-bash-local` / `dsh-bash-sandbox`（提供方），以及 `dsh-tool-bash`（Consumer）。角色需要獨立演進時通常位於不同包，但屬於同一關注點時，一個包也可以承擔多個角色（`dsh-llm` 同時承擔 Service Definition 和 Consumer）。seam 是完整能力，絕不是其中一個角色；該術語僅保留此義，能力成員應按其角色、類、服務、約定或擴充點命名。

## agent-scope

- **scope**：按 agent（代理）劃分的註冊單位。一項貢獻（工具、提示詞段、變數、限制、監聽器）要麼是*全域性的*（對所有 agent 可見），要麼是*帶作用域的*（歸屬於恰好一個 [scope key](#scope-key)）。只有兩層，採用扁平結構：帶作用域的註冊不會向下繼承給 subagent；子樹行為透過 [lineage](#lineage) 資料表達，從不透過 scope 結構。
- **scope key**：scope 的不透明標識，按對象同一性比較。harness 約定：一個活躍的 agent 就是其自身 scope 的 key。<a id="scope-key"></a>
- **agent 上下文（`agent.ctx`）**：agent 的帶作用域上下文；透過它進行的註冊既具有 scope 可見性，其生命週期也綁定到該 scope（同一事實決定兩者），其上的監聽器參與該 agent 的 scope 過濾分發。登錄檔主體事件可以根據各自的事件約定有意保持不過濾。
- **scope carrier**：scope 過濾分發所攜帶的 `thisArg`（由 `scopeTarget` 建置）；其過濾器放行無標籤監聽器加上主體自身的監聽器。*無主體*的 carrier（沒有 key）只放行無標籤監聽器。
- **scoped dispatch**：規則是：關於某個 agent 的活動的事件以該 agent 的 carrier 進行分發。關於登錄檔本身的事件（如「一個工具被新增了」）屬於*登錄檔主體*事件，保持不過濾。
- **shadowing**：最具體者勝出的名稱解析：一個帶作用域的工具／片段／變數僅在該 scope 內替換同名的全域性對應項。這是按 agent 訂製 persona 和按 agent 訂製工具變體的機制。
- **restriction / scope-local 註冊**：restriction（`tools.restrict`）為單個 scope 過濾全域性工具集合（多個 restriction 取交集組合）；scope-local 註冊在過濾之後合併。被過濾掉的全域性工具既不出現在提示詞中，也拒絕執行，與不存在的工具無法區分。
- **setup window**：建立者組裝 agent 作用域環境的建立時隙（`CreateAgentOptions.setup`）：此時 scope 和 agent 對象已存在，但 agent 或工作階段尚未發布，`agent/session-start` 尚未觸發，首次提示詞尚未組裝。setup 只做註冊，從不驅動 agent。
- **lineage**：以資料形式攜帶的父子關係事實（`parentSession`、持久的 `delegationDepth`、執行時期 `subagentDepth`）；從不影響可見性。<a id="lineage"></a>

## 目標

- **目標**：附著在現有工作階段上的單個持久完成目標，帶有按修訂號演進的 `active` / `paused` / `blocked` / `complete` 階段和 Goal Round 上限；`blocked` 保留策略程式碼與說明。目標是一種狀態，不是調度器，也不是一段獨立對話；工作階段日誌仍是其真源。
- **Goal Round**：為當前目標接納的一次續行週期。同工作階段驅動器將 Goal Round 具體化為一個由目標觸發的[輪次](#turn)，其中可包含零個或多個步驟；同一工作階段中無關的人類輪次不消耗 Goal Round 上限。<a id="goal-round"></a>
- **目標啟用**：續行消費端接納下一個 Goal Round 的行程本機權限。啟用態為 `armed` 或 `disarmed`；它有意不參與持久重播，因此在復原或 fork 後，只有隨後透過 `/goal` 或模型工具執行一次經人類授權的復原變更，自動工作才能開始。

## 人類命令

- **人類命令**：以斜槓開頭的指令，由面向人類的配接器透過 `ctx.commands` 解釋並執行，不會成為模型訊息。它既不同於面向模型的工具，也不同於透過 `ctx.shell` 執行 shell 命令。
- **命令平面**：由 UI 配接器和命令外掛程式負責的發現、解析、分發、取消與結果算繪機制。除非處理器另行改變持久領域，否則命令輸出屬於 UI 狀態。
- **目標命令**：`/goal` 是由 `dsh-command-goal` 提供的人類命令；它直接觀察或更改當前目標，而目標領域擁有每條持久且模型可見的記錄。

## 迴圈層級

- **輪次**：工作階段中一次對已接納輸入的排空程序，在模型及其工具停止工作或終止策略介入後結束。<a id="turn"></a>
- **步驟**：一次模型請求，以及由模型回應引發的工具執行；一個輪次包含零個或多個步驟。<a id="step"></a>
- **Round**：承載一個輪次的外層策略迭代，例如一個 [Goal Round](#goal-round) 或一次使用全新 agent 的 Ralph 嘗試。Round 計數器歸該策略所有，並不統計工作階段中的每個輪次。<a id="round"></a>

## Ralph

- **Ralph 迴圈**：一次面向不可變目標的前臺全新 agent 工作流程執行。它是由工作流程和 subagent 原語組合而成的面向模型的工具策略，不是同工作階段目標、agent loop（代理循環）模式、調度器或通用工作流程指令碼功能。<a id="ralph-loop"></a>
- **Ralph Round**：[Ralph 迴圈](#ralph-loop)中的一個全新子工作階段。子工作階段不接收父工作階段或此前子工作階段的對話種子；共享工作區和一份有界的 [Ralph 交接](#ralph-handoff)承載跨 Round 的狀態。<a id="ralph-round"></a>
- **Ralph 交接**：從一個仍需繼續的 Ralph Round 傳給下一個 Ralph Round 的規範化、有界結構化報告，包含狀態、摘要、證據、後續步驟和阻塞說明。它補充共享工作區，而不取代工作區的權威地位。<a id="ralph-handoff"></a>
