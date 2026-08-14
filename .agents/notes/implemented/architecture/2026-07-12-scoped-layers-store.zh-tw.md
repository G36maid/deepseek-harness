# Agent Note: 共享作用域分層儲存

Status: implemented

[English](2026-07-12-scoped-layers-store.md) | [简体中文](2026-07-12-scoped-layers-store.zh.md) | 繁體中文

## 問題

agent（代理）作用域機制（[決策](2026-07-08-agent-scope-contexts.md)、[執行時期設計](2026-07-12-agent-scope-runtime-design.md)）讓支持作用域的登錄檔反覆呈現同一種形態：一個全域性註冊層，加上一個與具體 agent 精確對應的層。七個註冊門面都採用這一形態：`tools.register`、`tools.restrict` 和 `tools.guard`（位於 `dsh-tools`）；`SystemPrompt.section`、`SystemPrompt.tools` 和 `SystemPrompt.variable`（位於 `dsh-system-prompt`）；以及 `CommandRuntime.register`（位於 `dsh-commands`）。

如果沒有共享原語，每個門面都要圍繞自己的領域狀態重複相同的生命週期編排：從呼叫方上下文匯出可見性，按需建立專屬容器，把屬主綁定到同一個 Cordis fiber，先裝入 undo 再通知觀察者，原樣返回 Cordis 的 disposer，並回收空的專屬狀態。各自分離的對映與集合類型也會讓服務缺少一個表示某個 scope 完整貢獻的對象。

重複程式碼承載著三項不明顯的要求：

- 可見性與屬主必須來自同一個上下文；若分開接受二者，就能登記出對一個 scope 可見、卻隨另一個 scope 銷毀的貢獻。
- change 回呼執行前必須收集 undo，拋錯的回呼才能回滾變更。
- 公開 disposer 必須就是 `ctx.effect()` 返回的那個函式；包裝它會破壞 Cordis 基於身份的有序拆除。

共享的是生命週期與保持插入順序的儲存，而不是登錄檔策略。工具限制、保留傳輸項處理、提示詞求值時機、命令規範化、精確診斷和回呼例外隔離，仍分別屬於不同的領域約定。

## 決策

`@deepseek-ai/dsh-scope` 提供與鍵類型無關的 `store.ts` 實作模組。該包繼續將 Cordis 和 `@deepseek-ai/dsh-invariants` 列為對等相依性（peer dependency），其不變數配套模組保持不變。包根匯出四個儲存符號：`ScopeLayer`、`ScopedLayers`、`NamedEntries` 和 `AnonymousEntries`。`EntryValues` 仍是內部介面，`store.ts` 不是包子路徑。

`ScopeLayer` 保留顯式的聚合概念，同時只要求判斷整個層是否為空。服務定義一個具體層，使其表結構與領域 helper 適合該服務；`ScopedLayers` 負責構造、選擇、生命週期掛接、通知和聚合回收。

## 公開介面

```ts ignore-check
export interface ScopeLayer {
  isEmpty(): boolean
}

export class ScopedLayers<L extends ScopeLayer> {
  constructor(
    createLayer: (scope: ScopeKey | undefined) => L,
    onChange: () => void,
  )

  readonly global: L
  peek(scope: ScopeKey | undefined): L | undefined

  merge<V>(
    scope: ScopeKey | undefined,
    pick: (layer: L) => NamedEntries<V>,
  ): Map<string, V>

  effect(
    ctx: Context,
    action: (layer: L) => () => void,
    options: { label: string; notify?: boolean },
  ): () => void
}

export class NamedEntries<V> {
  constructor(duplicateError: (name: string) => Error)
  insert(name: string, value: V): () => void
  get(name: string): V | undefined
  has(name: string): boolean
  keys(): IterableIterator<string>
  entries(): IterableIterator<[string, V]>
  values(): IterableIterator<V>
  isEmpty(): boolean
}

export class AnonymousEntries<V> {
  append(value: V): () => void
  values(): IterableIterator<V>
  isEmpty(): boolean
}
```

## 儲存約定

