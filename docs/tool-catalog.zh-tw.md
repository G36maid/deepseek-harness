<!-- 英文原始檔由 scripts/gen-tool-catalog.ts 生成；本中文文件是透過雙語配對維護的經評審對側。
     更新時先執行 `pnpm run gen-tool-catalog` 更新英文，再更新本文件並執行 `pnpm run verify-translation-pairing --write docs/tool-catalog.md` 重新記錄配對。 -->

# 工具 Schema 目錄

[English](tool-catalog.md) | [简体中文](tool-catalog.zh.md) | 繁體中文

已發布外掛程式向 `ctx.tools` 提供的所有面向模型的工具：模型透過系統提示詞組裝獲得的 `name`、`description` 和 JSON Schema `parameters`。本目錄是[子系統頁面](subsystems/core.md)（類型及每頁生成的 `cordis-surface` 接線區域）的補充；本頁列出的是向 agent（代理）提供的*工具*。

英文原始檔由系統**生成**，並透過 `pnpm run verify-tool-catalog`（`doc-sync`（文件同步閘門）的一部分）驗證新鮮度；本中文文件作為經評審對側透過雙語配對維護。與 Cordis 目錄（純原始碼 AST 處理）不同，英文生成器會在真實上下文中**啟動**每個工具外掛程式並讀取 `ctx.tools.schemas()`，因為工具 schema 無法透過靜態分析完全確定，例如執行時期展開的枚舉、拼接的描述、由設定決定的名稱以及使用原始 JSON Schema 的 MCP 工具。完整性守衛會 glob 匹配 `packages/*/tool-*`；如果生成器的啟動 manifest（中繼資料清單）遺漏任何包，檢查就會失敗，因此新工具不會在無人察覺的情況下缺少文件。參見[工具 schema 目錄 Agent Note](../.agents/notes/implemented/process/2026-07-02-tool-schema-catalog.md)。

範圍：`packages/*/tool-*` 下已發布的產品工具，每個工具均使用其**預設**設定啟動；但如果某個 Config 欄位是**必填項**且沒有預設值，生成器就必須作出選擇，對應包的說明會記錄本頁展示的是哪個分支。註冊的工具**名稱**可以是載入時設定，例如 `tool-subagent` 的 `toolName`，因此部署可能以不同名稱或額外名稱提供某個包；如果存在隨產品發布的別名，對應包的說明會予以記錄。`examples/` 中的示範工具（例如 `echo`）不在範圍內，這與 Cordis 目錄僅涵蓋包的範圍一致。

## 工具包對映

下表將模型可見的工具名稱與其背後的外掛程式包和服務 seam 對應起來。各包章節隨後給出確切的 JSON Schema。

