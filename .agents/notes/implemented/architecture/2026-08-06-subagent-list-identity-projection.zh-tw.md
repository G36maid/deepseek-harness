# Agent Note: subagent 清單經投影單元讀取身份

Status: implemented

[English](2026-08-06-subagent-list-identity-projection.md) | [简体中文](2026-08-06-subagent-list-identity-projection.zh.md) | 繁體中文

## 問題

重寫前的 `SubagentRuntime.listChildren` 對每個 `header.origin === 'subagent'` 的直接 child，每次清單都執行 `listEvents` 加 `readEvent` 兩次整日誌物化，且每次物化都伴隨整日誌 structuredClone，只為從描述符事件裡折出 mode 與 label 兩個欄位。描述符在日誌中的位置不固定——fork 前綴任意長，zstd 壓縮幀沒有 seq 索引——因此定位沒有捷徑；這條路徑沒有任何快取，代價隨 transcript（文字記錄）長度 × child 數量 × 清單頻率放大。它還把 session-query 拉成清單的硬相依性：沒有 query backend 的部署，`list_agents` 以 `SUBAGENT_CONTROL_SESSION_QUERY_UNAVAILABLE` 整體拒絕，儘管枚舉所需只是 header 事實。

同一根因還有第二個症狀：host 側的 `hasSubagentDescriptor()` 在每次 Agent（代理）綁定 RPC 的屬主判定上掃描目標工作階段的 own suffix，即便 `SessionHeader.origin` 已經回答了同一個問題的絕大部分。

根因在於 [durable-subagent-catalog 決策](../feature/2026-07-22-durable-subagent-catalog-and-list-agents.md)把描述符事件（`subagent/descriptor`）定為目錄的唯一持久權威，卻沒有為描述符讀取配任何快取層，並把逐 child 雙讀明確接受為「無索引的正確性基線」。[web subagent conversations](../feature/2026-07-27-web-subagent-conversations.md)（#1569）已把「是不是 subagent」放進了 header（`SessionHeader.origin`），身份判定不再讀日誌；mode 與 label 仍然要掃。

## 決策

mode 與 label 由新的 `subagent` projection unit（純身份兩臂）摺疊，unit 是摺疊規則的唯一權威；`listChildren` 不再相依性 session-query——枚舉是 subagent 自管的 live-preferred 合併，取值走三級「算完即止」階梯：live child 同步讀登錄檔的既有水位快取（零日誌讀）；cold child 先問選填的 `sessionProjectionCache` checkpoint，取到過 seq 門的身份即定值；否則一次 `persistence.inspect` 整讀加 `registry.restore` 摺疊。無索引、不自建快取、無回寫。

消除逐 child 掃描的出路有三類：把 mode/label 提升進 header（寫路承擔）；為投影建持久派生（checkpoint 階梯，或隨查詢索引重建落值、讀端對帳）；讀時現算（live 走水位快取，cold 一次整讀）。本記錄取第三條。「值隨查詢索引落庫」已整體退役：查詢基礎設施被迫認識領域詞彙，而唯一消費端讀時現算即可滿足——live child 的零讀由 session-projection 既有水位快取白拿，cold child 的一次整讀被「算完即止」顯式接受。前兩條與退役理由詳見考慮過的替代方案一節。

要點：

- **subagent 清單不相依性 session-query**：枚舉由 subagent 自管的 live-preferred 合併完成，mode/label 經 `ctx.sessionProjections` 取值；沒有 query backend 的部署照常清單。
- **取值三級「算完即止」階梯**：live child 讀 `sessionProjections.snapshot()`（登錄檔既有水位快取，零日誌讀）；cold child 先讀選填 `sessionProjectionCache.cachedSnapshot(header)`，values 含非 null 且過 seq 門（`seq >= seedLength ?? 0`）的 `subagent` 身份即直接用；否則一次 `persistence.inspect` 整讀加 `registry.restore({}, events, 0)` 摺疊；再沒有就沒有——不自建快取、無回寫、無索引。
- **`subagent` projection unit 是摺疊規則唯一權威**：live snapshot、cold restore、GUI history 的 detached 摺疊全部經 registry 計算，不存在第二份描述符解釋邏輯。
- **header、描述符（v2）、session-persistence、session-projection(-cache)、session-query(-sqlite) 全部零改動**；存量資料第一次被清單時一次 `inspect` 現算獲得精確值，無 unknown 降級態、無遷移。

