# Agent Note: 在每個診斷邊界渲染錯誤 cause 鏈

Status: implemented

[English](2026-07-20-error-cause-chain-diagnostics.md) | [简体中文](2026-07-20-error-cause-chain-diagnostics.zh.md) | 繁體中文

## 問題

TUI 連線不可達的 DeepSeek 端點時，失敗只顯示一條 `fetch failed` 通知，沒有任何進一步細節。兩個獨立缺口共同造成了這個死衚衕：

1. undici 的 `fetch` 把所有傳輸層失敗（DNS、連線被拒、TLS、代理）包裝成裸的 `TypeError: fetch failed`，可操作的細節——`ECONNREFUSED`、`bad port`、Happy Eyeballs 的 AggregateError——都在 `error.cause` 上。harness 裡的每個診斷邊界都只渲染 `error.message`（或對 Error 等價的 `String(error)`），於是包裝層在 TUI 通知、持久化的 `turn/end` reason 和所有日誌行裡都掩蓋了診斷資訊。
2. readline 入口（`dsh-stdio`）完全不渲染失敗原因：`reason.kind === 'error'` 的 `turn/end` 只列印下一個 `> ` 提示符，同樣的失敗在 `demo:repl` 裡就是純粹的沉默。

## 決策

- `dsh-llm` 匯出 `errorChain(value)`：渲染拋出值及其完整 `cause` 鏈（`outer: inner: …`）與 AggregateError 成員（`msg [m1; m2]`），並容錯迴圈 cause 和惡意強制轉換。它只是用於診斷輸出的渲染器；路由仍然基於 `HarnessError.code`。
- DeepSeek 配接器把拿到回應之前的傳輸失敗包裝成 `LlmError('TRANSPORT')`，寫明設定的 `baseURL` 並將原始拒絕值作為 `cause` 串入錯誤鏈。被中止的請求變為 `LlmError('ABORTED')`；由於輪次訊號已處於中止狀態，agent loop（代理循環）仍將該輪次歸類為取消而非復原。
- 每個診斷邊界改用 `errorChain` 而非 `error.message`/`String(error)`：agent-loop 的持久化 `turn/end` 錯誤訊息（`errorData`）、其日誌警告、TUI 的 `agent/error` 通知與啟動失敗行、以及 `dsh-stdio` 的啟動失敗日誌行。即時 `agent/error` 事件與 `SettleReason` 以 `unknown` 原樣保留拋出值；各診斷消費端自行渲染，而不是由迴圈把它包裝成另一個錯誤。`dsh-agent-loop`、`dsh-stdio`、`dsh-tui` 裡各自的 `renderThrown` 副本被刪除，統一使用這一個共享渲染器。
- `dsh-stdio` 渲染失敗的 `turn/end` reason：`[turn failed <code>] <message>`、`[turn aborted] <reason>`、`[turn rejected] <reason>`、`[turn interrupted by a previous process exit]` 以及輸出 token 上限通知。透過聲明合併擴充出的未知 kind 按普通輪次結束處理。

`errorChain` 與 `HarnessError` 一樣放在 `dsh-llm` 裡，理由相同：它是每個消費端都已匯入的葉子包，共享不增加新的相依性邊。

## 考慮過的替代方案

**在每個錯誤的構造函式裡渲染鏈（把 cause 寫入 `message`）。** 否決：當消費端同時遍歷 `cause` 時會雙重渲染（配接器修復的第一版產出了 `… fetch failed: bad port: fetch failed: bad port`），並且破壞了想按內層錯誤路由的消費端所需的結構化鏈。

**只做一個感知 `cause` 的日誌匯出器。** 否決：持久化的 `turn/end` reason 和 TUI 通知不是日誌行；被掩蓋的訊息會留在工作階段日誌——輪次內失敗的唯一持久記錄——以及主要 UI 中。

**逐包升級 `renderThrown`。** 否決：三個包已經各自持有幾乎相同的私有副本；分別升級只會固化共享渲染器所要消除的重複。

## 後果

- 傳輸失敗現在在 TUI 通知、readline transcript（文字記錄）和持久化工作階段日誌裡顯示為 `DeepSeek API request to <baseURL> failed: fetch failed: connect ECONNREFUSED …`，代價是更長的診斷字串。
- 持久化的 `turn/end` 錯誤訊息包含 cause 細節。現有快照 fixture（測試前置資料）位元組級一致地重播，因為其指令碼化錯誤不帶 `cause`（對這類錯誤 `errorChain(err)` 等於 `err.message`）；只有單元測試的期望字串有變化。從真實傳輸失敗錄制的 fixture 會攜帶完整鏈。
- `errorChain` 渲染 `message` 而不帶類名（`String(error)` 會渲染 `Error: <message>`），因此日誌行裡的裸 `TypeError` 會丟失類型標籤，除非訊息為空（此時回退到類名）。在這些診斷邊界上，鏈細節被判斷為比類名更有價值。
- `dsh-stdio` 對失敗輪次的輸出不再沉默；解析 transcript 的管道消費端會看到新的 `[turn …]` 行。
- `dsh-subagent`、`dsh-workflow`、`dsh-skill`、`dsh-workflow-worker-thread` 裡剩餘的 `renderThrown` 副本仍不渲染鏈；它們包裝的是自帶訊息的包內錯誤，等診斷資訊證明不足時再採用 `errorChain`。