| 工具包 | 模型可見名稱 | 相依性 | 寫入／影響 | 隨產品發布的別名 | 部署說明 |
| --- | --- | --- | --- | --- | --- |
| `@deepseek-ai/dsh-tool-ask-user` | `ask_user_question` | `ctx.tools`、`ctx.userQuestions` | `tool/call`、`tool/result after a UI/provider answers the question` | - | ask_user_question 會暫停工具呼叫，直到當前 UI 提供方返回人類答案。 |
| `@deepseek-ai/dsh-tools` | `run_code` | `ctx.tools`、`ctx.codeRuntime (execution time)`、`ctx.systemPrompt` | `tool/call`、`one tool/code-dispatch-start + tool/code-dispatch pair per bridged sub-call`、`tool/result` | - | 在 `mode: code`／`mode: both` 下，它由工具登錄檔所有，作為可過濾能力層之外的保留傳輸機制（參見 Code Mode Agent Note）。在 `code` 下，它是登錄檔對協定格式（wire format）的唯一貢獻；其他可見能力在使用已載入執行時期語言生成的 SDK 章節中聲明。程序透過 binding 呼叫這些能力，呼叫按照原生並行約定調度：啟動順序和策略遵循提交順序，並行安全的函式體最多重疊執行 `maxParallelSubCalls` 個。呼叫會重新進入完整且受守衛保護的工具管線，並將每個巢狀執行關聯到此外層結果。 |
| `@deepseek-ai/dsh-plan-mode` | `exit_plan_mode` | `ctx.tools`、`ctx.systemPrompt`、`ctx.userQuestions (execution time, opportunistic)` | `tool/call`、`plan/mode inactive on an approved review`、`tool/result` | - | 規劃未啟用時，exit_plan_mode 仍保留在面向模型的 schema 中，這樣狀態轉換不會在規劃策略變更之外額外造成工具目錄變動。其執行路徑會拒絕規劃模式之外的呼叫；在規劃模式下，它透過使用者互動 seam 提交計畫（批准／根據回饋繼續規劃），批准後會在步驟邊界記錄規劃模式已停用。 |
| `@deepseek-ai/dsh-tool-bash` | `bash` | `ctx.tools`、`ctx.shell`、`ctx.systemPrompt`、`ctx.shellEnv`、`ctx.jobs at call time for run_in_background` | `tool/call`、`tool/result` | - | bash 工具是 bash 執行器 seam 面向模型的消費端。使用 `run_in_background` 的執行會註冊到通用 `ctx.jobs` 執行時期，並透過 `job_*` 工具（來自 `@deepseek-ai/dsh-tool-jobs`）收集／停止；停用 `enableRunInBackground` 設定（預設為 true）後，該參數會被完全移除。 |
| `@deepseek-ai/dsh-tool-pwsh` | `pwsh` | `ctx.tools`、`ctx.shell`、`ctx.systemPrompt`、`ctx.shellEnv`、`ctx.jobs at call time for run_in_background` | `tool/call`、`tool/result` | - | pwsh 工具是 Windows 組閤中 bash 執行器 seam 的 PowerShell 方言消費端（由 `@deepseek-ai/dsh-pwsh-local` 等 PowerShell 執行器為 `ctx.shell` 提供後端）；除沙盒介面外，它逐項對應 bash 工具呼叫。使用 `run_in_background` 的執行會註冊到通用 `ctx.jobs` 執行時期，並透過 `job_*` 工具收集／停止；託管的 `DSH_*` 環境來自 `@deepseek-ai/dsh-shell-env`。每次呼叫都在新行程中執行，不使用持久 PTY 工作階段。路徑採用原生 `C:\...` 形式，變數採用 `$env:NAME`。 |
| `@deepseek-ai/dsh-tool-cordis` | `cordis_define`、`cordis_inspect_list`、`cordis_inspect_query`、`cordis_inspect_self`、`cordis_run`、`cordis_stop`、`cordis_undefine` | `ctx.tools`、`ctx.dynamicCordisRunner` | `tool/call`、`tool/result`、`process-local dynamic package lifecycle` | - | 不在任何隨產品發布的樹中，需要顯式選擇啟用；動態 Package 程式碼可以訪問真實執行時期，見 .agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md。該工具集註入 `@deepseek-ai/dsh-cordis-host-runner` 提供的 `ctx.dynamicCordisRunner`，後者擁有定義登錄檔和 vm 沙盒；組合缺少它時這些工具不會啟用。執行中的 Package 在停止、undefine 或 DSH 重新啟動前可以註冊**額外的**模型可見工具；發生這類工具集變化時，系統會記錄完整且有變動的請求標頭。 |
| `@deepseek-ai/dsh-tool-bash-persistent` | `bash` | `ctx.tools`、`ctx.terminals`、`an owning Agent at execution time` | `tool/call`、`PTY shell state`、`tool/result` | - | 一個按所有者隔離的持久 bash 工具；部署組合提供 PTY 後端，並可覆蓋面向模型的環境描述。 |
| `@deepseek-ai/dsh-tool-str-replace-editor` | `str_replace_editor` | `ctx.tools`、`ctx.fs` | `tool/call`、`fs/observed after view presence/absence, edit absence, or successful mutation`、`tool/result` | - | 基於檔案系統 seam 的獨立查看／建立／唯一字面量替換／按行插入工具；可與任何 shell 或終端機介面組合。 |
| `@deepseek-ai/dsh-tool-fs` | `edit`、`read`、`read_image`、`write` | `ctx.tools`、`ctx.fs`、`ctx.systemPrompt`、`ctx.attachments (read_image registration)`、`ctx.llm + an image-capable route (read_image execution)` | `tool/call`、`fs/write-intent or fs/edit-intent for mutations`、`fs/observed after read presence/absence or successful file operation`、`durable attachment (read_image)`、`tool/result` | - | 先讀後寫／編輯策略由 `@deepseek-ai/dsh-fs-observation-policy` 新增；它是一個 `fs/*` 事件閘門外掛程式，不會改變 schema。載入這些工具的部署按預期也應載入該外掛程式。沒有 `ctx.attachments` 時 `read_image` 不會註冊；其 schema 與路由無關，執行時除非確切路由的模型聲明影像輸入，否則拒絕。 |
| `@deepseek-ai/dsh-tool-fs-search` | `glob`、`grep` | `ctx.tools`、`ctx.subprocess`、`ctx.systemPrompt` | `tool/call`、`tool/result` | - | glob 和 grep 是無條件可用的發現工具，透過 ctx.subprocess spawn 隨包提供的 ripgrep 二進位檔案（`@vscode/ripgrep`），並作為普通前臺呼叫執行，絕不作為背景工作；無需在宿主機安裝 `rg`，也不經過 shell 層。本目錄使用 `sampleOverCapGlobResults: true`；部署必須顯式選擇該行為。結果超過上限時，會透過選填的 ctx.spillStore 後端保存完整的格式化清單；在共置部署中，如果後端公開本機路徑，返回的定位資訊可供後續讀取／搜尋。 |
| `@deepseek-ai/dsh-tool-terminal` | `terminal_close`、`terminal_list`、`terminal_open`、`terminal_read`、`terminal_send`、`terminal_signal` | `ctx.tools`、`ctx.terminals`、`ctx.systemPrompt`、`ctx.jobs at call time for run_in_background` | `tool/call`、`tool/result` | - | 這 6 個終端機工具需要選擇啟用，用於補充一次性 bash／檔案系統工具。`terminal_send(run_in_background: true)` 會註冊到 `ctx.jobs`；schema 不包含 TUI、具名按鍵序列、BEL、調整尺寸、自動啟動和跨 agent 共享。 |
| `@deepseek-ai/dsh-tool-goal` | `create_goal`、`get_goal`、`update_goal` | `ctx.tools`、`ctx.agents`、`ctx.goals`、`ctx.systemPrompt`、`a calling Agent in an authorized open turn` | `tool/call`、`goal/change for mutations`、`tool/result` | - | create、edit、pause 和 resume 要求直接來自人類的根權限；complete 和 blocked 也接受確切的當前 Goal Round。blocked 的預設下限是 3 個獲準的 Round。 |
| `@deepseek-ai/dsh-schedule` | `schedule_create`、`schedule_delete`、`schedule_list` | `ctx.tools`、`ctx.sessions`、Session 持久化、未來建立的 live 根 Agent | `tool/call`、`schedule/change create or delete`、`tool/result` | - | 僅在選擇啟用的 Schedule 外掛程式載入後建立的 live 根 Agent scope 內註冊。版本 1 接受 after_seconds、顯式絕對 at 和有界固定速率 every_seconds，並披露 session-local 交付；管理讀取與變更必須透過共享的 Session 持久化 barrier。 |
| `@deepseek-ai/dsh-tool-lsp` | `lsp` | `ctx.tools`、`ctx.lsp`、`ctx.systemPrompt` | `tool/call`、`tool/result` | - | lsp 工具將提供方選擇和語言伺服器子行程置於 ctx.lsp 之後，因此其模型可見 schema 在更換提供方時保持穩定。執行時期要求已註冊提供方，例如 `@deepseek-ai/dsh-lsp-stdio`；如果沒有提供方，查詢會返回結構化 `LSP_UNAVAILABLE` 錯誤，而不會改變 schema。 |
| `@deepseek-ai/dsh-tool-ralph` | `ralph` | `ctx.tools`、`ctx.workflowEngine`、`ctx.subagents`、`ctx.systemPrompt`、`a calling Agent (exec.agent parents every fresh round)` | `tool/call`、`tool/result`、`workflow and child session events during execution` | - | 固定的前臺工作流程會在每個 Round 啟動一個全新的結構化子級；模型只能選擇不可變目標和選填的 Round 上限。 |
| `@deepseek-ai/dsh-tool-skill` | `skill` | `ctx.tools`、`ctx.agents`、`ctx.skills` | `tool/call`、`tool/result`、`user/message replacement catalogs via agent.inject()` | - | - |
| `@deepseek-ai/dsh-tool-session-query` | `session_event_read`、`session_event_search`、`session_event_trace`、`session_search`、`session_trace` | `ctx.tools`、`ctx.systemPrompt`、`ctx.sessionQuery`、`a calling Agent for workspace authority` | `tool/call`、`tool/result` | - | 這 5 個只讀工具會隱藏提供方遊標，並根據不可變的呼叫 agent 工作階段為每個結果授權。該包需要選擇啟用；需要強制截止時間或限制行內輸出的組合還會掛載通用逾時或 spill 策略。 |
| `@deepseek-ai/dsh-tool-subagent` | `subagent` | `ctx.tools`、`ctx.subagents`、`ctx.systemPrompt` | `tool/call`、`tool/result`、`child session events through the chosen provider` | `subagent`、`subagent_fork` | 註冊的工具名稱取決於載入時 `toolName` 設定（預設為 `subagent`）；上述 schema 對應預設值。隨產品發布的組合會為每個 subagent 後端載入一次該包，因此模型還會看到綁定到 fork 後端的 `subagent_fork`。每個實例的描述、`run_in_background` 參數與 system prompt 策略取決於它自己的 `backgroundMode` 和 `enableRunInBackground`，因此兩個隨附 schema 並不相同：`subagent` 為 `continuable`，省略參數時預設後臺執行，並由 runtime 自動投遞結束結果；`subagent_fork` 保持 `one-shot`，省略參數時預設前景執行。詳見 `packages/bundle/base/cordis.patch.yml` 和 `examples/acp-agent/cordis.yml`。 |
| `@deepseek-ai/dsh-tool-subagent-control` | `interrupt_agent`、`list_agents`、`send_message` | `ctx.tools`、`ctx.subagents`、`ctx.agents and ctx.sessionProjections (list_agents only)` | `tool/call`、`tool/result`、`child session events through ctx.subagents` | - | 這些是控制可繼續後臺 subagent 的全域性命名工具：綁定提供方的 `tool-subagent` 實例註冊不同的委派工具；本包註冊一次 `send_message` 和 `interrupt_agent`，另由 `list_agents` 透過單獨載入的 `/list-agents` 外掛程式提供，其目錄行使用 sessionProjections 和即時 Agent 登錄檔。 |
| `@deepseek-ai/dsh-tool-subagent-report` | `report` | `ctx.subagents`、`ctx.systemPrompt`、`a live continuable in-process child Agent` | `tool/call`、`tool/result`、`a user-role message in the direct parent session` | - | 按可繼續的行程內子級註冊，而非全域性註冊，因此該 schema 僅在這種子級內部可見，並且不受其全域性 `toolFilter` 影響。同一份貢獻還會安裝子級作用域的 `tool:report` 系統提示詞 section，本目錄不算繪該 section。面向父級的 `send_message` 工具單獨安裝。 |
| `@deepseek-ai/dsh-tool-jobs` | `job_kill`、`job_list`、`job_output` | `ctx.tools`、`ctx.jobs`、`ctx.systemPrompt` | `tool/call`、`tool/result`、`user/message via agent.inject() for background completion notices` | - | 與任務種類無關的背景工作控制器：後臺 bash 命令、PTY 傳送和 subagent 都透過相同的 3 個工具讀取、列出和終止。載入該外掛程式會掛接控制器，從而啟用生產方的 `ctx.jobs.start()`。 |
| `@deepseek-ai/dsh-tool-todo` | `todo_write` | `ctx.tools`、`owning Agent session` | `tool/call`、`todo/write`、`tool/result` | - | todo_write 是工作階段所有的狀態；UI 將最新的 todo/write 事件算繪為檢查清單。`allowParallelInProgress` 是沒有預設值的必填項，因此本目錄明確選擇 `true`，對應描述允許同時存在多個 `in_progress` 項。選擇 `false` 的部署會獲得同一工具，但描述會要求只能有 1 個活動任務。 |
| `@deepseek-ai/dsh-tool-workflow` | `workflow` | `ctx.tools`、`ctx.workflowEngine`、`ctx.systemPrompt`、`a calling Agent (exec.agent parents the script children)` | `tool/call`、`tool/result` | - | - |
| `@deepseek-ai/dsh-tool-web` | `web_fetch`、`web_search` | `ctx.tools`、`ctx.web`、`ctx.systemPrompt` | `tool/call`、`tool/result` | - | web_search 和 web_fetch 將提供方選擇置於 ctx.web 之後，使模型可見 schema 在更換後端時保持穩定。 |

<a id="deepseek-aidsh-tool-ask-user"></a>

## `@deepseek-ai/dsh-tool-ask-user`

### `ask_user_question`

繼續操作前，如果需要確認、選擇或缺失的資訊，請向使用者提出簡明問題。傳送一個或多個問題，每個問題都帶一個穩定 id，該 id 會在答案中原樣返回。

```json
{
  "type": "object",
  "properties": {
    "questions": {
      "type": "array",
      "description": "Questions to ask the user before continuing.",
      "items": {
        "type": "object",
        "additionalProperties": true,
        "properties": {
          "id": {
            "type": "string",
            "description": "Stable id for this question; echoed in the answer."
          },
          "question": {
            "type": "string",
            "description": "The specific question to ask the user."
          },
          "header": {
            "type": "string",
            "description": "Optional short heading for the question, such as \"Confirm\" or \"Choose Mode\"."
          },
          "options": {
            "type": "array",
            "description": "Optional choices to show the user. If you recommend one, put it first and append \"(Recommended)\" to that label.",
            "items": {
              "type": "object",
              "additionalProperties": true,
              "properties": {
                "label": {
                  "type": "string",
                  "description": "Short user-facing option label."
                },
                "description": {
                  "type": "string",
                  "description": "One sentence explaining the tradeoff or impact."
                }
              },
              "required": [
                "label"
              ]
            }
          },
          "multi_select": {
            "type": "boolean",
            "description": "Whether the user may select more than one option. Defaults to false."
          }
        },
        "required": [
          "id",
          "question"
        ]
      }
    }
  },
  "required": [
    "questions"
  ]
}
```

來源：[`packages/interaction/tool-ask-user/src/index.ts`](../packages/interaction/tool-ask-user/src/index.ts)

ask_user_question 會暫停工具呼叫，直到當前 UI 提供方返回人類答案。