與既有記錄的關係：

- 本記錄取代 [durable-subagent-catalog](../feature/2026-07-22-durable-subagent-catalog-and-list-agents.md) 中清單讀路徑的兩項設計：經 `sessionQuery.traceSession` 枚舉，與逐 child 讀取描述符事件（`listEvents` 加精確 `readEvent` 雙讀、就地診斷分類）。diagnostic 行語義保留，分類改由清單按投影值缺席與 activity 派生；描述符事件仍是 mode/label 的唯一持久權威與摺疊輸入，復原鑒權與啟用約定不動。屬部分取代，兩記錄保持交叉連結。
- [session-projection RFC](../../proposed/architecture/2026-07-27-session-projection-and-command-log.md) 的 registry 約定（`ProjectionDefinition`、`snapshot`、`restore`）零改動，本記錄只為其新增 `subagent` 身份 unit 一個註冊項，並成為 snapshot（live）與 restore（cold）兩處既有讀法的又一消費實例——GUI history 的冷讀已是同款。摺疊規則只在 registry 註冊一份；任何消費面都經 registry 計算，不存在第二份摺疊邏輯。

### `subagent` projection unit

掛在現有 `subagentTiming` 旁（[projection.ts](../../../../packages/subagent/subagent/src/projection.ts)、[projection-types.ts](../../../../packages/subagent/subagent/src/projection-types.ts)），key 為 `subagent`：

```ts ignore-check
export type SubagentIdentityProjection =
  | { mode: 'one-shot'; label?: string; seq: number }
  | { mode: 'continuable'; label: string; seq: number }

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    subagent: SubagentIdentityProjection | null
  }
}
```

- 投影是純身份，**projection 體系不做失敗通道**：unit 永不拋錯；載荷損壞、版本不認識與整日誌沒有描述符一樣，摺疊結果是**可序列化的 null 哨兵**——map 條目為 `SubagentIdentityProjection | null`，非選填、非 undefined/缺 key。理由：registry 的 onChanged 推送經 JSON 序列化，undefined 欄位被 stringify 丟棄，用戶端幀校驗拒收，消費端儲存的舊身份將永不更新；null 完好過幀，消費端以哨兵替換舊身份。判定紀律：消費面把 null 與 undefined（僅 JSON 邊界丟 key 可產生）一律視為無值。「算出來沒有」如何呈現是消費端自己的事（見下文 `listChildren` 四態對映）。
- label 強度由描述符 schema 決定：continuable 的 label 解析強制必有，one-shot 的本就選填；mode/label 判別與下文 child 行的強約定完全一致（行不攜帶 `seq`——它是投影內部的 own-suffix 證明）。
- 身份攜帶 `seq`：折出該身份的 `subagent/descriptor` 事件 seq，兩臂必有、null 哨兵無——`seq >= header.seedLength ?? 0` 證明身份摺疊自 child 自身後綴，而非 fork 種子重播的祖先描述符。state 增 `seq` 使 unit `stateVersion` 升至 2，既存 checkpoint 行按 registry 約定版本失配失效、落權威重摺。
- 摺疊規則：`subagent/descriptor` last-wins，與 `subagentTiming` 同一條 descriptor-reset 紀律——fork 前綴裡的祖先描述符被自身描述符覆蓋。損壞或版本不認識的載荷同樣 last-wins：重設為 null 哨兵而非保留先前身份，健康祖先的 fork 不會繼承自身描述符立不住的身份。

### 枚舉：subagent 自管 live-preferred 合併

`listChildren`（[list-children.ts](../../../../packages/subagent/subagent/src/list-children.ts)）的枚舉不經任何查詢服務：`ctx.sessions.list()` 與 `ctx.get('sessionPersistence')?.list()` 兩個來源按 id 合併，live 記錄整條覆蓋同 id 持久化記錄、不做 header 一致性校驗。枚舉所需全部是 header 事實：

