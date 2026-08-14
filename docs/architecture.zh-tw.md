# DeepSeek Harness 架構

[English](architecture.md) | [简体中文](architecture.zh.md) | 繁體中文

改動 `packages/` 下的任何內容之前，請先閱讀本文。本文假定你已瞭解 Cordis；如果尚未瞭解，請先閱讀[入門](cordis-primer.md)或[教學](cordis-tutorial/index.md)。

建議使用 agent（代理）探索程式碼庫並理解其架構。

## Cordis

[Cordis](cordis-primer.md) 是 dsh 底層的框架：外掛程式向共享上下文貢獻服務、類型化事件和可逆的副作用。產品的每一部分都是外掛程式，包括模型配接器、工具登錄檔、工作階段日誌，以及 agent loop（代理循環）本身，因此每一部分都可以從設定替換。

不存在需要打修補程式的特權核心：擴充 dsh 的方式是把外掛程式掛載到其他外掛程式旁邊，而各項註冊都是副作用，會在其外掛程式解除安裝時撤銷。

## Profile 與組合包

執行中的 `dsh` 是一棵外掛程式樹，由啟動時按序疊加的各層組合而成。

**profile** 是存放在 Harness home 中的具名組裝。它列出自己疊放的組合包，存放自己安裝的樹外外掛程式，並保存使用者自己的 `cordis.patch.yml`。`web` 和 `headless` 作為樣板隨發行版交付。

**組合包**是 Cordis 設定項及其掛載程式碼的分發格式，因此它插入的內容始終可被其上各層 patch。

兩者都在各自的 `package.json` 中透過 `dsh` 欄位聲明自己：`dsh.profile` 列出一個 profile 的組合包，`dsh.bundle` 指向一個組合包的 patch 文件。

[`dsh-base`](../packages/bundle/base/README.md) 是每個 profile 的第一層：模型配接器、工具、持久化、沙盒與審批策略、設定、憑據、遙測。[`dsh-web-app`](../packages/bundle/web-app/README.md) 增加瀏覽器應用；[`dsh-headless`](../packages/bundle/headless/README.md) 增加一次性執行器，且完全不帶伺服器。

各層按此順序應用在空條目清單之上：先按 profile 列出的順序應用每個組合包，然後是 profile 的 `cordis.patch.yml`，然後是 home 級的那份，最後是任意 `--patch` overlay。一條 patch 按 id 定位某個條目並替換其整個 config，或插入新條目。

要查看你的機器實際啟動的設定樹：

```sh
dsh --profile web --dump-config
```

它列印出的任何條目，都可以由你自己的 patch 替換。

