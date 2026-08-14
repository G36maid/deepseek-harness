# Agent Note: settings 寫路徑完整性與觀察者生命週期

Status: implemented

[English](2026-07-30-settings-write-path-integrity.md) | [简体中文](2026-07-30-settings-write-path-integrity.zh.md) | 繁體中文

> 範圍：`dsh-settings-file` 的寫路徑資料完整性（操作鏈、讀-改-寫、跨行程寫鎖、diff 形態的 YAML 編輯）與 `dsh-settings` 的觀察者生命週期（watch 的 dispose（資源釋放）、非同步監聽器收容、JSON 形態寫入邊界）。本 note 推翻了[使用者設定 seam note](2026-07-28-user-settings-seam.md)所記錄的一項延後決定：跨行程鎖定檔現已交付。

## 問題

提供方的寫路徑可能銷毀它從未觀察到的狀態，而 Service Definition 的觀察者生命週期會洩漏到 dispose 之後。具體而言：watcher 重載與文件寫入跑在兩條相互獨立的 promise 鏈上，而每次寫入都從快取文字渲染出完整的下一份文件，於是仍處於防抖視窗內的外部編輯會被覆蓋——隨後的重載又因 rename 後的內容與快取一致而成為空操作，這次編輯就被無痕抹去。初始 `load()` 與 watcher 自身的建立過程存在競態，留下一個啟動視窗：落在這個視窗內的變更永遠不會觸發事件。共享同一 harness home 的兩個行程各自從獨立的快取渲染，後寫者以整個 namespace 為單位勝出。

在 Service Definition 一側，`watch()` 的釋放器只把觀察者從集合中移除——已經接到 watcher 鏈尾的呼叫在 dispose 之後照常執行，服務 dispose 時也沒有任何環節排空已啟動的呼叫；`settings/updated` 的手動扇出只捕獲同步拋錯，非同步監聽器的 rejection 會以 unhandled rejection 的形式逃逸；`structuredClone` 則放行 Date、Map、BigInt 與迴圈引用，而 YAML/JSON 儲存會在重載往返中悄悄扭曲這些值（Date 會變成時間戳字串，BigInt 會變成普通數字）。

YAML 寫入則整體替換 namespace 節點，把分節內的每條註釋都刪掉——而這個保註釋的提供方承諾過要保住它們。

## 決策

**單一操作鏈，且每次寫入都是讀-改-寫。**watcher 的刷新與來自各 namespace 佇列的持久化共享同一條結帳鏈；`persistSection` 會先把磁碟上的文字對帳進 seam——任何未被觀察到的差異都先發布出去——然後才對照這份新鮮文字渲染。寫入不再可能復活一份過時文件；磁碟上已變非法的文件會讓寫入響亮失敗，而不是被覆蓋（重載路徑保持其「告警並保留最後可用值」策略；共享的 `reconcileFromDisk` 拋錯，各呼叫方自選策略）。watcher 的 `ready` 訊號會額外排入一次對帳，彌合初始載入與 watcher 生效之間的啟動缺口。

**寫入持有以 `wx` 建立的同目錄 `<file>.lock`。**讀-渲染-rename 迴圈在一把跨行程寫鎖下執行，採用指數退避與 2 s 取得期限。競爭者會逾時，但不會移除現有鎖，因為鎖齡無法區分已經崩潰的所有者與被暫停但仍存活的寫入方；殘留鎖復原須由操作者執行。讀方從不加鎖——rename 提交是原子的——因此競爭只發生在寫方之間。重試與期限常數是協議不變式，而非部署設定。

**觀察者 dispose 達到完全靜止。**watcher 攜帶一個 `active` 標志，排隊的呼叫即將啟動時先檢查它，因此在呼叫等待期間已經執行過的釋放器能讓這次啟動徹底不發生；已啟動的呼叫會登記進服務級的 `pendingTails` 集合，dispose 排空除了等待各寫佇列，還會等待該集合。`settings/updated` 扇出會把監聽器返回的 thenable 的 rejection 收容進與同步拋錯相同的監聽器診斷；事件約定現已寫明 `INVARIANT` 重拋只服務同步監聽器——不變式配套外掛程式必須保持同步，而已交付的那個配套外掛程式本就是同步的。