- 過濾：`header.origin === 'subagent' && header.parentSession === parentSessionId`。
- `hasChildren`：同一份合併材料向下看一層——存在 `origin === 'subagent'` 且 `parentSession` 為該 child 的直接後代。
- `activity`：live 記錄為 `running`，僅存在於持久化的為 `inactive`。
- 排序：`createdAt` 升序、再按 child id 升序（與舊約定一致）。
- **persistence 缺席退為 live-only 枚舉，不報錯**：沒有 persistence 的部署，cold child 本就無法 resume，列出 live child 仍然有意義。（對照：舊實作在 sessionQuery 缺失時整體拒絕。）
- persistence 清單失敗使整次枚舉失敗；per-child 隔離只作用於逐 child 的冷讀。

### 取值：三級「算完即止」階梯

對每個枚舉出的 child，mode/label 取值走三級階梯——算完即止，不自建快取、無回寫（第三級與 apiproxy `session.history` 的冷讀同款）：

| 級 | 讀法 | 成本 |
| --- | --- | --- |
| 1：live child | `ctx.sessionProjections.snapshot(session).values.subagent` | 零日誌讀——登錄檔既有水位快取，同步取值 |
| 2：cold child，cache 命中 | 選填 `sessionProjectionCache.cachedSnapshot(header)`，values 含非 null 的 `subagent` 身份且 `identity.seq >= header.seedLength ?? 0` 才直接用——own descriptor 一經追加不可變，seq 門證明該值摺疊自 child 自身後綴，無視行水位 | 零日誌讀 |
| 3：cold child，兜底 | `persistence.inspect(id)` 整讀 + `registry.restore({}, events, 0).snapshot.values.subagent` | 每次清單一次整讀現算 |

- 錯誤約定：`ctx.sessionProjections` 未掛載是設定錯誤，`listChildren` 在枚舉前無條件檢查並以 `SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE` 響亮失敗——零 children 的部署同樣確定失敗，不因清單恰好為空而掩蓋設定問題。工作階段儲存同理：`ctx.get('sessions')`（嚴格全域性讀取，不走呼叫方作用域的屬性代理）缺席以 `SUBAGENT_CONTROL_SESSION_STORE_UNAVAILABLE` 失敗。兩碼的 wire 對映有別：apiproxy 只為 `PROJECTIONS_UNAVAILABLE` 設專門 wire 臉，`SESSION_STORE_UNAVAILABLE` 走通用 internal 兜底——apiproxy 組合自身就 inject `sessions`，該錯誤在其部署不可達，專門對映違反 need 原則。`SUBAGENT_CONTROL_SESSION_QUERY_UNAVAILABLE` 已隨 session-query 相依性刪除。
- cache 是純選填加速層：服務缺席判空跳過——無錯誤碼、不進設定校驗（與 `sessionProjections` 的響亮約定相對）。第二級任何拋錯（包括快取內任一 unit 行中毒使 `viewCheckpoint` 引爆）靜默落第三級——快取是派生資料，其故障不產生 `corrupt` 判決，終審歸權威重摺；checkpoint 切面早於描述符的行，`subagent` key 天然缺席，自動落底，無特判；行裡的 null 哨兵同樣不作數——一律落第三級，由權威重摺裁決。建立視窗內的 count/interval checkpoint 可能把 fork 種子重播的祖先身份落進行——祖先 seq 落在 seed 區間，被 seq 門拒絕，同樣落第三級裁決。
- per-child 隔離：單 child 的 cold 整讀失敗只使該行成為 `unavailable` diagnostic，下次清單自然重試，不影響 sibling（見四態對映）。
- 冷路徑的生命週期見證：preparation 的結果必須仍指向枚舉時的那個生命週期——見證欄位集與舊 SOURCE_CONFLICT 檢查同款七欄位（version、id、createdAt、cwd、parentSession、seedLength、delegationDepth）；同 id 刪除後重新發布的工作階段對舊 parent 的目錄降級為 `corrupt` 行，不外漏新 owner 的 child。
- 冷讀並行以常數 4 有界——它約束的是本機介質的一次只讀掃描而非部署行為；出現聯網 persistence backend 時提升為驗證過的 `Config` 欄位。
- 冷讀成本如實記錄：cache 未掛載或未命中時，cold child 每次清單才付一次整讀，成本與其 transcript 大小成正比；定案「算完即止」，不自建快取。整讀經 `inspect()` 走 [Session 準備階段](2026-08-05-session-preparation.md)的冷讀，同 id 短期重複讀取可命中其 LRU 複用，但清單不相依性此。live child 全程零日誌讀。
- 取消：每次 persistence 讀前後檢查呼叫方 signal，abort 之後才結帳的讀拒絕歸一化為穩定錯誤碼 `CANCELLED`。

