# Skills

[English](skills.md) | [简体中文](skills.zh.md) | 繁體中文

[skill（技能）能力族](../../packages/skill) 包含 Service Definition（[dsh-skill](../../packages/skill/skill)，`ctx.skills`）、本機 Service Provider（[dsh-skill-filesystem](../../packages/skill/skill-filesystem)）、選填的隨包徽章提供方（[dsh-skill-badge](../../packages/skill/skill-badge)）和 Consumer（[dsh-tool-skill](../../packages/skill/tool-skill)）。登錄檔在其宿主層與各 scope 層之間合併各提供方的目錄；提供方貢獻本機或隨包 skill；Consumer 擁有初始目錄和替換目錄，以及面向模型的 `skill` 工具。skill 是選填的指令而非工作階段事件，因此其詞彙定義在此處而非 [core.md](core.md)。

原始碼：[`packages/skill/skill/src/index.ts`](../../packages/skill/skill/src/index.ts)、[`packages/skill/skill-filesystem/src/index.ts`](../../packages/skill/skill-filesystem/src/index.ts)、[`packages/skill/skill-badge/src/index.ts`](../../packages/skill/skill-badge/src/index.ts) 與 [`packages/skill/tool-skill/src/index.ts`](../../packages/skill/tool-skill/src/index.ts)。

## 提供方登錄檔

`ctx.skills` 組合本機、內嵌、遠端或其他提供方。註冊是同步的；遠端初始化與發現屬於 `list()` 的 await 階段。提供方對象、選項與候選項以只讀方式借用，語義欄位會被校驗。

登錄檔採用宿主 + 按 scope 的分層結構，即[工具登錄檔](tools.md)在 [dsh-scope](../../packages/core/scope) 之上確立的形態：註冊會落入呼叫方上下文 scope 對應的層——宿主行與 repository 外掛程式落入全域性層，由 agent（代理） preset 常駐組合掛載的外掛程式落入該 preset 的層——提供方名稱在每層內唯一，而非行程級唯一。讀取時將全域性層與觀察 scope 的鏈合併：最近層的條目直接贏得重名 skill，下文的 rank 順序只在單層內裁決重名。發現快取以解析後的 scope 鏈為鍵，因此重設 scope 父級（空工作階段重組）無需登錄檔變更即可被下一次讀取看到。

在單層內，重名項依次按 rank、提供方順序和本機順序確定優先級；摘要按名稱排序。提供方的 `list()` 被拒絕時，系統會記錄日誌，並從不完整觀測中省略該提供方的結果；顯式的不完整觀測會提供可用候選項，但不會使結果變得可快取；格式錯誤的候選項快速失敗。每個提供方工廠都會接收一項註冊作用域內的控制能力；僅當該精確註冊仍處於活動狀態時，其 `invalidate()` 才會清除已完成目錄；註冊失敗或 dispose（資源釋放）時，其訊號會中止。若提供方代次在發現進行期間發生變化，該發現會重試一次；若再次變化，則返回最新候選項，並將結果標為不完整且不予快取。提供方和執行時期變更會發出不帶過濾條件的 `skills/change` 失效事件；該事件不攜帶 diff，因此消費端會使用自身的尋找選項重新取得 `snapshot()`。

`SkillProvider.list()` 返回的陣列是完整發現的簡寫形式。`SkillProviderObservation` 允許提供方公開仍可直接載入的候選項，同時報告該觀測不具權威性。

```ts type-equiv
/** Provider candidates plus whether the current discovery is authoritative. */
interface SkillProviderObservation {
  /** Candidates available from the current provider discovery. */
  readonly candidates: readonly SkillCandidate[]
  /** Whether discovery completed and these candidates may be cached. */
  readonly complete: boolean
}
```

