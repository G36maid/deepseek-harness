# @deepseek-ai/dsh-lsp-stdio

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

`ctx.lsp` 的**通用 stdio 語言伺服器後端**。一個外掛程式實例接受一張命名伺服器表，並逐設定項註冊一個隔離的提供方。它透過 `ctx.fs` 讀取，並透過 `ctx.subprocess` 啟動，因此伺服器與原始檔始終位於已掛載的執行世界中。這是通用主機，而不是語言伺服器目錄或安裝器：部署需要顯式設定命令與對映，預設應放在 `cordis.yml` overlay 中。

Namespace 外掛程式（`name`／`inject`／`Config`／`apply`，無默認匯出）。

## 功能

- 在註冊前解析每項伺服器區域性設定；無效對映或註冊衝突會回滾較早設定項，因此載入失敗不會留下提供方路由。
- 每個 `(server id, canonical workspace target)` 惰性 single-flight 一個伺服器行程。伺服器仍存活時返回的錯誤不會觸發重試；如果選中的池化傳輸在只讀查詢之前或期間發生故障，提供方會等待其 dispose（資源釋放）完成，並在新行程上重試該查詢一次。
- 每次查詢都使用相容性優先的**臨時打開**序列：透過 `ctx.fs` 流式讀取原始檔，同時解析並限制其位元組數；隨後執行 `textDocument/didOpen`（版本 1、完整文字）、所請求操作，再執行位於 `finally` 中的 `textDocument/didClose`。寫入 `didOpen` 失敗或取消時，會在池複用該實例前將其終止。文件在每次呼叫後關閉，因此第一版不需要 `didChange`、內容 cache 或文件 LRU。
- 透過一條逐 Workspace、可中止的佇列，序列執行每個源讀取／打開／查詢／關閉生命週期，因此排隊呼叫只會在輪到自身時讀取當前源；不同 Workspace 平行執行。提供方 dispose 會中止檔案系統與協議工作，等待尚未進入佇列的 Workspace 尋找完成，隨後排空每條佇列與每個伺服器。
- 協議 shutdown 失敗後，經由子行程 seam 終止伺服器後代樹（POSIX 行程組訊號；Windows `taskkill /T /F`）。樹終止的投遞結果與所有行程組訊號一樣被就地吸收，不向外拋出（投遞與伺服器退出存在競態）；伺服器是否完全靜止，由控制代碼的行程樹存活等待確認，而非由這次終止自身的結果確認。
- 透過 `ctx.subprocess` 解析伺服器可執行文件、cwd、行程和協議流；`initialize.processId` 為 `null`，因為另一臺機器或 PID namespace 不得監視 harness 行程。
- 使用 `ctx.fs` 提供的規範化包含關係、文件 URI 與流式文字驗證，但不寄出 `fs/observed`：只有 LSP 結果對模型可見，因此查詢不滿足先讀後寫策略。

## 設定

`servers` 記錄的 key 是在 `ctx.lsp` 上保留的穩定提供方 id；每個值具有以下形狀：

| 伺服器 key | 預設值 | 含義 |
|---|---|---|
| `command` | （必填） | 要 spawn 的可執行文件：絕對路徑，或在載入時從子行程 PATH 解析。不使用 shell 啟動。 |
| `args` | `[]` | 傳給可執行文件的參數。 |
| `env` | `{}` | 合併到已清理 credential 的環境之上的額外 env（匹配 `KEY`／`PASSWORD`／`SECRET`／`TOKEN` 的變數不會轉發）；顯式 `DSH_*` 條目在 seam 清除環境中同名值之後合併。 |
| `extensionToLanguage` | （必填） | 小寫、以點開頭的擴充名 → LSP language id（例如 `{ '.ts': 'typescript' }`）。 |
| `initializationOptions` | `null` | 轉發給伺服器的靜態 `initialize` 選項。 |
| `configuration` | `null` | 每個 `workspace/configuration` 設定項的靜態答案。 |
| `maxMessageBytes` | `16000000` | 從伺服器接受的單條 framed 訊息最大大小。 |
| `maxStderrBytes` | `1000000` | 為診斷保留的 stderr 尾部最大大小。 |
| `maxDocumentBytes` | `4000000` | 該主機可打開的原始檔大小上限。 |
| `shutdownTimeoutMs` | `5000` | 升級前用於優雅 `shutdown`／`exit` 的預算。 |
| `killGraceMs` | `2000` | 請求取消及 SIGTERM→SIGKILL 升級的寬限期。 |

