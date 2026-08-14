# @deepseek-ai/dsh-plan-mode

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

按 agent（代理）分別記錄到日誌的 plan 協作狀態，提供由部署方設定的引導內容、用於直接進入的 `/plan [message]` 命令、用於直接退出的 `/plan off` 命令，以及經使用者評審的 `exit_plan_mode` 退出方式。Plan mode 是軟引導；沙盒模式和批准策略各自強制執行限制，且不讀寫 plan 狀態。

## 持久狀態

`plan/mode`（`{ active: boolean }`）是一個僅存在於日誌中、每次以完整值替換的 `SessionEventMap` 成員。`foldPlanMode(events)` 返回最後記錄的值，如果沒有則返回 `false`，因此復原、fork 和壓縮（compaction）都能直接從工作階段日誌復原 plan 狀態。UI 透過 `session/event` 觀察已提交的切換。

`ctx.planMode.set(agent, active)` 會在 agent 空閒時立即追加獨立的 `plan/mode` 事件，因為下一個提示詞之前不會執行輪內 pre-step。agent 執行時期，該方法會保留待生效選擇，直到下一個被接受的輪內 pre-step。回傳值區分 `committed`、`queued`、表示反轉的 `cancelled` 和 `noop`。`get(agent)` 返回 `{ active, pending? }`，將用於組裝當前步驟的日誌狀態與使用者的輪中選擇分開。初始與續步 pre-step 都會應用待生效選擇；同一步驟的請求復原重試會複用已凍結的 assembly，並將該選擇保留到下一個被接受的輪內 pre-step。當最後記錄的請求標頭描述了另一狀態時，使用者選擇的變更會貢獻一條外掛程式來源的 `user/message` 通知（兩條提交路徑皆然）。

## 模型與人類互動

啟用時，`plan:policy` 會渲染已設定的 `section`。外掛程式始終註冊 `exit_plan_mode`，使工具 schema 在轉換期間保持穩定；其 execute 路徑只接受已啟用的 plan mode，且只有透過 `ctx.userQuestions` 獲得使用者明確批准後才退出。

評審問題聲明 `plan-review` 呈現意圖，並指名 `Approve` 為表示批准的標籤，因此有能力的 UI 會把計畫呈現為一次決定而非通用問題；兩種情況下該工具讀到的回答完全相同。放棄審閱——使用者關閉請求，轉而發言——會如實報告給模型，要求它留在 plan mode 中等待那則訊息；其餘每一種評審失敗都保留 seam 自身的訊息。

組合 `ctx.commands` 時，該包會註冊 `/plan [message]`，並將參數恰好為 `off` 的情況保留給直接退出。不帶參數的 `/plan` 會啟用 plan mode；任何其他非空參數都會先啟用 plan mode，再透過 `agent.steer()` 提交，因此它會在 plan 引導下成為下一步驟的常規已記錄使用者訊息。`/plan off` 會選擇停用狀態，不傳送模型輸入；它還可以在啟用 plan mode 的待處理選擇由輪內 pre-step 追加之前將其取消。

Web 用戶端使用該外掛程式提供的 `/plan` 命令；其他入口可以直接驅動同一服務，無需定義第二套 mode 詞彙。

## 工作階段投影

當組合掛載 `ctx.sessionProjections`（[`@deepseek-ai/dsh-session-projection`](../../session/session-projection/README.md)）時，本包會在一個注入的子外掛程式中註冊 `plan` 投影單元。該單元摺疊兩類事件：名為 `plan` 且攜帶已記錄 `args` 的 `command/run` 記錄會設定目標狀態（`off` → 未啟用，其餘 → 啟用），`plan/mode` 會提交已記錄狀態並清除該目標；其他任何事件都返回同一個狀態引用。`view` 推導 `{ active, pending }`，其中 `pending` 僅在尚未落實的選擇與已記錄狀態不同時為 true。該值完全由日誌重播得出，因此 host 重新啟動、其他分頁標籤和冷讀都能僅憑日誌復原它。`/plan` 處理器會在任何可能失敗的路徑之前呼叫 `set()`，因此處理器失敗時不會留下缺少對應 plan 選擇的已記錄命令。key 由 `src/types.ts` 透過聲明合併加入 `SessionProjectionMap`：host 消費端經 `./types` 取得，client 聚合經 `./client` 取得。框架負責驅動該單元，載體透過歷史尾頁和 `session/projection` 推送幀提供其值。未掛載登錄檔的組合不受影響。

