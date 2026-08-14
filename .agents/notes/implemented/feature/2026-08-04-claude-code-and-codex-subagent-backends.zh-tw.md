# Agent Note: Claude Code 與 Codex subagent 後端

Status: implemented

[English](2026-08-04-claude-code-and-codex-subagent-backends.md) | [简体中文](2026-08-04-claude-code-and-codex-subagent-backends.zh.md) | 繁體中文

## 問題

命名的 [`ctx.subagents`](2026-06-21-subagent-capability-seam.md) 登錄檔讓父 agent（代理）無需瞭解子 agent 的執行方式即可委派工作，但 harness 需要通往真實 Codex 與 Claude Code 產品的第一方路徑。每條路徑都必須向產品交付一項自包含任務，讓它在父工作階段的工作區中執行，返回最終回答或明確的失敗或取消結果，並且不留下任何受管的產品行程。

產品整合不得成為任務文字、cwd、取消、結果結帳或行程樹的第二責任方。因此，所需證據要區分三個事實：無金鑰真實產品測試證明官方整合、原生身分驗證形態、確定性答案與資源清理；Loader 組合測試證明公開包和文件所示的工具設定無需啟動產品即可載入；帶金鑰 e2e 證明生產提供方與真實產品能夠從真實 DeepSeek 服務取得唯一答案。直接發起模型 HTTP 請求或使用產品替身無法取代上述任一產品執行層級；手工掛載外掛程式無法取代 Loader 層級。

## 決策

harness 交付兩個同級的一次性提供方包：`codex` 與 `claude-code`。本說明負責它們的產品協議、結果對映和行程生命週期；[共享 profile 宿主歸屬決策](../architecture/2026-08-10-product-subagent-providers-in-shared-host.md)取代原先由使用者選擇啟用的組裝位置。載入任一提供方都不會啟動產品行程，而且每個工具只接受獨立文字任務；產品選擇與後臺執行都不作為模型參數。

這兩個提供方都報告 `inheritsParentContext: false`，不聲明任何選填的啟動能力，並傳遞父工作階段 cwd，但不會複製父級對話。文件所示的工具會停用後臺執行，並使用 `maxDepth: 'provider-managed'`，將遞迴策略留給行程外產品，而不是傳送提供方無法強制執行的限制。每次呼叫都會建立一個全新的產品行程和一次不可續接的產品對話。共享 subagent 服務繼續負責請求解析、生命週期事件、結果結帳和前臺收集；共享子行程服務負責憑證清洗、行程樹終止以及整棵行程樹的退出觀測。

```text
fixed tool → shared subagent service → product provider → official product process
     ← final answer / explicit error / cancellation ← terminal product fact
     → foreground disposal → shared process-tree termination → whole-tree exit
```

### 歸屬與生命週期

| 階段 | 共享責任方 | 產品特定職責 | 可觀察結果 |
| --- | --- | --- | --- |
| 解析 | `dsh-tool-subagent` 與 `ctx.subagents` | 驗證產品的純文字輸入並推導原生啟動參數 | 不受支持的上下文或格式錯誤的輸入會在發布執行前報錯 |
| 啟動 | `dsh-subprocess` 負責每棵已取得的行程樹 | 到達能夠同時控制產品對話與行程的最小原生控制點 | `start()` 發布一個已存在的 `SubagentRun`，否則清理後拒絕呼叫 |
| 執行 | 產品負責其原生協議事實；持有方負責對映這些事實 | 只提交一項任務，並推匯出一種現有的共享停止原因；Codex 僅在明確發生上下文耗盡時使用 `max-tokens` | 父級只會收到最終回答或明確失敗 |
| dispose（資源釋放） | 前臺消費端請求釋放；`dsh-subprocess` 證明行程已退出 | 關閉原生協議，並行出盡力而為的原生取消請求 | 釋放操作具有冪等性，且僅在整棵行程樹退出後才返回 |

## Codex 提供方

`@deepseek-ai/dsh-subagent-codex` 註冊固定的 `codex` 提供方，並啟動 `codex app-server --stdio`，該命令從 `PATH` 解析。其公開設定僅包含顯式的 `env` 覆蓋項和須為正有限值的 `disposeGraceMs`，且後者不得大於倉庫共享的 `MAX_TIMER_DELAY_MS`。安裝、登入、`CODEX_HOME`、模型選擇、基礎 URL、沙盒、審批策略和產品工作階段設定仍由 Codex 原生機制或部署環境負責。

