# @deepseek-ai/dsh-command-goal

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

面向使用者的 `/goal` 控制，基於 [`ctx.goals`](../goal/README.md) 實作。該外掛程式透過 [`ctx.commands`](../../interaction/commands/README.md) 註冊一個全域性命令，因此每個已組合的命令配接器都能發現並執行它，無需模型輪次。[使用者 goal 命令 Agent Note](../../../.agents/notes/implemented/feature/2026-07-19-human-goal-command.md) 負責使用者體驗與組合決策。

## 命令約定

| 輸入 | 結果 |
|---|---|
| `/goal` | 顯示當前目標、持久 phase、Round 計數／上限、行程本機續行啟用狀態與有效的下一步命令；被阻塞的 goal 還會顯示策略程式碼和說明，沒有 goal 時則顯示用法。 |
| `/goal <objective>` | 建立 goal 並啟用續行，或用全新身份替換已完成 goal。未完成 goal 絕不會在沒有顯式 clear 的情況下被替換。 |
| `/goal edit <objective>` | 編輯當前目標，不改變其 phase 或續行啟用狀態。編輯已完成 goal 會建立新的 active goal。 |
| `/goal pause` | 暫停 active goal，並停用續行。 |
| `/goal resume` | 復原已停止 goal，或在工作階段 resume／fork 後為 active goal 重新啟用續行；仍受剩餘 Round 上限約束。 |
| `/goal clear` | 清除當前指針，同時保留其持久歷史和 tombstone。 |

只有控制詞佔據完整輸入時纔不區分大小寫。其他任何非空後綴都屬於目標，因此 `/goal pause after verification` 會建立該字面目標。goal 領域會去除目標首尾空白並進行驗證。由於通用命令平面沒有模態編輯器或確認原語，`edit` 會內聯接收替換內容；若試圖替換未完成的 goal，則直接返回錯誤，提示使用者執行 edit 或 clear。

可預期的領域拒絕會變成穩定的直接命令錯誤，不公開帶品牌類型的 id 或 revision。意外實作失敗仍會 reject 分發，使配接器能將其報告為命令失敗。通用命令文字和輸出仍屬於即時 UI 狀態；`dsh-goal` 透過自有的持久 `goal/change` 事件記錄每項已接受變更。

## 組合

生產方注入 `commands` 和 `goals`。自訂應用會掛載它們的所有者與此外掛程式；自動續行仍是獨立選擇：

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: goal
  name: '@deepseek-ai/dsh-goal'
- id: command-goal
  name: '@deepseek-ai/dsh-command-goal'
```

隨附 `dsh` 基礎設定啟用持久 goal 棧和此命令；Web 用戶端提供其互動配接器。ACP（Agent Client Protocol）自動化應用啟用領域與模型工具，但不掛載命令配接器；`goals: false` 會移除該棧。無 UI 的 `agent-spine-demo` 必須顯式設定 `goals: {}`，避免無頭單次呼叫方在不知情時從一個物理輪次變為包含多個 Round 的操作。

## 模型體驗

### 使用者 `/goal` 控制

#### 模型看到的內容

斜槓輸入、變更以及直接狀態／錯誤輸出不會進入模型請求。goal 領域把變更記錄為 `goal/change`；已啟用的同工作階段驅動器可以在後續繼續執行提示詞中暴露結果狀態。呈現文字絕不會記錄到日誌中。

#### Token 影響

讀取狀態、變更 goal 或收到直接命令錯誤不會增加模型 token。已啟用的同工作階段驅動器可能增加後續 Goal Round 提示詞。

#### KV Cache 影響

命令發現、變更與直接輸出不會影響快取。後續繼續執行提示詞遵循驅動器的普通請求歷史。

## 已知限制與暫緩事項

- **僅純文字互動**：通用命令登錄檔沒有模態編輯表單或替換確認回呼；內聯 edit 與顯式 clear 能在不同配接器中保持明確且一致的破壞性意圖。
- **沒有逐命令 Round 上限參數**：`defaultMaxGoalRounds` 仍是部署設定；使用者直接請求時，可以要求模型透過另行授權的 goal 工具編輯 `max_goal_rounds`。
- **沒有持續狀態元件**：裸 `/goal` 是可移植的觀察介面；配接器專用徽標和重連後可復原的命令輸出仍屬於未來 UI 工作。
- **隨附應用中只有 Web 命令配接器使用此命令**：無頭、ACP 自動化和 JSON-RPC 配接器不消費 `ctx.commands`。如果組閤中包含面向模型的 goal 工具，普通提示詞仍能授權它們。
