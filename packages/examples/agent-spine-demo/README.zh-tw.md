# @deepseek-ai/dsh-agent-spine-demo

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

將**預設的不含執行器、不含 UI 的 agent（代理）主幹**作為一個 Cordis 組合包外掛程式。它載入每個 harness agent 所需的固定服務集合，包括本機 skill（技能）提供方，並將迴圈的 `agents` 清單作為自身設定轉發。因此，應用包只需新增入口和可替換後端，就能組合出可工作的 agent。

閱讀此包可瞭解完整外掛程式樹及其組合順序。

## 它載入的外掛程式樹

`apply(ctx, config)` 將以下每個外掛程式掛載為組合包 fiber 的子節點：

```
@deepseek-ai/cordis-plugin-timer  timer service (writes nothing to stdout)
@deepseek-ai/dsh-llm              abstract LLM service + content-block vocabulary
@deepseek-ai/dsh-session          event-sourced session log + store
@deepseek-ai/dsh-session-title    log-backed title service + deterministic fallback
@deepseek-ai/dsh-system-prompt    prompt-section + tool-schema assembly
@deepseek-ai/dsh-tools            registry + guarded pre/around/post/final-result pipeline
@deepseek-ai/dsh-skill            skill provider registry
@deepseek-ai/dsh-skill-filesystem      local filesystem skill provider
@deepseek-ai/dsh-agent            agent registry + initiator scope + agent/* events
@deepseek-ai/dsh-goal             optional persisted same-session goal domain
@deepseek-ai/dsh-tool-goal        optional model-facing goal controls
@deepseek-ai/dsh-goal-round-driver     optional same-session goal-round driver
@deepseek-ai/dsh-llm-retry        provider-routed request retry policy
@deepseek-ai/dsh-jobs-local      generic background-job registry
@deepseek-ai/dsh-invariants       configurable invariant registry service
@deepseek-ai/dsh-session/invariant
@deepseek-ai/dsh-agent/invariant
@deepseek-ai/dsh-scope/invariant
@deepseek-ai/dsh-agent-loop/invariant
                                  package-owned relational checks
@deepseek-ai/dsh-tool-bash        the model-facing bash schema (unless toolBash=false)
@deepseek-ai/dsh-agent-instructions  AGENTS.md/CLAUDE.md workspace context loader
@deepseek-ai/dsh-tool-skill       session-prefix skill catalog + model-facing loader schema
@deepseek-ai/dsh-tool-jobs       job_output/job_list/job_kill schemas + completion notices
@deepseek-ai/dsh-agent-loop       THE concrete loop (gets the forwarded `agents`)
                                  (dsh-system-prompt gets the forwarded `persona`)
```

## 有意留在組合包外的元件

主幹包含每個入口都共有的全部元件。可替換元件和與入口耦合的元件留在外部，由載入組合包的一方選擇：

- **LLM（大型語言模型）配接器**：組合包交付抽象 `llm` 服務；葉節點在 `ctx.llm` 上註冊具體配接器（`llm-deepseek`、`llm-pi-ai`、`llm-replay`）。
- **基於模型的工作階段標題提供方**：組合包掛載帶可覆蓋示例限制的後備服務（5 個詞、40 個後備位元組、80 個可接受標題位元組）；葉節點可以恰好選用一個首訊息或全訊息 LLM 提供方。
- **bash 執行器**：組合包交付 `tool-bash`（消費端 schema）；葉節點提供 `ctx.shell`（`bash-local` 或沙盒化實作）。
- **非本機 skill 提供方**：組合包交付 skill 登錄檔、本機檔案系統提供方和 `skill` 工具；部署可以把嵌入式目錄或遠端目錄等其他提供方作為同級外掛程式新增。
- **入口與各應用基礎設施**：無頭、ACP（Agent Client Protocol）和 JSON-RPC 應用包負責傳輸、stdout 與重新載入選擇。`timer` 保留在主幹中，因為它是共有元件且不寫 stdout。

這裡在組合層應用 [Service Definition／Service Provider／Consumer 的職責分離](../../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)：組合包擁有共享主幹，葉節點擁有後端，應用包擁有入口。

## 設定

```ts
import type { Config } from '@deepseek-ai/dsh-agent-spine-demo'
// { agents?, maxParallelToolCalls?, includeHarnessIdentity?, includeRuntimeContext?, persona?, toolOrder?, tools?, dshHome?, sessionTitle?, skills?, workspaceContext, toolBash?, jobs?, toolJobs?, goals?, invariants? }
// workspaceContext requires { maxBytes } or false; the other owner schemas supply defaults.
```

組合包將每個欄位轉發給擁有它的子節點。應用包提供預建立的 agent：無頭和 JSON-RPC 組合會建立 `main`，ACP 應用則在 `session/new` 按需建立 agent。`includeRuntimeContext: false` 會轉發給 `dsh-system-prompt`，為新建工作階段抑制所有動態上下文快照，但不停用其策略服務。提示詞、工具、標題、skill、工作區上下文、不變式、目標和任務設定沿用其所屬包記錄的 schema 與預設值；`jobs.maxConcurrentJobsPerOwner` 設定本機 Service Provider，並與面向模型的 `toolJobs` 控制工具相互獨立。`pickSpineConfig()` 只複製該組合包擁有的欄位，`dshHome` 值衝突會在組合時失敗。

例如，`{ invariants: { enabled: true, package_allowlist: ['^@deepseek-ai/dsh-'], package_blocklist: ['agent-loop$'] } }` 會讓包擁有的配套外掛程式保持掛載，但抑制被阻止的擁有者。Blocklist 匹配優先於 allowlist 匹配；正規表達式與生命週期規則見 [`dsh-invariants`](../../runtime-diagnostics/invariants/README.md)。

## 為何使用程式碼組合包，而非共享 YAML include

YAML include 可以去重設定，卻無法擁有 bin 或提供入口預設值。ACP 應用包預設接出協定純淨的 stdout，但葉節點仍可新增不安全的 logger。組合包子節點把服務註冊到根 isolate-keyed store，因此葉節點的同級外掛程式無需相依性載入順序即可透過注入看到它們。

重試策略可能在新的編號步驟中重複失敗的請求。重試狀態、提供方錯誤和失敗的部分區塊不進入模型歷史；每次提供方嘗試仍可能產生計費；always 模式沒有嘗試次數上限；入口從所有已記錄步驟推導用量；重建的請求保留先前前綴，以便複用提供方快取。

## 模型體驗

模型透過 `dsh-system-prompt`、`dsh-tool-skill`、`dsh-tool-bash`、`dsh-tools` 和 `dsh-llm-retry` 間接獲得體驗；還會透過 `dsh-tool-goal` 與 Goal Round 提示詞獲得體驗，前提是啟用 `goals`。組合包自身不新增面向模型的包裝內容。

#### KV Cache 影響

不會直接失效；上述消費端負責請求前綴的任何變更。

## 已知限制與暫緩事項

- **大部分主幹集合固定在程式碼中**：`apply()` 始終掛載核心服務；設定可以省略組合包內的目標、skill、bash 與任務控制工具，但要替換迴圈或刪除其他主幹成員，就必須組合另一個組合包。
- **不變式服務與配套外掛程式仍是固定成員**：`invariants.enabled: false` 或包篩選器會抑制檢查，但不會移除服務或配套外掛程式註冊；Session 始終啟用的校驗與凍結是另一套機制。
