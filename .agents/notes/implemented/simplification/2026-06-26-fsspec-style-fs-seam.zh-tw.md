# Agent Note: 拆分檔案系統 seam——提供方文字變更操作與 `dsh-fs-observation-policy` 外掛程式

Status: implemented

[English](2026-06-26-fsspec-style-fs-seam.md) | [简体中文](2026-06-26-fsspec-style-fs-seam.zh.md) | 繁體中文

## 問題

[檔案系統能力 seam](../architecture/2026-06-17-filesystem-capability-seam.md)中的檔案系統能力目前讓一個抽象 `FileSystem` 服務同時負責兩項不同工作：

1. **提供方操作**——解析目標、stat/版本元資料、文字讀取/流式讀取、原子寫入，以及受保護的字面編輯。
2. **面向 agent（代理）的策略**——行視窗、字面編輯語義，以及讀後寫/編輯的觀測狀態。

這導致每個未來的後端都要重新實作面向模型的讀取語義和觀測策略。`readPage` 返回帶行號的行和檢視表元資料；基礎服務按 owner 儲存文件狀態，並區分 `full` 與 `partial` 讀取。這些是有用的策略，但它們不是檔案系統提供方的原語。字面文字變更則不同：版本守衛、字面匹配、歧義偵測與原子重寫必須留在提供方的變更邊界內，但當前的 `applyEdit` 命名及其周圍的 seam 將這一提供方操作綁定到了舊的讀後編輯策略形狀上。

這還造成了一個真實的使用者體驗死衚衕：視窗化讀取記錄 `view: partial`，而 partial 檢視表無法授權 `edit`。一個模型讀取了大文件的第 100-150 行，如果想編輯第 120 行，就必須先取得一次 `full` 讀取，而對於超過讀取上限的文件這可能做不到。字面編輯實際上只需要新鮮度：被匹配的位元組仍然來自模型所讀取的那個版本即可。

舊 Agent Note 已經推遲了獨立的 `@deepseek-ai/dsh-fs-observation-policy` 包。本決策建置該層，使 `ctx.fs` 保持接近 fsspec 風格的儲存原語（`info`/`cat`/`open`），但不把它變成完整的 fsspec。

## 決策

將棧拆為四層：

```text
tool          dsh-tool-fs       model-facing schemas + read windowing + text rendering; the EXECUTOR (reads/writes/edits via ctx.fs, dispatches the fs/* events)
policy        dsh-fs-observation-policy  observed-state + read-before-edit + write/edit freshness, contributed through the fs/* event gate (no service)
provider contract dsh-fs            ctx.fs: text IO + atomic mutation primitives (optional version guard)
provider      dsh-fs-local      local implementation of ctx.fs
```

`dsh-tool-fs` 保持相同的面向模型的 `read`/`write`/`edit` schema。它是執行器：注入 `fs`（不是策略服務）並直接訪問 `ctx.fs`，擁有讀取視窗化邏輯，並分發 `fs/*` 事件以便 `dsh-fs-observation-policy` 進行門控和記錄。

本 Agent Note 決定了四層拆分、提供方約定和新鮮度策略。隨後，[事件閘門 Agent Note](../architecture/2026-06-26-file-context-as-event-gate.md) 細化了工具↔策略耦合：`dsh-fs-observation-policy` 是透過 `fs/*` 事件參與的閘門外掛程式，而非 `ctx.fileContext` 方法服務，因此工具不會在方法層與其耦合；讀取視窗和 fs I/O 位於 `dsh-tool-fs`。本文描述已經落地的事件閘門形狀；提供方的版本守衛選填（省略即無條件裸提供方）。

## 提供方約定

`@deepseek-ai/dsh-fs` 收縮為提供方文字 IO 加受保護的文字變更：

```ts ignore-check
abstract resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>
abstract stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>
abstract readText(target: FsTarget, signal?: AbortSignal): Promise<string>
abstract streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>>
abstract writeText(target: FsTarget, content: string, expected: FsWriteIntent, signal?: AbortSignal): Promise<FsWriteOutcome>
abstract editText(target: FsTarget, edit: FsEditRequest, expected: { version: FsVersion }, signal?: AbortSignal): Promise<FsEditOutcome>

interface FsInfo {
  version: FsVersion
  type: 'file' | 'directory' | 'other'
  size?: number
}

type FsWriteIntent =
  | { kind: 'createIfAbsent' }
  | { kind: 'replaceIfVersion'; version: FsVersion }
```

