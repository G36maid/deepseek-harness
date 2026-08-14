# Agent Note: 領域 KV 儲存能力 seam 與 workspace 實體

Status: proposed

[English](2026-07-24-domain-kv-storage-and-workspace.md) | [简体中文](2026-07-24-domain-kv-storage-and-workspace.zh.md) | 繁體中文

## 問題

host 側唯一的持久化面是 session 事件日誌（`packages/session/session-persistence`：僅附加、一 session 一文件）。凡是"不屬於某個 session"的資訊就沒有落盤處，眼下有兩個真實需求：

- **workspace 實體**。GUI 要把 workspace 做成真實對象：路徑、標題、關聯 session 清單。歸屬關係由 workspace 持有——"哪些 session 屬於這個 workspace"不是任何單個 session 自己的事實，塞進 session log 語義不成立。在本設計之前，workspace 只是 sidebar 上按 cwd 分組的視覺概念，沒有實體。
- **session 動態元資訊**（可預見的第二個消費端）。冷工作階段清單只讀日誌首行 header（建立時的不可變快照），title、結束狀態這類隨工作階段推進變化的資訊拿不到；補齊方向是 sidecar 元資料表——正是一張按 key 高頻點更新的 KV 表。

另外，Session 刪除需要 `SessionPersistence` 刪除原語和 `session.delete` 端點。該空白的設計隨本 Note 定案，但實作仍屬未來工作。

後續的 [Workspace 註冊記錄刪除決策](../../implemented/feature/2026-07-27-workspace-registration-deletion.md)取代的僅是上述耦合關係：刪除 Workspace 註冊記錄會保留相關 Session 及其日誌，Session 刪除仍是獨立的未來工作。因此，下文的級聯設計並不是 Workspace GUI 的刪除語義。

## 方案

新建 `packages/storage/` 組——`ctx.storage` 儲存樞紐（後端註冊面 + 資料形式掛載面）、兩個後端、domain 領域資料形式——及 workspace 消費端包；給 `SessionPersistence` 擴刪除原語。

| 包 | 路徑 | ctx 面 | 本期 |
| --- | --- | --- | --- |
| `@deepseek-ai/dsh-storage` | `packages/storage/storage/` | `ctx.storage`（樞紐） | ✓ |
| `@deepseek-ai/dsh-storage-json` | `packages/storage/storage-json/` | 註冊後端 `json` | ✓ |
| `@deepseek-ai/dsh-storage-sqlite` | `packages/storage/storage-sqlite/` | 註冊後端 `sqlite` | ✓ |
| `@deepseek-ai/dsh-storage-domain` | `packages/storage/storage-domain/` | 掛載 `ctx.storage.domain` | ✓ |
| `@deepseek-ai/dsh-workspace` | `packages/workspace/workspace/` | `ctx.workspaceRegistry` | ✓ |
| `SessionPersistence.delete` 擴面 + 級聯刪編排 | `packages/session/*` | 既有 seam 新方法 | ✗ future work（本期不動 session 側） |
| `workspace.*` / `session.delete` RPC、GUI 接線、boot 組裝 | — | — | ✗ 下期 |

（workspace 放獨立組不放 `packages/host/`：host 組命名規則要求 `dsh-host-*` 前綴，而包名定為 `dsh-workspace`；且 workspace 實體是領域概念，不綁定 host 裝配層。與既有 `agent-instructions` 包無關——那是 AGENTS.md 指令載入器。）

相依性方向：`dsh-workspace` → `dsh-domain` → `dsh-storage` ← 兩後端。`dsh-workspace` 另相依性 `ctx.sessionPersistence` 的只讀面（attach 的 cwd 校驗讀 session header；服務缺席時 attach 直接拒絕——無法校驗即不寫帳）。session 刪除相關的 `ctx.sessions` 執行中檢查隨級聯刪一並歸入 future work。

### `dsh-storage`：儲存樞紐

