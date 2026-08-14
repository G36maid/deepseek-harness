# 程式碼執行時期

[English](code-runtime.md) | 繁體中文

程式碼執行 seam 是一個[能力 seam](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)：其 Service Definition（[dsh-code-runtime](../../packages/code-runtime/code-runtime)，`ctx.codeRuntime`）使用宿主提供的非同步綁定執行一段模型編寫的程序，並報告其列印內容與回傳值。程式碼執行是**一項選填能力**，不屬於 agent loop（代理循環）主幹，因此其詞彙定義在此而非 [core.md](core.md) 中。各後端的執行基底與源語言不同，這兩項均為服務上的只讀描述符；worker-thread Service Provider 與工具登錄檔 Consumer 的約定見 [Code Mode 基礎設計](../../.agents/notes/implemented/feature/2026-06-15-code-mode.md) 和[類型化返回約定](../../.agents/notes/implemented/feature/2026-07-20-code-mode-typed-tool-returns.md)。

原始碼：[`packages/code-runtime/code-runtime/src/types.ts`](../../packages/code-runtime/code-runtime/src/types.ts)

## 執行：請求進，結果出

`CodeRunRequest` 攜帶**執行時期要處理的一切內容**。按照「包邊界處顯式優於隱式」的規則，預設值（時間預算、輸出上限）來自實作的已校驗設定，絕不是 `run()` 內部隱藏的 `??`：

```ts type-equiv
/**
 * One run: the program source plus everything the runtime acts on. Per the
 * explicit-over-implicit convention, defaulting (time budgets, output caps)
 * is the implementation's validated config — a request carries no optional
 * tuning knobs for a hidden `??` to fill in.
 */
interface CodeRunRequest {
  /**
   * The program source, in the runtime's {@link ../index.ts | language}. It
   * runs as the body of an async function: top-level `await` and `return`
   * are available, and the completion value becomes
   * {@link CodeRunResult.value}.
   */
  program: string
  /** Host functions exposed to the program, one global object per namespace. */
  bindings: CodeBindingNamespace[]
  /**
   * Abort the run: the runtime stops the program (hard, even mid-loop) and
   * resolves with a {@link CodeRunFailure} of kind `'abort'`. In-flight
   * binding calls are the CALLER's to settle — the runtime only stops asking.
   */
  signal?: AbortSignal
}
```

結果將錯誤報告為一個**欄位**，而不是讓 `run()` 返回被拒絕的 Promise。報告程序失敗是呼叫方的職責，不走例外路徑（與 `ShellExecutor.run` 失敗時仍正常完成的約定一致）：

```ts type-equiv
/**
 * The outcome of one run. An error is a FIELD on a resolved result, never a
 * rejection of `run()` — reporting a failed program is the caller's job, not
 * an exception path.
 */
interface CodeRunResult {
  /**
   * The program's completion value (its top-level `return`), when it ran to
   * completion and the value crossed the runtime's lossless-JSON boundary.
   * Invalid or over-limit completions fail the run instead of substituting a
   * rendered string; a failed or value-less run leaves this absent.
   */
  value?: CodeJsonValue
  /** Text the program emitted, in order, bounded only as part of the outer result. */
  logs: string[]
  /** Present iff the run failed; see {@link CodeRunFailure} for the taxonomy. */
  error?: CodeRunFailure
}
```

## 綁定：宿主函式作為程序全域性變數

每個 `CodeBindingNamespace` 在程序內成為一個由非同步可呼叫函式組成的全域性對象（Code Mode Consumer 傳入一個：`tools`）。參數與回傳值必須是無損 JSON，且跨越邊界時不受 seam 層位元組上限約束；執行時期可以透過結構化克隆橋接它們。命名空間可以聲明程序可見的錯誤類，而無需讓執行時期知道 Consumer 的名稱：執行時期會注入真實構造函式，並將被拒絕的呼叫轉為該類的實例。執行時期也將綁定名視為不可信輸入（`__proto__` 是普通自有屬性，絕不會發生原型碰撞）：

```ts type-equiv
/**
 * Program-visible typed rejection for one binding namespace. The runtime
 * injects a real error constructor under `name`; rejected member calls become
 * its instances and expose the exact member name through
 * `memberNameProperty`. Both strings are runtime data rather than knowledge
 * of a particular consumer such as Code Mode.
 */
interface CodeBindingErrorClass {
  /** Constructor global and resulting `Error.name`; same portable identifier rule as {@link CodeBindingNamespace.global}. */
  name: string
  /**
   * Non-empty own property for the member name. The portable exclusion set is
   * `RESERVED_ERROR_MEMBERS` plus dunder-form names (`__x__`, non-empty
   * middle), enforced identically by every backend; any other name —
   * identifiers or not — is accepted everywhere.
   */
  memberNameProperty: string
}
```