## 設定

```yaml
- id: plan-mode
  name: '@deepseek-ai/dsh-plan-mode'
  config:
    section: |
      You are in plan mode. Explore and design before presenting the complete
      plan through exit_plan_mode.
```

`section` 必填且非空。出現未知鍵時，外掛程式會載入失敗。該包不接受任意命名的 mode、工具過濾器、沙盒設定或批准策略。

設計：[plan 專用協作狀態](../../../.agents/notes/implemented/simplification/2026-07-22-plan-specific-collaboration-state.md)。

## 模型體驗

### Plan 策略系統提示詞

#### 模型所見內容

Plan mode 啟用時，模型會在提示詞順序 50 處看到部署方提供的原樣 `section` 文字；未啟用 mode 不貢獻文字。

##### 設定示例

```markdown
You are in plan mode. Explore and design before presenting the complete plan through exit_plan_mode.
```

#### Token 影響

未啟用 mode 不增加 token；mode 啟用時，每個請求都會加入已設定的段落。

#### KV Cache 影響

該段在 plan mode 內穩定，但進入或退出會從順序 50 開始改變系統提示詞。

### 人類命令

#### 模型所見內容

`/plan`、`/plan off` 及其終端機結果留在模型歷史之外。除恰好為 `off` 以外的非空後綴會在選擇 plan mode 後，透過 `agent.steer()` 成為一個已去除首尾空白的使用者文字塊。plan mode 已啟用時，選擇 `/plan off` 只會在最後一個請求標頭描述了 plan mode 的情況下追加標準的已記錄使用者切換通知；取消待生效進入不會貢獻通知，因為沒有請求觀測到它。

#### Token 影響

選填訊息的歷史 token 成本與單獨提交該文字相同；不帶參數的 `/plan` 和 `/plan off` 不增加 token。一次帶有切換通知的已啟用狀態退出會追加一條簡短且會保留的通知。

#### KV Cache 影響

使用者塊是僅附加的對話成長。進入或退出 plan mode 會改變更早的策略段；退出轉換的記錄通知會追加在可複用請求前綴之後。

### 退出工具 schema 與評審互動

#### 模型所見內容

[`exit_plan_mode` schema](../../../docs/tool-catalog.md#deepseek-aidsh-plan-mode) 在兩種狀態下均可用；在 plan mode 外執行會失敗，而 plan mode 內經批准的評審會返回規範的 `{ approved: true }` 值，並渲染既有的確認文字。拒絕仍是攜帶評審回饋的失敗呼叫，放棄審閱則是一次指明使用者接手的失敗呼叫。

#### Token 影響

穩定 schema 的成本取決於 ToolRuntime mode，每次傳入的 plan 參數和評審結果都會保留在對話歷史中。

#### KV Cache 影響

mode 轉換不改變工具目錄；plan 參數與評審結果按常規方式擴充對話。

## 已知限制與暫緩事項

- Plan mode 只進行引導，而不強制執行；需要強制限制的部署必須分別設定沙盒與批准控制。
- 如果行程在另一個被接受的輪內 pre-step 之前退出，某輪最後一個被接受的 pre-step 之後作出的選擇會丟失，因此 UI 必須重新應用它。
- Fork 的 agent 會繼承已記錄的 plan 狀態，新 spawn 的 agent 則從未啟用狀態開始；不存在建立時 plan 選項。
- 由另一個 agent 所有的存活子級無法打開 `exit_plan_mode` 審閱。該呼叫失敗時會提示子級在最終結果中包含尚未解決的決策；僅有持久化 fork 譜系並不會阻止復原為執行時期根的工作階段打開該審閱。
- 只有 Web UI 具備專用的 `plan-review` 渲染器；其他互動提供方可以透過通用選項流程呈現同一請求。
