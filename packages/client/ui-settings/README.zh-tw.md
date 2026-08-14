# @deepseek-ai/dsh-client-ui-settings

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

設定領域的底座，承擔兩項職責，本身不含任何呈現內容。它提供 `ctx.settingsScope`——每個偏好設定行綁定自己那份持久化命名空間分區所用的宿主傳輸層；並聲明由註冊方填充的設定 slot 類型：`settings.trigger`／`settings.header`／`settings.close`（介面框架內容）、`settings.action`（內容標題欄中的有序操作）、`settings.section`（每項功能一頁）、`settings.plugins.tab`（“外掛程式”分區內由各功能持有的頁面）和 `settings.onboarding`（由各功能持有的有序頁面）。它不相依性任何 `ui-*` 呈現包，因此任何持有偏好設定的功能都能夠到它；設定**外殼**——`sidebar.settings` 佔位方、它的導覽與介面框架——位於 ui-settings-general，因為外殼一旦相依性 ui-sidebar，就會經 ui-layout 與 ui-theme 閉合出一條引用圖環路。外殼自身的契約類型出於同一原因與外殼放在一起。

該外掛程式不注入任何服務、也不等待任何服務：`ctx.settingsScope.bind(spec)` 在呼叫時經**呼叫方**的 context 解析線路面，因此綁定所得 scope 的 disposer 歸呼叫方 fiber 所有，而由呼叫方注入 `connection` 取得傳輸層、注入 `remote` 取得失效通知。監聽器在首次後臺讀取啟動之前就已存在，因此某一行的啟用絕不會阻塞在設定傳輸層上。已綁定的 scope 會在收到屬於自己命名空間的轉發 `settings/document-updated` 事件時、以及在 `connection/reset` 時重新讀取。寫入攜帶單一欄位路徑以及最近已知的命名空間 revision 作為 `expectedRevision`；被拒絕或失敗的寫入會重新讀取，除非已有更新的寫入取代了它，而過期的讀取絕不會覆蓋發布更新的結果。若 spec 未提供 `decode`，則分區不是普通對象、未透過其重建後的 schema 校驗、或攜帶本用戶端無法重建的 schema 信封時，一律不發布任何值，於是行渲染自己的缺失狀態，而不是一份半解碼的值。

## 模型體驗

無。設定領域底座為瀏覽器提供偏好設定儲存與 slot 聲明；這裡沒有任何內容進入模型請求。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **遠端瀏覽器沒有持久化設定**：設定 RPC 僅限 loopback，因此在非 loopback 瀏覽器中綁定的 scope 以 `unavailable` 起步且從不跨線路，它支撐的每一行在那裡都是無效的。
- **每次寫入僅一個欄位**：`set` 只發送單個 `set` op，因此需要同時改動兩個欄位的行沒有交易可用，會發布兩個 revision。
