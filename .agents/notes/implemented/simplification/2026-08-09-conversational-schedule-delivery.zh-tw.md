# Agent Note: 對話式 Schedule 交付

Status: implemented

[English](2026-08-09-conversational-schedule-delivery.md) | [简体中文](2026-08-09-conversational-schedule-delivery.zh.md) | 繁體中文

## 問題

Schedule 已經透過將普通的 agent（代理）後續輪次排入佇列來交付到期提醒。第二條持久 Web 回執透過 Schedule 投影、持久化成功事件、Host 歷史記錄與 live 伴隨資料、用戶端同序號升級、通用事件檢視表 slot 和專用渲染器表示同一次提醒觸發。這條路徑把一項功能的確認 UI 分散到工作階段、持久化、Host、用戶端執行時期、對話 UI 和一個額外包中。

該回執還讓「交付」有了第二種含義。即使模型輪次失敗，它仍然可見，而對話本身沒有成功的提醒答覆。使用者需要定時對話繼續進行；他們不需要一枚單獨的持久標記來證明內部 dispatch 已經嘗試過。

## 決策

到期提醒會等待 agent 的 idle maintenance phase，再呼叫 `followup()`。該操作會在稍後開啟一個普通輪次，並透過普通對話 transcript（文字記錄）顯示；Schedule 絕不會呼叫 `steer()`，也絕不會中斷當前輪次。

`schedule/change` 仍是唯一持久 Schedule 狀態。其 dispatch 操作記錄後續輪次已同步入隊，這會在 dispatch 持久化後阻止普通的重新啟動重播。dispatch 不表示模型成功、使用者確認或外部通知。入隊與持久 dispatch 之間的狹窄崩潰視窗仍保留至少一次語義。

Schedule 不公開呈現投影、Host 伴隨資料、瀏覽器事件節點、按事件鍵控的 slot 或用戶端渲染器。工作階段持久化保留共享的 `flush()` 約定，且不存在由 Schedule 驅動程式的成功事件。顯式啟用的 Web overlay 只載入 `@deepseek-ai/dsh-schedule`。

## 已考慮的替代方案

**保留提交感知回執。** 即使模型失敗，它也可以證明 dispatch 已到達持久化，但這是實作結果，而不是使用者的提醒。其跨元件協議與後到的同序號合併邏輯，與這點價值不成比例。

**在對話中渲染原始 `schedule/change` 事件。** 這樣可以避免領域卡片，但仍會把內部狀態轉換暴露為面向使用者的訊息，而且僅為 Schedule 就需要通用的內部事件呈現機制。

**把 dispatch 當作提醒已成功交付。** dispatch 發生在模型請求之前，無法證明 assistant 答覆存在或已被讀取。將其稱為交付會誇大持久事實。

**提醒到期時中途引導當前輪次。** 中途引導會改變進行中的請求路徑，並讓定時觸發中斷無關工作。等待完全 idle 後使用 `followup()`，可讓每條提醒分別進入一個普通的後續輪次。

## 驗證

包生命週期測試固定 idle 等待、maintenance 所有權、後續輪次先於 dispatch 的順序、同步入隊失敗、與模型無關的 dispatch 和重新啟動重播。組裝後的 Web 場景為產生的 assistant 行生成快照，並斷言已持久化的 Schedule dispatch 沒有特殊 history view。原始碼與相依性審計會拒絕殘留的已移除呈現符號、事件、sidecar、slot、渲染器包與 overlay 設定項。

## 後果

- Schedule 的實作僅涉及其自身包、常規組合與目錄接線；工作階段、持久化、Host、用戶端執行時期和對話 UI 不攜帶 Schedule 專屬行為。
- 使用者只能透過對話中的普通模型回應看到提醒。失敗的模型輪次仍是失敗輪次，不會出現與之矛盾的成功回執。
- 需要外部交付或交付確認的消費端必須採用另一條產品邊界，並由其擁有自己的通知和確認語義。
