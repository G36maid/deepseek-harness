# Agent Note: 設定面暴露什麼，以及誰有權覆蓋什麼

Status: implemented

[English](2026-07-30-config-plane-boundaries.md) | [简体中文](2026-07-30-config-plane-boundaries.zh.md) | 繁體中文

> 範圍：對 [Web 設定面](2026-07-30-web-config-plane.md)的邊界加固——哪些 namespace 能抵達協議、哪些呼叫方能抵達它們，以及一個只持有區域性且可能過時的檢視表的編輯器該如何寫入，纔不會毀掉它看不見的東西。

## 問題

這個面能用，但能觸達它的呼叫方、以及它們所擁有的權限，都比設計聲稱的更多。

`trustedHosts` 只攔住了寫入，因此一個已聲明的 LAN 用戶端可以呼叫 `settings.describe`——拿到每個已暴露 namespace 的設定——以及 `credentials.describe`，後者會報告任意一個環境變數名是否已設定、又從何處解析。那道 fence 是 DNS 重綁定防禦，它自己也是這麼寫的；把它當作讀取的授權邊界，是一次範疇錯誤。另一件事是：代理服務於每一個已註冊的 namespace。settings seam 是刻意做成通用的，因此第一個為自身設定呼叫 `settings.register()` 的外掛程式，就會悄無聲息地變成可遠端讀寫，而完全不必經過任何針對 Web 表層的評審。

編輯器比「可觸達」更糟——它是破壞性的。它讀到的是脫敏後的 descriptor，後者按構造省略了 `role('secret')` 欄位。清空其中一個欄位，會用這份脫敏副本重建整個使用者分節並行出 `settings.replace`，於是一個協議從未回傳過的已存字面 `apiKey` 被順帶刪除。這一點被直接復現：輸入 `{baseURL, reasoning}`，輸出時 `apiKey` 消失。刪除整行走的是同一條路徑。而且沒有任何東西攜帶版本，因此兩個分頁標籤編輯同一個 namespace 會靜默互相覆蓋；seam 的逐 namespace 寫佇列只排定寫入次序，分辨不出一個持有新鮮快照的寫方與一個重放過時快照的寫方。

另有三個較小的缺陷與之並列。`llm/adapters-updated` 的文件寫著觀察者失敗會被收容，卻只捕獲同步失敗，於是非同步 listener 的 rejection 作為 unhandled rejection 逃逸。llm-deepseek 更換重試策略時，先對其註冊執行 dispose（資源釋放）、再重新註冊，在兩者之間發布了一個空路由集——觀察者會看到該提供方消失又回來，儘管註釋宣稱不存在這樣的空窗。還有，頁面做憑據增強時的傳輸層 rejection 會逃出 `load()`，把頁面卡在 `loading` 且不顯示任何錯誤。

## 決策

**讀取設定與寫入設定同樣屬於特權操作。**`settings.describe` 與 `credentials.describe` 加入僅限回環的集合，因此在真正的認證層出現之前，整個設定面都保持同源。模型目錄（`llm.providers`、`llm.models`）刻意不在其中：它攜帶的是提供方 id、顯示名與模型清單——沒有端點、沒有金鑰狀態——而 LAN 用戶端的模型選擇器正需要它。這條邊界由一臺真實 HTTP 伺服器來斷言，而不是手工拼裝的請求，因為真正決定它的，是瀏覽器實際寄出的那個 `Host` 頭。

**這個面恰好服務於已註冊模型提供方所指向的那些 namespace。**`ctx.llm.listConfigurableProviders()` 就是允許清單，於是產品邊界是被執行的，而不是從今天的外掛程式集合裡推斷出來的；將來的 namespace 只有加入該目錄才會變得可在 Web 上設定。未註冊的 namespace 與未暴露的 namespace 得到完全相同的答覆（`settings-not-exposed`），因此探測無法枚舉登錄檔。

