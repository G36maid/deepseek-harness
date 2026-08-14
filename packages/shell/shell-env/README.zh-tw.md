# @deepseek-ai/dsh-shell-env

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

工具無關的 shell 環境外掛程式：擁有 `ctx.shellEnv` 登錄檔，管理受信任的、每次執行收集的 `DSH_*` 變數，供模型可見的 shell 工具（`dsh-tool-bash`、`dsh-tool-pwsh`）收集進每次 shell 呼叫的環境。內建 shell 事實（`DSH_HOME`、`DSH_SHELL=1`、`DSH_SESSION_ID`）歸登錄檔自身所有；其他外掛程式可以註冊額外的可枚舉事實，註冊隨外掛程式纖維（fiber）釋放，重複所有權或未聲明的執行時期鍵會響亮失敗。

包根匯出 Cordis 外掛程式約定（`name`、`inject`、`Config`、`apply`）以及 `ShellEnvRegistry` 服務類及其 contributor 類型；消費端在載入本外掛程式後使用 `ctx.shellEnv`。

## Config

```yaml
- id: shell-env
  name: '@deepseek-ai/dsh-shell-env'
  config:
    dshHome: C:\Users\me\.dsh   # default: $DSH_HOME, then ~/.dsh
```

## Managed environment

每次前臺與後臺模型 shell 呼叫都會收到一份新收集的受信任 `DSH_*` 環境。`DSH_HOME` 是由 [`@deepseek-ai/dsh-home-paths`](../../util/home-paths/README.md) 解析的 Harness 主目錄絕對路徑（`dshHome` 設定，然後環境變數 `$DSH_HOME`，然後 `~/.dsh`），`DSH_SHELL=1` 標識受管理的子行程。帶 agent（代理）的呼叫額外收到 `DSH_SESSION_ID=agent.session.header.id`；當活動的持久化 seam 定位到 JSONL 工件時，它們還會收到 `DSH_SESSION_JSONL=<绝对目标路径>`。JSONL 路徑只是位置提示：首次 flush 之前它可能不存在，也不一定包含當前緩衝中的輪次，並且它不是授權憑據。

`ctx.shellEnv` 負責收集。其他外掛程式可以註冊一個受 effect 作用域約束的 contributor，帶有穩定名稱、已聲明的鍵/描述以及 `resolve(execution: ToolExecution)`；重複所有權與未聲明的執行時期鍵會響亮失敗，而 `list()` 只枚舉聲明、不執行 provider。Harness 內建鍵保留 `DSH_HOME`、`DSH_SHELL` 與 `DSH_SESSION_ID`；本外掛程式的持久化翻譯器透過讀取與後端無關的 `sessionPersistence.locate()` seam 擁有 `DSH_SESSION_JSONL`。

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-shell-env'

export const inject = ['shellEnv']

export function apply(ctx: Context): void {
  ctx.shellEnv.register({
    name: 'deployment-region',
    variables: { DSH_DEPLOYMENT_REGION: { description: 'Current deployment region.' } },
    resolve: execution => execution.agent === undefined ? {} : { DSH_DEPLOYMENT_REGION: 'cn-north' },
  })
}
```

覆蓋層根據當前 `ToolExecution` 計算，並透過專用的 `ShellExecRequest.dshEnv` 通道傳遞。本機執行器在合併該快照前移除所有繼承的 `DSH_*`，因此巢狀 harness 與並行的父子 agent 無法洩漏過時身份。`process.env` 永不被修改。shell 工具的描述只教授通用的 `$DSH_*` 約定，而不是點名持久化相關的變數或新增常駐的 system-prompt 段落。

## Model Experience

透過 shell 工具（`dsh-tool-bash`、`dsh-tool-pwsh`）間接產生影響；這些工具會把該登錄檔的受管 `DSH_*` 快照收集進每次 shell 工具呼叫。

#### KV Cache effect

不會直接導致快取失效；任何請求前綴變更均由上述消費端負責。

## Known Limitations and Deferred Work

- **`list()` 只枚舉 contributor 聲明的變數** — 登錄檔自有的內建鍵（`DSH_HOME`、`DSH_SHELL`、`DSH_SESSION_ID`）不包含在內，因此診斷、prompt 或 UI 程式碼不得把 `list()` 當作完整的環境目錄。
