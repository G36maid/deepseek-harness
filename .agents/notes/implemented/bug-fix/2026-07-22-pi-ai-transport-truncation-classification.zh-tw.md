# Agent Note: 從扁平化的訊息文字中分類 pi-ai 傳輸層截斷

Status: implemented

[English](2026-07-22-pi-ai-transport-truncation-classification.md) | [简体中文](2026-07-22-pi-ai-transport-truncation-classification.zh.md) | 繁體中文

## 問題

一次 TUI 執行的模型連線在流式輸出中途中斷連線，只浮現出一條 `terminated` 通知，而一個被截斷的 Anthropic 回應則浮現出 `Anthropic stream ended before message_stop`。兩者都是傳輸層截斷——連線在提供方的終止 SSE（Server-Sent Events）事件之前就已中斷連線——然而 `dsh-llm-pi-ai` 中的 `classifyPiAiError` 對兩者都不匹配，最終落入兜底的 `PI_AI_ERROR`。由於 `PI_AI_ERROR` 不在 `llm-retry` 的 `DEFAULT_RETRYABLE_CODES`（`RATE_LIMIT`、`SERVER`、`TIMEOUT`、`TRANSPORT`）中，一次可復原的中斷連線被當作永久性失敗處理，從未被重試。

細節丟失發生在上游，且在配接器內無法復原：pi-ai 在推送終止 `error` 事件之前，把捕獲到的錯誤縮減為 `error.message`（`api/anthropic-messages.js`：`errorMessage = error instanceof Error ? error.message : JSON.stringify(error)`），丟棄了原始的 `Error` 及其 `cause` 鏈。undici 將可據以採取行動的 `SocketError` 放在 `cause` 上，卻只交給 fetch 包裝層一個裸的 `terminated`；pi-ai 只保留了這個詞。pi-ai 的 `SimpleStreamOptions` 沒有暴露任何 fetch/dispatcher/client 掛鉤，讓我們能在細節被扁平化之前自行捕獲 `cause`。

## 決策

- `classifyPiAiError` 識別另外兩種傳輸層措辭，並將兩者都對映為 `TRANSPORT`：
  - 流式輸出中途的Socket中斷連線，呈現為裸的 `terminated`（undici）或 `Premature close`（Node 流層）；
  - 在終止事件之前被截斷的流，每個 pi-ai 提供方各自拋出不同措辭（`Anthropic stream ended before message_stop`、`… before a terminal response event`、`… ended without a terminal event`、`Stream ended without finish_reason`），統一按 `stream ended before/without` 匹配。
- 該分類器帶有一條 `XXX(pi-ai upstream)` 注記，點名扁平化發生的位置並說明期望的修復方式：如果 pi-ai 有朝一日轉發原始的 `Error` 或提供一個讓我們捕獲 `cause` 的掛鉤，就改為基於 `code`/`cause` 分類。在此之前分類仍是盡力而為的文字匹配。
- `llm-pi-ai/README.md` 新增一條 Known-Limitations 條目，記錄 pi-ai 會扁平化 cause 鏈，因此 harness code 是從訊息文字中分類出來的。

分類仍然基於訊息文字，因為那是 pi-ai 唯一交付的訊號；`XXX` 標明它是一個權宜之計，而非期望的最終狀態。

## 考慮過的替代方案

**透過 pi-ai 的 fetch/dispatcher/client 掛鉤捕獲 `cause`。** 否決：pi-ai 0.81.1 一個都沒暴露。`StreamOptions` 只提供 `onPayload`/`onResponse`；`onResponse` 在回應體流被消費之前觸發，因此無法觀察到流式輸出中途的中斷連線。Anthropic 路徑接受一個 `client` 對象，但為攔截傳輸錯誤而為每個請求構造並注入一個提供方 SDK client，只為一個診斷字串就越過了配接器的服務邊界。

**把兩者都保留為 `PI_AI_ERROR`，並放寬 `llm-retry` 的可重試集合。** 否決：`PI_AI_ERROR` 是真正未分類失敗的兜底，其中包括不可重試的失敗（畸形的提供方回應、意料之外的 SDK bug）。讓兜底可重試會重試那些永遠不會成功的失敗；修復之道是分類出可復原的那種情況，而不是模糊這個類別。

**在配接器裡把扁平化後的錯誤包裝成 `LlmError('TRANSPORT', { cause })`，仿照 DeepSeek 配接器。** 在此否決：DeepSeek 配接器包裝的是拿到回應之前的 `fetch` 拒絕，其 `cause` 仍然完好，因此鏈式包裝保留了真實細節。而在 pi-ai 路徑中，終止事件的 `errorMessage` 已經是一個沒有 `cause` 可鏈的扁平化字串，因此包裝只會加一層卻復原不了任何東西；分類出 code 是唯一還能增加的價值。

## 後果

- 流式輸出中途的傳輸層中斷連線和終止前的流截斷現在都攜帶 `TRANSPORT`，因此組合出的 `llm-retry` 策略會默認重試它們，而不是讓該輪次失敗。
- 通知文字不變（`terminated` / `Anthropic stream ended before message_stop`）：cause 細節在配接器看到之前就已丟失，因此 `errorChain` 沒有更多內容可渲染。只有被路由的 `code` 得到了改善。
- 分類仍然相依性字串匹配且相依性提供方的措辭：未來某個 pi-ai 版本若改寫這些錯誤的措辭，就會靜默回退到 `PI_AI_ERROR`，直到模式被更新。`XXX` 注記指向那個持久的修復方式（基於轉發的 `code`/`cause` 路由）。
