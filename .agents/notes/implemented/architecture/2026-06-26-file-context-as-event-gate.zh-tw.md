# Agent Note: 將 `dsh-fs-observation-policy` 改為事件閘門外掛程式，而非方法介面

Status: implemented

[English](2026-06-26-file-context-as-event-gate.md) | [简体中文](2026-06-26-file-context-as-event-gate.zh.md) | 繁體中文

## 問題

[拆分檔案系統 seam Agent Note](../simplification/2026-06-26-fsspec-style-fs-seam.md) 在面向模型的工具與 `ctx.fs` 提供方之間放置了 `ctx.fileContext`：`dsh-tool-fs` 注入 `fileContext`，並將每次 `read`/`write`/`edit` 路由到它的方法。這使得 `fileContext` **位於關鍵路徑上且不可省略**。工具不經過它就無法訪問 `ctx.fs`，策略層掌控著 fs I/O 和讀取視窗，而一個不需要觀測狀態策略的部署也無法簡單地移除該包——`dsh-tool-fs` 會因無法解析 `ctx.fileContext` 而失敗。

這把三件本應可分離的事情耦合在了一起：

1. **工具做什麼**——解析路徑、讀取視窗、寫入/編輯文件。這是工具的職責，只需要 `ctx.fs`。
2. **新鮮度/觀測策略**——「編輯前必須先讀」、「寫入/編輯必須基於你讀到的版本」。這是 `dsh-fs-observation-policy` 外掛程式的職責。
3. **觀測狀態的記錄**——一個副作用，永遠不應阻止工具正常執行。

由於工具呼叫的是 `fileContext` 方法，移除策略層就是一個破壞性變更，而非優雅地失去一個*附加*能力。策略層對工具的執行是承重性的，而非選填的收緊。

## 決策

反轉控制流。**`dsh-tool-fs` 成為執行器，直接呼叫 `ctx.fs`**；**`dsh-fs-observation-policy` 成為門控 + 記錄外掛程式**，透過事件參與，從不透過工具呼叫的方法，也不註冊 `ctx.fileContext` 服務。

```text
tool          dsh-tool-fs       executor: resolves, reads windows, writes/edits via ctx.fs;
                                emits fs policy events; renders results
policy        dsh-fs-observation-policy  plugin: listens to fs/write-intent +
                                fs/edit-intent (single-slot waterfall) and fs/observed
                                (emit) events; adds observed-state + freshness.
provider contract dsh-fs            ctx.fs: text IO + ATOMIC mutation primitives whose version
                                guard is OPTIONAL; owns the fs policy event vocabulary
provider      dsh-fs-local      local implementation of ctx.fs
```

該模型是疊加式的：裸 `ctx.fs` 執行原子化、無約束的文字 I/O，而 `dsh-fs-observation-policy` 疊加觀測狀態、先讀後編輯和版本守衛。因此移除策略層後工具仍可用，只是不受約束。正式發布的 agent（代理）設定會載入策略；裸模式的存在是為了讓策略在服務邊界保持選填，而非作為正常部署姿態。

[檔案系統缺失觀測後續決策](../bug-fix/2026-08-09-filesystem-absence-observation.md)把記錄載荷從僅表示成功的版本細化為顯式的存在/缺失狀態，並要求帶防護的建立以不替換方式發布。事件門控歸屬與無 I/O 策略邊界保持不變。

`dsh-tool-fs` 不再注入 `fileContext`。它注入 `fs` 和 `tools`/`systemPrompt`。

## 策略由提供方 CAS 強制執行，而非 `dsh-fs-observation-policy` 的 stat

`dsh-fs-observation-policy` 強制執行「你必須基於你讀到的版本來寫入/編輯」，**自身從不呼叫 `stat` 或比較版本**。它將觀測到的版本作為 CAS 基準提供，讓提供方的 mutation 臨界區偵測過時性：