發布前，提供方會驗證非空的純文字任務，在父級工作區中啟動受管的 app-server，完成 `initialize` → `initialized` 握手，並建立一個 `ephemeral: true` 執行緒。已發布的執行只擁有一次 `turn/start`；其執行緒 ID 與輪次 ID 保持私有，絕不會持久化到父工作階段。

`turn/completed` 是權威的遠端終止事實。以最後一條帶有 `phase: "final_answer"` 的 `agentMessage` 為準，且選中的訊息必須包含非空白文字。若產品沒有寄出明確的最終階段，則以最後一條 `phase: null` 的訊息作為相容性回退，該訊息也必須包含非空白文字；過程說明絕不會取代上述任一答案。帶有 `error.codexErrorInfo: "contextWindowExceeded"` 的失敗輪次會成為 `max-tokens`。輪次完成卻沒有答案、其他任何遠端失敗或中斷輪次、已識別的 app-server 幀中必需欄位格式錯誤、協議關閉、行程提前退出或未知的伺服器請求，都會產生 `error`；本版本沒有原生的拒絕終止狀態，因此不會產生 `refusal`。本機取消在競態中勝出並保持為 `aborted`。

對於命令與文件審批，無人值守的協議連線會從請求給出的決策選項中選擇一項不予批准的決策，並優先選擇 `cancel`；穩定的 0.147.0 請求形態沒有決策選項清單，因此回退到 `decline`。它不授予該輪次請求的任何權限，不向使用者輸入請求提供任何答案，並拒絕 MCP elicitation。若請求在無人值守模式下沒有合法回應，或是未知伺服器請求，此次執行就會失敗，而不會等待本提供方沒有提供的使用者介面。

若啟動在發布前失敗，提供方會關閉協議連線、終止已取得的行程樹並等待其退出，然後拒絕 `start()`。對已發布的執行執行資源釋放時，提供方會盡力中斷已知輪次、關閉協議連線、結束標準輸入、呼叫共享的逐級終止機制，並等待整棵行程樹退出。結果失敗與清理失敗仍可彼此獨立地觀察。

Codex 0.147.0 使用 Responses 協議，而 DeepSeek 的公開 OpenAI 相容端點使用 Chat Completions。因此，帶金鑰 Codex e2e 會採用一個僅限回環、僅供測試內部使用的橋接層來處理一次不使用工具的隨機數請求：真實 Codex 將 Responses 傳送到橋接層，橋接層把收到的 Bearer 憑據與提取出的任務轉發到固定的 DeepSeek 官方端點，再將真實文字包裝進最小化的 Responses SSE（Server-Sent Events）生命週期。該橋接層既不是生產代理，也不能作為 Codex 原生連線 DeepSeek Chat Completions 的證據。

## Claude Code 提供方

`@deepseek-ai/dsh-subagent-claude-code` 註冊固定的 `claude-code` 提供方，並呼叫 `@anthropic-ai/claude-agent-sdk@0.3.220`。每次執行前，提供方經宿主 subprocess 執行世界解析固定名稱 `claude`，並把準確路徑作為 `pathToClaudeCodeExecutable` 交給 SDK；SDK 因此使用啟動 DSH 的原生產品，而不是選擇自身的 platform `optionalDependency`。Windows `.cmd` 或 `.bat` 路徑會作為帶引號、僅供本次 spawn 使用的環境展開值穿過 `cmd.exe /v:off`，因此路徑中的百分號、與號和感嘆號仍只是資料，且無需改變共享子行程約定。提供方使用官方 `query()` 入口點，並將 SDK 的 `spawnClaudeCodeProcess` 參數、cwd、環境和轉發的訊號交給 `dsh-subprocess`；其私有 `SpawnedProcess` 配接器只公開 SDK 所需的流、事件、終止和退出事實。

公開設定包含與 Codex 兄弟提供方相同、由部署方負責的兩個值：顯式的 `env` 覆蓋項，以及須為正有限值且不得大於倉庫共享 `MAX_TIMER_DELAY_MS` 的 `disposeGraceMs`。每次執行都會建立自己的 `AbortController`，設定 `persistSession: false` 並停用 `AskUserQuestion`。提供方故意省略 `settingSources`，因此 SDK 會相對於父工作階段 cwd 讀取宿主機常規的使用者、項目和本機 Claude 設定。它既不複製也不過濾這些設定，也不會建立或修改登入狀態。提供方不設定 `canUseTool`、elicitation 或對話回呼，因此無人值守互動會經 SDK 失敗，而不會等待本提供方不負責的使用者介面。

