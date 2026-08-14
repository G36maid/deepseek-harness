# Agent Note: headless 是直接使用核心服務的入口

Status: implemented

[English](2026-08-09-headless-direct-core-entry-point.md) | [简体中文](2026-08-09-headless-direct-core-entry-point.zh.md) | 繁體中文

## 問題

`headless` 的產品約定是一個本機任務：最終 assistant 文字寫入 stdout，退出狀態反映成功與否，成功時 stderr 為空，並且不打開監聽埠。包含 Workspace Host 服務、ApiProxy、HTTP、Web 執行時期或瀏覽器外掛程式的組合違背這一約定，也使本機完成狀態相依性無關的傳輸樹。

直接入口仍需要與 Web 所建立 Agent 相同的部署模型狀態。獨立的提供方／模型預設值會讓同一部署產生兩種答案，而在 Agent 與工作階段持久化完全靜止之前推導完成狀態，會讓 stdout 與退出狀態觀察到不完整狀態。

## 決策

隨附的 `headless` profile 包含 `dsh-base` 與 `dsh-headless`。headless 組合包提供自身的 persona 與工具模式、停用 HMR（熱模組替換）、顯式掛載 Code Mode worker，並插入 `headless-runner`。其外掛程式樹不包含任何 `@deepseek-ai/dsh-host-*` 包、ApiProxy、HTTP server、Web 執行時期或瀏覽器用戶端。Code Mode 與工作階段持久化均為獨立於 Web 呈現的一次性 Agent 能力。

`headless-runner` 是直接使用核心服務的入口。Loader 完全載入後，它讀取 `ctx.agentDefaultModel.currentSelection()`，透過 `ctx.agents.create` 建立一個新的持久化 Agent，在 Agent 作用域中安裝該 `ModelSelection`，等待啟動工作完全靜止，錨定工作階段事件序號，提交一條普通使用者訊息，再次等待完全靜止。隨後，它等待 `ctx.sessions.flush`，摺疊自身持有的持久事件區間，以取得最後一條非空 assistant 文字和最終 `turn/end` 結束原因，將文字連同一個換行寫入 stdout，並且僅在結束原因為 `completed` 時請求啟動器以退出狀態 0 有界關閉。結束原因為 `error` 時，其持久化錯誤碼與訊息寫入 stderr；驅動器的意外失敗也寫入 stderr 並以 1 退出。

`@deepseek-ai/dsh-agent-default-model` 擁有與傳輸無關的預設值，供沒有工作階段級選擇的 Agent 使用。`AgentDefaultModelConfig` 提供 `ctx.agentDefaultModel` 並註冊 `agent-default-model` Settings 分節。組合設定提供 `{provider, model}`，使用者設定還可以提供 `reasoningEffort`。`currentSelection()` 返回當前的完整選擇，`saveSelection()` 則寫入完整分節，因此不含強度的選擇會清除已存強度。`dsh-base` 提供組合條目。直接入口與 ApiProxy 入口均消費該服務；只有 ApiProxy 負責工作階段級優先級、模型校驗與已接受 Web 選擇的持久化。

`loadProfile` 識別安裝過程擁有的精確 headless 元組（`dsh-base`、`dsh-web-app`、`dsh-headless`），將其規範化為隨附的 headless 範本，並保留 manifest（中繼資料清單）的其他所有欄位。帶額外項、缺少項或順序不同的組合包清單歸使用者所有，保持不變。

本 Agent Note 負責 headless 的傳輸與完成約定。[應用持有自己的命令列](2026-08-06-app-owned-command-line.md)負責當前的 `dsh --profile headless` 文法；原 [`dsh run` 決策](../../archived/feature/2026-08-08-dsh-run-headless-command.md)記錄已被取代的啟動器持有文法，[GUI 分層與 RPC 協議](2026-07-19-gui-layering-and-rpc-protocol.md)負責瀏覽器閘道邊界，[Web 設定樹啟動與傳輸分層](2026-07-24-web-config-tree-boot-and-transport-layering.md)負責 Web 外掛程式樹，[默認模型跟隨選擇器](../feature/2026-08-07-default-model-follows-the-picker.md)負責共享 Agent 預設值的持久化。

## 驗證

包測試圍繞指令碼化 Agent 工廠使用真實的工作階段儲存與 Agent 登錄檔，固定空閒態到空閒態的聚合、延遲非同步完成、終止態模型診斷、其他未完成退出、直接失敗、Loader 載入期間的 dispose（資源釋放），以及退出前 flush 的順序。組裝後的無金鑰快照透過重播的工具往返驅動 `dsh --profile headless`，記錄一條帶 `source.kind: 'user'` 的 `user/message`，並在 stderr 暴露終止態模型失敗。建置後二進位驗收透過已發布入口訪問 mock 提供方，並要求最終文字出現在 stdout、退出狀態為 0 且 stderr 為空。設定轉儲驗收排除隨附 headless 樹中的所有 Host、Web 與 Client 包；PTY 關閉覆蓋要求不出現觀察行，並在有界時間內完成 dispose。

## 考慮過的替代方案

| 替代方案 | 約定不匹配之處 |
|---|---|
| 保留 `dsh-web-app`，但隱藏觀察行 | 行程仍會打開埠並攜帶 Host、Web 與瀏覽器外掛程式樹。 |
| 圍繞 ApiProxy 建置純 Host 一次性組合包 | ApiProxy 是用戶端協議閘道，而本機一次性入口沒有用戶端邊界。 |
| 使用 `InProcessApiClient` 實作產品級協議覆蓋 | 產品執行會僅為測試無關協議而相依性該協議。 |
| 為 headless 單獨提供提供方／模型設定 | 直接建立與 Web 建立會擁有彼此獨立的預設值和持久化。 |
| 省略 Code Mode 與工作階段持久化 | 兩項能力都屬於一次性 Agent 執行，而不是 Web 呈現。 |
| 規範化所有包含 Web 與 headless 組合包的元組 | 組合包清單是擴充面；只有精確的安裝過程所屬元組可以安全分類。 |

## 後果

`dsh --profile headless` 提供本機 Agent 任務，而不是瀏覽器觀察、Host API 或 HTTP。需要這些能力的使用者選擇 `dsh web`。成功時 stderr 為空，完成結果在持久化 flush 後推導，持久化工作階段仍可供後續工具使用。初始使用者訊息記錄 `source.kind: 'user'`，因此不攜帶 ApiProxy `rpcId`。

ApiProxy 載體覆蓋保留在 ApiProxy 包中。自訂一次性 profile 可以顯式包含 Host 或 Web 組合包；隨附 profile 與可識別的安裝過程所屬元組均不含 Web。
