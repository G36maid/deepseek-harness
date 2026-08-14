# Agent Note: 跨家族文件沙盒——統一策略歸屬、沙盒化 fs 提供方、fs 升級對等

Status: implemented

[English](2026-07-14-cross-family-fs-sandbox.md) | [简体中文](2026-07-14-cross-family-fs-sandbox.zh.md) | 繁體中文

## 問題

`SandboxMode` 所聲明的語義涵蓋檔案系統效果，但最初只有 `ctx.shell` 強制執行該策略。fs 工具（`write`/`edit`）在行程內經由 `ctx.fs` 變更宿主檔案系統，那裡的 OS argv 包裝在機制上毫無意義——[沙盒 Agent Note](2026-07-06-sandbox.md) § 行程內工具記錄了這一點，並把跨家族強制執行留作一個暫緩階段，附帶一個未決問題：行程內強制執行是各 seam 各自表達，還是變成一個統一的 harness 能力。本 Agent Note 就是那個階段，並給出答案：一個共享的策略歸屬，在每個家族各自正確的層級上做 per-seam 強制執行。

這個缺口並不只有 read-only 一種形態。一個受限編碼 agent（代理）的產品模式是 `workspace-write`：bash 已經可以在工作區根目錄下寫入，而其外的一切都被拒絕，所以只能全部拒絕的 fs 強制執行會嚴格劣於停用 fs 工具——模型會嘗試在工作區內 `write`，被拒，然後學會繞道 `bash` heredoc。因此跨家族強制執行必須涵蓋完整的模式階梯，包括 `workspace-write` 要求的路徑包含判定（規範化目標；`..`/符號連結/絕對路徑逃逸），以及與 bash 相同的升級手段。

第二個強制執行家族還暴露了原版面配置中的一個歸屬問題。部署預設值（`mode` + `workspaceRoot`）設定在 `dsh-bash-sandbox` 上，而 per-session 覆蓋事件是 `shell/sandbox-mode`，由 `dsh-shell` 的 session-mode 工具集摺疊與寫入。當 fs 強制執行同一套策略時，要麼 fs 讀取 bash 的設定與事件（一個能力家族相依性同級外掛程式的設定），要麼各家族各持一份副本——兩份 `workspaceRoot` 會漂移進沙盒 RFC 警告過的割裂世界：bash 受限於一個根，而 fs 圍住另一個根。

## 決策

三個相互協調的部分全部在葉子 `cordis.yml` 中組合，均不觸及 `agent-loop`。

### `ctx.sandboxPolicy`——mode 與工作區根的統一歸屬

`packages/sandbox/sandbox-policy/`（`@deepseek-ai/dsh-sandbox-policy`）註冊 `ctx.sandboxPolicy`，即部署沙盒策略的唯一所有者：

- `Config`：`mode`（封閉的 `SandboxMode` 聯合，默認 `read-only`）與 `workspaceRoot`（默認行程 cwd，解析為絕對路徑）。設定錯誤會在載入時明確報錯。
- per-session 覆蓋事件 `sandbox/mode`，連同它的純摺疊（`effectiveSandboxMode(events)`）、寫入路徑（`setSandboxMode(session, mode)`）與 `SANDBOX_MODES`。該事件是策略狀態——被兩個家族消費——所以它歸於此處，而不歸於任一能力的 seam。它的形狀與僅日誌（log-only）語義遵循 `approval/*` 的先例。
- `resolve({ session?, mode? })` 返回完整的單次呼叫 `SandboxExecutionPolicy`：顯式批准的模式 > 工作階段摺疊結果 > `defaultMode`，而工作階段中不可變的 cwd > 設定的 `workspaceRoot` 回退值。
- 保留 `defaultMode` / `workspaceRoot` 訪問器，作為部署回退值與能力宣告依據。

`dsh-bash-sandbox` 自身不再攜帶任何沙盒設定——它注入 `sandboxPolicy`，僅在直接呼叫時使用其中的部署回退值。`dsh-tool-bash` 與 `dsh-tool-fs` 把當前工作階段傳給 `ctx.sandboxPolicy.resolve()`，因此兩者每次呼叫都會取得相同的生效模式與 cwd 根目錄；`dsh-permission-presets` 預設與 ACP（Agent Client Protocol）bridge 經由遷移後的 setter 寫入。擁有 bash 與 fs 執行的 seam 仍不相依性工作階段——工作階段相依性歸策略包與工具消費端所有。

### `dsh-fs-sandbox`——在提供方內部強制執行

