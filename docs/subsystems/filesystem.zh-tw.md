# 檔案系統

[English](filesystem.md) | [简体中文](filesystem.zh.md) | 繁體中文

選填的檔案系統能力由四個部分組成：[dsh-fs](../../packages/fs/fs) 擁有 `ctx.fs` 以及帶選填守衛的原子文字操作；[dsh-fs-local](../../packages/fs/fs-local) 實作本機磁碟後端；[dsh-fs-observation-policy](../../packages/fs/fs-observation-policy) 記錄觀測到的存在或缺失狀態，並透過事件（而非服務）新增新鮮度規則；[dsh-tool-fs](../../packages/fs/tool-fs) 直接執行面向模型的 read/write/edit 呼叫並渲染視窗。它位於 agent loop（代理循環）主幹之外；替換後端不會改變策略或工具 schema。

`dsh-fs-observation-policy` 是選填外掛程式。沒有該外掛程式時，`FileSystem` 服務定義、一個提供方和 `dsh-tool-fs` 消費端組成完整且不受約束的檔案系統 seam：`write` 無條件建立或覆蓋，`edit` 無條件替換字面文字。策略外掛程式透過裁決 `fs/*` waterfall（瀑布式事件）來改變這些操作。移除該外掛程式不會破壞工具，因為工具呼叫 `ctx.fs` 並分發事件，而不呼叫策略方法。載入了 `dsh-tool-fs` 的部署也應載入 `dsh-fs-observation-policy`，使默認行為為「先讀後寫/編輯」。

提供方原始碼：[`packages/fs/fs/src/types.ts`](../../packages/fs/fs/src/types.ts) 與 [`packages/fs/fs/src/index.ts`](../../packages/fs/fs/src/index.ts)。策略原始碼：[`packages/fs/fs-observation-policy/src/types.ts`](../../packages/fs/fs-observation-policy/src/types.ts)。讀取渲染原始碼：[`packages/fs/tool-fs/src/read-render.ts`](../../packages/fs/tool-fs/src/read-render.ts)。

## 目標標識與元資料（提供方約定）

每個操作首先將使用者提供的路徑解析為不透明的後端目標。消費端可以顯示 `displayPath`，但禁止解析 `targetKey`（一個品牌化的不透明 id），也不得假設它是本機絕對路徑。

與檔案系統共享執行世界的消費端透過提供方取得跨能力坐標，而不是解釋該身份：`processPath(target)` 返回子行程可以打開的規範化絕對路徑，`fileUrl(target)` 返回採用提供方平臺文法的 `file:` URI，`contains(parent, child)` 則檢查規範化身份相等或後代包含關係。

```ts type-equiv
/**
 * A path resolved by a backend into a stable identity. `resolve()` produces
 * this; every other operation takes it.
 */
interface FsTarget {
  /** Opaque key for stale guards and target lookup. */
  targetKey: FsTargetKey
  /**
   * Path for model/UI-facing output. May be a local absolute path,
   * workspace-relative path, or remote URI depending on the backend.
   */
  displayPath: string
}
```

後端擁有文件版本 token，即 write/edit 所守衛的新鮮度 token。策略外掛程式儲存它們以進行過時檢查；消費端不解釋其內容。兩個 id 都是品牌化的不透明字串。

```ts type-equiv
/**
 * Opaque key for stale guards and target lookup. The local backend uses a
 * realpath-like string; a remote backend might use a workspace URI or file id.
 * Consumers MUST NOT parse it or assume it is a local absolute path.
 */
type FsTargetKey = Branded<'FsTargetKey'>
```

```ts type-equiv
/**
 * Opaque file-version token — the freshness token a write/edit guards against.
 * The local backend derives it from high-resolution stat identity and freshness
 * fields; a remote backend might use a revision id. The policy layer records it
 * for stale checks; consumers may display related metadata but MUST NOT
 * interpret this token.
 */
type FsVersion = Branded<'FsVersion'>
```