- 「該所有者最近觀測到了什麼？」是 `dsh-fs-observation-policy` 在本機決定的唯一事項——一次 `WeakMap` 尋找，無 I/O。無記錄表示未見；缺失記錄只允許帶防護的建立；存在記錄攜帶替換/編輯基準。
- 「版本是否仍然有效，或者建立目標是否仍然缺失？」由**提供方的原子變更邊界內部**決定。`dsh-fs-observation-policy` 提供 `replaceIfVersion` 或 `createIfAbsent`；對於已經變化的版本，提供方拋出 `FS_STALE_VERSION`；帶防護的建立若敗給另一個建立者，則拋出 `FS_NOT_OBSERVED`。

這是有意為之的。如果 `dsh-fs-observation-policy` 在其 waterfall（瀑布式事件）處理器中 stat 並比較版本，該檢查與工具實際寫入之間會存在 TOCTOU 間隙——文件可能在此期間變化，因此該檢查只是一個虛假保證，提供方的鎖無論如何都要兜底。將版本檢查放在提供方的臨界區中既無競態又無額外 `stat`。所以 `dsh-fs-observation-policy` **不做**任何檔案系統 I/O；「必須基於最近一次讀取」的保證由 CAS *實作*，`dsh-fs-observation-policy` 只負責選擇基準（`vObserved`）並對先前觀測進行門控。

## 提供方約定變更：版本守衛變為選填

為使裸提供方不受約束，其兩個 mutation 上的版本守衛變為**選填**——傳入則守衛，省略則無條件執行：

```ts ignore-check
// writeText: expected is now optional. The FsWriteIntent union is UNCHANGED.
writeText(target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal): Promise<FsWriteOutcome>
//   undefined          → unconditionally create-or-overwrite (bare default)
//   createIfAbsent     → create only, reject an existing file (dsh-fs-observation-policy, unobserved)   [unchanged]
//   replaceIfVersion   → overwrite only at the observed version, else FS_STALE_VERSION    [unchanged]

// editText: expected becomes optional (was the required { version: FsVersion }).
editText(target: FsTarget, edit: FsEditRequest, expected?: { version: FsVersion }, signal?: AbortSignal): Promise<FsEditOutcome>
//   undefined    → unconditionally replace literal text in the current content (bare default);
//                  a missing target still reports FS_STALE_VERSION
//   { version }  → edit only at that version, else FS_STALE_VERSION (the current behavior)
```

`FsWriteIntent` 聯合類型本身不變——第三種「無條件」狀態透過*省略* `expected` 來表達，因此兩個 mutation 共享同一種對稱形狀（`expected?`：省略 = 無守衛，傳入 = 有守衛）。這對 `dsh-fs-observation-policy` 使用的有守衛路徑保持完全向後相容；只有之前不可能出現的「無守衛」情況是新增的，且它是裸提供方的默認行為。無論哪種情況，mutation 仍在後端的 per-target 鎖內執行，因此無條件寫入/編輯仍是原子的（不會產生撕裂文件）；「無條件」去掉的是*版本*前置條件，而非原子性。`editText` 在有守衛和無守衛路徑上都將缺失目標報告為 `FS_STALE_VERSION`，保持一個統一的編輯失敗碼表示「此刻無法編輯該目標」。

## 事件詞彙（由 `dsh-fs` 擁有）

事件定義在 `@deepseek-ai/dsh-fs` 中，而非 `dsh-fs-observation-policy` 中。這是解耦約定所迫：`dsh-tool-fs` 是發射方，因此它必須引用事件類型，且即使 `dsh-fs-observation-policy` 不再提供方法服務，它也必須能編譯透過。`dsh-fs` 是 `dsh-tool-fs` 和 `dsh-fs-observation-policy` 都已相依性的包，因此它是唯一能讓發射方和策略監聽方共享詞彙而不讓發射方相依性策略外掛程式的歸屬地。

