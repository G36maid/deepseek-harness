# Agent Note: 瀏覽器工作階段是按日誌順序投影的人類對話記錄

Status: implemented

[English](2026-07-30-web-transcript-log-ordered-projection.md) | [简体中文](2026-07-30-web-transcript-log-ordered-projection.zh.md) | 繁體中文

## Problem

瀏覽器用戶端從模型可見的 surface 建置工作階段：`FoldAdapter` 在歷史視窗上執行核心 `SurfaceManager` 並讀取 `surface.nodes`。一次成功的壓縮（compaction）會用一個檢查點節點替換一段 surface 範圍，因此該替換一落地，Web 流就把它所遮蔽的每則訊息摺疊成一行灰暗的上下文——那是使用者已經讀過的對話。日誌中什麼都沒丟失；缺陷完全在投影層，而[終端機與宿主閘道已按同一方式修復](2026-07-29-human-transcript-append-origin.md)，瀏覽器留給了本次變更。

surface 順序還讓另外兩個問題成為結構性的。一次替換之後它並非按 seq 升序——`SurfaceManager` 把高 seq 的檢查點拼接到它所遮蔽範圍的位置上——因此按數值 seq 歸並進該陣列的僅日誌節點（斜槓命令列、被打斷的凍結節點）可能被沖刷到檢查點之前，再也無法交錯回保留下來的尾部。而且由於分頁不再為 replacement 副本消耗 `maxMessages` 額度，一頁現在可以攜帶一個 `surfaceOp.start` 落在視窗之外的檢查點；核心 fold 拒絕該範圍，於是 `nodes()` 退回到一次寬容的線性掃描、列印一條 `console.error`，並行布一個描述該失敗的 `foldDegraded` 標志。

## Decision

`TranscriptAdapter` 取代 `FoldAdapter`，並且從不查詢 surface 順序。它按日誌順序投影原始視窗：每個 append 來源的 surface 事件（`isAppendSurfaceEvent`）落在它自己的日誌位置上，外加每次落地的壓縮檢查點一個 `CompactionSummaryNode` 標記。於是一次落地的壓縮會保留它在模型側遮蔽掉的對話，標記報告模型從哪裡開始看不見那段歷史，而不是把它抹掉。僅模型可見的 replacement 副本不進入記錄：被裁剪的 `tool/result` 和重新生成的 `assistant/message` 只為模型重寫一個節點，不在對話中標記任何邊界。凡必須傳送模型所見內容的一切仍讀 surface；這是人類投影，兩者現在在兩個前端上都已分離。

節點順序天然按 seq 單調，由此有三個結果。僅日誌的 `command/run` / `command/done` 對摺疊成 `CommandNode`，按 seq 插入一個本已單調的陣列——無錨點，無重排。`Session` 保留被打斷的凍結節點的歸屬，用一次普通排序按其分數 seq 歸並，而這現在恰好就是流順序。檢查點所引被遮蔽範圍落在視窗之外的視窗沒有範圍需要解析，因此標記正常渲染且不列印任何日誌。

`foldDegraded` 從 `ConversationSnapshot` 消失，隨之消失的是哨兵填充、它們所需的 `baseSeq` 算術，以及 `degradedSeqs()`。它們的存在只為滿足核心 fold 的 `seq === index` 斷言並在其拋錯時存活；它們所描述的 fold 已不再執行。刪除該標志是修復的一部分，而非修復之後的清理——`degradedSeqs()` 本身已幾乎就是按日誌順序的投影，只是作為拋錯後的落點而非本意到達。

標記的摘要文字、被替換條目數量和估算的被遮蔽 token 數量都來自檢查點引用的 `compaction/summary` 事件，絕不取自成框的檢查點載荷——那是為模型撰寫的指令信封。視窗切分把該事件留在視窗外時這些欄位不可用，與無呼叫的工具結果同一種軟退讓；後續補上該事件的分頁會解析出它們。

