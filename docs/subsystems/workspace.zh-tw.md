# 工作區

[English](workspace.md) | [简体中文](workspace.zh.md) | 繁體中文

工作區（workspace）是使用者工作目錄的持久記錄：一個建立在規範路徑之上的穩定 id、一個顯示標題，以及歸屬於它的工作階段的有序帳本。該子系統是單個包（package）（[dsh-workspace](../../packages/workspace/workspace)，`ctx.workspaceRegistry`）——一項宿主側選填能力，不屬於 agent loop（代理循環）主幹，並且對模型不可見（沒有工具、沒有提示詞文字、沒有工作階段事件）。它透過[儲存領域資料形式](storage.md)儲存自己的記錄，並對照 [`SessionHeader.cwd`](persistence.md#sessionheader--metadata-beside-the-log) 校驗工作階段成員資格，因此 `storageDomain` 與 `sessionPersistence` 是必需的啟動相依性：持久化這一相依性不可用時，外掛程式保持 pending，而不是把這種不可用誤當作空歷史。設計記錄：[領域 KV 儲存 Agent Note（agent 決策記錄）](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md)；引導與 GUI 順序：[Workspace UI 產品流程 Agent Note](../../.agents/notes/implemented/feature/2026-07-25-workspace-ui-product-flow.md)。

原始碼：[`packages/workspace/workspace/src/types.ts`](../../packages/workspace/workspace/src/types.ts)

## 標識

```ts type-equiv
/**
 * Identifies one workspace record. A generated uuid, never the path: path
 * normalization rewrites paths, and a reference anchor must stay stable.
 */
type WorkspaceId = Branded<'WorkspaceId'>
```

`WorkspaceId` 是[品牌化 id](core.md#branded-ids)。路徑標識與之分離：`realpathNormalize`（`fs.realpath`；尾部斜槓、`..` 與符號連結全部解析）是唯一的一套唯一性規範——工作區路徑以規範化形式儲存，唯一性即規範路徑的字串相等（指向已被擁有目錄的符號連結會與之衝突），attach 時的工作階段 cwd 檢查也走同一套規範。

## 工作區實體

消費端只看到 `Workspace` 介面；實作保持包內私有。

```ts type-equiv
/**
 * One workspace: a stable id over an existing directory, a display title, and
 * an ordered candidate account of sessions. Membership requires both an id in
 * that account and a session header whose canonical cwd equals the workspace
 * path. Consumers only see this interface; the implementation stays private.
 */
interface Workspace {
  /** Stable record id (generated uuid). */
  readonly id: WorkspaceId

  /**
   * Canonical directory path: the `fs.realpath` of the path given at create
   * time (trailing slashes, `..`, and symlinks all resolved). Never rewritten
   * afterwards, even when the directory disappears (see {@link status}).
   */
  readonly path: string

  /** Display title. Defaults to `basename(path)` at create; duplicates are allowed. */
  readonly title: string

  /** ISO-8601 creation instant, stamped at create and never rewritten. */
  readonly createdAt: string

  /** ISO-8601 instant of the last durable mutation (create counts as one). */
  readonly updatedAt: string

  /**
   * Header-validated sessions in manually owned order: a new session is
   * prepended at attach, explicit reordering goes through
   * `insertSessionBefore`, and activity never reorders. The durable candidate
   * account is filtered synchronously: missing headers, invalid cwd values,
   * and canonical cwd mismatches are never returned. A subsequent workspace
   * mutation prunes those filtered candidates durably.
   */
  readonly sessionIds: readonly SessionId[]

  /**
   * Replace the display title durably.
   * @param title - New title; any string, duplicates across workspaces allowed.
   * @returns resolution after durability.
   */
  setTitle(title: string): Promise<void>

  /**
   * Prepend a session to this workspace's candidate account. An already
   * accounted id resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs. A new id's
   * live or persisted
   * header cwd must resolve to an existing directory equal to {@link path};
   * unknown ids, missing or invalid cwd values, and mismatches reject without
   * writing.
   * @param sessionId - The session to record.
   * @returns resolution after durability.
   */
  attachSession(sessionId: SessionId): Promise<void>

  /**
   * Move an accounted session within the manual order, DOM-insertBefore-like:
   * with an anchor the session lands before it, without one it appends to the
   * end. Only the moved id changes position. A session or anchor absent from
   * the account rejects without writing; a move to the current position
   * resolves without writing, aside from the durable filtered-candidate
   * prune every accepted mutation performs; decided on the domain write
   * chain.
   * @param sessionId - The accounted session to move.
   * @param beforeSessionId - Accounted anchor to insert before; omitted appends.
   * @returns resolution after durability.
   */
  insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void>

  /**
   * Remove a session from this workspace's account. Idempotent: an id not on
   * the account resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs; decided on
   * the domain write chain like attach. Never touches the session's own stored log.
   * @param sessionId - The session to remove.
   * @returns resolution after durability.
   */
  detachSession(sessionId: SessionId): Promise<void>

  /**
   * Live directory check, uncached: whether {@link path} currently exists and
   * is a directory. A missing directory never mutates the record — the
   * directory may only be temporarily moved.
   * @returns `'ok'` when the directory exists, `'missing-dir'` otherwise.
   */
  status(): Promise<'ok' | 'missing-dir'>
}
```

所有權的真源是記錄中有序的 `sessionIds`，絕不從工作階段 cwd 派生——但成員資格要求兩者同時成立：帳本上有其 id，且 header 的規範 cwd 等於工作區路徑，因此一個工作階段在結構上至多屬於一個工作區。失敗的寫入會拒絕（`insertSessionBefore` 的帳本錯誤以 `WorkspaceMoveInvalidError` 拒絕，儲存失敗以普通錯誤拒絕）；每次被接受的變更都蓋上 `updatedAt` 時間戳，並持久修剪不再透過成員資格檢查的候選項。

## 登錄檔：`ctx.workspaceRegistry`

`WorkspaceRegistry`（[簽名](#ctxworkspaceregistry--workspaceregistry)）擁有註冊與解析。`create(path, title?)` 規範化路徑，拒絕不存在的路徑（原樣傳出原始 `ENOENT`）或非目錄；當規範路徑已被擁有時原樣返回既有實體；否則建立一條標題為 `title ?? basename(path)` 的記錄並前插到持久的登錄檔順序中——新記錄不得與既有顯示標題重複（`WorkspaceNameConflictError`）。`get(id)` 與有序的 `list()` 是同步快取讀取；`resolveByPath(path)` 應用同一套 realpath 規範但不建立。`delete(id)` 只移除註冊記錄、順序條目和工作階段帳本——目錄、使用者文件、即時工作階段和已持久化日誌一概不動，因此這些工作階段變為 Ungrouped（[決策](../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.md)）；未知 id 返回 `false`。create 與 delete 會在其兩次寫入（記錄 + 順序）可能分叉之前先持久寫入一個待定變更標記；啟動時恰好解決被標記的那次變更——透過刪除被標記的錶行：這會補完被中斷的 delete，並回滾被中斷的 create（註冊可以重建，因此回滾是安全方向）——而沒有標記的順序/表不一致則作為損壞大聲失敗。

工作階段的 cwd 在建立時由建立者賦予，而不是由本登錄檔賦予——API 閘道從所選工作區的 `path` 解析新工作階段的 cwd（回退到顯式或默認 cwd），先建立工作階段使 cwd 落入其不可變的 [`SessionHeader`](persistence.md#sessionheader--metadata-beside-the-log)，再呼叫 `attachSession`，後者會把已儲存的 header cwd 與工作區路徑重新校驗一遍。首次成功啟動時，登錄檔僅憑已持久化的 header（`id`、`cwd`、`createdAt`——絕不讀事件正文）引導歷史：把規範 cwd 有效的工作階段按目錄分組為工作區，最新的排在最前；「已初始化」標記最後寫入，因此被中斷的引導可以安全續跑。引導只發生這一次：沒有 cwd 的歷史殘留工作階段保持 Ungrouped，此後建立的工作階段只能透過 `attachSession` 加入工作區。

## 消費端

[dsh-host-apiproxy](../../packages/host/apiproxy) 是產品消費端：它經 `ctx.workspaceRegistry` 向 GUI 用戶端提供工作區的 CRUD，並執行上文「先建工作階段再 attach」的流程。[dsh-agent-instructions](../../packages/context/agent-instructions) 儘管名字如此，卻**不是**消費端：它在 agent 自己的 cwd 下發現 AGENTS.md 風格的指令文件，從不觸碰 `ctx.workspaceRegistry`——兩者共用的這個詞指的是使用者的工作目錄，而非本登錄檔的實體。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdirectorypicker--directorypicker-abstract-seam"></a>

### `ctx.directoryPicker` — `DirectoryPicker` (abstract seam)

Abstract directory-picking service. Subclass, implement `capability()`, and load the subclass as a plugin — it registers as `ctx.directoryPicker` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior). The capability object must be stable for the service lifetime: consumers may capture it across calls.

```ts cordis-catalog
/**
 * The backend's interaction capability.
 * @returns the discriminated capability consumers switch on.
 */
abstract capability(): DirectoryPickerCapability
```

Source: [`packages/host/directory-picker/src/index.ts:131`](../../packages/host/directory-picker/src/index.ts)

<a id="ctxworkspaceregistry--workspaceregistry"></a>

### `ctx.workspaceRegistry` — `WorkspaceRegistry`

Durable workspace registry. Startup waits for `sessionPersistence`, builds one canonical-cwd header index, and completes the one-time history bootstrap before the service becomes active. The persistence dependency is mandatory so an unavailable peer can never be mistaken for an empty history and commit the initialized marker.

```ts cordis-catalog
/**
 * Create or reuse a workspace for an existing directory. The path is
 * canonicalized through `fs.realpath`; a nonexistent path rejects with the
 * original error and a non-directory rejects. Repeated calls for the same
 * canonical path return the existing entity without changing its title.
 * A newly created workspace is prepended to the durable registry order.
 * Different canonical paths may share a display title.
 * @param path - Existing directory to own, in any path spelling.
 * @param title - Display title used only when a new record is created.
 * @returns the existing or newly durable workspace.
 */
async create(path: string, title?: string): Promise<Workspace>

/**
 * Look up a workspace by id.
 * @param id - Workspace id.
 * @returns the workspace, or `undefined` when unknown.
 */
get(id: WorkspaceId): Workspace | undefined

/**
 * Synchronous workspace projection in durable registry order. Every
 * entity's `sessionIds` getter is already filtered by the startup/live
 * canonical-cwd header index; this method performs no persistence reads.
 * @returns a fresh ordered array of workspace entities.
 */
list(): Workspace[]

/**
 * Delete one workspace registration while retaining its directory and every
 * session log. The durable order is updated before the table deletion; a
 * failed table write restores the prior order and keeps the entity
 * published. Unknown ids are an idempotent no-op for domain callers.
 * @param id - Workspace registration to remove.
 * @returns `true` when a record was deleted, `false` when it was unknown.
 */
delete(id: WorkspaceId): Promise<boolean>

/**
 * Move one workspace within the durable display order, DOM-insertBefore-like.
 * With an anchor it lands before that workspace; without one it appends.
 * @param id - Workspace to move.
 * @param beforeId - Workspace anchor; omitted appends.
 * @returns the complete committed workspace order.
 */
insertBefore(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]>

/**
 * Archive one session durably. The session must exist (live or in session
 * persistence); its workspace accounting — or lack of one — is irrelevant.
 * An already archived id resolves without writing.
 * @param sessionId - The session to archive.
 * @returns resolution after durability.
 */
archiveSession(sessionId: SessionId): Promise<void>

/**
 * Resolve by canonical directory path without creating or mutating a
 * workspace. A missing path rejects during `realpath`; an existing unowned
 * directory returns `undefined`.
 * @param path - Existing directory path in any spelling.
 * @returns the workspace owning the canonical path, when one exists.
 */
async resolveByPath(path: string): Promise<Workspace | undefined>
```

Types: [SessionId](core.md)

Source: [`packages/workspace/workspace/src/index.ts:92`](../../packages/workspace/workspace/src/index.ts)
<!-- END GENERATED cordis-surface -->
