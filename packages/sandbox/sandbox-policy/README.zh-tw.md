# dsh-sandbox-policy：沙盒策略歸屬位置（`ctx.sandboxPolicy`）

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

沙盒策略解析的唯一歸屬位置：部署預設 [`SandboxMode`](../sandbox/README.md) 與回退根目錄，加上每個工作階段的持久模式覆蓋和不可變工作區根目錄。每項負責強制執行的能力在每次呼叫時都會收到一項解析完成的模式與根目錄策略；模型在每次請求前會收到當前策略，而不會另收一份能力清單。

## 為何需要共享歸屬位置

檔案系統工具、一次性 bash 命令和終端機工作階段可以用不同組合強制執行同一套模式詞彙。如果各自解析 `mode` + `workspaceRoot`，就可能漂移成分裂世界，正是[沙盒 Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md)所警告的情況。每個強制執行後端都會消費歸屬方解析出的完整策略，而當前上下文只說明該策略對於任何受 DSH 文件沙盒強制執行的可用操作有何含義。[跨家族 fs 沙盒 Agent Note](../../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md)記錄了共享策略決策。

## 設定

- `mode`：部署預設 `SandboxMode`（`read-only`／`workspace-write`／`danger-full-access`），載入時驗證。預設為 `read-only`（故障安全）。
- `workspaceRoot`：無 agent（代理）的呼叫或沒有 cwd 的工作階段在 `workspace-write` 下可寫入的回退目錄。預設為 `process.cwd()`；無論顯式設定還是採用預設值，都會解析為其絕對檔案系統標識。普通 agent 呼叫改用其工作階段頭中不可變的 `cwd`。

## 介面

- `ctx.sandboxPolicy.resolve({ session?, mode? })`：解析一項完整的逐呼叫策略。顯式批准的模式優先於工作階段最後一條 `sandbox/mode` 事件，後者又優先於 `defaultMode`；工作階段不可變的 `cwd` 會先按檔案系統語義規範化，再成為 `workspaceRoot`，否則使用設定的回退值。規範化先於詞法歸一化，因此 `symlink/..` 與行程工作目錄解析保持一致。
- `ctx.sandboxPolicy.defaultMode`／`ctx.sandboxPolicy.workspaceRoot`：`resolve()` 使用的部署預設值與回退根目錄。
- `sandbox:policy`：直接派生自 `resolve({ session })` 的請求時快取安全上下文貢獻。它說明該模式中與具體能力無關的文件操作約定，以及 `workspace-write` 下規範化的工作階段工作區；工具歸屬方仍負責特定於操作的拒絕與升權引導。
- `effectiveSandboxMode(events)`：工作階段 `sandbox/mode` 事件的純 fold（最後一次切換勝出，沒有則為 `undefined`），在 `resolve()` 內使用。
- `setSandboxMode(session, mode)`：逐工作階段覆蓋的唯一寫入路徑：恰好追加一條 `sandbox/mode` 事件。切換本身就是事件；不會在帶外修改模式。
- `SANDBOX_MODES`：所有模式，用於選項展示與執行時期驗證。

選填的 `./invariant` 配套元件會拒絕偽造的持久 `sandbox/mode` 事件，只要其值不在該封閉詞彙中；Session 與其配套元件負責相關儲存與核心執行封閉規則。agent loop（代理循環）會將組裝後的完整執行時期上下文快照記錄為一條帶來源的 `user/message`，因此無需記憶體中的「上次告知」映像檔，也能重建確切的策略輸入。

## 逐工作階段儲存

執行時期切換是在對應工作階段日誌中追加的一條 `sandbox/mode` 事件。`effective = explicit grant ?? fold(events) ?? deployment default`，因此覆蓋會透過重播跨重新啟動保留，兩個工作階段也絕不會看到彼此狀態。工作區標識無需另一條事件：建立時記錄的不可變 `SessionHeader.cwd` 是該工作階段每次呼叫使用的根。該事件仍只進入日誌；在下一次請求前，歸屬方會將當前事實貢獻給完整執行時期上下文快照。

## 模型體驗

### 當前文件沙盒策略

#### 模型看到的內容

每個 agent 工作階段的當前執行時期上下文快照中都有一項 `sandbox:policy` 貢獻。它不枚舉已裝載的能力。工具外掛程式繼續負責操作與升權引導，批准策略單獨貢獻給同一份快照，計畫引導仍由 `dsh-plan-mode` 的系統段落管理。

##### 只讀

```markdown
Current DSH file policy: read-only. Any available operation enforced by the DSH file sandbox cannot modify files in the standing mode. Do not refuse a required modification from this policy alone: try an available tool normally and follow any denial and escalation guidance it returns.
```

##### 工作區寫入

```markdown
Current DSH file policy: workspace-write. Any available operation enforced by the DSH file sandbox may modify files under the session workspace: "<workspace root>". Some platform temporary areas may also be writable.
```

##### 完全訪問

```markdown
Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications by available operations.
```

#### Token 影響

首次請求和有效策略每次變化時增加一條簡潔的持久上下文訊息；未變化的請求不增加內容。`workspace-write` 只攜帶規範化的工作階段工作區路徑；平臺特定的臨時路徑會以摘要表述，不會加入相依性主機的位元組。

#### KV Cache 影響

模式切換時，穩定的系統提示詞仍逐位元組相同。變化後的完整上下文快照會追加到保留的歷史之後，從而保留此前已快取的前綴；後續未變化的請求會複用該保留快照。

## 已知限制與暫緩事項

- **每個工作階段只有一個主要工作區根目錄**：策略解析 `SessionHeader.cwd`；額外可寫根目錄不屬於 `SandboxExecutionPolicy`。
- **僅限文件操作模式**：`SandboxMode` 管控文件操作；網路和行程策略不在其詞彙中，因此這裡沒有限制它們的旋鈕。
- **有意概述臨時區域**：強制執行後端會授予不同的平臺臨時區域，這些區域在策略解析後才會選定，因此無法在當前上下文中如實枚舉。
