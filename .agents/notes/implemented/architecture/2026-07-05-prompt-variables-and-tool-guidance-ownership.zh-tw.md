# Agent Note: 提示詞變數與工具指導歸屬

Status: implemented

[English](2026-07-05-prompt-variables-and-tool-guidance-ownership.md) | [简体中文](2026-07-05-prompt-variables-and-tool-guidance-ownership.zh.md) | 繁體中文

## 問題

組裝後的系統提示詞存在四個缺陷，同屬一類：harness 已知的事實在別處被手工重述，然後漂移。

**模型無法知道自己的名字。** `AgentOptions.model` 驅動程式每個請求，但沒有任何提示詞文字攜帶它——也不可能攜帶：`dsh-system-prompt` 中的 section 是上下文全域性的，而模型名稱因 agent（代理）而異，`assemble()` 根本不接受任何 per-agent 輸入。

**工具指導是 leaf YAML 中的手寫行文。** shell/subagent/todo_write 的使用指導存放在 coding-agent 和 ACP（Agent Client Protocol）的 persona 字串裡——兩份漂移的副本（ACP 那份已經被刪減）——而 `dsh-tool-fs` 和 `dsh-tool-web` 則透過 `ctx.systemPrompt.section()` 貢獻各自的指導。載入或解除安裝一個工具外掛程式意味著手動編輯每個部署的 persona，舊終端機歡迎橫幅也手動枚舉了工具集。

**Persona 渲染在工具指導之後。** agent loop（代理循環）將 `agent.options.systemPrompt` 字串拼接在已組裝的 section 之後，於是模型先讀到「Use the read tool…」再讀到「You are a coding agent」——與 identity-first 約定（Claude Code、Codex）相反，且是 section 管線之外的第二條組合路徑。

**Fork 工具的描述是假的。** `dsh-tool-subagent` 硬編碼了一段為 spawn 語義編寫的描述——「a separate agent that works in its own context … it does not see this conversation」——而 `subagent_fork` 實例（其子 agent 繼承父級已完成的輪次）拿到了同樣的措辭；YAML 行文在帶外糾正了這個謊言。小問題：`PromptSection.name` 文件標注為「(diagnostics / dedup)」，但重複項被靜默接受。

## 決策

**一條原則：提示詞中的每個事實恰好有一個歸屬方。** 模型名稱和工作區是設定/工作階段事實 → harness 將它們暴露為變數，persona 引用它們。每個工具的語義和何時使用 → 工具的 `description`。description 無法承載的跨呼叫習慣 → 包的提示詞 section。產品名稱和 SDK 身份說明 → 靜態的 `harness:identity` section。部署角色與行為 → 部署的 persona。

### 組裝上下文

`SystemPrompt.assemble(context)` 接受一個可合併擴充的 `AssembleContext`。`dsh-system-prompt` 聲明選填的 `scope` 選擇器用於 scoped 路由，而 `dsh-agent` 透過聲明合併將選填的類型化 `agent` 欄位附加到其上（類型層面的 `agent → system-prompt` 邊，無執行時期相依性迴圈）。迴圈在每個步驟呼叫 `assembleContextFor(agent)`，使兩個欄位標識同一個 agent；section 文字提供方可以讀取該上下文，`system-prompt/assemble` waterfall（瀑布式事件）也接收它，監聽器可據此按 agent 過濾或擴充。

### 提示詞變數

外掛程式透過 `ctx.systemPrompt.variable(name, provider)` 註冊 `{{name}}` 值。組裝過程將它們解析到 waterfall 可見的變數對映中。渲染階段拒絕以下情況：引用未知的自有屬性、已註冊的提供方返回 `undefined`、格式錯誤的完整引用、以及仍包含閉合 `}}` 的不平衡引用；孤立的未匹配 `{{` 保留為行文，替換後的值不會被重新掃描。註冊階段拒絕無效或重複的變數名，section 名稱也必須唯一。

`dsh-agent-loop` 註冊兩個內建變數，均為上下文 agent 的純投影：`model`（= `options.model`）和 `cwd`（= `session.header.cwd`）。示例 persona 寫 `powered by the {{model}} model`——模型名稱只在 `model:` 設定鍵中聲明一次。`{{cwd}}` 僅在 ACP 示例中演示：每個 ACP 工作階段攜帶用戶端的 cwd，而設定預建立的 stdio agent 沒有 cwd（在那裡聲稱 `{{cwd}}` 的 persona 會導致該輪次失敗——這是有意為之）。變數留在 loop 外掛程式上（不同於下面的 section）：它們是本迴圈驅動程式的 agent 的執行時期事實，替換迴圈自行提供自己的變數。

### Persona 作為 order-0 section

`dsh-system-prompt` 擁有 order 為 `-100` 的 `harness:identity` 和 order 為 0 的設定 `deployment:persona`，因此兩者在迴圈被替換時仍然存活。提示詞渲染只有一條路徑 `renderPrompt(assembly)`，已路由請求 header 因此會記錄準確的提示詞，稍後由 `ctx.tokenMeter` 為壓縮（compaction）壓力重播。agent 作用域的 `deployment:persona` 遮蔽全域性預設值，允許 subagent 提供方在發布前安裝 persona。約定的 order 區間為：identity `-100`、persona `0`、工具指導 `100–199`。

