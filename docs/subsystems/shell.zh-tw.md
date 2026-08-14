# Bash 執行器

[English](shell.md) | [简体中文](shell.zh.md) | 繁體中文

bash 執行 seam 分為 Service Definition（[dsh-shell](../../packages/shell/shell)，`ctx.shell`）、Service Provider（[dsh-bash-local](../../packages/shell/bash-local) 與 [dsh-bash-sandbox](../../packages/shell/bash-sandbox)）和 Consumer（[dsh-tool-bash](../../packages/shell/tool-bash)，即 `bash` schema）。通用背景工作的 job id、所有權與控制位於 [jobs.md](jobs.md)；本 seam 返回一個不含任務概唸的行程控制代碼。原始行程組機制封裝在[子行程 seam](subprocess.md)之後。

原始碼：[`packages/shell/shell/src/types.ts`](../../packages/shell/shell/src/types.ts)

## 受管 shell 環境命名空間

`DSH_*` 變數是歸 Harness 所有的子行程事實。面向模型的 bash 工具透過 `ctx.shellEnv` 收集它們，再經由 `ShellExecRequest.dshEnv` 傳遞；子行程服務在合併當前快照之前會移除繼承而來的 `DSH_*` 名稱。`DshEnvironmentKey`／`DshEnvironment` 詞彙歸[子行程 seam](subprocess.md)所有，由 `dsh-shell` 重匯出。

## 請求與規格：`resolve()` 拆分

該 seam 將**面向模型/外掛程式的請求**（`workdir`/`timeoutMs`/`stdoutMaxBytes` 選填，由設定或請求策略補全）與執行器實際使用的**完全解析後的 spec**（這些欄位均為必填）分開。工具層在二者之間呼叫 `ctx.shell.resolve(request)`（倉庫的「包邊界處顯式優於隱式」規則）；`ShellExecSpec` 攜帶的是已解析的值。

```ts type-equiv
/**
 * A caller's execution REQUEST: `workdir` and `timeoutMs` are optional and
 * filled by {@link ShellExecutor.resolve} from the implementation's config.
 * This is the model-/plugin-facing shape; pass it to `resolve()` to obtain a
 * fully-resolved {@link ShellExecSpec}.
 */
interface ShellExecRequest {
  command: string
  /** Working directory override (default: implementation-configured). */
  workdir?: string | undefined
  /** Timeout override in milliseconds (implementations cap it). */
  timeoutMs?: number | undefined
  /**
   * Foreground stdout capture budget in bytes. Absent uses the executor's
   * default output cap. Trusted in-process consumers use this when they must
   * parse complete stdout up to their own bounded limit; the model-facing bash
   * tool does not expose it as a parameter.
   */
  stdoutMaxBytes?: number | undefined
  /** Abort signal — implementations kill the command when it fires. */
  signal?: AbortSignal | undefined
  /**
   * Bytes to write to the command's stdin, then close it. Absent leaves stdin
   * closed/empty (the default for model-driven tool calls). Set by in-process
   * plugins (e.g. the hooks bridges, which write a hook command's JSON payload
   * to its stdin); the model-facing bash tool does not expose it as a parameter
   * (a model that needs stdin uses shell syntax like a heredoc or a pipe).
   */
  stdin?: string | undefined
  /**
   * Ordinary environment entries for the command, merged after the credential
   * scrub. Managed facts belong in {@link dshEnv}, which merges after this
   * map, so an entry here can never displace one. Set by in-process plugins
   * (the hooks bridges set `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, …); the
   * model-facing bash tool does not expose it as a parameter.
   */
  env?: Record<string, string> | undefined
  /**
   * Harness-owned `DSH_*` variables for this execution (typed to managed
   * keys). Executors discard ambient `DSH_*` entries before merging this
   * snapshot last, so an unavailable current fact cannot inherit a stale
   * value from the harness process and a caller {@link env} entry cannot
   * displace a managed one.
   */
  dshEnv?: DshEnvironment | undefined
  /** Fully resolved per-call sandbox policy; sandboxing executors default it. */
  sandboxPolicy?: SandboxExecutionPolicy | undefined
}
```

```ts type-equiv
/**
 * A resolved execution spec. {@link ShellExecutor.resolve} fills and caps the
 * required fields; {@link ShellExecutor.start} ignores `timeoutMs` because
 * background processes have no executor timeout.
 */
