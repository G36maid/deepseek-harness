# @deepseek-ai/dsh-command-compact

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

透過 [`ctx.compaction`](../compaction/README.md) 提供面向使用者的 `/compact` 壓縮（compaction）控制。該外掛程式透過 [`ctx.commands`](../../interaction/commands/README.md) 註冊一個全域性命令，因此組閤中的每個命令配接器都能發現並執行它，無需模型輪次。[排隊手動壓縮 Agent Note](../../../.agents/notes/implemented/feature/2026-07-30-queued-manual-compaction.md)擁有接納、鎖與持久性決策。

## 命令約定

| 輸入 | 結果 |
|---|---|
| `/compact` | 即使未達到自動壓力，也摘要一段有效、平衡的較早範圍；獨立標記對 flush 後，報告被替換的歷史項數量與估算 token 數。 |
| `/compact`，但沒有可壓縮歷史 | `No compactable history yet.`：不會寫入標記，也不會變更 surface。 |
| `/compact <anything>` | `Usage: /compact (no arguments)`：該命令不接受參數，也不會呼叫壓縮後端。 |

該命令與後端無關，只相依性 `compactNow(agent, signal)`。呼叫該命令的 agent（代理）就是操作的確切目標，發起分發的 UI 會透過 seam 轉發取消訊號。每次完成的呼叫都會記錄執行器所屬的純日誌事件對 `command/run` / `command/done`；兩者都不進入模型歷史。成功時，`command/done.sourceEventSeq` 會指明該交易的 `compaction/summary` 事件，讓呈現層無須解析結果文字或假定兩行相鄰，即可將命令生命週期歸並到對應檢查點中。

預期的 `ManualCompactionError` 程式碼會成為穩定的直接錯誤：

| 程式碼 | 直接結果 |
|---|---|
| `busy` | `Compaction is unavailable because this process has an active compaction, or the agent is not idle.` |
| `changed` | `The history selected for compaction changed before it could be replaced. The conversation is unchanged; the attempt is recorded in the session log.` |
| `summary` | `Compaction could not produce a useful summary. The conversation is unchanged; the attempt is recorded in the session log.` |
| `commit` | `Compaction did not finish cleanly; some session history may have changed. Inspect the current session state before retrying.` |
| `persistence` | `Compaction finished, but the session could not be saved.` |

busy 結果有意限定在行程範圍內：活動的未匹配標記會阻塞，而早於最新 `session/end-seed` 的標記已過時，不會阻塞。意外實作故障會拒絕分發。取消仍具有最終決定權；後端會完成必需的閉合／flush 清理，命令內部以 `Compaction cancelled.` 結帳，而命令執行器會因取消錯誤停止等待。外掛程式處置會先註銷 `/compact`，再等待所有已開始的處理器結帳，因此根級 teardown 不會越過已中止命令的閉合或 flush 邊界。

壓縮執行期間提交的提示詞仍會按 agent 的普通 FIFO 獲得接納，保留相同的身份與喚醒資訊。它們僅在壓縮的顯式持久性檢查點和接納預留釋放後啟動。空閒注入的上下文不受阻塞：它可以記錄在 `compaction/start` 與 `compaction/end` 之間，位置替換會使其在檢查點之後保持可見。

## 組合

生產方注入 `commands` 和 `compact`。掛載命令登錄檔、一個後端與本外掛程式：

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: compaction-basic
  name: '@deepseek-ai/dsh-compaction-basic'
- id: command-compact
  name: '@deepseek-ai/dsh-command-compact'
```

隨附 `dsh` 基礎設定將它掛載在 `compaction-basic` 旁，Web 用戶端提供命令配接器。未組合命令配接器的自動化介面只保留自動壓縮。

## 模型體驗

### 使用者 `/compact` 控制

#### 模型看到什麼

斜槓輸入與直接結果絕不會進入模型請求。已獲接納的壓縮會另外在獨立的 `compaction/* { turn: null }` 標記對內，用後端的 user 角色檢查點替換一段較早範圍。

#### Token 影響

命令生命週期不會增加模型 token。成功壓縮會用一份帶框架的摘要替換所選範圍，從而減少後續請求；摘要生成本身需要一次輔助請求。

#### KV Cache 影響

命令發現與簿記不會影響快取。已獲接納的 surface 替換會從第一個被遮蔽的歷史 token 起使複用失效。

## 已知限制與暫緩事項

- **僅限空閒狀態**：當一個輪次或已獲接納的喚醒提示詞擁有優先權時，`/compact` 會報告 `busy`；命令本身不會排隊。
- **不接受範圍或策略參數**：無參數形式使各命令配接器的行為保持穩定。顯式範圍仍由程式設計介面 `compactRegion()` 處理。
- **僅限命令配接器**：沒有 `ctx.commands` 的介面無法呼叫該命令，只能相依性自動壓力壓縮。
