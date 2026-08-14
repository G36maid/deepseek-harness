# 權限預設

[English](permission-presets.md) | [简体中文](permission-presets.zh.md) | 繁體中文

[dsh-permission-presets](../../packages/interaction/permission-presets) 的權限預設層（`ctx.permissionPresets`，`PermissionPresetService`）把兩個相互獨立的強制執行 knob，即[沙盒模式](sandbox.md)（`sandbox/mode`）與[審批策略](approval.md)（`approval/policy`），捆綁成具名預設，供用戶端作為單個權限（Permissions）選擇器提供。它是一項選填能力，不屬於 agent loop（代理循環）主幹，也不擁有任何強制執行：執行、提示詞敘述與重播仍然讀取各自 knob的摺疊結果，預設切換只記錄意圖，並透過每個 knob各自的規範 setter 寫入。[包 README](../../packages/interaction/permission-presets/README.md) 負責組合狀態與限制；[沙盒切換設計](../../.agents/notes/implemented/feature/2026-07-06-sandbox.md)負責決策依據。

原始碼：[`packages/interaction/permission-presets/src/index.ts`](../../packages/interaction/permission-presets/src/index.ts)

## 預設表

預設是一個表鍵，對映到一個沙盒／審批組合，外加選填的用戶端展示資訊；預設預設表自帶 `workspace-write`（`workspace-write` + `ask`）和 `danger-full-access`（`danger-full-access` + `never`）。

```ts type-equiv
/** One preset's sandbox/approval bundle and optional client presentation. */
interface PresetSpec {
  /** The `sandbox/mode` value the preset writes through. */
  sandbox: SandboxMode
  /** The `approval/policy` value the preset writes through. */
  approval: ApprovalPolicy
  /** The display label a client shows for this preset; the raw table key when omitted. */
  name?: string
  /** One user-facing sentence on what the preset means; omitted when not configured. */
  description?: string
}
```

```ts type-equiv
/** The {@link PermissionPresetService} config: preset table and composition default. */
interface Config {
  /**
   * The preset table: name → knob bundle. Defaults to `workspace-write`
   * (workspace-write + ask) and `danger-full-access` (danger-full-access +
   * never). The name `custom` is reserved for the derived not-a-preset state.
   */
  presets?: Record<string, PresetSpec>
  /**
   * Default for new sessions. When omitted, the preset matching the composed
   * sandbox and approval defaults is used.
   */
  defaultPreset?: string
}
```

該服務要求一個施加隔離的 `ctx.shell` 執行器和 `ctx.approval`，設定錯誤在外掛程式載入時即失敗：名為 `custom` 的表項會拋出例外（該名稱保留給派生的「非預設」狀態）；在不施加隔離的 bash 執行器（沒有 `sandboxMode` 能力事實）之上組合同樣拋出例外，因為預設捆綁了一個沙盒模式。

## 當前預設與派生的 `custom`

`current(events)` 從 knob 派生實際生效的預設，而不是隻看自身事件：它摺疊工作階段的生效沙盒模式（回退到執行器設定的模式）與生效審批策略（先回退到審批服務設定，再回退到 `ask`），優先取仍然匹配的已記錄選擇，其次取聲明順序中第一個匹配的表項，否則返回 `CUSTOM_PRESET`（`'custom'`）。`custom` 只是派生值：用戶端可以把它顯示為當前值，但它絕不是切換目標，也絕不出現在事件 payload 中。

`names` 按預設表聲明順序列出可切換的預設；`optionOf(name)` 為某個表鍵（label 回退為該鍵）或 `custom` 建置用戶端算繪的選項，傳入其他任何名稱都會拋出例外。

```ts type-equiv
/** The select-option shape a presentation layer advertises for one preset (or for the derived `custom` state). */
interface PresetOption {
  /** Stable option value: the table key, or `custom`. */
  value: string
  /** The display label. */
  name: string
  /** One user-facing sentence on what the value means; omitted when not configured. */
  description?: string
}
```

## 切換與 `permission/preset` 事件

`set(session, name)` 解析預設（未知名稱拋出例外），在 `name` 尚不是生效預設時追加一條僅記日誌的 `permission/preset` 事件，然後透過各旋鈕自己的 setter（[dsh-sandbox-policy](../../packages/sandbox/sandbox-policy) 的 `setSandboxMode` 與 [dsh-user-approval](../../packages/interaction/user-approval) 的 `setApprovalPolicy`）寫入，且僅當該 knob的生效值發生變化時才寫。同一輪次內，選擇事件先於旋鈕事件出現；重新選擇當前生效的預設則什麼都不追加。

`permission/preset` 是持久、僅記日誌的使用者意圖：它不進入模型 transcript（文字記錄），模型可見的後果由 knob 事件經各自消費端承擔；它存在是為了在兩個預設共享同一個旋鈕組合時，讓 `current()` 仍能保住使用者選擇的究竟是哪一個預設；`effectivePermissionPreset(events)` 摺疊最後一條，重播不需要任何追趕狀態。完整事件聲明見[持久化日誌事件目錄](../persistence-catalog.md)；方法簽名見生成的[服務目錄](#ctxpermissionpresets--permissionpresetservice)。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxpermissionpresets--permissionpresetservice"></a>

### `ctx.permissionPresets` — `PermissionPresetService`

Owns the deployment's permission presets and their write path. Requires a confining `ctx.shell` executor and `ctx.approval`; unmatched knob values are reported as CUSTOM_PRESET, not an error.

```ts cordis-catalog
/**
 * Resolve the preset matching the effective knob values. A still-matching
 * last selection wins shared-bundle ties; otherwise the first table match
 * wins, or {@link CUSTOM_PRESET} when no entry matches.
 * @param events - the session's events in log order.
 * @returns the effective preset name, or `custom` when nothing matches.
 */
current(events: readonly SessionEvent[]): string

/**
 * Build the whole select value for one folded knob state: every table
 * option in declaration order, `custom` appended exactly while derived.
 * @param state - the folded knob overrides.
 * @returns the `permissions` projection payload.
 */
selectFor(state: KnobState): PermissionSelect

/**
 * Resolve a preset's knob bundle.
 * @param name - the preset name to resolve.
 * @returns the configured bundle.
 * @throws when `name` is not in the table.
 */
resolve(name: string): PresetSpec

/**
 * Build the client option for a table entry or {@link CUSTOM_PRESET}. A
 * missing label falls back to the table key.
 * @param name - a table key, or `custom`.
 * @returns the option a client renders.
 * @throws when `name` is neither a table key nor `custom`.
 */
optionOf(name: string): PresetOption

/**
 * Record a changed preset, then update each changed knob through its own
 * setter. Selecting the effective preset again appends nothing.
 * @param session - the session the switch belongs to.
 * @param name - the preset to switch to; unknown names throw.
 */
set(session: Session, name: string): void
```

Types: [Session](session.md) · [SessionEvent](session.md)

Source: [`packages/interaction/permission-presets/src/index.ts:159`](../../packages/interaction/permission-presets/src/index.ts)
<!-- END GENERATED cordis-surface -->
