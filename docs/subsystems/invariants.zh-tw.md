# 執行時期不變式

[English](invariants.md) | 繁體中文

[dsh-invariants](../../packages/runtime-diagnostics/invariants) 是面向包自有執行時期不變式檢查的可設定登錄檔服務（`ctx.invariants`）。它是一個 support 組的包，不是三包能力 seam，也不屬於 agent loop（代理循環）主幹：登錄檔擁有選擇邏輯、名稱保留、子 fiber 生命週期和歸因到包的失敗，而每個工作區包發布一個 `./invariant` 配套外掛程式，以自己確切的 npm 包名註冊檢查。檢查可以斷言什麼（權威事件串流或可變資料，絕不是服務或方法是否存在）是 [AGENTS.md](../../AGENTS.md#conventions) 中的執行時期不變式約定；登錄檔設計由[不變式服務 Agent Note](../../.agents/notes/implemented/architecture/2026-07-19-package-owned-invariant-service.md)規定。

原始碼：[`packages/runtime-diagnostics/invariants/src/index.ts`](../../packages/runtime-diagnostics/invariants/src/index.ts)

## 選擇

```ts type-equiv
/** Runtime invariant selection configured on the service plugin. */
interface Config {
  /** Global switch; defaults to `true`. */
  readonly enabled?: boolean
  /** Case-sensitive JavaScript regex sources that admit package names; empty admits all. */
  readonly package_allowlist?: string[]
  /** Case-sensitive JavaScript regex sources that exclude package names after allowlist matching. */
  readonly package_blocklist?: string[]
}
```

一個包被選中的條件是：服務已啟用，允許清單為空或至少一個模式匹配其完整 npm 名稱，且沒有任何阻止清單模式匹配；阻止清單匹配優先於允許清單匹配。條目用 `new RegExp(source)` 編譯：除非模式自帶 `^` 和 `$`，匹配不錨定；`/pattern/flags` 文法不被解析。校驗在服務啟動時明確報錯：空白、首尾帶空白、重複或無效的條目會拋出例外，而不是被跳過。有效模式可以不匹配任何當前已載入的包，因此後續載入與 HMR（熱模組替換）保持確定性；過濾器在服務生命週期內固定不變（[README](../../packages/runtime-diagnostics/invariants/README.md)）。

## 安裝器

```ts type-equiv
/**
 * Throw a package-attributed invariant failure.
 * @param message - violated package contract without the standard prefix.
 * @returns never because reporting a violation throws.
 */
type InvariantFailure = (message: string) => never
```

```ts type-equiv
/** Install one package's checks into the registration's child context. */
interface InvariantInstaller {
  /**
   * Install the package contribution.
   * @param ctx - child context owned by this invariant registration.
   * @param fail - reporter bound to the registering package name.
   * @returns nothing, or a promise settling after asynchronous checks finish.
   */
  (ctx: Context, fail: InvariantFailure): void | Promise<void>
  /** Services the child installer fiber may access. */
  readonly inject?: Inject
}
```

被啟用的安裝器在專屬的子 Cordis fiber 中執行；`installer.inject` 聲明該 fiber 可以訪問的服務，註冊成功之前會先等待安裝器同步或非同步地執行完畢。`fail(message)` 拋出 `InvariantError`（`extends Error`，帶穩定的 `code: 'INVARIANT'`、所屬 `packageName`，以及前綴為 `invariant violated by "<package>": …` 的訊息），因此違規可歸因，而登錄檔無需匯入任何產品包。

## 服務

`ctx.invariants.register(packageName, installer)` 為完整 npm 包名保留唯一一個活躍註冊，並返回其綁定到 effect 的 disposer。即使過濾器使安裝器保持不活躍，保留依然成立，因此兩個外掛程式絕不可能靜默地認領同一個包名；重複、空白或含空白字元的名稱會拋出例外。安裝器失敗會原子地 dispose（資源釋放）子 fiber 並釋放保留。服務擁有每個註冊 fiber，而返回的 disposer 同時屬於配套外掛程式的 fiber：解除安裝任一側都會移除監聽器、trace 狀態和保留項，因此配套外掛程式可以重載並再次註冊同一名稱，不留殘餘狀態。

## 配套外掛程式約定

每個工作區包都擁有一個 `./invariant` 配套外掛程式（[包約定](../../packages/AGENTS.md)）；發布與註冊是窮盡式的，但刻意不合成斷言。只有當包擁有某個可觀察事件或某種可變資料關係時，配套外掛程式才安裝檢查；否則它匯出一個空安裝器，其起始註釋以 `No runtime invariant:` 開頭，針對該包具體解釋為什麼沒有可檢查項。`pnpm run verify-package-invariants` 機械地拒絕「生成文件」標記、無解釋的空安裝器、遺漏或忽略報告器的非空安裝器、錯誤的註冊名稱，以及不完整的匯出、發布、相依性或打包接線（[機械規則 Agent Note](../../.agents/notes/implemented/architecture/2026-07-19-package-invariant-runtime-contracts.md)）。可執行配套外掛程式的目錄與標準組合方式見[包 README](../../packages/runtime-diagnostics/invariants/README.md)。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxinvariants--invariantregistry"></a>

### `ctx.invariants` — `InvariantRegistry`

Package-owned invariant registry with global and regex-based selection.

```ts cordis-catalog
/**
 * Register one package's invariant installer. The package name is reserved
 * even when filtering disables its checks. Enabled installers run in a child
 * fiber; failure disposes that fiber and releases the reservation.
 * @param packageName - full npm package name that owns the contribution.
 * @param installer - listener or startup-check installer for the child context.
 * @returns an effect-scoped disposer for the registration.
 */
register(packageName: string, installer: InvariantInstaller): () => void
```

Source: [`packages/runtime-diagnostics/invariants/src/index.ts:94`](../../packages/runtime-diagnostics/invariants/src/index.ts)
<!-- END GENERATED cordis-surface -->
