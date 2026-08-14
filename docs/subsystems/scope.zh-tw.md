# 作用域註冊

[English](scope.md) | [简体中文](scope.zh.md) | 繁體中文

[scope 包](../../packages/core/scope)提供身份、載體與作用域層詞彙，使同一註冊上下文同時表達每個 agent（代理）的可見性和共享生命週期所有權。它是庫原語，而不是 Cordis 服務；生命週期設計理由由 [agent-scope 執行時期設計 Agent Note](../../.agents/notes/implemented/architecture/2026-07-12-agent-scope-runtime-design.md#scope-routing-one-opaque-key-selects-one-layer)規定，登錄檔層決策由[共享儲存 Agent Note](../../.agents/notes/implemented/architecture/2026-07-12-scoped-layers-store.md)規定，可呼叫 API 與過濾語義則由包 [README](../../packages/core/scope/README.md)規定。

原始碼：[`packages/core/scope/src/index.ts`](../../packages/core/scope/src/index.ts) 與 [`packages/core/scope/src/store.ts`](../../packages/core/scope/src/store.ts)。

## 身份標識與分發載體

`ScopeKey` 是一個不透明的對象身份標識。已交付的 agent loop（代理循環）使用活躍的 `Agent` 對象作為自身的 key，但該原語從不檢視該對象。

```ts type-equiv
/** An opaque, identity-compared scope key. */
type ScopeKey = object
```

`Scoped<T>` 是編譯期品牌標記，標注在 `scopeTarget(base, key)` 返回的不透明路由接收器上。作用域過濾的事件聲明要求以此載體作為 `this` 類型，而真正的事件主體仍作為顯式參數傳入。

```ts type-equiv
/**
 * A routing-only event receiver built by {@link scopeTarget}. The type
 * parameter records the subject type for dispatch checking; the carrier does
 * not expose the subject's properties. Event payloads carry the real subject.
 */
type Scoped<T extends object> = object & { readonly [ScopedBrand]: T }
```

## 擁有所有權的註冊上下文

`Scope` 將帶標籤的註冊上下文與兩個拆卸介面配對。`rawDispose` 保留有序複合 effect 所需的 Cordis disposer 的確切身份；`dispose()` 是面向直接呼叫方和競態呼叫方的公共完全靜止邊界。

```ts type-equiv
/** A minted registration scope and its quiescent disposal boundaries. */
interface Scope {
  /** Context through which scope-owned registrations are made. */
  ctx: Context
  /** Exact Cordis disposer, used when nesting this scope in an ordered composite effect. */
  rawDispose: () => Promise<void> | void
  /** Dispose every scope-owned registration; racing calls await the same completion. */
  dispose(): Promise<void>
}
```

## 帶作用域的登錄檔層

`ScopeLayer` 表示一個登錄檔在全域性或確切作用域層級的完整貢獻。具體 layer 可以聚合多個具名與匿名 table；整個 layer 為空時，`ScopedLayers` 可以回收帶作用域狀態，而不會丟棄兄弟 table。

```ts type-equiv
/** One scope's aggregate contribution to a registry. */
interface ScopeLayer {
  /** Whether every table in this layer is empty. */
  isEmpty(): boolean
}
```

`ScopedLayers<L>` 擁有立即建立的全域性 layer，以及惰性建立的確切作用域 layer。讀取不會建立 layer：`peek(undefined)` 表示不存在作用域覆蓋層，而 `merge()` 會依次物化按插入順序排列的全域性具名條目和帶作用域的遮蔽項。註冊使用同一個上下文表示可見性與 Cordis effect 所有權，在選填通知前取得一個同步撤銷函式，返回 Cordis 的原始 disposer，並且只在帶作用域 layer 的完整 `ScopeLayer` 為空時回收它。

`NamedEntries<V>` 提供按插入順序的尋找和動態迭代，重複項錯誤由呼叫方處理。`AnonymousEntries<V>` 為每次 append 分配唯一標識，因此值相等的條目仍彼此獨立。在同一輪非空 table 生命週期內，迭代器可以觀察後續變化；table 被清空後，現有迭代器不會再觀察後續插入。兩者都返回冪等、精確對應相應條目的撤銷函式；共享實作介面 `EntryValues` 不對外公開。
