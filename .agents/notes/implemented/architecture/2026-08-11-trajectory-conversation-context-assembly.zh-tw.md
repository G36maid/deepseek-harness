# Agent Note: Trajectory 基於註冊式 Conversation Context 組裝資料

Status: implemented

[English](2026-08-11-trajectory-conversation-context-assembly.md) | [简体中文](2026-08-11-trajectory-conversation-context-assembly.zh.md) | 繁體中文

## 問題

Trajectory 曾維護獨立的 Session History 資料源，並把完整的已載入 Event 視窗摺疊為 Assistant、Tool、訊息、Request header 和 Compaction 狀態。Chat 已經透過註冊式 Conversation Definition 組裝相同的 Event 族。兩條鏈路重複實作業務關聯與分頁行為；即使只改變一個業務對象，Trajectory 的結構更新仍會複製或重新掃描與原始 Event 數量成正比的資料。

複用 Chat 的最終 Node 無法解決職責問題。Trajectory 需要請求生命週期、執行中 Assistant 狀態、提示詞繼承、Tool schema、計時記錄和 stage-oriented read model，而 Chat 不消費這些資料。共享最終 Node payload 會讓兩個檢視表都相依性雙方需求的並集。

本次遷移還必須保留持久 steering（中途引導）分類。`user/message` 本身不說明它是開啟了一個 Turn，還是從 `next-step` inbox 被領取；更早頁面還可能在訊息已經物化後，才補齊缺失的 inbox 前驅或 Location。

## 決策

Trajectory 針對共享的 [`ConversationNodeAssembler`](2026-08-09-client-conversation-node-assembly.md) 註冊 target 自有的 Conversation Definition 和 `trajectory` View Builder。Session 只維護一份連續 Event 視窗，並透過 `Session.views` 發布 Chat 與 Trajectory 快照；它不再執行第二套 Trajectory history source 或業務 fold。

每個 Definition 只屬於一個 target。Chat 與 Trajectory 可以識別同一持久 Event 族，但分別維護自己的 State 和最終 Node payload。它們只共享 Assembler 的精確 ID 匹配、有序 Match、Location 事實、Reader 相依性、發布調度，以及 replace/prepend/append 生命週期。

既有的 [Trajectory 檢查記錄表](../feature/2026-07-27-trajectory-inspection-ledger.md)繼續作為檢視表模型。Trajectory Builder 把已物化的 target Node 轉換為原有的 `eventNodes`、Requests、Tool schema、執行中呼叫和 Location map；layout、表格虛擬化、選擇、Overview 與檢查器行為不會成為通用 Conversation 約定。

### 業務 Definition

| 業務 | Context 標識 | State 組裝方式 | Trajectory contribution |
|---|---|---|---|
| `next-step` inbox | splice Event seq | 把 splice 應用到最近的前序 inbox Context | 只維護狀態，不產生可見 Node |
| 使用者、steering 或注入訊息 | message Event seq | 讀取前序 inbox State，並對持久訊息分類 | Input 或 context Node |
| Assistant 與普通 Request | `turn:step` | 摺疊 `step/start`、chunk、最終訊息、retry 和 `step/end` | 最終 Assistant、partial Assistant 與 Request |
| 根 Tool call | root call ID | 把根 call/result 與巢狀 Code Dispatch Event 摺疊為一棵呼叫樹 | 最終或執行中的 Tool tree |
| Compaction | compaction ID | 摺疊 start、summary、end 和 replacement checkpoint | Compaction Request |
| Request header | header Event seq | 讀取前一個 header，保留生效提示詞及真實變化 | Prompt 與 Tool-schema 來源 |
| Session 與 Turn 邊界 | boundary Event seq | 保留關閉時間和錯誤事實 | 被中斷的 Compaction 或失敗的普通 Request |

每個關聯 Event 都必須直接提供相同的業務 ID。Code Dispatch 使用 `rootCallId`，Compaction 使用 compaction ID；即使某個 Definition 按 `turn:step` 關聯，普通 Tool 與 retry Event 仍保留各自的協議標識。缺少必要關聯 ID 的舊記錄由該 Definition 忽略，不會合入 `undefined` Context，也不會導致 Session 崩潰。

Assistant chunk 只更新對應的 `turn:step` Context。帶內容的 chunk 請求 animation-frame 發布；usage 與 finish chunk 更新 State，但不單獨強制刷新一幀。最終訊息、retry 或邊界立即發布。已完成 Assistant State 只保留組裝後的 block、計時、usage 與 retry 事實，不會把原始 chunk ledger 複製進 target snapshot。