純註冊樞紐，自身不做 IO，無 Config。`Storage` 服務掛 `ctx.storage`，兩個面：`backend`（`BackendRegistry`：`register(name, backend)` 返回 disposer、重名 throw；`get(name)` 未知名 throw `backend-not-found`）與資料形式掛載（`mount(form, facility)` 配 merge-extensible 的 `StorageForms` map，`dsh-domain` merge 進 `domain` 鍵；未掛載訪問 throw `form-not-mounted`）。簽名正文見 `packages/storage/storage/src/index.ts` 與 `src/registry.ts`。

**多後端同時掛載**；域→後端的選擇是 `dsh-domain` 的設定（見下），不是全域性二選一。disposer 語義 = 從表中摘名；後端自身的 close 由後端包的 effect 閉包負責，順序先摘名後 close。

一個後端是一個**介質 owner**（一棵文件樹 root / 一個 db 文件），透過**資料形狀 facet** 暴露原語——本期只有 `kv`；session 遷移期加 `log`（見遷移節）。facet 是選填成員，缺席即該後端不支持該形狀，解析時 fail loud。`kv` facet 的原語面：`open(descriptor)`（descriptor = 名字/版本/表名清單/有無 global，名字與表名限 `^[a-z][a-z0-9_]*$` 兼作檔名與 SQL 表名段）返回 unit，unit 提供 `loadAll` / `putRecord` / `deleteRecord`（缺 key 為 no-op）/ `setGlobal` / `close`（冪等）；值對後端是不透明 JSON。規範正文（含逐方法 JSDoc）在 `packages/storage/storage/src/backend.ts`。

後端約定（共享約定測試逐條斷言，兩後端同套件）：

1. `open` 對不存在的介質建立（懶物化允許：可延遲到首寫，但 `loadAll` 立即可用返回空表）；對已存在介質載入。
2. 介質上版本 ≠ descriptor.version → `StorageError('version-mismatch')`，不遷移不重建。
3. 持久性：寫原語 resolve 後進程崩潰再 open，`loadAll` 必須反映該寫入。
4. 後端不承諾 unit 內寫並行序——**呼叫方負責序列**；後端只保證單次呼叫原子（JSON 整文件替換 / SQLite 單語句）。
5. `deleteRecord` 冪等；`putRecord` 覆寫。
6. 任意字串 key / 任意 JSON 值安全（key 不進檔案路徑，結構性質）。
7. `close` 冪等；close 後任何操作 → `StorageError('closed')`。

錯誤詞彙是帶 code 判別的 `StorageError`，碼表：`backend-not-found` / `form-not-mounted` / `duplicate-backend` / `duplicate-mount` / `version-mismatch` / `malformed-medium` / `closed`（`packages/storage/storage/src/error.ts`）。

### `dsh-storage-json`

Config 僅 `root`（必填無默認，schemastery）；apply 在 `ctx.effect()` 裡註冊後端 `json`，disposer 先摘名再 `backend.close()`。

- 版面配置 `<root>/<unitName>.json`，一 unit 一文件；目錄 0o700、文件 0o600。
- 檔案格式（版本戳在頭，文件即當前淨值，`JSON.stringify(…, null, 2)` 肉眼可讀——這是該後端的存在理由）：

```json
{
  "unit": { "name": "workspace", "version": 1 },
  "global": null,
  "tables": { "workspaces": { "<key>": {} } }
}
```

- 寫入：任何一次寫原語 = 記憶體態全量序列化 → temp 寫 + fsync → rename 原子發布（Windows 變體照抄 session-persistence-jsonl 的 win32 路徑）。記憶體態是權威，盤是投影。
- `loadAll`：open 時整文件 parse；缺 `unit` 頭、tables 非對象等 → `malformed-medium`。文件不存在 = 空單元，首寫才落盤。

### `dsh-storage-sqlite`

