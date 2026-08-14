# @deepseek-ai/dsh-bash-sandbox

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

這是使用沙盒能力的 [`@deepseek-ai/dsh-shell`](../shell/) 執行器 seam 的 Service Provider。載入它時，應**用它替代** `@deepseek-ai/dsh-bash-local`，並同時載入 [`ctx.sandbox`](../../sandbox/sandbox/) 提供方（例如 [`@deepseek-ai/dsh-sandbox-local`](../../sandbox/sandbox-local/)）及 [`ctx.sandboxPolicy`](../../sandbox/sandbox-policy/)；預設模式和工作區根目錄由後者負責，並與受沙盒約束的檔案系統共享這些設定。無需使用替代工具外掛程式；`dsh-tool-bash` 會偵測執行器的 `sandboxMode` 能力並新增升權欄位。

包根目錄匯出預設與具名的 `SandboxBashExecutor` 外掛程式及其 `Config`；結果分類 helper 保留在內部。

每條命令的限制方式都是：把本執行器即將 spawn 的精確 `['bash', '-c', command]` argv 交給提供方，並直接 spawn 返回的 argv。使用隨附的原生 runner 時，內層 Bash 保留 shell 語義，並且只在 runner 建立約束後才求值 `BASH_ENV`。由哪種平臺 runner 執行限制，以及是否有 runner 可用，屬於提供方職責；若無可用 runner，則按失敗關閉原則拒絕執行並返回結構化 `SANDBOX_UNAVAILABLE` 錯誤，絕不能靜默地無約束執行。本包只負責 bash 側。

| 模式 | 文件影響 |
|---|---|
| `read-only`（預設） | 任何位置都不可寫（在 `/dev` 中只有 `/dev/null` 節點可寫，因此 `>/dev/null` 仍可正常工作） |
| `workspace-write` | 只能寫入 `workspaceRoot` + `/tmp`（在 bwrap 下為臨時目錄，在 Landlock 下為宿主 `/tmp`，在 Seatbelt 下為 `/private/tmp` 加每使用者臨時目錄） |
| `danger-full-access` | 不作限制；絕不諮詢提供方。前臺結果攜帶 `sandbox: { mode, denied: false }`；後臺行程控制代碼不攜帶沙盒事實。 |

語義：

- **拒絕是結果事實。** 如果一次失敗執行的 stderr 包含所選後端自身的拒絕方言，即提供方在每次包裝時加上的特徵（bwrap 下的 EROFS 文字、Landlock 下的 EACCES、Seatbelt 下的 EPERM），則結果報告 `ShellRunResult.sandbox.denied: true`（從已收集的 stderr 尾部進行保守分類）。每次受限制執行還會攜帶執行時模式（`result.sandbox.mode`）與提供方強制執行完整性（`result.sandbox.enforcement`：`full`，或在較舊 Landlock ABI 上為 `partial`）。
- **Runner 路徑或 syscall 必須匹配。** 行程啟動前，呼叫方擁有的 workdir 必須經獨立驗證可用，Node 必須報告 `ENOENT` 或 `EACCES`，並且錯誤必須符合以下一種形態：`error.path` 等於提供方返回的 `argv[0]`，同時 `syscall` 為 `'spawn'` 或精確的 `'spawn <runner>'`；或者 `error.path` 不存在，同時 `syscall` 為精確的 `'spawn <runner>'`。這樣可以識別缺失的 runner、不可執行的 runner，或 shebang 解釋器不可用的可執行指令碼。沒有精確錯誤路徑的裸 `syscall: 'spawn'`、任何其他錯誤碼、無效或不可用的 workdir、資源失敗、無關 syscall 或無結構拒絕仍保留本機執行器的命令啟動失敗語義。前臺執行會拋出 `SANDBOX_UNAVAILABLE` 並附帶原始 spawn 錯誤詳情，非同步後臺結帳則會標記 `runnerFailed: true` 和 `denied: false`。如果 `SubprocessRuntime` 同步拋出同樣能指明 runner 的 `ENOENT`／`EACCES` 形態，後臺啟動會拋出 `SANDBOX_UNAVAILABLE`；其他同步錯誤原樣傳播。行程啟動後，先按整行精確匹配排除資訊性行，隨後規則的選填結束碼檢查和餘下 stderr 中的一行致命診斷必須同時匹配。匹配結果優先於拒絕；前臺執行會拋出 `SANDBOX_UNAVAILABLE` 並附帶匹配到的致命行，已結帳的後臺行程則會標記 `process.sandbox.runnerFailed`，Bash 結果生成方透過通用 `job_output` 算繪它。無論走哪條路徑，受限制的後臺控制代碼都會保留自身的模式／強制執行事實，並釋放每行程計數。
- **部署回退，每次呼叫策略。** [`ctx.sandboxPolicy`](../../sandbox/sandbox-policy/) 為每次工具呼叫解析完整的 `SandboxExecutionPolicy`：呼叫工作階段提供自身的模式覆蓋與不可變 cwd 根目錄，部署設定則為無 agent（代理）呼叫提供回退。已批准的升權只更改該策略的模式，工作階段根目錄仍然附著其上。`resolve()` 把策略帶入 spec，因此來自不同項目的重疊命令會在各自的根目錄與模式下執行、分類和報告。能力事實 `ctx.shell.sandboxMode` 報告已設定的預設值，因此工具層只在裝載該執行器時才公佈升權；靜態 bash 工具描述則單獨負責拒絕與升權引導。
- **只限制文件影響。** 設計上不限制網路與行程可見性：模式詞彙不會聲稱覆蓋後端未強制執行的範圍。
- 行程機制（spawn、行程組終止、輸出收集／spill、後臺控制代碼、憑證清理）繼承自 [`dsh-bash-local`](../bash-local/)；runner 選擇位於 [`dsh-sandbox-local`](../../sandbox/sandbox-local/)。