<a id="deepseek-aidsh-tools"></a>

## `@deepseek-ai/dsh-tools`

### `run_code`

針對可用工具執行 TypeScript 程序。接受兩個必填參數：`code`，即非同步函式的**函式體**（僅使用可擦除文法；支援頂層 `await` 和 `return`）；以及 `description`，簡要說明該程序做什麼。請根據系統提示詞中的聲明，以 `await tools.name(args)` 形式呼叫工具。只有列印或返回的內容會傳回，請謹慎篩選。

```json
{
  "type": "object",
  "properties": {
    "code": {
      "type": "string",
      "description": "The program: the body of an async TypeScript function."
    },
    "description": {
      "type": "string",
      "description": "Clear, concise description of what this program does in active voice, 5-10 words (shown in the UI). Examples: \"Count TODO markers across packages\"; \"Read failing test and its fixture\"; \"Rename config key in every cordis.yml\"."
    }
  },
  "required": [
    "code",
    "description"
  ]
}
```

來源：[`packages/core/tools/src/code-mode.ts`](../packages/core/tools/src/code-mode.ts)

在 `mode: code`／`mode: both` 下，它由工具登錄檔所有，作為可過濾能力層之外的保留傳輸機制（參見 Code Mode Agent Note）。在 `code` 下，它是登錄檔對協定格式的唯一貢獻；其他可見能力在使用已載入執行時期語言生成的 SDK 章節中聲明。程序透過 binding 呼叫這些能力，呼叫按照原生並行約定調度：啟動順序和策略遵循提交順序，並行安全的函式體最多重疊執行 `maxParallelSubCalls` 個。呼叫會重新進入完整且受守衛保護的工具管線，並將每個巢狀執行關聯到此外層結果。

<a id="deepseek-aidsh-plan-mode"></a>

## `@deepseek-ai/dsh-plan-mode`

### `exit_plan_mode`

僅在規劃模式下使用。提交計畫供使用者評審，並在獲批後退出規劃模式。傳送**完整的** Markdown 計畫，以一個為計畫命名的 # 標題開頭。使用者可以批准（從你的下一步驟起執行計畫），也可以要求繼續規劃；其回饋會透過工具結果返回，請修改後再次提交。

```json
{
  "type": "object",
  "properties": {
    "plan": {
      "type": "string",
      "description": "The complete plan, as markdown, starting with a # heading that names it."
    }
  },
  "required": [
    "plan"
  ]
}
```

來源：[`packages/plan/plan-mode/src/index.ts`](../packages/plan/plan-mode/src/index.ts)

規劃未啟用時，exit_plan_mode 仍保留在面向模型的 schema 中，這樣狀態轉換不會在規劃策略變更之外額外造成工具目錄變動。其執行路徑會拒絕規劃模式之外的呼叫；在規劃模式下，它透過使用者互動 seam 提交計畫（批准／根據回饋繼續規劃），批准後會在步驟邊界記錄規劃模式已停用。

<a id="deepseek-aidsh-tool-bash"></a>

## `@deepseek-ai/dsh-tool-bash`

### `bash`

執行 bash 命令（`bash -c`）並返回 stdout/stderr。每次呼叫都在新 shell 中執行：呼叫之間不保留任何狀態（cwd、變數、函式），請傳入 `workdir`，不要使用 `cd`。非零結束會報告為 `[exit code: N]`。當前 harness 環境資訊透過託管的 `$DSH_*` 變數公開，需要時請檢查這些變數。命令可能在文件沙盒中執行；被阻止的文件操作報告為 `[sandbox: file access denied under <mode> mode]`，這是策略拒絕，而不是命令缺陷，請勿換一種方式重試。較長的輸出會截斷，只保留尾部；如可用，完整輸出會保存到文件並報告其路徑。對於長時間執行的命令，請設定 `run_in_background: true`：呼叫會立即返回 job id；使用 `job_output` 讀取輸出，使用 `job_kill` 停止任務。

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "The bash command to execute."
    },
    "description": {
      "type": "string",
      "description": "Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI). Examples: \"ls\" → \"List files in current directory\"; \"git status\" → \"Show working tree status\"; \"npm install\" → \"Install package dependencies\"."
    },
    "timeoutMs": {
      "type": "number",
      "description": "Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry."
    },
    "workdir": {
      "type": "string",
      "description": "Working directory for this command. Defaults to the session workspace; a relative path is resolved against it."
    },
    "run_in_background": {
      "type": "boolean",
      "description": "Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies."
    }
  },
  "required": [
    "command",
    "description"
  ]
}
```

來源：[`packages/shell/tool-bash/src/index.ts`](../packages/shell/tool-bash/src/index.ts)

bash 工具是 bash 執行器 seam 面向模型的消費端。使用 `run_in_background` 的執行會註冊到通用 `ctx.jobs` 執行時期，並透過 `job_*` 工具（來自 `@deepseek-ai/dsh-tool-jobs`）收集／停止；停用 `enableRunInBackground` 設定（預設為 true）後，該參數會被完全移除。

<a id="deepseek-aidsh-tool-pwsh"></a>

## `@deepseek-ai/dsh-tool-pwsh`

### `pwsh`

執行 PowerShell 命令（`pwsh -Command`）並返回 stdout/stderr。每次呼叫都在新的 pwsh 行程中執行：呼叫之間不保留任何狀態（cwd、變數、函式），請傳入 `workdir`，不要使用 `cd`。路徑採用 Windows 原生形式（`C:\...`）；使用 `$env:NAME` 讀取環境變數。非零結束會報告為 `[exit code: N]`。當前 harness 環境資訊透過託管的 `$env:DSH_*` 變數公開，需要時請檢查這些變數。命令可能在文件沙盒中執行；被阻止的文件操作報告為 `[sandbox: file access denied under <mode> mode]`，這是策略拒絕，而不是命令缺陷，請勿換一種方式重試。較長的輸出會截斷，只保留尾部；如可用，完整輸出會保存到文件並報告其路徑。在 Windows 上，被強制終止的命令會以 `[exit code: 1]` 結帳且不帶訊號標記，請將其視為中斷，而不是命令失敗。對於長時間執行的命令，請設定 `run_in_background: true`：呼叫會立即返回 job id；使用 `job_output` 讀取輸出，使用 `job_kill` 停止任務。

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "The PowerShell command to execute."
    },
    "description": {
      "type": "string",
      "description": "Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI). Examples: \"ls\" → \"List files in current directory\"; \"git status\" → \"Show working tree status\"; \"Get-Process\" → \"List running processes\"."
    },
    "timeoutMs": {
      "type": "number",
      "description": "Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry."
    },
    "workdir": {
      "type": "string",
      "description": "Working directory for this command. Defaults to the session workspace; a relative path is resolved against it."
    },
    "run_in_background": {
      "type": "boolean",
      "description": "Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies."
    }
  },
  "required": [
    "command",
    "description"
  ]
}
```

來源：[`packages/shell/tool-pwsh/src/index.ts`](../packages/shell/tool-pwsh/src/index.ts)

pwsh 工具是 Windows 組閤中 bash 執行器 seam 的 PowerShell 方言消費端（由 `@deepseek-ai/dsh-pwsh-local` 等 PowerShell 執行器為 `ctx.shell` 提供後端）；除沙盒介面外，它逐項對應 bash 工具呼叫。使用 `run_in_background` 的執行會註冊到通用 `ctx.jobs` 執行時期，並透過 `job_*` 工具收集／停止；託管的 `DSH_*` 環境來自 `@deepseek-ai/dsh-shell-env`。每次呼叫都在新行程中執行，不使用持久 PTY 工作階段。路徑採用原生 `C:\...` 形式，變數採用 `$env:NAME`。

<a id="deepseek-aidsh-tool-cordis"></a>

## `@deepseek-ai/dsh-tool-cordis`

### `cordis_define`

定義一個不可變的 Cordis Package。新建 Plugin 時使用 kind:"new"，只提供 3 至 6 位小寫英文字母組成的語義前綴；Host 返回最終 pluginId 和 packageId。修改現有 Plugin 時使用 kind:"existing" 並傳入精確 pluginId，以追加 Package 而不覆蓋舊版本。code.host 與 code.client 至少提供一個；每個值都是返回 Cordis Plugin 的 plain JavaScript 函式體，不經過 TypeScript、JSX 或 import 轉換。相依性 Service、Event、Builtin、Slot 或 token 前先查詢 Inspect。Define 只校驗參數和文法並記錄原始碼，不申請審批、不執行 apply，也不改變 currentPackageId。成功後用返回的 ID 呼叫 cordis_run。

```json
{
  "type": "object",
  "properties": {
    "plugin": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "kind": {
              "type": "string",
              "const": "new"
            },
            "idPrefix": {
              "type": "string",
              "description": "Suggested semantic prefix of 3–6 lowercase English letters; the Host adds a unique numeric suffix."
            }
          },
          "required": [
            "kind",
            "idPrefix"
          ]
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "kind": {
              "type": "string",
              "const": "existing"
            },
            "pluginId": {
              "type": "string",
              "description": "Exact ID of an existing Plugin; the new Package is appended to that instance."
            }
          },
          "required": [
            "kind",
            "pluginId"
          ]
        }
      ]
    },
    "name": {
      "type": "string",
      "description": "Short, readable Package name."
    },
    "purpose": {
      "type": "string",
      "description": "One-sentence, user-facing description of the Package purpose."
    },
    "code": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "host": {
          "type": "string",
          "description": "Plain JavaScript function body that returns the Host-half Cordis Plugin."
        },
        "client": {
          "type": "string",
          "description": "Plain JavaScript function body that returns the browser Client-half Cordis Plugin."
        }
      }
    }
  },
  "required": [
    "plugin",
    "name",
    "purpose",
    "code"
  ]
}
```