只有在 SDK `Query` 與受管的活動 CLI 控制代碼都已存在後，提供方纔會發布執行。它會消費完整的 SDK 流；只有 `result` 訊息具有 `subtype: "success"`、`is_error: false` 和非空白 `result`，且迭代器隨後正常結束時，執行才會完成。所有 SDK 錯誤子類型、標記為錯誤的成功訊息、結果缺失、迭代器失敗、協議失敗或行程失敗都會成為 `error`。SDK 的輪次、預算和結構化輸出限制不表示 token 視窗耗盡，而且 SDK 沒有原生的拒絕終止狀態，因此本提供方不會產生 `max-tokens` 或 `refusal`。本機取消會勝出並成為 `aborted`。

啟動回滾和已發布執行的資源釋放都會關閉 SDK query、中止該次執行的控制器、呼叫共享的行程樹終止機制，並等待整棵行程樹退出。`Query.close()` 表達優雅的協議關閉意圖，但不能取代子行程責任方的退出證明。Query 關閉失敗、行程失敗和清理失敗仍可彼此獨立地觀察。

帶金鑰 Claude Code e2e 直接使用官方 DeepSeek Claude Code 約定：僅在執行時期提供的 DeepSeek 金鑰會對映為 `ANTHROPIC_AUTH_TOKEN`，固定的官方基礎 URL 會追加 `/anthropic`，主模型與 subagent 模型變數會選擇文件所示的 DeepSeek 模型。該測試會啟動生產提供方與真實 SDK 和 CLI，要求一個隨機數作為完整答案，不會把任何憑據持久化到設定中，並等待所有受管控制代碼退出。

## 分發與證據

每個產品都負責覆蓋所有分支的包測試、一項必跑的無金鑰真實產品測試、一項 Loader 組合 e2e 和一項帶金鑰 DeepSeek e2e。無金鑰產品層級使用被測的確切官方發行版、非空的偽產品金鑰、隔離的臨時工作區與產品主目錄，以及能返回固定答案的回環模型。產品請求缺失、身分驗證錯誤、任務文字被改動、答案不完全一致、真實產品被跳過或受管控制代碼仍存活，都會使這項必跑測試失敗。Loader 層級會啟動 README 所示形態的使用者設定，在同一個上下文中驗證兩個固定且只支持前臺執行的工具，並且不會啟動任何產品行程。帶金鑰層級會使用僅在執行時期提供的金鑰啟動同一生產提供方與真實產品，要求從固定的 DeepSeek 官方服務取得唯一隨機數，並再次證明完全靜止；僅當本機操作者未提供金鑰時才會自行跳過，而受信任的 CI 會預檢該 secret。

Codex 證據鎖定 `@openai/codex@0.147.0` 與 `codex-cli 0.147.0`。其真實產品測試會觀測確切的 Bearer 金鑰、原始任務、逐位元組完全一致的最終回答、不會產生文件副作用的無人值守命令拒絕、本機取消以及整棵行程樹退出。生產環境仍提供 `codex`，並透過 `PATH` 解析。

帶金鑰 Codex e2e 會註冊生產提供方，啟動同樣的真實 app-server，並透過上述測試專用橋接層請求一個隨機數。該測試固定外部端點與模型，不儲存任何憑據或請求載荷，要求上游恰好完成一次回應，將去除首尾空白後的產品答案與該隨機數逐位元組比較，並等待所有受管控制代碼退出。

Claude Code 證據鎖定 Agent SDK 0.3.220，並使用 SDK 按平臺分發的 Claude Code 2.1.220 CLI 作為確定性相容性 fixture（測試前置資料），且該 fixture 經生產環境所用的同一原生可執行文件解析路徑執行。其真實產品測試會觀測確切的 `x-api-key`、原始任務、逐位元組完全一致的最終回答、繼承的臨時宿主設定標記、行程失敗、本機取消、整棵行程樹退出，以及位於同時含百分號、與號和感嘆號路徑中的真實 Windows batch shim。這項證據證明官方 SDK/CLI 整合路徑，而不證明它與每個獨立安裝的產品版本相容。Loader 與隨附 profile 證據會按名稱解析兩個產品包且不啟動產品，provider 測試則證明 SDK 收到由宿主 `PATH` 解析出的可執行文件。

