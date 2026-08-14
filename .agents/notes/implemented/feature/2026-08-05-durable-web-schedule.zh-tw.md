# Agent Note: 持久、僅限 Session 內的提醒

Status: implemented

[English](2026-08-05-durable-web-schedule.md) | [简体中文](2026-08-05-durable-web-schedule.zh.md) | 繁體中文

## 問題

在對話中建立的提醒必須始終歸屬於確切的那個 Session，並且跨行程重新啟動存活。行程本機 timer 或 inbox 項無法提供這種持久性，而全域性 scheduler 或私有資料庫又會引入第二套身份、持久化和生命週期系統。

繁忙的 Agent（代理）、長等待、牆鐘變化、cold Session、fork、持久化失敗、絕對日曆輸入和資源釋放，使簡單 timeout 無法滿足要求。設計必須區分持久記錄與可丟棄的 live wait，阻止 fork 繼承父 Session 的活動提醒，並避免把 Schedule 專屬的呈現或時區狀態擴散到無關元件。

## 決策

[`examples/web-schedule`](../../../../examples/web-schedule/README.md) overlay 顯式載入 `@deepseek-ai/dsh-time-context` 與 `@deepseek-ai/dsh-schedule`；默認 Web 設定樹保持不變。Schedule 只觀察外掛程式載入後發布的根 Agent，並在該 Agent scope 中安裝三個工具和一個可丟棄 owner。cold history 讀取、已發布的根、child Agent 與其他 host 都不會啟用它。

使用者可見邊界是 `session-local`：原 Session 只有在 live 時才會準時執行提醒，cold 期間不傳送任何外部通知；該 Session 再次 live 後才會處理 overdue 提醒。到期工作會等待 Agent 完全 idle，再透過 `followup()` 進入普通的下一輪佇列；它絕不會中途引導當前輪次，也沒有獨立 Web 回執（[對話式交付](../simplification/2026-08-09-conversational-schedule-delivery.md)）。

| 場景 | 持久事實 | live 行為 | 使用者可見結果 |
| --- | --- | --- | --- |
| 建立與管理 | 原 Session 中的 `schedule/change` create／delete | Agent-scoped 工具在學取前、變更後執行 checkpoint | 穩定 id、UTC 目標、狀態與 `session-local` 說明 |
| 到期時繁忙 | 活動 create 仍在 fold 中 | owner 等待 idle maintenance，排入一個 follow-up，再追加 dispatch | 後續一個普通對話輪次 |
| 多條 Every 記錄逾期 | 每條活動記錄都保留最早一個尚未接受且與錨點對齊的目標 | 一次決策選擇每條記錄的最新發生時點，並將其推進到當前時刻之後 | 一個普通 follow-up，其中每條記錄各有一個發生時點 |
| 行程停止或 Session cold | 活動 create 仍在 persistence 中 | 不存在 timer 或後臺掃描；resume 重建 owner | 未來目標繼續等待；overdue 目標會被嘗試 |
| fork | 父 event 留在繼承前綴 | child fold 從 `seedLength` 開始 | 父工作不會在 child 中變為活動狀態 |

### Session 日誌權威與工具

版本 1 `schedule/change` stream 是唯一持久的 Schedule 權威。create 記錄擁有一個 Session 內不複用的品牌 id、trim 後的提示詞、規則判別欄位和 UTC 目標。delete 與一次性 dispatch 是終結轉換。Every dispatch 會儲存 id 與決策時點，使 fold 將該記錄直接推進到錯過的發生時點之後。嚴格 decoder 與純 fold 會拒絕未知版本、額外欄位、重複使用的 id、形狀不匹配的 dispatch，以及針對非活動記錄的轉換。普通 Session 摺疊完整 stream；fork 只摺疊 `SessionHeader.seedLength` 位置及其後的 event。

當前規則 union 接受非空提示詞和恰好一個 selector。`after_seconds` 是正的安全整數 delay，其記錄為 `{ id, kind: 'after', prompt, afterSeconds, scheduledAt }`。`at` 可以是帶 `Z` 或數值偏移量且嚴格符合 RFC 3339 的值，也可以是帶顯式時區的結構化 `{ date, time, time_zone }`；其記錄為 `{ id, kind: 'at', prompt, scheduledAt }`。`every_seconds` 是不小於 300 的安全整數，其 `{ id, kind: 'every', prompt, everySeconds, scheduledAt }` 記錄始終與從建立時刻加一個間隔開始的序列對齊。一次性 dispatch 只儲存 id；Every dispatch 儲存 `id + acceptedAt`。工具值派生 `scheduled` 或 `overdue`，並包含 `deliveryMode: 'session-local'`。