```ts type-equiv
/** Provider interface for one source of skills, such as local directories or a remote registry. */
interface SkillProvider {
  /** Unique provider name in the `ctx.skills` registry. */
  readonly name: string
  /**
   * List available skill candidates for the current lookup context. Provider
   * plugins register synchronously during `apply()`; remote initialization,
   * authentication, and discovery are awaited inside this method. Implementations
   * should settle promptly when `options.signal` aborts.
   * @param options - lookup options; `cwd` selects workspace-sensitive skills and `signal` cancels work.
   * @returns provider candidates as a complete-array shorthand, or an explicit
   *   observation when usable candidates came from incomplete discovery.
   */
  readonly list: (options: SkillLookupOptions) => Promise<readonly SkillCandidate[] | SkillProviderObservation>
  /**
   * Load a complete skill body for a previously listed candidate.
   * @param candidate - the winning candidate originally returned by this provider.
   * @param options - lookup options; `cwd` selects workspace-sensitive skills and `signal` cancels work.
   * @returns the full skill body, or `undefined` if it is no longer loadable.
   */
  readonly get: (candidate: SkillCandidate, options: SkillLookupOptions) => Promise<SkillDefinition | undefined>
}
```

```ts type-equiv
/** Registration-scoped lifecycle and invalidation capability borrowed by one provider. */
interface SkillProviderControl {
  /** Aborts if registration fails or when the exact provider registration is disposed. */
  readonly signal: AbortSignal
  /** Invalidate completed catalogs and notify consumers only while the exact registration remains active. */
  readonly invalidate: () => void
}
```

## 本機發現優先級

隨附的本機提供方按 rank 順序掃描各根目錄：

