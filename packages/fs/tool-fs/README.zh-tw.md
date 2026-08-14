# @deepseek-ai/dsh-tool-fs

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

**面向模型的檔案系統工具**（`read`、`read_image`、`write`、`edit`）及其**執行器**。這是檔案系統棧的消費端層：擁有工具名稱、JSON Schema、參數校驗、提示詞段、**讀取視窗邏輯**和結果格式化。它**直接**透過 `ctx.fs` 提供方約定（[`@deepseek-ai/dsh-fs`](../fs)）讀取／寫入／編輯。新鮮度／觀察策略由獨立外掛程式（[`@deepseek-ai/dsh-fs-observation-policy`](../fs-observation-policy)）透過 `fs/*` 事件閘門貢獻；工具不與其方法耦合。使用施加沙盒限制的提供方時，逐工作階段執行需要共享沙盒策略服務，工具還會為檔案系統變更提供升權路徑。

```ts ignore-check
// Default deployment: a ctx.fs provider, the policy plugin, then the tools.
await ctx.plugin(LocalFileSystem, { cwd: process.cwd() }) // @deepseek-ai/dsh-fs-local
await ctx.plugin(FsPolicy)                             // @deepseek-ai/dsh-fs-observation-policy (policy gate)
await ctx.plugin(LocalAttachmentStore, { dshHome })       // optional — enables durable read_image results
await ctx.plugin(ToolFs)                                  // this package — read/write/edit, plus read_image with attachments
```

`@deepseek-ai/dsh-fs-observation-policy` 是**選填的**：省略時，工具直接使用裸提供方（無條件寫入/覆蓋/編輯，無已觀察狀態）。載入這些工具的部署也應載入該外掛程式，從而提供寫入/編輯前讀取行為。

`read_image` 只在持久 `ctx.attachments` 服務已掛載時註冊：沒有它，部署無法持久提交影像位元組，工具就不會出現。執行時還要求確切路由的模型聲明 `image` 輸入（透過 `ctx.llm.resolveModelInfo` 從工作階段最新請求 header 解析，缺失時回退到 agent 選項）；未知或純文字路由在任何檔案系統 I/O 之前就得到拒絕結果，因此文字路由的持久歷史不會出現影像塊。

## 設定

所有鍵均為選填；預設值是隨產品交付的讀取上限。

| 鍵 | 預設值 | 含義 |
|---|---|---|
| `readLimit` | `2000` | 一次 `read` 呼叫返回的默認和最大行數（工具 schema 將其聲明為 `limit` 預設值）。 |
| `readMaxLineLength` | `2000` | 每行截斷前保留的字元數（後綴會說明上限）。 |
| `readMaxBytes` | `51200` | 一次 `read` 呼叫所選行的位元組上限；溢位時以「已達上限」footer 結束視窗。 |
| `readStreamMinSize` | `10485760` | 大於等於該大小或大小未知的文件採用流式讀取，而不是整體載入到記憶體。 |

## 工具（schema 見[檔案系統工具 schema Agent Note](../../../.agents/notes/implemented/feature/2026-06-17-filesystem-tool-schemas.md)）

| 工具 | 參數 | 行為 |
|---|---|---|
| `read` | `file_path`、`offset?`、`limit?` | 帶行號的 UTF-8 內容和分頁 footer。`offset` 從 1 開始；`limit` 預設為設定的 `readLimit`（2000），上限也為該值。 |
| `read_image` | `file_path` | 透過有界位元組 seam 讀取 PNG/JPEG/WebP/GIF 文件，經 `ctx.attachments.saveImage` 持久保存，並在小型元資料信封旁返回影像塊。只有確切路由的模型聲明影像輸入時才會成功。 |
| `write` | `file_path`、`content` | 建立文件或完整替換文件。有策略外掛程式時：覆蓋現有文件要求先在未變版本上執行 `read`；建立新文件不需要。沒有外掛程式時：無條件執行。 |
| `edit` | `file_path`、非空 `old_string`、`new_string`、`replace_all?` | 字面量替換；除非 `replace_all` 為 true，否則要求唯一匹配。有策略外掛程式時：要求先執行 `read`（任何視窗），且文件此後未變。沒有外掛程式時：無條件執行。 |