一個 Agent-scoped FIFO 會將管理交易與 live owner 的到期交易從 preflight 到 post-append barrier 全程序列化。每項工具讀取都會先等待 `ctx.sessions.flush(session)`。create 會盡可能在進入 FIFO 前拒絕輸入形狀錯誤，隨後執行 preflight、分配 id、追加記錄並再次 checkpoint。delete 會在進入 FIFO 前驗證 id，在判斷其是否活動前執行 preflight，並且只在追加後再次 checkpoint。list 與 not-found delete 絕不會根據未經確認的 live 後綴作答。barrier 失敗會返回 `persistence_uncertain`，而不是猜測 eager write 是否已經提交。

每次成功的管理 preflight 也會要求 live owner 重新計算。因此，如果先前的 post-append 被拒絕，後續 list 可以確認保留的 create 並將其 arm，而無需私有的 persistence 重試 timer。

### 顯式絕對時間邊界

自然語言解釋與 Schedule 解析被有意分開（[時區簡化](../simplification/2026-08-09-explicit-schedule-time-zone.md)）。每條瀏覽器提示詞只在其對應的持久 user message 上攜帶由 Host 校驗過的 IANA 時區。Time-context 會告訴模型，把未明確限定時區的日期和時間解釋為該時區。Schedule 既不匯入該外掛程式，也不儲存 Session 時區：模型必須把其解釋結果轉換為帶偏移量的 RFC 3339 值，或帶顯式 `time_zone` 的本機對象。

Schedule 會校驗精確的日曆形狀、偏移量、時區名稱，以及一個嚴格位於未來、年份為四位數的時點。落在夏令時缺口內的本機時間會被拒絕；遇到重疊時會選擇第一次出現的較早時點。建立成功後只儲存規範化後的 UTC `scheduledAt`，不會儲存原始偏移量、本機欄位或時區。

### 有界固定速率語義

Every 是固定時長間隔，而不是日曆規則。第一個目標是建立時刻加上一個間隔。作出到期決策時，整數除法會選出不晚於所取樣牆鐘的最新序列點，以及其後的第一個序列點。選中的發生時點只呈現一次，記錄會直接推進到未來目標，因此 cold Session 絕不會積累重播任務，延遲執行的模型工作也絕不會使該序列漂移。

所有不同的逾期 Every 記錄都會參與同一個批次，每條記錄各自取供一個最新發生時點，並共享同一個 `acceptedAt`。系統不存在跨記錄的冷卻、門控、配額或保留的批次時間戳。至少 5 分鐘的限制約束了喚醒與模型請求頻率。如果下一個序列點會超出四位年份儲存範圍，dispatch 會終結該記錄。

日曆表達式與 Cron 表達式被有意排除（[有界週期性簡化](../simplification/2026-08-09-bounded-fixed-rate-schedule.md)）；支持這些表達式需要增加時區敏感的日曆語言、求值器相依性、校驗範圍和 tzdata 重播策略，而這些都與固定速率提醒無關。

### Live 交付生命週期

Agent-scoped owner 從持久 fold 派生最早目標。超長目標使用有界 timer 分段，每次 wake 都會重新讀取牆鐘，因此回撥不會提前觸發，前跳則會形成 overdue。已到期的一次性提醒優先，每次准入一條；否則，所有逾期 Every 記錄會按目標時間和建立順序進入同一個批次。如果 Agent 已被某個輪次或另一項 maintenance task 佔用，`runMaintenance()` 會拒絕此次認領；這些記錄保持活動，並由一次 `whenIdle()` wait 觸發另一次嘗試。被拒絕的 preflight 或被收容的 framing／入隊失敗同樣會使其保持活動，但不會啟動私有重試 timer。