**寫入邊界只放行 JSON 資料。**呼叫時刻的快照就是一次 `cloneJsonShaped` 遍歷：它把 patch 從呼叫方分離出來，並在任何內容持久化之前拒絕一切非 JSON 值——Date、Map、BigInt、非有限數值、函式、symbol、類實例、值為 `undefined` 的陣列元素、迴圈引用——拒絕時附帶該值以 `$` 為根的路徑。顯式為 `undefined` 的對象條目仍會跳過（稀疏 patch 約定），這一約定如今在邊界處強制執行，而不再放在 `mergeLayers` 內部。

**YAML 編輯是葉子級 diff。**`renderYaml` 對比已儲存分節與下一份分節，只對變化的值應用 `setIn`、對移除的鍵應用 `deleteIn`，並沿 map 遞迴。註釋、錨點與格式在每個未觸碰節點上以及每個被改鍵值對的鍵節點上全部保留；陣列等非 map 值在不相等時整體替換（`deepEqualJson` 是共享的判定謂詞），其內部註釋隨之一並被帶走。

## 曾考慮的替代方案

- **用 `proper-lockfile` 取代手寫鎖**——按「相依性優先於手寫」政策做過權衡：該庫幾乎無人維護，其所有權與重試策略比這個單文件協議所需的更寬泛，而已交付的鎖只是一個小型獨佔建立迴圈，帶確定性的競爭測試。該政策偏向能刪除自有程式碼的相依性；這個相依性只會把一個窄協議換成不透明的等價物。
- **用修訂號/CAS 取代鎖**——rename 表達不了 compare-and-swap，因此 CAS 需要一個版本伴隨檔案或內容重雜湊，外加每個寫方裡的一個重試迴圈；鎖用一個原語實作同樣的序列化，還讓讀方完全免鎖。
- **把外部編輯合併進正在進行的寫入自身的分節**——seam 是在呼叫時刻可見的狀態之上合併 patch 的，因此與寫入競態的同 namespace 外部編輯仍按後寫勝出解決；要把外部編輯並進來，需要三方合併語義，而沒有任何消費端提出過這種需求。寫入會先發布外部狀態，落敗一方至少在被取代之前被觀察到。
- **宣佈不支持非同步 `settings/updated` 監聽器**——類型簽名是 `void`，lint 也會標記誤用的 promise，但未經 lint 的 JS 外掛程式仍能註冊非同步監聽器；約定裡的一句說明無法收回已經拋出的 unhandled rejection，收容是唯一在執行時期守得住的防線。
- **保留 `structuredClone`、在提供方裡做校驗**——Service Definition 纔是持久化邊界的所有者（每個提供方儲存的都是 JSON 形態文件），而且在呼叫時刻拒絕能把違規值的路徑給到呼叫方；提供方側的檢查要到合併之後才拒絕，歸咎的是合併後的分節，而不是呼叫方傳入的值。

## 後果

`update()` 對鎖取得期限與磁碟文件非法都有成文的失敗模式，rejection 訊息攜帶以 `$` 為根的路徑。持有者崩潰後可能留下鎖，需要操作者核實後移除；若按鎖齡自動接管，則會允許多個寫入方重疊。仍然存在、且已記錄在提供方 README 中的有：同 namespace 並行編輯仍是後寫勝出（沒有逐值合併，也沒有修訂號檢查）；OS 從未投遞的 watcher 事件會讓快取保持過時，直到下一個訊號或下一次寫入；被替換陣列內部的註釋、以及行內附著在被改標量值上的註釋，會隨其描述的值一起消失。

[使用者設定 seam note](2026-07-28-user-settings-seam.md)裡「延後鎖定檔」那條替代方案已被本 note 取代。同類缺陷曾存在於 `dsh-credentials-local`（兩條鏈共用一個 `.env`、按快取整文件寫回、持久化之後才發事件）與 `llm/adapters-updated` 扇出；[credential-boundaries note](2026-07-30-credential-boundaries-and-atomic-registration.md) 在那裡套用了本範本。
