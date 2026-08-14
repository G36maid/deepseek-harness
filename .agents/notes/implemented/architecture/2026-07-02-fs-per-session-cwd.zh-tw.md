# Agent Note: 相對檔案系統路徑按呼叫方的工作階段 cwd 解析

Status: implemented

[English](2026-07-02-fs-per-session-cwd.md) | [简体中文](2026-07-02-fs-per-session-cwd.zh.md) | 繁體中文

## 問題

ACP（Agent Client Protocol）橋接層為每個工作階段提供獨立的工作區：`session/new` 將自動化用戶端的項目目錄記錄為 `SessionHeader.cwd`，`dsh-tool-bash` 將每次 bash 呼叫的 `workdir` 默認設為呼叫方 agent（代理）的 `session.header.cwd`（見 [ACP 包](../../../../packages/acp/acp) 與 `dsh-tool-bash` 中的 `resolveWorkdir`）。因此工作階段 A 中的 bash 命令在 A 的項目目錄執行，工作階段 B 中的在 B 的項目目錄執行——一個伺服器行程，N 個工作區。

檔案系統解析使用的是外掛程式載入時的 cwd，而 bash 使用的是工作階段的項目目錄。因此，當自動化用戶端的項目目錄與伺服器啟動目錄不同時，相對路徑的解析結果就會不一致；快照測試因為讓這兩個路徑相同而掩蓋了這個 bug。

一個有效的絕對 cwd 本身可能看起來有兩個父目錄：當它包含 `symlink/..` 時，檔案系統尋找會先跟隨符號連結再應用 `..`，而 `path.resolve()` 會從詞法上抹掉這兩個元件。如果用詞法解析沙盒策略卻從原始 cwd 啟動 bash，就會把權限授予無關的詞法父目錄、拒絕真實工作區內的寫入，並讓檔案系統工具把相對路徑解析進錯誤目錄。

普通的符號連結 cwd 在請求的相對路徑包含 `..` 時也暴露同一區別：行程從符號連結的物理目標開始遍歷，`path.resolve(cwd, path)` 卻從其詞法拼寫開始遍歷。因此，對於同一個模型提供的路徑，read 所選文件會不同於 bash 或沙盒化 mutation 對同一路徑所選的文件。

## 決策

將呼叫方的工作階段 cwd 傳入路徑解析，與 `dsh-tool-bash` 對 `workdir` 的處理方式完全一致。當 cwd 或請求路徑任一包含父目錄段時，在任何詞法 join 之前把 cwd 解析為原生檔案系統標識；沒有遍歷會使標識可觀察時，則保留普通 cwd 拼寫以供展示。mutation 和沙盒化 bash 呼叫複用解析後的沙盒策略根目錄，使一次呼叫只有一個工作區標識。**呼叫方**（即工具）提供 cwd；提供方不讀取工作階段或 agent。

- `FileSystem.resolve` 接受 `resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>`。`opts.cwd` 是相對 `path` 解析時的基準目錄；絕對 `path` 忽略它；省略 `opts.cwd` 則使用後端自身的預設值。後端執行 I/O 時，`opts.signal` 可以取消解析。options 對象把呼叫方擁有的兩個解析控制項放在一起，避免位置參數繼續成長。
- `dsh-fs-local.resolve` 使用 `resolveLocalTarget(opts?.cwd ?? this.config.cwd, path)`。`config.cwd` 仍作為呼叫方未提供工作階段 cwd 時的預設值。
- `dsh-tool-fs` 的 `read`/`write`/`edit` 透過共享的 `sessionCwd(exec, requestedPath)` 輔助函式（`exec.agent?.session.header.cwd`，與 bash 的 `resolveWorkdir` 對應）取得工作階段 cwd，並傳給 `resolve`。只要任一值中的父目錄段可能跨越符號連結，該輔助函式就使用原生 realpath 語義，否則保留普通拼寫；沙盒化 mutation 複用完整策略的 `workspaceRoot`；非 agent／無 header 的呼叫方得到 `undefined`，後端因此應用其預設值。

## 曾考慮的替代方案

### 為何由呼叫方（而非提供方）提供 cwd

提供方約定不得相依性 `dsh-agent`／`dsh-session`——這是一項文字儲存後端約定，沙盒化實作或遠端實作同樣滿足該約定，而這些實作沒有「agent 工作階段」的概念。工具已經接收了 `ToolExecution`（`exec`），其中攜帶 agent，因此工具是將 `exec → cwd` 投影並向提供方傳遞一個純字串的正確位置。這遵循「包邊界處顯式優於隱式」的約定：基準目錄作為顯式參數傳入，提供方據此行動，而非讓提供方越界去讀取它不應知曉的工作階段。這也與 `dsh-tool-bash` 一一對應，使兩個面向模型的文件操作介面以相同方式解析路徑。

預設值只存在於一個地方——提供方的 `config.cwd`。`sessionCwd` 在沒有工作階段時返回 `undefined` 而非 `process.cwd()`，因此工具永遠不會自行製造一個提供方本應自行選擇的基準目錄。

## 後果

- 在 ACP 演示中，fs 工具與 bash 對每個工作階段的工作區達成一致；自動化用戶端可以選擇任意絕對項目目錄，兩類工具都在該目錄下操作。
- 對於包含 `symlink/..` 的工作階段 cwd，或普通符號連結 cwd 搭配含父目錄遍歷的相對路徑，bash、檔案系統工具和沙盒授權都會從同一個物理工作區解析；詞法父目錄不會獲得授權。
- `FsTarget` 的標識不變：`targetKey` 仍為解析後絕對路徑的 realpath，因此 observed-state 鍵控與符號連結標識不受影響——正確的每工作階段 cwd 產生與 bash 目標相同的 key。
- 向後相容：所有現有的 `resolve(path)` 呼叫（均在測試中）繼續正常工作；新參數是選填的。
- 單工作階段 stdio 演示不受影響：它不提供工作階段 cwd（其 agent 的工作階段沒有 `cwd`），因此解析回退到 `config.cwd = process.cwd()`，即工作區本身。