帶金鑰 Claude Code e2e 僅在提供方的記憶體環境中對映金鑰與固定的官方端點，把模型變數設為文件所示的 `deepseek-v4-pro[1m]` 與 `deepseek-v4-flash`，並實際經過生產提供方、官方 SDK 與真實 CLI。它將去除首尾空白後的結果與一個隨機數比較，並證明整棵行程樹退出，且測試不會直接呼叫 Messages API。

項目所有者的分發授權範圍限定為官方 `@anthropic-ai/claude-agent-sdk` 身份，以及每個 SDK 版本透過 `optionalDependencies` 聲明的官方 Claude Code CLI 與平臺載荷。[`THIRD_PARTY_NOTICES.md`](../../../../THIRD_PARTY_NOTICES.md) 會推導並披露當前載荷集合，但不會將其聲明條款重新歸類為寬鬆條款。版本、授權條款欄位和載荷集合發生變化時，仍須經過常規的相依性、鎖定檔、相容性、條款和聲明評審；無關的非寬鬆執行時期包繼續以默認拒絕方式失敗。

## 曾考慮的替代方案

**直接模型 HTTP、`codex exec` 或手寫的 Claude CLI 協議。** 這些路徑會繞過產品的官方可擴充整合介面，無法證明原生設定、工具、審批、結果語義或資源清理。每個提供方都改用相應的官方產品整合。

**共享產品行程輔助包。** 現有 subagent 與子行程 seam 已負責圍繞任務、結果、環境和行程樹的全部共享職責。新輔助包無法刪除任一私有產品配接器，只會造成責任重複，因此每個配接器都會直接呼叫現有 seam。

**面向模型的產品選擇器。** 產品可用性和身分驗證屬於部署事實。兩個固定工具使各自的 schema 與提供方綁定保持明確，也避免在通用服務中新增動態選擇狀態。

**以產品替身作為強制證據。** 替身可以窮盡覆蓋私有協議分支，但無法證明包匯出、官方發行版、身分驗證或真實行程行為。強制證據會驅動每個官方產品連線回環模型 fixture。

**由外掛程式管理登入、產品主目錄、模型、設定或權限。** 這些選擇會在每個產品的原生設定之外建立另一套權威來源，並將一次性提供方擴張為帳戶管理功能。提供方只公開顯式環境覆蓋項和清理寬限期；無人值守互動會以默認拒絕方式失敗。

**續接、進度、後臺收集和共享父級上下文。** 已交付的使用者結果是一項自包含任務和一個最終回答。產品工作階段、復原、後續互動、中間訊息、父級 transcript（文字記錄）傳遞、結構化輸出和後臺收集都需要獨立的使用者約定，當前實作不會預先建置這些功能。

## 後果

使用者透過官方產品整合支持的兩個穩定前臺工具進行委派。它們在 Profile 中的歸屬和按 Preset 暴露方式由[共享宿主歸屬決策](../architecture/2026-08-10-product-subagent-providers-in-shared-host.md)負責；本說明規定的提供方生命週期會保留原生設定與行為，而共享服務繼續獨佔任務結帳與行程樹完全靜止的責任。

每次委派都要承擔新建產品行程和獨立模型上下文的開銷，且只有最終文字會到達父級。產品原生設定使行為取決於部署環境中安裝的產品、帳戶狀態和工作區設定。帶金鑰 e2e 執行還會消耗外部 API 配額，並相依性 DeepSeek 官方端點；對協議、失敗、取消與審批的確定性覆蓋仍由無金鑰層級承擔。提供方不會復原工作階段、以流式方式傳送進度、接受新的人工互動、回滾工具或文件副作用，也不會施加按實際經過時間觸發的逾時。

相容性由包級單元測試覆蓋率、無金鑰真實產品回環測試、帶金鑰 DeepSeek 隨機數測試、公開 Loader 組合、已建置包與 NodeNext 消費端檢查、生成的文件與聲明以及倉庫 CI 矩陣共同鎖定。更改受支持的產品基線或 DeepSeek 端點／模型基線時必須刷新這些事實；生產環境不會另行執行執行時期版本探測。
