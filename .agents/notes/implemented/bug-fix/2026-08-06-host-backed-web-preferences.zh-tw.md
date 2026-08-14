# Agent Note: 透過 Host settings 持久化 Web 使用者偏好

Status: implemented

[English](2026-08-06-host-backed-web-preferences.md) | [简体中文](2026-08-06-host-backed-web-preferences.zh.md) | 繁體中文

## 問題

Web 的 Appearance、Language 和繁忙態 Enter 偏好原本存在瀏覽器 `localStorage` 中。瀏覽器儲存以 origin 為作用域，因此換一個埠重新打開 `dsh web` 會選中另一個儲存分區並丟失選擇，即使兩個行程使用同一個 DSH home。這些是使用者級產品偏好；工作階段選擇、草稿、摺疊展開狀態和其他瞬態瀏覽器狀態仍保留在頁面內。

第一版主題實作只把 Appearance 移入 Host settings，但會在提供 `ThemeRuntime` 之前等待初始 RPC。緩慢或不可用的 settings 請求因而會掛起組裝後的頁面。該實作還在學取後才建立訂閱，可能錯過此視窗內的失效通知；它寫入時不攜帶 namespace revision，並且允許已釋放外掛程式所排隊的寫入到達 Host。

## 決策

各領域所屬的 Host half 註冊三份 schema：選填的 `locale.preference`（`zh` 或 `en`，缺失時交由瀏覽器決定）、`ui-theme.preference`（`light`、`dark` 或 `system`，預設為 `system`），以及 `ui-conversation.busyEnter`（`queue` 或 `steer`，預設為 `queue`）。本機 settings 提供方將顯式選擇存入 `$DSH_HOME/settings.yaml`，在使用默認 home 時，該路徑解析為 `~/.dsh/settings.yaml`。API 代理會顯式暴露這三個 namespace，與其他 Web settings 並列；僅註冊它們，絕不會跨越該設定邊界。

用戶端執行時期為每個 namespace 提供一份 `bindSettingsScope` 生命週期——即 Host 側 settings owner seam 的瀏覽器映像檔。它在開始後臺初始讀取之前安裝 `settings/changed` 和 `connection/reset` 監聽器，因此任何 settings 傳輸都不會阻塞外掛程式啟用，失效通知也不會掉入先讀取、後訂閱的空檔；它還會發布一個供領域服務訂閱的快照 store（狀態、分節值、revision、可寫性、host／記憶體模式）。默認解碼器會對照該 namespace 自身的序列化 wire schema（經 dsh-client-schema-form 還原）校驗每個傳入分節，因此各領域無需攜帶手寫的 wire 校驗器。領域服務把 scope 當作普通的構造函式協作者接收，立即發布各自的暫定預設值：由瀏覽器派生的 locale、系統主題和 Queue；隨後採納已獲接受的 Host 分節，但不將其寫回；不帶 scope 構造的服務——獨立詞典或政策 fixture（測試前置資料）——則僅停留在行程本機。

使用者變更會同步更新即時服務，並經 `scope.set` 將一項 `settings.mutate` 路徑操作排入佇列。scope 會序列處理手勢，以最新已知 namespace revision 作為 `expectedRevision` 傳送，記錄每次成功寫入的 revision，並且只允許最新寫入的結帳結果重新發布即時狀態。最新寫入被拒或失敗時，scope 會重新載入 Host 狀態。外掛程式釋放會拒絕新工作、跳過已排隊操作、抑制執行中操作發布狀態，並等待該操作結帳後才讓外掛程式達到完全靜止。

遠端瀏覽器無法呼叫僅限回環請求的設定 API，因此其偏好僅保留在行程內。動態第三方主題 id 仍是內建 Host schema 之外的行程內擴充；移除其中一個會重設即時登錄檔，但不會替換上一個持久化的內建偏好。

## 曾考慮的替代方案

**保留 `localStorage`，並在不同埠間複製值。** 一個 origin 無法枚舉另一個 origin 的儲存，而 Host 中繼會圍繞瀏覽器特有格式重新實作一套 settings 服務。

**將 Host settings 映像檔到 `localStorage`。** 第二個權威來源會要求另外定義啟動與失效時的衝突規則，同時依然保留造成該缺陷的分區。Host settings 文件是唯一的持久化真源。

**等待初始讀取，以避免暫定渲染。** 繪製頁面不以設定可用為前置條件。後臺讀取可能引發一次即時收斂，但它會隔離失敗，並保留既有的瀏覽器／系統／默認回落路徑。

**讓每個領域擁有自己的 settings 控制器。** 並行、revision、失敗、失效與釋放規則完全一致；此前的主題實作已因複製這些規則產生生命週期漂移。由領域持有 schema，可以避免把產品政策放入共享執行時期。

**帶成對 sync/persist 回呼的逐欄位偏好控制器。** 第一版共享生命週期經領域提供的 `sync` 回呼同步單個標量欄位，服務則經注入的 `persist` 回呼寫回。這對相互相依性的回呼迫使構造分兩階段完成——寫入器先預設為無操作，稍後經 `bindPersistence` 替換——namespace 每新增一個欄位，本都得再攜帶一個自己的控制器和一次全文件讀取，且每個領域都重新聲明瞭一個已註冊 wire schema 本已表達的手寫校驗器。namespace scope 發布一份供服務訂閱的快照並直接接受寫入，因此這對回呼與第二個構造階段都不存在。

**把每個 `localStorage` 條目都移入 settings。** 當前工作階段、草稿、面板展開狀態、trajectory 顯示狀態和類似條目屬於瀏覽器實例狀態，而非使用者設定。將它們提升為設定，會在沒有產品契約的情況下，跨分頁標籤和埠同步短暫導覽狀態。

## 後果

Appearance、Language 和繁忙態 Enter 選擇會跟隨 DSH 使用者 home，跨越重新載入、埠與回環 origin。直接編輯 `settings.yaml` 所產生的變更會透過現有失效流收斂，而舊的 `dsh.theme`、`dsh.locale` 和 `dsh.conversation.busyEnter` 條目既不會被讀取，也不會被寫入。

啟動時可能會在後臺讀取結帳前短暫顯示領域預設值。短暫的讀取失敗會保留該預設值或上一個正確的行程內值；重連時會重試。寫入被拒時，介面可能會在本機值立即變化後明顯復原為持久化偏好。

聚焦的單元測試覆蓋 schema 註冊、先監聽後讀取的順序、非阻塞啟用、經 schema 校驗的分節接受、攜帶 revision 的有序寫入、過時回應隔離、故障復原、釋放時完全靜止，以及遠端端僅記憶體模式。以 namespace 為粒度的 scope 也承載多欄位分節，因此後續的設定表面可以沿用同一份生命週期，而不必手搭 describe/mutate 同步。無金鑰 Web settings 場景透過 UI 寫入全部三項偏好，校驗 YAML 文件並確認舊 `localStorage` 為空，重新載入，再使用同一個 DSH home 在不同埠上啟動另一個 Host。