欄位名使用 snake_case，與 Claude Code 和現有 harness 工具 schema 一致。

規範成功值分別為：`read` → `{ path, offset, lines: [{ number, text }], totalLines }`，`read_image` → `{ path, image: { attachmentId, mediaType, bytes, width, height, name? } }`，`write` → `{ path, operation: 'create' | 'update', before: string | null, after }`，`edit` → `{ path, before, after }`。原生渲染器會保留下方帶行號的讀取結果和變更確認。`write`/`edit` 從這些規範值派生可重播的 diff 卡片元資料，`read` 派生可重播的讀取卡片視窗 `{ path, offset, lines, totalLines, lang? }`；規範值本身僅限於本次執行，不會新增到 `tool/result`，只有派生出的呈現元資料會被持久化。

## 工具就是執行器；策略是事件閘門

工具**不**注入策略服務，也不檢查任何快取。每個工具透過 `ctx.fs.resolve(path, { cwd, signal })` 解析路徑；它會傳入呼叫 agent（代理）的工作階段 cwd（`exec.agent.session.header.cwd`），使相對路徑以工作階段工作區為基準解析並與 `dsh-tool-bash` 一致，同時把工具取消轉發到解析過程（見[每工作階段 cwd Agent Note](../../../.agents/notes/implemented/architecture/2026-07-02-fs-per-session-cwd.md)）。隨後執行：

- **read**：一次 `ctx.fs.stat`（用於類型、大小路由和版本），隨後呼叫 `readText`/`streamText`，建置行視窗，再發出 `fs/observed`，使用普通 `ctx.emit`。（1 次 stat。）
- **read_image**：在任何 I/O 之前校驗參數、擴充名、附件可用性、部署接受的媒體類型和影像路由；隨後一次 `ctx.fs.stat`（目標缺失時與 `read` 一樣記錄 `absent` 觀察）、以 `imageLimits.maxImageBytes` 與 `imageLimits.maxMessageImageBytes` 中較小者為上限的有界 `ctx.fs.readBytes`（結果是攜帶一張影像的一則訊息）、`attachments.saveImage`（內容尋址，因此在 `tool/result` 事件追加時影像塊引用的對象已持久提交），最後寄出 `fs/observed`。（1 次 stat。）
- **write**：呼叫 `ctx.waterfall('fs/write-intent', target, exec, () => undefined)` 取得選填防護，然後呼叫 `ctx.fs.writeText(target, content, intent)`，再發出 `fs/observed`。（0 次 stat。）
- **edit**：呼叫 `ctx.waterfall('fs/edit-intent', target, exec, () => undefined)` 取得選填防護，然後呼叫 `ctx.fs.editText(target, edit, intent)`，再發出 `fs/observed`。（0 次 stat。）

工具在每次分派中把 `exec`（工具執行上下文）作為不透明 `actor` 傳入。默認 thunk 返回 `undefined`（不受約束的裸提供方）。載入 `@deepseek-ai/dsh-fs-observation-policy` 後，它會佔用單個決策槽：返回 `createIfAbsent`/`replaceIfVersion`/`{ version }` 或拋出 `FS_NOT_OBSERVED`，並在 `fs/observed` 時記錄。後端錯誤（`FsError`）和拋出的 `FS_NOT_OBSERVED` 會流經 `ToolRuntime.execute()`，變成 `isError` 工具結果，並附帶 `{ name, code }`。

當 `ctx.fs.sandboxMode` 表明提供方施加沙盒限制時，write/edit 會公開 `sandbox_permissions` 與 `justification`，並透過 `ctx.approval` 處理獲批後的重試。策略歸屬方會貢獻與具體能力無關的常駐策略；工具結果仍保留針對具體操作的拒絕與重試引導。

## `fs/observed` 發後即忘

`fs/observed` 在 read/read_image/write/edit 已經成功之後，透過普通 `ctx.emit` 寄出。監聽器的約定是同步且只有副作用的記錄器（`@deepseek-ai/dsh-fs-observation-policy` 使用 `WeakMap.set`）；工具不保護這次寄出，因此監聽器拋出會作為工具的 `isError` 結果出現。非同步或可能失敗的觀察不屬於該事件。