來源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_inspect_list`

列出 Host 當前已知的全部 Cordis Inspect Provider，包括本機 Host Provider 和 Client 最近同步的 manifest。每項包含所屬平臺、用途、只讀方法及輸入／輸出 schema。建立或修改 Package 前先呼叫本 Tool，再從結果中選擇 cordis_inspect_query 的 provider 和 method。不要猜測名稱，也不要把 Inspect method 當作 Plugin 程式碼可呼叫的業務 Service。

```json
{
  "type": "object",
  "properties": {}
}
```

來源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_inspect_query`

執行 Inspect Provider 顯式聲明的只讀查詢。platform、provider 和 method 必須來自 cordis_inspect_list，input 必須符合該方法的 schema。在 cordis_define 前用本 Tool 讀取精確 Service 方法、Event mode、Builtin 簽名、Tool schema、主題 token，或即時 Slot 樹及 props。Host 查詢在本機執行；Client 查詢等待首個有效頁面回應，在頁面回答或 Tool 被取消前保持 pending。本 Tool 不能呼叫業務 Service 方法或修改執行時期。查詢 Service.listService 和 Event.listEvents 時，先不傳 input 瀏覽緊湊簽名目錄，再查詢精確 service 或 event 取得結構化約定和引用類型。查詢 Slots.listSubTree 時，先不傳 root 瀏覽緊湊樹，再查詢精確 root 取得完整註冊約定和 props。

```json
{
  "type": "object",
  "properties": {
    "platform": {
      "type": "string",
      "description": "Runtime platform that owns the Provider.",
      "enum": [
        "host",
        "client"
      ]
    },
    "provider": {
      "type": "string",
      "description": "Exact Provider ID returned by cordis_inspect_list."
    },
    "method": {
      "type": "string",
      "description": "Exact method name declared by the Provider manifest."
    },
    "input": {
      "description": "Optional query input; it must satisfy the method input schema."
    }
  },
  "required": [
    "platform",
    "provider",
    "method"
  ]
}
```

來源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_inspect_self`

按逐層增加的詳細程度檢查當前 Session 擁有的動態 Cordis 對象。不傳 ID 時只列 Plugin 摘要；只傳 pluginId 時返回版本指針、最新 Run 和全部 Package 摘要；只有同時傳 pluginId 與 packageId 才返回該不可變 Package 的 Host/Client 原始碼和執行診斷。packageId 不能單獨傳入。處理 @pluginId、修復非同步失敗或定義更新版本前，先查詢精確 Package。本 Tool 只讀，不執行程式碼，也不改變版本指針。

```json
{
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "description": "Stable Plugin ID returned by cordis_define or injected by @pluginId; omit it to list every current Plugin."
    },
    "packageId": {
      "type": "string",
      "description": "Exact immutable Package ID owned by pluginId; when specified, source and diagnostics are returned."
    }
  }
}
```

來源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_run`

啟用動態 Plugin 的一個精確 Package。首次啟用、重新啟動 currentPackageId 或回退使用 mode:"run"；已有 current 時，即使 Plugin 當前已停止，切換到其他 Package 也使用 mode:"update"。未授權的 Client Package 建立審批請求並返回 awaiting-approval；已授權的 Package 返回 starting，並在瀏覽器中非同步繼續。兩種結果都不會在 Tool 內等待最終結局。currentPackageId 只在完整成功後改變；失敗時保留舊 current 和目標 next。非同步成功、拒絕或技術失敗透過狀態與 steering 報告。技術失敗後，用 cordis_inspect_self 讀取診斷，修正同一 Plugin 並自主重試。使用者拒絕後不要再次申請審批。

```json
{
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "description": "Stable Plugin ID returned by cordis_define."
    },
    "packageId": {
      "type": "string",
      "description": "Exact immutable Package ID to activate under that Plugin."
    },
    "mode": {
      "type": "string",
      "description": "Use run for the first activation, restarting current, or rollback; use update to switch from current to a different Package.",
      "enum": [
        "run",
        "update"
      ]
    }
  },
  "required": [
    "pluginId",
    "packageId",
    "mode"
  ]
}
```

來源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_stop`

停止動態 Plugin 的當前 Run，並取消尚未完成的審批或啟用請求。保留 Plugin、全部不可變 Package、授權、currentPackageId 和 nextPackageId，以便之後直接執行或更新。停止已處於停止狀態的 Plugin 會冪等成功。臨時停用副作用使用本 Tool；永久移除使用 cordis_undefine。

```json
{
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "description": "Stable dynamic Plugin ID to stop."
    }
  },
  "required": [
    "pluginId"
  ]
}
```

來源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_undefine`

永久移除當前 Session 擁有的動態 Plugin。如果它正在執行或等待審批，先停止並取消請求，再刪除全部 Package、授權和版本指針。返回後，其 pluginId、packageIds、@ 引用和 Package 業務檢視表均失效；歷史卡片只保留“Plugin 已移除”記錄。需要保留版本以便重新啟動或回退時不要呼叫本 Tool，應改用 cordis_stop。

```json
{
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "description": "Stable dynamic Plugin ID to remove permanently."
    }
  },
  "required": [
    "pluginId"
  ]
}
```

來源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

不在任何隨產品發布的樹中，需要顯式選擇啟用；動態 Package 程式碼可以訪問真實執行時期，見 .agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md。該工具集註入 `@deepseek-ai/dsh-cordis-host-runner` 提供的 `ctx.dynamicCordisRunner`，後者擁有定義登錄檔和 vm 沙盒；組合缺少它時這些工具不會啟用。執行中的 Package 在停止、undefine 或 DSH 重新啟動前可以註冊**額外的**模型可見工具；發生這類工具集變化時，系統會記錄完整且有變動的請求標頭。

<a id="deepseek-aidsh-tool-bash-persistent"></a>

## `@deepseek-ai/dsh-tool-bash-persistent`

### `bash`

在持久 bash shell 中執行命令。包括當前目錄和已匯出環境變數在內的狀態會在此 agent 的多次呼叫之間保留。

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "The bash command to run. Relative path is preferred in the command."
    }
  },
  "required": [
    "command"
  ]
}
```

來源：[`packages/shell/tool-bash-persistent/src/index.ts`](../packages/shell/tool-bash-persistent/src/index.ts)

一個按所有者隔離的持久 bash 工具；部署組合提供 PTY 後端，並可覆蓋面向模型的環境描述。

<a id="deepseek-aidsh-tool-str-replace-editor"></a>

## `@deepseek-ai/dsh-tool-str-replace-editor`

### `str_replace_editor`

用於查看、建立和編輯文件的自訂編輯工具：

* 狀態會在命令呼叫以及與使用者的討論之間持久保留
* 如果 `path` 是文件，`view` 會顯示應用 `cat -n` 後的結果。如果 `path` 是目錄，`view` 會列出最多向下 2 層的非隱藏文件和目錄
* 如果指定的 `create` 命令目標 `path` 已作為文件存在，則不能使用該命令
* 如果 `command` 產生較長輸出，輸出會被截斷並標記為 `<response clipped>`

使用 `str_replace` 命令時請注意：

* `old_str` 參數應與原文件中一行或多行連續內容**完全**匹配。請留意空白字元！
* 如果 `old_str` 參數在文件中不唯一，則不會執行替換。請確保在 `old_str` 中包含足夠的上下文，使其唯一
* `new_str` 參數應包含用於替換 `old_str` 的已編輯行

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "The commands to run. Allowed options are: `view`, `create`, `str_replace`, `insert`.",
      "enum": [
        "view",
        "create",
        "str_replace",
        "insert"
      ]
    },
    "path": {
      "type": "string",
      "description": "Absolute path to file or directory, e.g. `/repo/file.py` or `/repo`."
    },
    "file_text": {
      "type": "string",
      "description": "Required parameter of `create` command, with the content of the file to be created."
    },
    "insert_line": {
      "type": "integer",
      "description": "Required parameter of `insert` command. The `new_str` will be inserted AFTER the line `insert_line` of `path`."
    },
    "new_str": {
      "type": "string",
      "description": "Optional parameter of `str_replace` command containing the new string (if not given, no string will be added). Required parameter of `insert` command containing the string to insert."
    },
    "old_str": {
      "type": "string",
      "description": "Required parameter of `str_replace` command containing the string in `path` to replace."
    },
    "view_range": {
      "type": "array",
      "description": "Optional parameter of `view` command when `path` points to a file. If none is given, the full file is shown. If provided, the file will be shown in the indicated line number range, e.g. [11, 12] will show lines 11 and 12. Indexing at 1 to start. Setting `[start_line, -1]` shows all lines from `start_line` to the end of the file.",
      "items": {
        "type": "integer"
      }
    }
  },
  "required": [
    "command",
    "path"
  ]
}
```

來源：[`packages/fs/tool-str-replace-editor/src/index.ts`](../packages/fs/tool-str-replace-editor/src/index.ts)

基於檔案系統 seam 的獨立查看／建立／唯一字面量替換／按行插入工具；可與任何 shell 或終端機介面組合。

<a id="deepseek-aidsh-tool-fs"></a>

## `@deepseek-ai/dsh-tool-fs`

### `edit`