獲得准入的路徑會刷新所有 pending persistence 並認領真正的 idle phase。它會重新摺疊確切的 Session 後綴、取樣 decision clock、用經過 JSON 轉義的值構造固定提醒 framing、同步排入一個 `followup()`，並在釋放 maintenance 前追加 dispatch。一次性提醒會追加只含 id 的終結 dispatch。固定速率批次會為每條參與記錄追加一個 `id + acceptedAt` 轉換。觸發喚醒的 input 會保持 parked，直到 maintenance 釋放，因此在 dispatch 進入日誌前，訊息不會被認領；隨後 owner 會為 dispatch 執行 checkpoint。

dispatch 記錄的是佇列准入，而不是模型完成或使用者收到提醒。framing 構造或同步入隊失敗不會追加 dispatch。append 失敗會使該 owner fault，因為訊息可能已經入隊。Agent 或外掛程式 dispose 會取消 timer、停止新工作、撤銷工具註冊，並等待進行中的工作，且不會刪除持久記錄。follow-up 獲得准入後、持久 dispatch 前發生崩潰，可能使提醒在復原後重複；本設計不作 exactly-once 承諾。

## 已考慮的替代方案

**使用 `ctx.jobs`。** Task 擁有行程本機工作、結果和通知，而不是 Session 日誌狀態和對話 follow-up。

**把提醒存入私有資料庫或全域性 scheduler。** 這樣可以執行 cold Session，卻需要第二套身份對映、啟動掃描、ownership lease、崩潰協議和通知策略。

**持久化 Session 時區並推斷本機 `at`。** 這會讓一個解釋預設值擴散到 Session core、Host create／fork、持久化格式、client 和不匹配復原中。請求本機的模型指導與顯式工具邊界消除了這種耦合。

**保留獨立的持久 Web 回執。** dispatch 是內部佇列事實，而不是使用者的提醒。渲染普通 assistant 回答既避免了第二種交付含義，也從 Host 與 client 層移除了 Schedule 程式碼。

**增加通用週期規則引擎。** 固定時長間隔只需要錨點運算。共享的週期抽象、全域性准入門控和日曆求值器會擴大重播與執行時期狀態，卻不能服務於保留的產品行為。

**在 `followup()` 前認領 dispatch，或增加 exactly-once fencing。** claim-first 會在入隊失敗時靜默丟失提醒。跨行程 exactly-once 需要 lease、outbox、acknowledgement 與下游冪等邊界，超出了此 Session-local 範圍。

**接管既有根或註冊全域性工具。** 晚接管會讓外掛程式載入順序啟用不可見的 timer，並把工具暴露到受支持的根組合之外。

## 驗證

包測試以逐文件 100% coverage 固定嚴格重播、一次性與 Every 狀態轉換、建立錨點運算、只追趕最新一次、多記錄批次處理、fork 後綴、id 複用、偏移量與本機日曆 profile、IANA 校驗、夏令時缺口與重疊、時間邊界、timer 分段、牆鐘變化、overdue 准入、固定 framing、入隊與 append 失敗、barrier 復原、註冊 rollback 和完全靜止的 dispose。屬性測試會在不同間隔與跳過跨度下比較 Every 計算與重播。production JSONL restart 測試證明一條 overdue 提醒會經過真實 Agent 生命週期 dispatch，並且再次 restart 後不會重複 dispatch。Host／client 測試固定瀏覽器時區取樣與綁定到提示詞的校驗。無金鑰組裝 Web 場景覆蓋瀏覽器本機 At，以及透過普通 assistant follow-up 交付的逾期雙記錄 Every 批次，兩者都沒有回執 UI。

## 後果

- 提醒狀態透過普通 Session persistence 跨重新啟動存活，無需新資料庫或公開 service。
- cold Session 不工作、不傳送外部通知；重新打開後可能交付 overdue 工作。
- 無需持久 Session 時區狀態或從 Schedule 到 time-context 的相依性，絕對時間輸入仍然具有確定性。
- 使用者看到普通對話輸出；dispatch 絕不會誇大模型成功或 acknowledgement。
- 每個 live 根只增加從 fold 派生的 timer、選填 idle wait 與一個 in-flight operation。
- 固定速率週期性受到至少 5 分鐘、只追趕最新一次，以及每條逾期記錄只在一個批次中貢獻一個發生時點的約束；日曆週期性仍在此產品邊界之外。