這些事件攜帶既有的 `dsh-fs` 詞彙（`FsTarget`、`FsVersion`、`FsObservation`、`FsWriteIntent`）加一個不透明的 actor——不攜帶面向模型的概念（行視窗、行號或渲染後的頁腳不會洩漏到此層）。

**兩個 `fs/*` 決策事件是單槽、先到先得的 waterfall。** `dsh-fs-observation-policy` 不呼叫 `next()` 直接返回，因此在默認部署中它佔據該槽位；更早註冊或使用 `prepend` 的監聽器會替代該策略。權限、審計和沙盒關注點仍留在可組合的 `tools/execute` waterfall 上。

actor 在 `dsh-fs` 中類型為 `object`——一個純粹的不透明載體，提供方約定從不讀取或收窄它。owner 的推導（`actor.agent?.session`）和 `{ agent?: { session? } }` 結構形狀完全留在 `dsh-fs-observation-policy` 內部，由其在監聽器中將 `object` actor 收窄為該形狀。`dsh-fs` 擁有事件名和 fs 詞彙；它不擁有策略層的執行時期 owner 結構。

```ts
import type { FsObservation, FsTarget, FsVersion, FsWriteIntent } from '@deepseek-ai/dsh-fs'

interface Events {
  /**
   * Single-slot decision: produce the write expectation for the next
   * ctx.fs.writeText. The default returns undefined (unconditional create-or-
   * overwrite — the bare provider). The policy listener returns createIfAbsent
   * (unobserved) or { kind: 'replaceIfVersion', version: vObserved } (observed).
   * The listener does NOT call next(): one decision, not a composable chain. @mode waterfall
   */
  'fs/write-intent'(target: FsTarget, actor: object | undefined, next: () => FsWriteIntent | undefined | Promise<FsWriteIntent | undefined>): Promise<FsWriteIntent | undefined>
  /**
   * Single-slot decision: produce the optional version guard for the next
   * ctx.fs.editText. The default returns undefined (unconditional edit of the
   * current content — the bare provider; no stat). The policy listener returns
   * { version: vObserved }, or throws FS_NOT_OBSERVED if the actor is unset or
   * has not observed the target. Does NOT call next(): one decision. @mode waterfall
   */
  'fs/edit-intent'(target: FsTarget, actor: object | undefined, next: () => { version: FsVersion } | undefined | Promise<{ version: FsVersion } | undefined>): Promise<{ version: FsVersion } | undefined>
  /**
   * Record that an actor observed a target as present at a version or absent.
   * Fire-and-forget (plain emit). Listeners MUST be
   * synchronous, side-effect-only recorders (`dsh-fs-observation-policy`'s is a WeakMap
   * write); the tool does not guard the emit, so a throwing listener surfaces as
   * the tool's isError result. No listener ⇒ nothing recorded.
   * @mode emit
   */
  'fs/observed'(target: FsTarget, observation: FsObservation, actor: object | undefined): void
}
```

`fs/*` 決策事件是**由工具分發的無綁定 waterfall**（類似 `agent/request`，由迴圈分發且無 `this`），而非服務綁定的 waterfall（如 `llm/stream`）。分發者是 `dsh-tool-fs` 外掛程式，它不是一個服務。

## 工具約定（`dsh-tool-fs`）

工具保留其面向模型的 schema（`read`/`write`/`edit`，逐位元組不變）和提示詞段落。提示詞引導仍以策略優先，因為載入 fs 工具的部署預期也會載入 `dsh-fs-observation-policy`：模型仍被告知在覆寫或編輯前先讀取，而該要求來自 fs-observation-policy 外掛程式，並非後端。裸提供方回退不改變提示詞立場。

`dsh-tool-fs` 獲得從舊 `fileContext` 方法服務遷移來的執行器職責，包括**讀取渲染**（`read-render.ts`：`buildWindow` + `formatReadOutput`、`READ_MAX_BYTES`、`READ_MAX_LINE_LENGTH`、`FileReadOutcome`/`FileTextLine`，以及 `read.ts` 中的 `STREAM_MIN_SIZE`），這些現在是工具的渲染細節，因為讀取已由工具擁有。這些讀取渲染類型和輔助函式移入 `dsh-tool-fs`；策略外掛程式不得繼續作為工具的類型相依性。

