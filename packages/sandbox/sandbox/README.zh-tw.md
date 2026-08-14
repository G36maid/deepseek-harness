# @deepseek-ai/dsh-sandbox

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

行程沙盒 Service Definition。負責定義 `ctx.sandbox` 服務約定（[`SandboxProvider`](src/index.ts)）與 harness 共享的限制詞匯：`SandboxMode`（`read-only`／`workspace-write`／`danger-full-access`，僅限文件操作）、`SandboxEnforcement`（`full`／`partial`，針對每種核心 ABI）、`SandboxExecutionPolicy`（每次呼叫的完整模式及工作區根目錄）、`SandboxPolicy`（其中受限制的子集），以及故障時拒絕放行的 `SANDBOX_UNAVAILABLE` 錯誤。作為[能力 seam 拆分](../../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)中的 Service Definition 角色，它只相依性 cordis（及 harness 錯誤基類），絕不相依性後端。

用一句話概括約定：`ctx.sandbox.confine(argv, policy)` 返回用於 spawn、應當取代呼叫方原始 argv 的 argv。回傳值經過包裝，使行程及其派生的所有行程都在限制下執行；還會附帶所選後端達到的強制執行完整度、拒絕方言（`denialSignatures`）和結構化 runner 失敗證據（`runnerFailureRules`）。沒有可用後端時，它會拋出例外，絕不會原樣傳遞 argv 使其不受限制地執行。[核心類型目錄](../../../docs/subsystems/sandbox.md#wrapped-argv-and-classification-dialects)負責定義分類器的精確結構。

策略隨呼叫傳遞，而不屬於提供方：兩個消費端可以同時按不同策略施加限制（bash 使用 `read-only`，而受限制的子 agent（代理）保持其狀態目錄可寫）；獲批的升權重試只是使用更寬策略發起的新呼叫。

**只支援與宿主共享檔案系統和核心的限制。** 後端與宿主共享檔案系統和核心（`bwrap`、Landlock、Seatbelt）；`workspaceRoot` 指向檔案系統規範化後的真實主機目錄。系統先解析工作區所指的目錄，再做詞法規範化，因此包含 `symlink/..` 的有效 cwd 會授權 `chdir` 實際到達的目錄，而非無關的詞法父目錄。容器、microVM 與遠端執行器都不是該 seam 的後端：它們會以環境一致的分組替換整個能力 seam 的 Service Provider（`ctx.shell`、`ctx.fs`）。邊界及其設計理由見[沙盒 Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md)。

實作：[`@deepseek-ai/dsh-sandbox-local`](../sandbox-local/)（Linux：`bwrap`，否則使用相應平臺的 Landlock launcher；macOS：`sandbox-exec`／Seatbelt）。消費端：[`@deepseek-ai/dsh-bash-sandbox`](../../shell/bash-sandbox/)（包裝 `['bash', '-c', command]`）。

## 模型體驗

### 間接的限制錯誤

#### 模型看到的內容

透過 [`dsh-bash-sandbox`](../../shell/bash-sandbox/README.md) 和 [`dsh-tool-bash`](../../shell/tool-bash/README.md)，無法強制執行所請求模式時會產生錯誤碼 `SANDBOX_UNAVAILABLE` 及以下精確錯誤。執行期 runner 失敗會追加 ` Runner failure: <detail>`。

##### 精確錯誤

```markdown
sandbox mode "<mode>" is requested but no sandbox backend is usable on this host; refusing to run the command unconfined. Install bubblewrap or run a Landlock-enforcing kernel (Linux), ensure sandbox-exec is usable (macOS), or ensure the ACL restricted-token runner can start (Windows) — otherwise switch the consumer to danger-full-access.
```

#### Token 影響

條件性錯誤文字對該次呼叫可見，並保留在歷史中直到壓縮（compaction）。

#### KV Cache 影響

僅附加；新可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **文件操作是完整的策略詞彙**：該 seam 不表達網路、行程、系統呼叫、設備或憑據限制。
- **只支援與宿主共享檔案系統和核心的限制**：容器、microVM 與遠端執行需要替換能力實作，而不是在此處增加提供方。
- **拒絕報告是一種 stderr 方言**：該 seam 返回後端簽名，而非類型化執行時期拒絕通道，因此需要分類的消費端必須從子行程輸出推斷。
- **Runner 診斷使用帶內通道**：結束狀態與 stderr 證據無法證明匹配行由哪個行程寫入，因此受限子行程若故意模仿 runner，就可能造成可用性或診斷誤歸因。這無法繞過約束；帶外 runner 狀態通道暫緩實作。
- **每個上下文只有一個提供方**：同時組合不同沙盒機制需要提供方級階梯或獨立 Cordis 上下文；呼叫方逐呼叫選擇策略，而非後端標識。