[手動壓縮命令](../feature/2026-07-30-queued-manual-compaction.md)會把摘要事件的 seq 作為成功結果的 `CommandResult.sourceEventSeq` 返回，`command/done` 則持久化這項選填引用。Chat 只會配對成功且名稱為 `/compact`、其引用恰好等於唯一一個已載入 `CompactionSummaryNode.summaryEventSeq` 的命令。執行中的命令先渲染為 `compact · Compacting context…`；檢查點落地後，同一個 React key 會在檢查點的訊息流位置渲染一條收起的 `compact` 展開項，並顯示條目數量和 token 估算值。輸入被拒絕、沒有可壓縮歷史、取消和失敗時仍使用通用命令列，並保留處理器撰寫的完整文字。自動壓縮沒有命令引用，繼續使用獨立的上下文已壓縮標記。

顯式事件引用之所以重要，是因為手動壓縮允許在非同步摘要執行期間注入持久上下文：命令列與檢查點行不保證相鄰。命令生命週期事件增加一個選填欄位，但壓縮交易、RPC 信封和模型可見 surface 均不變化；不含該欄位的預發布持久日誌繼續採用原先的兩行軟退讓，無須遷移。

## 識別檢查點：同一份聲明，在編譯期釘住

識別需要三個條件同時成立，與終端機一致：`event.type === 'user/message'`、壓縮縫隙的檢查點外掛程式來源，**以及** `isReplacementSurfaceEvent(event)`。一條 append 的外掛程式來源 `user/message` 是注入上下文——跨工作階段引用卡片——不是壓縮。