### 工具指導歸屬

每個工具的語義和選擇指導放在工具 description 中。提示詞 section 只承載跨呼叫習慣，例如檢查 bash 退出標記或優先使用檔案系統工具而非 shell 命令。`todo_write` 和 subagent 工具不需要 section，因為它們的 description 包含完整約定。部署 persona 只包含角色和行為。

### Subagent 對話歷史描述符

`SubagentProvider.inheritsParentContext` 描述的是對話歷史初始化，而非作用域、服務、工具或權限。spawn 和 ACP 將其設為 `false`；fork 設為 `true`。`dsh-tool-subagent` 根據該標志派生工具描述和提示詞參數描述，包括 fork 繼承已完成輪次但不繼承進行中輪次這一點。提供方生命週期事件使該措辭與響應式提供方註冊保持同步；其設計動機見[提供方生命週期事件 Agent Note](2026-07-05-subagent-provider-lifecycle-events.md)。

## 曾考慮的替代方案

- **迴圈自行組合一行 identity 文字**：在必須保持精簡的那個包（「用外掛程式，不改迴圈」）中硬編碼面向模型的行文，且在 section 管線之外構成第二條組合路徑。（identity 確實以程式碼字面量交付——但作為 `dsh-system-prompt` 註冊的普通 section，其 `system-prompt/assemble` waterfall 仍是部署需要移除它時的逃生閥。）
- **透過 `agent/request` waterfall 注入模型名稱**：提示詞文字會在兩處組合，更早渲染的 persona 也可能與最終已路由 header 不一致。擁有延遲路由的請求外掛程式還必須擁有該模型在提示詞中更早出現的聲明。
- **在每個 persona 中手寫模型名稱**：與上方一行的 `model:` 鍵重複，設定修改後靜默失實；正是本決策要治癒的病症。
- **寬鬆插值（未知引用保留原樣或替換為空）**：一個拼寫錯誤 `{{modle}}`（或一個空洞）會被傳送給模型，直到 transcript（文字記錄）審查時才會被發現。
- **在設定中為每個 subagent 實例編寫措辭**：面向模型的行文回到每個部署 × 實例中，重蹈在 leaf YAML 中手寫指導的漂移。**根據提供方名稱選擇措辭**：`providerName` 本身是設定，重新命名提供方後會靜默獲得錯誤的措辭。
- **在 `apply` 時解析提供方（載入順序要求）**與**僅用 section 承載 subagent 措辭（在 assemble 時惰性解析）**：提供方生命週期事件的替代方案；兩者均在[提供方生命週期事件 Agent Note](2026-07-05-subagent-provider-lifecycle-events.md)中被否決。

## 不在範圍內

- 更多變數（`date`、platform、git 狀態）：登錄檔使每個變數成為擁有該事實的外掛程式的一行貢獻；本 Agent Note 不認領任何一個。
- 為預建立的 stdio agent 提供設定 `cwd`（可讓 stdio persona 使用 `{{cwd}}` 並按真實路徑分區持久化）：推遲到工作階段 cwd 方案重新討論時。

## 交付的不變式

- tui-agent 的提示詞透過一條組裝路徑依次渲染 identity、帶插值模型名的 persona，然後是 fs/shell/web 指導。
- fork 和 fresh subagent 的描述反映提供方是否繼承已完成的對話輪次；工具隨提供方生命週期變化而出現、消失和重新措辭。
- 未知、無值、格式錯誤或不平衡的變數引用會指明 section 名稱並拋出例外；重複的 section、變數和工具註冊同樣拋出例外。
- 快照重播與提示詞無關：它按輪次和步驟索引已記錄的區塊流，不比較寄出的請求。

## 後果

- 組裝後的提示詞中每個事實現在恰好有一個歸屬方，leaf YAML 中手工維護的工具行文已消除：載入或解除安裝一個工具外掛程式不再需要編輯任何部署的 persona。
- `{{model}}` 在組裝時反映 `AgentOptions.model`。如果一個外掛程式在 `agent/request` waterfall 中切換模型，提示詞對該步驟的聲明就會過時；如果一個外掛程式在那裡提供模型（options.model 未設定——迴圈文件中記載的回退路徑），變數在渲染時無值，包含 `{{model}}` 的 persona 會在 waterfall 執行前失敗。兩者的補救方式相同，就是歸屬規則本身：擁有延遲綁定模型事實的外掛程式在 `system-prompt/assemble` waterfall 上提前聲明它（`assembly.variables['model'] = …`）——一個歸屬方，兩處聲明；一個迴圈測試端到端固定了 supply 路徑。已接受。
- 當一個已綁定的提供方不存在時（尚未啟用、已解除安裝、HMR（熱模組替換）重載中），subagent 工具不存在，該視窗內的模型請求中不會包含它。這是誠實的狀態——替代方案是註冊一個 description 或執行都不可信的工具。
- 嚴格性意味著 persona 可能在渲染時導致輪次失敗（例如在無 cwd 的工作階段上使用 `{{cwd}}`）。失敗是受控的——該輪次以 `error` 結束，迴圈存活——且這是一個我們希望明確暴露的撰寫錯誤。
- 目前沒有在提示詞行文中轉義字面 `{{name}}` 的文法；如果真實提示詞確實需要，再行新增。