- 構造器只建立一次 `global`，呼叫的是 `createLayer(undefined)`。只有 `effect()` 會建立專屬層；`peek()` 和 `merge()` 從不建立專屬層，而 `peek(undefined)` 返回 `undefined`，因為全域性層已經顯式存在。
- `merge()` 是唯一會物化結果的通用讀取介面。它按插入順序複製全域性命名條目，再按專屬條目的插入順序應用這些條目；同名條目完成遮蔽，但不會移動無關名稱。
- `NamedEntries.insert()` 以原子方式檢查並插入，返回冪等且只撤銷該精確條目的 undo，並透過呼叫方提供的工廠取得所屬登錄檔的精確重名診斷。查詢與迭代器保留 `Map` 的原生順序，並在同一個非空表 generation 內保持活遍歷；清空表會開啟新的 generation，因此尚未結束的迭代器無法觀察到自我替換。
- `AnonymousEntries.append()` 為每次登記分配唯一內部鍵，因此值相等的回呼或其他值仍彼此獨立。其迭代器保留插入順序，並採用同樣的 generation 活遍歷邊界。
- `effect()` 透過 `scopeOf(ctx)` 匯出鍵，並把 action 掛到同一個 `ctx.effect()` 上。它只接受一個同步 action，且該 action 只返回一個同步 undo；action 要麼返回其 undo，要麼必須在保留任何貢獻之前拋錯。helper 不會規範化更寬泛的 Cordis `Effect` union。
- `effect()` 在呼叫 `onChange` 前收集 action 的 undo，並原樣返回 `ctx.effect()` 的 disposer。銷毀時先執行 action undo 再通知；Cordis 保證其冪等性；只有在整個層的 `ScopeLayer.isEmpty()` 返回 true 後，helper 才會刪除專屬層。
- `options.notify` 預設為 `true`。回呼自身的策略仍具最終效力：工具與提示詞的 change 回呼可以拋錯並觸發登記回滾；`CommandRuntime.notifyChange()` 會隔離觀察者失敗；工具 guard 傳入 `notify: false`。

## 登錄檔遷移

`dsh-tools` 定義一個 `ToolLayer`，其中包含命名工具以及匿名的已編譯 restriction 和 guard 登記。`ToolRuntime` 保留其私有領域解析器，由它處理可見定義、限制前的已知名稱、可限制的全域性名稱、專屬遮蔽、restriction，以及保留的 `run_code` 插入。guard 求值會先活遍歷全域性登記，再活遍歷專屬登記：向非空 generation 新增的登記可以在當前分發中執行，而 guard 表清空後的自我替換則從下一次分發開始執行。

`dsh-system-prompt` 定義一個 `PromptLayer`，其中包含命名的段落與變數，以及匿名工具提供方。組裝流程在求值前合併段落，因此被遮蔽的提供方不會被呼叫。每次組裝只物化一次工具提供方成員集合。變數提供方會先活遍歷全域性表，再活遍歷專屬表：向非空 generation 新增的提供方可以在當前組裝中執行，而變數表清空後的自我替換則從下一次組裝開始執行。

`dsh-commands` 定義一個單表層，其中包含 `NamedEntries<RegisteredCommand>`。生效檢視表使用 `merge()`；`CommandRuntime` 則保留對定義的規範化與凍結處理、精確重名診斷、經過排序的不可變描述符、直接執行、HMR（熱模組替換）清理，以及對各個 `commands/change` 觀察者分別隔離失敗的行為。

七個門面都把校驗與診斷留在所屬登錄檔中，並繼續返回 Cordis 的原始 disposer。遷移既不改變公開登錄檔行為，也不改變模型可見或人類可見的輸出，以及協議、持久化或設定層面的可見輸出。

## 備選方案

**保留彼此獨立的實作。** 這樣不必新增庫介面，但七個門面仍會重複生命週期順序、disposer 身份和 scope 回收。

**每張表一個 helper。** 這能減少一部分區域性程式碼，但會保留多張按 scope 劃分的對映，而且無法正確回收某個 scope 的聚合貢獻。

**每 scope 一個登錄檔實例。** 子登錄檔需要透過委託獲得全域性加專屬的檢視表，對 restriction 進行特殊的減法處理，並跨實例發現觀察者。這只會轉移複雜度，而不會消除複雜度。

