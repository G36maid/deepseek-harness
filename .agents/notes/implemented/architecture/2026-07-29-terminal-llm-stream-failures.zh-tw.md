# Agent Note: LLM 流的終止失敗

Status: implemented

[English](2026-07-29-terminal-llm-stream-failures.md) | [简体中文](2026-07-29-terminal-llm-stream-failures.zh.md) | 繁體中文

本說明僅取代[有界 LLM（大型語言模型）請求復原](2026-06-21-bounded-llm-request-recovery.md)與[呼叫後上下文溢位復原](2026-07-10-after-call-compaction-pressure-and-overflow-recovery.md)中關於拋出錯誤身份和呼叫區域性 sidecar 的機制。上述說明繼續規定結構化失敗事實、重試策略、持久嘗試與壓縮（compaction）復原。

## Problem

配接器失敗曾有兩種公共表示：選擇、分發、iterator 構造或迭代拋出的例外，以及帶內的 `finish { kind: 'error' | 'aborted' }`。`LlmRuntime` 會在以流為鍵的 sidecar 中標記拋出對象，使 agent loop（代理循環）能將其與 middleware 和消費端失敗區分開。消費端仍需用 catch 包圍迭代、signal 檢查、區塊日誌記錄和組裝；正確性因此取決於證明是哪條語句拋錯，並查詢附著於所返回的那個 iterable 的元資料。

重試策略也採用同樣的間接歸屬。儘管 `prepareCall()` 已捕獲服務註冊，策略仍要在分發後透過流 sidecar 尋找。因此，由包裝層提供服務的路由與由配接器提供服務的路由共用一個不透明查詢 API，儘管兩者的權威不同。

## Decision

`LlmRuntime` 是一次配接器嘗試的規範化邊界。它只捕獲最終配接器選擇、同步分發、iterator 構造與 `next()` 失敗，將拋出值轉換為不可變 `LlmFailure`，並行出一個終止 `finish`。呼叫方取消或 `ABORTED` 失敗選擇 aborted 結束原因；其他配接器失敗選擇 error 結束原因。配接器也可以直接寄出任一終止原因。

配接器所屬的 catch 會在每個區塊被 yield 前結束。來自 `llm/stream` middleware、巢狀呼叫、配接器清理、區塊消費端、日誌記錄、signal 檢查與組裝的錯誤仍作為缺陷或生命週期失敗拋出；它們絕不進入模型請求復原。部分 delta 之後的傳輸失敗可能留下未關閉塊，因此流 invariant 只允許在終止 finish 的結束原因為 error 或 aborted 時存在未關閉塊。不會從這些不完整輸出組裝 assistant 訊息或工具呼叫。

`PreparedLlmCall` 公開隨其設定和註冊捕獲的不可變重試策略。一次性控制代碼複用與設定不匹配仍是同步的 `INVALID_PREPARED_CALL` 誤用錯誤。完全由 `llm/stream` middleware 提供服務的路由沒有準備完成的註冊，因此也沒有服務策略。

agent loop 只消費一種失敗表示。它不再使用分類 catch，而是直接迭代並記錄區塊、檢查終止 finish，再把其中的失敗事實與準備完成的策略傳給 `agent/request-error`。公共的 `isLlmAdapterFailure`、`llmFailureOf` 和 `llmRetryPolicyOf` sidecar API 不再存在。

## Alternatives considered

**保留呼叫區域性錯誤標記。** 這會保留拋出對象身份，但要求每個消費端用 catch 包圍一段包含自身易失敗工作的區域，並讓分類相依性 iterable 包裝層的身份。原始錯誤對象無法在復原中發揮持久作用；規範化事實纔是有用的邊界值。

**要求所有配接器寄出失敗區塊，並禁止拋出。** 庫 iterator、transport 與 JavaScript 分發仍可能拋錯。要求每個配接器複製同一 catch 邊界會造成職責重複，也無法保護 `LlmRuntime` 的直接消費端免受不完整實作影響。

**在 agent loop 中捕獲所有迭代錯誤。** 如果不重新建立從流對象到建立該對象的配接器呼叫的 sidecar 對映，loop 無法可靠區分提供方失敗與 middleware、工作階段追加、取消或組裝失敗。分類應由發起配接器呼叫的位置負責。

**在流式輸出前返回 `Result`。** 流前結果無法表示部分輸出之後的傳輸失敗，除非增加第二套回應生命週期。現有終止區塊已能表示早期和後期嘗試結果。

## Consequences

所有 `LlmRuntime.stream()` 消費端都透過一種帶類型的終止協議接收配接器執行失敗，而程式設計與生命週期失敗保留普通例外語義。復原放棄精確拋出對象身份，只暴露與原對象分離的提供方無關事實。流服務承擔略多的配接器處理工作，但消費端刪除了用於判斷哪個配接器拋出例外的 catch，也刪除了以流為鍵的元資料。準備完成的呼叫顯式攜帶策略，而完全由 middleware 提供服務的路由仍明確沒有策略。