### 透過前序 Context 復原 steering

Trajectory 從持久 inbox 歷史復原 steering，使用與 [Chat steering 決策](../feature/2026-08-04-web-context-source-and-steer-marks.md)相同的標識規則，但不共享 Chat 的最終 Node。

每條目標為 `next-step` 的 `agent/inbox/spliced` Event 都會啟動一個以 Event seq 標識的不可見 Context。它的 `start()` 讀取最近的前序 inbox Context，應用 splice，並存儲待處理標識以及累計的已領取 message ID 集合。後續使用者來源的 `user/message` 讀取最近的前序 inbox Context：已領取的 ID 生成 Steering Node，其餘使用者來源訊息生成普通 User Node。

仍有更早歷史時，Reader miss 會記錄 window-gap 相依性。prepend 補齊缺失的前驅後，Assembler 按 Event 正序重放受影響的 inbox chain 與 message Context。因此，歷史分頁方向不會永久錯誤分類訊息。

訊息 Event 的 Location 會把 steering 放進所屬 Step。如果已載入歷史視窗缺少足夠的邊界 Event，無法解析該 Location，layout 就以後續 Assistant step 作為位置回退。同一個 Step 中，執行中 Request 標記排在前置 steering 輸入之後，因此該標記表示由這條輸入觸發的模型 Request，而不會出現在輸入前面。

### 視窗鏈路與複雜度

記 `E` 為已載入原始 Event 數，`P` 為一次新 prepend 的頁面，`D` 為 Trajectory Definition 數，`C` 為已物化的 Trajectory Context contribution 數，`Mᵣ` 為一次 prepend 使其失效的 Context 所持有的 Match 總數。`D` 是較小的註冊集合；流式 chunk 會聚合到同一個 Assistant Context，因此通常 `C` 明顯小於 `E`。

| 鏈路 | Context 工作量 | Target snapshot 工作量 | 結果 |
|---|---|---|---|
| 初始尾頁或重連 replace | 以 `O(E × D)` 匹配已載入視窗，並按 Event 正序構造 State | 構造並排序 `C` 個 contribution | 完整 replace 仍與已載入視窗成正比 |
| 更早頁面 prepend | 只匹配新 Event，並只重放 Match、Location 或 Reader 答案發生變化的 Context，成本為 `O(P × D + Mᵣ)` | 從 `C` 個 contribution 重建 stage snapshot | 業務 fold 不會從頭重跑全部 `E` 個 Event |
| 即時 append | 以 `O(D)` 匹配，以 `O(1)` 找到 keyed Context，並只更新對應 State | snapshot 組裝前，以 `O(1)` 替換 anchor 未變的 contribution | 業務關聯成本與已載入 Event 歷史無關 |

Builder 按 Context key 保存 contribution，並維護 key-to-position index。anchor 相同的內容更新會原位替換一個 contribution；新增 contribution 或 anchor 變化才會重建並排序 contribution 順序。隨後，snapshot assembly 遍歷 `C` 個 contribution，用 Map 索引 Request header 與 Tool schema，並以線性遊標或索引處理 Compaction boundary 與 Turn error。

最終 Event 和 Request 排序使單次發布的當前上界保持為 `O(C log C)`。本次遷移移除了重複反向尋找和舊的原始歷史 refold，但不聲稱端到端發布達到 `O(1)`。Chat 保持既有 keyed snapshot 行為與複雜度；增加 Trajectory target 不會讓 Chat 掃描 Trajectory Context 或 Node。

### 獨立的表現層熱點最佳化

Context 遷移與下清單現層最佳化解決的是不同成本。這些最佳化保留既有檢視表模型；收益來自呼叫次數和漸進複雜度推算，本決策不聲稱存在 benchmark 實測結果。

| 熱點 | 保留的行為 | 預期減少的工作 |
|---|---|---|
| Markdown 摘要 | Layout 只保留源 Markdown；每個穩定 Table record 按內容 memo 展示摘要，Detail 只解析當前選中記錄 | 單條 record append 只重解析發生變化的可見記錄，而非全部 Markdown record |
| 搜尋文字 | `TrajectorySearchIndex` 仍線性核對穩定 Record ID 與來源簽名，但只為變化的 record 標準化 Markdown，並以三秒批次提交更新 | 簽名比較仍為 `O(C)`；昂貴標準化只隨變化 record 數量成長，持續 frame update 每個時間窗合併成一個批次 |
| Timeline tooltip | 延遲 Tooltip 打開後才計算計時文案 | 沒有打開 Tooltip 的 render 不執行逐 span label 格式化 |
| 後繼 Assistant 尋找 | 一次反向遍歷為每個輸入位置記錄後續 Assistant | 原先重複向前尋找的最壞複雜度從 `O(C²)` 降為 `O(C)` |
| Group duration | 以固定十進位分組替代固定英文數字形態下的 `toLocaleString('en-US')` | 複雜度仍與 Group 數線性相關，但重複 render 路徑不再呼叫 Intl formatter |