該 seam 只報告拒絕：拒絕是一項結果事實，本執行器絕不自行協商權限。批准問題位於工具層（`dsh-tool-bash`），由它設定本包所遵守的模式覆蓋值。

```yaml
- id: sandbox
  name: '@deepseek-ai/dsh-sandbox-local'
- id: sandbox-policy
  name: '@deepseek-ai/dsh-sandbox-policy'
  config:
    mode: read-only
    workspaceRoot: !!js process.cwd() # fallback for calls without a session cwd
- id: bash
  name: '@deepseek-ai/dsh-bash-sandbox'
```

## 模型體驗

### 間接的 Bash 工具 schema

#### 模型看到的內容

基線是生成的 [`dsh-tool-bash` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-bash)。透過公佈表明啟用隔離的 `sandboxMode` 能力，此後端會為 `bash` 增加 `sandbox_permissions`，其 enum 為 `workspace-write` | `danger-full-access`，並增加 `justification`。策略歸屬方會另行貢獻當前且不區分具體能力的 `sandbox:policy` 上下文。

#### Token 影響

在 `bash` 可見的請求上，schema 固定增加少量內容，另有一條由 `dsh-sandbox-policy` 負責的當前策略子句。

#### KV Cache 影響

常駐策略變化會在保留的歷史之後追加一份由歸屬方算繪的完整上下文快照，並使既有 system/history 前綴保持逐位元組不變。更改執行器能力會改變 `bash` schema。

### 間接的 Bash 工具結果

#### 模型看到的內容

在普通有界輸出之後，被拒絕的呼叫會精確追加 `[sandbox: file access denied under <mode> mode]`。當升權可用時，接下來精確追加 `[sandbox: escalation available — retry this exact command once with sandbox_permissions (the narrowest wider mode that suffices) + justification; the approval prompt asks the user]`。已結帳的後臺 runner 失敗則追加 `[sandbox: the sandbox runner itself failed under <mode> mode — the command did not run; this is a sandbox problem, not a command failure]`。

#### Token 影響

除普通輸出外，正常允許的執行不會增加 token。拒絕或失敗會增加上述有條件標記，並保留到上下文壓縮（context compaction）。

#### KV Cache 影響

僅附加；新可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

### 間接的 Bash 工具錯誤

#### 模型看到的內容

如果沒有 runner 能強制執行受限模式，前臺呼叫會傳播 [`SANDBOX_UNAVAILABLE` 錯誤](../../sandbox/sandbox/README.md#confinement-error-indirectly)；該錯誤由 `dsh-sandbox` 定義。判定為 runner 失敗的 spawn 錯誤會以原始 spawn 錯誤作為詳細資訊；如果拒絕沒有透過 `ENOENT`／`EACCES` 的 `path` 或 `syscall` 證據指明 `argv[0]`，它仍是普通的命令啟動錯誤。已結帳的 runner 失敗則以匹配到的致命 stderr 行作為詳細資訊，並保留原始 stderr 收集結果。如果追加了 `Runner failure: <detail>`，它就是權威診斷；前面的後端安裝文字只是通用的 `SANDBOX_UNAVAILABLE` 前綴。

#### Token 影響

該次呼叫會在相應條件下顯示錯誤文字，該文字會保留在歷史記錄中直到上下文壓縮。

#### KV Cache 影響

僅附加；新可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **限制只覆蓋文件影響**：網路訪問與行程可見性不變，因此這些模式不是通用安全沙盒。
- **拒絕從失敗命令的 stderr 推斷**：後端特徵使該推斷可跨平臺使用，但包含相同後端特徵的應用錯誤可能被分類為拒絕，也可能遺漏未出現在保留尾部中的拒絕。
- **非同步觀測到的後臺 runner 失敗沒有即時錯誤通道**：它記錄在已結帳行程上，並在呼叫方使用 `job_output` 讀取通用任務時呈現；`SubprocessRuntime` 同步拋出的錯誤包含 runner 路徑時，則會使 `start()` 立即失敗。
- **`danger-full-access` 有意繞過 `ctx.sandbox`**：它是顯式無約束模式，不是更寬的沙盒 profile。