Config 為 `path`（必填，`':memory:'` 允許）+ `journalMode`（枚舉，默認 `wal`）；apply 同 json，註冊後端 `sqlite`。

- `node:sqlite` `DatabaseSync`；打開序列照抄 session-persistence-sqlite：mkdir 0o700 → 不存在則 `open(path,'wx',0o600)` 獨佔建文件 → `PRAGMA foreign_keys=ON` → journal_mode → 版本檢查 → 建表。
- 物理版面配置版本 `STORAGE_SQLITE_SCHEMA_VERSION = 1` 存 `PRAGMA user_version`：0 → 蓋章；≠ → `version-mismatch`。
- DDL（全 STRICT；表名由受限字元集拼接加 `u_` 前綴，杜絕外部輸入進 DDL）：

```sql
CREATE TABLE IF NOT EXISTS units (name TEXT PRIMARY KEY, version INTEGER NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS unit_globals (
  unit TEXT PRIMARY KEY REFERENCES units(name), value TEXT NOT NULL) STRICT;
-- 每 unit 每表：
CREATE TABLE IF NOT EXISTS "u_<unit>_<table>" (
  key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;             -- value = 记录 JSON 文档
```

- unit 版本存 `units` 行，descriptor 不符 → `version-mismatch`。行粒度 document-per-row，保住按 key 精確落盤更新（為 session sidecar 這類高頻點更新大表留路）；查詢需求出現時 JSON1 直查 value 列。
- 寫原語單語句即原子，無跨語句交易需求（domain 層無跨表交易，見不做清單）。

### `dsh-domain`：領域資料形式

單實作不抽象；消費端只相依性這層，不直接觸後端。

```ts ignore-check
export const Config = z.object({
  backend: z.string().required(),                // 默认后端名，必填
  routes: z.dict(z.string()).default({}),        // per-domain 覆盖：{ workspace: 'sqlite' }
})

export function apply(ctx: Context, config: Config) {
  ctx.effect(() => ctx.storage.mount('domain', new DomainFacility(ctx, config)))
}
```

（facility 解除安裝順序：先 dispose 各域（排空寫鏈）再從樞紐摘名——排空期間運送中寫仍發 `domain/changed`，事件一致性 invariant 經 facility 反查域，要求此時網域仍可解析。）

域聲明（spec 對象由擁有該域的包定義匯出，是類型與執行時期的唯一真源；schema 用 zod，`z.infer` 推導類型不重複聲明——記錄模型下期要投影成 RPC wire schema，wire 邊界全是 zod；schemastery 仍只管外掛程式 Config）：

```ts ignore-check
export interface DomainGlobalSpec<G> { readonly schema: ZodType<G>; readonly initial: G }
export interface DomainTableSpec<K extends string, V> { readonly valueSchema: ZodType<V> }

export interface DomainSpec {
  readonly name: string                          // ^[a-z][a-z0-9_]*$
  readonly version: number
  readonly global?: DomainGlobalSpec<unknown>
  readonly tables: Record<string, DomainTableSpec<string, unknown>>
}

export function defineDomain<S extends DomainSpec>(spec: S): S
export function domainTable<K extends string, V>(schema: ZodType<V>): DomainTableSpec<K, V>
```

`DomainFacility.open(spec)` 精確語義（順序執行，任一步失敗即整體失敗）：

1. 同名域已打開 → `DomainError('already-open')`。
2. 後端名 = `config.routes[spec.name] ?? config.backend`；`ctx.storage.backend.get(name)`（未掛載穿透 `backend-not-found`——misconfiguration fails loud）。
3. 後端無 `kv` facet → `DomainError('facet-unsupported')`。
4. `kv.open(descriptorOf(spec))`（descriptor 由 spec 直接投影）。
5. `loadAll()`；每條記錄 `valueSchema.parse`，global 過 schema（null 取 `initial`，不落盤，首寫才落盤）。失敗 → `DomainError('invalid-record', { table, key })`（durable 邊界必須校驗；寫側不重複校驗）。
6. 構造 `Domain` 並註冊 `ctx.effect()`：disposer 排空寫鏈 → `unit.close()`。