`read` 允許並行調度，因為它唯一會改變狀態的操作是同步記錄版本。稍後的 `write` 或 `edit` 會在目標鎖內重新檢查版本，因此即使記錄器發生競態，系統也會安全地拒絕操作；兩個變更工具仍保持互斥。見[平行工具呼叫 Agent Note](../../../.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.md)。

包根目錄只匯出 Cordis 外掛程式約定（`name`、`inject`、`Config` 和 `apply`）。讀取渲染（行視窗與輸出格式化）位於 `src/read-render.ts`（不相依性 Cordis，單獨進行單元測試）；`src/read.ts`/`read-image.ts`/`write.ts`/`edit.ts` 是工具執行器，`src/index.ts` 負責組合。

## 模型體驗

### 系統提示詞

#### 模型看到的內容

該外掛程式註冊作用域內的每個請求都會收到下方獨立註冊的 read、write 與 edit 指導。作用域工具限制可以隱藏 schema，而不移除這些段。

##### Read 指導

```markdown
Use the read tool — not shell commands like cat — to inspect text files. Results include line numbers. Use offset and limit to continue reading large files.
```

##### Write 指導

```markdown
Use the write tool to create files or completely replace file contents. Existing files are overwritten, so read an existing file first (the default fs-observation-policy requires it) and prefer edit for targeted changes.
```

##### Edit 指導

```markdown
Use the edit tool for targeted changes to existing UTF-8 text files. It replaces literal old_string with new_string; by default old_string must appear exactly once. If old_string appears multiple times, provide a more specific old_string or set replace_all to true. Read the file first (the default fs-observation-policy requires it), unless you just created or edited it in this session.
```

#### Token 影響

外掛程式啟用期間，每個請求付款固定指導成本；即使限制隱藏了一個或多個工具也一樣。

#### KV Cache 影響

只要外掛程式作用域和指導文字不變，前綴就保持穩定。工具限制不會移除該段，但外掛程式啟用或 dispose（資源釋放）可能從該段開始使複用失效。

### 工具 schema

#### 模型看到的內容

模型會看到已生成的 [`read`、`read_image`、`write` 和 `edit` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-fs)，參數使用 snake_case。`read_image` 只在持久附件儲存已掛載時出現；schema 本身與路由無關，嚴格閘門在執行時拒絕。作用域工具限制可以為某個 agent 移除任一定義。

#### Token 影響

該工具檢視表中的每個請求都付款固定 schema 成本。

#### KV Cache 影響

只要可見工具定義和順序不變，前綴就保持穩定。註冊生命週期或作用域限制可能從首個變化的 schema token 開始使複用失效。

### 讀取結果

#### 模型看到的內容

成功讀取結果精確為 `<path><displayPath></path>`、換行、`<type>file</type>`、換行、`<content>`、形如 `<lineNumber>: <text>` 的編號行、一個空行、一條 footer 和 `</content>`。footer 精確為 `(Output capped. Showing lines <start>-<end>. Use offset=<next> to continue.)`、`(Showing lines <start>-<end> of <total>. Use offset=<next> to continue.)` 或 `(End of file - total <total> lines)`。長行結尾精確為 `... (line truncated to <max> chars)`。讀取缺失目標仍返回 `FS_NOT_FOUND`，但會為呼叫工作階段記錄確認缺失；外部刪除的文件被重新讀取後，重試的 `write` 可以透過提供方的不替換防護安全地重新建立該文件。

#### Token 影響

讀取輸出受 `readLimit`、`readMaxLineLength` 和 `readMaxBytes` 限制；保留的呼叫與結果會反覆傳送，直到上下文壓縮（compaction）。

#### KV Cache 影響

僅附加；新增可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

### 影像讀取結果

#### 模型看到的內容

成功的 `read_image` 返回 `<path><displayPath></path>`、`<type>image</type>` 和寫明媒體類型、尺寸與位元組數的 `<content>` 信封，隨後是作為原生影像塊的影像本身。工作階段日誌只儲存持久的 `sha256:` 附件引用；路由到的提供方在每次請求時重新讀取並校驗位元組摘要。