```ts type-equiv
/**
 * A named group of {@link CodeBindingFunction}s the runtime exposes to the
 * program as one global object (e.g. `tools`). Function names are arbitrary
 * strings — a runtime must treat names like `__proto__` or `constructor` as
 * ordinary own properties (null-prototype construction), never as prototype
 * collisions.
 */
interface CodeBindingNamespace {
  /**
   * The global identifier the program sees. Must match the LANGUAGE-PORTABLE
   * identifier subset `[A-Za-z_][A-Za-z0-9_]*` and no language's reserved
   * words, so the same namespace list works against every backend regardless
   * of `language` — a JS-only spelling like `$tools` is rejected by design,
   * not just by the Python backend. Names that satisfy the identifier rule but
   * name a backend-owned slot (`RESERVED_BINDING_GLOBALS`, e.g. `console`,
   * `__dsh_main__`) are also refused everywhere; see its declaration for the
   * exact set and why each entry is reserved.
   */
  global: string
  /** The callable members, keyed by the exact name the program calls. */
  functions: Record<string, CodeBindingFunction>
  /** Optional program-visible typed rejection contract for this namespace. */
  errorClass?: CodeBindingErrorClass
}
```

```ts type-equiv
/** A lossless JSON value transferable through the dependency-light Service Definition. */
type CodeJsonValue = null | boolean | number | string | CodeJsonValue[] | { [key: string]: CodeJsonValue }
```

```ts type-equiv
/**
 * One host-side function exposed to the program as an async callable. The
 * runtime bridges calls to it (possibly across a serialization boundary), so
 * `args` and the resolution value MUST be lossless JSON. A runtime rejects a
 * lossy or non-cloneable value with a descriptive error rather than corrupting
 * the run. No seam-level byte cap applies to a binding resolution. A rejection
 * of this function surfaces inside the program as a rejection of the
 * corresponding call.
 */
type CodeBindingFunction = (args: unknown) => Promise<CodeJsonValue>
```

## 捕獲的輸出與失敗分類體系

日誌是按寄出順序排列的純字串。執行時期捕獲程序的 console 與流輸出，但通道和 console 方法的元資料不屬於 seam，因為 Consumer 只渲染文字。實作會對序列化後的外層日誌陣列，以及完成值或失敗訊息的組合載荷設定上限；固定的結果封裝文法與 Consumer 展示空白不計入這份可變載荷計量。超限會顯式失敗，而不會在值中插入替代內容。

失敗類型是**正交的結果，獨立報告**（見 [defensive-patterns](../defensive-patterns.md)）：預算耗盡不是例外，中止不是逾時，基底崩潰（如 OOM）也不是二者中的任何一個：

```ts type-equiv
/**
 * Why a run failed. The kinds are orthogonal outcomes reported independently
 * (per docs/defensive-patterns.md): a budget expiry is not an exception, an
 * abort is not a timeout, and a substrate death is neither.
 *
 * - `'exception'` — the program threw or failed to parse/transform.
 * - `'timeout'` — an implementation-owned budget expired; the message says which.
 * - `'abort'` — {@link CodeRunRequest.signal} fired.
 * - `'worker-exit'` — the execution substrate died without settling (e.g. OOM).
 * - `'invalid-output'` — the completion value was not lossless JSON.
 * - `'output-limit'` — the serialized outer logs/value/diagnostic exceeded the configured cap.
 */
interface CodeRunFailure {
  /** The failure class (see the interface doc for each kind's meaning). */
  kind: 'exception' | 'timeout' | 'abort' | 'worker-exit' | 'invalid-output' | 'output-limit'
  /** Human-readable detail, suitable for feeding back to a model to self-correct. */
  message: string
}
```

## 服務

`CodeRuntime`（`ctx.codeRuntime`，抽象服務，定義於 [`packages/code-runtime/code-runtime/src/index.ts`](../../packages/code-runtime/code-runtime/src/index.ts)）由 `run(request)` 加兩個只讀描述符組成：`language`（程序必須使用的語言，已知值為 `'typescript'` 與 `'python'`，即 `dsh-tools` 能呈現的那些，其中只有 `'typescript'` 有已發布的後端；生成語言相關展示的 Consumer 據此切換，遇到無法展示的語言時應顯式報錯）和 `isolation`（執行基底，`'worker-thread'`、`'process'`、`'container'`；僅為診斷標籤，**不構成安全承諾**）。實作必須保證各次執行彼此隔離（無跨執行狀態），並在 dispose（資源釋放）時等待系統完全靜止：teardown 要等到所有進行中的執行均已終止並結帳後才完成。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcoderuntime--coderuntime-abstract-seam"></a>

### `ctx.codeRuntime` — `CodeRuntime` (abstract seam)

Registers one `ctx.codeRuntime` implementation. Program, budget, abort, and substrate failures resolve in CodeRunResult; only Service Definition contract misuse rejects. Implementations bridge structured-cloneable bindings, materialize each declared namespace rejection class, treat programs as hostile peers, isolate runs from one another, and terminate and await in-flight runs during disposal.

```ts cordis-catalog
/**
 * Execute one program against the request's bindings and capture what it
 * emitted. See the class doc for the resolution contract (error is a result
 * field; rejection means Service Definition contract misuse only).
 * @param request - the program, its bindings, and the abort signal; the
 *   request carries everything the runtime acts on, with no hidden defaults.
 * @returns the run's outcome: completion value (when transferable), the
 *   ordered log capture, and the failure (if any).
 */
abstract run(request: CodeRunRequest): Promise<CodeRunResult>
```

Source: [`packages/code-runtime/code-runtime/src/index.ts:102`](../../packages/code-runtime/code-runtime/src/index.ts)
<!-- END GENERATED cordis-surface -->
