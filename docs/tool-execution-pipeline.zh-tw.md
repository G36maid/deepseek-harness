<!-- 英文原始檔由 scripts/gen-doc-graphs.ts 生成；本中文文件是透過雙語配對維護的經評審對側。
     更新時先執行 `pnpm run gen-doc-graphs` 更新英文，再更新本文件並執行 `pnpm run verify-translation-pairing --write docs/tool-execution-pipeline.md` 重新記錄配對。 -->

# 工具執行管線

[English](tool-execution-pipeline.md) | [简体中文](tool-execution-pipeline.zh.md) | 繁體中文

此圖展示策略、掛鉤、沙盒、檔案系統守衛、結果重寫、最終結果觀察和 UI 算繪在不改變迴圈的情況下何時執行。`tools/pre-execute` waterfall（瀑布式事件）首先執行，隨後是單調守衛，然後執行 `tools/execute` 和 `tools/post-execute` waterfall；這三個 waterfall 可以改寫一次呼叫。由定義自身控制的 `finalizeContent` 和 `tools/result` 在此之後執行。

```mermaid
flowchart TD
  model["Assistant message contains tool-call block"]
  toolCall["Session event: <code>tool/call</code><br/>logged before execution"]
  presentCall["UI pending card<br/>presentCall(args)"]
  pre["<code>tools/pre-execute</code> waterfall<br/>hooks, permission, sandbox"]
  guards["Registered monotonic guards<br/>deny or abstain; identity protected"]
  denied["denied or approval refused<br/>tool body skipped"]
  approval["<code>ctx.approval</code> one-shot prompt<br/>absent or unanswerable: deny"]
  around["<code>tools/execute</code> waterfall<br/>timeout, retry, metrics (around dispatch)"]
  toolBody["Registered tool execute() body"]
  fsGate["<code>fs/write-intent</code> or <code>fs/edit-intent</code><br/>tool-fs mutations only"]
  owned["Tool-owned session events<br/><code>todo/write</code>, <code>fs/observed</code>, <code>hook/invoked</code>, <code>hook/result</code>, <code>tool/code-dispatch</code>"]
  post["<code>tools/post-execute</code> waterfall<br/>accept, block, replace, add context"]
  normalized["Registry outer normalization<br/>pipeline/result snapshot throws become isError"]
  finalize["ToolDefinition.finalizeContent<br/>last content-only invariant"]
  final["<code>tools/result</code> synchronous notification<br/>frozen authoritative outcome"]
  context["Active-batch additionalContexts FIFO<br/>injected user/message after recorded tool results"]
  toolResult["Session event: <code>tool/result</code><br/>single model-facing outcome"]
  allResults["Tool batch settled<br/>recorded tool/result events complete"]
  presentResult["UI completed card<br/>presentResult(args, result)"]
  model --> toolCall
  toolCall --> presentCall
  toolCall --> pre
  pre -->|allow| guards
  guards -->|allow| around
  guards -->|deny| denied
  guards -.->|throw| normalized
  around --> toolBody
  pre -->|deny| denied
  pre -->|ask| approval
  approval -->|allowed-once| guards
  approval -->|rejected, cancelled, unavailable| denied
  approval -.->|throw| normalized
  denied --> post
  pre -.->|throw| normalized
  toolBody --> fsGate
  fsGate --> toolBody
  toolBody --> owned
  toolBody --> around
  around --> post
  around -.->|wrapper throws| normalized
  post -.->|throw| normalized
  post --> finalize
  normalized --> finalize
  finalize --> final
  final --> toolResult
  toolResult --> presentResult
  toolResult --> allResults
  allResults --> context
```

檔案系統的先讀後編輯檢查位於 `tool-fs` 之下，透過 `fs/*` 事件實作。通用的前置／後置 waterfall 承載掛鉤與審批策略；`ctx.approval` 在單調守衛之前處理詢問，而不得重新排序的所有者策略仍作為已註冊的守衛。逾時等環繞分發關注點對 `tools/execute` 進行包裝。登錄檔會對候選結果進行無損快照；如果快照失敗，則會先將失敗規範化，之後再由可見定義中已隨快照固定的 `finalizeContent` 回呼強制執行其同步且僅限內容的不變式。隨後，`tools/result` 會觀察不可變、可由 JSON 無損表示的結果。這樣一來，掛鉤便可跨越不同工具系列，而無需讓工具與某個策略服務耦合。Code Mode 會將保留的 `run_code` 傳輸及其序列化子呼叫都送入管線；子呼叫攜帶父級 token、記錄 `tool/code-dispatch`、將拒絕呈現為具有約束力的駁回，並省略 `additionalContexts`，以保持呼叫與結果相鄰。

維護模式：英文原始檔包含人工維護的 Mermaid 流程圖，並由生成器寫出；本中文文件作為經評審對側透過雙語配對維護。確切的工具 schema 與事件簽名位於生成的目錄中。
