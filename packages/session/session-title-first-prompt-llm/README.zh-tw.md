# @deepseek-ai/dsh-session-title-first-prompt-llm

[English](README.md) | 繁體中文

選填的 `ctx.sessionTitle` 提供方，透過 `ctx.llm` 總結第一條符合條件的使用者訊息。它註冊 `first-prompt` 節奏，只在全新非 fork 工作階段首次建立回退時自動執行，並將結果歸因於該訊息的確切 seq。自動失敗會保留回退，之後只能透過 `ctx.sessionTitle.refresh()` 重試。

該外掛程式使用完整且必填的[共享 LLM（大型語言模型）設定](../session-title-llm/README.md#configuration)。同時省略 `provider` 與 `model` 時，會繼承當前已記錄主請求的確切路由；也可以同時設定二者，使標題生成使用獨立路由。

## 模型體驗

### 首訊息標題請求

#### 模型看到的內容

標題模型會收到共享標題指令，以及一個只包含第一條符合條件使用者訊息的 JSON 陣列。後續提示詞與繼承的 fork 歷史不會觸發再次自動呼叫。

#### Token 影響

全新工作階段最多自動寄出一次輔助請求，並受 `maxInputBytes` 和 `maxOutputTokens` 約束；顯式刷新可能寄出額外呼叫。主 agent（代理）請求不會增加 token。

#### KV Cache 影響

不會使主請求的 KV Cache 失效。輔助請求使用已設定或已記錄路由，其快取行為由提供方決定。

## 已知限制與暫緩事項

- 對於長期工作階段，第一則訊息可能不再具有代表性；如果後續提示詞應觸發重新生成標題，請使用全訊息提供方。
- fork 會保留繼承的標題，絕不會自動執行此提供方，即使其預置的首訊息來自父工作階段。
