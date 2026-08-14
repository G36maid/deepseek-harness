# dsh-agent-tool-presentation

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

[agent preset](../../preset/agent-presets/README.md) 用來聲明「模型看到的工具是哪一種形態」的那一行：`native`（全部 schema）、`code`（只有 `run_code` 加一份生成的 TypeScript SDK）或 `both`。

## 為什麼是一行外掛程式，而不是把登錄檔搬下來

工具登錄檔搬不進 preset。它的消費者全在宿主平面——[`dsh-agent-loop`](../agent-loop/README.md) 讀它的調度器，[`dsh-apiproxy`](../../host/apiproxy/README.md) 讀它的 presenter 來渲染工具卡，每個工具外掛程式都往裡註冊——而一個服務只有在**所有**消費者一起下沉時才能下沉。

preset 能擁有的是這份登錄檔的**呈現方式**。`ctx.tools.presentAs()` 只為正在掛載的那個 agent 聲明，於是一個 Code Mode 工作階段可以和多個 native 工作階段同進程並存，各自看到各自的清單。[`dsh-tools`](../tools/README.md) 那一行上的 `mode` 仍然是預設值，供未作聲明的 agent 使用。

## 它做什麼

`native` 立即生效。code 類模式則等待 `ctx.codeRuntime`——這是一個宿主平面服務（[`dsh-code-runtime-worker-thread`](../../code-runtime/code-runtime-worker-thread/README.md)）：若某個 preset 在未組裝執行時期的部署上選擇 Code Mode，本行就停在 pending，`dsh-agent-presets` 會指名此 id 拒絕掛載。另一種做法——先樂觀應用——會把失敗推遲到該工作階段的第一次請求，那時操作者對 preset 和組裝都已無從下手。

`mode` 是必填而非有預設值：不帶這一行的 preset 本來就會拿到部署預設值，省略它等於這一行白組裝了。

一個 agent 只聲明一次呈現方式。同一份組裝裡的第二次聲明會被拒絕而不是合併：對「模型看到哪種形態」給出兩個答案是矛盾，不是覆蓋。

## 模型體驗

間接生效，取決於它在 `dsh-tools` 中選擇的投影：`code` 呈現 `run_code`、一份生成的 SDK 段，以及「只有 `run_code` 可被直接呼叫」這條規則，`native` 呈現每個工具的 schema。該選擇同時決定了**什麼可以執行**：在 `code` 下，登錄檔會把模型直呼其他任何工具名解析為 `UNKNOWN_TOOL`，因此這一行正是讓「通告面」與「可呼叫面」對每個被它覆蓋的 agent 保持一致的東西（[執行器塌縮 note](../../../.agents/notes/implemented/bug-fix/2026-08-07-code-mode-executor-collapse.md)）。

#### KV Cache effect

沒有直接的失效影響；呈現方式在 agent 組裝時即固定，因此其請求前綴在該工作階段的整個生命週期內保持穩定。

## 已知限制與暫緩事項

- **執行時期仍在宿主平面** —— preset 可以選擇 Code Mode，卻無法自帶它所需的 TypeScript 執行時期；未組裝執行時期的部署也就無法組裝任何 code 模式的 preset。