`stat` 返回元資料而非內容。`version` 是新鮮度權杖；`type` 讓執行器在學取前拒絕目錄/特殊文件；`size` 讓 `read` 工具無需透過失敗探測即選填擇 `readText` 還是 `streamText`。`undefined` 表示目標不存在。

`readText` 讀取整個普通文字文件。`streamText` 以相同的文字語義流式讀取大文件。兩個提供方原語負責普通文件檢查、UTF-8 解碼、二進位/NUL 拒絕以及 `FS_NOT_TEXT`；策略層從不處理原始位元組，也不重新實作跨區塊解碼。`readText` 是小文件/直接全文件原語，而面向模型的大文件讀取使用 `streamText`。

`writeText` 透過暫存檔 + rename 實作原子寫入，並帶有顯式的寫入期望。`createIfAbsent` 建立不存在的目標，對已存在的目標以 `FS_NOT_OBSERVED` 拒絕；這是 owner 沒有先前讀取時使用的路徑。`replaceIfVersion` 僅在目標以觀測到的版本存在時替換；目標不存在或版本不匹配時拋出 `FS_STALE_VERSION`。

`editText` 是提供方等級的受保護文字變更。啟用守衛時，它首先驗證目標仍以 `expected.version` 存在，然後讀取當前文字、應用字面替換並原子寫入。過時檢查必須在字面匹配之前發生，這樣基於舊讀取的編輯會報告 `FS_STALE_VERSION`，而不是對更新內容進行匹配後報告 `FS_EDIT_NOT_FOUND` 或 `FS_AMBIGUOUS_EDIT`。將此原語保留在提供方約定上，保持了後端本機鎖定的能力，也讓未來的遠端後端能夠實作原生的 compare-and-edit，而無需策略層拉取整個文件。

這是一個*文字儲存* seam，刻意比位元組級 fsspec（`cat`/`open` 返回原始位元組）高半個層次。UTF-8 解碼、二進位/NUL 拒絕、受保護的全文件寫入和受保護的字面文字編輯都在提供方內完成，因此策略層從不接觸原始位元組、不重新實作跨區塊解碼、也不將過時檢查與變更臨界區分離。面向模型的概念仍然不下沉到提供方：行視窗、帶行號的行、渲染的頁腳、觀測狀態儲存都不會洩漏下去。

從 `dsh-fs` 刪除：`readPage`、`FsExpectation`、`FsView`、`FsStateSource`、`FsReadRequest`、`FsTextLine`、行/視窗常數、`formatReadBody` 和 observed-state `WeakMap`。`applyEdit` 由更窄的提供方原語 `editText` 取代，其約定是帶版本守衛的字面文字變更，而非策略層讀取授權。`FS_PARTIAL_OBSERVATION` 錯誤碼也從 `FsErrorCode` 分類體系中移除：新鮮度授權沒有部分/完整之分，因此沒有任何路徑會拋出它。`FsTargetKey` 和 `FsVersion` 按現有[品牌化 id Agent Note](../architecture/2026-06-20-branded-ids.md) 成為品牌化不透明 id。

## 策略約定

`@deepseek-ai/dsh-fs-observation-policy` 是外掛程式，而非服務：它不註冊任何 `ctx.*` 鍵，也不注入任何內容。它擁有不應位於 `FileSystem` 提供方基類上的寫入/編輯新鮮度策略和 observed state（否則沙盒/遠端後端會繼承不該由其承載的面向模型觀察策略）。它透過執行器分派的 `fs/*` 事件閘門貢獻該策略。

