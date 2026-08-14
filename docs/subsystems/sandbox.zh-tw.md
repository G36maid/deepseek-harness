# 行程沙盒

[English](sandbox.md) | 繁體中文

[dsh-sandbox](../../packages/sandbox/sandbox) 的行程沙盒 seam 將與宿主共享檔案系統和核心的子行程 argv 包裝在文件效果策略中，而不將消費端耦合到特定平臺執行器。[dsh-sandbox-local](../../packages/sandbox/sandbox-local) 提供 Linux bwrap/Landlock、macOS Seatbelt 與 Windows ACL 受限權杖後端；[dsh-bash-sandbox](../../packages/shell/bash-sandbox) 和 [dsh-pwsh-sandbox](../../packages/shell/pwsh-sandbox) 是其消費端。容器、microVM 和遠端執行是完整能力 seam 的同級實作，而非 `ctx.sandbox` 的提供方。

原始碼：[`packages/sandbox/sandbox/src/index.ts`](../../packages/sandbox/sandbox/src/index.ts)

## 模式與強制執行

`SandboxMode` 僅管控檔案系統效果。`read-only` 要求後端拒絕寫入——POSIX runner 還會授予其 shell 所需的 `/dev/null` 接收器，而 Windows ACL runner 不授予任何顯式可寫根目錄，並因環境 ACL 缺口報告部分強制執行；`workspace-write` 允許在工作區根目錄及後端承諾的臨時區域下寫入；`danger-full-access` 繞過隔離。網路與行程可見性不在此處的定義範圍內。

```ts type-equiv
/**
 * File-effect policy for confined processes. `read-only` permits only required
 * sinks such as `/dev/null`; `workspace-write` also permits the workspace and a
 * backend-defined temp area; `danger-full-access` bypasses confinement. Network
 * and process visibility are outside this vocabulary.
 */
type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
```

只有前兩種模式可以傳送給提供方。`danger-full-access` 的消費端直接 spawn 原始 argv，不呼叫 `ctx.sandbox`。

```ts type-equiv
/** A confining (non-`danger-full-access`) mode — the modes a {@link SandboxPolicy} can carry. */
type ConfinedSandboxMode = Exclude<SandboxMode, 'danger-full-access'>
```

強制執行完整性是後端報告的事實。`full` 表示後端管控了該模式承諾的所有文件效果；`partial` 表示活躍後端或較舊的核心 ABI 僅管控其中一個子集，因此要求絕對保證的消費端必須拒絕或向上暴露這一區別。當前的部分強制執行情形包括較舊的 Landlock ABI，以及 Windows ACL runner 的 Everyone 與硬連結邊界。

```ts type-equiv
/**
 * Enforcement completeness for this host. `partial` means an active backend or
 * older kernel ABI cannot govern every promised file effect; callers requiring
 * an absolute boundary must not treat it as `full`.
 */
type SandboxEnforcement = 'full' | 'partial'
```

## 逐呼叫策略

完整執行策略會按每次能力呼叫解析並攜帶。它包括 `danger-full-access`，因此消費端可以只解析一次策略，再決定是否繞過約束。普通工具呼叫從呼叫工作階段的不可變 cwd 派生 `workspaceRoot`；部署設定是沒有 agent（代理）時的回退值。root 會先按檔案系統語義規範化，再做詞法規範化，因此包含 `symlink/..` 的 cwd 會標識 spawn 出的行程實際執行的目錄。

```ts type-equiv
/**
 * The complete file-effect policy resolved for one capability call. The root
 * is carried even under modes that do not consume it so callers can resolve
 * policy once before choosing the enforcement path.
 */
interface SandboxExecutionPolicy {
  /** The file-effect mode this execution runs under. */
  mode: SandboxMode
  /** Absolute root directory `workspace-write` may write under. */
  workspaceRoot: string
  /**
   * Opaque identity of the calling session (the branded `dsh-session`
   * SessionId). Backends key per-session state off it (e.g. windows-acl gives
   * each live session/workspace pair a random private temp directory and SID,
   * while the workspace SID and standing grant remain per-workspace); absent
   * for agentless calls, which fall back to per-call backend state.
   */
  sessionId?: SessionId
}
```