interface ShellExecSpec {
  command: string
  workdir: string
  timeoutMs: number
  /**
   * Resolved foreground stdout capture budget in bytes. `run()` uses it for
   * stdout; background jobs and stderr keep the executor's own output cap.
   */
  stdoutMaxBytes: number
  /** Abort signal — implementations kill the command when it fires. */
  signal?: AbortSignal | undefined
  /** Bytes to write to stdin before closing it; absent means no stdin. */
  stdin?: string | undefined
  /**
   * Ordinary environment entries carried through from
   * {@link ShellExecRequest.env}; {@link dshEnv} still merges after them.
   * OPTIONAL on the spec for the same reason as `stdin`: absent means no
   * ordinary extra environment.
   */
  env?: Record<string, string> | undefined
  /** Managed `DSH_*` snapshot (typed to managed keys); merges after {@link env}. */
  dshEnv?: DshEnvironment | undefined
  /** Resolved sandbox policy; ignored by executors that do not confine. */
  sandboxPolicy: SandboxExecutionPolicy | undefined
}
```

`stdin` 和 `env` 是受信任的行程內外掛程式輸入，不由 `dsh-tool-bash` 暴露。本機執行器會先清除環境中的憑據，再合併呼叫方顯式提供的 env。見 [bash-stdin-env Agent Note](../../.agents/notes/implemented/architecture/2026-06-30-bash-stdin-env-trusted-plugin-api.md)。

`stdoutMaxBytes` 同樣僅供受信任外掛程式使用。它讓前臺消費端能在有界解析預算內請求完整 stdout，而不會改變 stderr、背景工作或面向模型的 bash 工具的常規輸出上限。

## 前景執行：`ShellRunResult`

一次已完成（或被終止）的前景執行的結果。正交的結果**獨立報告**：一個行程可以同時逾時並以結束碼 0 結束（因為它捕獲了訊號），因此 `timedOut`、`aborted`、`signal` 和 `exitCode` 各自獨立為一個欄位；呼叫方永遠不會把一次被提前中斷的執行誤讀為正常成功。

```ts type-equiv
/** The outcome of one completed (or killed) foreground run. */
interface ShellRunResult {
  /** Exit code; null when the process died from a signal. */
  exitCode: number | null
  /** Terminating signal (e.g. 'SIGTERM'); null on normal exit. */
  signal: NodeJS.Signals | null
  /**
   * True when the executor's own timeout was the FIRST cause to cut the command
   * short. Mutually exclusive with {@link aborted}: one fused deadline drives
   * both the timeout and the caller's cancellation, so a timeout and an abort
   * racing before process close report the single first-abort cause, not both
   * (see the [timeout-library Agent Note](../../../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md)).
   */
  timedOut: boolean
  /**
   * True when the caller's `AbortSignal` was the FIRST cause to kill the command
   * (and it was not the executor's own timeout). Mutually exclusive with
   * {@link timedOut} — see there for the first-cause classification.
   */
  aborted: boolean
  /** The effective timeout applied to this run (after defaulting/capping). */
  timeoutMs: number
  stdout: CollectedOutput
  stderr: CollectedOutput
  /** Sandbox execution facts, absent for an unsandboxed executor. */
  sandbox?: ShellSandboxInfo
}
```

每個流是一個 `CollectedOutput`：（可能被截斷的）文字加復原資訊；截斷時，`text` 是**尾部**，完整流溢位到一個私有文件。這些欄位歸[子行程 seam](subprocess.md)所有，由 `dsh-shell` 重匯出。

## 文件沙盒：`ShellSandboxInfo`

使用沙盒的執行器透過 `ShellExecutor.sandboxMode` 暴露其已設定的模式回退值。工具層請求 [`@deepseek-ai/dsh-sandbox-policy`](../../packages/sandbox/sandbox-policy/README.md)，把每個呼叫工作階段的持久 `sandbox/mode` 覆蓋值與不可變 cwd 解析為 `ShellExecRequest.sandboxPolicy`；經使用者批准、嚴格更寬鬆的呼叫只替換模式。模式/root/enforcement 詞彙歸 [`@deepseek-ai/dsh-sandbox` 沙盒 seam](sandbox.md) 所有；模式僅管轄文件效果。

沙盒化執行會報告其模式、保守的拒絕分類與強制執行完整度。`runnerFailed` 標記命令執行前沙盒 runner 已失敗；前臺執行會拋出 `SANDBOX_UNAVAILABLE`，而已結束的後臺行程只能透過其事實通道報告。

```ts type-equiv
/**
 * Sandbox facts for one run, present iff a sandboxing executor handled it.
 * Facts are reported independently of process exit status so callers can
 * distinguish command failures from policy denials and runner failures.
 */