透過替換字面量文字來編輯現有 UTF-8 文字文件。

```json
{
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string",
      "description": "Path to edit, resolved by the filesystem backend."
    },
    "old_string": {
      "type": "string",
      "description": "Literal text to replace. Must match exactly."
    },
    "new_string": {
      "type": "string",
      "description": "Literal replacement text. Use an empty string to delete the match."
    },
    "replace_all": {
      "type": "boolean",
      "description": "Replace all matches. Defaults to false; when false, old_string must appear exactly once."
    }
  },
  "required": [
    "file_path",
    "old_string",
    "new_string"
  ]
}
```

來源：[`packages/fs/tool-fs/src/index.ts`](../packages/fs/tool-fs/src/index.ts)

### `read`

讀取 UTF-8 文字文件，並返回帶行號的內容。

```json
{
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string",
      "description": "Path to read, resolved by the filesystem backend."
    },
    "offset": {
      "type": "number",
      "description": "1-based first line to return. Defaults to 1."
    },
    "limit": {
      "type": "number",
      "description": "Maximum number of lines to return. Defaults to 2000."
    }
  },
  "required": [
    "file_path"
  ]
}
```

來源：[`packages/fs/tool-fs/src/index.ts`](../packages/fs/tool-fs/src/index.ts)

### `read_image`

讀取 PNG/JPEG/WebP/GIF 文件並返回影像本身。要求當前模型接受影像輸入。

```json
{
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string",
      "description": "Path to the image file, resolved by the filesystem backend."
    }
  },
  "required": [
    "file_path"
  ]
}
```

來源：[`packages/fs/tool-fs/src/index.ts`](../packages/fs/tool-fs/src/index.ts)

### `write`

建立或完全替換 UTF-8 文字文件。

```json
{
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string",
      "description": "Path to write, resolved by the filesystem backend."
    },
    "content": {
      "type": "string",
      "description": "Full UTF-8 text content to write."
    }
  },
  "required": [
    "file_path",
    "content"
  ]
}
```

來源：[`packages/fs/tool-fs/src/index.ts`](../packages/fs/tool-fs/src/index.ts)

先讀後寫／編輯策略由 `@deepseek-ai/dsh-fs-observation-policy` 新增；它是一個 `fs/*` 事件閘門外掛程式，不會改變 schema。載入這些工具的部署按預期也應載入該外掛程式。沒有 `ctx.attachments` 時 `read_image` 不會註冊；其 schema 與路由無關，執行時除非確切路由的模型聲明影像輸入，否則拒絕。

<a id="deepseek-aidsh-tool-fs-search"></a>

## `@deepseek-ai/dsh-tool-fs-search`

### `glob`

尋找路徑匹配 glob 模式的文件。只返回匹配的檔案路徑，絕不返回目錄；包括隱藏文件和被忽略的文件，但排除 VCS 中繼資料目錄。最多按修改時間順序返回 100 條路徑；如果結果更多，則改為返回從頂層條目中抽樣的 100 條路徑，說明已抽樣，並報告完整排序清單的保存位置。該工具不枚舉目錄條目。

```json
{
  "type": "object",
  "properties": {
    "pattern": {
      "type": "string",
      "description": "Glob pattern to match file paths against (e.g. \"**/*.ts\", \"src/**/*.test.js\"). A pattern with no \"/\" matches the basename at any depth, so \"*\" and \"*.ts\" both search the whole tree; include a separator to anchor the depth."
    },
    "path": {
      "type": "string",
      "description": "Directory to search in. Defaults to the session workspace; a relative path resolves against it."
    }
  },
  "required": [
    "pattern"
  ]
}
```

來源：[`packages/fs/tool-fs-search/src/index.ts`](../packages/fs/tool-fs-search/src/index.ts)

### `grep`

使用 ripgrep 正規表達式搜尋文件內容。返回帶行號的匹配行，並按文件分組。前 250 條匹配會直接返回；結果達到上限時會報告完整匹配清單的保存位置。如需周邊上下文，請對匹配的文件使用 read。

```json
{
  "type": "object",
  "properties": {
    "pattern": {
      "type": "string",
      "description": "Regular expression to search for (ripgrep syntax)."
    },
    "path": {
      "type": "string",
      "description": "File or directory to search. Defaults to the session workspace; a relative path resolves against it."
    },
    "include": {
      "type": "string",
      "description": "One glob filter for which files to search (e.g. \"*.ts\", \"*.{js,jsx}\"). Not a list; negation is not supported."
    }
  },
  "required": [
    "pattern"
  ]
}
```

來源：[`packages/fs/tool-fs-search/src/index.ts`](../packages/fs/tool-fs-search/src/index.ts)

glob 和 grep 是無條件可用的發現工具，透過 ctx.subprocess spawn 隨包提供的 ripgrep 二進位檔案（`@vscode/ripgrep`），並作為普通前臺呼叫執行，絕不作為背景工作；無需在宿主機安裝 `rg`，也不經過 shell 層。本目錄使用 `sampleOverCapGlobResults: true`；部署必須顯式選擇該行為。結果超過上限時，會透過選填的 ctx.spillStore 後端保存完整的格式化清單；在共置部署中，如果後端公開本機路徑，返回的定位資訊可供後續讀取／搜尋。

<a id="deepseek-aidsh-tool-terminal"></a>

## `@deepseek-ai/dsh-tool-terminal`

### `terminal_close`

關閉一個持久終端機，並等待其捕獲且所有的行程樹完全結束。

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string",
      "description": "Terminal session id."
    }
  },
  "required": [
    "sessionId"
  ]
}
```

來源：[`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_list`

列出當前 agent 所有的持久終端機工作階段。

```json
{
  "type": "object",
  "properties": {}
}
```

來源：[`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_open`

透過已註冊的後端類型建立按所有者隔離的持久終端機工作階段。需要在多次工具呼叫之間保留 shell 或 REPL 狀態時，請使用此工具。

```json
{
  "type": "object",
  "properties": {
    "type": {
      "type": "string",
      "description": "Registered terminal backend type, usually \"shell\"."
    },
    "name": {
      "type": "string",
      "description": "Optional owner-local display name such as \"main\" or \"gdb\"."
    },
    "cwd": {
      "type": "string",
      "description": "Initial working directory. Defaults to the deployment workspace root."
    }
  },
  "required": [
    "type"
  ]
}
```

來源：[`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_read`

從持久終端機讀取一頁有界的保留輸出，不傳送輸入。

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string",
      "description": "Terminal session id."
    },
    "offset": {
      "type": "number",
      "description": "Newest-relative line offset (default 0)."
    },
    "count": {
      "type": "number",
      "description": "Requested line count (default 500; backend caps apply)."
    }
  },
  "required": [
    "sessionId"
  ]
}
```

來源：[`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_send`

向持久終端機傳送文字。預設會提交 Enter，並等待提示符、stdin 等待、輸出靜默、逾時或工作階段結束。後臺模式會返回供 job_output／job_kill 使用的 job id。

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string",
      "description": "Terminal session id returned by terminal_open or terminal_list."
    },
    "text": {
      "type": "string",
      "description": "UTF-8 text to write to the terminal."
    },
    "submit": {
      "type": "boolean",
      "description": "Submit Enter after text (default true). Set false for control characters or incomplete REPL input."
    },
    "run_in_background": {
      "type": "boolean",
      "description": "Return a job id immediately; collect with job_output or stop with job_kill."
    }
  },
  "required": [
    "sessionId",
    "text"
  ]
}
```

來源：[`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_signal`

向持久終端機當前的前臺行程組傳送允許的訊號。

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string",
      "description": "Terminal session id."
    },
    "signal": {
      "type": "string",
      "description": "Signal to deliver. Shell-targeted SIGKILL is rejected; use terminal_close.",
      "enum": [
        "SIGINT",
        "SIGTERM",
        "SIGKILL",
        "SIGTSTP",
        "SIGHUP"
      ]
    }
  },
  "required": [
    "sessionId",
    "signal"
  ]
}
```