`ctx.sandboxPolicy.resolve()` 接收活躍工作階段；對於已批准的重試，還接收顯式模式。該服務擁有優先級與 root 回退規則，使 bash 和 fs 不必重複實作。

```ts type-equiv
/** Inputs that select the sandbox policy for one capability call. */
interface SandboxPolicyRequest {
  /** Calling session; its immutable cwd becomes the workspace boundary. */
  session?: Session
  /** Explicit approved mode override, which outranks session policy. */
  mode?: SandboxMode
}
```

只有受約束的執行會到達 `ctx.sandbox`；傳給提供方的策略在保留同一 root 的同時收窄模式。這使並行工作階段、消費端與一次性提權重試可以向同一提供方請求不同邊界，而無需改變提供方狀態。

```ts type-equiv
/**
 * What one confined execution is allowed to touch — carried PER CALL, not
 * fixed on the provider: two consumers may confine under different policies
 * at the same instant (bash under `read-only` while a confined child agent
 * needs its state directory writable), and an approved escalated retry is a
 * new call with a wider policy. Defaulting/resolution is an explicit step at
 * the consumer boundary; the provider treats the policy as fully specified.
 */
interface SandboxPolicy extends SandboxExecutionPolicy {
  /** The file-effect mode this execution runs under. */
  mode: ConfinedSandboxMode
}
```

## 包裝後的 argv 與分類方言

`RunnerFailureRule` 匯集用於判定 runner 在執行命令前失敗的證據。消費端要求行程以非零狀態退出，並同時滿足選填的允許退出碼門控，以及餘下某一 stderr 行中不區分大小寫的致命簽名。系統會先按不區分大小寫的整行精確匹配移除資訊性排除項，因此無害的 runner 通知本身不能證明失敗。匹配到的行仍可用作錯誤詳情；分類過程不會重寫 stderr。

```ts type-equiv
/**
 * Evidence that identifies a sandbox runner failing before it executes the
 * wrapped command. A consumer first applies {@link allowedExitCodes} when
 * present, removes {@link informationalLines} by case-insensitive exact line
 * equality, then matches {@link fatalSignatures} case-insensitively within
 * each remaining stderr line. Exit status alone never proves runner failure.
 */
interface RunnerFailureRule {
  /** Nonzero process exit codes on which this rule may match; omitted permits any nonzero exit. */
  allowedExitCodes?: readonly number[]
  /** Non-empty substrings identifying a fatal runner diagnostic on one stderr line. */
  fatalSignatures: readonly string[]
  /** Benign stderr lines excluded by exact full-line equality before fatal matching. */
  informationalLines?: readonly string[]
}
```

`ConfinedArgv` 是消費端實際 spawn 的內容。除了替換後的 argv，它還攜帶後端的強制執行事實和兩種正交的 stderr 分類器。`denialSignatures` 用於識別沙盒正常工作時受限命令被阻止的情況。`runnerFailureRules` 用於識別沙盒 runner 在執行命令之前拒絕或失敗的情況；消費端應先檢查後者，將其作為沙盒基礎設施故障上報，而非普通任務失敗。