```ts ignore-check
export interface Domain</* 由 spec 推导 */> {
  readonly name: string
  readonly global: { get(): G; set(value: G): Promise<void> }   // 仅当 spec.global 声明
  table<N extends keyof S['tables']>(name: N): KvTable<KeyOf<N>, ValueOf<N>>
}

export interface KvTable<K extends string, V> {
  get(key: K): V | undefined                     // 内存快照，同步
  entries(): IterableIterator<[K, V]>
  keys(): IterableIterator<K>
  readonly size: number
  put(key: K, value: V): Promise<void>
  delete(key: K): Promise<boolean>               // false = 本就不存在
  /** Atomic read-modify-write on the domain's single write chain; fn is sync-pure. */
  update(key: K, fn: (current: V) => V): Promise<V>   // 缺 key → DomainError('missing-key')
}
```

規則：

- **一級 mapping**：key → 記錄，不做巢狀表；層級需求用複合 key 或值內欄位。兩後端因此同構（JSON object 一層 ↔ SQLite 一行）。
- **記錄是純資料**：可直接 JSON 序列化的不可變 POJO；`get`/`entries` 回傳值不得原地改（TypeScript readonly 投影，不做執行時期凍結）。帶行為的領域對象屬於消費端包。
- **寫序列**：域內一條 promise 鏈，`put`/`delete`/`update`/`global.set` 全排隊；`update` 的 fn 在鏈上執行，並行不交錯。不做 active-record（取出可變對象自動落盤——落盤時機不可控，與整域原子覆寫衝突）。
- **版本 fail loud**：盤上版本與 spec 不符直接報錯，不遷移不重建（資料不可再生，pre-release 拒絕舊格式）。
- **變更事件**：每次寫落盤 resolve 後 emit `domain/changed`（`@mode emit`），逐條發、不帶舊值（對齊倉庫"新快照 + 操作判別"慣例，範本 `goal/changed`）；payload `DomainChanged` 是 put/deleted 判別聯合——網域 + 表名 + key（global 變更兩者為 `''`）+ operation，put 支帶新快照 value、deleted 支無 value（`packages/storage/storage-domain/src/events.ts`）。此為下期 RPC 推幀的事件源。錯誤詞彙 `DomainError`，碼表：`already-open` / `facet-unsupported` / `invalid-record`（帶 `{ table, key }`）/ `missing-key` / `closed`。

### Future work：session 側刪除（設計定案，本期不實施）

本節是定案的施工規範，實施期不動語義只動程式碼；本期 session-persistence 的任何文件都不修改。

```ts ignore-check
export abstract class SessionPersistence extends Service {
  /**
   * Permanently delete one session's stored log.
   * Queued on the per-id write chain (serialized with in-flight appends).
   * Unknown id → reject; un-materialized create intent → cancel it and resolve.
   * After deletion the id behaves as unknown for every subsequent operation.
   */
  abstract delete(id: SessionId): Promise<void>
}
```

- JSONL 後端：unlink 該 session 文件（含 `.zstd` 變體）；文件與 intent 均無 → reject。
- SQLite 後端：單交易 `DELETE FROM events…; DELETE FROM sessions…`；0 行命中且無 intent → reject。
- 刪除成功後 emit `'session-persistence/deleted'(id: SessionId)`（`@mode emit`；session-persistence 層事件面，與 `domain/changed` 無關）。派生資料（session-query 全文索引等）訂閱自清；持久層不直連索引，崩潰視窗靠派生索引可丟棄重建兜底。

編排層規則（隨級聯刪一起實施；`session.delete` RPC 與 workspace 級聯複用同一規則）：