觀測狀態以 `WeakMap<owner, Map<targetKey, FsVersion>>` 的形式存放於此。當且僅當 owner 讀取、寫入或編輯過該目標時，條目才存在（每次成功都會發出 `fs/observed`），因此條目的存在*本身就是*先前觀測的記錄——沒有單獨的 `hasRead` 標志。owner 從不透明的事件 actor（`{ agent?: { session? } }`）結構化派生，該形狀定義在 `dsh-fs-observation-policy` 中而非 `dsh-fs` 中。

該外掛程式決定三個 `fs/*` 事件：

- `fs/write-intent`——無先前觀測 ⇒ `{ kind: 'createIfAbsent' }`（只有新文件可以盲建立）；有先前觀測 ⇒ `{ kind: 'replaceIfVersion', version: vObserved }`（已有文件僅在自觀測以來未變時才替換）。單槽決策；不呼叫 `next()`。
- `fs/edit-intent`——要求 owner 有先前觀測（否則 `FS_NOT_OBSERVED`）；返回 `{ version: vObserved }` 作為 CAS 基礎。它不實作字面替換——它授權並提供版本，提供方的變更臨界區負責應用守衛，因此基於同一觀測版本的並行編輯仍然是一個成功，另一個因版本過時而失敗。
- `fs/observed`——在成功的讀取/寫入/編輯後，為該 owner+target 記錄 `{ version }`。同步、僅副作用的 `WeakMap.set`。

該外掛程式不做任何檔案系統 I/O：「你是否觀測過此文件？」是一次 `WeakMap` 尋找，而「你讀取的版本是否仍然是當前版本？」在 `ctx.fs.editText`/`writeText` 內部、與執行變更相同的原子鎖中決定——外掛程式只提供 `vObserved` 作為基礎。

## 工具約定

`dsh-tool-fs` 保持相同的 schema 和提示詞表面。`read` 仍然暴露 `file_path`、`offset` 和 `limit`；`write` 和 `edit` 不變。它是執行器：驗證模型參數，透過 `ctx.fs` 直接讀取/寫入/編輯，擁有行視窗化和結果渲染（`N: text`、頁腳、`<path>/<content>` 封裝），並分發 `fs/*` 事件。

每個變更操作先分發其 intent waterfall（瀑布式事件），帶有 `undefined` 裸提供方預設值，然後呼叫 `ctx.fs`，再發出 `fs/observed`。例如 `write` 執行 `ctx.waterfall('fs/write-intent', target, exec, () => undefined)` → `ctx.fs.writeText(target, content, intent)` → `ctx.emit('fs/observed', …)`。`read` 先 stat 一次，然後讀取/流式讀取，建置視窗，最後寄出 `fs/observed`。將 `exec` 作為 actor 傳遞，讓 `dsh-fs-observation-policy` 無需工具深入策略即可派生 owner。

由於策略透過帶有 `undefined` 預設值的事件貢獻，`dsh-tool-fs` 不與 `dsh-fs-observation-policy` 產生方法耦合：在外掛程式缺席時，每個 intent waterfall 都落到 `undefined`（無條件裸提供方寫入/編輯），`fs/observed` 沒有監聽器。載入外掛程式後即可疊加讀後寫/編輯策略。

## 並行邊界

行程內更新是安全的：本機後端保持既有的按目標變更鎖，因此版本檢查-然後-rename 是序列化的，失敗的更新會看到 `FS_STALE_VERSION`。

行程內建立由同一個按目標變更鎖保護：兩個呼叫者以 `createIfAbsent` 競爭時序列化，一個建立成功，另一個看到目標已存在並收到 `FS_NOT_OBSERVED`。跨行程建立僅為盡力而為；本機的 stat-then-rename 守衛無法在所有未來後端上提供可移植的排他建立保證。

跨行程寫入是盡力而為的新鮮度加原子替換：`mtime:size` 通常能捕獲編輯器保存，但可能偵測不到同一 tick 內大小相同的寫入；原子的 temp+rename 防止文件撕裂但不能防止所有丟失更新。

## 取代

本 Agent Note 推翻[檔案系統能力 seam](../architecture/2026-06-17-filesystem-capability-seam.md)中的兩項決策，並收窄第三項：

