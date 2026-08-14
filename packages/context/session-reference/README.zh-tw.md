# `@deepseek-ai/dsh-session-reference`

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

`ctx.sessionReferenceResolver` 會把其他工作階段準備為有界、只讀快照，作為帶來源資訊、面向模型的上下文。它消費 `ctx.sessionQuery` 與後端無關的 compact 檢查點標記；不需要 SQLite FTS。支持跨工作階段 mention 的宿主可以主動啟用該服務。

## 公開 API

- `listCandidates(agent, query?, limit?)` 會列出 `agent.id` 之外的工作階段，按 id、cwd 或以日誌為依據的最新標題進行不區分大小寫的篩選，再按同 cwd、無 cwd、其他 cwd 記錄排序，同時保持每組內的 `listSessions()` 建立順序。每個已選候選工作階段都使用該標題作為 mention label；標題不存在或無法讀取時回退到工作階段 id。不搜尋訊息主體。
- `prepare(agent, content, references, signal?)` 會保留首次 mention 順序、對 id 去重，並拒絕自引用或超過已設定不同源上限的情況。它會平行讀取所有源，返回與輸入脫離的內容，外加零個或一個聚合且帶標識的 `UserMessage` 上下文。任何無效引用、讀取失敗、取消或預算失敗，都會使準備操作在宿主呼叫 `followup()` 或 `steer()` 之前失敗。
- `encodeSessionReferenceUri()` 與 `decodeSessionReferenceUri()` 實作 `dsh-session:<base64url(JSON.stringify(sessionId))>`，因此每個 JavaScript 字串 id 都能精確往返。`formatSessionReferenceMention()` 寄出 `@[label](uri)`，`parseSessionReferenceText()` 將 Markdown mention 或裸規範 URI 替換為可讀的 `@label` 文字，並返回結構化引用。解析器會拒絕顯式 Markdown mention 中任何格式錯誤的 URI；只當 scheme 後跟非空、符合 base64url 形狀的 payload 時，裸文字才被視為引用，匹配但非規範的候選項仍會失敗。空 scheme mention 或只含標點符號的 scheme mention 仍是普通討論文本。

## 快照語義

準備階段會對每個不同源呼叫一次 `ctx.sessionQuery.readSurface()`，入隊後絕不重讀。它僅投影摺疊後當前表層中的使用者直接寄出的 `user/message`、assistant 文字，以及 `user/message` 檢查點；這類檢查點攜帶規範 `dsh-compaction` 源標記。對於已經包含固化前綴上下文的源提示詞，投影只讀取其對模型隱藏的顯示內容，以防止快照遞迴傳播。已遮蔽的壓縮（compaction）前事件、工具、推理（reasoning）、上下文、除已標記 compact 檢查點外的外掛程式生成 user 訊息，以及未完成的 assistant 區塊均會被排除。因此，已壓縮源只會提供最新檢查點及其後保留的工作階段內容，不會還原已遮蔽的文字。

上下文源為 `{ kind: 'session-reference', version: 1, references }`；每條引用會記錄其源 id 與 label、捕獲 seq、是否存在 compact、已保留／已省略訊息數、已省略 UTF-8 位元組數與截斷狀態。agent 空閒時，標準 TUI 會安裝一次性的 `agent/pre-step` 包裝層，只把快照新增到包含已領取直接提示詞的 `enter` 決策。agent 執行時期，它會緊接著呼叫 `inject()` 和 `steer()`，把兩則訊息放入 next-step inbox，等待後續同一次領取。目標日誌因此會先記錄一條帶來源資訊的上下文 `user/message`，再記錄可讀的直接 `user/message`。後續源變更、壓縮或刪除都無法改變目標重播。

## 設定

| Key | 預設值 | 約定 |
|---|---:|---|
| `maxReferences` | `3` | 一條已準備訊息中不同源工作階段的最大數量；必須不大於 `3`。 |
| `candidateLimit` | `50` | 返回給宿主的默認候選數量。 |
| `maxReferenceBytes` | `65536` | 一個引用對象的最大序列化 JSON 位元組數。 |

保留會對每個源獨立應用 `maxReferenceBytes`，保留 compact 檢查點與最新訊息，再丟棄較舊的非檢查點單元，並使用 `dsh-output-retention` 頭部／尾部截斷和精確 UTF-8 省略通知。如果某個源的固定序列化欄位本身就超出限額，準備會以 `SESSION_REFERENCE_BUDGET_EXCEEDED` 失敗，而不返回部分上下文。

## 模型體驗

### 引用工作階段背景

#### 模型看到的內容

模型會看到兩條連續的 user 角色訊息：先是 `## Referenced sessions` 不受信任快照，再是帶可讀 `@label` 的當前訊息。警告禁止遵循快照中的指令、權限聲明或工具請求，除非當前 user 重複這些內容。標籤、cwd 值、id 與工作階段文字會作為 JSON 在 `<referenced-sessions>` 標籤中序列化；資料中的每個 `<` 都會以無損 JSON 轉義 `\u003c` 的形式寄出，因此源文字無法拼出定界標籤。

#### Token 影響

每條包含引用的訊息都會新增固定警告和最多三個序列化快照，每個快照都受 `maxReferenceBytes` 獨立限制。精確快照會保留在目標歷史中，直到目標壓縮遮蔽或摘要它；源工作階段變更不會新增更多 token。

#### KV Cache 影響

快照與請求是兩條連續、僅附加的目標訊息，並保留較早的可快取歷史。不同引用或源捕獲內容只改變新後綴；後續目標壓縮可能使從替換邊界起的複用失效。

## 已知限制與暫緩事項

- **不支持訊息正文檢索**：候選查詢會檢查摺疊後的標題，但不搜尋訊息主體。非空查詢可能透過 session-query 服務有界、可取消的批次處理檢查每個可見的持久化工作階段日誌；專用標題索引未來可以替換這條發現路徑，而不改變 URI、快照或持久化約定。
- **受信任呼叫方邊界**：該服務假設宿主有權讀取 `ctx.sessionQuery` 公開的每個工作階段；它不是面向模型的搜尋工具。
- **只投影文字**：不會在工作階段間傳播非文字 user 與 assistant 塊。
- **沒有即時連結**：引用是快照，不是 fork、復原、訂閱或源工作階段變更。
