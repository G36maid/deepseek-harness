# Agent Note: 儲存根目錄落點與派生介質復原

Status: proposed

[English](2026-07-28-storage-root-and-derived-medium-recovery.md) | [简体中文](2026-07-28-storage-root-and-derived-medium-recovery.zh.md) | 繁體中文

## 問題

持久投影快取（[決策記錄](2026-07-27-session-projection-and-command-log.md)，已作為 `dsh-session-projection-cache` 落地）暴露了它所依託的儲存基座的兩個缺口。二者都是 domain-KV 棧（[設計](2026-07-24-domain-kv-storage-and-workspace.md)）的屬性而非快取自身的問題，且都首先咬到快取——因為它是這條棧上第一個*派生*介質。

**文件到底存在哪（根錯位已收口，resolve-once 殘餘仍開放）。** 共享 base 將工作階段儲存預設為全域性 harness home（`$DSH_HOME/sessions`，默認 `~/.dsh/sessions`），而出廠 Web overlay 曾給 json 後端相對根 `./.storages`：`workspace.json` 和 `session_projcache.json` 落在 `<启动目录>/.storages/` 下——從兩個不同目錄啟動，工作階段相同，工作區登錄檔和投影快取卻各是一份，而快取存在的意義恰恰是跨工作階段冷清單，凡上次在別的啟動目錄下快取過的工作階段全部 miss。這一錯位已消除：overlay 現以與工作階段根同一段 `!!js` 表達式把 `storage-json.root` 錨定到 `$DSH_HOME/storages`（`apps/cli/config/web.cordis.yml`）。殘餘隱患：`JsonStorageBackend` 仍從不 resolve 根——每次打開 unit 都把路徑 join 到當時的 `process.cwd()` 上（packages/storage/storage-json/src/index.ts）；出廠 overlay 的根已是絕對路徑不受影響，但任何相對根（裸 Loader 啟動、測試）仍會被後續 cwd 變化劈開，JSONL 工作階段後端用「構造時 resolve 一次」防住的正是它（"later process.cwd() changes cannot split one backend across roots"，packages/session/session-persistence-jsonl/src/index.ts）。

**現在是怎麼復原的。** 在健康介質內部，快取按設計完全自愈：`stateVersion` 不匹配的行被丟棄重摺，日誌縮短到行水位以下由帶錨的 restore floor 檢出並以一次全量重讀回答，每次後臺寫都是 fail-soft。但在*介質*層面完全沒有復原：被截斷、被手改或版本被 bump 的 `session_projcache.json` 會讓 `openJsonUnit` 以 `malformed-medium`/`version-mismatch` 失敗（packages/storage/storage-json/src/format.ts），schema 漂移的記錄讓域 open 以 `invalid-record` 失敗（packages/storage/storage-domain/src/index.ts），拒絕一路穿過 `SessionProjectionCache[Service.init]`，在 CLI 的 fail-loud 啟動下整個組裝拒絕啟動。一個內容完全可從工作階段日誌重建的文件能把啟動搞死。這與快取包自己聲明的立場（"a stale or unreadable cache costs a longer tail replay, never a wrong value"）和快取域 spec 的 JSDoc（"version bumps discard the whole medium"）相矛盾——後者今天描述的是願望而非實作。同一條 fail-loud 路徑對 `workspace.json` 卻是*正確*的——工作區記錄是權威資料，不可派生——所以缺的概念是按域聲明權威性，而不是全域性改行為。

## 提案

兩個獨立改動，一個缺口一個。

### 全域性唯一儲存根（已落地，形態修正）；構造時 resolve 一次（仍開放）

- **已落地**：出廠 Web overlay 透過 app-boot 提供的 `dshHomePath('storages')`，直接在 `storage-json` 行內把 `root` 錨定到 `$DSH_HOME/storages`（默認 `~/.dsh/storages`，與 `~/.dsh/sessions` 並肩；目錄名不帶點——home 本身已是隱藏樹）。該輔助函式委託給規範的 `dsh-home-paths` 解析器，工作階段根也使用同一個函式，無需重複其回退和波浪號規則。最終選用按行形態（使用者決定）而非「launcher patch + `storageRoot` profile 鍵」（見 Alternatives）；按行覆蓋仍走個人 `~/.dsh/config.yaml` patch 層。web e2e scaffold 本就把該行 patch 到臨時絕對根，測試不觸使用者 home。
- **仍開放**：`JsonStorageBackend` 在構造時對設定根 `resolve` 一次，原樣採納 JSONL 後端已記錄的理由：後續 `process.cwd()` 變化不得把一個後端劈到多個根下。SQLite 儲存後端已經 resolve 其路徑。
- 適用 pre-release 立場（已按此執行）：不做遷移墊片。曾在 `<cwd>/.storages` 下快取過的部署要麼全部重新派生（工作區從 header 索引重新 bootstrap；投影快取惰性重摺），要麼手動把兩個 json 文件挪一次。

### 聲明派生介質：損壞時重設而非拒絕