| Rank | Source | Root |
|---|---|---|
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` |
| 300 | `custom` | `Config.customSkillDirs` |
| 400 | `user-dsh` | `<dshHome>/skills` |
| 500 | `user-agents` | `<agentsHome>/skills` |
| 600 | `bundled` | 設定了 `Config.bundledSkillDir` 時使用該目錄 |

項目根目錄為包含 `.git` 的最近祖先目錄；找不到時使用當前 cwd。當 `ctx.fs` 可用時，git-root 向上尋找透過檔案系統服務探測 `.git`，使遠端或沙盒工作區不會回退到宿主檔案系統邊界。使用者 DSH 根目錄會跳過其 `.system` 子目錄。本機提供方不會合成內建系統 skill；部署方透過已設定的 bundled 根目錄或專用提供方提供隨包 skill。

`dsh-skill-badge` 在 `BUNDLED_SKILL_RANK` 註冊一個不可變的 `bundled` 候選項，並透過 `resourceBase` 公開其隨包資產目錄。交付的 CLI（命令列介面）將該外掛程式聲明為停用，因此啟用其組合設定行即為顯式選擇加入。

Chokidar 會監視現有根目錄中直屬 bundle 和平鋪條目的新增與移除，以及直屬 skill 條目的變更。缺失的根目錄會從最近的現有祖先開始，逐個跟蹤缺失路徑段，直至 Chokidar 可以附加。bundle 下的資源文件變更不屬於目錄變更。面向模型的 `write` 和 `edit` 觀測會在目標路徑與目錄相關時同步使提供方目錄失效，而宿主 watcher 覆蓋 IDE、Git、shell 和外部行程產生的變更。watcher 失敗會使當前觀測不完整，但不會在直接載入時隱藏可讀候選項；項目作用域 watcher 使用按設定設限的 LRU。

## skill 身份

skill 名稱為 kebab-case（`^[a-z0-9]+(?:-[a-z0-9]+)*$`）。本機提供方接受目錄包（`<name>/SKILL.md`）和扁平 Markdown 文件（`<name>.md`）。巢狀遞迴的 `**/SKILL.md` 發現不受支持。

```ts type-equiv
/** Origin bucket for a skill contribution. The value is prompt-visible metadata, not precedence by itself. */
type SkillSource = 'project-dsh' | 'project-agents' | 'runtime' | 'user-dsh' | 'user-agents' | 'custom' | 'bundled' | (string & {})
```

## 摘要、候選項與完整定義

`SkillSummary` 是登錄檔中與呼叫策略無關的摘要形狀。消費端自行選擇渲染哪些條目和欄位；模型工作階段目錄僅使用模型可呼叫 skill 的 `name` 和 `description`，從不使用正文或絕對檔案路徑。`SkillInvocationPolicy` 將兩個獨立呼叫控制規範化為正向布林值，且每個已解析的摘要、候選項和定義都攜帶該策略，而不會把任意 frontmatter 納入領域模型。

```ts type-equiv
/** Invocation controls shared by skill discovery consumers. */
interface SkillInvocationPolicy {
  /** Whether model-facing catalogs and loaders include this skill. */
  readonly modelInvocable: boolean
  /** Whether human-facing command catalogs and loaders include this skill. */
  readonly userInvocable: boolean
}
```

```ts type-equiv
/** Invocation-neutral skill metadata returned by `ctx.skills.list()`. */
interface SkillSummary {
  /** Kebab-case identifier used to address the skill. */
  readonly name: string
  /** Short routing description shown by discovery consumers. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** Resolved model and user invocation controls. */
  readonly invocation: SkillInvocationPolicy
  /** Discovery source that produced this winning skill. */
  readonly source: SkillSource
  /** Provider that owns this skill body. */
  readonly provider: string
  /** Provider-specific base for relative resources. */
  readonly resourceBase?: SkillResourceBase
}
```

`ctx.skills.list()` 保留全部四種策略組合。`isModelInvocable(skill)` 和 `isUserInvocable(skill)` 分別讀取對應的必填欄位。僅供模型呼叫的 skill 設定 `{ modelInvocable: true, userInvocable: false }`，僅供使用者呼叫的 skill 設定 `{ modelInvocable: false, userInvocable: true }`，兩個欄位均設為 `false` 後，該 skill 只能由受信的 `ctx.skills.get()` 呼叫方取得。本機提供方讀取名稱完全匹配的 kebab-case frontmatter 鍵 `disable-model-invocation` 和 `user-invocable`，將省略的欄位預設為 `true`，並為每個解析出的 skill 生成這個規範化策略。

`SkillCatalogSnapshot` 用於區分已確定的不存在與提供方的瞬時失敗或發現期間持續變化的目錄。`skills` 包含該次觀測中收集、排序且與呼叫策略無關的摘要；只有每個已註冊提供方都在沒有並行目錄修訂時完成發現，`complete` 才為 true。不完整快照不會快取，因此每個消費端可以保留上一份經過自身過濾的可用目錄並重試。

```ts type-equiv
/** One catalog observation plus whether discovery completed within a stable catalog revision. */
interface SkillCatalogSnapshot {
  /** Sorted invocation-neutral summaries collected in this observation. */
  readonly skills: SkillSummary[]
  /** Whether every registered provider completed without a concurrent catalog revision. */
  readonly complete: boolean
}
```

`SkillCandidate` 是提供方到登錄檔的形狀。`locator` 是提供方的不透明狀態；登錄檔只儲存它並在呼叫獲勝提供方的 `get()` 時傳回。

```ts type-equiv
/** Provider catalog entry used by the registry to merge and later load skills. */
interface SkillCandidate extends SkillSummary {
  /** Lower ranks win duplicate skill names before provider registration order is considered. */
  readonly rank: number
  /** Opaque provider-owned handle passed back to `provider.get()`. */
  readonly locator: unknown
  /** Absolute file path when the provider has one. */
  readonly path?: string
  /** Parsed optional metadata object from provider-specific skill frontmatter. */
  readonly metadata?: Readonly<Record<string, unknown>>
}
```

`SkillDefinition` 是 `ctx.skills.get()` 返回的完整解析結果，供 `skill` 工具使用。`resourceBase` 告知工具如何為本機、URL 或提供方管理的 skill 渲染相對資源引導。

```ts type-equiv
/** Optional provider-specific base used by loaded skill bodies to resolve relative resources. */
type SkillResourceBase =
  | { readonly kind: 'directory'; readonly path: string }
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'opaque'; readonly description: string }
```

```ts type-equiv
/** Complete parsed skill definition, including the body loaded by `ctx.skills.get()`. */
interface SkillDefinition extends SkillSummary {
  /** Markdown instruction body after any provider-specific metadata removal. */
  readonly content: string
  /** Absolute file path when the skill came from disk. */
  readonly path?: string
  /** Parsed optional metadata object from frontmatter. */
  readonly metadata?: Readonly<Record<string, unknown>>
}
```

執行時期 skill 輸入可以省略呼叫控制和提供方標籤。登錄檔會一次性補全這兩項預設值，隨後使用與提供方相同的完整定義形狀和先到先得收集順序。返回的 disposer 移除該貢獻並使發現快取失效。

```ts type-equiv
/** Runtime skill contribution accepted by `ctx.skills.register()`. */
type SkillRegistration = Omit<SkillDefinition, 'invocation' | 'provider'> & {
  /** Invocation controls; omission permits both model and user surfaces. */
  readonly invocation?: SkillInvocationPolicy
  /** Provider label; omission uses the registry-owned runtime provider. */
  readonly provider?: string
}
```

## 尋找與設定

skill 尋找對 cwd 敏感，因為提供方可能暴露工作區本機的 skill；選填的 signal 為呼叫方取消提供方的工作。登錄檔讀取還透過 `SkillViewOptions` 攜帶觀察 scope——消費端傳入呼叫中的 agent，agent 本身就是自己的 scope key；登錄檔消費 `scope` 做層選擇，提供方只從同一個借用的選項對象中讀取其 `SkillLookupOptions` 約定。取消在目錄選擇前後（包括快取命中時）都會檢查，並與發現和完整定義載入競爭。如果找不到 git root，本機提供方將所提供的 cwd 本身視為項目根目錄。

登錄檔不快取完整定義。每次呼叫 `get()` 都會攜所選候選項呼叫勝出提供方，因此本機提供方會重新讀取當前正文。名稱與該候選項不再匹配的定義會被拒絕，並使該提供方實例失效以便重新發現。

```ts type-equiv
/** Caller context used for cwd-sensitive and abortable provider work. */
interface SkillLookupOptions {
  /** Workspace selector for the current lookup. */
  readonly cwd?: string | undefined
  /** Abort discovery or loading work for the current caller. */
  readonly signal?: AbortSignal | undefined
}
```

```ts type-equiv
/**
 * Registry read options: provider lookup context plus the viewing scope.
 * The registry consumes `scope` to select layers; providers receive the same
 * borrowed options object and read only their {@link SkillLookupOptions}
 * contract from it.
 */
