# dsh-scope

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

帶作用域的註冊原語。`createScope(ctx, key)` 建立一個帶標籤的 Cordis 上下文，其底層 fiber 擁有透過該上下文進行的每項註冊。`scopeOf(ctx)` 讀取標籤；`scopeTarget(base, key)` 將帶作用域的事件路由到鍵相同的監聽器，同時讓無作用域監聽器保持全域性可見。鍵可以構成選填的父鏈（`bindScopeParent`）：註冊檢視表沿鏈**向下**繼承——子作用域看得見祖先各層，近者遮蔽遠者——事件放行沿鏈**向上**擴充——標籤為祖先的監聽器能收到子孫鍵的事件，反向永不成立。agent loop（代理循環）為每個存活的 agent 建立一個作用域，agent preset 的常駐掛載則是其 agent 們的父作用域，但該機制與鍵的具體含義無關，底層包無需相依性兩者即可使用。

## 公開 API

- `createScope(ctx: Context, key: ScopeKey, options?): Scope`：在 `ctx` 的 fiber 下建立作用域。可以同步使用（effect 收集受 uid 閘門約束；服務解析會沿建立該作用域的外掛程式相依性範圍繼續尋找）。同行程、帶類型的鍵受信任；處於非活動狀態的建立上下文仍會透過 Cordis 失敗（`INACTIVE_EFFECT`）。`options.parent` 在作用域可用之前經 `bindScopeParent` 綁定其外圍作用域；綁定控制代碼不外洩。
- `bindScopeParent(key, parent): ScopeParentBinding` / `scopeParentOf(key)` / `scopeChainOf(key)`：支撐兩條鏈方向的父關係。綁定僅此一次：已有父級的鍵直接拋錯，只有返回的綁定控制代碼的 `rebind(parent)` 才能重新綁定父級——即空白工作階段 recompose 的操作，僅當舊父之下產出的東西一概不被保留時才合法（這是持有方的約定——該關係看不見工作階段記錄了什麼）。綁定與每次 rebind 都拒絕會閉環的連結。`scopeChainOf` 返回 `[key, parent, …]`，最近者在前。
- `Scope.ctx`：帶標籤的上下文。透過它進行的註冊既具備作用域可見性，也服從作用域生命週期。派生上下文（一次 `extend`、掛載於其下的 fiber）繼承標籤；巢狀作用域會遮蔽外層標籤（最近的標籤生效）。
- `Scope.rawDispose`：底層 fiber 的確切 Cordis disposer。組合式（generator）effect 會 yield 此函式，從而把作用域 teardown 巢狀在該 yield 位置（Cordis 按函式標識去重巢狀 effect；yield 一個包裝函式會使作用域 teardown 成為平行的同級操作）。
- `Scope.dispose(): Promise<void>`：透過作用域進行的每項註冊所共用的冪等完全靜止邊界。競態呼叫或重複呼叫會等待同一次 teardown；即使 `rawDispose` 先呼叫了底層單次 Cordis disposer 也是如此。
- `scopeOf(ctx: Context): ScopeKey | undefined`：上下文或其任意派生上下文攜帶的標籤；`undefined` 表示上下文全域性。
- `scopeTarget(base: T, key: ScopeKey | undefined): Scoped<T>`：為按作用域篩選的事件構造不透明分發 `thisArg`。它把 `base` 現有的 `Context.filter` 與作用域謂片語合起來（無標籤監聽器 ⇒ 放行；有標籤監聽器 ⇒ 僅當標籤 === key，或標籤為 key 的祖先時放行；`key === undefined` ⇒ 僅放行無標籤監聽器）。載體只包含路由狀態；真實主體由事件參數攜帶。帶 `{ global: true }` 的監聽器繞過篩選（Cordis 語義）。
- `Scoped<T>`：編譯期不透明載體 brand。按作用域篩選的事件要求它作為 `this` 類型，因此使用裸主體分發會產生編譯錯誤。類型參數記錄主體類型，但不公開其屬性。
- `isScopeCarrier(value)`/`carrierKeyOf(value)`：執行時期載體標記，開發不變式使用它們斷言每次按作用域篩選的分發都攜帶載體，而且載體鍵與參數所指名的主體一致。
- `ScopeLayer`：一個登錄檔的完整全域性貢獻或精確作用域貢獻的聚合約定；`isEmpty()` 控制帶作用域層的回收。
- `ScopedLayers<L>`：持有一個立即構造的全域性層與惰性的精確作用域層。`peek()` 從不建立且刻意不看鏈（某作用域**自己**的貢獻——限制、守衛——不得悄悄繼承祖先的），`chainLayers()` 按最遠祖先在前返回已存在的各層，`merge()` 沿鏈物化按插入序的具名遮蔽，`effect()` 從同一上下文推導可見性與所有權，並返回精確的 Cordis disposer。
- `NamedEntries<V>`：按插入順序排列的具名儲存，呼叫方擁有重複項診斷、尋找，以及一個非空表世代內的即時迭代。表清空後，現有迭代器與後續插入項脫離；`insert()` 返回冪等的精確條目撤銷函式。
- `AnonymousEntries<V>`：按插入順序排列的匿名儲存；唯一內部鍵使相同值仍作為獨立註冊存在。它使用相同的清空世代迭代器邊界；`append()` 返回冪等的精確條目撤銷函式。