- `DomainSpec` 增加 `recovery?: 'reject' | 'reset'`（默認 `'reject'`）。spec 對象已經是一個域的身份與版面配置的真源；其介質是權威還是派生屬於同類事實，落在同一處。`session_projcache` 聲明 `'reset'`；`workspace` 保持默認。
- `KvFacet` 增加一個原語：`destroy(descriptor): Promise<void>`——整體移除該 unit 的介質（json：刪文件；sqlite：drop 該 unit 的表）。與 `open` 一樣，它是後端儲存原語，不是策略。
- `DomainFacility.open` 在 spec 聲明 `'reset'` 且 open 恰以損壞類錯誤失敗時——`StorageError('version-mismatch' | 'malformed-medium')` 或 `DomainError('invalid-record')`——記一條命名該域和被丟棄介質的警告，呼叫 `destroy`，再空開一次。其餘一切失敗（`backend-not-found`、`facet-unsupported`、`already-open`、I/O 錯誤）無論聲明與否都保持大聲：設定錯誤和環境故障不是介質損壞。重試單發——第二次失敗原樣傳播，持續失敗的介質不會成環。
- 有了這個，快取域 spec 的 version 欄位才獲得其本意：bump `version`（或讓 zod 拒絕漂移行）真正丟棄整個介質，快取經正常寫點和冷讀重建——復原階梯的最外一檔，與已落地的行級各檔對齊。

## 備選方案

**保持按啟動目錄的 `.storages`（改動前現狀）**——拒絕：工作階段是全域性的，所以每個從工作階段派生的介質都與自己的真源劈叉；快取的動機場景（一次列出全部工作階段）結構性丟行，工作區登錄檔索引著從另一個啟動目錄看不見的工作階段。

**launcher patch + `storageRoot` profile 鍵**——未採：一行 yml `!!js` 表達式即達全域性根，與工作階段根的既有分層完全一致；launcher patch 多引入一個改寫點，profile 鍵在有真實消費端前是空席（按行覆蓋已有個人 config.yaml patch 層可用）。

**只把投影快取的 route 指到全域性根，`workspace.json` 留在 per-cwd**——拒絕：工作區登錄檔有一模一樣的全域性 vs per-cwd 錯位，而且使用者選擇把快取放在 `workspace.json` 旁邊——一個 hub 根讓介質同址、心智模型單一。

**快取外掛程式本機復原（在 `SessionProjectionCache[Service.init]` 捕獲損壞錯誤、刪文件、重開）**——拒絕：外掛程式不越過後端抽象就叫不出介質路徑，且未來每個派生域都要重抄同一段 catch；facility 是唯一已經在分類 open 失敗的地方。

**損壞時退到記憶體態臨時域**——拒絕：行程餘生靜默降級為僅記憶體，損壞文件永不自愈；下次啟動照樣失敗。

**把損壞介質改名旁置（`<unit>.json.corrupt-<ts>`）而非刪除**——未選：派生介質的損壞位元組沒有復原價值（日誌纔是真源），殘骸無界累積；刪除纔是誠實的操作。若未來某個*權威*域想要重設語義，旁置改名纔是對的——這正是 `recovery` 按 spec 聲明的理由。

**所有域一律自動重設（不加 spec 欄位）**——斷然拒絕：`workspace.json` 是權威使用者資料；版本 bump 時靜默重設會毀掉工作區。權威性是域的屬性，必須由其所有者聲明。

## 驗收標準

- 從任意目錄啟動 `dsh` 都讀寫同一份 `$DSH_HOME/storages/*.json`（默認 `~/.dsh/storages`）——已由 overlay 表達式滿足，按行覆蓋走個人 config.yaml patch 層；後端對相對根在構造時 resolve 一次（待做）。
- `session_projcache.json` 被截斷、版本 bump 或 schema 漂移時，組裝乾淨啟動：一條警告命名被丟棄的介質，文件消失，快取經正常運轉重建，冷清單列隨工作階段重新 checkpoint 逐步回歸。
- 同樣的損壞發生在 `workspace.json` 上仍大聲拒絕啟動。
- facility 測試覆蓋：每個損壞類恰好重設一次 `'reset'` 域；非損壞失敗在 `'reset'` 域上保持大聲；`'reject'` 域傳播一切失敗；`destroy` 在兩個出廠後端上都移除介質。

## 風險

- **錯誤分類失誤導致自動刪除健康文件。** 由封閉的損壞類清單緩解：重設只在三個確定性解析期程式碼上觸發；ENOENT 本來就是「空 unit」，一切 I/O 錯誤（EACCES、EIO）大聲傳播。單發重試把爆炸半徑限定為每次 open 至多一刪。
- **根遷移改變既有 checkout 的尋找位置。** 在 pre-release 立場下接受（後端拒絕舊格式、無外部消費端）；上文為在乎 per-cwd `workspace.json` 內容的人記錄了一次性手動搬移。
- **`destroy` 是儲存 seam 上新增的破壞性原語。** 唯一呼叫方是 facility 的聲明重設路徑；後端約定將其記檔為 facility 專屬，任何面向模型或面向使用者的路徑都觸不到它。