`stat` 返回元資料（從不返回內容），目標不存在時返回 `undefined`。`type` 讓消費端在學取前拒絕目錄和特殊文件；`size` 讓文字消費端無需透過失敗探測即選填擇 `readText` 還是 `streamText`。文字消費端在消費 `streamText` 時執行自己的保留量上限。原始位元組消費端呼叫 `readBytes(target, signal, maxBytes)`；其必填的完整內容上限會使已知或讀取中發現的超限以 `FS_TOO_LARGE` 失敗，不會截斷結果或無界緩衝。

```ts type-equiv
/**
 * Metadata about a target — what {@link FileSystem.stat} returns. Lets the
 * policy layer reject directories/special files before reading and choose
 * `readText` vs `streamText` from `size` without probing by failure. `version`
 * is the freshness token. `undefined` from `stat` means the target is absent.
 */
interface FsInfo {
  /** Opaque freshness token of the target right now. */
  version: FsVersion
  /** Whether the target is a regular file, a directory, or something else. */
  type: 'file' | 'directory' | 'other'
  /** Byte size of a regular file, when the backend can report it. */
  size?: number
}
```

`lstat` 是路徑級、不跟隨連結的元資料原語。它接收路徑而不是 `FsTarget`，因為 `resolve` 會有意跟隨 symlink 以產生穩定標識；需要檢查信任邊界的消費端可以先呼叫 `lstat`，在解析前拒絕 `symlink`。

```ts type-equiv
/**
 * Metadata about a path without following the final path component when it is a
 * symbolic link. Unlike {@link FsInfo}, this path-level probe can report
 * `symlink` so consumers with trust-boundary rules can reject repository-owned
 * links before resolving a target.
 */
interface FsPathInfo {
  /** Opaque freshness token of the path entry right now. */
  version: FsVersion
  /** Whether the path entry is a regular file, directory, symlink, or other. */
  type: 'file' | 'directory' | 'symlink' | 'other'
  /** Byte size of the path entry, when the backend can report it. */
  size?: number
}
```

`listDir` 按穩定的名稱順序返回直接子條目。每個條目攜帶子項的 basename、類型、已解析目標，以及後端能報告時的廉價元資料。它禁止讀取文件內容，因此 `size` 僅用於普通文件，`version` 來自元資料。已損壞或已消失的子項可以作為 `other` 返回且不帶元資料；列出或解析子項元資料時的權限或後端 I/O 失敗會以 `FS_PERMISSION_DENIED` 或 `FS_IO_ERROR` 使整個清單操作失敗。

```ts type-equiv
/**
 * One direct child returned by {@link FileSystem.listDir}. Listing returns
 * metadata and resolved targets only; it must not read file contents.
 */
interface FsDirEntry {
  /** Basename of the child inside the listed directory. */
  name: string
  /** Whether the child is a regular file, a directory, or something else. */
  type: 'file' | 'directory' | 'other'
  /** Resolved child target for follow-up operations. */
  target: FsTarget
  /** Opaque freshness token when the backend can report metadata cheaply. */
  version?: FsVersion
  /** Byte size of a regular file, when the backend can report it. */
  size?: number
}
```

## 寫入與編輯守衛（提供方約定）

`writeText` 和 `editText` 的版本守衛都是選填的：省略守衛時執行無條件的裸提供方變更，提供守衛時則執行相應的條件檢查。`writeText` 的守衛是 `FsWriteIntent`：`createIfAbsent` 在目標缺失時建立，目標已存在時以 `FS_NOT_OBSERVED` 拒絕；即使目標在提供方初始探測後纔出現，也必須拒絕，因為發布操作本身不得替換。`replaceIfVersion` 僅在目標存在且版本匹配時替換，否則報 `FS_STALE_VERSION`。省略 `expected` 則無條件建立或覆蓋。聯合類型本身只包含兩種有守衛的意圖；「無守衛」透過省略表達，因此 write 和 edit 都使用同一個選填的 `expected` 欄位。

