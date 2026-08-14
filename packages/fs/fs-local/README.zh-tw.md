# @deepseek-ai/dsh-fs-local

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

`ctx.fs` 提供方約定（[`@deepseek-ai/dsh-fs`](../fs)）的**本機檔案系統實作**。它使用宿主檔案系統支持十二個 `FileSystem` 原語；將其作為外掛程式載入會填充 `ctx.fs`。

```ts ignore-check
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'

await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
// ctx.fs uses the local backend; load @deepseek-ai/dsh-fs-observation-policy for the
// freshness policy gate and @deepseek-ai/dsh-tool-fs to expose read/write/edit.
```

## 行為

- **`resolve(path, opts?)`**：相對 `path` 在呼叫方提供 `opts.cwd` 時以該值為基準解析（面向模型的工具會傳入呼叫 agent（代理）的工作階段 cwd；見[每工作階段 cwd Agent Note](../../../.agents/notes/implemented/architecture/2026-07-02-fs-per-session-cwd.md)），否則以 `config.cwd` 為基準（默認 `process.cwd()`）；絕對 `path` 會忽略兩者。`opts.signal` 會在本機解析前後檢查，遠端同級後端則可以用它中止往返。`targetKey` 是文件的 `realpath`，因此經符號連結到達同一文件的兩個輸入路徑會共享一個身份，寫入/編輯落在連結目標上，同時保留連結。尚不存在的路徑在父目錄存在時使用 realpath 後的父目錄加 basename；只有父目錄無法解析時纔回退到絕對路徑。`displayPath` 是絕對但未經解析的路徑。
- **執行世界坐標**：`processPath` 公開目標的規範化宿主路徑，`fileUrl` 透過 Node 的平臺感知 URL 轉換對該路徑編碼，`contains` 則使用平臺路徑語義檢查身份相等或後代包含關係，消費端無需解析 `targetKey`。
- **`stat` / `lstat`**：返回目標元資料；目標不存在時返回 `undefined`。`stat` 為已解析目標報告 `FsInfo`（`version` 是由 bigint `dev:ino:size:mtimeNs:ctimeNs` 派生的不透明 token，`type` 為 `file`/`directory`/`other`，`size` 以位元組計）；路徑形態的 `lstat` 不跟隨最後一個符號連結，報告 `FsPathInfo`，因此可以返回 `symlink`。兩者都會在非同步元資料探測前後檢查取消，因此非同步探測進行期間發生的中止會報告 `FS_ABORTED`，而非過時的不存在結果。
- **`readText` / `streamText`**：只支持 UTF-8。`readText` 讀取整個文件；`streamText` 按區塊解碼，因此超大文件無需整體保存在記憶體中，消費端也可以自行限制保留量。兩者都會拒絕無效 UTF-8、包含 NUL 位元組的二進位樣本（`FS_NOT_TEXT`）以及非普通文件目標。`read` 工具（`@deepseek-ai/dsh-tool-fs`）擁有行視窗邏輯。
- **`readBytes`**：按原始位元組讀取整個文件，不做解碼或二進位拒絕（`read_image` 工具透過附件服務校驗內容）。必填的位元組上限在任何內容 I/O 之前先按 stat 大小短路；隨後的流最多多讀一個位元組，因此 stat 之後成長的文件仍會以 `FS_TOO_LARGE` 失敗，不會無界緩衝。
- **`listDir`**：按穩定的 `name.localeCompare()` 順序列出一層目錄。每個條目攜帶子項 basename、類型、解析後的子目標（`displayPath` 位於所列目錄下，`targetKey` 是 realpath 身份）和低成本 stat 元資料（`version`，普通文件另有 `size`）。它絕不會打開或解碼文件內容。缺失目標報告 `FS_NOT_FOUND`，文件/特殊文件目標報告 `FS_NOT_DIRECTORY`，已中止呼叫報告 `FS_ABORTED`，權限失敗報告 `FS_PERMISSION_DENIED`，其他列出或子項元資料 I/O 失敗報告 `FS_IO_ERROR`。損壞/消失的子項以無元資料的 `other` 返回，但解析子項時出現權限/I/O 失敗會讓整個清單以結構化 `FsError` 失敗。
- **`writeText`**：原子寫入。它會向排他打開的暫存檔（`wx`、`0o600`）寫入；該文件位於目標旁隨機命名的私有暫存目錄（`0o700`）內，隨後執行 fsync 並行布。現有文件的 mode 會保留，新文件預設為 `0o600`；Windows 上的新文件繼承目標目錄的 DACL，而替換會在寫入前把目標 DACL 複製到空暫存檔，並透過 `ReplaceFileW` 發布，使原訪問策略得以保留（見 [Windows DACL 保留 Agent Note](../../../.agents/notes/implemented/bug-fix/2026-07-19-windows-atomic-write-dacl-preservation.md)）。`expected` 防護是選填的：省略時無條件建立或覆蓋；`createIfAbsent` 透過硬連結把暫存文件發布到目標位置，以實作原子且不替換的發布，因此初始探測後建立的普通文件會被保留，並以 `FS_NOT_OBSERVED` 拒絕本次寫入；非普通路徑條目也會被保留，並以 `FS_NOT_REGULAR_FILE` 拒絕；`replaceIfVersion` 只在觀察到的版本上替換（目標缺失或版本不匹配均為 `FS_STALE_VERSION`）。僅當打開後的舊文件和 UTF-8 替換內容都嚴格低於 `config.diffBasisMaxBytes`（默認 10 MiB）時，覆寫才返回舊文字作為上下文 diff 基礎。即使外部寫入方在初次探測後替換文件或改變檔案大小，文件描述符讀取仍會強制執行該上限；否則提供方返回 `before: null`，由展示層使用整文件回退。
- **`editText`**：在同一原語之上依次執行原子的字面量讀取、修改和寫入，並透過變更鎖按目標序列化。`expected` 防護是選填的：提供時，會在字面量匹配之前校驗版本（過時編輯報告 `FS_STALE_VERSION`，絕不會針對較新內容報告 `FS_EDIT_NOT_FOUND`/`FS_AMBIGUOUS_EDIT`）；省略時，無條件編輯當前內容。無論哪種情況，目標缺失都報告 `FS_STALE_VERSION`。匹配時規範化為 LF，隨後復原文件主要的 CRLF/LF 風格；空 `oldString` / 零匹配報告 `FS_EDIT_NOT_FOUND`，未設定 `replace_all` 的多個匹配則報告 `FS_AMBIGUOUS_EDIT`。

