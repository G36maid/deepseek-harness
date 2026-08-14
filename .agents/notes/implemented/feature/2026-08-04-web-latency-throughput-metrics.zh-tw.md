# Agent Note: Web 輪次與視窗級延遲/吞吐指標

Status: implemented

[English](2026-08-04-web-latency-throughput-metrics.md) | [简体中文](2026-08-04-web-latency-throughput-metrics.zh.md) | 繁體中文

## 問題

Web 聊天已經記錄了逐步驟的 LLM（大型語言模型）計時（`stepStartTime`／`firstTokenTime`／`completedTime`）和逐步驟 usage，trajectory 檢視表也按步驟展示它們，但聊天介面既回答不了「這一輪回應有多快」，也回答不了「這個工作階段跑得有多快」：assistant 頁腳只顯示輪次實際耗時，統計行也只折算牆鐘時間總量。

## 決策

`ui-conversation` 包內的折算邏輯 `chat/turn-metrics.ts` 是從 assistant 節點推導延遲/吞吐讀數的唯一位置。`assistantStepReading` 把一個節點轉成一次步驟讀數：TTFT（首 token 延遲）需要 `stepStartTime` 與 `firstTokenTime` 同時存在，解碼時長需要 `firstTokenTime`，負時長鉗制為零，輸出 token 數只在不可信的 `usage` 值有限且非負時才採納。`deriveTurnMetrics` 按輪次折算讀數：編號最小的步驟擁有該輪次的 TTFT 槽位，吞吐用「同時攜帶兩者的那些步驟」的輸出 token 總和除以解碼時長總和，因此缺取樣的步驟直接退出而不是讓比值失真；兩個數字都沒有的輪次不產生條目。

assistant 頁腳把讀數追加到既有 hover 顯示的時間附屬元素中、`用时` 之後，形如 `首 token {s}秒 · {tps} tok/s`，未記錄的數字各自省略。ChatView 僅在該輪次的 `turnTimings` 條目帶有 `endTime` 時才顯示讀數：已載入視窗是日誌的連續後綴，因此視窗內已結帳的輪次必然帶著它的全部步驟，首步 TTFT 是真實值而非視窗截斷的產物。`formatLatencySeconds` 不帶單位，各語言範本各自擁有秒後綴（`TTFT {seconds}s`／`首 token {seconds}秒`）。

統計行在其視窗折算中複用同一份步驟讀數：`deriveStats` 累計 TTFT 總和／計數與解碼時長／token 數，在 LLM／工具牆鐘時間旁渲染經 `conversation` locale 命名空間本機化的延遲／吞吐分組（中文為 `首 token 平均 … · … tok/s`）。輪次計數、步驟計數、耗時、快取與 token 各項的標籤也使用同一命名空間。與那些牆鐘時間一樣，該分組是視窗作用域的，不折算任何計費；token 帳目仍歸 token-meter 投影。

## 考慮過的替代方案

**持久的工作階段投影（token-meter 形態）。** 在 host 側用 `ProjectionDefinition` 折算步驟計時可以跨越壓縮（compaction）與視窗分頁、覆蓋整個日誌。是暫緩而非否決：投影狀態必須保持 O(1)（只能均值，不能分位數），它需要 host 改動加 schema，而聊天統計行的耗時事實本就被記錄為視窗作用域——新分組沿用該作用域。後續 PR（Pull Request）可以在不挪動這些讀數的情況下補上持久投影。

**逐步驟頁腳附屬元素。** 讓每條 assistant 訊息顯示自己的 TTFT，會給輪次中段的敘述節點掛上附屬元素，而頁腳設計刻意讓它們保持無 chrome；trajectory 檢視表已經暴露逐步驟計時細節。

**用節點是否在場而非 `turn/end` 計時做頁腳門控。** 直接渲染碰巧載入到的步驟，會展示一個貌似合理、實為分頁後「首個已載入步驟」的 TTFT。`endTime` 門控加上後綴視窗不變數，使顯示的數字要麼是該輪次真實的首步延遲，要麼什麼都不顯示。

## 後果

視窗內已結帳輪次的頁腳在 hover 時於實際耗時之後顯示 `首 token`／`tok/s`，統計行在牆鐘時間旁以本機化標籤顯示視窗平均延遲與吞吐，全程不新增工作階段事件、不改 host。指標以省略的方式退化：沒有計時或 usage 取樣的提供方或步驟只是丟掉對應數字，而不會渲染成零。已載入視窗之外的更早歷史仍不計入，已記錄在包 README 的統計行限制中。

兩個讀數都來自實測牆鐘時間，因此都不可復現：TTFT 是 `firstTokenTime - stepStartTime` 的時間差，吞吐則以 `completedTime - firstTokenTime` 的解碼牆鐘時長為分母。同一個重播場景在本機連續兩次跑出 69 與 70 tok/s，而一段 3 毫秒的重播流會讀成 26333 tok/s。因此 Web aria golden 在既有的 `{{duration}}` 之外，把吞吐歸一化為 `{{throughput}}`；頁腳的裝飾性分隔符也補上了兩側空格——沒有它們，這些讀數會連成一整串無障礙文字（`Ran for 13sTTFT 0.2s12 tok/s`），既讓螢幕閱讀器失去讀數之間的邊界，也讓 `{{duration}}` 失去它賴以匹配的詞邊界。