`dsh-tool-fs` 是一個註冊全部三個工具（`read`/`write`/`edit`）的單一根外掛程式，與 `dsh-tool-bash` 相同。它注入 `fs`（加 `tools`/`systemPrompt`），從不注入 `fileContext`。（最初的提案還將每個工具作為 `/read`/`/write`/`/edit` 子路徑外掛程式暴露，供聚焦部署使用；實作時被放棄——沒有消費端需要單工具部署，且子路徑發布迫使引入兄弟工具包都不需要的訂製 `tsdown`/`tsconfig`/`files`/workspace-constraint 處理。每工具的註冊輔助函式（`applyReadTool`/`applyWriteTool`/`applyEditTool`）仍作為根外掛程式組合的內部模組保留。）

透過讓 waterfall 惰性產出期望值來最小化 `stat` 預算——裸默認返回 `undefined`（無守衛），從不 stat：

- **read**——一次 `stat`；元資料未命中時，在返回 `FS_NOT_FOUND` 前 emit `{ kind: 'absent' }`；目標為文件時，則依次執行 `readText`/`streamText`、`buildWindow`，再 emit `{ kind: 'present', version: info.version }`。舊 `fileContext.read` 中讀後確認的 `stat` 仍保持移除；在路由 stat 和讀取之間競爭的寫入者最多隻能使後續帶防護的編輯誤報過時。
- **write**——`expectation = await ctx.waterfall('fs/write-intent', target, exec, () => undefined)`，然後 `ctx.fs.writeText(target, content, expectation)`，再 emit 表示存在的結果版本。無論是否有 `dsh-fs-observation-policy`，**工具內零 stat**。
- **edit**——`expectation = await ctx.waterfall('fs/edit-intent', target, exec, () => undefined)`，然後 `ctx.fs.editText(target, edit, expectation)`，再 emit 表示存在的結果版本。兩種情況下**工具內零 stat**：裸預設為 `undefined`（無條件編輯），因此工具從不 stat 來製造基準。如果裸路徑上的目標不存在，提供方報告 `FS_STALE_VERSION`；策略已持有缺失觀測時，則直接返回 `FS_NOT_FOUND`。

工具在每次分發時將 `exec`（工具執行上下文）作為 `actor` 參數傳入，以便 `dsh-fs-observation-policy` 推導其觀測狀態的 owner。工具不知道策略外掛程式是否存在：它始終在 `next` thunk 中提供裸默認行為，而 `dsh-fs-observation-policy` 在默認部署中會在 thunk 執行前短路它。

**`fs/observed` 在操作成功後，以及元資料探測確認缺失後觸發。** 其監聽器必須是同步、不拋例外的記錄器；工具不對 plain emit 做保護，因此拋例外的監聽器可能取代待返回的讀取錯誤，或在 mutation 已成功後報告失敗。非同步或可失敗的觀測需要另一份事件約定。

## 策略外掛程式約定（`dsh-fs-observation-policy`）

`dsh-fs-observation-policy` 是外掛程式，不是服務。它不註冊 `ctx.fileContext`，沒有公開方法面，不暴露 `read`/`write`/`edit`/`resolve` 方法。它透過 `ctx.on()` 註冊三個監聽器（每個返回一個 disposer 用於 HMR（熱模組替換））。它維護觀測狀態 `WeakMap<owner, Map<targetKey, FsObservation>>`，以及結構化的 owner 推導（將事件中不透明的 `object` actor 收窄為自己的 `{ agent?: { session? } }` 形狀），但不注入 `fs`——每個處理器只操作自己的 `WeakMap`，從不操作 `ctx.fs`。