**註冊方法上的顯式 scope 參數。** 分開的可見性與屬主輸入讓不匹配的生命週期成為可表達狀態，而遺漏 scope 則會靜默變成全域性登記。

**接受完整的 Cordis `Effect` union。** 七個登記口都不涉及非同步 setup、多份 undo 或獨立結帳邊界。若沒有現有消費端需要，通用規範化只會重複實作 Cordis 的生命週期機制。

**暴露 `ScopedLayers.values()`、`ScopedLayers.keys()` 或全域性放行謂詞。** 這些操作會編碼消費端特有的活遍歷或物化策略，以及過濾策略。直接遍歷條目表可保留顯式的活語義，`merge()` 覆蓋共享的命名遮蔽操作，而 `ToolRuntime` 繼續保有功能更豐富的私有解析器。

**把 `values()` 放在 `ScopeLayer` 上，或匯出 `EntryValues`。** 一個層會聚合異構表，因而沒有一致的值類型或迭代策略。`EntryValues` 只適合在兩個表類之間共享實作細節；將其公開只會擴大介面，卻不能為呼叫方提供有意義的整層讀取方式。

**透過 mapped-type 表描述生成層。** 三表與單表具體層都很短、易於檢查，並可自由持有領域 helper。類生成器會增加第二種構造模型和生成式執行時期形狀，收益卻很小。

## 後果

- 支持作用域的登錄檔各自透過一個聚合層表達狀態，並複用相同的構造、屬主、回滾、通知和回收編排。各登錄檔仍各自保有領域特有的校驗、診斷、過濾、求值和觀察者策略。
- 公開讀取介面保持狹窄：直接遍歷條目表可保留顯式的活語義，`merge()` 是唯一共享的物化遮蔽操作。異構的 `ScopeLayer` 不具備整層 `values()` 約定。
- helper 刻意保持同步。未來的登記若需要非同步 setup 或多份分別擁有屬主的 undo，必須先明確屬主與 settlement 邊界，再拓寬這項約定。
- action 必須在保留貢獻前拋錯，或者為自己保留的一切返回 undo；helper 無法修復超出這項約定的變更。提供的條目操作是原子的，遷移後的登錄檔會在插入前執行可能失敗的校驗。
- 專屬層會一直保持已分配狀態，直到其聚合內的所有表都為空。因此，銷毀一個門面不會丟棄同一 scope 擁有的其他貢獻。
- 四個公開符號構成一項可複用的包約定。將 `EntryValues` 保持為內部介面，並把消費端策略留在 helper 之外，可以限制相容性範圍。
- 遷移不改變任何公開登錄檔行為，也不改變模型、人類、協議、持久化、設定或相依性圖層面的任何輸出。

## 驗證

- `dsh-scope` 單元測試覆蓋全域性構造、專屬層延遲構造、非建立式讀取、命名合併順序與遮蔽、聚合回收、工廠與 action 失敗清理、通知順序與回滾、`notify: false`、effect 標籤、原始 disposer 身份、冪等拆除、呼叫方提供的重名錯誤、相同匿名值的獨立登記、活迭代器，以及表清空後的 generation 脫離。
- 工具、系統提示詞和命令專項測試套件覆蓋 restriction、保留傳輸項處理、已知名稱與可限制名稱的一致性、guard 重入與自我替換、校驗順序、精確診斷、section 先遮蔽再求值、提供方快照成員關係、variable 重入與自我替換、隔離失敗的命令觀察者、凍結且經過排序的檢視表、直接執行和生命週期銷毀。
- 作用域核心資料的類型等價性檢查將 `ScopeLayer` 文件與其源聲明綁定。倉庫級的文件、模組圖、建置、hygiene、覆蓋率與建置產物閘門會覆蓋包根匯出與包邊界。
- 現有 ACP（Agent Client Protocol）、headless 和 TUI 無金鑰快照繼續作為工具 schema 與提示詞組裝的回歸邊界；人類命令由 TUI 覆蓋。實作不會更新任何預期 transcript（文字記錄）。