| 檢查（按序） | 不滿足時 |
| --- | --- |
| 目標（遞迴時含整棵子樹）無一在 `ctx.sessions` 執行 | throw，什麼都不刪；呼叫方先 cancel 再刪，持久層不反向牽動執行時期 |
| 非遞迴時目標無後代（後代 = `parentSessionId` 傳遞閉包，由 `list()` header 求得） | throw：默認只能刪葉子，`recursive: true` 顯式遞迴 |
| 遞迴序自底向上（葉→根） | ——中途崩潰只留"子樹刪一半、祖先在"，重跑收斂，任何時刻無懸空 parent |
| 級聯中某 id 已不在盤上 | 跳過（冪等續刪）；其餘錯誤中止 |

### `dsh-workspace`

包擁有 `WorkspaceId` brand，暴露 `ctx.workspaceRegistry`。記錄 key 為生成的 uuid——path 不做 key：規範化會改寫它，引用錨點必須穩定。

```ts ignore-check
export type WorkspaceId = Branded<'WorkspaceId'>
export function WorkspaceId(id: string): WorkspaceId

const workspaceRecord = z.object({
  path: z.string(),                              // realpath，见下
  title: z.string(),
  sessionIds: z.array(z.string().transform(SessionId)),
  createdAt: z.string(),                         // ISO
  updatedAt: z.string(),
})
export type WorkspaceRecord = z.infer<typeof workspaceRecord>

export const workspaceDomainSpec = defineDomain({
  name: 'workspace', version: 1,
  tables: { workspaces: domainTable<WorkspaceId, WorkspaceRecord>(workspaceRecord) },
})

declare module 'cordis' { interface Context { workspace: WorkspaceRegistry } }

export interface Workspace {
  readonly id: WorkspaceId
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly SessionId[]      // 唯一真相且有序：数组序即展示序
  setTitle(title: string): Promise<void>
  /** Record a session under this workspace (idempotent). Rejects when the session
   *  header's cwd (realpath) differs from this workspace's path. */
  attachSession(sessionId: SessionId): Promise<void>
  detachSession(sessionId: SessionId): Promise<void>
  /** Live directory check, uncached. */
  status(): Promise<'ok' | 'missing-dir'>
}

export class WorkspaceRegistry extends Service {
  constructor(ctx: Context)                      // super(ctx, 'workspaceRegistry')
  // start(): this.domain = await ctx.storage.domain.open(workspaceDomainSpec)
  //          实体缓存 Map<WorkspaceId, WorkspaceEntity> 重建
  create(path: string, title?: string): Promise<Workspace>   // realpath 后撞已有 → reject
  get(id: WorkspaceId): Workspace | undefined
  list(): Workspace[]
  resolveByPath(path: string): Promise<Workspace | undefined> // 同 realpath 口径，故 async
  delete(id: WorkspaceId): Promise<boolean>      // 只删注册记录；目录与 session 日志保留
}
```

- **path 規範**：落盤值 = `fs.realpath(输入)`（尾斜槓、`..`、符號連結全解析）；唯一性 = 規範化後字串相等（符號連結指向同一目錄算撞）。目錄不存在時 create 直接 reject（realpath 失敗——workspace 必須指向存在目錄；"Create new = 建目錄"是上層互動，先 mkdir 再 create）。attach 校驗的 session cwd 同口徑。cwd 單值 + path 唯一 ⇒ 一個 session 結構上最多歸屬一個 workspace，雙重記帳寫側不可能。
- **title**：顯示名，默認 `basename(path)`，可改，允許重複。歸屬不用 cwd 派生兜底——cwd 表達不了排序，歸屬是 workspace 側事實；headless 直開的 session 不屬於任何 workspace。
- 消費端只見 `Workspace` 介面，`WorkspaceEntity` 不出包（單實作不預拆 seam）；實體按 id 唯一（登錄檔快取），記錄快照寫後原地換新，外部只見 getter；所有寫收斂到實體內 `mutate(fn)` → `table.update`，`updatedAt` 在 mutate 內統一刷。領域對象不過 RPC，下期 wire 層把記錄投影成 zod wire schema。
- **Session 刪除仍屬未來工作。** 後續的 [Workspace 註冊記錄刪除決策](../../implemented/feature/2026-07-27-workspace-registration-deletion.md)已將 `ctx.workspaceRegistry.delete(id)` 作為僅刪除元資料、保留 Session 與日誌的操作交付。遞迴刪除 Session、執行中檢查和崩潰重跑收斂屬於獨立的 `session.delete` 能力。

