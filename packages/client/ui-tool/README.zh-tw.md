# @deepseek-ai/dsh-client-ui-tool

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

Client 工具展示外掛程式。`ui-conversation` 透過 `conversation.chat.node` 的匹配 key 分發每個已排序的 `tool-call` Conversation Node；本包渲染其中的 root 及其 Code Dispatch 子呼叫，並把每個原子呼叫透過 keyed slot `tool.call.toolview` 分發。沒有註冊的工具名稱使用通用卡片。

業務 UI 包只註冊 wire 工具名稱和原子檢視表，不配對工作階段事件、不重建 transcript（文字記錄），也不擁有 root/subcall 拓撲。執行時期仍對 call/result 配對、生命週期和遞迴 `subCalls` 投影擁有最終決定權；conversation view 仍對 ChatFlow 位置擁有最終決定權。

## 渲染約定

`ToolCallTree` 接收一個已經包含遞迴 `subCalls` 的 root `ToolCallBlock`、selection 狀態、工作階段 `cwd`，以及用於開啟檔案和檢查呼叫的 Host 回呼。它遞迴遍歷標準呼叫塊，讓 root 與任意深度的 child 經過同一條原子分發路徑，不訂閱獨立的 parent-to-children map。

每個 root 和 child 包裝層都保留 `data-chat-anchor-key="call:<id>"` 與 `data-chat-call-id` DOM 約定，供分頁和 selection 使用。

本包還透過 `ToolDetails` 填充 `conversation.details.tool`。行 renderer 與詳情 renderer 共用同一組面向 `terminal`、`read`、`diff`、`search` 和 `web` render intent 的純 card model。未知的 intent 標籤和格式錯誤的 wire card 資料都會回退為壓平的工具結果文字。

通用行把已知工具名稱歸類為 search、read、shell、write、edit、code 或 generic 變體。執行中、成功、失敗和中斷狀態只來自凍結的 call/result slice。只有使用者呼叫 Host 開啟檔案回呼時，檔案路徑才相對工作階段 `cwd` 解析；展示程式碼不讀取工作階段服務。

## 原子工具檢視表

擁有該檢視表的業務包將其 wire 工具名稱註冊進 `tool.call.toolview`：

```ts ignore-check
ctx.slots.inject('tool.call.toolview', () =>
  ctx.slots.register({
    name: 'tool.call.toolview',
    key: '<wire tool name>',
  }, BusinessToolRow))
```

owner 載荷為 `ToolCallOwnerProps`：`callId`、`toolName`、凍結的 `block`、選填 `cwd`，以及普通的 `openFile`、`inspect` 回呼。註冊項會收到常規的工作階段 slot 執行時期共享資料，但不會收到 React node、執行時期服務或 root/subcall 知識。

本包當前擁有 generic fallback，以及 shell/pwsh、read、write/edit、grep/glob、web、todo、question 和 Code Dispatch 的內建展示。`ui-skill` 展示了業務包自行擁有的 `skill` 註冊項。

各類卡片的上限與 fallback 規則仍由對應的 [terminal](../../../.agents/notes/implemented/feature/2026-07-28-web-terminal-card.md)、[diff](../../../.agents/notes/implemented/feature/2026-07-30-web-diff-card.md)、[read](../../../.agents/notes/implemented/feature/2026-07-30-web-read-card-frontend.md)、[search](../../../.agents/notes/implemented/feature/2026-07-30-web-search-card.md) 和 [web](../../../.agents/notes/implemented/feature/2026-07-30-web-result-card-frontend.md) Agent Note 負責。

## 模型體驗

無，因為本包只渲染已經記錄的工具呼叫和結果，不改變模型請求、工具執行或工作階段事件。

#### KV Cache 影響

無。本包只負責 Client 展示。

## 已知限制與後續工作

- Host 不把 `run_code` 暴露為 Code Mode 程序 binding，因此生產事件只產生一層分發；遞迴的執行時期/UI 約定支持巢狀。
- 第一方工具檢視表集中在本包，可以透過 keyed slot 獨立遷移到各自所屬的業務包。
- 工具文案複用 `ui-conversation` locale namespace。
