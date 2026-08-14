# Agent Note: 事件詞彙的執行時期 schema（Zod 與 merge-extensible-map 模式之辯）

Status: proposed

[English](2026-06-16-typed-event-schemas.md) | [简体中文](2026-06-16-typed-event-schemas.zh.md) | 繁體中文

## 問題

harness 將其核心詞彙——內容區塊、訊息來源、結束原因、輪次觸發器、輪次結束原因與工作階段事件——建模為 **merge-extensible map**：一個 TypeScript `interface`（如 `SessionEventMap`、`ContentBlockMap`），外掛程式透過聲明合併對其擴充，公開聯合類型則以 `Map[keyof Map]` 派生。這是本倉庫的通用擴充模式，記錄在 [docs/architecture.md](../../../../docs/architecture.md) 中（「The same merge-extensible-map pattern is used for `MessageSource`, `FinishReason`, `TurnTrigger`, and `TurnEndReason`」），`defineTool` 的 `InferArgs` DSL 和 `assertNever` 窮舉約定都相依性於它。

該模式**僅存在於編譯期**。類型在執行時期消失：沒有 schema 對象可供校驗傳入值、解析不可信輸入或在執行時期枚舉變體。[工作階段持久化約定](../../implemented/architecture/2026-06-14-session-persistence.md)暴露了兩個後果：

1. **持久化將 `event.data` 視為不透明 JSON。** JSONL/SQLite 後端對每個事件原樣執行 `JSON.stringify`/`JSON.parse`；唯一的執行時期守衛是 `isJsonValue`（往返可序列化性檢查：拒絕 BigInt、函式、迴圈引用、非有限數等），而非結構校驗。一個損壞但仍為合法 JSON 的事件資料（欄位類型錯誤、欄位缺失）會靜默往返，只有在後續消費端的 `switch` 中才可能被捕獲。
2. **外掛程式新增變體沒有執行時期約定。** 一個透過聲明合併新增新 `SessionEventMap` 鍵的外掛程式，在自身程式碼中獲得了編譯期類型，但沒有任何機制校驗它產出的值是否符合它所聲明的形狀——無論是在生產者處、持久化邊界處還是重新載入時。

由此引出問題：事件詞彙是否應遷移到 **Zod** 或其他執行時期 schema 庫，使持久化邊界和外掛程式邊界擁有執行時期 schema 而非被擦除的類型。

## 為什麼這不是一個持久化層的改動

很容易把「用 Zod 做序列化」理解為對 `dsh-session-persistence-jsonl/src/format.ts` 的區域性修改。但它不是，原因在於一個結構性事實：**外掛程式無法對 Zod schema 進行聲明合併。** 聲明合併是 TypeScript 編譯期機制；Zod schema 是執行時期值。要用 Zod 校驗事件，就需要一個**執行時期登錄檔**，每個產出事件的包向其貢獻自己的 schema（如 `ctx.sessionEvents.register('compaction/marker', z.object({…}))`），每個消費端從中讀取。這個登錄檔——而非持久化後端——將成為詞彙的真源，取代 merge-extensible 介面。

因此，真正的提案是：**用執行時期 schema 登錄檔替換編譯期的 merge-extensible-map 模式，範圍覆蓋整個倉庫。** 這是一次核心詞彙的重新設計。

## 影響範圍（已度量）

將事件/詞彙介面遷移到執行時期 schema，至少涉及：

- **六個 merge-extensible map**（約 370 行核心類型）：`ContentBlockMap`、`MessageSourceMap`、`FinishReasonMap`（位於 `dsh-llm`）；`TurnTriggerMap`、`TurnEndReasonMap`、`SessionEventMap`（位於 `dsh-session`）。
- **約 10 處 `declare module` 聲明增補位置**，分佈在 `dsh-agent`、`dsh-agent-loop`、`dsh-shell`、`dsh-llm`、`dsh-session`、`dsh-session-persistence`、`dsh-system-prompt`、`dsh-tools` 各包中——每處都將從聲明合併改為執行時期 `register()` 呼叫。
- **事件生產者**——agent loop（代理循環）中 16 處 `session.append(...)` 呼叫——形狀不變，但現在在邊界處被校驗。
- **約 7 個 switch 消費端**，對這些聯合類型進行分支：`deriveMessages` 與包自有的不變式 companion（`dsh-session`）、`BlockAssembler`（`dsh-llm`）、兩個 LLM（大型語言模型）配接器（`dsh-llm-deepseek`、`dsh-llm-pi-ai`）以及工具 schema 層（`dsh-tools`）。`assertNever` 對封閉聯合類型的窮舉 vs 對可擴充聯合類型的 fall-through 約定（一條已記錄的 lint 規則）需要重新考量——執行時期變體在靜態層面不可窮舉。
- **`defineTool` 的 `InferArgs` DSL**（`dsh-tools`），它從編譯期 schema 規範派生出零類型轉換的 `execute` 參數類型——這是當前方案的標杆用例。
- **文件**：architecture.md（該模式被描述為基礎性的）、[開發模式不變式](../../implemented/architecture/2026-06-11-dev-invariants-over-deep-readonly.md)，以及所有引用該模式的 Agent Note。