一致性口徑（帳 = 歸屬唯一依據；實作與測試基準）：

| 情形 | 行為 |
| --- | --- |
| 帳中 id 盤上無 session | `list()`/實體投影時過濾；下次任何 mutate 順手摘除；不報錯（刪除崩潰一致性的正常產物） |
| session cwd 匹配某 workspace 但未上帳 | 不屬於：不合併不收編。GUI 將來可做"遊離 session"專區（遊離 = 全部帳的補集） |
| 同一 session 上兩本帳 | 寫側結構性堵死（attach 校驗）；load 檢出 → throw（外部手改資料，不掩蓋） |
| workspace 目錄不存在 | 記錄與帳保留，`status()` = `'missing-dir'`；儲存層不自動刪（目錄可能只是暫時挪走） |

### 複用與 session 後端遷移展望

**長期方向**：session-persistence 的 JSONL/SQLite 後端裡"純介質操作"下沉到 `dsh-storage` 後端（session 包不刪，`SessionPersistence` seam 與 coordinator 語義不動；動的只是它們腳下的文件/db 操作層）。複用的動機：介質層全是檔案系統操作、資料庫呼叫與跨平臺相容的髒活（Windows 權限與原子發布變體、fsync 語義、獨佔建文件……），這些只應寫一遍；業務語義（session 怎麼 append、何時 append、append 什麼）留在上層——而"底下這次 append 是否正常完成"（持久性/原子性/平臺正確性）是底層的責任，責任介面就是 facet 原語的約定。為此後端介面按**介質 owner + 資料形狀 facet** 設計：session 日誌是僅附加流，與 KV 形狀不同——強行統一進 KV 原語會兩頭變形，所以按 facet 分開（`kv` 本期、`log` 遷移期），介質與生命週期共享。

現狀複用審計（遷移前就能看清的帳）：

| session-persistence 現有邏輯 | 歸屬 | 處置 |
| --- | --- | --- |
| JSONL：temp 寫 + fsync + link/unlink 原子發布、0o700/0o600 權限、Windows 變體（win32.ts） | 純介質 | 本期 `dsh-storage-json` 直接抄用（整文件原子覆寫正是同一套）；遷移期成為共享實作 |
| JSONL：逐行 append、首行 header 快讀、zstd 逐幀壓縮 | log 形狀 | 留在原地；遷移期進 `log` facet |
| SQLite：openDatabase（mkdir/獨佔建文件/PRAGMA 序列/user_version 檢查） | 純介質 | 本期 `dsh-storage-sqlite` 抄用——兩處 openDatabase 已幾乎逐行同構，本組是第三個使用者；先抄後提，提取放遷移期 |
| SQLite：events/sessions 表結構、同交易物化 | log 形狀 | 留在原地；遷移期進 `log` facet |
| coordinator（per-id 寫鏈、懶物化、崩潰修復、flush 屏障） | session 語義 | 永不下沉——事件日誌的領域邏輯，在 domain 層對應的是寫序列鏈，各歸各 |
| encodeSegment（id 進路徑轉義） | 介質工具 | domain 側 key 不進路徑用不到；`log` facet（一 session 一文件）遷移時隨之下沉 |

**本期不改 session-persistence 的介質程式碼**（只加 delete 原語）；上表是遷移期的施工清單，也是後端介面"必須裝得下 log 形狀"的設計依據。