```ts type-equiv
/**
 * Guarded write intent. `createIfAbsent` rejects an existing target with
 * `FS_NOT_OBSERVED`; `replaceIfVersion` rejects absence or mismatch with
 * `FS_STALE_VERSION`. Omitting the intent from `writeText` means unconditional
 * create-or-overwrite, not a third union arm.
 */
type FsWriteIntent =
  | { kind: 'createIfAbsent' }
  | { kind: 'replaceIfVersion'; version: FsVersion }
```

```ts type-equiv
/** Outcome of a full-file write. */
interface FsWriteOutcome {
  /** Whether the write created a new file or replaced an existing one. */
  operation: 'create' | 'update'
  /** Opaque version of the file after the write. */
  version: FsVersion
  /**
   * The file's content BEFORE the write, or `null` when the file did not exist
   * (a create) or the backend declined a contextual basis (for example, a
   * binary/non-UTF-8 prior file or either overwrite side reaching its exclusive limit).
   * LF-normalized storage text (the diff basis), never a diff — a consumer
   * computes the result-time contextual diff from `before`/`after` when
   * `before` is present, else falls back to a whole-file diff.
   */
  before: string | null
  /** The file's content AFTER the write, LF-normalized to share `before`'s diff basis. */
  after: string
}
```

`editText` 是提供方等級的變更操作，而非在別處組合的 `read` 加 `write`。帶守衛時，它在字面匹配之前先驗證預期版本（因此對過時內容的編輯報 `FS_STALE_VERSION`，而非對更新內容的匹配失敗）；不帶守衛時，它編輯當前內容。無論哪種路徑，它都應用替換並原子寫入——將匹配、行尾處理、過時檢查和原子替換保持在一個變更臨界區內——目標缺失時兩條路徑都報 `FS_STALE_VERSION`。

```ts type-equiv
/** A literal-replacement edit request. */
interface FsEditRequest {
  /** Literal non-empty text to replace. Must match exactly (after line-ending normalization). */
  oldString: string
  /** Literal replacement text. An empty string deletes the matched text. */
  newString: string
  /** Replace every match instead of requiring exactly one. */
  replaceAll: boolean
}
```

```ts type-equiv
/** Outcome of a literal edit. */
interface FsEditOutcome {
  /** Opaque version of the file after the edit. */
  version: FsVersion
  /**
   * The file's content BEFORE the edit. Raw storage text (LF-normalized by the
   * backend), never a diff — a consumer computes the result-time contextual diff
   * (the applied hunk with context) from `before`/`after`.
   */
  before: string
  /** The file's content AFTER the edit. */
  after: string
}
```

## fs 策略事件（提供方約定詞彙）

`dsh-fs` 擁有三個事件，由工具分發、策略外掛程式監聽，使事件寄出方（`dsh-tool-fs`）與監聽方（`dsh-fs-observation-policy`）共享詞彙，而事件寄出方無需相依性策略外掛程式。它們只攜帶 `dsh-fs` 詞彙加一個不透明的 `object` actor，不含面向模型的概念，也不含 agent/工作階段所有者結構。