這是一次倉庫等級的詞彙重新設計，而非持久化的實作細節。

## 曾考慮的替代方案

### A. 維持現狀——merge-extensible 類型 + 持久化邊界處 `isJsonValue`
保留編譯期模式。持久化繼續使用不透明 JSON + 可序列化性守衛。外掛程式透過聲明合併擴充；事件 *形狀*的正確性由生產者負責，並由 TypeScript 在編譯期保證。啟用包自有的不變式 companion 後，它們會檢查選定的跨記錄關係，但不提供通用執行時期形狀 schema。

- **優點**：零變動；外掛程式擴充只需一行 `interface` 增補，享有完整類型推斷，無需執行時期註冊儀式；無新執行時期相依性；`defineTool` DSL 與 `assertNever` 窮舉繼續工作。
- **缺點**：持久化邊界和外掛程式邊界處無執行時期結構校驗；格式錯誤但仍為合法 JSON 的資料被延遲捕獲。

### B. 僅對頭部/封閉形狀做校驗（schemastery），事件仍為不透明
僅對那些已有手寫類型守衛的真正封閉形狀加以收緊——例如 JSONL 的 `HeaderLine` 守衛（`isHeaderLine`）——使用 **schemastery**（倉庫現有的 schema 庫，已用於每個外掛程式的 `static Config`）。merge-extensible 事件聯合類型保持不變。

- **優點**：改動小，契合現有約定（schemastery，而非新庫）；用聲明式 schema 替換封閉形狀上的手寫守衛；無核心重新設計。
- **缺點**：不解決事件資料校驗問題；僅固定的元資料記錄得到改善。

### C. 為整個詞彙建立執行時期 schema 登錄檔（Zod 或 schemastery）
用執行時期登錄檔替換 merge-extensible map，生產者向其貢獻 schema，持久化/消費路徑據此校驗。

- **優點**：持久化邊界和外掛程式邊界處獲得真正的執行時期校驗；單一真源；可支撐通用工具（自動生成文件、模糊測試、協定格式（wire format）檢查）。
- **缺點**：上述全部影響範圍；**Zod 目前不是直接相依性**（僅作為 `@earendil-works/pi-ai` 的傳遞相依性），倉庫選定的 schema 庫是 **schemastery**——廣泛引入 Zod 本身就是一個相依性決策；聲明合併的易用性（一行外掛程式擴充、完整推斷）被執行時期註冊 + 手動類型接線取代；`assertNever` 窮舉保證弱化（執行時期變體在靜態層面不可窮舉）。

## 提案

推遲。如果需要在持久化邊界做執行時期校驗，**方案 B**（對封閉的頭部和元資料形狀使用 schemastery）是現有約定下的適度步驟。**方案 C** 是一個架構決策，需要自己的實作 Agent Note，其中包括 Zod 與 schemastery 之間的選擇。

## 驗收標準

- 方案 C 只能透過自己的實作 Agent Note 推進，絕不能作為持久化的附帶改動。
- 如果採納方案 B，封閉的頭部/元資料形狀（JSONL 的 `isHeaderLine` 守衛及同類）改用 schemastery 校驗，替代手寫守衛，merge-extensible map 保持不動。

## 風險

- 推遲意味著事件 `data` 在持久化邊界處仍無結構校驗：格式錯誤但仍為合法 JSON 的資料被延遲捕獲，由消費端的 `switch` 兜底——這是現狀的代價，有意接受。
- 如果方案 C 最終被採納，易用性的損失是真實的：一行聲明合併變為執行時期註冊加手動類型接線，`assertNever` 的靜態窮舉保證弱化。

## 待解問題

- 如果採用登錄檔，庫選 **schemastery**（已在倉庫中，已作為設定 schema 庫）還是 **Zod**（生態更豐富，目前僅為傳遞相依性）？同時維護兩個 schema 庫本身就是一種成本。
- 能否採用混合方案：保留編譯期推斷（使 `defineTool` 和外掛程式開發體驗不受影響），同時為每個變體新增*選填*的執行時期 schema，僅在持久化/協議邊界校驗，而非每次行程內 append 都校驗？
- `ctx.invariants` 服務啟用後是否已覆蓋了足夠多的執行時期形狀缺口，使得邊界校驗僅在面對真正不可信輸入（重新載入外部修改過的日誌）時纔有必要？