**持有區域性檢視表的呼叫方，點名它真正要改的欄位。**`SettingsProvider.mutate(ns, ops)` 會把 `set`/`unset` 路徑 op 施加在寫入排到隊首那一刻的分節上。用戶端透過對比自己打開時的快照與草稿來構造 op，因此它只提及自己看得見的欄位：兩側都沒有的機密不會產生任何 op，它的留存是構造使然，而非小心使然。`replace` 仍是那個刻意的整體重設。

**過時狀態會被偵測出來，而不是靠排序繞過去。**每個 namespace 都帶有一個針對其**原始**分節的單調 `revision`；寫入可攜帶 `expectedRevision`，不匹配即以 `SettingsConflictError` 拒絕——在協議上是 `settings-conflict`，並附上兩個 revision。編輯器記住自己打開時的 revision，衝突時請使用者重新打開，而不是把自己的快照重放上去。

**原始層擁有自己的事件。**`settings/updated` 仍以解析值為門檻——那纔是消費端所說的"變化"。`settings/document-updated (ns, revision)` 則在任何原始分節變化時觸發，因為設定介面必須知道某個欄位從繼承變成了覆蓋（解析值相同，含義不同），也必須知道自己持有的 revision 已經過期。該事件被原樣轉發，模型消費端同時訂閱它與 `llm/adapters-updated`，因為提供方設定持有不會由路由變化宣告的目錄資料。

## 曾考慮的替代方案

- **在代理設定上做部署聲明式的 namespace 白名單**——更通用，但它把產品邊界交給了寫 cordis.yml 的人，而空的預設值會讓已交付的頁面在每個部署顯式開啟之前直接失效。提供方目錄本就精確地說明瞭哪些 namespace 屬於模型設定。
- **在 `settings.register()` 處 opt-in metadata**——語義最正（由 namespace 的屬主自行聲明其暴露與否），改動也最大：seam 的公共介面、兩個 LLM（大型語言模型）外掛程式，以及它們的文件。記錄為：一旦某個非 LLM 的 namespace 確實需要這個面，就採用這個形狀。
- **區分「未註冊」與「已註冊但未暴露」**——診斷更好，同時也是一臺 namespace 枚舉預言機。統一答覆是刻意為之。
- **用 diff 而非 revision 來偵測衝突**——對整分節寫入而言，拿提交時的基線與儲存比對是可行的，但編輯器持有的是**脫敏後**的分節：它給不出可比對的基線，這與它不能安全地 `replace` 是同一個原因。計數器兩者都不需要。
- **在這裡就修掉脫敏的缺口**——`redactSecrets` 只遍歷 `object`/`dict`/`array`，因此藏在 union、intersection 或 transform 之後的機密會被原樣返回，且 `secrets` 清單為空；`schema.toJSON()` 會帶上 secret 欄位的 `.default(...)`；寫入拒絕的訊息返回的是可能引用了輸入的 schema 文字；用戶端透過 schemastery 的 `new Function` 重建信封；而 pi-ai 那個純字串的 `headers` 字典完全可以合法地放下 `Authorization`。全部真實存在，也全部刻意留給一個 fail-closed 的 `describeForWire()`——它會拒絕自己無法證明安全的 schema。它們被記錄為 `TODO(settings-wire-redaction)` 以及各屬主 README 的 Known Limitations，而不是在這裡做一半。

## 影響

`trustedHosts` 部署下的 LAN 用戶端已經完全無法渲染設定頁；設定表層就是回環。註冊了 settings namespace 的外掛程式，在它同時註冊可設定提供方之前不會變得可在 Web 上設定——這是刻意的，也正是 `settings-not-exposed` 要在訊息裡點明這條邊界的原因。`SettingsDescriptor` 新增了必填的 `revision`，因此以程式設計方式構造 descriptor 形狀值的地方都必須提供它；`settings/document-updated` 是一個新事件，提供方側的任何 listener 現在都可以觀察它。忽略 `expectedRevision` 的用戶端，其後寫勝出的語義完全不變。延後事項：fail-closed 的協議 describe（連同它所承載的 `headers` 與信封淨化工作），以及一套不含可執行程式碼的瀏覽器 schema 協議。
