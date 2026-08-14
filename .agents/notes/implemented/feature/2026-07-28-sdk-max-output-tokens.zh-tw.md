# Agent Note: SDK 最大輸出 token 數

Status: implemented

[English](2026-07-28-sdk-max-output-tokens.md) | [简体中文](2026-07-28-sdk-max-output-tokens.zh.md) | 繁體中文

## 問題

Python 與 TypeScript SDK 可以選擇提供方和模型，卻無法限制對話模型輸出。即使評測宿主要求固定輸出預算，執行時期仍會省略 `GenerateOptions.maxTokens`，由提供方預設值控制。`compaction-basic.maxTokens` 只限制壓縮摘要呼叫，不能承擔這一職責。

## 決策

高層 SDK 公開一個選填的行程級輸出上限：Python 命名為 `max_tokens`，TypeScript 命名為 `maxTokens`，共享的 `initialize` 協議載荷使用 `maxTokens`。JSON-RPC 伺服器端拒絕任何不屬於正安全整數的值，並將透過校驗的上限與提供方／模型路由一同保存。

每個由 SDK 建立的根 Agent 都透過 `AgentOptions.maxTokens` 獲得該上限。agent loop（代理循環）將它放入初始 `LlmCallConfig`；最終呼叫準備會保留顯式值，或填入確切模型的配接器預設值，再將生效上限記錄到請求 header，並從該持久化 header 重建每次分派的對話請求。因此，省略 SDK 選項時會應用所選配接器或提供方路由的預設值。

行程內 subagent 繼承父級的提供方、模型和輸出上限。顯式的 `SubagentStartRequest.agentOptions.maxTokens`（包括透過 `dsh-tool-subagent` 設定的值）會覆蓋該子級及其後代的繼承值。行程外提供方自行持有其獨立執行時期的設定；因此 `subagent-dsh-sdk` 公開獨立的選填 `maxTokens`，並透過該子執行時期自己的 SDK 握手傳入。

壓縮、工作階段標題生成、網頁搜尋和其他輔助呼叫繼續使用各自持有的獨立輸出上限。`maxTokensAsSuccess` 仍然只負責結果對映，不會設定或改變上限。

## 考慮過的替代方案

**僅設定配接器環境變數。** 序列化器私有回退僅適用於 DeepSeek 配接器，不會出現在工作階段請求 header 中，對被攔截請求或其他配接器無效，也容易與提供方預設值混淆。配接器持有的預設值可以改為透過確切模型元資料公開，並在記錄前填入提供方無關的請求設定。

**在每個 `session/prompt` 上增加 `maxTokens`。** 按輪次修改會擴充協定格式，並引入當前評測用例不需要的請求設定轉換。執行時期初始化選項可讓一個 SDK 行程中的每個工作階段擁有相同、可重現的預算。

**複用 `compaction-basic.maxTokens`。** 壓縮值控制摘要生成，而非普通對話請求。共用會耦合兩類不同 token 預算，調整一方時會靜默改變另一方。

## 後果

SDK 呼叫方無需修改 Cordis 組合即可限制模型輸出，直接建立 Agent 也使用同一套經過校驗的 `AgentOptions` 約定。該上限在持久化請求 header 中可見，並以 `GenerateOptions.maxTokens` 到達提供方配接器；DeepSeek 序列化會將其對映為 `max_tokens`。

一個 SDK 執行時期只有一個默認上限。需要不同上限的呼叫方應執行獨立的執行時期實例，或透過 agent options 顯式覆蓋某個行程內子級。達到上限時仍產生現有的 `max-tokens` 停止原因；將其對映為 `ok` 還是 `error` 仍由部署策略決定。