- 讀後寫/編輯策略從 `ctx.fs` 移出，進入 `dsh-fs-observation-policy` 外掛程式（透過 `fs/*` 事件門控）。
- 文字讀取不再返回後端編號的行記錄或 `full`/`partial` 檢視表；授權基於版本新鮮度，因此視窗化讀取在文件未變時即可授權編輯。
- 字面編輯不再位於舊的 `applyEdit` API 之後（該 API 混合了後端變更與 seam 擁有的觀測策略）。它作為 `editText` 保留為提供方原語，因為版本守衛 + 字面匹配 + 原子重寫必須留在提供方的變更臨界區內。

保留的內容：Service Definition / Service Provider / Consumer 紀律、消費端不匯入後端規則、後端定義的 target/version/display 元資料、原子本機寫入，以及共享的 `FsError` 分類體系。

## 驗證

`dsh-fs` 精確暴露 `resolve`/`stat`/`readText`/`streamText`/`writeText`/`editText`（`stat` 返回 `FsInfo | undefined`，`writeText` 接受 `FsWriteIntent`），已刪除的類型/原語不再存在；`dsh-fs-local` 不包含行、檢視表或 `formatReadBody` 邏輯；面向模型的 schema 保持逐位元組不變。測試固定了以下行為：視窗化讀取授權對未變文件的後續編輯；基於過時讀取的編輯在嘗試字面匹配之前報告 `FS_STALE_VERSION`；版本 CAS 行為得以保留；觀測約定成立（`read` 工具的讀取記錄觀測狀態；直接 `ctx.fs` 讀取不記錄）；`dsh-fs-observation-policy` 具有 HMR（熱模組替換）/dispose（資源釋放）測試覆蓋。

## 後續擴充

後來，[為檔案系統 seam 新增直接目錄清單](../../archived/architecture/2026-07-03-filesystem-directory-listing-seam.md)進一步擴充了該 seam。該後續工作單獨記錄，使本文繼續描述最初落地的 fsspec 風格改造。

## 曾考慮的替代方案

- **位元組級 fsspec（`cat`/`open` 返回原始位元組）**：否決。該 seam 刻意定位為文字儲存，比位元組級高半個層次，這樣 UTF-8 解碼、二進位/NUL 拒絕和受保護的文字變更只在提供方實作一次，策略層從不接觸原始位元組，也不將過時檢查與變更臨界區分離。
- **具體的 `ctx.fileContext` 方法服務**——本 Agent Note 最初的策略形狀；[事件閘門 Agent Note](../architecture/2026-06-26-file-context-as-event-gate.md) 將其重做為閘門外掛程式，使工具永遠不會在方法層與策略耦合。
- **在提供方保留 `readPage` 和 `full`/`partial` 檢視表授權**：「取代」一節所逆轉的重構前形態。檢視表完整性不是編輯安全所需的，版本新鮮度纔是；而檢視表規則使超過讀取上限的大文件無法編輯。

## 後果

- 新增第四個 fs 包和一個新的外掛程式層。這是有意為之：它是此前推遲的策略層，而非第二個抽象後端約定。
- 直接使用 `ctx.fs` 會繞過策略：直接 `ctx.fs.readText` 不寄出 `fs/observed`，因此在默認策略下，後續 `edit` 會以 `FS_NOT_OBSERVED` 拒絕，直到透過 `read` 工具讀取該文件。這一失敗是顯式且有文件記錄的。
- 大文件行視窗化從後端移至 `dsh-tool-fs` 中的 `read` 工具；文字解碼和二進位拒絕留在 `ctx.fs.streamText` 中，因此這只是視窗化邏輯的遷移，而非第二套文字 IO 實作。
- 將 `editText` 保留在提供方約定上意味著每個後端都必須實作字面替換約定。這是有意為之：該操作不是純儲存，但過時守衛 + 字面匹配 + 原子重寫是必須保持在一起的單元，以確保正確的錯誤歸因和並行行為。該約定應保持窄且僅限文字，以便未來後端可以原生實作或透過全文件重寫實作。
- 新鮮度允許在視窗化讀取後進行全文件 `write`。這比舊的檢視表檢查更弱，但避免了大文件無法編輯的問題；提示詞引導仍然不鼓勵盲目的全文件替換。