展示 memo 與搜尋索引彼此獨立。搜尋必須覆蓋螢幕外 record，並允許即時變化延遲一個 throttle 週期；Table 必須立即更新發生變化的可見 record，不能繼承索引的提交節奏。

## 考慮過的替代方案

**保留獨立 Session History fold，只做區域性最佳化。** 不予採納：快取可以降低部分熱點，但 Trajectory 仍會在 Chat 之外擁有第二套 Event 視窗、分頁修復、request inspection fold 與業務關聯實作。

**複用 Chat Definition，並在 `buildViewNode()` 中按 `target` 分支。** 不予採納：Trajectory 需要不同的 State 與中間 record，不只是另一套 React renderer。單一 Definition 會攜帶兩個檢視表的 payload 與條件，並在任一檢視表變化時讓無關 target 資料失效。

**建立 Trajectory 專屬 Assembler。** 不予採納：精確 ID 路由、先 update 後 start 的收集、prepend replay、Location 修復、Reader 相依性與發布節奏都不是 Trajectory 特有行為。第二套引擎會重新製造本次改造要消除的生命週期重複。

**增加通用 Surface、rewind、fanout 或 settled 生命週期。** 不予採納：當前持久 Event stream 不需要通用 Surface branch；Session 或 Turn boundary 是 target 業務輸入，不構成把一個 Event fanout 到全部歷史 Context 的理由。完成條件仍由業務 State 結合 Location closure 判斷。

**用通用 Conversation Node 替換 Trajectory stage。** 不予採納：stage 為單一檢視表組織 Request、計時、schema 和表格 layout。把它變成引擎約定會限制未來的樸素 Session-log 檢視表，並把檢視表專屬組合重新放回 Client Runtime。

**在展示與搜尋之間共享一套 Markdown cache。** 不予採納：展示要求立即更新且受 viewport 約束，搜尋則覆蓋全部已載入 record，並有意批次提交更新。共享 cache 會把兩個無關消費端的正確性與調度節奏耦合起來。

## 驗證

Runtime 測試固定 target 註冊、精確 ID append、先 update 後 start 的 replay、prepend identity、Reader window-gap 修復、Location replay，以及 Chat 與 Trajectory snapshot 隔離。

Trajectory Definition 與 Builder 測試固定 Assistant streaming 與 interruption、巢狀 Tool call 和平行 interruption、Compaction 與 prompt 繼承、Steering 分類和 Step 位置、Request 標記順序、穩定 contribution 替換與 prepend 擴充。Table、layout、Timeline 與搜尋測試固定延遲 Markdown 工作、節流索引更新、Tooltip 展示時格式化，以及 append/prepend 期間穩定的搜尋結果。

## 後果

Trajectory 業務組裝的成本隨變化頁面或 keyed Context 成長，不再從完整原始 Event 視窗重新開始。target 自有 Definition 可以獨立於 Chat 演進，同時繼續共享一份 Session 視窗和一套生命週期規則。steering 會在實際所屬 Step 位置成為一等 Trajectory record，不需要向 Session 增加 steering 專屬狀態。

保留的 stage-oriented Builder 仍會執行與已物化 Trajectory contribution 數量成正比的工作，並可能在發布時排序。輸入 layout 變化時，搜尋索引仍會執行一次輕量線性簽名檢查。這些成本是顯式的 target view 工作，不是隱藏的完整 Event refold。

Definition 作者必須提供穩定的協議標識。缺少必要 ID 的舊 Event 可能不會出現在受影響的 Trajectory 業務檢視表中；與合併無關記錄或讓歷史載入失敗相比，這是更安全的退化方式。要求完整展示的生產方必須記錄該標識。

[Conversation assembly 決策](2026-08-09-client-conversation-node-assembly.md)繼續作為通用 Context、Reader、Location 與發布約定的真源。[Trajectory ledger 決策](../feature/2026-07-27-trajectory-inspection-ledger.md)繼續負責表格層級、虛擬化、檢查器和互動行為。本 Note 負責說明 Trajectory 如何適配這兩項決策，以及為何該適配不與 Chat 共享最終 Node。