interface ShellSandboxInfo {
  /** The mode the command actually ran under. */
  mode: SandboxMode
  /** Whether the sandbox denied a file operation. */
  denied: boolean
  /** How completely the selected runner enforced the requested mode. */
  enforcement?: SandboxEnforcement
  /** Whether the sandbox runner failed before the command could run. */
  runnerFailed?: boolean
}
```

當受限模式沒有可用後端時，`ctx.sandbox` 提供方會拋出、執行器會傳播由[沙盒 seam](sandbox.md)所有的 `SANDBOX_UNAVAILABLE` 錯誤碼。選定的 runner 拒絕其 profile 時會觸達同一個故障關閉的前臺錯誤；已結束的背景工作則記錄 `runnerFailed`。模型會在結果中收到拒絕/runner 事實，僅當拒絕標記指出生效模式時才得知該模式，並可透過 `sandbox_permissions` 加 `justification` 請求一次性、嚴格更寬鬆的重試；執行任何操作前，`ctx.approval` 必須批准該次確切呼叫。完整的策略與切換設計見[沙盒 Agent Note](../../.agents/notes/implemented/feature/2026-07-06-sandbox.md)。

## 後臺行程：`ShellProcess`

`start()` 返回不含 id 或所有者的控制代碼。`dsh-tool-bash` 將它適配為 `ctx.jobs.start()` 掛鉤；隨後由通用執行時期擁有任務標識與生命週期。`done` 在行程關閉時完成且絕不被拒絕；行程結束後仍可讀取，並且沙盒事實會在 `done` 完成前寫入。

```ts type-equiv
/**
 * A background process handle returned by {@link ShellExecutor.start}. It is the
 * only access path; buffered output remains readable after exit. Composition
 * teardown (the subprocess service's disposal) kills running processes and
 * awaits {@link done}; an executor-only reload leaves them running.
 */