### 權威模型

- session log 是唯一權威；本方案不新增任何派生持久化——沒有索引值、沒有自己的 checkpoint、沒有行程 memo；第二級讀取的 `sessionProjectionCache` checkpoint 是既有組合項的派生資料，本方案只讀不寫。取值現算現棄，值的新鮮度就是讀取時點的 live 狀態或持久化 revision（own descriptor 一經追加不可變——快取身份過 seq 門後無過時性問題，門防的是種子重播的祖先身份）。
- Session 與 persistence 寫路完全不感知清單與投影消費：沒有事件監聽回寫，沒有寫時摺疊。
- 枚舉與取值不構成第二個鑒權來源，也不讓尚未發布的 child 可見——兩個來源只見已發布的 live 記錄與已落盤的持久化記錄，與 durable-subagent-catalog 記錄對派生讀面立下的規則一致。

### `listChildren` 行形狀與消費面

`SubagentListEntry` **資料結構與重寫前完全一致**——child 與 diagnostic 兩臂、`kind` 判別、reason 三值、child 臂的 mode/label 強約定全部保留；變化只在診斷的資訊來源：投影體系沒有失敗通道，diagnostic 由清單按投影值缺席與 activity 派生，清單本身零事件解析。「沒有就等待硬讀取」保證階梯對健康資料必然算得出 mode/label。

```ts ignore-check
export type SubagentListEntry =
  | ({
    readonly kind: 'child'
    readonly id: SessionId
    readonly activity: 'running' | 'inactive'
    readonly hasChildren: boolean
  } & (
    | { readonly mode: 'one-shot'; readonly label?: string }
    | { readonly mode: 'continuable'; readonly label: string }
  ))
  | {
    readonly kind: 'diagnostic'
    readonly id: SessionId
    readonly reason: 'corrupt' | 'unsupported' | 'unavailable'
  }
```

對每個枚舉出的 child，階梯取值結果按四態對映成行：

| 階梯取值結果 | 行 |
| --- | --- |
| 快照含非 null 的 `subagent` 身份 | child 行 |
| 快照在、`subagent` 為 null 哨兵或 key 缺席，且 child **inactive** | diagnostic 行，reason `corrupt`（定局殘骸：無、損壞或版本不認識的描述符，不再細分） |
| 快照在、`subagent` 為 null 哨兵或 key 缺席，且 child **running** | 行不出現（建立視窗：描述符尚未追加，與舊實作同視窗 omit） |
| cold 整讀失敗 | diagnostic 行，reason `unavailable` |

- `unsupported` 不再被產出：類型與 wire 枚舉按「資料結構保持現狀」留存該成員，本記錄留檔其為不再產出。
- descriptor-less 定局殘骸從舊實作的 omit 歸入 `corrupt` diagnostic——庫裡的壞、死子工作階段可見，不靜默消失，這正是保留 diagnostic 的原始動機。
- 任一註冊 unit 的 fold/schema 在該 child 日誌上拋錯，同樣收納為該 child 的 diagnostic 行，reason `corrupt`——確定性資料故障，對齊舊實作 `SESSION_QUERY_CORRUPT_SESSION`→`corrupt` 的對映語義；live 與 cold 同待遇，逐 child 隔離，sibling 與清單本身不受影響。它與「無值 + running → omit」正交：建立視窗是「尚無資料」，fold 拋錯是「資料壞了」——running 的中毒 child 也出 `corrupt` 行而非 omit。

已知邊界偏差（有意接受，隨本記錄留檔）：

