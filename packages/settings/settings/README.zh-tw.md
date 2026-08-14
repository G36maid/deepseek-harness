# @deepseek-ai/dsh-settings

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

使用者設定 Service Definition（`ctx.settings`）。一個提供方持有按 namespace 分節的原始文件；外掛程式註冊 namespace schema 並讀取分層解析值：schema 預設值，然後註冊方的組合 `base`（其 cordis.yml entry 設定子集），最後使用者文件分節。不掛載提供方時消費端行為不變：仍只按 entry 設定解析，因此任何組合有無 settings 都能工作。

## 服務 API

- `documentPath` — 提供方擁有使用者可編輯文件時，該欄位是文件的絕對路徑；非文件提供方保留 `undefined`。Host 設定配接器據此派生可用性，而瀏覽器協定只暴露一個布林能力，絕不暴露檔案系統目標。
- `prepareDocument()` — 讓文件做好供原生編輯器打開的準備後返回該路徑。基類實作返回 `documentPath`；文件提供方可先建立缺失的文件。
- `register(ns, schema, { base?, applies? })` — 返回 owner 的 `SettingsScope`（`get`/`watch`/`update`）。註冊是呼叫方外掛程式 fiber 上的 effect：dispose（資源釋放）該 fiber 即移除 namespace 及其觀察者。schema 拒絕的存量分節會使註冊本身失敗；重複 namespace 立即報錯。
- `describe(options?)` — 每個 namespace 一條描述（`schema.toJSON()` 封裝、解析值、分離出的 `base`/`user` 層、`applies`），供設定介面使用；欄位出現在 `user` 中即標記其被使用者覆蓋。`describe({ redactSecrets: true })` 從每一層剝離 `role('secret')` 欄位，並附加 `secrets` slot 清單（`{ path, set }`）；每個協定介面都必須傳入它，純遍歷器 `redactSecrets(schema, value)` 已匯出，供其他 wire 使用。
- `get(ns)` — 解析值；未註冊時為 `undefined`。
- `update(ns, patch)` — 把普通對象 patch 深合併進使用者分節（絕不合併進 `base`），校驗解析候選值，經提供方持久化後提交。patch 只能包含與 JSON 相容的資料：Date、Map、BigInt、非有限數或迴圈引用會在任何內容持久化前被拒絕，並給出以 `$` 為根的路徑（YAML/JSON 儲存在重載時會靜默改變這類值）。校驗失敗在持久化前拒絕；只讀提供方（`writable: false`）拒絕一切寫入。同一 namespace 的寫入按呼叫順序序列。
- `replace(ns, section)` — 整體替換使用者分節：這是刻意的重設（`replace({})` 重新繼承 `base` 與 schema 預設值）。
- `mutate(ns, ops)` — 在寫入排到隊首那一刻的分節上，按序施加 `{ op: 'set' | 'unset', path }` 編輯。這是任何持有**不完整**檢視表的呼叫方的刪除路徑：設定 UI 讀到的是脫敏後的 descriptor，據此重建分節再整體替換，會把 wire 從未回傳的每個機密都刪掉，而一條 op 只點名它真正要改的那個欄位。
- 每次寫入都可攜帶選填的 `expectedRevision`。每個 descriptor 都帶有該 namespace 的 `revision`——一個針對其**原始**分節的單調計數器；期望值不再匹配的寫入會以 `SettingsConflictError`（`code: 'SETTINGS_CONFLICT'`，並附上兩個 revision）被拒絕，而不是覆蓋先完成寫入的寫入方。寫佇列只保證寫入的先後次序，它本身分辨不出持有新鮮快照的寫入方與持有過時快照的寫入方。
- 解析值是深凍結快照。每次提交後觀察者收到 `(next, prev)`：同一回呼的呼叫非同步、逐次、按提交順序執行（慢的舊呼叫絕不會晚於較新的呼叫生效），例外——同步拋出與非同步拒絕——均被隔離。watch 的 disposer 返回後不再啟動新的呼叫（已排隊的那一次會被跳過）；已啟動的呼叫仍會結帳。`settings/updated` 事件逐監聽器扇出，一個拋錯的 listener 不會餓死其餘 listener；非同步 listener 的拒絕會被隔離並記入日誌，這正是 `INVARIANT` 編碼的失敗只從同步 listener 重新拋出的原因。
- 服務解除安裝先拒絕新寫入與觀察者呼叫的啟動，再排幹全部排隊寫入與已啟動的觀察者呼叫後才完成；registrant fiber 在寫入途中被 dispose 時，該寫入仍到達儲存，但不會提交，也不會通知任何人。

## 提供方約定

子類實作 `writable`、`load()`、`persist(ns, section)`，選填擇為一個本機使用者可編輯文件重寫 `documentPath` 與 `prepareDocument()`，並透過受保護的 `publish(doc)` 推入外部觀察到的文件。基類服務 init 在服務可注入前載入並行布一次文件；擁有自有 init（watcher、連線）的提供方會先透過 `yield* super[Service.init]()` 委託給基類。publish 時每個已註冊 namespace 獨立重解析：非法分節保留該 namespace 的最後可用值並告警——熱重新載入絕不拖垮行程；啟動期與註冊期校驗則立即報錯。

## 事件

`settings/updated (ns, next, prev, source)` 在每次提交後觸發；`source` 為 `update`（行程內寫入）或 `provider`（外部變更）。解析值深相等時絕不觸發——它面向消費端，而消費端只關心自己的值有沒有變。

`settings/document-updated (ns, revision)` 在**原始**使用者分節發生變化時觸發，無論解析值是否隨之改變。設定介面需要的是這一個：存入一個與組合 `base` 相同的覆蓋值不會改變解析值，卻改變了文件的說法（該欄位從繼承變成了覆蓋），也推進了每個已打開編輯器所持有的 revision。監聽器的例外隔離方式與 `settings/updated` 相同。

兩條聲明都住在 client-safe 的 `./types` 子路徑出口，與其簽名點名的 `SettingsNamespace`、`SettingsUpdateSource` 類型同處一處；包根繼續 re-export 這些類型。於是 Host 編譯面之外的消費端讀到的正是 Host 發射的那一份簽名，而不必再寫一遍。

## 模型體驗

間接生效：消費端外掛程式從各自 namespace 解析影響模型的值（例如預設模型路由）；效果由各消費端自己的介面文件說明。

#### KV Cache 影響

無直接失效；把設定值納入請求前綴的消費端負責該變更。

## 已知限制與暫緩事項

- **單一使用者層** — 解析只認識 schema 預設值、一個組合 `base` 與一個使用者文件；它尚未記錄每個解析值由哪一層提供。
- **`redactSecrets` 並非一條可被證明的協定邊界**：walker 只跟隨 `object`/`dict`/`array`，因此只能經由 union、intersection 或 transform 抵達的 `role('secret')` 會被**原樣**返回，且 `secrets` 清單為空；而 `schema.toJSON()` 會把 secret 欄位的 `.default(...)` 一並帶給每個用戶端。這兩種情況都不會被拒絕；機密無法經由被遍歷的容器抵達的 schema，絕不可註冊到暴露於協定的 namespace 上。真正的答案是一個 fail-closed 的 `describeForWire()`——它拒絕自己無法證明安全的 schema，並對序列化封裝與錯誤文字做淨化——此項暫緩。
- **跨行程並行由提供方定義** — seam 僅在行程內按 namespace 序列化寫入；跨行程並行按提供方行為收斂（本機文件提供方在寫鎖下讀-改-寫，因此 namespace 在並行寫入者下不會丟失，同 namespace 衝突按後寫勝出解決）。