interface ShellProcess {
  /** Process lifecycle state (settled exactly once). */
  status: ShellProcessStatus
  /** Exit code once finished (null = killed by signal / still running). */
  exitCode: number | null
  /** Terminating signal name, when signal-killed. */
  signal: NodeJS.Signals | null
  /** Resolves when the underlying process closes (never rejects — a spawn failure settles as `killed` with the error on stderr). */
  readonly done: Promise<void>
  /** Sandbox facts, stamped once a confined process settles. */
  sandbox?: ShellSandboxInfo
  /**
   * Read output produced since the previous read (consuming — consecutive
   * reads never re-deliver). Reads that lost data flag `lossy` and point at
   * full-stream spill files when available.
   */
  readOutput(): ShellProcessRead
  /**
   * Kill the process group. Returns false when it had already finished
   * (no-op); idempotent.
   */
  kill(): boolean
}
```

`readOutput()` 返回增量內容與 spill 復原資訊：

```ts type-equiv
/** One incremental {@link ShellProcess.readOutput} read. */
interface ShellProcessRead {
  /** Output produced since the previous read (stderr in a marked section). */
  delta: string
  /** True when truncation dropped unread bytes the delta cannot include. */
  lossy: boolean
  /** Full stdout spill file, when stdout truncation occurred and a safe path is available. */
  stdoutSpillPath?: string
  /** Full stderr spill file, when stderr truncation occurred and a safe path is available. */
  stderrSpillPath?: string
}
```

## 服務

`ShellExecutor` 擁有 `resolve`、前臺 `run`、後臺行程 `start` 以及 `sandboxMode` 能力事實。`dsh-bash-local` 擁有命令預設值補全、逾時/中止分類、終端機環境以及後臺讀取合併；行程組、有界收集器、spill 文件、憑據清除與 dispose（資源釋放）後完全靜止歸[子行程服務](subprocess.md)所有。`dsh-tool-bash` 擁有面向模型的算繪，並將後臺控制代碼適配到[通用任務執行時期](jobs.md)。`dsh-shell` 擁有 shell 工具共享的結束狀態約定：匯出的 `parseExitStatus`/`ParsedExitStatus` 是 `dsh-tool-bash` 的 `renderResult` 與 `dsh-tool-pwsh` 的 `renderPwshResult` 所追加的 `[exit code: N]` / `[killed by signal: X]` 標記的逆解析，兩個工具的 `presentResult` 都用它把算繪文字拆分為 terminal 卡的輸出正文與結束狀態 pill。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxshell--shellexecutor-abstract-seam"></a>

### `ctx.shell` — `ShellExecutor` (abstract seam)

Abstract bash execution service. Subclass, implement the abstract methods, and load the subclass as a plugin — it registers as `ctx.shell` (one implementation per context; loading a second throws, which is cordis' standard duplicate-service behavior).

Implementations must honor these semantics:

- run rejects only for infrastructure failures. Nonzero exits, timeout kills, and abort kills resolve with a ShellRunResult.
- start returns immediately; no timeout applies to background processes. `done` settles at process close and never rejects; spawn failures settle as `killed` with the error on stderr.
- ShellProcess.readOutput is incremental: consecutive reads never repeat output. Lossy reads report truncation and available spill files.
- A still-running background process is stopped and awaited when its owning composition tears down. With the subprocess seam that boundary is `ctx.subprocess` disposal, so a background process survives an executor-only reload.

```ts cordis-catalog
/**
 * Apply implementation-owned defaults and caps to a request before execution.
 * @param request - the caller's request; omitted fields get this
 *   implementation's defaults, capped fields are clamped.
 * @returns the fully-specified spec to hand to {@link run}/{@link start}.
 */
abstract resolve(request: ShellExecRequest): ShellExecSpec

/**
 * Run a command in the foreground; resolves when it finishes.
 * @param spec - a resolved spec from {@link resolve}, never a raw request.
 * @returns the outcome; nonzero exits, timeout kills, and abort kills
 *   resolve with a descriptive result rather than reject.
 */
abstract run(spec: ShellExecSpec): Promise<ShellRunResult>

/**
 * Start a background process and return its handle immediately.
 * @param spec - a resolved spec from {@link resolve}, never a raw request.
 * @returns the live process handle (reads, kill, quiescence promise).
 */
abstract start(spec: ShellExecSpec): ShellProcess
```

Source: [`packages/shell/shell/src/index.ts:65`](../../packages/shell/shell/src/index.ts)

<a id="ctxshellenv--shellenvregistry"></a>

### `ctx.shellEnv` — `ShellEnvRegistry`

Registry (`ctx.shellEnv`) for trusted, per-execution `DSH_*` variables. The namespace is rebuilt for every model shell call: ambient `DSH_*` values are discarded by the executor, then the registry's current snapshot is injected. Built-in shell facts remain owned by the registry itself while plugins can register additional, enumerable facts with effect-scoped disposal.

```ts cordis-catalog
/**
 * Register one environment contributor. Names and keys are unique; built-in
 * keys are reserved. Registration is disposed with the calling plugin fiber.
 * @param contributor - declared key ownership and per-execution resolver.
 * @returns the disposer that unregisters the contribution.
 */
register(contributor: BashEnvContributor): () => void

/**
 * Build the trusted `DSH_*` snapshot for one shell tool execution.
 * @param execution - the current tool execution.
 * @returns an immutable environment overlay containing built-ins and current contributions.
 */
collect(execution: ToolExecution): DshEnvironment

/**
 * Enumerate plugin-contributed variables without executing their resolvers.
 * @returns declarations sorted by environment variable name.
 */
list(): BashEnvVariableInfo[]
```

Types: [DshEnvironment](subprocess.md) · [ToolExecution](tools.md)

Source: [`packages/shell/shell-env/src/index.ts:89`](../../packages/shell/shell-env/src/index.ts)
<!-- END GENERATED cordis-surface -->