#### Token 影響

影像在之後每次請求中都會計費，直到壓縮。每次呼叫都獨立受附件儲存的 `maxImageBytes`/`maxImagePixels` 約束；重複成功呼叫會在歷史中累積，內容尋址只去重儲存的位元組，不去重每次請求的 token 成本。

#### KV Cache 影響

僅附加；新可見內容跟在可複用請求前綴之後，不會使既有 KV 快取條目失效。

### 寫入與編輯結果

#### 模型看到的內容

寫入精確返回五行包絡：`<path><displayPath></path>`、`<type>file</type>`、`<content>`、`Created file` 或 `Updated file`，以及 `</content>`。編輯精確返回 `The file <displayPath> has been updated successfully.`；對於 `replace_all`，精確返回 `The file <displayPath> has been updated. All occurrences were successfully replaced.`。完整寫入或替換文字仍保留在 assistant 工具呼叫參數中。

#### Token 影響

成功文字很少，但大型變更參數和所有結果會反覆傳送，直到上下文壓縮。

#### KV Cache 影響

僅附加；新增可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

### 工具錯誤

#### 模型看到的內容

失敗會規範化為 `Error: <message>`。本包穩定的校驗和讀取消息是 `file_path must be a non-empty string`、`limit must be less than or equal to <max>`、`old_string must be a non-empty string`、`old_string and new_string must differ`、`cannot read "<path>": not found`、`cannot read "<path>": not a regular file`、`offset <offset> is out of range for "<path>" (<total> lines)`、`cannot read "<path>": read_image only accepts PNG/JPEG/WebP/GIF paths`、`cannot read "<path>" as an image: model "<model>" does not declare image input; switch to an image-capable model to read images`，以及類型不匹配的修復訊息 `cannot read "<path>": the <ext> extension declares <type>, but the bytes use a different image format; rename the file to match its actual format if it is PNG/JPEG/WebP/GIF, or convert it to one of those formats`；提供方和策略範本在各自包的 README 中逐字列出。防護變更失敗還會在訊息中攜帶復原指令，由本包面向模型的錯誤包裝追加：`FS_STALE_VERSION` 追加 `— re-read the file, then retry`，`FS_NOT_OBSERVED` 追加 `— read the file, then retry`；結構化錯誤碼保持不變。該次重新讀取確認缺失後，edit 會報告 `FS_NOT_FOUND`，而不會重複過時復原指令；write 則使用帶防護的建立。

#### Token 影響

只有失敗呼叫會新增這些保留 token。

#### KV Cache 影響

僅附加；新增可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **未交付面向模型的目錄清單工具**：`ctx.fs.listDir` 服務於 skill（技能）發現等提供方程式碼，同級 [`dsh-tool-fs-search`](../tool-fs-search/) 包則提供基於 ripgrep 的 `glob` 與 `grep`，而不是擴充檔案系統 seam。
- **`read` 只處理 UTF-8 文字文件**：影像使用獨立的、按擴充名路由的 `read_image` 工具；PDF、音訊和影片仍延期處理。目錄目標為 `FS_NOT_REGULAR_FILE`。
- **路由閘門與並行模型切換存在競態**：`read_image` 在執行時檢查最新路由的模型；在該檢查與下一次請求之間提交的切換，可能讓影像塊落在拒絕影像內容的路由上。Web 宿主已拒絕把含影像的工作階段切到純文字模型；其他前端擁有各自的等價防護。
- **媒體類型按擴充名聲明**：擴充名選擇聲明類型，附件儲存的魔數校驗保持權威；擴充名錯誤但格式正確的影像會得到改名修復提示，而不是被嗅探接受。
- **工具結果卡片沒有內嵌影像預覽**：UI 表面以通用形式渲染影像結果（持久引用而非畫素）；內嵌渲染延後到 UI 包處理。
- **沒有逾時介面**：`read`/`write`/`edit` 不接受逾時參數，也不聲明 `timeout-policy` 預算；取消只透過 `exec.signal` 傳遞（見[提供方理由](../README.md#no-timeouts-on-file-io)）。