- 死於發布視窗的 fork child，seed 裡若有祖先描述符，last-wins 會給出祖先身份，誤現為 child 行；復原仍按 own-suffix 摺疊權威失敗（`NOT_RESUMABLE`）。舊實作靠 `seedLength` 過濾將其 omit；projection unit 看不到 header，接受此殘骸級偏差（`subagentTiming` 有同類既有暴露）。
- own suffix 出現多個描述符，舊實作判 corrupt，現 last-wins 取末者（提供方約定本就保證恰一）。
- live/persisted header 衝突，舊實作是 per-child corrupt；現枚舉 live 優先、不做一致性校驗，衝突不再被察覺，以 live 記錄成行。
- 損壞儲存的源讀失敗（如壞 surface 被冷讀整讀拒收），舊實作對映 per-child `corrupt`，現統一成 `unavailable` 行（讀側無從區分成因）。
- 未知 parent，舊實作經 session-query 拋 not-found（「parent session … was not found」）；現自管合併對不存在的 parent 得到空子集，枚舉返回空清單，wire 上後續操作落到 child 級 subagent-not-found——語義與文案的靜默變化，顯式接受。
- rung 2 的更晚事件視窗：cache 行恰在首個自有描述符之後落盤，日誌隨後追加第二個自有描述符（或 malformed 載荷置 null 哨兵），且行程在下一次 checkpoint 前崩潰——此後冷清單的 rung 2 憑 seq≥seedLength 門持續供出行內舊身份（第一個自有描述符的值），與權威重摺（last-wins 第二個）分歧，且 rung 2 命中期間不觸發重摺、無從察覺。邊界三條：①前提是同一 child 出現第二個自有描述符，違反建檔提供方「恰追加一次」約定，屬損壞類資料，與多描述符偏差同族同源；②需「損壞 + 崩潰錯過 checkpoint（turn/end 與 disposal 兩個 mandatory 點及 count/interval 節流點全部未及）」雙條件同時成立；③健康 child（恰一自有描述符）不受影響——seq 門放行的正是唯一真身份。自愈條件：該 child 任一次 live 執行（turn/end mandatory checkpoint）或任何觸發 cache.write 的時點，都會以新 fold 整行覆寫（whole-record replace），rung 2 隨即供正；權威路徑（rung 3 重摺、live snapshot、resume 摺疊）自始正確，分歧只存在於持續冷、行未再更新期間的清單讀。機制修法不採：gate 對帳需知日誌末端 seq，冷路徑零讀不可得；cache 行攜 revision 是 opaque token，無法比較且跨域改 schema——按「cache 永不為權威」總綱歸檔為接受項。

消費面：wire、tool、GUI 的 diagnostic 處理**全部保持原狀零改動**（`list_agents` 的 description 與 output schema 未動；該外掛程式僅載入要求收窄——inject 去掉 `sessionQuery`）。行為上動的只有 apiproxy：路由段的 `hasSubagentDescriptor()` 掃描已刪除，`hasSubagentOwner` 只看 `header.origin`——pre-#1569 的無 `origin` 存量不再被認作 subagent 屬主，其本就不進目錄，pre-release 立場接受；`subagents.history` 與 `session.history` 同源對齊——live child 用記憶體事件與登錄檔水位快照，cold child 用 `inspectServable` 直讀持久化並 detached 摺疊，不經查詢服務，SESSION_QUERY_* 錯誤臂隨之退役，wire 形狀不變（`history` 的 JSDoc 措辭改為 live 記憶體快照／cold 持久日誌雙臂）。

### 改動落點

| 區域 | 文件 | 改動 |
| --- | --- | --- |
| subagent | projection.ts、projection-types.ts、index.ts | 新 `subagent` unit 與註冊 |
| subagent | list-children.ts 及類型 | 重寫為自管枚舉 + 投影階梯四態對映；刪 session-query 相依性、逐 child 事件讀取與就地分類機器；錯誤碼 `SUBAGENT_CONTROL_SESSION_QUERY_UNAVAILABLE` 換 `SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE`；新增選填相依性 dsh-session-projection-cache（純加速讀取，缺席跳過） |
| host/apiproxy | api-proxy.ts | 刪 `hasSubagentDescriptor`，屬主判定只看 `header.origin`；`subagents.history` 與 `session.history` 同源——live 用記憶體事件與登錄檔水位快照，cold 用 `inspectServable` 直讀持久化並 detached 摺疊，不經查詢服務，SESSION_QUERY_* 錯誤臂隨之退役 |
| tool | tool-subagent-control/list-agents.ts | 載入要求收窄（inject 去 `sessionQuery`）；model-visible schema、描述與渲染零改動 |
| wire/client | api/subagents.ts、runtime sessions/service.ts、GUI | 類型、行形狀與 diagnostic 處理**零改動**；api/subagents.ts 僅 `history` 的 JSDoc 措辭改為雙臂 |
| core/session、session-persistence、session-projection(-cache)、session-query(-sqlite) | — | **零改動** |

## 考慮過的替代方案

