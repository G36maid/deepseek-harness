# Agent Note: 人類可讀記錄投影追加來源的事件

Status: implemented

[English](2026-07-29-human-transcript-append-origin.md) | 繁體中文

## 問題

終端機與宿主歷史閘道都把模型可見的 surface 當作 transcript（文字記錄）。一次成功的壓縮（compaction）會用一個檢查點節點替換一段 surface 範圍，因此該替換一落地，終端機就丟棄了它所遮蔽的每則訊息——那些是使用者已經讀過的對話——並在此後任何替換到來時重新執行這次破壞性重建。同樣的混淆也波及分頁：`maxMessages` 統計視窗內的每個 `user/message` 和 `assistant/message`，於是僅供模型使用的替換副本佔用了一個人類從未填充的頁面額度，而切分點還可能落在壓縮的僅日誌 `compaction/summary` 事件與引用它的替換之間。

日誌本身沒有丟失任何內容。`Session.events` 仍保存著每條原始訊息和完整的工具結果；surface 只決定接下來傳送給模型的內容。缺陷完全在投影層。

## 決策

模型投影與人類投影是分開的，而事件屬於哪一種由事件自身的標記決定。`dsh-session` 在瀏覽器安全的 `surface` 模組中匯出按兩種 `SurfaceOp` 變體劃分的謂詞 `isAppendSurfaceEvent(event)` 與 `isReplacementSurfaceEvent(event)`。追加來源的事件是 transcript 的持久來源，替換副本僅供模型使用。凡是必須準確傳送模型所見內容的部分——`deriveMessages`、token 記帳、壓縮後端、工具配對、注入上下文的存活判斷、跨工作階段引用投影——都繼續讀取 `session.surface`。

終端機從追加來源的 surface 事件重播 transcript，並透過 `transcriptToolCallIds` 讓被遮蔽步驟的工具卡片保持配對：該函式讀取追加來源的 `assistant/message`，而不是 surface 成員關係。已落地的壓縮會在其自身日誌位置貢獻一行暗色 `… earlier context was compacted …`：這行標記報告模型從何處起不再看到那段歷史，而不是把它抹掉。帶框的檢查點載荷從不渲染，且兩條路徑都按同一個標記對 surface 事件分類，因此即時到達的壓縮與復原後重播同一份日誌會產生相同的 transcript。只有重播會重新推導 `tool/call` 的配對關係：呼叫事件自身不攜帶標記，其歸屬繼承自公佈它的 `assistant/message`，而即時監聽器必然剛剛渲染過後者。

檢查點透過壓縮 seam 自身的約定來識別——`isCompactCheckpointSource`，即 `CompactionEngine` 要求替換使用者訊息攜帶的、與後端無關的標記——因此終端機相依性的是已聲明的詞彙，而不是替換的形態。`dsh-session-reference` 已經在用該謂詞投影另一個工作階段的日誌；這裡只是另一個讀者提出同樣的問題。其他替換保持靜默：被裁剪的 `tool/result` 與重新生成的 `assistant/message` 只是為模型重寫一個節點，並不在對話中標出邊界。

`session.history` 只把追加來源的訊息計入 `maxMessages`。每一頁仍是一段連續的原始事件區間，因此壓縮的 `compaction/summary` 事件會與引用它的替換留在同一頁。

持久事件、RPC 信封、壓縮交易與模型可見的 surface 都沒有變化，也不需要遷移。

## 延後事項

瀏覽器用戶端在[Web transcript 投影筆記](2026-07-30-web-transcript-log-ordered-projection.md)中單獨修復：它按日誌順序投影同一份追加來源 transcript 並渲染一個標記元件，同時閉合本次變更打開的分頁缺口——因為 `session.history` 不再為檢查點消耗額度，它永遠不會在檢查點與檢查點引用的來源事件這個整體內切分，於是一頁可以攜帶一個引用了視窗之外 `surfaceOp.start` 的檢查點，而瀏覽器的 surface fold 會拒絕該範圍。這個缺口早於本次變更（此前計數就可能越過檢查點進入它所遮蔽的範圍），但當檢查點是最舊的被計數訊息時，舊分頁規則會把整段被遮蔽的範圍放在同一頁。

