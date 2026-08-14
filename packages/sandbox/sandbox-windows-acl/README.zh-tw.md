# @deepseek-ai/dsh-sandbox-windows-acl

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

面向 [harness 沙盒 seam](../sandbox/) 的 Windows 寫入限制沙盒後端：一個 Node.js/[koffi](https://koffi.dev/) 實作的、對 [huoyaoyuan/windows-acl-restrict-poc](https://github.com/huoyaoyuan/windows-acl-restrict-poc)（`10e4dfb`，固定修訂版本）機制的移植，掛載為 [`@deepseek-ai/dsh-sandbox-local`](../sandbox-local/) 鏈中報告 `enforcement: 'partial'` 的 win32 一級（`workspace-write` / `read-only` 兩種模式）；Linux/macOS 後端在同一包中。

一句話機制：把呼叫者權杖複製為 `WRITE_RESTRICTED` 受限權杖，其 restricting SIDs 攜帶彼此獨立的工作區能力與私有臨時目錄能力。工作區 SID 由規範工作區路徑確定性派生（`workspaceWriteSid`），因此工作區根目錄 ACE 每臺機器每個工作區只物化一次，之後每次工作階段、呼叫或重新啟動都命中精確 ACE 跳過。每個活躍的工作階段/工作區對則獲得一個隨機臨時目錄，以及一個從該路徑派生的 SID（`tempWriteSid`），因此各工作階段共享預期的工作區權限，卻不會繼承彼此的臨時目錄權限。此後 Windows 只在「呼叫者正常權限」與「restricting SID 交集」同時允許時才放行寫入。這些 SID 是主要白名單，在系統其餘位置不授予任何權限；但該檢查還會繼承**其他** restricting SID 的環境寫 ACE（保活組登入 SID + Everyone），而 NTFS ACL 屬於文件對象而非路徑。Everyone 與硬連結邊界正是該檔報告部分而非完整強制執行的原因。

直接建置在原生 ACL 機制上是記錄在案的設計選擇：它實作兩種隔離模式，且不背負被否決的容器方案的問題——見[設計筆記](../../../.agents/notes/implemented/feature/2026-08-08-windows-acl-restricted-token-sandbox.md)（[mxc](https://github.com/microsoft/mxc/blob/main/docs/process-container/os-version-support.md) 要求 Windows 11 24H2 的 OS 下限，且任意路徑讀取需要整體改寫宿主 DACL；AppContainer 根本無法任意路徑讀取）。

## 用法

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AclSandbox, tempWriteSid, workspaceWriteSid } from '@deepseek-ai/dsh-sandbox-windows-acl'

const workspaceRoot = process.cwd()
const tempDir = mkdtempSync(join(tmpdir(), 'dsh-'))

// mode selects the token's restricting-SID list (see Modes below) and must
// match the grant shape. workspace-write requires distinct workspace and
// private-temp identities; pass tempDir: null to disable temp writes.
const sandbox = new AclSandbox({
  writableDirs: [workspaceRoot],
  tempDir,
  writeSid: workspaceWriteSid(workspaceRoot),
  tempWriteSid: tempWriteSid(tempDir),
  mode: 'workspace-write',
})
await sandbox.init() // throws on ANY Win32 failure — never spawns unrestricted

const child = sandbox.spawn({ command: 'pwsh', args: ['-NoProfile', '-Command', '...'], cwd: workspaceRoot })
const { stdout, stderr, exitCode } = await child.wait()

sandbox.dispose() // revokes the revocable (temp) grant, keeps the standing workspace ACE; reports every cleanup failure
rmSync(tempDir, { recursive: true, force: true })
```

直接使用 `AclSandbox` 時，必須顯式提供私有臨時目錄（或透過 `tempDir: null` 停用臨時寫入；環境臨時根目錄絕不會被隱式授權），工作區 ACE 以**常駐**方式授予（`dispose()` 保留它們——它們是跨實例的複用快取），不同的臨時 SID 則以**可回收**方式授予。伺服器端複用則是 `AclWriteGrant` 類：每個目錄一次 `add(path, standing)`，`dispose()` 撤銷可回收路徑並釋放 SID——見下方 runner 契約。本包中的每個 Win32 API 呼叫都有檢查；失敗拋出 `Win32Error`，攜帶 API 名、精確 Win32 錯誤碼、`FormatMessageW` 系統文字和失敗的路徑/上下文。這是刻意的：POC 忽略每個回傳值，當 `CreateRestrictedToken` 失敗時用完整無限制權杖靜默執行子行程（fail-open）。本移植從構造上 fail-closed。

<a id="the-confinement-runner"></a>

## 隔離 runner

面向 seam 的形態是 **runner 入口**（`./runner`）：`@deepseek-ai/dsh-sandbox-local` 在呼叫者命令的位置 spawn 的 argv 前綴包裝——與 bwrap/landlock-run/sandbox-exec 同一架構，因此沙盒 seam 的 `confine()` 契約無需改動。穩定的 argv 契約：

```sh
node runner.js --workspace <dir> --temp <dir> --mode <read-only|workspace-write> [--write-sid <S-1-4-…> --temp-write-sid <S-1-4-…>] -- <argv...>
```

runner 建立受限權杖，在它之下 spawn 包裝後的 argv，呼叫者的 stdio 直接透傳（呼叫者的管道在 spawn 前後被設為可繼承——Node 在啟動時清除 stdio 可繼承性，裸 spawn 必須補償這一點），把子行程包進 `KILL_ON_JOB_CLOSE` job（runner 死亡則子行程死亡），忽略自身的控制台 Ctrl+C 讓子行程自行處理，映像檔子行程的結束碼，並在結束時撤銷其自行管理的臨時授權（工作區 ACE 常駐）。每個 runner 側失敗都會向 stderr 列印 `windows-acl-run: <detail>` 並以 127 結束——seam 的 `RUNNER_FAILURE_RULES` 匹配該簽名，因此 runner 拒絕永遠不會被誤判為拒絕授權。

**工作區複用與臨時隔離**：seam 先把確定性工作區 SID 的 ACE **常駐**物化（每個工作區每伺服器生命週期一次，絕不撤銷——它就是複用快取），再為每個活躍的工作階段/工作區對建立隨機私有臨時目錄和不同的可回收 SID。它把兩種身份作為必須成對出現的 `--write-sid`/`--temp-write-sid` 傳入；runner 對照各自所屬路徑驗證二者，既不授權也不撤銷（`manageDacls: false`）。fork 獲得不同的臨時能力；即使復原的是同一工作階段，新的提供方也會給出新的路徑和 SID，因此崩潰殘留只是失效垃圾，而非衝突或繼承的能力。如果不帶這一對標志，`--temp` 指定的是根目錄：無 agent（代理）/獨立的 workspace-write runner 會建立隨機私有子目錄，自行管理其臨時 SID，重寫 TMP/TEMP，並在結束時移除該子目錄。工作區若等於或包含該根目錄，會在任何授權前被拒絕，因為否則其可繼承的工作區 ACE 會向每個私有子目錄授權；直接 API 同樣拒絕任何可寫根目錄與實際私有臨時目錄重疊。重新啟動後重新授權常駐工作區 ACE 是冪等的：`grantWrite` 讀取當前 DACL，當完全相同的 ACE 已存在時跳過 `SetNamedSecurityInfoW`（應用該 ACE 會把相同的 ACE 急切地重新傳播到整棵樹——大型工作區上以分鐘計）。已知代價：大型工作區樹的首次授權會阻塞整次急切傳播，每臺機器每個工作區一次。

模式（權杖的 restricting-SID 清單隨模式而變；保活組登入 SID + Everyone 在**兩種**模式下都存在——沒有它們早期 DLL 初始化會以 `0xC0000142` 死亡、CNG 會讓 pwsh 以 `0xE0434352` 崩潰）：
- `workspace-write`（登入 SID、Everyone、工作區 SID、臨時 SID）：工作區與工作階段的**私有**臨時子目錄分別攜帶 Write 授權；受 ACL 管轄的其他寫入都會被拒絕，已記錄的 Everyone 與硬連結邊界除外。
- `read-only`（登入 SID、Everyone——**不含**寫入 SID）：不存在顯式的寫入 SID 授權。寫入 SID 有意留在清單**之外**：先前 workspace-write 時期留下的常駐授權 ACE（`/permission` 降級，或崩潰後復原的工作階段）在 read-only 下保持**失效**，因為 write-restricted 的 pass-2 檢查只授予 restricting 清單所攜帶的內容——而常駐 ACE 讓重新升級免於重新傳播。Everyone 的環境權限仍構成已記錄的部分強制執行邊界。NUL 寫入是**環境性**的、不是被授權的：設備 DACL 授予 Everyone 讀+寫+執行（`0x1201BF`），因此訪問掩碼落在其內的打開者（cmd 的 `> NUL`、node 的 `\\.\NUL`）在**兩種**模式下都能寫——只要 Everyone 還在保活組裡，沙盒就無法把 NUL 設備歸零。`Set-Content NUL` 在兩種模式下都失敗（PowerShell/.NET 層效應，由 read-only 套件釘住——拒絕方不是設備 DACL）；PowerShell 的 `> $null` 重定向不受影響（它直接丟棄、不打開 NUL）。

Authenticated Users 在**兩種**清單中都不存在——WMI 命名空間安全檢查失敗（`0x80041003`），因此 CIM cmdlet 與 `Get-ComputerInfo`（它靜默返回不完整結果而非報錯）在**所有**受限模式下都不可用，且 C:\-root 樹建立逃逸（常駐的 `AU:(AD)` + `AU:(OI)(CI)(IO)(M)` ACE）在兩種模式下都被關閉——面向模型的表面記錄的是該契約，而不是提示詞承諾。INTERACTIVE/LOCAL 在兩種清單中同樣不存在：宿主的 Public 樹向 INTERACTIVE 授予寫權限，因此 Public 寫入被拒絕——由 runner 的環境可寫 Public 探針回歸測試釘住（見設計筆記）。

`AclSandbox` 類（顯式私有 `tempDir` + `tempWriteSid`，或用 `tempDir: null` 停用臨時寫入）仍是直接 spawn 的程式設計 API；`AclWriteGrant` 是授權生命週期的伺服器端物化一半。

## 頭部驗證

所有常數、簽名與結構體版面配置都在開發機上對照 Windows 頭文件（MinGW `winnt.h` / `accctrl.h` / `aclapi.h` / `securitybaseapi.h` / `sddl.h` / `processthreadsapi.h` / `fileapi.h` / `namedpipeapi.h` / `synchapi.h` / `winbase.h`）驗證過，並在執行時期由 [`verify/abi-probe.cpp`](verify/abi-probe.cpp)（大小、偏移、枚舉值、靜態斷言）交叉檢查：

```sh
g++ -std=c++20 -municode -O2 -o abi-probe.exe verify/abi-probe.cpp -ladvapi32 && ./abi-probe.exe
```

koffi 結構體定義在模組載入時對照探針斷言其大小，因此頭文件/koffi 版面配置漂移會大聲失敗而不是破壞記憶體。

## 已驗證邊界（受限權杖固有，非本移植引入）

- **Everyone 授權仍是環境中的寫權限來源。** Everyone 必須保留在兩種 restricting 清單中：移除它會破壞早期 DLL 初始化與 CNG。因此，如果外部 NTFS 對象的正常 DACL 向 Everyone 授予所請求的寫權限，它就會同時透過兩次訪問檢查，並在兩種模式下保持可寫。真實 runner 套件設定一個外部 `Everyone:Modify` 目錄並釘住該行為；提供方報告 `enforcement: 'partial'`，使呼叫方能夠拒絕或向上暴露這項較弱的邊界。
- **硬連結是文件對象別名，而非路徑別名。** 傳播到已有 NTFS 硬連結上的可繼承工作區 ACE 會修改底層同一文件的安全描述符，因此同一對象也可透過外部別名寫入。拒絕工作區中的所有多連結文件不具可行性，因為普通 pnpm 安裝會使用硬連結指向其內容尋址儲存；原生 runner 套件釘住該缺口，提供方的部分強制執行報告則點明其後果。
- **寫入受限；讀取、網路與行程可見性不受限。** `WRITE_RESTRICTED` 只交叉檢查寫訪問，因此受限子行程可以讀取呼叫者可讀的任何文件並打開Socket。`read-only` 模式因而不能僅靠該機製表達；將其與讀側策略或 AppContainer/`S-1-15-2` capability 權杖配對以獲得更強隔離。
- **控制台隔離不可用。** 在受限權杖下，以 `CREATE_NO_WINDOW` / `CREATE_NEW_CONSOLE` 建立的子行程在 DLL 初始化期間以 `STATUS_DLL_INIT_FAILED`（`0xC0000142`）死亡。POC 嘗試把控制台登入 SID（`S-1-2-1`）加入 restricting 清單來修復；在 Windows 11 26200 上 `CreateWellKnownSid(WinLocalLogonSid)` 以 `ERROR_INVALID_PARAMETER`（87）失敗，正確的 `WinConsoleLogonSid` 能產出合法 `S-1-2-1` 但子行程仍然死亡，POC 的最終修訂同時移除了該 SID 與控制台隔離。子行程因此共享宿主控制台；stdio 重定向走管道，不受影響。
- **ACL 授權是對真實目錄的駐留改動。** 行程中途死亡會留下授權；工作區 ACE **按設計**常駐（絕不撤銷——複用快取），臨時 ACE 由 `dispose()` 撤銷（後續步驟失敗時 `init()` 也會撤銷已應用的臨時授權）。POC 註解裡的手工清理命令（`icacls <dir> /remove '*S-1-4-…'`）在本平臺實測失敗（`ERROR_NONE_MAPPED` 1332）——請透過本模組回收。工作區 ACE 在例外關閉後無需自愈：派生 SID 在下一次供給時重新命中常駐 ACE（跳過應用）；寫入 SID ACE 不會因每次重新啟動而累積第二個身份，因為身份**就是**工作區。
- **被授權目錄必須由呼叫者擁有。** 所有者的隱式 `WRITE_DAC` 是沙盒無需提權即可編輯 DACL 的原因。
- **環境臨時根目錄絕不會被隱式授權。** 直接使用 `AclSandbox` 的 workspace-write 呼叫方必須提供一個已存在的私有 `tempDir` 及其不同的 `tempWriteSid`，或透過 `tempDir: null` 顯式停用臨時寫入。實際臨時目錄不得與任何可寫根目錄重疊。seam 會建立隨機私有目錄；無 agent runner 呼叫把 `--temp` 視為父根目錄並自行建立隨機子目錄，但如果工作區等於或包含該父根目錄，就會在任何 ACL 改動前拒絕呼叫。
- **受限子行程的臨時能力按每個活躍的工作階段/工作區對私有。** runner 在 spawn 之前用 `SetEnvironmentVariableW` 把 TMP/TEMP 改寫為該私有目錄，子行程繼承改寫後的環境塊（bwrap `--tmpfs /tmp` 的語義）。臨時 ACE 與目錄會在提供方 dispose 時移除，或在每次無 agent 呼叫後移除。崩潰可能留下失效的 `%TEMP%` 垃圾，但復原後的提供方會選擇新的隨機路徑和 SID，而不會與殘留發生衝突或重新向其授權。原生 runner 套件證明，共享同一工作區 SID 的兩個權杖無法寫入彼此的臨時目錄。
- **受限權杖下 `whoami` 與權杖檢查 cmdlet 會失敗。** 子行程對複製權杖的 `GetTokenInformation` 部分不可用，因此 `whoami /all` 報錯——這是限制方案的診斷噪音，不是執行故障；真正重要的拒絕面（文件寫入）不受影響。

## 模型體驗

間接地透過 [`dsh-bash-sandbox`](../../shell/bash-sandbox/README.md)、[`dsh-pwsh-sandbox`](../../shell/pwsh-sandbox/README.md) 及其工具呈現：它們算繪此後端的部分強制執行與拒絕事實（工具層透過 `denialSignatures` 分類的受限 stderr），而 [`dsh-sandbox`](../sandbox/README.md) seam 擁有 `SANDBOX_UNAVAILABLE` 文字與 runner 選擇。

#### KV Cache 影響

無直接影響；拒絕面屬於工具層。

## 已知限制與暫緩事項

- **每個工作區一個寫入白名單** —— 寫入 SID 是白名單的基本單位，且**就是**工作區身份；同一沙盒實例跨兩個工作區複用時，兩個根目錄會互相擴大授權面（同一個 SID 將命名兩個根）。請按工作區根目錄各建一個實例——seam 正是這樣做的，以工作區路徑為鍵。
- **清理按設計盡力而為** —— `dispose()` 會嘗試全部臨時撤銷並把失敗聚合為 `AggregateError`；清理失敗可能留下隨機目錄及其僅含臨時 SID 的 ACE。行程結束後，不會再有權杖攜帶該 SID，因此殘留保持失效，直到 OS 臨時目錄衛生或手動移除目錄將其回收。
- **常駐工作區 ACE 是不可見殘留。** 工作區改名會派生新的 SID；舊路徑上的舊 ACE 留在原地（失效、僅含寫入 SID）。未來的清理命令可以回收它們；它們不會引起任何重新傳播。
- **NULL-DACL 目錄在 grant+revoke 往返下不保持身份。** 帶 NULL DACL 的目錄（罕見——Windows 建立的目錄都帶真實 DACL）意味著「所有人完全控制」；`grantWrite` 從該 null 建置新 ACL，撤銷往返後留下的是 EMPTY（全部拒絕）DACL 而非原始 NULL DACL。POC 行為相同；真實工作區與臨時目錄都帶真實 DACL，因此這仍是記錄在案的邊界情形而非守護路徑。
- **受限孫行程的管道 stdio 捕獲不可用（named pipe 的預設 SD 樣板）。** libuv 的管道 stdio 用的是 NAMED pipe；不帶安全屬性呼叫 `CreateNamedPipeW` 時，其預設安全描述符不是核心的樣板，而是 Win32 層在使用者態安裝的預設 SD 樣板（由 KernelBase 建置——owner/SYSTEM/Admins 全權，Everyone/ANONYMOUS 只讀，即 [MS 文件](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights)記載的固定樣板）——**不是**權杖預設 DACL（後者纔是核心在原始 SD-null 建立時應用的）——因此 client 端打開所請求的寫訪問沒有任何 restricting SID 被授予：受限行程內 `spawn(..., { stdio: 'pipe' })` 以 EPERM 失敗，這是 POC 記載的 WRITE_RESTRICTED「無法重定向輸出」邊界。繼承（`inherit`/fd）與忽略（`ignore`）stdio 的 spawn 可用；匿名管道（CreatePipe——權杖預設 DACL 的消費者，例如 PowerShell 的管道）因受限權杖預設 DACL 攜帶 restricting SID 全權 ACE（init 時寫入）而可用。受限行程因此無法用管道捕獲孫行程輸出；必須捕獲輸出的工具無法在受限下執行。
- **授權物化是急切的全樹傳播。** 在帶可繼承 ACE 的目錄上呼叫 `SetNamedSecurityInfoW` 會立即遍歷每個後代（**不是**按訪問惰性進行——大型工作區樹上實測數十秒）。按工作區身份每臺機器每個工作區只付一次（在首次受限執行時惰性進行，之後每次供給在精確 ACE 常駐時完全跳過）。私有臨時目錄建立時為空，因此其獨立授權開銷很小。如果工作區巨大，該主機上的第一次受限寫入相應變慢。
- **讀側隔離與網路策略不在範圍內** —— `WRITE_RESTRICTED` 只交叉檢查寫訪問；將此後端與讀側策略配對以獲得更強隔離。
- **寬目錄與 FAT 卷警告已推遲；FAT 類目標保持可寫。** 對例外寬的目錄或 FAT 類（非 ACL）卷的 UI 側警告尚未實作，且 FAT 卷作為授權**根**只會大聲失敗（無 ACL 支援）。授權根**之外**的 FAT 類目標則不同：它沒有安全描述符，因此受限權杖的寫檢查透過（Everyone 在兩種清單中都在）——此類目標在**兩種**受限模式下都可寫。FAT 被視為殘留殘留——不受支援、不圍繞它設計；此處記錄的是這種僅警告的立場，而非緩解措施。
- **PowerShell 語言模式因受限模式而異。** 在 `read-only` 下，PowerShell 無法在臨時目錄中建立 AppLocker 探針文件，因此會保守地以 ConstrainedLanguage 啟動：`Add-Type`（C# 編譯、P/Invoke）、非核心 .NET 靜態呼叫（`[System.IO.*]::`、`[math]::`、`[Environment]::`）、COM 對象與反射以 `Cannot create type` / `Cannot invoke method`（「only core types」）錯誤失敗，且 `$ExecutionContext.SessionState.LanguageMode = 'FullLanguage'` 被拒絕。交付的 `workspace-write` 路徑擁有私有臨時目錄能力，可使該探針完成，因此除非主機範圍的 WDAC/AppLocker 策略另有規定，否則 pwsh 保持 FullLanguage；直接使用 `AclSandbox` 並設定 `tempDir: null` 時則沒有這一保證，探針可能像 read-only 一樣失敗並按 fail-closed 處理。這一區別屬於 PowerShell 啟動行為，不是 ACL 寫入邊界的一部分。`pwsh` 工具描述向模型傳授這些交付模式；`danger-full-access` 呼叫不受限地在 FullLanguage 下執行。
