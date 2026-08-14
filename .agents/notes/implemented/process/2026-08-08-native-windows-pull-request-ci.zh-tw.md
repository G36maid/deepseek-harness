# Agent Note: Wine 與原生 Windows 雙通道Pull Request CI

Status: implemented

[English](2026-08-08-native-windows-pull-request-ci.md) | [简体中文](2026-08-08-native-windows-pull-request-ci.zh.md) | 繁體中文

## 問題

Pull Request必需的 Windows 判定既需要快速的 win32 工具鏈訊號，也不能讓聚合流程等待稀缺的 Windows 容量。Wine 提供這項關鍵路徑訊號，但它執行在 Linux 核心與區分大小寫的 ext4 之上，採用 hoisted 相依性版面配置，且無法證明 NTFS、DACL、ConPTY、崩潰持久性或原生行程行為。原生序列參考流程停用期間，每個Pull Request分支頭還需要自動取得真實 Windows 核心結果。

覆蓋率審計發現，過時分支狀態復原了針對受支持 LSP 原始碼的臨時排除項。因此，原生 Windows 需要按同一逐文件 100% 閾值執行完整的受支持原始碼清單，而不能相依性縮小後的平臺專用分母。

## 決策

[ci.yml](../../../../.github/workflows/ci.yml) 中必需的 `windows` 作業仍是在 `ubuntu-latest` 上執行的 `windows node 24 / wine blocking`。它保留經過校驗和驗證的 Windows Node、Wine apt 與 pnpm 快取、僅限工作區快照的 hoisted 安裝，以及執行工作區建置與生產網站的[共享 Wine 閘門指令碼](../../../../scripts/wine-windows-gates.sh)。Node 分發文件傳輸採用有界重試；nodejs.org 的大文件傳輸停滯時，由支持範圍請求的傳輸映像檔續傳相同位元組，但版本和 SHA-256 權威仍屬於 nodejs.org，歸檔透過該校驗前絕不會投入使用。穩定的 `windows` 作業 ID 仍是 `all checks passed` 的相依套件。[已歸檔的 Wine 實驗](../../archived/process/2026-07-27-wine-windows-gates-experiment.md)保留其實測取捨，而本文負責當前雙通道拓撲。

每個Pull Request還會在組織自有的 `dsh-windows-2025-16core` 執行器上啟動一個常規且獨立的 `windows-native` 作業，名稱為 `windows node 24 / native complete`。該作業為工作區符號連結啟用開發人員模式，透過 `pnpm/action-setup` 提供倉庫固定版本的 pnpm，在不傳輸 store 歸檔的情況下執行不可變安裝，並在原生 PowerShell 下執行 `pnpm run check:ci:windows-complete`。閘門卡住時，60 分鐘逾時會為其設定上限，同時不把實測效能目標當作正確性截止時間。

原生作業被刻意排除在 `all-checks-passed.needs` 之外，且不使用 `continue-on-error`：聚合流程既不等待它，也不會因它改變結論；該作業則保留自身未被掩蓋的結果。工作區建置、生產網站和逐文件 100% 覆蓋率檢查失敗會使原生作業失敗。更廣泛的靜態檢查、文件、包和建置產物可移植性清單仍作為觀測項報告。重複的 lint 與快照強制檢查仍由 Linux 負責，原生 Windows 則獨立強制執行受支持原始碼覆蓋率。

16 核通道為覆蓋率分配 2 個工作執行緒，其中 1 個用於插樁套件，1 個用於免覆蓋率項較多的套件；同時執行 2 項頂層閘門，並允許 8 個 publint 工作執行緒。每個 Vitest 項目都使用 fork 工作執行緒，因為 Node 24 的 CJS lexer 致命故障可在 Windows 與 POSIX 的共享工作執行緒中復現；雙閘門調度可避免免覆蓋率項較多的 Oxlint 探測與工作區建置在臨時約定文件上發生競態。對於真實行程、Git、SQLite、watcher 或延遲文法啟動可能超過 Vitest 的默認輪詢視窗的非同步 fixture，系統會使用顯式的有界等待，而不改變其斷言結果。LSP 原始碼與 ACL 沙盒原始碼仍計入 Windows 分母：基於 stub 的失敗路徑套件把每個行程內 ACL 沙盒文件都帶到 100%，只有 runner 入口保持排除——它只作為 spawn 出的子行程在插樁執行之外執行，其行為由 runner 套件端到端釘住。窄範圍且帶註釋的 V8 ignore 只覆蓋不可達分支（另一平臺專屬分支、生命週期內不可達的防禦守衛），其行為測試仍保留在所屬平臺。