`fs/write-intent` 與 `fs/edit-intent` 是**單槽決策 waterfall**：工具分發時附帶一個默認 thunk（返回 `undefined`，即裸提供方），監聽方完全決策而不呼叫 `next()`。該 slot 按註冊順序先到先得——由策略外掛程式佔據是部署約定，而非強制不變式。`fs/observed` 是一個即發即棄的記錄事件，攜帶 `FsObservation`：存在於某個版本，或確認缺失。該事件透過普通 `ctx.emit` 分發；其監聽方必須是同步的、僅產生副作用，因為工具不會捕獲該 emit 拋出的例外——拋出例外的監聽方可能取代讀取操作原本待返回的錯誤，或使工具在變更已經成功後返回 `isError` 結果。下方生成的 [cordis surface](#cordis-surface) 展示確切簽名。

```ts type-equiv
/**
 * One authoritative observation of a target. A present observation carries the
 * version used by guarded replacement; an absent observation authorizes only a
 * guarded create, never an edit.
 */
type FsObservation =
  | { readonly kind: 'present'; readonly version: FsVersion }
  | { readonly kind: 'absent' }
```

## 執行上下文（策略外掛程式）

策略外掛程式只需要足夠的執行上下文，透過收窄 `fs/*` 事件攜帶的不透明 `object` actor 來推導觀測狀態的所有者。`ToolExecution` 包含必需的欄位，因此 `dsh-tool-fs` 將其執行對象作為 actor 直接傳遞，而無需讓 `dsh-fs-observation-policy` 匯入工具、agent 或工作階段包。

```ts type-equiv
/**
 * Minimal structural view of a tool execution the policy plugin needs to derive
 * an observed-state owner. `@deepseek-ai/dsh-tools`' `ToolExecution` contains
 * these fields, so the tool passes its `exec` straight through as the opaque
 * `object` actor on the `fs/*` events; this plugin narrows that actor to
 * `FsObservationActor` without importing `dsh-tools`, `dsh-agent`, or `dsh-session`.
 *
 * The owner is `agent.session` when present. It is treated as an opaque object
 * identity (a `WeakMap` key); this package never reads any of its fields.
 */
interface FsObservationActor {
  /** The agent on whose behalf the call runs, when there is one. */
  agent?: {
    /** The session that owns observed-file state, used as an opaque key. */
    session?: object
  }
}
```

## 讀取結果（消費端 / 讀取渲染）

文字讀取受行視窗、位元組上限和後端限制約束。達到位元組上限後，掃描仍會繼續，但不再保留更多行，因此 `totalLines` 仍為精確值。面向模型的 `read` 工具渲染的結果純粹是展示性的；不存在 `full`/`partial` 檢視表區分——授權基於新鮮度（工具寄出表示目標存在的 `fs/observed` 事件，並直接攜帶 stat 的版本），因此任何視窗化讀取在文件未變時都能授權後續的 write/edit。元資料未命中時，工具會在返回 `FS_NOT_FOUND` 前 emit 缺失觀測，使後續帶守衛的寫入可以重新建立外部刪除的目標，但不會授權 edit。擁有讀取操作的執行器 `dsh-tool-fs` 實作讀取視窗化並構造該結果；策略外掛程式不執行這些操作。

```ts type-equiv
/** Outcome of a bounded text read — what {@link formatReadOutput} renders. */
interface FileReadOutcome {
  /** 1-based first line requested. */
  offset: number
  /** Returned lines, already numbered. */
  lines: FileTextLine[]
  /** Exact total line count in the file. */
  totalLines: number
  /** Whether selected output hit the byte cap. */
  truncatedByBytes?: true
}
```

## 已觀測文件狀態（策略外掛程式）

已觀測狀態是 `dsh-fs-observation-policy` 外掛程式內部持有的 `WeakMap<owner, Map<targetKey, FsObservation>>`。對映中沒有條目表示未見；`{ kind: 'absent' }` 表示 `read` 的元資料未命中，或 `str_replace_editor` 的 `view`、`str_replace`、`insert` 命令發生元資料未命中，從而確認缺失；`{ kind: 'present', version }` 表示 read、write 或 edit 觀測到該版本。寫入決策把未見和缺失對映到 `createIfAbsent`，把存在對映到 `replaceIfVersion`；編輯決策把未見對映到 `FS_NOT_OBSERVED`，把缺失對映到 `FS_NOT_FOUND`，把存在對映到其版本守衛。所有者從事件 actor 推導（通常是 `exec.agent.session`），被視為不透明且從不讀取。dispose（資源釋放）時丟棄全部資料（HMR（熱模組替換）安全），策略不執行任何檔案系統 I/O。

## 錯誤分類體系（提供方約定）

檔案系統故障使用穩定的 `FsErrorCode` 字串，由 `FsError`（`HarnessError`）攜帶。工具登錄檔在錯誤結果上保留 `{ name, code }`，使重試、權限和 UI 層可以按 code 分支而無需解析文字。

```ts type-equiv
/**
 * Stable, machine-routable codes for filesystem failures. Carried on
 * {@link FsError}; the tool registry exposes `{ name, code }` on `isError`
 * results so retry/permission/UI layers can branch without parsing messages.
 */
type FsErrorCode =
  | 'FS_NOT_FOUND'
  | 'FS_NOT_DIRECTORY'
  | 'FS_NOT_TEXT'
  | 'FS_NOT_REGULAR_FILE'
  | 'FS_TOO_LARGE'
  | 'FS_PERMISSION_DENIED'
  | 'FS_SANDBOX_DENIED'
  | 'FS_IO_ERROR'
  | 'FS_STALE_VERSION'
  | 'FS_NOT_OBSERVED'
  | 'FS_AMBIGUOUS_EDIT'
  | 'FS_EDIT_NOT_FOUND'
  | 'FS_ABORTED'
```

目錄清單使用 `FS_NOT_DIRECTORY`、`FS_PERMISSION_DENIED` 與 `FS_IO_ERROR` 區分已存在但並非目錄的目標、被拒絕的清單操作和意外的後端 I/O 失敗。`FS_SANDBOX_DENIED` 是強制執行沙盒的後端（`dsh-fs-sandbox`）所作的策略拒絕——模式邊界拒絕了寫入/編輯——與 `FS_PERMISSION_DENIED`（宿主核心拒絕）不同。`FS_NOT_OBSERVED` 表示策略外掛程式沒有此所有者的先前觀測記錄（或 `createIfAbsent` 遇到了現有文件）。`FS_NOT_FOUND` 也表示策略因確認缺失而拒絕 edit。`FS_STALE_VERSION` 表示後端版本不再與觀測到的版本匹配（或提供方本身收到針對缺失目標的 edit）。新鮮度授權沒有部分/完整之分，因此不存在 `FS_PARTIAL_OBSERVATION`。

## 文件 IO 不設逾時

`read`/`write`/`edit` **不**接受 `timeoutMs`，提供方約定也不設定截止時間——不同於 bash 與 web（它們消費 [`@deepseek-ai/dsh-timeout`](../../packages/util/timeout/README.md)）以及 subprocess 支撐的 `glob`/`grep`（其聲明的 `timeoutMs` 由 `@deepseek-ai/dsh-tool-call-timeout-policy` 強制執行）：那些是行程支撐的，截止時間可以真正終止工作。本機系統呼叫至多是盡力中止——逾時無法迫使進行中的 `fsync`/`rename` 停下，因此這裡的 `timeoutMs` 會成為 seam 無法強制執行的截止時間，而且恰好落在「顯式優於隱式」禁止隱式預設值的位置。取消仍透過工具執行 signal 傳播，在系統呼叫邊界盡力中止。

## 服務與外掛程式

`FileSystem`（`ctx.fs`，abstract）擁有提供方原語：`resolve`、`processPath`、`fileUrl`、`contains`、`stat`、`lstat`、`readText`、`streamText`、`readBytes`、`listDir`、`writeText` 與 `editText`。`dsh-fs-observation-policy` **不註冊服務**——它是一個透過 `fs/*` 事件閘門新增策略的外掛程式：根據未見/缺失/存在狀態對寫入與編輯意圖 waterfall 作出決策，並記錄 `FsObservation` 值。執行器是 `dsh-tool-fs`：它透過 `ctx.fs` 讀取/寫入/編輯，分發 waterfall，並 emit 記錄事件。下方生成的 [`ctx.fs` 小節](#ctxfs--filesystem-abstract-seam) 展示確切的 `ctx.fs` 簽名。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxfs--filesystem-abstract-seam"></a>

### `ctx.fs` — `FileSystem` (abstract seam)

Abstract filesystem provider. Targets must preserve identity across aliases; reads expose regular UTF-8 text or typed errors, listings are stable and content-free, and mutations are atomic. Optional guards add stale protection without changing the unguarded provider contract.

```ts cordis-catalog
/**
 * Resolve a model/plugin-supplied path into a stable {@link FsTarget}. May perform I/O (a
 * remote/sandboxed backend may need a round-trip to map a path to a stable identity), hence
 * async even though the local backend only normalizes + realpaths.
 *
 * @param path - the path to resolve; relative paths resolve against `opts.cwd`.
 * @param opts - optional cwd override and cancellation signal.
 * @returns the stable target; the same file yields the same `targetKey`.
 */
abstract resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>

/**
 * Return the canonical absolute path a subprocess in this filesystem's
 * execution world can open. The path is deliberately separate from
 * {@link FsTarget.targetKey}: consumers may pass this value to another OS
 * capability, but must continue treating the target key as opaque.
 * @param target - the resolved target whose process path is required.
 * @returns an absolute path in the backend's execution world.
 */
abstract processPath(target: FsTarget): string

/**
 * Return the canonical `file:` URI for a target in this filesystem's
 * execution world. Backends own URI encoding because the host platform may
 * differ from the execution platform.
 * @param target - the resolved target to encode.
 * @returns the target's canonical file URI.
 */
abstract fileUrl(target: FsTarget): string

/**
 * Test canonical containment without exposing or parsing backend target
 * keys. Both targets must come from this provider.
 * @param parent - canonical directory target.
 * @param child - canonical candidate target.
 * @returns true when `child` is `parent` or a descendant of it.
 */
abstract contains(parent: FsTarget, child: FsTarget): boolean

/**
 * Return target metadata, or `undefined` when the target does not exist.
 * @param target - the resolved target to stat.
 * @param signal - aborts the metadata round-trip.
 * @returns metadata only, never content; undefined for an absent target.
 */
abstract stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>

/**
 * Return path metadata without following the final path component when it is a
 * symbolic link. This is intentionally path-shaped, not target-shaped:
 * {@link resolve} follows symlinks to produce the stable identity used by
 * normal reads/writes, while `lstat` lets a consumer reject the path itself
 * before that follow happens.
 *
 * `opts.cwd` follows {@link resolve}'s cwd rules. `undefined` means the path is
 * absent.
 * @param path - the path to inspect; relative paths resolve against `opts.cwd`.
 * @param opts - `cwd` overrides the backend's default base for relative paths.
 * @param signal - aborts the metadata round-trip.
 * @returns metadata only, never content; undefined for an absent path.
 */
abstract lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined>

/**
 * Read the whole regular text file as a single decoded string.
 * @param target - the resolved target to read.
 * @param signal - aborts the read.
 * @returns the full decoded UTF-8 content.
 */
abstract readText(target: FsTarget, signal?: AbortSignal): Promise<string>

/**
 * Stream the whole regular text file as decoded text chunks (same text
 * semantics as {@link readText}, for large files). The backend owns
 * cross-chunk UTF-8 decoding and binary rejection so the policy layer never
 * touches raw bytes.
 * @param target - the resolved target to read.
 * @param signal - aborts the stream, including between chunks.
 * @returns the chunk iterable, decoded and validated like {@link readText}.
 */
abstract streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>>

/**
 * Read the whole regular file as raw bytes with no decoding or binary
 * rejection. The bound lives at this seam so a backend can never buffer an
 * unbounded file: a target known or discovered to exceed `maxBytes` fails
 * with `FS_TOO_LARGE` instead of returning a truncated result.
 * @param target - the resolved target to read.
 * @param signal - aborts the read.
 * @param maxBytes - inclusive byte cap on the complete content.
 * @returns the full raw content, at most `maxBytes` long.
 */
abstract readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>

/**
 * List direct children of a directory in stable name order. Returns resolved
 * child targets plus cheap metadata only; never reads file contents.
 * @param target - the resolved directory target.
 * @param signal - aborts the listing.
 * @returns one entry per direct child, in stable name order.
 */
abstract listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]>

