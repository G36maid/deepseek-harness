# Agent Note: 工作階段 surface：事件日誌上的有序投影

Status: implemented

[English](2026-06-18-session-surface.md) | [简体中文](2026-06-18-session-surface.zh.md) | 繁體中文

## 問題

事件日誌是權威資料源，但歷史操縱此前沒有持久化的共享機制。如果沒有這樣的機制，上下文壓縮（context compaction）等外掛程式會透過順序敏感的監聽器改寫派生請求，卻不記錄每次替換使用了哪些事件。每次新增歷史操縱時，還必須修改 `deriveMessages()`。

## 決策

新增一個 **surface**：事件 seq 的派生並快取的有序投影（即產出 LLM（大型語言模型）訊息的事件子集），透過事件日誌中的 `surfaceOp` 標記維護。

### `SessionEvent` 新增兩個頂層欄位

每個 `SessionEvent` 獲得兩個選填欄位（結構性元資料，與 `seq`/`time` 同級）：

- **`sourceEventSeqs?: number[]`**：被引用為資料來源的早期事件 seq 編號（例如構成 `assistant/message` 的各 `assistant/chunk` 的 seq，或被壓縮標記遮蔽的 surface 節點）。出現的 `[]` 只在 `assistant/message` 上有效，表示已知為空的提供方流；舊格式或外部事件缺少該欄位時，沒有記錄這則訊息由哪些早期事件產生。其他 surface 事件一旦出現此欄位，就必須是非空清單。如果沒有這些引用的 seq，重播就無法驗證 replace-range 操作是否列出了它移除的每個事件。
- **`surfaceOp?: SurfaceOp`**：該事件如何進入 surface。非 surface 事件不攜帶此欄位。

### SurfaceOp：兩種操作

```ts
export type SurfaceOp =
  | 'append'                                    // normal tail append
  | { op: 'replace'; start: number; end: number }  // shadow [start, end] inclusive
```

1. **Append**：在尾部追加新事件的 seq。`user/message`、`assistant/message`、`tool/result`、`context/message` 使用此操作。agent loop（代理循環）在所有此類追加上傳入 `surfaceOp: 'append'`，並在適用時記錄 `sourceEventSeqs`：每個成功的 `assistant/message` 都記錄完整的 `assistant/chunk` 來源集合（包括 `[]`），而 `tool/result` 記錄其 `tool/call` 來源。

2. **Replace**：移除從 `start` 到 `end`（兩端包含）的條目，並在其位置插入新事件的 seq。`start` 和 `end` 都必須存在於當前 surface；`start === end` 表示替換單個條目。該事件的 `sourceEventSeqs` 必須包含所有被遮蔽的 surface seq。被遮蔽的事件仍留在日誌中，但不再出現在 surface 上。

### SurfaceManager：基於增量，而非全量重建

一個 `Session` 擁有一個 `SurfaceManager`，後者維護事件 seq 的有序 `number[]`。管理器會在提交前校驗每個種子或追加候選項而不應用它，然後只處理上次同步之後已經提交的事件，而不重新掃描整個日誌。`Session.surface` 透過只讀的 `SessionSurface` 約定暴露同一個管理器，因此接納、派生歷史、壓縮與工作區上下文共享同一份增量狀態。Replace 按陣列位置定位兩個端點（均包含在範圍內），並把替換 seq splice 到該範圍；不會用第二個管理器、連結對象或 seq 到節點的 map 來重複表達順序。

無新事件時增量處理為 O(1)，有新事件到達時為 O(新事件數)。

`deriveMessages()` 在存在 surface 標記時使用 surface，對沒有標記的工作階段回退到既有的線性掃描（向後相容）。

### 持久化

新欄位作為頂層 JSON 屬性序列化。JSONL 後端無需任何改動：`JSON.stringify`/`JSON.parse` 透明地保留一切。SQLite 後端的 `events` 表新增兩個可空 TEXT 列（`source_event_seqs`、`surface_op`）。磁碟上的 `SCHEMA_VERSION` 遞增以反映列集變化，並且按照預發布的 bump-and-reject 策略，由其他建置寫入的資料庫在打開時被拒絕而非遷移（沒有需要升級的持久化使用者資料）。工作階段格式 `version` 固定為 `SESSION_FORMAT_VERSION = 0`（「不穩定/預發布」立場）：選填的 surface 欄位被吸收而不遞增版本號。