16 核設定是這項清單經實測選定的容量規格。與此前的雙核序列作業相比，6 個覆蓋率工作執行緒曾分別以 6 分 27 秒和 7 分 50 秒跑出完整透過結果，但後續的分支頭精確復跑先後在 4 個、3 個和 2 個插樁工作執行緒並行時暴露出不穩定的 fixture 與工作執行緒退出。因此，所選預算將這一扇出降至 1，同時保留免覆蓋率項較多的套件作為第二個並行覆蓋率工作執行緒，並繼續讓兩項頂層閘門重疊執行。32 核對比僅將聚合閘門時間縮短 1.47 秒，且仍在 fork 工作執行緒內觸發 CJS lexer 致命故障，因此增加核心數沒有帶來可靠的牆鐘時間改善。

首次原生執行暴露出兩項被相容性通道掩蓋的故障。文件投影測試此前只按 `/` 拆分來派生圖片 basename；現在改為使用 Node 根據平臺計算的 basename。Chokidar 消費端收到的 `%TEMP%` 以 `C:\\Users\\RUNNER~1` 這個 8.3 別名錶示，而 libuv 返回的是長目錄名，導致其 Windows 事件路徑斷言失敗。共享的設定 watcher 與憑據 watcher，以及 Cordis 的模組 HMR（熱模組替換）與精確設定 HMR，現在都會在打開 watcher 前規範化現有的原生監聽基準路徑或層級最深的現有祖先路徑，並保留尚不存在的後綴；文件訪問和診斷仍使用設定路徑。模組 HMR 會掛接監聽器並等待主 watcher 的 ready 事件，之後外掛程式啟動才會完成，因此啟動後立即發生的編輯無法與初始掃描形成競態。HMR 驗收透過相同的非同步原生 realpath 操作派生預期身份，避免同步 Windows 路徑寫法仍保留 8.3 別名。

可移植檔案系統 fixture（測試前置資料）透過 `node:path` 派生路徑、比較原生 realpath 標識、在 Node 啟動器邊界保留文件 URL，只規範化由 API 負責的分隔符或行尾，並使用每個宿主均允許的檔名。僅適用於 POSIX 的訊號、模式位、不可讀狀態和 writer lock 場景按平臺設閘門；可移植故障約定則透過每個宿主均可構造的衝突，斷言結構化錯誤碼、回滾、最後有效狀態、原子替換及不存在臨時殘留。憑據權限驗證採用無效路徑 fixture；該路徑在每個宿主上都會於系統尋找前產生表示“非缺失”的 `ERR_INVALID_ARG_VALUE`，而不相依性文件祖先究竟產生 `ENOTDIR` 還是 `ENOENT`。worker 死亡 fixture 會先觀察其協議前置條件，再由宿主觸發真實終止，而不在巢狀 Windows Worker 中呼叫 `process.exit()`；這樣既保留了 worker 退出約定，也不會讓外圍 Vitest fork 暴露於 Node 行程級的原生退出斷言。壓力與整合工作負載保留原有斷言；如果 Windows 插樁或行程拆卸可能超過 Vitest 默認上限，就為其設定顯式的有界時間預算。

原生 watcher 使用 `canonicalizeWatchPath()` 對層級最深的現有祖先執行 realpath 解析；後綴缺失時，先證明該祖先是可枚舉目錄，再拼回後綴。這可避免 Windows 8.3 別名與長格式 libuv 事件混用，並讓所有宿主在祖先為普通文件時都保留 `ENOTDIR`。設定、憑據、skill（技能）根與 Cordis HMR（熱模組替換）在發現和診斷時保留設定路徑；模組 HMR 則使用規範寫法作為 Node 載入快取標識、掛接監聽器並在外掛程式啟動完成前等待主 watcher 就緒，因此啟動後立即發生的編輯不會與初始掃描形成競態。`watchFollowSymlinks: false` 時，若 skill 根本身是符號連結，系統不會展開最後這一級連結，從而讓 Chokidar 強制執行該邊界。