選填配套包 `@deepseek-ai/dsh-scope/invariant` 擁有該執行時期斷言。它使用生成的 `scoped-events.generated.ts` 解析器對映，要求每個已聲明的帶作用域事件都攜帶載體；當 payload 公開路由主體時，還要求路由主體與載體鍵嚴格相等。基於 Program 的生成器根據事件聲明和真實的 `scopeTarget(base, key)` 呼叫生成該對映。

## 設計約定

註冊上下文同時決定可見性和所有權，防止註冊在一個作用域中可見、卻隨另一個作用域 dispose（資源釋放）。作用域用於路由受信任的同行程外掛程式；它們不是沙盒或權限邊界。原理與明確排除的安全目標見 [agent 作用域 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-08-agent-scope-contexts.md#security-and-authority-are-non-goals)。

感知作用域的服務會定義具體 `ScopeLayer`，聚合各自不同的表與領域輔助函式。`ScopedLayers.effect()` 接受一個返回同步撤銷函式的同步動作，在選填通知前安裝該撤銷函式，並且只有在完整聚合為空時纔回收精確作用域層。`notify` 預設為 `true`；由所提供的回呼決定觀測方失敗是向外拋出還是在內部處理。`EntryValues` 保持內部可見；儲存類從包根而非 `/store` 子路徑匯入；共享儲存不定義登錄檔專屬的篩選或迭代策略。詳見[共享作用域層儲存 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-12-scoped-layers-store.md)。

交出帶作用域的上下文，也會交出建立該上下文的外掛程式的服務解析範圍（解析會沿建立者 fiber 的相依性鏈，而非持有者的相依性鏈行進），因此應由具備這些帶作用域註冊所需相依性的外掛程式來建立它。

## 已知限制與暫緩事項

- **只有感知作用域的表層才會隔離狀態**：登錄檔必須按 `scopeOf()` 封存，事件必須透過 `scopeTarget()` 分發；僅僅透過帶作用域的上下文呼叫任意 Cordis 服務，並不會改變該服務仍為上下文全域性這一事實。
- **一個上下文只攜帶一個最近的作用域鍵**：層級關係存在於鍵級父關係中而非上下文標籤裡；巢狀作用域**上下文**仍遮蔽為單一標籤，多成員策略集仍不受支援。
- **服務可達性來自作用域建立者**：交出 `Scope.ctx` 也會交出建立外掛程式注入的服務範圍，因此，若作用域建立者提供的服務範圍較寬，持有者之後也無法將其收窄。
