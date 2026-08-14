# @deepseek-ai/dsh-compaction

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

**`CompactionEngine`**（`ctx.compaction`）定義壓縮（compaction）做什麼，即判定歷史記錄是否過大，並將較早範圍摘要為單個表層節點，但不規定如何實作。

本包承擔壓縮能力的 Service Definition 角色，因此各角色均可獨立演進，也可獨立替換：

| 包 | 職責 |
|---|---|
| `@deepseek-ai/dsh-compaction`（本包） | Service Definition：抽象服務 + `compaction/*` 事件 + `CompactionResult` + 關聯檢查點源構造函式 + 工具配對邊界 helper |
| `@deepseek-ai/dsh-compaction-basic` | Service Provider：`ctx.tokenMeter` 壓力 + token 預算保留 + `llm.stream()` 摘要 |
| `@deepseek-ai/dsh-command-compact` | Consumer：面向人類的 `/compact` 命令，基於 `ctx.compaction.compactNow()` 實作 |

與 bash seam 不同，該 Service Definition 相依性 `@deepseek-ai/dsh-session` 和 `@deepseek-ai/dsh-llm`。約定的動詞基於 `Session` 定義，其輸出使用 `ContentBlock` 詞彙，因此無法在不指名這些包的情況下表達。這項對「Service Definition 只相依性 cordis」指引的偏離是有意的，並記錄在 [壓縮能力 seam Agent Note](../../../.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md) 中。

## 服務 API（`ctx.compaction`）

三個操作都是**抽象方法**：觸發策略、保留、事件順序與摘要均屬於後端。可複用的請求測量是獨立服務 [`ctx.tokenMeter`](../../llm/token-meter/README.md)，而非本 Service Definition 的一部分。

| 成員 | 語義 |
|---|---|
| `compactIfNeeded(agent, trigger, signal)` | 根據 `trigger: 'pressure' \| 'context-overflow'` 判斷是否需要自動壓縮。壓力觸發可應用後端的閾值與保留尾部策略；已確認溢位可強制進行有效的平衡縮減。返回 `CompactionResult`，無安全範圍時則返回 `null`。後端摘要請求是直接的 `ctx.llm.stream()` 呼叫（不是 agent loop（代理循環）步驟），因此每次呼叫都可在 `llm/stream` 處攔截。 |
| `compactNow(agent, signal)` | 即使未達到自動壓力，也顯式壓縮一段有效、平衡的較早範圍。該操作會在讓出控制權前同步預留空閒輪次接納；沒有有效範圍時不寫入任何內容；在摘要前記錄獨立的 `compaction/* { turn: null }` 嘗試；釋放預留前等待其持久性檢查點。預期操作失敗使用 `ManualCompactionError`；取消會原樣重新拋出 abort 原因。 |
| `compactRegion(start, end, agent, signal?)` | 強制將表層節點 `[start, end]`（包含兩端 seq）從 `agent.session` 摘要為單個替換節點，其源由 `compactCheckpointSource(compactionId)` 建立。如果壓縮已在進行、`start`／`end` 不是表層節點，或 `start` 在表層上位於 `end` 之後，則**拋出例外**。該範圍是表層位置範圍，不是數值 seq 區間：在之前的 replace 將新生成的高 seq 摘要節點放到已遮蔽範圍的位置之後，表層順序不再跟隨 seq 順序。 |

