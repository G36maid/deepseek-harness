# @deepseek-ai/dsh-fs-observation-policy

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

**fs-observation-policy 外掛程式**：它記錄觀測到的存在或缺失狀態，並在 `ctx.fs` 提供方約定（[`@deepseek-ai/dsh-fs`](../fs)）之上增加編輯前讀取和帶防護的寫入/編輯；它透過 `fs/*` 事件閘門參與，**不是**透過方法服務。該外掛程式**不**註冊 `ctx.fsPolicy` 服務，也沒有公開的 `read`/`write`/`edit`/`resolve` 方法。它是檔案系統棧的政策層：不是可替換 seam，而是不應位於 `FileSystem` 提供方基類上的政策。

```ts
import type { Context } from '@deepseek-ai/cordis'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'

declare const ctx: Context

// No service to inject — this plugin only registers the three fs/* listeners.
// Load it alongside a ctx.fs provider (e.g. @deepseek-ai/dsh-fs-local) and the
// @deepseek-ai/dsh-tool-fs tools; the tools dispatch the fs/* events this plugin
// decides. Order does not matter for resolution (no inject), but the policy
// listener should be the first decider registered for the fs/*-intent slots.
await ctx.plugin(FsPolicy)
```

## 四層拆分

| 層 | 包 | 角色 |
|---|---|---|
| 工具/執行器 | `@deepseek-ai/dsh-tool-fs` | 面向模型的 schema、讀取視窗和文字算繪；透過 `ctx.fs` 讀取/寫入/編輯，並分派 `fs/*` 事件 |
| 策略 | `@deepseek-ai/dsh-fs-observation-policy`（本包） | 透過 `fs/*` 事件閘門提供已觀察狀態、編輯前讀取和版本防護的寫入/編輯（無服務） |
| 提供方約定 | `@deepseek-ai/dsh-fs` | `ctx.fs`：文字 I/O 與原子變更原語（選填版本防護）；擁有 `fs/*` 事件詞彙 |
| 提供方 | `@deepseek-ai/dsh-fs-local` | `ctx.fs` 的本機實作 |

## 閘門的參與方式

三個 `fs/*` 事件（由 `@deepseek-ai/dsh-fs` 聲明，`@deepseek-ai/dsh-tool-fs` 分派）：

| 事件 | 本外掛程式的監聽器 |
|---|---|
| `fs/write-intent` | 未見或已觀測為缺失 → `{ kind: 'createIfAbsent' }`；已觀測為存在 → `{ kind: 'replaceIfVersion', version: vObserved }`。單 slot 決策；不呼叫 `next()`。 |
| `fs/edit-intent` | 未見 → `FS_NOT_OBSERVED`；已觀測為缺失 → `FS_NOT_FOUND`；已觀測為存在 → 返回 `{ version: vObserved }` 作為 CAS 基礎。單 slot 決策；不呼叫 `next()`。 |
| `fs/observed` | 為該所有者與目標記錄 `{ kind: 'present', version }` 或 `{ kind: 'absent' }`。同步、只有副作用的 `WeakMap.set`。 |

## 已觀察狀態是先前觀察記錄；新鮮度由提供方 CAS 保證

觀測狀態是一張以所有者為弱鍵、記錄各目標的對映表，具有三種邏輯狀態：未見、確認缺失、存在於某個版本。成功讀取文件或變更會記錄存在；`read` 的中繼資料未命中，或 `str_replace_editor` 的 `view`、`str_replace`、`insert` 命令發生中繼資料未命中時，都會在返回 `FS_NOT_FOUND` 前記錄缺失。外掛程式不執行檔案系統 I/O：它把該狀態轉換為提供方防護。存在狀態提供觀測到的版本；缺失狀態只允許 `createIfAbsent` 寫入繼續，edit 因沒有版本基準而返回 `FS_NOT_FOUND`。視窗讀取會觀察整個文件的版本，因此只有文件保持不變時才允許後續的定向編輯。外掛程式 dispose（資源釋放）時會丟棄狀態，並且不會跨工作階段持久化。

## 單 slot、先到者勝

`fs/write-intent`/`fs/edit-intent` slot 只容納一個決策器；本外掛程式會完整決策，不呼叫 `next()`。slot 按註冊順序先到者勝；由本外掛程式擁有 slot 只是預設部署約定，不是事件強制的不變式（更早註冊或透過 `prepend` 註冊的決策器會勝出）。這不是可組合的授權鏈；分層權限/審計/沙盒攔截屬於 `tools/execute`。

## 不與方法耦合

由於外掛程式只透過事件影響外部世界，移除它不會在服務注入邊界破壞 `@deepseek-ai/dsh-tool-fs`：工具會直接落到裸 `ctx.fs` 提供方（無條件寫入/編輯，無已觀察狀態）。重新載入外掛程式後，策略會重新生效。相比必需的方法服務，這種可平穩增刪的性質正是事件閘門的全部目的。

## 模型體驗

### 檔案系統工具結果

#### 模型看到的內容

該外掛程式不新增提示詞或 schema。沒有先前觀測時，它會以程式碼 `FS_NOT_OBSERVED` 和精確訊息 `edit requires reading "<path>" first` 拒絕編輯；編輯剛被觀測為缺失的目標會返回 `FS_NOT_FOUND`。正向觀測過時時，帶防護的變更會傳播由提供方擁有的 `FS_STALE_VERSION` 錯誤。[`dsh-tool-fs`](../tool-fs/README.md) 擁有面向模型的錯誤包裝，會為 `FS_STALE_VERSION` 訊息追加復原指令（`— re-read the file, then retry`）、為 `FS_NOT_OBSERVED` 訊息追加復原指令（`— read the file, then retry`），同時保留錯誤碼。外部刪除目標後，遵循過時復原指令會記錄缺失：下一次帶防護的寫入可以透過 `createIfAbsent` 重新建立該目標，而提供方會以原子方式保留任何並行建立者寫入的文件。

#### Token 影響

允許的操作除了普通工具結果外不增加 token。拒絕會新增少量保留的錯誤結果，並避免產生成功 payload。

#### KV Cache 影響

僅附加；新增可見內容位於可複用請求前綴之後，不會使現有 KV Cache 條目失效。

## 已知限制與暫緩事項

- **已觀察狀態無法在工作階段復原後保留**：`WeakMap` 記錄的持久化工作延期處理，因此復原的工作階段必須重新讀取文件，才能執行防護寫入/編輯。
- **沒有 agent（代理）工作階段的參與者絕無法滿足策略**：它們的編輯會拋出 `FS_NOT_OBSERVED`，寫入總會解析為 `createIfAbsent`，因此非 agent 呼叫方無法透過閘門覆蓋現有文件。
- **直接 `ctx.fs` 讀取不會發出 `fs/observed`**：在 `read` 工具之外讀取的文件仍未觀察；後續防護編輯會以 `FS_NOT_OBSERVED` 拒絕，直到工具讀取該文件。
- **授權依據是版本新鮮度，而非檢視表完整性**：任何視窗讀取都會授權對未變文件執行全文件覆蓋，這有意弱於完整檢視表規則（見 [seam 拆分 Agent Note](../../../.agents/notes/implemented/simplification/2026-06-26-fsspec-style-fs-seam.md)）。
