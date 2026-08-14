# 使用者設定

[English](settings.md) | [简体中文](settings.zh.md) | 繁體中文

[dsh-settings](../../packages/settings/settings) 的使用者設定 seam 持有一份按 namespace 分節的使用者文件，並把每個已註冊 namespace 解析為：schema 預設值，然後註冊方的組合 `base`，最後使用者分節。[dsh-settings-file](../../packages/settings/settings-file) 這類提供方儲存原始文件並推送外部編輯；消費端外掛程式註冊 schema 後讀取或觀察解析值。組合設定仍留在 `cordis.yml`——namespace 只承載使用者可編輯子集。

來源：[`packages/settings/settings/src/index.ts`](../../packages/settings/settings/src/index.ts)

## 標識

namespace 命名使用者文件中一個歸外掛程式所有的分節。brand 防止呼叫方將設定 namespace 與在包或行程之間傳遞的其他 id 混用；構造時校驗小寫 kebab-case 文法。

```ts type-equiv
/** Nominal id of one registered settings namespace. */
type SettingsNamespace = Branded<'SettingsNamespace'>
```

## 註冊

註冊把 schemastery schema 綁定到呼叫方外掛程式 fiber 上的 namespace——dispose（資源釋放）該 fiber 即移除 namespace 及其觀察者。options 攜帶組合層、owner 的生效時機，以及一個選填的、用於校驗 schema 表達不了的約束的掛鉤。

```ts type-equiv
/** Registration options beyond the namespace schema. */
interface SettingsRegisterOptions<T> {
  /** Composition-layer values resolved below the user layer (entry-config subset). */
  base?: Partial<T>
  /** Owner's effect timing, surfaced to configuration UIs; defaults to `live`. */
  applies?: SettingsApplies
  /**
   * Reject a resolved section the owner could not act on, for constraints its
   * schema cannot express — a cross-field requirement, or one field's validity
   * depending on another's. Throwing here refuses the *write* that produced the
   * value, so a caller learns at `update`/`replace`/`mutate` instead of storing
   * something that would silently disable the owner.
   *
   * Kept separate from the schema because the schema is also what a
   * configuration surface renders and what an absent section resolves through;
   * folding a cross-field check into it would change both.
   *
   * Once the owner is registered, a stored section that fails this keeps the
   * namespace's last good value and warns, exactly as a schema failure does,
   * so an externally edited document cannot strand a running owner. At
   * registration there is no last good value yet, so a stored section that
   * already fails rejects the registration itself — again exactly as a schema
   * failure does.
   * @param value - the resolved section, schema-valid by construction.
   */
  validate?: (value: T) => void
}
```

`validate` 在 schema 接納該值之後執行，因此它看到的預設值和組合 base 與 owner 實際看到的完全一致。`dsh-llm-pi-ai` 用它在寫入處拒絕自己無法服務的提供方 profile，而不是先存下來、再讓該 namespace 下每條路由失效。

`applies` 是 UI 提示而非機制：`restart` 的 owner 只是從不 watch，其值在構造期讀取一次，設定介面可為待生效變更加標。

```ts type-equiv
/** When a namespace's changes take effect for its owner. */
type SettingsApplies = 'live' | 'restart'
```

## Owner scope

scope 是面向 owner 的控制代碼。`update` 把稀疏 patch 只合併進使用者分節（絕不進 `base`）；`replace` 整體替換分節，是刪除/重設路徑——替換中缺席的鍵重新繼承 `base` 與 schema 預設值。同一 namespace 的寫入按呼叫順序序列，解析值是深凍結快照。

```ts type-equiv
/** Owner-facing handle for one registered namespace. */
interface SettingsScope<T> {
  /** Current resolved value: schema defaults, then `base`, then the user layer. */
  get(): T
  /**
   * Observe committed changes to this namespace's resolved value. Invocations
   * of one callback run asynchronously, one at a time, in commit order; a
   * rejection is contained and logged like a sync throw. After the disposer
   * returns, no further invocation starts — one already queued is skipped;
   * one already started still settles, and service disposal waits for it.
   * @param callback - invoked after each commit with the next and previous values.
   * @returns the disposer removing this observer.
   */
  watch(callback: (next: T, prev: T) => void | Promise<void>): () => void
  /**
   * Merge a partial patch into this namespace's user layer and persist it.
   * @param patch - plain-object patch over the user section; JSON-compatible data
   * only (non-JSON values reject with their path before anything persists).
   */
  update(patch: object): Promise<void>
  /**
   * Replace this namespace's user section wholesale; absent keys re-inherit
   * the composition `base` and schema defaults (`replace({})` resets all).
   * @param section - the complete next user section; JSON-compatible data only,
   * as for {@link update}.
   */
  replace(section: object): Promise<void>
}
```

