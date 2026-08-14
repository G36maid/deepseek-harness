# Agent Note: 拒絕執行時期中歸屬於其他 agent 的 subagent 向人類發起互動

Status: implemented

[English](2026-08-01-ask-user-delegated-caller-guard.md) | [简体中文](2026-08-01-ask-user-delegated-caller-guard.zh.md) | 繁體中文

## 問題

一次性 subagent 呼叫 `ask_user_question` 時可能無限阻塞。該呼叫會等待人類回答，但子級沒有由自身獨立擁有的人類互動通道，因此子級無法完成，等待其完成的父級也會隨之停滯。

持久化工作階段譜系無法判斷應答者是否存在。子工作階段之後可能復原為新的頂層執行時期根，而執行時期中歸屬於其他 agent（代理）的存活子級，其持久化委託深度卻可能為零或缺失。共享 seam 上的錯誤指引還必須適用於每個消費端：`exit_plan_mode` 會使用 `ctx.userQuestions.ask()`，但不會呼叫 `ask_user_question`。

## 決策

如果存在 `AskUserQuestionRequest.agent`，`UserQuestionService.ask()` 會透過 `ctx.agents` 驗證該 agent 就是登錄檔中的存活實例，並且只在 `ctx.agents.roots()` 包含該實例時才允許呼叫。缺失登錄檔或傳入僅 id 相同的過時對象時，以 `CALLER_NOT_LIVE` 失敗；存活 agent 歸屬於另一個存活 agent 時，以 `DELEGATED_CALLER` 失敗。該檢查位於現有的已中止和空批次守衛之後、意圖校驗或提供方分派之前，因此歸屬於其他 agent 的子級絕不會觸發 UI 等待。

以執行時期所有權為權限依據。攜帶譜系的工作階段在無所有者的情況下復原時就是執行時期根，可以提問；存活子級即使持久化 `delegationDepth` 為零，仍無資格提問。不帶 agent 的程序化呼叫繼續沿用現有提供方路徑。

共享失敗文字與具體消費端無關，並給出可執行指引：子級把尚未解決的問題或決策寫入最終結果。委託約定本就會把該結果傳給父級，父級可據此決定是否詢問人類。服務和子級都不會宣稱存在實際上並不存在的向上訊息傳遞或回答轉發能力。

該安全邊界與瀏覽器的 composer 選舉相互獨立。提議的[語義 composer 階段](../../proposed/architecture/2026-08-08-semantic-composer-chain-phases.md)解決已有待處理互動與只讀 subagent 介面的排序方式；它不會削弱此執行時期守衛。

## 備選方案

**使用 `session.header.delegationDepth > 0`。** 不予採用：持久化譜系會在復原後繼續存在，卻不能證明當前行程內所有者。該方案會拒絕有效的已復原根，也可能放行持久化 header 不完整的存活子級。

**僅在 `dsh-tool-ask-user` 內拒絕。** 不予採用：`exit_plan_mode` 與直接呼叫方共用 `ctx.userQuestions.ask()`。服務是所有人機互動消費端共同經過的最窄操作邊界。

**讓子級向上委託或等待轉發。** 不予採用：一次性委託沒有公開從子級向父級請求的通道，也沒有回答轉發協議。唯一有保證的返迴路徑是子級的最終結果。

**相依性瀏覽器的 composer 修復。** 不予採用：呈現方式無法憑空產生由所有者負責的人類通道，非瀏覽器部署仍然需要該呼叫能夠終止。

## 影響

執行時期中歸屬於其他 agent 的子級呼叫會以穩定的結構化錯誤快速失敗，而不是掛起。登錄檔中的確切存活根和不帶 agent 的程序化呼叫仍有資格提問，包括帶有歷史子級譜系的已復原工作階段。`ask_user_question` 與 `exit_plan_mode` 會收到相同的中性糾正指引，而其模型可見 schema 和系統提示詞前綴保持不變；只有追加的錯誤結果發生變化，因此現有 KV Cache 前綴仍可複用。

## 測試

服務測試覆蓋持久化深度為零的存活子級、深度為一的已復原執行時期根、缺失登錄檔、僅 id 相同的過時對象，以及每次拒絕都不呼叫提供方。工具與 plan-mode 測試證明兩個消費端都會呈現中性的 `DELEGATED_CALLER` 結果，且絕不觸達提供方。無金鑰組裝快照委託一個嘗試呼叫 `ask_user_question` 的子級，固定其錯誤工具結果和最終交接，並證明父級可以完成，而不是一直等待回答。