來源：[`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

這 6 個終端機工具需要選擇啟用，用於補充一次性 bash／檔案系統工具。`terminal_send(run_in_background: true)` 會註冊到 `ctx.jobs`；schema 不包含 TUI、具名按鍵序列、BEL、調整尺寸、自動啟動和跨 agent 共享。

<a id="deepseek-aidsh-tool-goal"></a>

## `@deepseek-ai/dsh-tool-goal`

### `create_goal`

當當前直接人類請求是需要跨自主 Goal Round 持續推進的長期目標時，建立一個持久化的同工作階段完成目標。即使使用者沒有明確說「建立目標」，你也可以推斷其意圖。不要用於簡單的單輪工作。執行時會拒絕非人類權限和 subagent 權限。

```json
{
  "type": "object",
  "properties": {
    "objective": {
      "type": "string",
      "description": "The concrete completion objective inferred from the direct human request."
    },
    "max_goal_rounds": {
      "type": "number",
      "description": "Optional positive safe-integer limit on automatic continuation rounds."
    }
  },
  "required": [
    "objective"
  ]
}
```

來源：[`packages/goal/tool-goal/src/index.ts`](../packages/goal/tool-goal/src/index.ts)

### `get_goal`

讀取當前的同工作階段目標，包括確切的 id／revision、目標、階段、已完成的延續 Round 數、Round 上限、存在時的阻塞原因，以及是否已準備下一次延續。更新目標前請先呼叫此工具。

```json
{
  "type": "object",
  "properties": {}
}
```

來源：[`packages/goal/tool-goal/src/index.ts`](../packages/goal/tool-goal/src/index.ts)

### `update_goal`

更新確切的當前目標 revision。edit、pause 和 resume 要求直接的頂層人類請求。在自動延續當前目標期間，也允許 complete 和 blocked。在達到設定的最小 Round 數之前會拒絕 blocked；模型仍須判斷相同條件是否在這些 Round 中持續存在，並在 blocked_reason 中予以說明。

```json
{
  "type": "object",
  "properties": {
    "goal_id": {
      "type": "string",
      "description": "Exact id returned by get_goal."
    },
    "revision": {
      "type": "number",
      "description": "Exact positive revision returned by get_goal."
    },
    "action": {
      "type": "string",
      "description": "edit | pause | resume | complete | blocked",
      "enum": [
        "edit",
        "pause",
        "resume",
        "complete",
        "blocked"
      ]
    },
    "objective": {
      "type": "string",
      "description": "Replacement objective; valid only with action edit."
    },
    "max_goal_rounds": {
      "type": "number",
      "description": "Replacement cap; valid only with action edit."
    },
    "blocked_reason": {
      "type": "string",
      "description": "Concrete blocking condition; required only with action blocked."
    }
  },
  "required": [
    "goal_id",
    "revision",
    "action"
  ]
}
```

來源：[`packages/goal/tool-goal/src/index.ts`](../packages/goal/tool-goal/src/index.ts)

create、edit、pause 和 resume 要求直接來自人類的根權限；complete 和 blocked 也接受確切的當前 Goal Round。blocked 的預設下限是 3 個獲準的 Round。

<a id="deepseek-aidsh-schedule"></a>

## `@deepseek-ai/dsh-schedule`

### `schedule_create`

在當前工作階段中建立一條提醒。請提供非空 prompt 和恰好一個 selector：正的安全整數 after_seconds 延時；作為嚴格帶偏移日期時間或本機日期／時間對象的 at；或不小於 300 的安全整數 every_seconds。固定速率提醒始終與建立時刻對齊，會跳過錯過的發生時點，並把每條逾期規則的最新一個發生時點合併到一個批次中。交付模式是 session-local：只有此工作階段處於 live 狀態時，提醒才會準時執行；否則提醒會進入 overdue 狀態，直至工作階段復原。

```json
{
  "type": "object",
  "properties": {
    "prompt": {
      "type": "string",
      "description": "Reminder content to present when the target becomes due."
    },
    "after_seconds": {
      "type": "number",
      "description": "Positive safe-integer delay in seconds."
    },
    "every_seconds": {
      "type": "number",
      "description": "Fixed-rate safe-integer interval in seconds, at least 300."
    },
    "at": {
      "oneOf": [
        {
          "type": "string"
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "date": {
              "type": "string"
            },
            "time": {
              "type": "string"
            },
            "time_zone": {
              "type": "string"
            }
          },
          "required": [
            "date",
            "time",
            "time_zone"
          ]
        }
      ],
      "description": "Absolute target as strict offset RFC 3339 or local date/time with an explicit IANA zone."
    }
  },
  "required": [
    "prompt"
  ]
}
```

來源：[`packages/schedule/schedule/src/tools.ts`](../packages/schedule/schedule/src/tools.ts)

### `schedule_delete`

使用 schedule_create 或 schedule_list 返回的確切 id，刪除當前工作階段中的一條活動提醒。未知或已經結束的 id 會返回 deleted false。

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Exact session-local schedule id."
    }
  },
  "required": [
    "id"
  ]
}
```

來源：[`packages/schedule/schedule/src/tools.ts`](../packages/schedule/schedule/src/tools.ts)

### `schedule_list`

按建立順序列出當前工作階段中的所有活動提醒，包括確切 id、UTC 目標、scheduled 或 overdue 狀態，以及 session-local 交付模式。

```json
{
  "type": "object",
  "properties": {}
}
```

來源：[`packages/schedule/schedule/src/tools.ts`](../packages/schedule/schedule/src/tools.ts)

僅在選擇啟用的 Schedule 外掛程式載入後建立的 live 根 Agent scope 內註冊。版本 1 接受 after_seconds、顯式絕對 at 和有界固定速率 every_seconds，並披露 session-local 交付；管理讀取與變更必須透過共享的 Session 持久化 barrier。

<a id="deepseek-aidsh-tool-lsp"></a>

## `@deepseek-ai/dsh-tool-lsp`

### `lsp`

查詢語言伺服器，以精確導覽程式碼。operation 可取 goToDefinition、findReferences、goToImplementation 或 hover。line 和 character 是從 1 開始的 UTF-16 遊標坐標。findReferences 包含聲明。

```json
{
  "type": "object",
  "properties": {
    "operation": {
      "type": "string",
      "description": "goToDefinition, findReferences, goToImplementation, or hover.",
      "enum": [
        "goToDefinition",
        "findReferences",
        "goToImplementation",
        "hover"
      ]
    },
    "file_path": {
      "type": "string",
      "description": "The source file to query, relative to the workspace or absolute."
    },
    "line": {
      "type": "number",
      "description": "One-based line of the cursor."
    },
    "character": {
      "type": "number",
      "description": "One-based UTF-16 column of the cursor."
    }
  },
  "required": [
    "operation",
    "file_path",
    "line",
    "character"
  ]
}
```

來源：[`packages/lsp/tool-lsp/src/index.ts`](../packages/lsp/tool-lsp/src/index.ts)

lsp 工具將提供方選擇和語言伺服器子行程置於 ctx.lsp 之後，因此其模型可見 schema 在更換提供方時保持穩定。執行時期要求已註冊提供方，例如 `@deepseek-ai/dsh-lsp-stdio`；如果沒有提供方，查詢會返回結構化 `LSP_UNAVAILABLE` 錯誤，而不會改變 schema。

<a id="deepseek-aidsh-tool-ralph"></a>

## `@deepseek-ai/dsh-tool-ralph`

### `ralph`

圍繞一個不可變目標執行使用全新 agent 的前臺 Ralph 迴圈。僅當直接人類明確要求 Ralph 或使用全新 agent 迭代時使用。每個 Round 都會啟動一個全新子級，該子級看不到父級對話或先前子工作階段；共享工作區充當長期記憶，Round 之間只傳遞有界的結構化報告。當工作行程報告完成、報告具體阻塞項或達到 Round 上限時，呼叫返回。普通的長期同工作階段工作應使用 goal 工具。

```json
{
  "type": "object",
  "properties": {
    "objective": {
      "type": "string",
      "description": "The immutable completion objective for every fresh Ralph round."
    },
    "maxRounds": {
      "type": "number",
      "description": "Optional positive safe-integer round cap, bounded by the deployment ceiling."
    }
  },
  "required": [
    "objective"
  ]
}
```

來源：[`packages/workflow/tool-ralph/src/index.ts`](../packages/workflow/tool-ralph/src/index.ts)

固定的前臺工作流程會在每個 Round 啟動一個全新的結構化子級；模型只能選擇不可變目標和選填的 Round 上限。

<a id="deepseek-aidsh-tool-skill"></a>

## `@deepseek-ai/dsh-tool-skill`

### `skill`

載入可用 skill（技能）的完整說明。在執行點名某項 skill 或與其明確匹配的任務前，請使用工作階段 skill 目錄中的確切名稱呼叫此工具。

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "The exact skill name from the available skills list."
    }
  },
  "required": [
    "name"
  ]
}
```

來源：[`packages/skill/tool-skill/src/index.ts`](../packages/skill/tool-skill/src/index.ts)

<a id="deepseek-aidsh-tool-session-query"></a>

## `@deepseek-ai/dsh-tool-session-query`

### `session_event_read`

從一個已獲授權的工作階段中讀取一個完整且未刪節的事件，以及選填的相鄰原始事件概述。

```json
{
  "type": "object",
  "properties": {
    "session_id": {
      "type": "string",
      "description": "Target session id. Omit for the current session."
    },
    "seq": {
      "type": "integer",
      "description": "Target event sequence number."
    },
    "before": {
      "type": "integer",
      "description": "Number of preceding raw events to summarize. Omit for none."
    },
    "after": {
      "type": "integer",
      "description": "Number of following raw events to summarize. Omit for none."
    }
  },
  "required": [
    "seq"
  ]
}
```

來源：[`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

### `session_event_search`

在一個已獲授權的工作階段中搜尋先前事件；如果搜尋當前工作階段，則排除執行此次呼叫的步驟。

```json
{
  "type": "object",
  "properties": {
    "session_id": {
      "type": "string",
      "description": "Target session id. Omit for the current session."
    },
    "query": {
      "type": "string",
      "description": "Literal full-text query over the target session."
    },
    "seq_from": {
      "type": "integer",
      "description": "Inclusive event sequence lower bound."
    },
    "seq_to": {
      "type": "integer",
      "description": "Inclusive event sequence upper bound."
    },
    "time_from": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 event-time lower bound."
    },
    "time_to": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 event-time upper bound."
    },
    "event_types": {
      "type": "array",
      "description": "Event types to include.",
      "items": {
        "type": "string"
      }
    },
    "surfaces": {
      "type": "array",
      "description": "Event surfaces to include.",
      "items": {
        "type": "string",
        "enum": [
          "current",
          "shadowed",
          "log-only"
        ]
      }
    }
  },
  "required": [
    "query"
  ]
}
```