## 描述符

`describe()` 為設定介面序列化每個已註冊 namespace：schemastery 的 `toJSON()` 封裝結構驅動 schema 算繪的表單，解析值填充表單，分離出的 `base`/`user` 層讓表單按欄位是否出現在 user 層標注「使用者已覆蓋」。`describe({ redactSecrets: true })`——每個對外傳輸介面都必須傳入——從三層剝離 `role('secret')` 欄位並枚舉其 `{path, set}` slot，頁面因此能算繪只寫輸入框而永遠收不到機密值。

```ts type-equiv
/** One registered namespace as surfaced to configuration UIs. */
interface SettingsDescriptor {
  /** The registered namespace. */
  ns: SettingsNamespace
  /** Serialized schemastery schema (`schema.toJSON()`). */
  schema: unknown
  /** Current resolved value. */
  value: unknown
  /**
   * Monotonic revision of the raw user section this descriptor was read at.
   * Send it back as `expectedRevision` on a write to refuse a stale one.
   */
  revision: number
  /** Registrant's composition `base` layer (detached), when one was declared. */
  base?: unknown
  /**
   * Raw user section from the stored document (detached), when one exists and
   * is well-formed; a field's presence here is what marks it user-overridden.
   */
  user?: unknown
  /** Owner's declared effect timing. */
  applies: SettingsApplies
  /** Schema-declared secret positions; present only under `redactSecrets`. */
  secrets?: RedactedSecret[]
}
```

只持有脫敏 descriptor 的呼叫方無法安全地重建分節，因此刪除改以路徑 op 傳遞。每個 descriptor 還攜帶針對原始分節的 `revision`；寫入可以把它作為 `expectedRevision` 送回，不再匹配的寫入會被拒絕，而不會覆蓋先落地的寫入。
```ts type-equiv
/**
 * One path-addressed edit to a namespace's user section. Path mutation exists
 * for a caller holding an INCOMPLETE view of the section — a configuration UI
 * reads the redacted descriptor, which by construction never received the
 * `role('secret')` fields. Such a caller can name the field it means without
 * restating the section: a wholesale `replace` rebuilt from a redacted
 * document silently deletes every secret the wire never returned.
 */
type SettingsPathOp =
  | { op: 'set'; path: readonly string[]; value: unknown }
  | { op: 'unset'; path: readonly string[] }
```

```ts type-equiv
/** Options for {@link SettingsProvider.describe}. */
interface SettingsDescribeOptions {
  /**
   * Strip `role('secret')` fields from `value`/`base`/`user` and enumerate
   * them in each descriptor's `secrets`. Every wire surface MUST pass this;
   * the verbatim default exists for same-process configuration UIs only.
   */
  redactSecrets?: boolean
}
```

## 變更提交

每次提交的變更——行程內寫入或提供方觀察到的外部編輯——在新值成為權威值之後寄出 `settings/updated (ns, next, prev, source)`，解析值深相等時絕不寄出。source 標記區分兩條入口路徑。

```ts type-equiv
/** Origin of one committed settings change. */
type SettingsUpdateSource = 'update' | 'provider'
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsettings--settingsprovider-abstract-seam"></a>

### `ctx.settings` — `SettingsProvider` (abstract seam)

Abstract settings service. Providers implement raw-document storage (`load`/`persist`) and push external changes through Settings.publish; the base class owns namespace registration, resolution, validation, change detection, and the `settings/updated` commit event.

```ts cordis-catalog
/**
 * Prepare the provider's user-editable document for a native editor. File
 * providers may materialize an absent document before returning its path;
 * non-file providers return undefined.
 * @returns the absolute local document path, or undefined for non-file storage.
 */
prepareDocument(): Promise<string | undefined>

/**
 * Register a namespace schema and receive its owner scope. The registration
 * is an effect on the calling plugin's fiber: disposing that fiber removes
 * the namespace and its observers. An invalid stored section fails the
 * registration itself — the earliest point where the schema can judge it.
 * @param ns - unique namespace; duplicate registration fails loud.
 * @param schema - schemastery schema resolving this namespace's value.
 * @param options - composition `base` layer and effect timing.
 * @returns the owner scope for reads, observation, and updates.
 */
register<T>(ns: SettingsNamespace, schema: z<T>, options?: SettingsRegisterOptions<T>): SettingsScope<T>

/**
 * Describe every registered namespace for configuration surfaces, including
 * the composition `base` and raw user layers so a form can mark which fields
 * the user overrode (presence in `user`) and what a reset returns to.
 * @param options - redaction switch; wire surfaces must redact.
 * @returns one descriptor per registered namespace, in registration order.
 */
describe(options?: SettingsDescribeOptions): SettingsDescriptor[]