interface SkillViewOptions extends SkillLookupOptions {
  /** Viewing scope (the calling agent); omitted reads the global layer alone. */
  readonly scope?: ScopeKey | undefined
}
```

登錄檔只擁有其發現快取上限。本機提供方擁有檔案系統根目錄（`dshHome`、`agentsHome`、`customSkillDirs`，以及選填的 `bundledSkillDir`/`DSH_BUNDLED_SKILL_DIR`），以及 watcher 啟用、輪詢、穩定性、符號連結和項目容量控制。消費端擁有其目錄描述上限。確切的預設值和校驗規則見自動生成的[外掛程式設定目錄](../config-catalog.md)。

```ts type-equiv
/** Skill registry configuration. */
interface Config {
  /** Maximum number of completed cwd/provider catalogs kept in memory. */
  readonly collectCacheMaxEntries?: number
}
```

## 工作階段目錄與工具約定

`dsh-tool-skill` 在存活工作階段中第一個觀察到非空完整檢視表的 `agent/pre-step` 注入初始的持久 user-role `<system-reminder>`。目錄只包含已排序的 skill `name` 和規範化、經 XML 轉義的 `description`；不包含正文、路徑、來源、提供方或路由提示。發現透過 `SkillLookupOptions` 轉發該步驟的 abort signal。`catalogDescriptionMaxLength` 是消費端用於 description 上限的設定，預設值為 `500`，整數最小值為 `3`。

在後續每個模型步驟之前，消費端都會應用精確的工具可見性，並對完整快照中 `<available_skills>` 標籤之間精確渲染的條目計算 digest。它以該外掛程式所發布、最新一條可識別且仍可見的目錄訊息中的相同條目作為比較基線。digest 發生變化時，會透過 `agent.inject()` 追加一條持久的完整目錄替換；刪除所有 skill 時會追加一條顯式的空替換。不完整快照會保留上一份可用模型檢視表。如果壓縮（compaction）隱藏了所有歷史目錄訊息，下一份完整快照會重新建立當前目錄；如果檢視表為空且從未發布目錄，則不傳送任何內容。這些目錄訊息屬於工作階段歷史，而非 World State。

面向模型的 `skill({ name })` 工具校驗 kebab-case 名稱，在與呼叫策略無關的目錄中尋找摘要，並在載入前透過 `isModelInvocable` 拒絕無權訪問的 skill；隨後它根據呼叫方 agent 的 cwd 重新讀取完整定義，並在返回內容前再次檢查策略。該工具將無法解析的 skill 報告為未知或已不可用，並返回包含 `<skill_content name="...">`、`<skill_resources>` 和 `<skill_instructions>` 的工具結果。`resourceBase` 僅按需解析顯式引用的指令碼、參考資料和資產；載入結果不枚舉 skill 目錄。因此，僅修改正文會改變後續工具呼叫，而不會生成目錄訊息或改寫先前工具結果。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxskills--skillregistry"></a>

### `ctx.skills` — `SkillRegistry`

Layered registry of skill providers, the host+per-scope shape the tools registry established. A registration files into the layer of its calling context's scope (scopeOf): host rows and repository plugins land in the global layer, while a plugin mounted by an agent preset's standing composition lands in that preset's layer. A read merges the global layer with the viewing scope's chain — the nearest layer's entry wins a duplicate name outright, and the rank order decides duplicates only within one layer. It exposes sorted invocation-neutral summaries and loads full skill bodies on demand.

```ts cordis-catalog
/**
 * Register a borrowed same-process provider synchronously during plugin
 * apply, into the calling context's layer: a scoped context (an agent
 * preset's standing mount) registers for that scope alone, an unscoped
 * context registers globally. Duplicate names within one layer and reserved
 * names throw; remote initialization belongs in `list()`. Fiber disposal
 * unregisters the provider and invalidates catalog caches.
 * @param create - synchronous factory receiving this registration's lifecycle and invalidation control.
 * @returns the exact Cordis effect disposer that unregisters this provider;
 *   composite effects may yield it directly to preserve teardown ordering.
 */