來源：[`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

### `session_event_trace`

讀取已獲授權工作階段中某個事件的所有直接替換關係，以及該事件與其引用的來源事件之間的關係。

```json
{
  "type": "object",
  "properties": {
    "session_id": {
      "type": "string",
      "description": "Target session id. Omit for the current session."
    },
    "seq": {
      "type": "integer",
      "description": "Target event sequence number."
    }
  },
  "required": [
    "seq"
  ]
}
```

來源：[`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

### `session_search`

搜尋呼叫方工作區中的先前工作階段，並從每個工作階段返回匹配度最高的事件。

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Literal full-text query over prior session history."
    },
    "session_ids": {
      "type": "array",
      "description": "Optional session ids to include.",
      "items": {
        "type": "string"
      }
    },
    "created_at_from": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 creation-time lower bound."
    },
    "created_at_to": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 creation-time upper bound."
    },
    "parent_session_ids": {
      "type": "array",
      "description": "Optional direct parent session ids.",
      "items": {
        "type": "string"
      }
    },
    "include_root_sessions": {
      "type": "boolean",
      "description": "Include sessions with no parent in the parent filter."
    },
    "availability": {
      "type": "array",
      "description": "Require at least one selected source availability.",
      "items": {
        "type": "string",
        "enum": [
          "live",
          "persisted"
        ]
      }
    },
    "event_seq_from": {
      "type": "integer",
      "description": "Inclusive event sequence lower bound."
    },
    "event_seq_to": {
      "type": "integer",
      "description": "Inclusive event sequence upper bound."
    },
    "event_time_from": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 event-time lower bound."
    },
    "event_time_to": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 event-time upper bound."
    },
    "event_types": {
      "type": "array",
      "description": "Event types to include.",
      "items": {
        "type": "string"
      }
    },
    "event_surfaces": {
      "type": "array",
      "description": "Event surfaces to include.",
      "items": {
        "type": "string",
        "enum": [
          "current",
          "shadowed",
          "log-only"
        ]
      }
    }
  },
  "required": [
    "query"
  ]
}
```

來源：[`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

### `session_trace`

讀取圍繞一個工作階段的已授權工作階段譜系，包括完整可見的祖先和後代關係。

```json
{
  "type": "object",
  "properties": {
    "session_id": {
      "type": "string",
      "description": "Target session id. Omit for the current session."
    }
  }
}
```