`CompactionResult` 向呼叫方保留原始摘要與記錄操作過程的事件 seq，同時保留已遮蔽範圍與 token 計量；其結構由漂移檢查保障，定義見 [壓縮資料結構參考](../../../docs/subsystems/compaction.md#compactionresult)。

`compactIfNeeded` 和 `compactNow` 必須傳入 `signal`；`compactRegion` 的該參數選填。透過 `ctx.llm.stream()` 摘要的後端**必須** 將它轉發到呼叫的 `GenerateOptions.signal`，因此 abort 或 fiber dispose（資源釋放）會停止進行中的摘要。自動和顯式範圍標記對會從當前打開的輪次復原其數字形式歸屬。手動標記對不要求存在打開的輪次，並標記 `turn: null`。

`ManualCompactionError.code` 是封閉集合 `busy | changed | summary | commit | persistence`。`changed` 和 `summary` 表示所選工作階段表層未被替換，但日誌仍會記錄失敗嘗試。`commit` 有意不判斷是否發生了部分變更；`persistence` 表示記憶體中的 bracket 已閉合，但顯式 flush 失敗。

## 工具配對邊界

該 Service Definition 匯出 `toolPairingBalancedBefore(session, seq)` 與 `toolPairingBalancedAfter(session, seq)`，用於對齊和驗證壓縮邊界。安全邊界不會被尚未回答的 assistant 工具呼叫跨越。每個 helper 都會驗證給定事件 seq 位於當前表層，並根據按表層順序快取的各切分點配對狀態返回結果。

每個工作階段的私有 cache 以 `session.surface.replaceGeneration` 和已處理表層條目數為 key。generation 未變時，只需將尚未處理的尾部條目納入累計結果；僅向日誌追加、但未新增表層條目時，不會讀取事件。replace generation 變化時則會重建當前成員關係與配對狀態。事件 seq 缺失以及 `tool/result` 沒有對應的先前未閉合呼叫，均會被視為表層狀態損壞並遭拒絕。

## 表層約定

`SurfaceEventType` 是封閉聯合：只有 `user/message`、`assistant/message` 和 `tool/result` 可以攜帶 `surfaceOp`。因此 `compaction/*` 事件**不能**出現在表層上。成功壓縮改為：

1. 追加 `compaction/start`（僅日誌）：取得鎖；
2. 摘要該範圍；
3. 追加 `compaction/summary`（僅日誌），其中記錄摘要、範圍、已遮蔽 seq、token 數與提供方／模型呼叫 envelope；
4. 追加單個 `user/message`，其攜帶 `source: compactCheckpointSource(compactionId, sourceCommandId?)` 和包含摘要的 `surfaceOp: { op: 'replace', start, end }`：這是**本操作唯一的表層變更**；
5. 追加 `compaction/end`（僅日誌）：釋放鎖。

表層變更（第 4 步）位於鎖的起止範圍**內**：`compaction/end` 是最後一個事件，因此表層變更落地前絕不會釋放鎖。如果在 `compaction/start` 與 `compaction/end` 之間崩潰，會留下可偵測的殘留鎖（一個 `compaction/start` 沒有匹配的 `compaction/end`），而不是虛假聲稱壓縮已完成、但表層從未被遮蔽的 `compaction/end`。

這對標記表示取得和釋放鎖的時間點，並非排他的事件容器。手動摘要等待期間，空閒的 `inject()` 可以在 start 與 end 之間追加不相關的上下文。因此，手動穩定性檢查會重新驗證所選 span，而不要求整個表層相等；位置替換會讓該注入上下文在檢查點之後保持可見。自動壓縮則要求其活動輪次內的整個表層保持相等。

`deriveMessages()` 隨後將摘要算繪為 user 角色訊息，再跟上已保留節點。已遮蔽事件仍保留在原始日誌中，因此重播具有確定性。

## 阻塞

壓縮由所有入口點共享的一個日誌記錄鎖序列化。尾部檢查會分別尋找最新的未匹配 `compaction/start` 和最新的 `session/end-seed`。位於該邊界之後的未匹配 start 是活動鎖並報告 `busy`；更早的未匹配 start 是先前行程生命週期留下的過時證據，不會阻塞。同一個 end-seed 轉換會清除不變數配套元件的重播追蹤狀態。活動標記對不能跨越 `turn/start` 或 `turn/end`；在接管工作階段時，如果後續 end-seed 證明打開的標記對已經過時，則繼承前綴中的修復邊界仍可重播。

鎖就是持久標記對，而非 `WeakSet`、包裝層 mutex 或用戶端側錨點。`compaction/start` 會在摘要讓出控制權之前同步追加。之後每次失敗都會恰好嘗試一次 `compaction/end { error }`；如果追加該閉合事件本身失敗，未匹配 start 會繼續作為有意保留的 busy 訊號，並且不會嘗試 flush。已成功閉合的手動嘗試即使報告 `changed` 或 `summary` 也會 flush，從而在釋放輪次接納預留前保留該記錄。

## 事件

`compaction/*` 事件透過 declaration merging 擴充 `SessionEventMap`（可合併擴充）：它們是工作階段事件，不是 cordis `Events`，三者均僅存在於日誌（不含 `surfaceOp`）。各事件 payload 與語義見生成的 [持久化日誌事件目錄](../../../docs/persistence-catalog.md)。

## 實作後端

繼承 `CompactionEngine`，實作 `compactIfNeeded`、`compactNow` 與 `compactRegion`，再將子類作為外掛程式載入：它會註冊為 `ctx.compaction`。每個成功後端都使用 `compactCheckpointSource(compactionId, sourceCommandId?)` 建立替換 user 訊息的源；必填的 `compactionId` 將檢查點與對應 `compaction/*` 交易關聯，而 `isCompactCheckpointSource()` 可在持久化或克隆後識別該標記，無需相依性後端身份。基於樣板或模型的實作可以放在同級包中，不需更改呼叫方或共享 token meter。

## 在 host 程序之外識別檢查點（`./checkpoint`）

`compactCheckpointSource()`、`CompactionCheckpointSource` 與 `isCompactCheckpointSource()` 聲明在 `@deepseek-ai/dsh-compaction/checkpoint` 子路徑上，並由包根重新匯出，因此 host 側消費端仍從根讀取它們。構造函式要求傳入所屬 `CompactionId`，防止後端寫入缺少關聯關係、必然被包不變數拒絕的標記。該葉子不匯入 cordis、也不聲明任何模組增強（即 [`dsh-commands/brand`](../../interaction/commands/README.md) 的形狀），這正是用戶端或 wire 程序能夠命名該檢查點來源的原因：包的**根**根本無法進入這類程序，因為它會到達 `dsh-session` 的根，而那處 `Context` 合併會讓 host 的 `sessions` 服務與用戶端自己的衝突（`TS2717`——每側一個程序，見 [development.md](../../../docs/development.md#typescript-project-layout)）。Web 用戶端的 transcript（文字記錄）配接器用僅類型匯入把它的外掛程式字面量釘在該葉子的源類型上，因此在此處改外掛程式 id 會讓那邊編譯失敗。

## 模型體驗

### 呼叫後端時的工作階段歷史

#### 模型看到的內容

成功的實作會用一個 user 角色摘要檢查點替換較早表層範圍，即一個 `user/message`，它攜帶 `surfaceOp: { op: 'replace', start, end }`；原始事件仍會記錄，但不再出現在派生模型訊息中。seam 本身不執行改寫。

#### Token 影響

該 Service Definition 不會直接產生 token。後端用一份摘要換取多個原本保留的歷史 token，並保持近期尾部不變。

#### KV Cache 影響

成功的後端替換會使從第一個已遮蔽歷史 token 起的複用失效；seam 本身不會改變請求。

## 已知限制與暫緩事項

- **面向使用者的命令，而非模型工具**：`@deepseek-ai/dsh-command-compact` 透過 `ctx.commands` 暴露無參數 `/compact`；不會註冊面向模型的壓縮工具。
- **部分單元溢位不在約定內**：平衡摘要壓縮無法拆分一個不可分單元。當閉合工具對中可移除的主要部分是承載文字的工具結果時，選填剪枝配套服務仍可修復該工具對；無法壓縮大型非工具節點，或不可剪枝剩餘部分過大的工具單元。
- **單獨接近視窗大小的 envelope 不屬於表層壓縮工作**：壓縮縮減派生歷史，絕不縮減系統提示詞、工具或工作階段前綴。