- `fs/write-intent` 監聽器：未見/缺失 ⇒ `createIfAbsent`；存在 ⇒ `replaceIfVersion`。它不呼叫 `next()`：完全佔據單一決策槽位。
- `fs/edit-intent` 監聽器：未見 ⇒ `FS_NOT_OBSERVED`；缺失 ⇒ `FS_NOT_FOUND`；存在 ⇒ 返回其版本守衛。同樣不呼叫 `next()`。
- `fs/observed` 監聽器：記錄存在/缺失的可辨識值。

一條觀測狀態條目是**先前觀測記錄**，但其可辨識欄位會影響決策。成功的 read/write/edit 會記錄存在狀態及版本，使 create-then-edit 或 edit-then-edit 序列無需中間重新讀取即可工作。確認缺失的 read/view 會用缺失狀態取代舊的正向版本，因此只允許帶防護的建立；隨後成功的建立會再用新的存在版本取代缺失狀態。只有條目不存在才表示未見，並使 edit 返回 `FS_NOT_OBSERVED`。owner 從 `{ agent?: { session? } }` 結構化推導；dispose 時丟棄所有狀態（HMR 安全）。

`dsh-fs-observation-policy` 現在是一個純策略/記錄外掛程式，沒有服務 API——它只透過事件閘門影響外界。這正是移除 `dsh-tool-fs` 方法耦合的關鍵。

## 裸提供方行為（無 `dsh-fs-observation-policy`）

這不是預期的部署姿態——載入 fs 工具的設定預期也會載入 `dsh-fs-observation-policy`。它是工具不再耦合於策略方法服務後所存在的無約束提供方下限。當 `dsh-fs-observation-policy` 不存在時，每個 `fs/*` waterfall 落入其 `undefined` 預設值，`fs/observed` 無監聽器：

- **read** 行為不變（它從不需要策略；只是 emit 了一個現在無人監聽的 `fs/observed`）。
- **write** 無條件 create-or-overwrite：`expected` 為 `undefined`，因此 `writeText` 無論文件是否存在、無論當前版本如何都直接寫入。無先讀要求，無版本檢查。
- **edit** 無條件替換文件當前內容中的字面文字：`expected` 為 `undefined`，因此 `editText` 無版本守衛、無先讀要求地匹配並重寫（`FS_EDIT_NOT_FOUND`/`FS_AMBIGUOUS_EDIT` 仍適用——它們關乎字面匹配，而非新鮮度）。缺失目標仍報告 `FS_STALE_VERSION`，與有守衛編輯路徑的「此刻無法編輯該目標」錯誤碼一致。

兩個 mutation 仍是原子的（後端的 per-target 鎖是無條件的）。僅僅是*不存在*（而非丟失）的是 `dsh-fs-observation-policy` 本會疊加的策略：觀測狀態、先讀後編輯和版本守衛的寫入/編輯。載入 `dsh-fs-observation-policy` 後，其監聽器返回有守衛的 `expected` 值而非 `undefined`，從而疊加這些約束；裸提供方本身無需任何變更。

## 取代關係

本 Agent Note 修正——而非推翻——[拆分檔案系統 seam Agent Note](../simplification/2026-06-26-fsspec-style-fs-seam.md)。四層拆分、提供方約定和新鮮度*策略*均保留。變更的是**工具與策略層之間的耦合方式**：強制性方法服務變為外掛程式擁有的事件門控，fs I/O + 讀取視窗從 `fileContext` 上移至 `dsh-tool-fs`。拆分檔案系統 seam Agent Note 中關於 `dsh-tool-fs` 注入 `fileContext` 以及 `fileContext` 擁有 `read`/`write`/`edit` 的描述已在同一變更中更新。

## 驗證