/**
 * Read one registered namespace's resolved value.
 * @param ns - the namespace to read.
 * @returns the resolved value, or `undefined` while unregistered.
 */
get(ns: SettingsNamespace): unknown

/**
 * Merge a patch into one registered namespace's user layer, validate the
 * resolved candidate, persist through the provider, then commit and emit.
 * A validation failure rejects before anything is persisted. Writes to one
 * namespace are serialized: concurrent updates apply in call order, each
 * merging over the previous write's committed section.
 * @param ns - the registered namespace to update.
 * @param patch - plain-object patch over the user section.
 * @param expectedRevision - the descriptor `revision` the caller read; a
 *   namespace that moved past it rejects with {@link SettingsConflictError}.
 */
async update(ns: SettingsNamespace, patch: object, expectedRevision?: number): Promise<void>

/**
 * Replace one registered namespace's user section wholesale, validate,
 * persist, then commit and emit. Keys absent from `section` fall back to the
 * composition `base` and schema defaults — this is the removal/reset path a
 * merge-only patch cannot express (`replace({})` re-inherits everything).
 * @param ns - the registered namespace to replace.
 * @param section - the complete next user section.
 * @param expectedRevision - the descriptor `revision` the caller read; a
 *   namespace that moved past it rejects with {@link SettingsConflictError}.
 */
async replace(ns: SettingsNamespace, section: object, expectedRevision?: number): Promise<void>

/**
 * Apply path-addressed edits to one registered namespace's user section,
 * validate, persist, then commit and emit. The ops are applied to the
 * section as it stands when the write reaches the front of the queue, so a
 * caller never has to restate fields it did not touch — and, crucially,
 * cannot delete fields it never saw. This is the write path for any caller
 * holding a redacted view; `replace` remains the wholesale reset.
 * @param ns - the registered namespace to edit.
 * @param ops - ordered path edits; later ops observe earlier ones.
 * @param expectedRevision - the descriptor `revision` the caller read; a
 *   namespace that moved past it rejects with {@link SettingsConflictError}.
 */
async mutate(ns: SettingsNamespace, ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<void>
```

Source: [`packages/settings/settings/src/index.ts:350`](../../packages/settings/settings/src/index.ts)

<a id="settings-events"></a>

### `settings/*` events

<a id="settingsdocument-updated--emit"></a>

#### `settings/document-updated` — emit

One registered namespace's RAW user section changed, whether or not the resolved value did. `settings/updated` is the consumer-facing event and stays deep-equal-gated; this one exists for configuration surfaces, which must learn that a field went from inherited to overridden (same resolved value, different meaning) and that their held revision is stale. Listener containment matches `settings/updated`.

```ts cordis-catalog
/**
 * One registered namespace's RAW user section changed, whether or not the
 * resolved value did. `settings/updated` is the consumer-facing event and
 * stays deep-equal-gated; this one exists for configuration surfaces,
 * which must learn that a field went from inherited to overridden (same
 * resolved value, different meaning) and that their held revision is
 * stale. Listener containment matches `settings/updated`.
 * @param ns - the namespace whose stored section changed.
 * @param revision - the namespace's new revision.
 * @mode emit
 */
'settings/document-updated'(ns: SettingsNamespace, revision: number): void
```

Source: [`packages/settings/settings/src/types.ts:48`](../../packages/settings/settings/src/types.ts)

<a id="settingsupdated--emit"></a>

#### `settings/updated` — emit

Committed change to one registered namespace's resolved value. Emitted after the provider persisted (for `update`) or published (`provider`) the change; never emitted when the resolved value is deep-equal. Listener failures are contained and logged — a sync throw and an async rejection alike — except `INVARIANT`-coded failures, which rethrow after every listener ran; that rethrow reaches the emitter only from synchronous listeners, so invariant checks on this event must not be async functions.

```ts cordis-catalog
/**
 * Committed change to one registered namespace's resolved value. Emitted
 * after the provider persisted (for `update`) or published (`provider`)
 * the change; never emitted when the resolved value is deep-equal.
 * Listener failures are contained and logged — a sync throw and an async
 * rejection alike — except `INVARIANT`-coded failures, which rethrow
 * after every listener ran; that rethrow reaches the emitter only from
 * synchronous listeners, so invariant checks on this event must not be
 * async functions.
 * @param ns - the namespace whose resolved value changed.
 * @param next - the new resolved value.
 * @param prev - the previous resolved value.
 * @param source - whether the change entered through `update()` or the provider.
 * @mode emit
 */
'settings/updated'(ns: SettingsNamespace, next: unknown, prev: unknown, source: SettingsUpdateSource): void
```

Source: [`packages/settings/settings/src/types.ts:35`](../../packages/settings/settings/src/types.ts)
<!-- END GENERATED cordis-surface -->