/**
 * Atomically create or replace UTF-8 text. `expected` guards intent and
 * staleness; omission allows unconditional overwrite.
 * @param target - the resolved target to write.
 * @param content - the full new file content.
 * @param expected - the write intent guarding the write; omit for unconditional.
 * @param signal - aborts before atomic publication takes effect.
 * @param sandboxPolicy - the per-call mode and workspace root this write
 *   runs under; a sandboxing backend fences the write by it, the bare backend
 *   ignores it. Omit to leave the backend its own default.
 * @returns the outcome, including the version the write produced.
 */
abstract writeText( target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy, ): Promise<FsWriteOutcome>

/**
 * Atomically edit literal text. When supplied, the version guard is checked
 * before matching so stale content reports `FS_STALE_VERSION`; omission edits
 * the current content without a freshness precondition.
 * @param target - the resolved target to edit.
 * @param edit - the literal search/replace request.
 * @param expected - the version guard; omit for an unconditional edit.
 * @param signal - aborts before atomic publication takes effect.
 * @param sandboxPolicy - the per-call mode and workspace root this edit runs
 *   under; a sandboxing backend fences the edit by it, the bare backend
 *   ignores it. Omit to leave the backend its own default.
 * @returns the outcome, including the version the edit produced.
 */
abstract editText( target: FsTarget, edit: FsEditRequest, expected?: { version: FsVersion }, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy, ): Promise<FsEditOutcome>
```

Types: [SandboxExecutionPolicy](sandbox.md)

Source: [`packages/fs/fs/src/index.ts:86`](../../packages/fs/fs/src/index.ts)

<a id="fs-events"></a>

### `fs/*` events

<a id="fsedit-intent--waterfall"></a>

#### `fs/edit-intent` — waterfall

Single-slot decision for the next FileSystem.editText. Calling `next()` yields an unconditional edit; the first returned guard wins.

```ts cordis-catalog
/**
 * Single-slot decision for the next {@link FileSystem.editText}. Calling
 * `next()` yields an unconditional edit; the first returned guard wins.
 * @param target - the resolved target about to be edited.
 * @param actor - the opaque tool-execution context the decider keys off.
 * @mode waterfall
 */
