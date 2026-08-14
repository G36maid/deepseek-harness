# @deepseek-ai/dsh-jobs

[English](README.md) | 繁體中文

背景工作登錄檔約定（`ctx.jobs`）。抽象的 `JobRegistry` 及其詞彙類型在同一份約定下為長時間執行的生產方提供共享 id、owner 隔離、讀取、取消、等待、通知和清理；行程區域性登錄檔位於 [`dsh-jobs-local`](../jobs-local/README.md)。生產方外掛程式使用其不透明 id namespace 擴充 `JobKindMap`。

## 服務約定

- `start(spec): JobId` 驗證已附加的任務控制器、spec、確切且仍存活的 owner、選填的正數 `outputLimitBytes`，以及 Service Provider 所擁有的准入策略，然後只調用生產方的 `run()` 一次。預檢拒絕或啟動方拋出例外時都不會生成 job id 或註冊工作；成功返回會直接提交，不再執行其他可能失敗的步驟。
- `get(id, caller?)` 和 `list(caller?)` 返回非消費式快照。清單只包含呼叫方擁有及無 owner 的任務。
- `read(id, caller?)` 消費流任務的唯一遊標；對於最終輸出任務，則以冪等方式讀取終止輸出。
- `kill(id, caller?, reason?)` 在更改狀態前呼叫生產方取消。取消拋出例外時任務保持執行；成功則把狀態改為 `stopping`，並將終止交付標記為已報告。
- `wait(id, timeoutMs, caller?, signal?)` 返回終止快照，或在逾時時返回存活快照。中止只會停止等待；一旦終止交付已向該等待方提交，終止結果優先。
- `onJobDone(listener)` 觀察每條終止記錄及其精確 owner。監聽器拋出的例外和產生的拒絕都會被隔離；系統不會等待監聽器工作。
- `onJobsChanged(listener)` 觀察可見集合的變化——註冊、每一次轉入 stopping（包括 teardown 在等待緩慢生產者之前的那一次）、結帳、owner 銷毀時的移除，以及服務銷毀提交的清空——只攜帶集合發生變化的那個 owner，或在無主任務變化、因而每個呼叫方的集合都隨之變化時攜帶 `undefined`。它按 owner 分粒度，因為移除是任何逐任務記錄都無法表達的變化；它也不是 `onJobDone` 的超集：它不含任何投遞含義，也不把任何東西標為已上報。註冊綁定的是呼叫方 fiber，因此掛在登錄檔之外的觀察者仍能收到銷毀時的清空。
- `attachController(name)` 在其 effect 生命週期內聲明任務控制器。當沒有任何已附加的控制器服務於 spec 的所有者時，`start()` 會在生產方執行前失敗。

這三類註冊都是相對於所有者的，因為一個登錄檔要服務行程內的每一套組合。從不帶 scope 的上下文註冊的控制器或監聽器服務於每個所有者；在某套 agent 組合的 scope 下註冊的，則恰好服務於在該組合下組合出的 agent。因此，未載入任何控制器的組合無法借另一套組合的控制工具啟動後臺工作，而一次結帳也只會通知其所有者所屬組合註冊的監聽器。

有 owner 的訪問會比較任務的 `SessionId` 與呼叫方。`bash-1` 等 id 可預測，因此這道隔離是安全邊界。無 owner 的任務向呼叫方開放，並持續到服務 dispose（資源釋放）為止。

`outputLimitBytes` 是生產方擁有的模型呈現策略，會原樣攜帶到快照中。控制器在新增狀態或通知元資料後應用它；登錄檔不會重寫生產方輸出，也不會為省略此欄位的生產方虛構預設值。

實作還必須兌現約定的生命週期語義：註冊的存續期長於生產方 fiber 與控制器 fiber，owner 釋放和服務釋放會取消仍在執行的工作並等待守約的生產方，結帳遵循首次結果優先（一條終止記錄、一輪例外受到隔離的監聽器通知，然後釋放等待方）。

參見[任務類型目錄](../../../docs/subsystems/jobs.md)、[執行時期 Agent Note](../../../.agents/notes/implemented/architecture/2026-06-20-generic-long-running-tool-runtime.md)和 [seam Agent Note](../../../.agents/notes/implemented/architecture/2026-07-26-job-registry-seam.md)。

## 模型體驗

透過生產方外掛程式和 [`dsh-tool-jobs`](../tool-jobs/README.md) 間接影響；它們會渲染 job id、輸出、狀態、取消和完成通知。

#### KV Cache 影響

不會直接導致 KV Cache 失效；請求前綴變更由上述消費端負責。

## 已知限制與暫緩事項

- **流輸出只有一個消費遊標**：獨立觀察者需要遊標或快照 API。
- **前臺工作無法轉為後臺**：生產方在啟動前選擇前臺或後臺。
- **約定是行程內的**：`JobStart.run()` 傳入回呼和確切的 `Agent` 對象；持久化或跨行程後端必須先重塑身份、重新啟動、所有權與觀察語義，才能實作此 seam。