從 `packages/client/*` 程序無法到達的是 `dsh-compaction` 的**根部**，而不是這個包。根部會到達 `dsh-session` 的根部，後者的 cordis `Context` 合併聲明瞭宿主側 `sessions: SessionStore`，與用戶端的 `sessions: ISessions` 衝突——`TS2717`，即 [development.md](../../../../docs/development.md#typescript-project-layout) 中每側一個 program 的規則；這一點對僅類型匯入同樣成立，因為該衝突是編譯器事實而非打包器事實。

本倉庫對這一情形的既有答案是不含 cordis 的葉子子路徑，本次變更就新增了一個：`COMPACT_CHECKPOINT_SOURCE` 與 `isCompactCheckpointSource` 現在住在 `packages/compaction/compaction/src/checkpoint.ts`，它不匯入 cordis、也不增強任何模組（即 `dsh-commands/brand` / `dsh-llm/message` 的形狀），而包根重新匯出兩者，因此每個宿主側消費端——終端機的 chat helper、`dsh-session-reference` 的投影——都不需改動。配接器用僅類型匯入把它的字面量釘在該聲明上：

```ts
import type { CompactionCheckpointSource } from '@deepseek-ai/dsh-compaction/checkpoint'
const COMPACT_PLUGIN: CompactionCheckpointSource['plugin'] = 'compact'
```

重新命名 Service Definition 的外掛程式 id 現在會在用戶端產生編譯錯誤：`TS2322: Type '"compact"' is not assignable to type '"compaction"'`。該匯入必須保持**僅類型**——任何既非平臺模組又非 inline-safe wire 層的 `@deepseek-ai` 包值匯入都會被用戶端純度閘門（`packages/client/tsdown.client.ts`）拒絕，而它自己的報錯資訊就記錄著僅類型匯入會被擦除、永不抵達該閘門。僅類型的葉子匯入同時需要 `tsconfig.base.json` 的一條 `paths` 條目和 `packages/client/runtime/tsconfig.json` `references` 中的 `{"path": "../../compaction/compaction"}`：composite 的 `rootDir` 規則同樣適用於被擦除的匯入，缺少該引用時的診斷是 `TS6059`/`TS6307`。

`packages/client/ui-conversation/tests/conversation-node-definitions.client.spec.ts` 是行為側的另一半，用檢查點與溯源記錄驅動程式壓縮 Definition，並證明後續載入的舊分頁可以補齊缺失的摘要資料。Definition 僅類型匯入該葉子路徑，使用戶端繼續與 compact 包根及經由它可達的宿主側 `Context` 合併隔離。

因此與終端機的分歧很窄：兩個前端都從同一份聲明識別檢查點——終端機在宿主側值匯入 `isCompactCheckpointSource`（那裡不適用任何閘門），用戶端釘住類型。

## #835 的位置錨點是為什麼而存在，以及為什麼它是被溶解而非丟失

尚未合併的排隊式手動壓縮分支用另一種方式修同一個交錯缺陷：為每個事件記錄一個錨點——追加時的 surface 尾部——並把被遮蔽的錨點重定向到檢查點上。該機制的存在是為了讓位置錨點在 surface **重排**中存活。人類對話記錄永不被重排，因此錨點沒有任何東西需要重定向：前提被移除，修復並未被丟棄。該機制在本程式碼庫中並不存在。

## Alternatives considered

**從新葉子值匯入該謂詞**，並把 `dsh-compaction` 加入用戶端 `INLINE_SAFE` 白名單。已拒絕：用戶端需要的是外掛程式 id，不是謂詞——一個類型就夠了，而被擦除的匯入根本不會抵達純度閘門，因此無需向它放行任何東西。白名單只在值匯入時纔有意義，而在那裡它是筆糟糕的交換：`INLINE_SAFE` 按模組說明符*前綴*匹配，因此放行該包會連它那個會匯入 cordis 的根部一起放行。

**一條純形狀規則**——任何 replacement `user/message` 都是壓縮。已拒絕：它今天正確只因為壓縮是 replacement `user/message` 的唯一生產者，一旦這點改變便無任何機制能捕獲。那個 pin 測試只花一個文件，就精確消除了這一風險。

**在宿主側給檢查點打標**，經投影或線協議。已拒絕：這最貼合“經 cordis 服務協作”的規則，但用戶端今天摺疊的是原始 `SessionEvent`，因此這意味著一次線協議約定變更——為一個純謂詞付出的代價不成比例。

**把凍結節點的歸屬移進配接器**（`nodes(extraNodes)`），像那個未合併分支所做的那樣。已拒絕：被打斷的節點來自 `Session` 已經在視窗上執行的 `turn/end` 清掃，而在按 seq 單調的記錄之上，簡單形態就是正確的——配接器返回節點，工作階段按 seq 歸並凍結節點。加寬配接器簽名什麼也換不到，還會把清掃與它的產物拆開。

**把 `foldDegraded` 留作一個防禦性標志。** 已拒絕：它描述的是一個已不再執行的 fold 的特定失敗。一個消費端無法據以行動、只能透過 `console.error` 到達的標志，是一份虛假約定。

**把最近的 `/compact` 行與下一個檢查點配對。** 已拒絕：兩者之間可能落入上下文注入，並行或格式例外的生命週期記錄也必須降級而不誤取其他檢查點。命令結果則指明權威摘要事件；引用存在歧義時不配對任何內容。

**解析英文結帳文字中的條目數量和 token 數量。** 已拒絕：處理器文案是呈現文字，而非穩定的資料約定。標記讀取本已持有這兩個值的結構化 `compaction/summary` 載荷。

## Consequences

壓縮不再抹掉 Web 歷史；一個被壓縮多次的工作階段按日誌順序顯示每次落地壓縮一個標記，而同一視窗在即時與冷復原之後渲染完全相同。分頁缺口是被構造性閉合而非被防禦，`ConversationSnapshot` 少了一個已發布欄位，這觸及十三個文件。

`ConversationNode` 增加第八個分支，因此每個窮盡消費端都多一個分支：`MessageItem` 透過新的 `CompactionItem` 渲染標記，trajectory 版面配置加寬它的“無單元格”分支，使標記不貢獻單元格但仍推進耗時遊標。

效能約定未變，且現在更易表述：一次追加物化一個節點，不改變任何節點的事件保持上一次的陣列引用——因此區塊風暴零成本、`nodes()` 甚至不會重算——未變化的節點保持其對象標識。視窗仍隨工作階段長度而非隨 surface 成長，這正是本修復存在所要做的交換；一次壓縮過去恰好為壓縮所服務的長工作階段限制了投影規模。

Web e2e 場景現在圍繞它錄制的那一輪上的壓縮交易播種一次真實的手動命令生命週期，因此 aria 基準經真實宿主與真實瀏覽器釘住完整行為：錄制的提問與完整工具輸出仍在螢幕上，其後恰好一條 `compact` 行報告規模，展開後會顯示確切摘要。錄制本身未被觸碰、保持模型真實——重播從錄制自身的 surface 派生出手動壓縮。

## Deferred

終端機的[已歸檔壓縮進度決策](../../archived/feature/2026-07-30-compaction-progress-visibility.md)使用即時獨立標記對驅動程式單格指示器，並不改變此瀏覽器投影。
