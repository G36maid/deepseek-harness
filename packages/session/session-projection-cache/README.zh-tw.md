# @deepseek-ai/dsh-session-projection-cache

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

持久投影快取（`ctx.sessionProjectionCache`）：把每個已註冊投影單元的狀態持久化為檢查點，基於域資料形態（domain data form）每工作階段一條記錄（`session_projcache` 域——出廠 JSON 後端將其落在設定的儲存根目錄下、`workspace.json` 旁邊）。設計權威：[session-projection RFC](../../../.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md)（persisted projection cache 一節）。

一條儲存行 `(key → {ver, seq, val})` 是摺疊捷徑，絕不是權威：可能過時（`seq` 精確說明過時到哪），但絕不會錯。實作據此承諾：

- **每次後臺寫入都 fail-soft。** 持久寫失敗只記一條警告並保持快取過時；下一次寫入或冷讀自愈。兩次寫之間崩潰的代價是更長的尾部重播，絕不是錯誤的值。
- **`ver` 與當前執行單元的 `stateVersion` 不匹配即丟棄，絕不遷移。** 單元遞增版本會在學取時使其行失效；該 key 從日誌重新摺疊。
- **整記錄寫入。** 每次寫入替換該工作階段的完整檢查點（登錄檔切面始終是完整的），並經無損 JSON 邊界快照——違反純 JSON 約定的單元狀態會顯式失敗並報錯。
- **記錄綁定到日誌生命週期，而不只是 id。** 每條記錄儲存其摺疊來源的 header 身份（`createdAt`、`cwd`）；每次讀取先以活 header 或儲存 header 為證驗證它，再接受任何行——被刪後重建的 id、或快取倖存而持久化儲存被換掉時，無關記錄被整體丟棄，絕不播種幻影值。
- **日誌領先，快取跟隨。** 活工作階段檢查點先把緩衝事件持久 flush，快取行才落地，因此崩潰只會讓快取落後於日誌（更長的尾部重播），絕不領先於它。

## 寫策略

兩個必寫點，其間節流：

| 觸發 | 性質 |
|---|---|
| `turn/end` | 必寫——冷讀要的正是輪次終值。 |
| 工作階段釋放（detach） | 必寫——live 轉 cold 的時刻；此後冷讀階梯接管該工作階段。 |
| 累計 `writeEveryEvents` 個已提交事件 | 設定節流（條數）。 |
| 距首個髒事件 `writeIntervalMs` 毫秒 | 設定節流（間隔）。 |

兩個 `Config` 欄位均必填（無預設值）：寫入節奏是部署選擇，沒有普適正確值，由 cordis.yml 明示。

## 清單讀（`cachedSnapshot(meta)`）

零 I/O 一檔：從身份匹配的儲存記錄直接 view 全量值（僅版本匹配的 key），以 `{asOfSeq, values}` 切面返回——`asOfSeq` 取所服務行的最低水位，用戶端在 higher-seq-wins 規則下播種值儲存時，過時清單塊永遠壓不過更新的推送幀。無可用記錄（未知 id、無關生命週期、無版本匹配行）時返回 `undefined`；api-proxy 清單載體將其轉為列缺席。

## 冷讀（`coldSnapshot(id, signal?)`）

讀取階梯，正常路徑無需載入全量日誌：快取行 → `sessionProjections.restoreFloor`（錨定在最低可用水位之前一個事件的位置）→ 持久化 `readFrom(id, floor)` → `sessionProjections.restore` → 刷新行的 fail-soft 寫回。這個錨使縮短的日誌（崩潰修復截斷）可被證明：越界的行恰好觸發一次從 seq 0 的全量重讀，而不是把幽靈值當現值服務。無已註冊單元時直接服務 `{asOfSeq: -1, values: {}}`，不觸碰持久化；無持久日誌的工作階段以 seam 的 `not found` 拒絕。

`write(session)` 是兩個必寫點共用的同步切面檢查點；載體可以直接呼叫（非 fail-soft——由 fail-soft 包裝層負責遏制）。

## 組合

```yaml
- id: session-projection-cache
  name: '@deepseek-ai/dsh-session-projection-cache'
  config:
    writeEveryEvents: 200
    writeIntervalMs: 5000
```

注入 `storageDomain`、`sessionProjections`、`sessionPersistence`、`sessions`。沒有這一行時，投影系統只跑 live（水位快取；冷讀在實作了它的載體處退回全量日誌載入）。

## 模型體驗

無，因為快取只持久化並復原 host 側的、由已寫入日誌的工作階段狀態派生的讀模型，不觸碰任何提示詞、訊息、schema、流或工具結果。

#### KV Cache 影響

無；快取從不組裝或傳送提供方請求。

## 已知侷限與延後工作

- **不提供淘汰或保留介面**：記錄會按工作階段持續累積；清理已儲存的檢查點屬於帶外維護，與工作階段持久化採用相同策略。
- **間隔節流採用按工作階段的粗粒度控制**：一次無髒資料的寫入完成後，計時器會在首個髒事件到達時啟動；對於持續但未達到條數閾值的事件串流，系統每個間隔寫入一次，而不採用滑動視窗。
- **`coldSnapshot` 讀取不去重**——同一工作階段的兩個並行冷讀各跑一遍階梯；寫回最後者勝（行等價），對清單級呼叫頻率可接受。
