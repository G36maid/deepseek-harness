# @deepseek-ai/dsh-code-runtime

[English](README.md) | 繁體中文

**`CodeRuntime`**（`ctx.codeRuntime`）定義程式碼執行時期做什麼，即針對宿主提供的一組非同步綁定執行一段模型編寫的程序，並報告 `{ value, logs, error? }`，而不規定如何實作。

此包承擔該能力的 Service Definition 角色（以 bash 三包結構為範本，參見[能力 seam](../../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)）：提供方透過繼承 `CodeRuntime` 並註冊服務接入；Consumer 是工具登錄檔的 Code Mode，它生成面向模型的 SDK，並橋接工具分發。這兩項職責均由 [Code Mode Agent Note](../../../.agents/notes/implemented/feature/2026-06-15-code-mode.md) 規定，首個提供方是 Node worker 執行緒後端。執行時期不瞭解工具或工作階段：呼叫方只向它提供具名非同步函式與程序字串；所有與工具有關的內容都留在 Consumer。

## 服務 API（`ctx.codeRuntime`）

| 成員 | 語義 |
|---|---|
| `run(request)` | 針對請求的綁定執行一段程序。**所有程序失敗結果都透過 resolve 結果中的 error 欄位報告**：包括解析／轉換失敗、拋出例外、無效完成值、輸出溢位、預算到期、中止或執行基底終止（由 `CodeRunFailure` 的正交 `kind` 分類表示）；只有呼叫方誤用 Service Definition 約定時才 reject（例如 dispose（資源釋放）後仍提交執行）。程序作為非同步函式的函式體執行，因此頂層 `await`／`return` 可用，無損 JSON 完成值會成為 `result.value`。 |
| `language` | 只讀描述符：`run` 期望的源語言。已知值為 `'typescript'` 與 `'python'`——`dsh-tools` 能呈現的那些；其中只有 `'typescript'` 有已發布的後端。僅供參考，不作閘門；生成語言專用呈現的消費端會根據該值選擇分支，遇到無法呈現的語言時明確失敗。 |
| `isolation` | 只讀描述符：執行基底（`'worker-thread'`、`'process'`、`'container'`）。供部署與診斷使用，**不構成安全聲明**。 |

每個實作都必須遵守以下語義（完整約定見類 JSDoc）：綁定呼叫會橋接完整的無損 JSON 參數與 resolve 值，seam 層不設位元組上限；程序被視為敵對對等方（任意綁定名稱都會成為自有屬性，格式錯誤的通訊絕不能使宿主崩潰）；不同執行之間不保留任何狀態；dispose 會終止進行中的執行，並且在完成前等待其退出。

## 詞彙

`CodeRunRequest`（`program`、`bindings`、`signal?`）攜帶執行時期操作所需的全部內容；預設值解析（時間預算與外層輸出上限）屬於提供方的已驗證設定，絕不能是隱藏的 `??`，更不能藏在 `run()` 內部。`bindings` 是 `CodeBindingNamespace` 清單（`global` + `functions` + 選填 `errorClass`）；每個命名空間會作為一個由非同步可呼叫函式組成的全域性對象公開給程序，這些函式返回 `CodeJsonValue`。後者是服務本機、與規範 `JsonValue` 結構等價的類型，使 Service Definition 包保持獨立於工作階段。`errorClass` 描述符點名真實的程序全域性構造器，以及用於接收被拒絕成員名稱的自有屬性；執行時期不相依性 `ToolCallError` 等 Consumer 術語。`CodeRunResult` 報告無損 JSON 完成值 `value?`、有序的 `logs: string[]` 和 `error?`（`CodeRunFailure`：`kind` + 可回饋給模型的 `message`）。完整約定見 `src/types.ts`。

binding-global 與 error-class 名稱是**語言可移植**的：必須匹配識別符號子集 `[A-Za-z_][A-Za-z0-9_]*`（不含 JS 專有的 `$`）並透過 seam 匯出的排除集，因此同一份 `bindings` 清單對每個後端都有效，無論其 `language` 為何。本包匯出每個後端都執行的約定——`PORTABLE_RESERVED_WORDS`（ECMAScript ∪ Python 保留字）、`RESERVED_BINDING_GLOBALS`（如 `console` 等後端擁有的 global）、`RESERVED_ERROR_MEMBERS` 與 `DUNDER_MEMBER`（error-member 排除）——因此 `$tools`、`lambda`、`__dsh_main__` 之類的名稱會讓 `run()` 在任何後端上作為 seam 誤用而 reject，而非只在某些後端。確切集合與理由見 `src/index.ts`。

## 模型體驗

透過 `dsh-tools` 中的 Code Mode 間接提供；後者公開 `run_code`，並將程序日誌、值或失敗作為保留的工具結果 token 返回。

#### KV Cache 影響

不會直接失效；由上述消費端負責請求前綴變更。

## 已知限制與暫緩事項

- **`run()` 是一次性的**：`logs` 只有在 `CodeRunResult` resolve 後才能獲得；seam 不提供正在執行的程序所產生輸出的流式日誌或進度介面。
- **持久 REPL 風格核心已記錄為未來工作**：在持久核心後端帶來自己的日誌方案前，執行之間不保留狀態的約定繼續有效（參見 [Code Mode Agent Note](../../../.agents/notes/implemented/feature/2026-06-15-code-mode.md)）。
- **目前只提供 worker 執行緒後端**：`'process'`／`'container'` 是已經聲明但沒有實作的已知 `isolation` 值；強安全邊界需要等待容器後端。
- **中間綁定值沒有位元組上限**：實作仍受 structured-clone 成本與行程記憶體約束，而提供方或執行器可能已經應用自己的取得上限。