包根 SDK 介面包含默認/具名 `LocalFileSystem` 類和 `Config`。原始 I/O 位於 `src/fsio.ts`（不相依性 Cordis，單獨進行單元測試）；`src/index.ts` 是輕量服務接線。

## 模型體驗

透過 [`dsh-tool-fs`](../tool-fs/README.md) 間接產生影響；該消費端把本提供方帶行視窗的 UTF-8 內容、變更確認和提供方訊息原文渲染為有保留上限的結果，而版本、原子寫入機制和目錄元資料仍屬內部細節。

#### KV Cache 影響

不會直接使快取失效；具名消費端負責請求前綴的任何變化。

## 已知限制與延期工作

- **`config.cwd` 不是沙盒**：它是解析預設值，而非約束；絕對路徑和 `..` 可以逃逸。請使用更嚴格的 `ctx.fs` 後端或 `tools/execute` waterfall（瀑布式事件）上的權限外掛程式實施約束（見[能力 seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-17-filesystem-capability-seam.md#consequences)）。
- **版本 token 相依性檔案系統元資料**：它們組合設備、inode、大小、納秒級 mtime 和納秒級 ctime；如果儲存層在重寫時無法更新其中任何一項事實，仍可能繞過過時防護。
- **`editText` 會把整個文件及編輯後的副本保存在記憶體中**：只有讀取路徑支持流式處理。
- **低於上限的覆寫仍會緩衝上下文基礎**：`writeText` 除呼叫方持有的替換內容外，最多還會保留略低於 `config.diffBasisMaxBytes` 的舊文字；該上限不限制返回的 `after` 值，也不限制展示層的整文件回退。
- **二進位偵測不對稱**：讀取只對前 8192 位元組執行 NUL 取樣，編輯則掃描整個 buffer，因此 NUL 出現在後部的文件可以讀取，但編輯會被拒絕。
- **每目標變更鎖僅限行程內**：即使跨行程，帶防護的建立仍採用原子且不替換的發布方式；但只有當可選版本防護觀察到元資料變化時，系統才能發現其他行程中的替換寫入方，且絕不會將其序列化。
- **帶防護的建立要求支持硬連結**：拒絕硬連結發布的檔案系統或掛載點無法支持 `createIfAbsent`；提供方會使目標保持缺失狀態並報告 `FS_IO_ERROR`。
- **提交後清理採用盡力而為語義**：如果移除僅所有者可訪問的暫存目錄失敗，成功發布仍視為成功，並留下私有殘留供運維人員後續清理。