`packages/fs/fs-sandbox/`（`@deepseek-ai/dsh-fs-sandbox`）映像檔 `bash-local`/`bash-sandbox` 的拆分：`SandboxedFileSystem extends LocalFileSystem`，註冊為 `ctx.fs`，注入 `sandboxPolicy`。讀取（`resolve`/`stat`/`readText`/`streamText`/`listDir`）原樣透傳——每種模式都允許讀。兩個變更操作在委託給繼承來的原子寫之前按模式強制執行：

- `read-only` 直接拒絕 `writeText`/`editText`。
- `workspace-write` 把規範化後的目標圍欄於可寫根集合——`dsh-sandbox` 中的 `writableRoots(policy)`：工作區根加上平臺臨時目錄（`/tmp`、`os.tmpdir()`），各自 realpath——與 Seatbelt profile 授予的是同一個集合，所以 fs 圍欄是這一個模式含義在 bwrap/Landlock/Seatbelt profile 之外的第四種方言，因此不會出現「write 工具不能寫 `/tmp` 而 bash 能」的不對稱。規範化路徑寫法採用詞法包含的快速路徑；當 Windows 以大小寫不同的路徑、長檔名或 8.3 短檔名錶示同一目錄時，系統會逐級遍歷祖先目錄並比較檔案系統身份，而不會把邊界弱化為依據文字前綴猜測包含關係。目標在委託前被立即重新規範化（`resolve` 對最深的既有祖先做 realpath），因此自工具解析該目標以來被換出的祖先符號連結會被捕獲。
- `danger-full-access` 不加圍欄地委託。

拒絕是結構化的 `FS_SANDBOX_DENIED`，攜帶生效模式——區別於 `FS_PERMISSION_DENIED`（宿主 EACCES 是世界在拒絕；這裡是策略在拒絕）。無文字推斷：行程內圍欄確切知道它拒絕了什麼。per-call 載體是 `writeText`/`editText` 上一個末尾選填的 `SandboxExecutionPolicy`（檔案系統側對應 `ShellExecRequest.sandboxPolicy`）；該 seam 保持無工作階段相依性，而裸的本機後端會忽略它。`FileSystem.sandboxMode` 是能力事實（在基類與 `fs-local` 上為 `undefined`，在 `SandboxedFileSystem` 上為預設值），所以工具層按組合真相來宣告升級。

威脅模型寫在包 README 裡：一道位於可信程式碼中、針對模型可控路徑的策略圍欄，而非核心邊界——操作是 seam 自身的，只有目標路徑不可信，所以「先規範化再判包含」足以完整覆蓋這一呼叫面（`code-runtime` 的「containment, not a security boundary」先例）。對不可信程式碼的核心級隔離仍是 `ctx.shell` 的職責。resolve 到系統呼叫之間殘留的競態被就地重新規範化收窄，只有平臺原語（`openat2` `RESOLVE_BENEATH`）能徹底消除它，而在此不值得為其付出可移植性代價。

### 工具對等——一個拒絕標記、一條升級流程

`dsh-tool-fs` 把當前工作階段解析成完整策略，並傳給每次變更，同時將 `FS_SANDBOX_DENIED` 對映為模型已從 bash 認識的標記：`[sandbox: file access denied under <mode> mode]`。當 `ctx.fs.sandboxMode` 在註冊時報告一個受限模式，`write` 與 `edit` 宣告相同的 `sandbox_permissions` + `justification` 欄位，向模型說明同樣的同一輪次重試方式，並在執行前處理同樣的 `ctx.approval` 請求——四種結果及其逐字的 fail-closed 文案沿用自[沙盒 Agent Note](2026-07-06-sandbox.md) § 升級（執行時根據呼叫的生效模式檢查是否嚴格加寬；授權只改變當前呼叫的模式，並保留其工作階段根目錄；不產生任何新工作階段事件）。

共享部分住在 `dsh-sandbox`，它擁有模式類型：`WIDER_MODES`、升級目標枚舉、參數配對校驗、拒絕/提示標記構造器，以及 `approveEscalation`——有序的 fail-closed 編排。`approveEscalation` 接收一個最小的結構式 approver（`EscalationApprover`，對 agent 與 call-id 類型泛型化），而非審批服務類型，所以 `dsh-sandbox` 不獲得對 approval 或 agent 包的相依性：每個工具把自己的 `ctx.approval`、agent、call id 與工具名作為原料傳入。`dsh-tool-bash` 與 `dsh-tool-fs` 都使用它們；跨文件重複偵測閘門確保單一來源不走樣。

[`examples/acp-agent`](../../../../examples/acp-agent/cordis.yml) 組合載入 `dsh-sandbox-policy` 與 `dsh-fs-sandbox`，把 `mode`/`workspaceRoot` 設定移到策略條目，並去掉在受限模式下停用整個 fs 棧的舊門控；`fs-observation-policy`（read-before-edit）正交地疊加其上。系統提示仍然不陳述沙盒模式——標記會在真正重要的那一刻教會模型邊界，遵循沙盒 Agent Note 所述的即時證據原則。