```ts type-equiv
/**
 * A {@link SandboxProvider.confine} result: the argv to spawn in place of
 * the caller's own, plus the enforcement completeness the selected backend
 * achieves for it.
 */
interface ConfinedArgv {
  /** The wrapped argv (runner, profile, separator, then the caller's argv). */
  argv: string[]
  /** How completely the selected backend enforces the policy's file effects. */
  enforcement: SandboxEnforcement
  /**
   * The selected backend's denial DIALECT: the case-insensitive stderr
   * substrings a file effect denied by THIS backend produces (EROFS text
   * under bwrap's read-only binds, EACCES under Landlock, EPERM under
   * Seatbelt). A consumer that infers denials from a failed run's stderr
   * matches against exactly these rather than a cross-backend union — the
   * union claims denials a given backend never produces.
   */
  denialSignatures: readonly string[]
  /**
   * Structured runner-failure evidence rules. Consumers require a matching
   * fatal stderr line (after informational exclusions) and any rule-specific
   * exit-code gate before checking denial signatures: runner failure means the
   * command never ran, while denial means confinement worked and blocked it.
   */
  runnerFailureRules: readonly RunnerFailureRule[]
}
```

[本機提供方](../../packages/sandbox/sandbox-local/README.md)擁有運維設定，並將其 runner 方言對映到這些規則。[沙盒化 bash 消費端](../../packages/shell/bash-sandbox/README.md)擁有 spawn 與結果歸因。

## 提供方與 fail-closed 錯誤

`ctx.sandbox.confine(argv, policy)` 返回一個 `ConfinedArgv`，或在沒有可用後端時拋出 `SandboxUnavailableError`（錯誤碼 `SANDBOX_UNAVAILABLE`）。消費端也可以在 spawn 或觀察所返回的 argv 時對失敗進行分類；該歸因屬於消費端約定。對於受限策略，靜默的無隔離透傳永遠不合法。

提供方選擇、探測、快取和後端特定的強制執行報告歸[本機提供方](../../packages/sandbox/sandbox-local/README.md)所有。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsandbox--sandboxprovider-abstract-seam"></a>

### `ctx.sandbox` — `SandboxProvider` (abstract seam)

Abstract process-sandbox service. confine must return enforcing argv or fail closed at wrap or runner-execution time; silent unconfined passthrough is forbidden. Functional probes arbitrate multi-runner chains and may be skipped for a sole candidate, whose own refusal remains the fail-closed end.

```ts cordis-catalog
/**
 * Wrap `argv` so it executes confined under `policy` on this host; the
 * caller spawns the returned argv in place of its own.
 * @param argv - the exact argv the caller is about to spawn (program plus
 *   arguments), NOT a shell string — a shell-shaped consumer passes
 *   `['bash', '-c', command]`.
 * @param policy - the file-effect policy this execution runs under,
 *   carried per call (see {@link SandboxPolicy}).
 * @returns the argv to spawn instead, plus the enforcement completeness
 *   the selected backend achieves for it.
 */
abstract confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv
```

Source: [`packages/sandbox/sandbox/src/index.ts:158`](../../packages/sandbox/sandbox/src/index.ts)

<a id="ctxsandboxpolicy--sandboxpolicyservice"></a>

### `ctx.sandboxPolicy` — `SandboxPolicyService`

The sandbox-policy service (`ctx.sandboxPolicy`). Owns the deployment default mode, fallback workspace root, and current request-time policy section. Tool layers call resolve for each execution so a session's mode log and immutable cwd travel together to every enforcing capability.

```ts cordis-catalog
/**
 * Resolve the complete policy for one capability call. An approved explicit
 * mode outranks the session's last `sandbox/mode` event, which outranks the
 * deployment default. A session cwd is its workspace-write boundary; the
 * configured root is the fallback for agentless calls and sessions without a
 * cwd.
 * @param request - optional session and approved mode override.
 * @returns the fully resolved per-call mode and absolute workspace root.
 */
resolve(request: SandboxPolicyRequest = {}): SandboxExecutionPolicy

/**
 * Read the session override without applying the deployment default.
 * @param session - session whose log supplies the override.
 * @returns the last logged mode, or `undefined` without one.
 */
overrideOf(session: Session): SandboxMode | undefined
```

Types: [Session](session.md)

Source: [`packages/sandbox/sandbox-policy/src/index.ts:91`](../../packages/sandbox/sandbox-policy/src/index.ts)
<!-- END GENERATED cordis-surface -->