### 當機復原

`repair.ts` 模組在崩潰後為孤立的工具呼叫合成 `tool/result` 閉合事件。這些閉合事件攜帶 `surfaceOp: 'append'` 和指向孤立 `tool/call` 事件的 `sourceEventSeqs`，確保重建的 surface 有效。

### 不變式

`Session` 在始終啟用的 seed/append 邊界校驗 `sourceEventSeqs` 與 `surfaceOp`：只有 `assistant/message` 可以使用空的源事件清單；引用必須唯一、更早且已知；替換端點必須存在於 surface 順序中；`sourceEventSeqs` 必須覆蓋每個被遮蔽的節點。這些是單記錄接納與儲存投影規則，不是由選填的不變式服務提供的規則。

每個可進入 surface 的事件都必須攜帶 `surfaceOp`，否則它將從派生歷史中消失。類型化的 `append` 重載對字面事件類型強制執行此規則；`append` 和種子構造函式中的執行時期檢查覆蓋寬化聯合類型和載入的日誌。按照預發布格式策略，無效的種子被拒絕而非升級。

## 曾考慮的替代方案

- **逐外掛程式的 `agent/request` 包裝**（surface 之前的歷史操縱模式）：監聽器排序脆弱、無法持久記錄改動內容，且每種新操縱都迫使核心 `deriveMessages()` 再次修改。
- **半開區間 `[start, endExclusive)` 的 replace 範圍**：否決。端點由 surface 事件 seq 命名，單條目替換（`start === end`）在閉區間語義下讀起來更自然。
- **連結節點對象加 seq map**：否決。生產程式碼不讀取前驅連結，唯一的後繼用途就是陣列中的下一個位置，而替換本來就需要線性 `indexOf` 尋找。單個 seq 陣列在保留相同漸進複雜度的同時，只留下一個需要校驗的表示。
- **髒標記後全量重建**替代增量處理：在工作階段生命週期內為 O(N²)，每次單事件追加都要重新掃描所有先前事件。

## 後果

- **`packages/core/session`**：`surface.ts`（`SurfaceManager`）維護一個用於候選接納和即時投影的有序 seq 陣列；`SessionSurface` 是其只讀公共檢視表。`SurfaceOp`/`SurfaceIntent` 與頂層工作階段事件欄位記錄條目如何加入它。`append()` 要求 surface 事件攜帶 `SurfaceIntent`，`deriveMessages()` 以遍歷 surface 作為唯一派生路徑，`repair.ts` 則寄出 surface 感知的閉合事件。種子構造函式拒絕缺少 `surfaceOp` 標記的可進入 surface 的種子事件（見「不變式」一節）。
- **`packages/core/agent-loop`**：所有涉及 surface 事件的追加操作都傳入 surface 選項。每個 `assistant/message` 都引用產生它的區塊 seq；每個 `tool/result` 都引用它的 `tool/call` seq。
- **`packages/session/session-persistence-sqlite`**：`events` 表新增兩個可空 TEXT 列（`source_event_seqs`、`surface_op`）；`SCHEMA_VERSION` 遞增（bump-and-reject，無遷移）。
- **`packages/session/session-persistence-jsonl`**：無需改動。
- **`packages/session/session-persistence`**：抽象介面不變。

surface 是歷史操縱賴以落地的基礎——dsh-compaction 的壓縮就搭載於其上。壓縮或 tool-result-pruner 外掛程式追加一個既有的訊息產出事件類型（例如一條攜帶摘要的 `user/message`），附帶 `surfaceOp: { op: 'replace', start, end }` 和覆蓋被遮蔽條目的 `sourceEventSeqs`——新事件在 surface 上取代該範圍的位置，而外掛程式自身的 trace 事件（如 `compaction/start`、`compaction/end`）不進入 surface。重播以確定性方式保留該決策。

一次 `tool/result` 替換只能改寫當前的一個 `tool/result`，並且必須保留除 `content` 以外的每個資料欄位。Session 接納會與位置範圍和引用的源事件校驗一起強制這條規則，不相依性選填的診斷外掛程式。