### 強制執行點：提供方，而非 intent gate

沙盒 Agent Note 最初的跨家族草圖把 fs 強制執行放在 `fs/write-intent`/`fs/edit-intent` 事件上。本 Agent Note 改為在提供方中強制執行，基於兩個機制性事實：intent slot是單決策、先到先得（已被 `dsh-fs-observation-policy` 佔據，其約定明確規定，出現第二個決策者即屬設定錯誤），且 intent 事件只由 `dsh-tool-fs` 派發——一個直連 `ctx.fs` 的呼叫方（一個 Cordis 掛載外掛程式、一個自訂工具）會繞過它們，而提供方級強制執行按構造覆蓋每一個呼叫方。

### 範圍之外

- **`ctx.web` 的網路策略**——`SandboxMode` 所聲明的語義只涵蓋檔案系統效果；在 bash `curl` 暢通時給一個僅限 web 的網路旋鈕會是一道假邊界。待某個 bash 後端能強制執行網路策略（bwrap `--unshare-net`、Landlock ABI v4+）時再議。
- **`subagent-acp` 消費端**——沙盒 RFC 中未變的延後階段。
- **單個工作階段中的額外可寫根目錄**——解析後的策略攜帶一個主要 `SessionHeader.cwd`；ACP `additionalDirectories` 仍是獨立的 bridge 與策略設計問題。
- **統一的 per-tool 沙盒執行時期**——因沙盒 RFC 中的理由繼續否決。

## 考慮過的替代方案

- **在 `fs/*` intent 事件上強制執行（沙盒 Agent Note 的原始草圖）**——因 § 強制執行點 中的兩個機制性事實被否決：單一 slot、先到先得且已被佔據，以及對直連 `ctx.fs` 呼叫方的繞過。提供方級強制執行覆蓋每一個呼叫方，並映像檔 bash 的換實作形態。
- **在 `tools/pre-execute` 中執行**——否決：監聽器在 `resolve()` 之前看到模型的原始路徑字串，因此它會重新實作 cwd 默認化與符號連結規範化，並且仍與真正的 resolve 競態。這使其不適用於 `workspace-write`，因為後者需要對規範路徑作出判定。
- **在 `dsh-tool-fs` 中做內聯檢查**——否決：只覆蓋工具路徑（與 intent 事件同樣的繞過），並在規範目標已存在之上重複了一層 resolve 知識。
- **在 `dsh-fs-local` 上加一個 `mode` 標志而非同級後端**——否決：能力事實必須是組合真相，正如 `dsh-bash-local` 對 `dsh-bash-sandbox`；一個設定標志會讓工具的宣告取決於設定，而 bash 家族已經確立了同級包形態。
- **經受限 helper 子行程做核心級 fs 變更**——否決：每次寫入都要啟動一個行程；`editText` 的讀-匹配-寫臨界區不得不整體搬進子行程才能保持原子；而威脅面（可信操作、不可信路徑參數）不需要核心——可信程式碼中的圍欄就是完整答案，而不可信程式碼隔離仍在 `ctx.shell`。
- **帶載入期一致性校驗的 per-family 策略設定**——否決：一個事實兩個歸屬，靠一個必須枚舉每個未來的強制執行家族的校驗來打修補程式；策略服務讓漂移不可表達，而非被偵測到。
- **把覆蓋事件留在 `dsh-shell` 裡作 `shell/sandbox-mode`**——否決：該事件是被兩個家族消費的策略狀態；保留 bash 命名會迫使 `dsh-fs-sandbox` 相依性 bash 詞彙。預發布階段，該改名是同一變更內的遷移，附帶快照重錄，無任何 shim。
- **把升級編排從 approval/agent 包匯入 `dsh-sandbox`**——否決：那會倒置分層（一個基礎詞彙包相依性 UI/agent 包）。結構式 approver 讓邏輯單一來源於 `dsh-sandbox`，而相依性留在本就持有它們的工具層。
- **fs seam 上一個合併的 mutation-options 對象**（per-call 載體最初草擬的形狀）——因摩擦被否決：它會把 `signal` 拆進變更專用的選項包，而讀取仍保持位置參數。一個末尾選填的 `SandboxExecutionPolicy` 匹配 bash 的攜帶並忽略模式，並使 `signal` 在整個 seam 上保持對稱。
- **現在就在 `SandboxPolicy` 上加額外的可寫根授權**——照舊延後：`writableRoots()` 如今由模式含義推導；臨時授權是沙盒 RFC 留下的升級作用域問題。

## 後果