'fs/edit-intent'(target: FsTarget, actor: object | undefined, next: () => { version: FsVersion } | undefined | Promise<{ version: FsVersion } | undefined>): Promise<{ version: FsVersion } | undefined>
```

Source: [`packages/fs/fs/src/index.ts:66`](../../packages/fs/fs/src/index.ts)

<a id="fsobserved--emit"></a>

#### `fs/observed` — emit

Record an authoritative positive or negative observation. Listeners must be synchronous recorders: throws fail the tool call and returned promises are not awaited.

```ts cordis-catalog
/**
 * Record an authoritative positive or negative observation. Listeners must
 * be synchronous recorders: throws fail the tool call and returned promises
 * are not awaited.
 * @param target - the target whose presence or absence was observed.
 * @param observation - present with its version, or confirmed absent.
 * @param actor - the observing tool-execution context; undefined records nothing useful.
 * @mode emit
 */
'fs/observed'(target: FsTarget, observation: FsObservation, actor: object | undefined): void
```

Source: [`packages/fs/fs/src/index.ts:76`](../../packages/fs/fs/src/index.ts)

<a id="fswrite-intent--waterfall"></a>

#### `fs/write-intent` — waterfall

Single-slot decision for the next FileSystem.writeText. Calling `next()` yields the bare provider's unconditional write; the first listener that returns an intent owns the decision rather than composing with peers.

```ts cordis-catalog
/**
 * Single-slot decision for the next {@link FileSystem.writeText}. Calling
 * `next()` yields the bare provider's unconditional write; the first listener
 * that returns an intent owns the decision rather than composing with peers.
 * @param target - the resolved target about to be written.
 * @param actor - the opaque tool-execution context the decider keys off.
 * @mode waterfall
 */
'fs/write-intent'(target: FsTarget, actor: object | undefined, next: () => FsWriteIntent | undefined | Promise<FsWriteIntent | undefined>): Promise<FsWriteIntent | undefined>
```

Source: [`packages/fs/fs/src/index.ts:58`](../../packages/fs/fs/src/index.ts)
<!-- END GENERATED cordis-surface -->
