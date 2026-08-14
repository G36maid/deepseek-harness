# Agent Note: 保留單一公開停止原語

Status: implemented

[English](2026-06-20-public-agent-stop-api.md) | [简体中文](2026-06-20-public-agent-stop-api.zh.md) | 繁體中文

## 問題

公共 `Agent` handle 暴露了兩種相互重疊的運送中工作停止方式：僅針對步驟的 `abort()` 和感知佇列的 `cancel()`。前者保留已排隊輸入，後者原本只暴露廣義默認行為，該行為會清除已排隊和 steering（中途引導）工作，同時中止活動輪次。`cancel(cause, { keepInbox: true })` 現在無需暴露私有輪次 holder 即可覆蓋生產環境的 Web 停止策略；ACP（Agent Client Protocol）保留廣義取消，生命週期擁有者則透過 `AgentHandle.dispose()` 拆除 agent（代理）。沒有生產呼叫方需要一個裸的、僅針對步驟的 abort。

行為差異確實存在，但實際交付的程式碼不需要獨立的更窄動詞。AgentLoop 為整個輪次擁有一個私有取消 holder。`cancel(cause, options?)` 攜帶顯式且類型化的 `user` 或 `parent` 原因；其廣義默認行為丟棄待處理輸入，`keepInbox` 則為後續輪次保留待處理工作。dispose（資源釋放）仍是單獨的生命週期中斷。完整的歸屬與傳播約定位於[顯式輪次取消 Agent Note](../architecture/2026-07-16-explicit-turn-cancellation.md)。

多餘的公開介面使迴圈承載了一個本質上屬於內部拆卸的公開動詞。帶選項的 `cancel()` 可以表達呼叫方策略，而無需暴露第二個 holder 形態的操作。

## 決策

`cancel()` 是 `Agent` 上唯一的公共*停止*原語。生命週期擁有者使用 `AgentHandle.dispose()` 停止並註銷 agent；非擁有者使用廣義 `cancel()` 放棄當前和已排隊工作，或使用 `keepInbox` 中止活動輪次並保留待處理工作。實作保留一個私有輪次取消 holder，但它不屬於面向外掛程式的 `Agent` 約定。[Web 停止決策](../bug-fix/2026-07-31-web-stop-preserves-queue.md)是生產環境中的 `keepInbox` 消費端。

`whenIdle()` **保留**為公開的完全靜止觀測原語（agent 退出 `running` 狀態並完全靜止後 resolve，已處於 idle 時立即 resolve，dispose 後等待迴圈退出）。它不是停止動詞；它是非所有者在不 dispose agent 的前提下觀測停止*完成*的方式。它的活躍消費端是 ACP 和透過此公開約定等待結帳的 agent 測試（`packages/acp/acp/tests`、`packages/core/agent-loop/tests`）；生產環境的 ACP 橋接層擁有其 agent 並透過 `AgentHandle.dispose()` 銷毀它們，因此 `packages/acp/acp/src` 本身沒有 `whenIdle()` 呼叫。

公共 `abort()` 已不存在，disposer 仍為非同步並等待迴圈停止。測試透過公共類型化原因和顯式 signal API 驗證取消，而不會伸入 holder 內部。

## 曾考慮的替代方案

**同時移除 `whenIdle()`**：最初提案的形態，在對照程式碼驗證前提後被推翻：它是承重的完全靜止原語，能安全處理等待者結帳與替換輪次競態，迫使消費端手動觀測 `running`→`idle` 轉換正是防禦性模式所警告的脆弱路徑。

## 驗證

`Agent` 不再暴露公開的 `abort()`，而 `cancel()`、`whenIdle()` 和 `steer()` 保留；ACP 取消呼叫廣義 `cancel()`，Web 停止呼叫 `cancel(..., { keepInbox: true })`，拆卸則透過 handle 的 dispose 等待完全靜止。`whenIdle()` 在完全靜止時為非所有者觀測者 resolve；測試套件覆蓋取消和 dispose 這兩條受支持的停止路徑。

## 後果

外掛程式可以透過 `keepInbox` 在保留已排隊提示詞的同時中止活動輪次，但不能只中止某一個模型／工具步驟而讓該輪次繼續執行。僅步驟用例需要具名消費端和更窄約定；暴露私有迴圈機制仍缺乏正當理由。

## 相關

本 Agent Note 只移除冗餘的停止動詞。輪次中途 steering 仍是一條有意保留的訊息路徑；完全靜止觀察仍透過 `whenIdle()` 完成。最終的訊息投遞介面包括 `followup()`、`steer()` 和 `inject()`；停止與觀察仍透過 `cancel()` 和 `whenIdle()` 完成。