Windows 的持久 JSONL 路徑會保留驅動器根目錄的原生寫法，並僅對後代路徑與暫存路徑應用擴充長度命名空間。ACP（Agent Client Protocol）拆卸階梯使用真實 Node 子行程，以符合宿主詞義的結果證明優雅終止與強制終止兩個層級，並避免聲稱 Windows 會交付 POSIX 訊號。產品接受裸命令時，可執行 fixture 會提供 `.cmd` 包裝指令碼與 `PATHEXT`。repository-cache 輔助包位於所選 Git 子路徑內，因此它們聲明的 `file:` 相依性會在 Windows 上以相同方式暴露命令包裝指令碼。隨附的安裝器會匯出 pnpm 自有的 workspace-ignore 設定，保留 `PNPM_HOME` 作為 pnpm 資料設定，同時從生命週期 `PATH` 中移除該目錄，並在 `PATHEXT` 中優先選擇 `.CMD`；因此，巢狀 Git 包安裝既不會重新加入外層 workspace，也不會讓繼承的 Windows pnpm 可執行文件搶在交易持有的 wrapper 之前。

啟動後，只有根 fiber 與 Loader 均處於活躍狀態時，系統才會繼續設定 profile watcher。只有當同一次呼叫所記錄的訊號已取得關閉流程所有權時，系統才會隔離並行設定錯誤；無關 HMR 故障仍會響亮失敗。[行程關閉控制器](../bug-fix/2026-08-03-cli-signal-shutdown-escalation.md)會在根級 dispose 成功後讓單次任務的正常完成流程排空 Node 剩餘控制代碼，同時讓拆卸失敗、截止時間到期和訊號升級繼續強制退出。vendored Include 會序列化防抖寫入，只對瞬時訪問或忙碌故障執行有界退避重試，並確保每個由計時器觸發的拒絕都得到觀察。持久化最終失敗後，該故障會保留在佇列中，並重新拋給拆卸責任方；成功拆卸則會排空最新寫入。

Shiki 會停用 TextMate 正則的延遲編譯，並在使用者內容進入保持不變的逐行 tokenization（詞元化）預算前預熱每種啟動文法，從而避免調度器爭用發布不完整的高亮流。Codex 真實產品 fixture 固定使用穩定版 0.147.0 schema，並選擇實際提供的命令工具與對應參數形態；這樣既保留由提供方負責的協議，也能在每種宿主上證明無人值守拒絕和整棵行程樹退出。

## 曾考慮的替代方案

**讓原生 Windows 成為 `all checks passed` 的相依套件。** 這會為聚合流程提供保真度最高的 Windows 判定，但也會讓每次合併等待最慢的託管作業與 Windows 容量。獨立結果能讓該訊號保持自動產生，而不改變現有必需路徑。

**只在Pull Request上執行 Wine。** Wine 能快速觸達阻斷性 win32 工具鏈分支，但即使真實 NT、NTFS、PowerShell、行程或原生外掛程式約定已經損壞，也可能報告綠燈。

**將原生作業標記為 `continue-on-error`。** 閘門失敗後，該設定會讓其檢查顯示為成功。保留常規獨立作業可維持診斷結論；僅從聚合流程的 `needs` 中省略它，纔是不阻斷的機制。

**排除看似不受支持的文件或削弱 Windows fixture。** 不予採納，因為受影響的 LSP、watcher、持久化、用戶端與行程行為均受支持。僅適用於另一平臺的分支採用窄範圍標注；可移植結果繼續計入分母，並透過符合真實宿主行為的 fixture 驗證。

**保留 GitHub 標準的 `windows-2025` 執行器。** 該可移植雙核映像檔能可靠完成這份完整清單，但其 32 分鐘的序列結果使自動原生訊號的實用性遠低於所選的 16 核執行器。

**使用 32 核或更大的執行器。** 32 核對比僅比 16 核將聚合閘門時間縮短 1.47 秒，且仍因 Node 的 CJS lexer 失敗；先前高並行的 32 核和 64 核試驗也以同類故障失敗。因此，增加容量只會提高資源分配成本，卻不能帶來穩定的端到端收益。

## 後果

Wine 保留必需聚合流程現有的關鍵路徑和作業身份。`all checks passed` 變綠時，原生 Windows 仍可能處於待處理或紅燈狀態，因此分支保護採用 Wine 結果，而評審者和後續自動化採用獨立的原生結果。

儘管如此，每個Pull Request都會獲得真實 NT 核心、NTFS、PowerShell、Windows 行程、原生外掛程式和受支持原始碼覆蓋率訊號。原生作業會重複設定流程與兩項阻斷建置，在標準映像檔上明顯更慢；但它也會暴露相容性通道掩蓋的路徑、watcher、生命週期與 fixture 缺陷。

維護者必須保留兩種有意設計的執行拓撲：Wine 快照使用 Linux 安裝加 hoisted 版面配置來觸達 win32 二進位檔案，而原生作業在組織自有的 16 核 Windows 執行器上使用不可變工作區。任一作業獨有的失敗都必須依據該邊界分類，不得削弱或靜默跳過。