來源：[`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

這 5 個只讀工具會隱藏提供方遊標，並根據不可變的呼叫 agent 工作階段為每個結果授權。該包需要選擇啟用；需要強制截止時間或限制行內輸出的組合還會掛載通用逾時或 spill 策略。

<a id="deepseek-aidsh-tool-subagent"></a>

## `@deepseek-ai/dsh-tool-subagent`

### `subagent`

將一項自包含任務委派給 subagent（在自身上下文中工作的獨立 agent），用它解除安裝聚焦且獨立的工作，例如研究、限定範圍的實作或分析，以免消耗當前對話的上下文。subagent 會返回結果，但不會返回中間步驟。請提供完整、獨立的提示詞，因為它看不到當前對話。此呼叫預設等待結果。設定 `run_in_background: true` 可返回 job id；使用 `job_output` 收集結果，使用 `job_kill` 停止任務。

```json
{
  "type": "object",
  "properties": {
    "description": {
      "type": "string",
      "description": "A short (3-5 word) description of the delegated task, for display."
    },
    "prompt": {
      "type": "string",
      "description": "The complete, self-contained task for the subagent. It does not share this conversation's context, so include everything it needs."
    },
    "run_in_background": {
      "type": "boolean",
      "description": "Whether to run as a background job and return its id. Defaults to false; collect with job_output or stop with job_kill."
    }
  },
  "required": [
    "description",
    "prompt"
  ]
}
```

來源：[`packages/subagent/tool-subagent/src/index.ts`](../packages/subagent/tool-subagent/src/index.ts)

註冊的工具名稱取決於載入時 `toolName` 設定（預設為 `subagent`）；上述 schema 對應預設值。隨產品發布的組合會為每個 subagent 後端載入一次該包，因此模型還會看到綁定到 fork 後端的 `subagent_fork`。每個實例的描述、`run_in_background` 參數與 system prompt 策略取決於它自己的 `backgroundMode` 和 `enableRunInBackground`，因此兩個隨附 schema 並不相同：`subagent` 為 `continuable`，省略參數時預設後臺執行，並由 runtime 自動投遞結束結果；`subagent_fork` 保持 `one-shot`，省略參數時預設前景執行。詳見 `packages/bundle/base/cordis.patch.yml` 和 `examples/acp-agent/cordis.yml`。

<a id="deepseek-aidsh-tool-subagent-control"></a>

## `@deepseek-ai/dsh-tool-subagent-control`

### `interrupt_agent`

根據 agent id 請求取消後臺 agent 的當前輪次。目標可以是你的直接子級，也可以是在你下方建立的更深層 agent。只有當前輪次會停止：已經排隊發給該 agent 的訊息會一直擱置到後續的 send_message；它啟動的 agent 會繼續執行；該 agent 本身仍可接受後續操作。停止請求被接受後，此呼叫立即返回，因此目標可能還會短暫執行；中斷一個已經完成的 agent 是可接受的空操作。

```json
{
  "type": "object",
  "properties": {
    "agent_id": {
      "type": "string",
      "description": "The agent id of the running agent to interrupt."
    }
  },
  "required": [
    "agent_id"
  ]
}
```

來源：[`packages/subagent/tool-subagent-control/src/index.ts`](../packages/subagent/tool-subagent-control/src/index.ts)

### `list_agents`

按持久 id 和標籤列出你的可繼續後臺 subagent。用它回憶你啟動過哪些 subagent，而不是輪詢完成情況——subagent 完成時你會被告知。狀態來自即時登錄檔：running 表示 agent 此刻正在工作；idle 表示已載入但處於輪次之間，可能正在等待它啟動的 agent；ready 表示它只存在於儲存中——可復原而非終態，也不表示有結果等待收集；`send_message` 會在同一對話上開啟新的輪次，且無論處於哪種狀態，直接子級都仍可作為 `send_message` 的目標。該快照並非投遞承諾；`send_message` 會執行權威檢查，仍可能失敗。無法讀取的子級會作為診斷資訊報告，而不會被靜默丟棄。`descendants` 作用域會按穩定的前序順序遍歷你下方的整棵樹，並為每個條目標注其持久的直接父工作階段 id 和深度。只有深度為 1 的條目可以使用 `send_message`；更深的條目只能作為 `interrupt_agent` 的候選目標。

```json
{
  "type": "object",
  "properties": {
    "scope": {
      "type": "string",
      "description": "children (default) lists direct children only; descendants walks the complete tree below you.",
      "enum": [
        "children",
        "descendants"
      ]
    }
  }
}
```

來源：[`packages/subagent/tool-subagent-control/src/list-agents.ts`](../packages/subagent/tool-subagent-control/src/list-agents.ts)

### `send_message`

根據 subagent id 向後臺 subagent 傳送訊息，繼續同一段對話。該訊息會成為 subagent 的下一輪次：如果它仍在工作，訊息會等待當前輪次結束，因此無法改變已經開始的工作方向。此呼叫不會返回 subagent 的答案，只會確認訊息已投遞，因此請用它分派更多工作。呼叫失敗表示訊息**未**投遞。

```json
{
  "type": "object",
  "properties": {
    "subagent_id": {
      "type": "string",
      "description": "The subagent id returned when the background subagent was started."
    },
    "message": {
      "type": "string",
      "description": "The message to deliver to the subagent."
    }
  },
  "required": [
    "subagent_id",
    "message"
  ]
}
```

來源：[`packages/subagent/tool-subagent-control/src/index.ts`](../packages/subagent/tool-subagent-control/src/index.ts)

這些是控制可繼續後臺 subagent 的全域性命名工具：綁定提供方的 `tool-subagent` 實例註冊不同的委派工具；本包註冊一次 `send_message` 和 `interrupt_agent`，另由 `list_agents` 透過單獨載入的 `/list-agents` 外掛程式提供，其目錄行使用 sessionProjections 和即時 Agent 登錄檔。

<a id="deepseek-aidsh-tool-subagent-report"></a>

## `@deepseek-ai/dsh-tool-subagent-report`

### `report`

向啟動你的 agent 報告選定內容。在你結束前呼叫一次，給出自包含的最終結果；當進度或發現會改變該 agent 接下來的行動時，也可以更早呼叫。該 agent 與你共享工作區，但不會自動收到你的 transcript（文字記錄）、工具輸出或推理，因此完成你的工作本身並不等於交出結果。報告不會結束你的輪次或完成你的工作，且只有直接父級會收到。失敗的呼叫仍可能已經送達，因此不要盲目重複。

```json
{
  "type": "object",
  "properties": {
    "output": {
      "type": "string",
      "description": "Actionable content for your parent; summarize conclusions and reference relevant shared paths."
    }
  },
  "required": [
    "output"
  ]
}
```

來源：[`packages/subagent/tool-subagent-report/src/index.ts`](../packages/subagent/tool-subagent-report/src/index.ts)

按可繼續的行程內子級註冊，而非全域性註冊，因此該 schema 僅在這種子級內部可見，並且不受其全域性 `toolFilter` 影響。同一份貢獻還會安裝子級作用域的 `tool:report` 系統提示詞 section，本目錄不算繪該 section。面向父級的 `send_message` 工具單獨安裝。

<a id="deepseek-aidsh-tool-jobs"></a>

## `@deepseek-ai/dsh-tool-jobs`

### `job_kill`

根據 job id 請求取消正在執行的背景工作。此呼叫立即返回；任務的工作真正停止後，會以 killed 狀態結帳。

```json
{
  "type": "object",
  "properties": {
    "job_id": {
      "type": "string",
      "description": "Job id returned by the tool that started the background work."
    },
    "reason": {
      "type": "string",
      "description": "Optional short reason, recorded in the log and forwarded to the job."
    }
  },
  "required": [
    "job_id"
  ]
}
```

來源：[`packages/jobs/tool-jobs/src/index.ts`](../packages/jobs/tool-jobs/src/index.ts)

### `job_list`

列出你的背景工作（包括正在執行和已完成的任務）及其 id、種類和狀態。

```json
{
  "type": "object",
  "properties": {}
}
```

來源：[`packages/jobs/tool-jobs/src/index.ts`](../packages/jobs/tool-jobs/src/index.ts)

### `job_output`

讀取背景工作。流式任務只返回自上次讀取以來的輸出；最終輸出任務會在結帳後返回結果。每個回應都以 `[status: ...]` 結尾。讀取預設不阻塞；設定 `wait: true` 後，最長等待到設定的上限。

```json
{
  "type": "object",
  "properties": {
    "job_id": {
      "type": "string",
      "description": "Job id returned by the tool that started the background work."
    },
    "wait": {
      "type": "boolean",
      "description": "Block until the job reaches a terminal status or the timeout expires. A timed-out wait returns [status: running] and leaves the job alive."
    },
    "timeout_ms": {
      "type": "number",
      "description": "Max wait in milliseconds (only meaningful with wait: true). Defaults to the configured wait timeout; capped by the configured maximum."
    }
  },
  "required": [
    "job_id"
  ]
}
```

來源：[`packages/jobs/tool-jobs/src/index.ts`](../packages/jobs/tool-jobs/src/index.ts)

與任務種類無關的背景工作控制器：後臺 bash 命令、PTY 傳送和 subagent 都透過相同的 3 個工具讀取、列出和終止。載入該外掛程式會掛接控制器，從而啟用生產方的 `ctx.jobs.start()`。

<a id="deepseek-aidsh-tool-todo"></a>

## `@deepseek-ai/dsh-tool-todo`

### `todo_write`

記錄並更新當前工作的結構化任務清單。每次呼叫都要傳送**完整清單**，它會**替換**之前的清單，不支援區域性更新或逐項編輯。請用它規劃多步驟工作並展示進度：開始前為每個具體步驟新增一項 todo。將當前正在處理的每項 todo 標記為 `in_progress`；確實平行執行時期（例如並行 subagent 或後臺命令）可同時標記多項，順序工作則標記 1 項。只要工作尚未完成，就應至少有一項任務為 `in_progress`。某項 todo 完成後立即標記為 `completed`，不要批次標記完成；只有全部工作完成後，纔可以沒有 `in_progress` 項。簡單的單步驟任務無需使用清單。狀態：`pending`（未開始）、`in_progress`（正在處理）、`completed`（已完成）。

```json
{
  "type": "object",
  "properties": {
    "todos": {
      "type": "array",
      "description": "The COMPLETE task list, replacing any previous list.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "content": {
            "type": "string",
            "description": "What the task is — a short imperative line."
          },
          "status": {
            "type": "string",
            "description": "pending (not started) | in_progress (now) | completed (done).",
            "enum": [
              "pending",
              "in_progress",
              "completed"
            ]
          }
        },
        "required": [
          "content",
          "status"
        ]
      }
    }
  },
  "required": [
    "todos"
  ]
}
```

來源：[`packages/todo/tool-todo/src/index.ts`](../packages/todo/tool-todo/src/index.ts)

todo_write 是工作階段所有的狀態；UI 將最新的 todo/write 事件算繪為檢查清單。`allowParallelInProgress` 是沒有預設值的必填項，因此本目錄明確選擇 `true`，對應描述允許同時存在多個 `in_progress` 項。選擇 `false` 的部署會獲得同一工具，但描述會要求只能有 1 個活動任務。

<a id="deepseek-aidsh-tool-workflow"></a>

## `@deepseek-ai/dsh-tool-workflow`

### `workflow`

執行用於大規模編排 subagent 的 JavaScript 工作流程指令碼。當工作會分散到許多相互獨立的部分時，請使用此工具，例如審查大量文件、執行遷移、開展多角度研究或對發現進行對抗式驗證；此時應將編排寫成指令碼，而不是逐輪委派。

工作流程的身份透過 `meta` 參數以 JSON 形式傳入：必填的 `name`（簡短 kebab-case）和 `description` 字串，以及選填的 `whenToUse` 字串和 `phases` 陣列（`{title, detail?, provider?, model?}`）。`script` 參數只能是純 JavaScript **函式體**，不能是 TypeScript，也不能包含 `export const meta` 語句；meta 是參數而非程式碼。指令碼支援頂層 await；請以 `return <value>` 結尾，該值必須可以 JSON 序列化，並作為此工具的結果。

指令碼函式體提供以下掛鉤：

- `agent(prompt, opts?): Promise<any>`：執行一個 subagent 直至完成。不提供 `opts.schema` 時，解析為子級最終文字；提供 `opts.schema` 時，它必須是以對象為根、且**只能**使用 type/properties/required/additionalProperties/items/enum/const/oneOf 的 JSON Schema，不支援 pattern/format/數值邊界，此時解析為透過校驗的對象。子級失敗時解析為 `null`，可使用 `.filter(Boolean)` 過濾。其他選項包括 `label`（顯示名稱）、`phase`（進度組），以及相互獨立的 `provider`／`model` LLM（大型語言模型）目標覆蓋項，兩者可單獨提供。其他任何選項（`effort`／`isolation`／`agentType`）都會明確報錯。
- `pipeline(items, ...stages): Promise<any[]>`：讓每個條目分別經過各階段，階段之間**沒有**屏障；多階段工作優先使用它。每個階段接收 `(prev, item, index)`。普通的階段例外會將該**條目**變為 `null`，並跳過它的剩餘階段。
- `parallel(thunks): Promise<any[]>`：並行執行零參數函式並等待**全部**完成。它會形成屏障，僅當某個階段確實需要彙總全部先前結果時使用。拋出例外的 thunk 解析為 `null`。
- `phase(title)`：開始一個進度階段；`log(message)`：說明進度；`args`：工具呼叫的 `args` 輸入，原樣提供。

如果誤用掛鉤（參數錯誤、未知選項、不受支援的 schema、觸發上限），拋出的錯誤**總會**終止指令碼，絕不會退化為單個條目的 `null`。

約束：並行上限和 agent 總數上限均會生效；不提供檔案系統、網路、定時器或 Node.js API。具體工作由 agent 完成，指令碼只負責編排。該執行在前臺執行：整個指令碼完成後，呼叫才會返回。

```json
{
  "type": "object",
  "properties": {
    "script": {
      "type": "string",
      "description": "The plain-JS workflow script body (top-level await allowed; NO `export const meta` statement; end with `return <json-value>`)."
    },
    "meta": {
      "type": "object",
      "description": "The workflow identity block (plain JSON — never code).",
      "additionalProperties": true,
      "properties": {
        "name": {
          "type": "string",
          "description": "Short kebab-case workflow name."
        },
        "description": {
          "type": "string",
          "description": "One-line description of what the workflow does."
        },
        "whenToUse": {
          "type": "string",
          "description": "Optional guidance on when this workflow applies."
        },
        "phases": {
          "type": "array",
          "description": "Optional phase declarations matched by phase() calls.",
          "items": {
            "type": "object",
            "additionalProperties": true,
            "properties": {
              "title": {
                "type": "string",
                "description": "The phase title phase() calls match by exact string."
              },
              "detail": {
                "type": "string",
                "description": "Optional one-line description of the phase."
              },
              "provider": {
                "type": "string",
                "description": "Optional provider override this phase is expected to use."
              },
              "model": {
                "type": "string",
                "description": "Optional model override this phase is expected to use."
              }
            },
            "required": [
              "title"
            ]
          }
        }
      },
      "required": [
        "name",
        "description"
      ]
    },
    "args": {
      "type": "object",
      "description": "Optional JSON input exposed to the script as the `args` global (wrap a bare list as a field, e.g. {\"files\": [...]}).",
      "additionalProperties": true
    }
  },
  "required": [
    "script",
    "meta"
  ]
}
```

來源：[`packages/workflow/tool-workflow/src/index.ts`](../packages/workflow/tool-workflow/src/index.ts)

<a id="deepseek-aidsh-tool-web"></a>

## `@deepseek-ai/dsh-tool-web`

### `web_fetch`

取得指定 HTTP(S) URL 的內容，並將其解碼為文字後返回。

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "description": "The HTTP(S) URL to fetch."
    }
  },
  "required": [
    "url"
  ]
}
```

來源：[`packages/web/tool-web/src/index.ts`](../packages/web/tool-web/src/index.ts)

### `web_search`

在 Web 上搜尋最新資訊。返回選填的摘要答案和源 URL 清單。

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "The search query."
    }
  },
  "required": [
    "query"
  ]
}
```

來源：[`packages/web/tool-web/src/index.ts`](../packages/web/tool-web/src/index.ts)

web_search 和 web_fetch 將提供方選擇置於 ctx.web 之後，使模型可見 schema 在更換後端時保持穩定。