registerProvider(create: (control: SkillProviderControl) => SkillProvider): () => void

/**
 * Register a borrowed readonly runtime skill into the calling context's
 * layer. Project entries outrank runtime entries, which outrank user
 * entries, within one layer. Same-name runtime entries in one layer are
 * first-wins; a duplicate logs a warning and receives a no-op disposer so
 * it cannot remove the winner.
 * @param skill - the skill definition input; omitted invocation and provider fields receive defaults.
 * @returns the exact Cordis effect disposer, preserving composite teardown order and invalidating caches.
 */
register(skill: SkillRegistration): () => void

/**
 * List invocation-neutral skill summaries for a workspace. Consumers apply
 * model or user invocation policy at their operational boundary. Lookup
 * options and provider candidates are readonly same-process values borrowed
 * throughout discovery.
 * @param options - view options; `scope` selects the viewing agent's layers, `cwd` selects project roots, and `signal` cancels discovery.
 * @returns all sorted winning summaries.
 */
async list(options: SkillViewOptions = {}): Promise<SkillSummary[]>

/**
 * Observe the current invocation-neutral catalog and whether discovery completed within a stable revision.
 * Incomplete observations are never cached, allowing consumers to retain last-good state and
 * retry on their next request boundary.
 * @param options - view options; `scope` selects the viewing agent's layers, `cwd` selects project roots, and `signal` cancels discovery.
 * @returns sorted summaries plus discovery-completeness state.
 */
async snapshot(options: SkillViewOptions = {}): Promise<SkillCatalogSnapshot>

/**
 * Load and validate the winning candidate, passing its opaque discovery locator back to the
 * provider. Cancellation is rechecked after selection, including cache hits, and raced against
 * loading so an uncooperative provider cannot hang the caller.
 * @param name - kebab-case skill name.
 * @param options - view options; `scope` selects the viewing agent's layers,
 *   `cwd` selects workspace-sensitive skills, and `signal` cancels work.
 * @returns the full skill, including body content, or `undefined`.
 */
async get(name: string, options: SkillViewOptions = {}): Promise<SkillDefinition | undefined>
```

Source: [`packages/skill/skill/src/index.ts:357`](../../packages/skill/skill/src/index.ts)

<a id="skills-events"></a>

### `skills/*` events

<a id="skillschange--emit"></a>

#### `skills/change` — emit

A skill provider, runtime contribution, or provider-backed catalog may have changed. This is an unfiltered invalidation notification; consumers refetch the catalog for their own lookup options. Listener failures are contained and cannot veto the registry mutation.

```ts cordis-catalog
/**
 * A skill provider, runtime contribution, or provider-backed catalog may
 * have changed. This is an unfiltered invalidation notification; consumers
 * refetch the catalog for their own lookup options. Listener failures are
 * contained and cannot veto the registry mutation.
 * @mode emit
 */
'skills/change'(): void
```

Source: [`packages/skill/skill/src/index.ts:297`](../../packages/skill/skill/src/index.ts)
<!-- END GENERATED cordis-surface -->