**mode/label 進 SessionHeader。** 零讀保證最強——清單只看 header 就能成行。但 header 形狀變更傳導兩個 persistence backend 與 header 相容檢查；SQLite 存量直接拒收，JSONL 存量只能 unknown 降級或 backfill。讀時現算對存量的答案是「第一次清單一次 `inspect` 現算」，不碰持久格式。

**projection-cache 階梯（`cachedSnapshot ?? coldSnapshot` 加 fail-soft 寫回）。** 機製成立——session-projection-cache 的 checkpoint 階梯本就為冷讀設計。但 checkpoint 寫回是一套由清單驅動程式的派生資料持久化與失效編排（floor/identity/putSoft）；被否的是這套編排作為主機制。定稿的第三級階梯後來以只讀方式機會性複用該快取作第二級——無寫回、無編排、缺席即跳過。

**給 persistence 加有界讀原語搶救存量。** 為一次性問題新開 persistence 原語；被讀時 `inspect` 整讀取代——存量第一次被清單時的整讀就是取值本身。

**list 行 mode/label 選填化。** 健康資料必然可算；選填化只是把垃圾資料的處理複雜度外溢給全部消費端——每個消費面都要長出過濾分支和 unknown 展示態。強約定加算不出即 omit 更乾淨。

**徹底刪除 diagnostic 行。** 刪除把庫損壞的可見性外溢為行靜默消失，wire/tool/GUI 反要各自承擔約定與快照變更；而保留只需清單側按投影值缺席與 activity 派生分類，零成本。庫裡的壞、死子工作階段必須可見是 diagnostic 存在的原始動機，保留後消費面整體零改動。

**registry 計算失敗通道（per-unit 容錯加 `failures` 附加欄位）。** 為把損壞、版本不認識報告給消費端，由 registry 捕獲 unit 例外並在 snapshot 旁附 per-key 失敗態。被否：failure 不是值，也不必是通道——unit 永不拋錯，缺席本身就是訊號，「大不了算出來沒有」，如何呈現是消費端要考慮的事。一個獨立觀察：vendor cordis 的 `emit`（[vendor/cordis/src/events.ts](../../../../vendor/cordis/src/events.ts)）對 listener 拋錯零捕獲，投影驅動程式掛在 `session/event` 上時 unit 例外會沿 emit 逃逸——這加重了「unit 永不拋錯」紀律的分量，但 emit 容錯的修復不屬於本記錄範圍。

**值隨 query 索引 preparation 落庫。** 投影值在 sqlite backend 的對帳重建裡摺疊落進 session 索引行，讀穩態零日誌：`projectionsFor` 批次讀面、行值隨 `(key → stateVersion)` 註冊集儲存的失效對帳與 SCHEMA bump。整體退役：方向反了——查詢基礎設施被迫認識領域詞彙（投影列、註冊集對帳），而唯一消費端 subagent 清單讀時現算即可滿足；消費端歸零後，這套派生持久化沒有存在理由。`SESSION_QUERY_PROJECTIONS_UNAVAILABLE` 隨讀面一並刪除。

**subagent 手工 parse 加行程 memo 加建立播種。** 為摘除 session-query 相依性，由 subagent 包自己解析描述符事件、以行程內 memo 避免重複整讀、建立時播種初值。被已交付的階梯取代：live 走 `sessionProjections` 水位快取、cold 走 `registry.restore`，複用 registry 這一份摺疊權威，不再出現第二份描述符解釋邏輯，也不引入行程態快取與播種時序。

**session-query 輸出面 DeepReadonly（讀路徑改造實驗）。** 公開查詢輸出深只讀化，以在類型層面釘死不可變借用。實證否決：3 處 TS2589（類型實例化過深）加 17 處陣列位傳染（消費端陣列方法與展開處被迫跟改）；深層不可變由 core/session 的執行時期深凍結保證，該讀路徑改造未納入本記錄。

## 驗證

