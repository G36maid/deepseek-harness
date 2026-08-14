# @deepseek-ai/dsh-tool-ask-user

[English](README.md) | 繁體中文

模型側 `ask_user_question` 工具，基於 `ctx.userQuestions` 實作。當模型需要確認、選擇結果或缺失的資訊才能繼續時，它可以藉此向使用者提出簡明問題。

## 工具

`ask_user_question` 接受以下參數：

- `questions`：必填的非空問題對象陣列。
- `id`：每個問題必填的穩定 id，會原樣包含在回答中。
- `question`：每個問題必填的問題文字。
- `header`：選填的簡短標題。
- `options`：選填選項，包含 `label` 和 `description`。如需推薦某個選項，請將其置於首位，並在該標籤末尾追加 `(Recommended)`。
- `multi_select`：該問題是否可以返回多個選中的選項。

工具呼叫 `ctx.userQuestions.ask()`，並返回規範的 `{ answers: [{ id, selected, custom? }] }`。`selected` 包含選項標籤；`custom` 攜帶自由填寫的回答，對於多選題會補充 `selected`，對於單選題則會覆蓋它。Native 渲染器會保留緊湊的 JSON 文字形式 `{ "answers": [{ "id": "...", "selected": ["..."], "custom": "..." }] }`。

## 職責

此包是使用者互動 seam 的Consumer 包。它不渲染 UI，也不瞭解輸入的收集方式；它只將模型參數轉換為 `AskUserQuestionRequest`，並把使用者回答返回給 agent loop（代理循環）。

## 模型體驗

### 工具 schema

#### 模型看到的內容

模型會看到生成的 [`ask_user_question` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-ask-user)，其中包含問題 id、提示語、標題、選項和多選標志。

#### Token 影響

工具可見時，每個請求都會產生固定的 schema token 開銷。

#### KV Cache 影響

只要定義和可見性保持不變，前綴即可穩定複用。外掛程式生命週期變化或作用域限制可能會使從此 schema 起的快取複用失效。

### 工具呼叫歷史與結果

#### 模型看到的內容

模型提出的完整問題保留在 assistant 工具呼叫參數中。使用者回答後，下一步會看到精確採用 `{"answers":[{"id":"<id>","selected":["<label>"],"custom":"<text>"}]}` 形式的緊湊 JSON；不使用 `custom` 時會省略該欄位，`selected` 可以包含零個、一個或多個標籤。呼叫等待期間的 UI 互動不屬於模型上下文。

#### Token 影響

參數和回答 JSON 是依資料而定的保留 token；等待使用者時不會產生 token 開銷。

#### KV Cache 影響

僅附加；新可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **待處理問題會阻塞工具呼叫，直至使用者作答**：該工具未聲明 `timeout-policy` 預算；取消僅沿用當前輪次的 `exec.signal`。
- **執行時期中歸屬於其他 agent 的 subagent 不能向使用者提問**：`ask_user_question` 會以 `DELEGATED_CALLER` 拒絕歸屬於另一個 agent 的存活子級；該子級必須在最終結果中包含尚未解決的問題或決策。持久譜系不能決定這一邊界，因此帶有譜系的工作階段復原為執行時期根後可以正常提問。
- **Native 回答渲染為 JSON 文字**：規範值仍為結構化資料，但模型側結果使用緊湊 JSON，而非更豐富的內容區塊詞彙。