已交付的部分——§ 測試的各層各自釘住：

- 在 `read-only` 下，`write`/`edit` 返回 `[sandbox: file access denied under read-only mode]` 標記，磁碟不受觸動；`read`/`listDir` 與 `dsh-fs-local` 行為一致。
- 在 `workspace-write` 下，變更落在工作區根與臨時目錄下，其外被拒；包含矩陣——`..` 穿越、指向外部的絕對路徑、一個既有的、指向外部的工作區內符號連結目錄、在這樣一個符號連結下新建的文件，以及根路徑的等價別名形式——在真實磁碟上拒絕每一種逃逸，同時允許檔案系統認定為同一目錄的路徑。
- 一個被拒的 fs 變更，攜帶 `sandbox_permissions` + `justification` 重試一次，會經組合的審批鏈提示；一次授權讓恰好那一次呼叫在更寬的模式下執行且寫入落盤；rejected/cancelled/unavailable 各自產生其逐字的 fail-closed 文案且不做任何變更。
- 一次 `permission` 預設切換同時管轄兩個家族：工作階段切換模式後，下一次 bash 呼叫與下一次 fs 變更都從同一個 `sandbox/mode` 摺疊遵循新模式。
- cwd 根目錄不同的並行工作階段透過同一組服務實例攜帶不同策略；兩個家族都不會快取某個工作階段的根目錄供下一次呼叫使用。
- 一次無 per-call 蓋章的直連 `ctx.fs.writeText` 會被圍欄於部署預設值。
- `write`/`edit` 上的升級欄位恰好在被掛載的 `ctx.fs` 受限時存在，在 `dsh-fs-local` 下不存在。
- `agent-loop` 未被觸動——一切都依託於 `ctx.sandboxPolicy`、`ctx.fs` seam、`SessionEventMap` 合併以及工具執行管線。

代價與接受的限制：

- **fs 圍欄是策略邊界，而非核心邊界。** 它的威脅面是模型選定的路徑，而非對抗性宿主行程；resolve 到系統呼叫之間殘留的 TOCTOU 被收窄而非消除，README 已如實聲明。核心邊界仍屬 bash。
- **`dsh-bash-sandbox` 獲得對 `ctx.sandboxPolicy` 的硬相依性。** 每個沙盒化組合要麼加一個 `cordis.yml` 條目，要麼在載入時明確報錯——這是有意的預發布奠基之舉；示例在同一變更內更新。
- **圍欄與 runner 的對等是推匯出來的，而非斷言的。** fs 圍欄與 Seatbelt profile 都從 `writableRoots` 取其可寫集合，一個對等單元測試釘住這些集合；一個 runner profile 若在不經該函式的情況下改變其可寫集合便會漂移。
- **標記與升級教學如今服務於兩個家族。** 措辭改動是 `dsh-sandbox` 中一個構造器背後的協調編輯；重複偵測閘門與釘住的快照維持單一來源，代價是 fs 與 bash 無法在不拆分該構造器的情況下有意地在措辭上分道。

## 測試

- 單元：`dsh-sandbox` 釘住升級階梯、標記構造器、參數配對校驗，以及 `approveEscalation` 的有序 fail-closed 序列（非加寬、無 approval、無 agent、各結果），外加 `writableRoots`/`canonicalPath`。`dsh-sandbox-policy` 釘住部署回退、工作階段模式/根目錄解析、顯式模式優先級、摺疊/setter、載入期模式拒絕，以及 HMR（熱模組替換）安全。`dsh-fs-sandbox` 在真實檔案系統上釘住按策略執行的圍欄與包含矩陣（內部、臨時目錄、絕對路徑-外部、`..`、指向外部的符號連結目錄、其下的新建文件、路徑等於根、檔案系統根、以分隔符結尾的根、等價別名形式），外加 per-call 覆蓋與 HMR 安全。`dsh-tool-fs` 釘住宣告門控、完整策略解析、拒絕標記對映，以及完整的升級矩陣（授權、拒絕、無服務、無 agent、配對、非受限守衛）。`dsh-tool-bash`、`dsh-bash-sandbox` 與 `dsh-permission-presets` 使用同一套策略工具集。
- 無金鑰 e2e：一個真實 Cordis 上下文建立兩個 agent，其工作階段的 cwd 根目錄各不相同；系統並行執行正式發布的 bash 與 fs 工具，再透過外部可觀察結果驗證各自在所屬項目中的寫入成功，而兩次跨項目寫入都被拒絕。
- 快照：acp-agent 示例組合 `dsh-sandbox-policy` + `dsh-fs-sandbox`；被釘住的 header 攜帶 fs 升級欄位與 `sandbox/mode` 事件名，一次性重錄。