### 測試矩陣

| 套件 | 覆蓋 | 後端 |
| --- | --- | --- |
| 後端約定（共享套件，一次編寫兩端跑） | 七條約定 + 版本拒絕 + close 冪等 | json、sqlite（`:memory:` + 臨時目錄） |
| 登錄檔/mount | 重複註冊、未掛載訪問、disposer 摘除 | — |
| domain 層 | open 六步語義、schema 拒絕、update 序列（並行交錯壓測）、`domain/changed` 逐條、global 初值懶物化、路由與 `facet-unsupported` | 任一（json） |
| workspace | create/唯一性/realpath、attach 校驗（含 sessionPersistence 缺席拒絕）、一致性口徑四情形 | mock domain 或 json |
| session delete 約定（future work，隨實施並入 runPersistenceContract） | 未知 id、已刪 id 複用、未物化 intent、與運送中 append 序列、deleted 事件 | jsonl、sqlite |

快照：本期無模型可見面與組裝面，不新增；下期 RPC 接線時隨 `workspace.*` 域補。

### 不做清單

| 不做 | 觸發條件 | 返工點 | 預埋 |
| --- | --- | --- | --- |
| Session 刪除（`SessionPersistence.delete`、deleted 事件、遞迴刪除、執行中檢查） | 破壞性的 Session 刪除產品流啟動 | 實作 Session 原語及 `session.delete`；與 Workspace 註冊記錄刪除保持獨立 | 上文編排規則和拒絕清單仍是基礎；Workspace 刪除會保留 Session 與日誌 |
| `log` facet 與 session 後端遷移 | 本期後任意期啟動 | 介質操作下沉（複用審計表即施工清單） | facet 結構已留位；兩後端介質程式碼本期即按可下沉形狀組織 |
| 多行程並行寫保護 | 兩 host 行程同寫一介質 | JSON 後端文件鎖；SQLite WAL 天然多行程 | 寫全經 domain 單點序列，加鎖只動後端 |
| 跨行程變更觀測 | GUI 斷線重連感知 | revision 模式（抄 session-persistence） | 行程內已有 `domain/changed` |
| 資料遷移 | 首個 tagged release 後模型再變 | 版本號驅動程式逐域遷移 | 版本號自第一天入介質 |
| 大表效能 | 千級記錄域掛 json | `routes` 改指 sqlite，資料手工導一次 | 路由即設定，消費端零改動 |
| 多段 key | 兩段 key 消費端出現（每 workspace 每 session 維度資料） | key 泛型換 tuple、SQLite 複合主鍵、JSON 巢狀層 | 一級表 = 段數 1 特例；不做任意深度巢狀；不拼字串 key |
| scope 維度 | "每 workspace 一份"的域出現且複合 key 表達不動 | DomainSpec 加 scope + 檔名 scope 段（encodeSegment） | 名字字元集已收緊，檔名不衝突 |
| 跨表原子交易 | 同域兩表一次原子操作需求 | `domain.transact(fn)`；JSON 天然原子，SQLite 包交易 | — |
| 二級索引/條件查詢 | 記憶體過濾不動（萬級記錄） | SQLite JSON1 查 value 列，加只讀 query 面 | JSON 後端不陪跑 |
| session 跨 workspace 移動 | 產品需求出現 | attach 校驗放寬為"先 detach 後 attach"編排 | — |
| Session 刪除 RPC／GUI | 破壞性的 Session 刪除產品流啟動 | `session.delete` 端點、wire schema 與明確的確認 UI | Workspace RPC／GUI 已獨立交付，不再存在級聯耦合 |

## 備選方案