`servers` 必須至少包含一個設定項，每個 id 都必須非空。定時器預算必須是正整數，且不超過 Node 的 `2_147_483_647` ms 定時器上限。所有可執行文件都會在清理 credential 後於載入時解析；後面的壞設定項會阻止所有提供方註冊。行程在第一次匹配查詢時惰性啟動。

## 協議行為

初始化會聲明 `general.positionEncodings: ['utf-16']`、`workspace: { workspaceFolders: true, configuration: true }`、`textDocument.hover.contentFormat: ['markdown', 'plaintext']`，以及定義與實作使用的 `linkSupport: true`，且不進行動態註冊。伺服器返回的能力具有最終決定權：不受支持的操作，或缺少臨時打開／關閉的同步方式，會使查詢失敗。伺服器省略 `positionEncoding` 時預設為 `utf-16`；其他值都屬於協議錯誤。用戶端透過靜態設定回答 `workspace/configuration`，接受生命週期記帳請求，並拒絕 `workspace/applyEdit`：它絕不應用編輯或執行命令。導覽直接對映 `Location`，並從 `LocationLink` 的 `targetUri` + `targetSelectionRange` 對映；hover 規範化會取得有效的 `MarkupContent.value`，保留 string `MarkedString`，把帶 language tag 的值渲染為圍欄程式碼，並用一個空行連線陣列。缺失結果、格式錯誤的範圍或位置，以及格式錯誤的 hover 編碼，都會以結構化 `LSP_MALFORMED_RESPONSE` 錯誤的形式失敗。

## 安全邊界

提供方信任其設定的伺服器，不提供任何沙盒隔離。它把規範化身份、包含關係、普通文件流式讀取、UTF-8 驗證和文件 URI 編碼委託給 `ctx.fs`；並在伺服器啟動前拒絕缺失、非普通文件、非 UTF-8、過大，或規範化後位於 Workspace 外部的查詢源。包含關係在打開流之前評估，不承諾在並行路徑替換期間保持穩定控制代碼身份。結果位置可以在外部，但外部路徑不能成為查詢源。部署必須掛載描述同一執行世界的檔案系統與行程管理提供方；分裂世界組合無效。

## 模型體驗

透過 `dsh-tool-lsp` 間接影響；該工具呈現此提供方的規範化結果，該主機自身不貢獻提示詞或 schema。

#### KV Cache 影響

不會直接失效；請求前綴變更由 `dsh-tool-lsp` 負責。

## 已知限制與暫緩事項

- **不提供隔離策略**：本包（package）信任所設定的伺服器，不對其行程實施沙盒；受限部署必須提供適當的行程／檔案系統提供方，或使用同一執行世界的沙盒包裝層。
- **臨時打開相容性下限**：同步能力省略打開／關閉（或聲明 `None`）的伺服器不受支持，即使關閉文件查詢能夠工作；固定的 TypeScript e2e 只建立一項相容性下限，不代表跨語言承諾。
- **逐伺服器／Workspace 序列化延遲**：共享同一個伺服器與 Workspace 的平行 agent（代理）會在一個行程後排隊；長生命週期 Workspace 行程會佔用記憶體直到 dispose。
- **被強制殺死的 harness 會殘留語言伺服器**：`initialize.processId: null` 取消了伺服器側的用戶端 PID 監視，因此伺服器只能由服務的優雅 dispose 清理；被 SIGKILL 的 harness 會讓它們繼續執行，直到自行退出。