測試固定了兩條路徑：無 `dsh-fs-observation-policy` 時，根工具外掛程式對 `dsh-fs-local` 啟動，read、create、overwrite 和未讀 edit 均成功；有策略時，未讀 edit 返回 `FS_NOT_OBSERVED`，未讀 overwrite 被 `createIfAbsent` 門控。策略決定後，後註冊的 intent 監聽器不會被觸達。過時編輯透過提供方 CAS 失敗，而策略不執行 `stat`；工具預算在兩條路徑上保持 read 一次 `stat`，write 或 edit 均為零次。測試也組裝了刪除復原路徑：過時變更、重新讀取時確認缺失、帶防護的重新建立。面向模型的 schema 逐位元組不變，但復原後的結果 transcript（文字記錄）發生變化。

## 曾考慮的替代方案

- **保留 `ctx.fileContext` 作為關鍵路徑上的方法服務**——[拆分檔案系統 seam Agent Note](../simplification/2026-06-26-fsspec-style-fs-seam.md) 最初落地的形態；否決，因為工具無法在沒有策略層的情況下執行，使策略對基本操作是承重性的，而非選填的收緊。
- **策略側版本檢查**（`dsh-fs-observation-policy` 在其 waterfall 處理器中 stat 並比較版本）——否決，因為該檢查與工具實際寫入之間存在 TOCTOU 間隙；提供方的 mutation 臨界區是唯一無競態的位置，因此策略只選擇 CAS 基準並對先前觀測進行門控。
- **每工具 `/read`/`/write`/`/edit` 子路徑外掛程式**——實作時放棄：沒有消費端需要單工具部署，且子路徑發布迫使引入兄弟工具包都不需要的訂製 `tsdown`/`tsconfig`/`files`/workspace-constraint 處理；每工具的註冊輔助函式仍作為根外掛程式組合的內部模組保留。

## 後果

- **事件間接層取代方法呼叫。** 一次 waterfall + emit 不如 `await ctx.fileContext.edit(...)` 直接。收益是移除了工具到策略的方法相依性，同時保留默認策略外掛程式；代價是多一套事件詞彙需要學習。透過保持三個事件的窄小範圍並在每個事件上記錄 default-thunk 語義來緩解。
- **策略事件位於儲存 seam 中。** `dsh-fs` 增加了兩個版本決策事件和一個記錄事件，儘管它「只是儲存」。這是解耦的代價（發射方不能相依性策略外掛程式）。這些事件只攜帶 `dsh-fs` 詞彙加一個不透明的 `object` actor，不攜帶面向模型的概念，因此 seam 不沾染行視窗/觀測策略類型，也不沾染 agent/工作階段所有者結構。
- **單一策略佔位者，按慣例先到先得。** `fs/write-intent`/`fs/edit-intent` 槽位恰好容納一個決策者；先註冊（或 `prepend`）的監聽器獲勝，其餘被短路。`dsh-fs-observation-policy` 佔據該槽位是部署慣例，而非事件系統強制的不變式——一個先註冊的第二決策者會繞過它。這是可接受的，因為第二個 fs 版本策略決策者是設定錯誤，而非功能。如果未來出現*分層* fs 版本策略的需求，那是一個新 Agent Note（可組合的值傳遞 waterfall），而非在這些事件上靜默新增第二個監聽器。分層的權限/審計/沙盒攔截已有其歸屬：`tools/execute`。
- **移除讀後確認 stat** 使後續*有守衛*的編輯在 read/write 競爭下偶爾為安全起見拒絕寫入（`FS_STALE_VERSION` → 重新讀取）。這是丟失的 UX 便利，絕非正確性漏洞；提供方鎖仍阻止基於錯誤版本的寫入。
- **裸提供方不做先讀後寫/編輯，也不做版本檢查。** 沒有 `dsh-fs-observation-policy` 的部署允許模型無條件覆寫或編輯任何已有文件。這正是保持工具獨立於策略服務的有意含義：安全紀律存在於 `dsh-fs-observation-policy` 外掛程式中。省略它的部署是有意選擇無約束的檔案系統；對於發布 fs 工具的設定而言，這不是預期的姿態。
