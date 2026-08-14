# @deepseek-ai/dsh-code-runtime-worker-thread

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

這是 [`@deepseek-ai/dsh-code-runtime`](../code-runtime/README.md) seam 的 worker 執行緒實作：`WorkerThreadCodeRuntime` 會在每次執行中使用一個全新的 Node `worker_threads.Worker`，輸入 TypeScript，由宿主側剝離類型，透過訊息埠橋接綁定，輸出 `{ value, logs, error? }`。**這是隔離措施，而非安全邊界**：其信任立場有意與 bash 等價（參見 [Code Mode Agent Note](../../../.agents/notes/implemented/feature/2026-06-15-code-mode.md) 的 Trust posture 章節），但提供 bash 沒有的隔離：獨立 isolate、空環境、堆上限與強制終止。

## 設定

```yaml
- id: code-runtime
  name: '@deepseek-ai/dsh-code-runtime-worker-thread'
  config:
    computeMs: 60000              # busy-time budget (measured event-loop active time)
    maxWallMs: 600000             # wall-clock ceiling; never pauses for anything
    maxOutputBytes: 67108864      # combined serialized outer-output cap (64 MiB)
    maxOldGenerationSizeMb: 512   # worker heap cap (resourceLimits)
```

每個欄位都會驗證並提供預設值；`maxOutputBytes` 必須是至少 4 位元組的安全整數，其餘欄位必須是有限正數，`maxWallMs` 還必須不超過 `2147483647`（Node 的 `setTimeout` 最大延遲），此外沒有其他可調項。

## 設計

- **每次執行使用一個全新 worker，不設池化**：程序所在的世界會隨 worker 一同終止，不會留下需要記錄的跨執行狀態，也無法發生狀態洩漏；僅憑工作階段日誌即可重建執行。
- **在執行上下文中，由宿主側剝離類型**：程序會包裹在非同步函式外殼中，透過 `node:module` 的 `stripTypeScriptTypes` 剝離類型（只支持可擦除文法；`enum`／namespace 會作為程序 `exception` 被拒絕，且不會啟動 worker），再按位元組位置切回原內容。之後程序作為 `AsyncFunction` 的函式體執行，因此頂層 `await`／`return` 可用。
- **埠把對端視為不可信**：模型程式碼能夠訪問 `parentPort` 並偽造通訊，因此任何程式碼讀取入站訊息前，系統都會驗證其形狀並重新建置（`null`、原始值、無效類型和格式錯誤的載荷會被靜默丟棄；偽造的額外欄位絕不會被帶入）；宿主對每個呼叫 id 最多回應一次，只將綁定名稱解析為自有屬性（偽造的 `constructor` 無法沿原型鏈訪問），丟棄結帳後的回覆，並驗證每個綁定 resolve 值與完成值是否為無損 JSON。偽造的 `log`／`done` 訊息無法繞過外層上限：宿主會再次驗證，並統計每條獲準日誌以及完成值或診斷。worker 側命名空間使用 null-prototype 和 `defineProperty`，因此形似 `__proto__` 的綁定名稱只是普通鍵。
- **綁定呼叫被拒絕時使用的例外類屬於請求資料**：選填命名空間描述符會指定構造器全域性變數，以及用於接收呼叫失敗的成員名稱的自有屬性。worker 會建立並注入該真實類，使 `instanceof` 生效，同時無需硬編碼 `tools` 或 `ToolCallError`；全域性變數無效或衝突的聲明會在啟動 worker 前失敗。失敗路徑使用模組捕獲的錯誤 intrinsic 與屬性定義 intrinsic，以及 null-prototype 描述符，因此模型之後的修改無法把被拒絕的綁定變成 worker 崩潰。
- **兩個獨立預算，因為對端不可信**：`computeMs` 統計 worker 實際測得的忙碌時間（輪詢 `worker.performance.eventLoopUtilization()`）；熱迴圈無法藉助待完成的誘餌 dispatch 隱藏，程序等待慢工具時則不累計。`maxWallMs` 為忙碌時間無法觀測的情況兜底（例如等待永遠不會 resolve 的 promise）。二者最終都會呼叫 `worker.terminate()`，連同步熱迴圈也能終止；堆溢位會表現為 worker 的 OOM 退出（`kind: 'worker-exit'`）。`maxWallMs` 在載入時會對照 `MAX_TIMER_DELAY_MS` 做範圍校驗：`setTimeout` 會把更長的延遲限制為 1 ms，僅有正數校驗會放行一個在第一個 tick 就到期的上限。`computeMs` 不需要這道上界，因為它對照的是實測佔用率，而不是喂給定時器。
- **中間綁定值是完整 JSON**：綁定參數與 resolve 值會接受迭代式無損 JSON 驗證。程序執行前，worker 會捕獲自己 realm 中的普通容器原型身份，以及只用於外部 realm 的原生函式原始碼檢查，因此構造器槽修改和使用者編寫的仿冒對象都無法改變容器分類。它還會捕獲該 JSON 邊界使用的每一個結構與計量 intrinsic，以無原型對象建立屬性描述符，並繞過可變集合原型管理私有遍歷狀態；因此，模型對全域性對象、原型方法或 `Object.prototype` 上形似描述符欄位的修改，都無法改變驗證、wire 傳輸或位元組計量。值會展平為自身巢狀深度有界的前序 wire 值，供 structured clone 使用，並在另一側迭代式重建。它們沒有位元組、JavaScript 呼叫棧或巢狀 structured-clone 深度上限，絕不會進入外層輸出帳本或模型上下文；上限仍來自提供方／執行器取得限制與行程／worker 記憶體。
- **日誌主動流入一個外層帳本**：console／stdout／stderr 文字按產生順序經埠傳輸，因此逾時或被終止的程序仍會顯示已經列印的內容。worker 會精確統計 JSON 字串的位元組數，並在傳送完成值和例外診斷前，根據組合預算的剩餘量預檢；因此，拋出的百萬位元組 stack 會在 worker 邊界變成固定的 `output-limit` 診斷。繞過修補程式 stream 槽的原生寫入會到達獨立於完成埠的 pipe，因此宿主會針對這些位元組和不可信偽造通訊再次執行帳本統計；在物化結果前，結帳過程會持續進行有界 pipe 捕獲，直到 worker 完成終止。`maxOutputBytes` 統計外層 `logs` 陣列加完成值或失敗訊息載荷的 JSON 序列化；固定的 `CodeRunResult` 欄位名、花括號、有界錯誤 kind 標籤，以及後續呈現空白不計入這份可變載荷帳本。未超過上限時會返回精確值；有損完成值屬於 `invalid-output`，組合溢位屬於 `output-limit`，不會用 inspected string 代替。失敗會保留能容納的已捕獲前綴，之後按普通外層 `run_code` 落盤策略處理。
- **空環境**：worker 使用 `env: {}` 和 `execArgv: []`，既不會獲得環境變數中的憑據（比 spawn 命令的清理環境規則更嚴格），也不會繼承 loader 標志。
- **dispose（資源釋放）時等待完全靜止**：清理會使進行中的執行以 `abort` 失敗，並會等待每個 worker 退出後再完成。

