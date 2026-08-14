# @deepseek-ai/dsh-workspace

[English](README.md) | 繁體中文

DeepSeek Harness 的 Workspace 實體登錄檔（`ctx.workspaceRegistry`）：透過領域資料形式儲存持久 workspace 記錄、穩定 workspace 順序和按新到舊排列的候選工作階段索引。消費端看到 `Workspace` 介面；實體實作保持包私有。

實體／儲存理由見[領域 Agent Note](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md)；僅使用頭部的引導初始化和 GUI 排序見 [Workspace UI 產品流 Agent Note](../../../.agents/notes/implemented/feature/2026-07-25-workspace-ui-product-flow.md)。

## 結構

- `ctx.workspaceRegistry.create(path, title?)`：規範化 `path` 時使用 `fs.realpath`，拒絕不存在或非目錄的路徑，每個規範路徑最多建立一條記錄，並將新記錄前置到持久 workspace 順序。對同一路徑重複呼叫會返回現有 workspace，且不改變其標題；不同路徑可以共用顯示標題。
- `ctx.workspaceRegistry.get(id)`/`list()`/`resolveByPath(path)`：由快取提供的尋找。`list()` 為同步操作，並遵循持久登錄檔順序；`resolveByPath` 為非同步操作，因為它採用相同的 `realpath` 規範化方式，並會拒絕缺失路徑，而不是建立路徑。
- `ctx.workspaceRegistry.insertBefore(id, before?)`：在持久登錄檔順序內移動一個已註冊 Workspace，語義類似 DOM 的 insertBefore：插到錨點之前，省略錨點則追加到末尾。來源或錨點不在登錄檔中時拒絕且不寫入；以自身為錨點或移動到當前位置時直接完成且不寫入。返回的 id 清單是完整的已提交順序。
- `ctx.workspaceRegistry.delete(id)`：只移除 Workspace 註冊記錄、對應的持久順序條目及工作階段歸屬記錄。未知 id 返回 `false`，成功移除記錄則返回 `true`。目錄、使用者文件、活躍工作階段和持久化工作階段日誌絕不受影響，因此相關工作階段會進入 Ungrouped。表寫入失敗時會復原原順序和此前發布的實體。
- `Workspace.attachSession(id)`：對照 workspace 路徑驗證即時或已持久化的工作階段頭 cwd，並將新 id 前置。未知工作階段、缺失／無法解析／非目錄的 cwd 值和不匹配情況都會在不寫入的前提下被拒絕。`detachSession` 只移除候選索引條目。
- `Workspace.insertSessionBefore(id, before?)`：在手動順序內移動一個已記帳的工作階段，語義類似 DOM 的 insertBefore：插到錨點之前，省略錨點則追加到末尾。工作階段或錨點不在記帳中時拒絕且不寫入；移動到當前位置時直接完成且不寫入。登錄檔中的 Workspace 順序絕不改變。
- `ctx.workspaceRegistry.archiveSession(id)`/`archivedSessionIds`：覆蓋在 workspace 記帳之上的登錄檔級全域性歸檔集合：被歸檔的工作階段從各分組檢視表中消失，但其工作階段日誌和 `sessionIds` 席位保持不變，未來取消歸檔時可復原原位置。歸檔接受任何即時或已持久化的工作階段（無論已記帳還是 Ungrouped），對已歸檔的 id 直接完成而不寫入，並拒絕未知 id。在該欄位出現之前寫入的狀態解析為一個空集合。
- `Workspace.sessionIds`：按持久候選順序提供同步 id 加規範 cwd 成員投影。缺失頭部、無效 cwd 值和不匹配情況都被過濾；下一次 workspace 變更會剪除它們。如果同一儲存介質將一個工作階段索引到兩個 workspace 下、用兩條記錄聲明同一路徑，或偏離持久 workspace 順序，啟動會被拒絕。
- `Workspace.status()`：未快取的目錄檢查，返回 `'ok' | 'missing-dir'`；目錄缺失絕不會改動記錄。

`storageDomain` 和 `sessionPersistence` 是啟動必需相依性。任一相依性服務不可用時，外掛程式保持待處理，且不能提交空的已初始化標記。首次成功啟動時，登錄檔呼叫 `SessionPersistence.list()`，僅使用頭部 `id`、`cwd` 和 `createdAt` 對有效歷史目錄分組並持久化初始順序；它絕不讀取事件正文。已初始化標記最後寫入，因此重新啟動後可安全複用引導初始化期間的部分寫入。後續僅能透過 cwd 識別的工作階段仍屬於 Ungrouped。

建立和刪除操作會在記錄和順序可能分叉之前，先持久化明確的待處理變更標記。啟動時只補全該標記所指明的變更，隨後清除標記；沒有標記的順序／表不一致仍屬於來源不明的損壞，並會明確報錯。刪除後重新註冊同一路徑會生成新的 Workspace id，且不會自動重新接納保留下來的工作階段。

## 模型體驗

### Workspace 記錄與工作階段記帳

#### 模型看到的內容

沒有。`ctx.workspaceRegistry` 只向宿主側消費端提供 workspace 記錄：此包不註冊工具、不注入提示詞、不寫入工作階段事件，因此沒有請求欄位會攜帶此包資料。

#### Token 影響

每個請求的直接 token 為零。

#### KV Cache 影響

與即時請求無關：此包絕不觸及請求前綴，因此不會使提供方快取複用失效。

## 已知限制與暫緩事項

- 工作階段刪除與破壞性的資料夾移除是彼此獨立且尚未提供的功能；刪除 Workspace 註冊記錄絕不能替代二者（參見[決策記錄](../../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.md)）。
- 頭部索引會在啟動時刷新，也會在 attach 必須解析未快取持久 id 時刷新；另一行程執行的刪除或造成的 cwd 損壞會在下次刷新或重新啟動後被發現。