- **複用 session-persistence 的 coordinator/後端**：事件日誌語義（僅附加、turn 崩潰修復、懶物化）與 KV 覆寫語義不匹配；只借其分層思想（協調層持寫序、後端只實作最小原語）。
- **workspace 專用儲存包，後續再抽 seam**：第二個消費端（session sidecar）已可預見，屆時泛化要再動一次介面。
- **domain 與 storage 合為一層**：後端會被迫接觸 schema 校驗、變更事件、寫序列等領域關切；拆開後 storage 後端只做不透明原語（可替換面最小），domain 單實作收斂全部領域邏輯（zod/事件/序列化只寫一遍，不隨後端翻倍）。
- **整庫單後端二選一（學 session-persistence 單 slot 模式）**：否決——儲存樞紐要承載多種資料形式，不同形式/域對後端的偏好（肉眼可讀 vs 高頻點更新）註定分化，單 slot 會逼出"整體換掛 + 手工導資料"的粗粒度動作。代價是按名尋找多一步，fail-loud 兜底。
- **JSON 後端 jsonl 追加 + 墓碑 + 壓實（compaction）**：temp+fsync+rename 的崩潰安全與 append 等價；覆寫讓文件永遠是淨值、肉眼可讀，免掉摺疊／壓實／斷行容錯。域規模下整寫與追加一行同量級。
- **JSON 一表一文件**：覆寫下文件粒度不影響寫成本，按域合併文件更少，global 單例有落點。
- **SQLite 整域存單行 blob**：任何一條記錄變更都重寫整域，失去按 key 精確更新——SQLite 相對 JSON 的唯一優勢歸零。
- **SQLite 按 schema 生成 typed columns**：DDL 生成器過度建設；document-per-row 足夠，查詢需求出現再議。
- **每域獨立 sqlite db 文件**：與倉庫一庫多表慣例相反。
- **path 作為 workspace key**：規範化/符號連結解析會改寫 path；引用錨點必須穩定。
- **歸屬用 cwd 派生（或與帳合併）**：雙真相源；cwd 表達不了排序；歸屬本就是 workspace 側事實。
- **變更事件帶舊值**：倉庫變更事件慣例是"新快照 + 操作判別"（唯一例外 fs 的 before/after 是方法回傳值而非事件，因舊值事後不可重建且有 diff 消費端）；需要 diff 的消費端自己持有上次快照。
- **刪除自動 cancel 執行中 session**：持久層/編排層反向牽動執行時期，層次變髒；cancel 機制已存在，呼叫方組合即可。

## 驗收標準

- 測試矩陣本期四套件全綠：後端約定共享套件在 json/sqlite 雙端、登錄檔/mount disposer 語義、domain 層（含 open 六步與路由 fail-loud）、workspace 全語義（create/attach 校驗/一致性口徑）。
- `ctx.workspaceRegistry` 可在測試組裝下完成 create → attach → list → 僅刪除元資料的 delete 生命週期。
- session-persistence 包零 diff（本期不動 session 側的驗收線）。
- 本期無新快照（無模型可見面與組裝面）；下期 RPC 接線時補。

## 風險

- **倉庫持久化面第一個推式變更事件**（session-persistence 靠 revision 輪詢）：形態雖有 `goal/changed` 範本，但"儲存層發事件"是新先例，下期 RPC 消費時才能驗證形態是否合適。
- **JSON 後端整域覆寫的規模前提**：若第二個消費端（session sidecar）在路由到 SQLite 前就以千級記錄落在 JSON 後端，整寫成本會先於預期顯現；緩解即 `routes` 改指 sqlite。
- **刪除編排對 `ctx.sessions` 的弱相依性**：headless 組裝拿不到執行時期登錄檔時按"無熱 session"處理，存在視窗（外部行程正在跑該 session）；多行程本就在不做清單內，接受。
- **facet 泛化以未來的 `log` facet 為設計依據但本期不實作它**：存在"預留形狀不合身"的風險；緩解是本期後端介質程式碼按複用審計表的下沉形狀組織，`log` facet 真正落地時只動 facet 層。