## 未建置與已建置的 worker 入口

原始碼模式透過 Node 原生類型剝離載入只包含可擦除文法的 `src/worker.ts`。其傳遞執行時期閉包只包含 Node 內建模組和相對源模組，因此全新 checkout 絕不需要兄弟工作區包尚未建置的 `lib/` 匯出。worker 本機和工作階段自有的 JSON 邊界都會在訊息埠兩側展平並重建已驗證值，使應用巢狀永遠不會進入 structured clone。建置模式會把兄弟文件 `lib/worker.cjs` 作為檔案系統路徑傳入，因為 pkg 的虛擬檔案系統（VFS）Worker hook 要求 CommonJS；同一路徑也可在普通 Node 下使用。對這個已發布入口路徑進行測試的倉庫級要求由[測試策略](../../../docs/testing.md)規定。

SDK 對外提供默認及具名匯出的 `WorkerThreadCodeRuntime` 類，以及 `Config`。執行所用的 `./worker` 子路徑僅作為打包後的 spawn 入口存在；wire 協議與啟動輔助模組是原始碼私有的實作細節。

## 模型體驗

透過 [`dsh-tools`](../../core/tools/README.md) 中的 Code Mode 間接提供；如果外層值能容納則原樣渲染，否則返回明確的 `invalid-output`／`output-limit` 失敗。只有外層 `run_code` 結果進入模型上下文並使用普通落盤策略；綁定通訊與中間值始終只存在於執行環境中。

#### KV Cache 影響

不會直接失效；由上述消費端負責請求前綴變更。

## 已知限制與暫緩事項

- **程序派生的 OS 行程在程序終止後仍會存活**：`worker.terminate()` 只結束執行緒，比 bash-local 的行程組終止更弱；在容器後端出現前，孤兒行程清理屬於部署職責。
- **類型剝離相依性 Node 的實驗性 `stripTypeScriptTypes` API**：如相依性的行為發生變化，amaro 或 sucrase 是已經點名的直接替代品。
- **`computeMs` 到期最多可能超過一個輪詢間隔**：系統每 25 ms 取樣一次忙碌時間（內部常數，有意不做成設定）。
- **程序獲得一個含 5 個方法的 `console` shim**（`log`／`info`／`warn`／`error`／`debug`）：有意不提供 Node 的完整 console 介面。
- **中間綁定值沒有位元組上限**：程序可以用永遠不會成為外層輸出的值耗盡行程或 worker 記憶體。
- **默認 64 MiB 是拒絕邊界，不是可復原儲存**：外層落盤只能保存發生 `output-limit` 後返回的有界日誌和診斷；在執行時期上限之外被拒絕的位元組永遠不會到達落盤層。