組裝機制見 [app-boot](../packages/boot/app-boot/README.md#profiles)；設定欄位見生成的[設定目錄](config-catalog.md)。

## 核心包

以下是向 Cordis 樹貢獻內容的部分核心包。

| 包 | 職責 | `ctx` 鍵 |
|---|---|---|
| [`core/session`](subsystems/session.md) | 僅附加的 `SessionEvent` 日誌和記憶體儲存 | `ctx.sessions` |
| [`core/system-prompt`](subsystems/system-prompt.md) | 提示詞片段與工具 schema 的組裝 | `ctx.systemPrompt` |
| [`core/tools`](subsystems/tools.md) | 作用域化的工具登錄檔和帶把關的執行管線 | `ctx.tools` |
| [`core/agent`](subsystems/core.md) | `Agent` 介面、活躍 agent 登錄檔和 `agent/*` 事件 | `ctx.agents` |
| [`core/agent-loop`](subsystems/core.md) | 實作該介面的預設驅動器 | `ctx.agentLoop` |
| [`core/scope`](subsystems/scope.md) | 按 agent 劃分作用域的註冊原語 | 庫，無 ctx 鍵 |
| [`llm/llm`](subsystems/llm-streaming.md) | 訊息與流式詞彙表，以及配接器 seam | `ctx.llm` |

<a id="events"></a>

## 事件

事件就是擴充點，而選對事件域是大多數改動的第一個決定。

- **工作階段事件**是追加到日誌並透過 `session/event` 廣播的持久事實。當某個事實必須在重新載入後仍然存在時，使用它。
- **Agent 事件**（`agent/*`）攜帶活躍 `Agent`：inbox、步驟、狀態、請求、驗證、續跑。要觀察或攔截進行中的工作時，使用它。
- **能力事件**無需匯入迴圈即可向某個 seam（`fs/*`、`tools/*`、`telemetry/*`）附加策略和配接器。

[事件對映](event-producer-consumer.md)列出每個事件的生產方與消費端。

<a id="turn-flow"></a>

## 輪次流程

一個**步驟**是一次模型請求加上它呼叫的工具。一個**輪次**包含零個或多個步驟：它在領取首條輸入之前打開，並在不再欠下任何工作時關閉。

```text
turn/start
  claim next-step input plus one queued message
  assemble prompt sections + tool schemas
  -> agent/pre-step                   reject | enter(messages)
     reject, or a first enter rewritten empty -> close the turn with no step
     step/start
     append entered messages as user/message
     derive model history from the log
     agent/request -> llm/stream -> assistant/chunk* -> assistant/message
     tool/call* -> tools/pre-execute -> tools/execute -> tools/post-execute -> tool/result*
     step/end
     tools owe another request, or next-step input arrived -> claim -> next step
  -> agent/turn-stopping
turn/end
```

`turn/*`、`step/*`、`user/message`、`assistant/*` 和 `tool/*` 是持久工作階段事件；其餘是分屬三個事件域的即時擴充點。`agent/pre-step`、`agent/request`、`llm/stream` 和三個 `tools/*` 事件是 waterfall（瀑布式事件），其監聽器必須呼叫 `next()` 才能委託下去；`agent/turn-stopping` 是 serial 事件，沒有 `next()`。

輸入透過同一個 inbox 到達驅動器。有些訊息會立即喚醒它；注入的上下文會留在 inbox 中，直到另一則訊息將其喚醒。

`agent/pre-step` 決定模型看到什麼。監聽器可以改寫已領取的訊息，也可以直接拒絕它們；首次領取被拒絕或被改寫為空時，仍會關閉一個不含步驟的持久輪次，因此日誌會記錄這次嘗試。每個步驟讀取外掛程式註冊的提示詞片段和工具 schema。

詳情見[時序圖](agent-lifecycle.md)、[工具管線](tool-execution-pipeline.md)和[取消與錯誤復原](subsystems/core.md#the-agent-handle)。

## 工作階段日誌

工作階段日誌是模型所見上下文的來源。`deriveMessages()` 從中投影出模型歷史，原始 `assistant/chunk` 事件則保證重播和 UI 保真。fork、復原、transcript（文字記錄）、遙測和持久化都派生自該事件串流。

**模型可見即已記錄。** 抵達模型請求的一切都必須能從日誌重建，並由一項執行時期不變數斷言這一點。因此，新增一項模型可見輸入就需要新增一個工作階段事件：擴充 `SessionEventMap` 並從日誌算繪。

## 能力 seam

一個 **seam** 是一項可替換能力，包含三種角色：聲明介面的 **Service Definition**、實作它的 **Service Provider**，以及使用它的 **Consumer**（通常是面向模型的工具）。一個包可以合併承擔多個角色，但單一角色本身不是 seam；新增一項能力意味著把三者一並設計（[能力圖](capability-seams.md)）。

seam 正是替換一個提供方就能改變整個產品的原因。檔案系統與行程提供方共享同一個執行世界，因此把它們指向遠端沙盒，也就把 Bash、PTY 和 LSP 一並搬了過去，無需提供方專用 fork。[subagent 提供方](subsystems/subagent.md)在同一個介面之後同樣千差萬別，從新建一個子 agent，到把一個輪次委派給另一個產品。

## 新行為的歸屬位置

新行為附加到已有文件記錄的擴充點。改動迴圈本身時，本對映隨之更新。

| 目標 | 機制 |
|---|---|
| 新增模型提供方 | 在 `ctx.llm` 上註冊其配接器 |
| 新增面向模型的能力 | 在 `ctx.tools` 上註冊；其 schema 加入提示詞組裝 |
| 讓某個工作階段擁有不同的能力集合 | 組裝一個 agent preset；其中的服務行需要 `isolate` realm |
| 新增 shell 執行 | 註冊 `ctx.shell` 後端；本機後端透過 `ctx.subprocess` spawn 行程 |
| 新增持久化終端機執行 | 註冊 `ctx.terminals` 後端和 `dsh-tool-terminal` |
| 新增使用者命令 | 在 `ctx.commands` 上註冊；它無需模型輪次即可分派 |
| 新增後臺工作 | 在 `ctx.jobs` 上註冊；`job_*` 工具負責收集或停止 |
| 新增檔案系統訪問或策略 | 註冊 `ctx.fs` 提供方，或監聽 `fs/*` 事件 |
| 限制所啟動的行程 | 使用 `ctx.sandbox` 後端；消費端在啟動行程前包裝 argv |
| 攔截請求、工具或輪次 | 使用相應的 `agent/*` 或 `tools/*` 事件；`agent/turn-stopping` 會停止輪次 |
| 新增模型可見上下文 | 呼叫 `agent.inject()`；它會落到下一次獲準的請求中 |
| 新增 UI 或編輯器整合 | 驅動 `ctx.agents` 並從 `session/event` 算繪 |
| 新增 Web Client Chat 節點 | 註冊 `ConversationNodeDefinition` + keyed renderer |
| 新增持久工作階段狀態 | 擴充 `SessionEventMap`；從日誌算繪和重播 |
| 生成工作階段標題 | 註冊唯一的 `ctx.sessionTitle` 提供方 |
| 管理同工作階段目標 | 使用 `ctx.goals`；透過 `agent/*` 續跑 |
| fork 活躍工作階段 | `ctx.sessions.fork(source, boundary?, childSessionId?)` |
| 將註冊項限定到單個 agent | 使用該 agent 的 `agent.ctx` |

[擴充實作手冊](cookbook/extension-cookbook.md)將功能對映到能力，並索引[包](cookbook/adding-a-package.md)、[工具](cookbook/adding-a-tool.md)、[LLM（大型語言模型）配接器](cookbook/adding-an-llm-adapter.md)和 [Chat 節點](cookbook/adding-a-conversation-node.md)的分步指南。
