# @deepseek-ai/dsh-session-title-all-prompts-llm

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

選填的 `ctx.sessionTitle` 提供方，透過 `ctx.llm` 總結所有符合條件的使用者訊息。它註冊 `all-prompts` 節奏，並在每條新使用者提示詞後啟動新 revision，同時使用預置歷史與子工作階段提示詞。較新的 revision 會中止並取代舊工作；即使提供方忽略取消，也無法提交過時輸出。

該外掛程式使用完整且必填的[共享 LLM（大型語言模型）設定](../session-title-llm/README.md#configuration)。同時省略 `provider` 與 `model` 時，會繼承每個當前已記錄主請求的確切路由；也可以同時設定二者，使標題生成使用獨立路由。如果最終封裝的聚合提示詞超過 `maxInputBytes`，請求會失敗而不是截斷歷史；自動使用時會發出警告並保留先前標題。

## 模型體驗

### 全訊息標題請求

#### 模型看到的內容

標題模型會收到共享標題指令，以及一個 JSON 陣列，其中按日誌順序包含截至當前 revision 的所有符合條件使用者訊息和確切 seq。預置歷史也包含在內。

#### Token 影響

每條符合條件的新提示詞之後都可能傳送一次輔助請求，每次請求受 `maxInputBytes` 和 `maxOutputTokens` 約束；顯式刷新可能增加呼叫。主 agent（代理）請求不會增加 token。

#### KV Cache 影響

不會使主請求的 KV Cache 失效。每條提示詞後，輔助輸入都會成長或變化，因此提供方專用快取複用會在第一個變化的 JSON token 處結束。

## 已知限制與暫緩事項

- 輸入溢位時保留先前標題；對於很長的工作階段，此提供方沒有基於摘要繼續生成摘要的機制或保留策略。
- 它平等對待所有符合條件的使用者訊息，不提供權重、過濾或手動標題優先級。