`packages/subagent/subagent/tests/list-children.spec.ts` 重寫為本約定：無 persistence、query 服務與繼續執行時期的 live-only 清單；registry 缺席時零 children 也響亮報 `SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE`；live child 全程零 `inspect`、cold child 每次清單恰一次；多描述符 last-wins 取末者；損壞載荷與未知版本折為 `corrupt`；冷讀失敗對映 `unavailable` 且下次清單重試；fork seed 裡的祖先描述符按該身份成行（偏差一釘住）；普通 fork 與無 subagent origin 的後代不入列也不計入 `hasChildren`；`createdAt`→id 排序；提供方未掛載不影響清單；壓縮與未壓縮孿生一致；預中止、持久化清單與冷讀取消三例歸一 `CANCELLED`；空清單與穩定錯誤碼。敵意 unit 雙路探針（`apply` 惰性置毒、`view` 引爆）證明任一註冊 unit 在該 child 日誌上的 fold/schema 拋錯，在 live 與 cold 兩條取值路徑上都收納為該 child 的 `corrupt` 行，sibling 與清單本身不受影響。第二級例：own-seq 身份直用零 `inspect`、fork 種子祖先身份（seq 落在 seed 區間）被門拒絕落底、行內無身份（null 哨兵或 key 缺席）落底、cache 服務缺席落底、快取行中毒靜默落底重摺；冷路徑 lifecycle 篡改按見證七欄位逐一（`it.each`）降級為 `corrupt`。`tool-subagent-control` 的 list-agents 測試隨載入要求收窄更新；`optional-session-query.spec.ts` 隨相依性消失刪除；既有無金鑰快照（`subagent-list-agents` 等）零變化，釘住健康路徑的 wire 與 model-visible 面不變；新增無金鑰快照 `subagent-diagnostic`（examples/headless-agent）釘住四態對映的診斷分類——descriptor-less 定局殘骸成 `corrupt` 行等模型可見變化。

## 後果

- live child 的清單全程零日誌讀；cold child 在 cache 未掛載或未命中時每次清單一次 `inspect` 整讀，成本與其 transcript 大小成正比、隨清單頻率重複——定案「算完即止」，不自建快取、不回寫，同 id 短期重複整讀可命中準備階段 LRU 但清單不相依性它。
- subagent 清單不再要求 query backend：純 live 與無 persistence 的部署都能清單；`SUBAGENT_CONTROL_SESSION_QUERY_UNAVAILABLE` 消失，`list_agents` 外掛程式載入不再要求 `sessionQuery`。
- 身份解釋只存在於 registry 註冊的一份 unit：清單三級階梯與 GUI history 冷讀走的都是 registry 與 cache 的既有讀法（snapshot、cachedSnapshot、restore），不存在旁路摺疊；若未來某消費面繞開 registry 手寫摺疊，各讀面的值將漂移——這是本設計要求維持的紀律，不是機制保證。
- per-child 隔離回歸：單 child 冷讀失敗只損失該行，healthy sibling 不受影響；persistence 清單失敗仍使整次枚舉失敗。
- 診斷與枚舉語義留下六處邊界偏差（stillborn fork 祖先身份誤現、多描述符取末者、header 衝突不再被察覺、損壞源讀失敗由 `corrupt` 轉 `unavailable`、未知 parent 由 not-found 改為空清單、rung 2 更晚事件視窗），完整語義見已知邊界偏差清單；前四處為殘骸級資料的展示或分類偏差，未知 parent 一處是查詢語義的靜默變化，rung 2 視窗一處是損壞加崩潰雙條件下可自愈的快取供值分歧；復原鑒權均不受影響，顯式接受。
- pre-#1569 的無 `origin` 存量不再被認作 subagent 屬主；其本就不進目錄，pre-release 無相容承諾。

## 相關

- [durable-subagent-catalog 與 list_agents](../feature/2026-07-22-durable-subagent-catalog-and-list-agents.md)——被本記錄部分取代：描述符仍是 mode/label 的持久權威與摺疊輸入，清單的枚舉與取值改為自管合併加投影階梯。
- [session projections 與命令生命週期日誌](../../proposed/architecture/2026-07-27-session-projection-and-command-log.md)——registry 約定的權威；本記錄為其新增 `subagent` 身份 unit，並成為 snapshot/restore 兩處既有讀法的消費實例。
- [web subagent conversations](../feature/2026-07-27-web-subagent-conversations.md)——`SessionHeader.origin` 的出處（#1569），身份判定去日誌化的前半步；其 history 冷讀（inspect 前綴加 registry 摺疊）是本記錄取值階梯的同款先例。
- [發布前可複用的 Session 準備階段](2026-08-05-session-preparation.md)——`inspect()` 冷讀與 LRU 複用；cold child 整讀的成本模型建立其上。
