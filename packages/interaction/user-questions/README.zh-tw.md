# @deepseek-ai/dsh-user-questions

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

使用者互動 Service Definition。它定義 `ctx.userQuestions`，供面向模型的工具或權限外掛程式在需要暫停工作並詢問人類決定時使用。

## 服務：`UserQuestionService`（ctx 鍵：`userQuestions`）

### 公開 API

- `ctx.userQuestions.registerProvider(provider): () => void` 註冊 UI 側提供方。同一上下文中只能有一個活躍提供方；dispose（資源釋放）會將其註銷。
- `ctx.userQuestions.ask(request): Promise<AskUserQuestionAnswer>` 向活躍提供方提問並等待回答。

### 關鍵類型

- `AskUserQuestionRequest`：`{ questions: [{ id, question, detail?, header?, options?, multiSelect?, intent? }], agent?, signal? }`；`detail` 提供輔助文字，提供方會將其隨問題一起算繪，而不會將其變成選項標籤。如提供 `agent`，它必須與登錄檔中的存活執行時期根 agent（代理）是同一對象。
- `AskUserQuestionOption`：`{ label, description? }`。
- `AskUserQuestionIntent`：`{ kind: 'plan-review', approve }`；即下文的帶標籤呈現意圖。
- `AskUserQuestionAnswer`：`{ answers: [{ id, selected, custom? }] }`。
- `UserQuestionProvider`：包含 `ask(request)` 的 UI 實作。
- `UserQuestionError`：`HarnessError` 的子類，包含 `EMPTY_QUESTIONS`、`BAD_INTENT`、`NO_PROVIDER`、`DUPLICATE_PROVIDER`、`ASK_ABORTED`、`CALLER_NOT_LIVE` 和 `DELEGATED_CALLER` 等程式碼。

對於單選題，`custom` 會覆蓋選中的選項，且 `selected` 為空。對於多選題，`custom` 可以補充 `selected` 中的標籤。UI 可以把跳過的條目保留為 `{ id, selected: [] }`，既維持現有回答形態，也保留該批次中的其他回答。

請求包含 agent 時，`ask()` 會透過當前 `AgentRegistry` 驗證該 agent 與登錄檔中的存活實例是同一對象，並且只允許執行時期根呼叫。持久譜系不構成權限依據：帶有歷史委託深度的工作階段復原為新的執行時期根後可以提問；歸屬於另一個 agent 的存活子級即使持久化記錄的委託深度為零也會被拒絕。不含 agent 的程序化請求繼續沿用現有提供方路徑。

### 呈現意圖

`intent` 聲明某個問題本身就是一種已知決策，因此認識該標籤的 UI 可以照此呈現——`plan-review` 表示 `detail` 是一份待審閱的計畫，`dsh-plan-mode` 會在 `exit_plan_mode` 的問題上設定它。意圖只改變呈現：遵循它的 UI 回答的仍是通用 UI 會發送的那些選項標籤，不認識該標籤的 UI 算繪通用選項清單，因此呼叫方兩種情況下讀到的回答欄位相同。`approve` 指名錶示批准的標籤，而不相依性選項順序。有兩項斷言無法透過類型表達，`ask()` 會以 `BAD_INTENT` 拒絕它們：`approve` 未命中該問題自身的任一選項，以及意圖落在沒有 `detail` 的問題上——而 `detail` 正是它自稱在審閱的東西。

## 職責

這是 Service Definition 包。`@deepseek-ai/dsh-tool-ask-user` 等 Consumer 相依性此服務；Web 宿主執行時期提供隨產品交付的 Service Provider。迴圈保持不變：工具呼叫等待 Promise，工具結果隨後復原正常的 agent loop（代理循環）。

## 模型體驗

間接地，透過 `dsh-tool-ask-user`：它會將成功的提供方回答保留為緊湊 JSON，或返回以下失敗之一：`Error: ask_user_question was aborted before the user answered`、`Error: ask_user_question requires at least one question`、`Error: human interaction requires the exact live calling agent when an agent is supplied`、`Error: human interaction is unavailable while the calling agent is owned by another live agent; include the unresolved question or decision in the child agent's final result`、`Error: no user-questions provider is registered` 或 `Error: <message>`。等待人類回答不會增加 token。

#### KV Cache 影響

不會直接使 KV Cache 失效；請求前綴的任何變更均由上述消費端負責。

## 已知限制與暫緩事項

- **每個上下文只能有一個提供方**：不支援路由或扇出到多個 UI；第二次註冊會拋出 `DUPLICATE_PROVIDER`，未註冊任何提供方時，`ask()` 會拋出 `NO_PROVIDER`，而不會降級。
- **詞彙僅包含問題表單形態**：可供選擇的選項加選填的自訂文字；更豐富的互動形態（文件選擇器、diff 預覽確認）尚無 seam 詞彙。