終端機的[已歸檔即時壓縮進度決策](../../archived/feature/2026-07-30-compaction-progress-visibility.md)使用獨立標記對中的事件驅動現有的單格指示器。它既不改變本文所負責的完成標記，也不新增規模資訊：檢查點的 `sourceEventSeqs` 仍可供經另行論證的計數或區間使用。因此，進度顯示既不需要修改標記內容，也不以提取 `renderReplacement(event)` 為前置條件。

## 曾考慮的替代方案

**按形態識別檢查點（一個替換型 `user/message`）。** 被否決：那讀取的是當前生產者的巧合而非已聲明的約定，而未來任何用使用者訊息替換一段範圍的生產者都會靜默地繼承壓縮標記。seam 已經發布 `COMPACT_CHECKPOINT_SOURCE`，正是為了讓消費端與後端無關地識別檢查點。

**繼續把檢查點渲染為注入上下文卡片。** 被否決：帶框的檢查點是為模型撰寫的指令信封，不是人類對話內容。展示它卻隱藏它替換掉的歷史，正好顛倒了讀者的需要。

**持久化第二份展示用 transcript。** 被否決：僅附加的日誌已經包含權威源材料，平行 transcript 換不來任何東西，反而增加遷移與一致性工作。

**用 `compaction/*` 括號而不是檢查點來推導標記。** 就 transcript 而言被否決：括號是圍繞一次操作的一對時間點標記，而 transcript 需要的是 surface 真正發生變化的位置。括號適合作為進度與耗時的來源，而本次變更並不渲染這些。

**像 `session-query` 為搜尋所做的那樣重新摺疊日誌來分類事件（`current`／`shadowed`／`log-only`）。** 被否決：摺疊回答的是整份日誌的問題，而投影問的是逐事件的問題，事件自身的標記已能以常數時間給出答案。

## 後果

壓縮不再抹掉終端機歷史；被壓縮多次的工作階段會按日誌順序顯示每次落地壓縮對應的一行標記。分頁的每一頁可以攜帶比以前更多的原始事件，因為額度只花在人類或模型真正產生的訊息上。

`rebuildTranscript` 現在會為整份日誌中的每個追加來源事件物化一個元件，並在掛載時、終端機配色方案變化時以及每次切換推理（reasoning）時執行。壓縮此前正好為壓縮所服務的那些長工作階段限制了這項工作量，因此這份開銷現在隨工作階段長度成長，而不再隨 surface 成長。這正是本次修復要做的取捨——保留歷史纔是目的——但視窗化或複用策略屬於第一個真正測到重建變慢的人，而不屬於日後某個疑惑工作量為何成長的效能分析者。

`dsh-tui` 為一個純謂詞新增了對 `dsh-compaction` seam 的相依性，與 `dsh-session-reference` 現有用法一致。終端機在執行時期仍然不需要任何壓縮後端。

兩項行為隨其測試一起改變。表層替換的終端機測試此前釘住的是抹除（「隱藏被遮蔽的工具呼叫」），現在釘住的是保留加恰好一行標記，其中被裁剪的結果副本、重新生成的 assistant 訊息以及來自其他外掛程式的替換都不渲染任何內容。壓縮快照場景此前聲稱釘住壓縮，卻寫入了 `agent-instructions` 來源；現在它寫入真實的檢查點來源，並重新錄制三份 fixture（測試前置資料），以顯示被保留的提示、完整的工具卡片和那行標記。

上文的即時／重播等價性由 fixture 釘住，而不只是在此斷言：`surface-replayed-compaction` 在掛載時替換已經存在，其錄制結果與即時路徑的 `surface-after-compaction-wide` 逐位元組一致。改動任一路徑都會破壞這項相等——這正是要點：重播投影纔是當初對使用者造成回歸的部分，兩份 fixture 必須一起變動。
