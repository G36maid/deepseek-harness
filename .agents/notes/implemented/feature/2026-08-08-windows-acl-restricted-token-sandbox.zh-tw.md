# Agent Note: Windows sandbox rung: raw ACL restricted tokens over mxc and AppContainer

Status: implemented

[English](2026-08-08-windows-acl-restricted-token-sandbox.md) | [简体中文](2026-08-08-windows-acl-restricted-token-sandbox.zh.md) | 繁體中文

## 問題

最初的[沙盒決策](2026-07-06-sandbox.md)將 `PLATFORM_CHAINS.win32` 留空，因此交付的 Windows profile 因不存在隔離執行器而退化為 danger-full-access。win32 檔必須約束沙盒詞彙表中的兩種文件效果模式——`read-only`（不顯式授予任何可寫根目錄）與 `workspace-write`（允許寫入工作區根目錄及後端定義的臨時區域）——並報告其機制無法約束的任何效果；讀取、網路與行程可見性仍在這套詞彙之外。

## 決策

直接基於原始 ACL 機制實作該檔：把呼叫者權杖複製為 `WRITE_RESTRICTED` 受限權杖（`CreateRestrictedToken`，`WRITE_RESTRICTED` + `DISABLE_MAX_PRIVILEGE` + `LUA_TOKEN`），其 restricting SIDs 攜帶彼此獨立的工作區能力與私有臨時目錄能力。`WRITE_RESTRICTED` 只對寫訪問做交集檢查，因此讀取保留呼叫者的環境訪問，而寫入還必須匹配這些能力 ACE 之一。該機制來自 huoyaoyuan/windows-acl-restrict-poc（`10e4dfb`）的演示；本移植檢查每個 API 呼叫並 fail-closed（POC 因忽略失敗而 fail-open）。工作區 SID 由規範工作區路徑確定性派生（`workspaceWriteSid`——sha256 → `S-1-4-x-y`）；其常駐工作區 ACE 是跨工作階段複用快取，精確 ACE 跳過可避免重複的急切全樹傳播。每個活躍的工作階段/工作區對則獲得一個隨機私有臨時目錄，以及一個從該路徑派生的、經過域分離的 SID（`tempWriteSid`）；其 ACE 可回收，TMP/TEMP 指向該目錄，權杖默認 DACL 列入該臨時 SID，因此新建的臨時對象不會獲得共享的工作區能力。fork 因此無法寫入同級工作階段的臨時目錄樹。即使復原的是同一工作階段，新的提供方也會選擇新的路徑和 SID，因此崩潰殘留只是失效垃圾，而非衝突或繼承的能力；無 agent（代理）的呼叫會逐呼叫建立並移除同樣的形態。環境臨時根目錄絕不會被隱式授權。如果工作區等於或包含臨時根目錄，呼叫會在任何 ACL 改動發生前失敗，因為否則其可繼承的常駐 ACE 會向每個私有子目錄授權；直接 API 會拒絕可寫根目錄與實際私有臨時目錄在任一方向上的重疊。PowerShell 可藉助這項私有臨時目錄能力完成啟動時的 AppLocker 探針，因此在沒有主機範圍策略時，`workspace-write` 會保持 FullLanguage；`read-only` 無法建立探針文件，會保守地進入 ConstrainedLanguage。這一區別屬於 PowerShell 啟動行為，不是 ACL 邊界的一部分。權杖清單為 read-only = [登入 SID、Everyone]，workspace-write = [登入 SID、Everyone、工作區 SID、選填臨時 SID]。登入 SID + Everyone 是保活不變式（沒有它們，早期 DLL 初始化會以 0xC0000142 死亡，CNG 會讓 pwsh 以 0xE0434352 崩潰）。由於 Everyone 仍在清單中，向 Everyone 授予寫訪問的外部對象會透過兩次檢查；由於 NTFS ACL 屬於文件對象，工作區內獲授權的硬連結也會使同一對象的外部別名獲得授權。拒絕所有硬連結會讓普通 pnpm 工作區不可用，因此提供方報告 `enforcement: 'partial'`，原生套件則釘住這兩個缺口。Read-only 不含任何能力 SID，因此常駐工作區 ACE 在模式降級後保持失效。Authenticated Users 在兩種清單中都不存在——CIM 不可用，從而關閉 C:\-root 建樹逃逸——INTERACTIVE/LOCAL 也不存在，因此 Public 樹寫入被拒絕。新建匿名管道和同步對象透過 `SetTokenInformation(TokenDefaultDacl)` 繼承臨時 SID（停用臨時目錄時繼承工作區 SID，read-only 下繼承 Everyone）；named pipe 保持 Win32 層 owner/SYSTEM/Admins 全權、Everyone/ANONYMOUS 只讀的範本，因此受限孫行程的管道 stdio 仍被拒絕。它以 [`@deepseek-ai/dsh-sandbox-windows-acl`](../../../../packages/sandbox/sandbox-windows-acl/README.md)、[`dsh-sandbox-local`](../../../../packages/sandbox/sandbox-local/README.md) 的 `win32` 檔，以及作為隔離執行器的 [`@deepseek-ai/dsh-pwsh-sandbox`](../../../../packages/shell/pwsh-sandbox/README.md) 交付。

## How the restriction works (why no new identity)

身份路線靠"**誰**在跑子行程"來限制，本檔靠"權杖派生"來限制。身份路線（landstrip 的 restricted-user、AppContainer）用全新帳戶或容器 SID 執行子行程，該身份在宿主的文件上從零條 ACE 開始——一切訪問（包括讀）默認拒絕，子行程要碰的每條路徑都必須事後為那個身份補寫 ACE 才能放行：這正是讓兩個備選方案出局的全盤 DACL 改造。受限權杖保留呼叫者自己的 SID 與 logon session：[`CreateRestrictedToken`](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken) 派生一個加入 restricting SIDs 與 `WRITE_RESTRICTED` 標志的權杖，於是 Windows 做兩次訪問檢查——一次按正常 SID，一次按 restricting SIDs——只有兩次都放行，寫類訪問才被授予。讀只憑正常檢查即可透過（呼叫者的 SID 在其可讀範圍內本來就攜帶讀權限），所以本檔不需要任何讀授權、也不需要新帳戶；寫還必須額外透過能力 SID 檢查，而只有工作區與臨時目錄的 ACE 能滿足它。`DISABLE_MAX_PRIVILEGE | LUA_TOKEN` 在權杖側合成了新帳戶的受限使用者效果，即使提升過的呼叫者派生的也是過濾權杖。同一原語其實也能限制讀（`SidsToDisable` 把 SID 變為 deny-only），但受限讀的權杖需要逐路徑的讀授權——恰好重新引入身份路線付出的代價——而沙盒詞彙表從不要求讀隔離。

## 考慮過的替代方案

### 為什麼不選 mxc（Microsoft xContainer）？

兩個否決理由。其一，OS 版本要求太新：[mxc 的 OS 版本支持文件](https://github.com/microsoft/mxc/blob/main/docs/process-container/os-version-support.md)把產品下限設在 Windows 11 24H2（build 26100），而 BaseContainer 檔（T1，`Experimental_CreateProcessInSandbox`）只在 25H2+（build 26600+）且啟用 OS feature 時存在——在 25H2 及以下的所有受支持版本上，檔案系統策略都會回退到 T3，即 AppContainer 加宿主側 DACL ACE 改造。其二，在任一檔下支持任意路徑讀都意味著要為子行程可讀的每個路徑寫 ACL 授予讀權限：模型要讀整個工作區和任意文件，就需要全盤改寫宿主 DACL——對只做寫限制的需求而言，這是不必要的駐留副作用與代價。

### 為什麼不選 AppContainer？

AppContainer 權杖沒有環境讀訪問：每個可讀路徑都必須預先透過 capability 或顯式 ACE 授予，因此任意路徑讀——harness 的讀模型——在不做同樣的全盤授予時無法支持。受限權杖完全不需要讀授予：它只對寫訪問做交集。

### 為什麼不選 landstrip？

[landstrip 評估](../../rejected/feature/2026-07-26-evaluate-landstrip-for-windows-sandbox-rung.md)在實作前已被否決（未經實戰檢驗；自建 launcher 方案勝出），且其 Windows 後端是 AppContainer 形態，繼承同樣的任意路徑讀問題。

## 後果

所得：僅寫隔離、不引入新的 OS 版本下限（`CreateRestrictedToken` 比 mxc 的版本早二十年）、讀/網路/行程可見性完全不受影響（與模式詞彙表一致），且 fail-closed 錯誤攜帶 API 名與精確 Win32 錯誤碼。工作階段共享有意常駐的工作區能力，但不共享各自可回收的臨時能力；重新啟動殘留既不能阻塞復原的工作階段，也不能向其授權。所失：強制執行在結構上只能是部分的，因為此權杖形態無法把 Everyone 授予的寫入與 NTFS 硬連結別名限制在路徑邊界內；無讀側或網路隔離；控制台隔離不可用（隱藏控制台子行程以 `STATUS_DLL_INIT_FAILED` 死亡；子行程共享宿主控制台）；工作區常駐 ACE 改動（複用快取，以及工作區改名後的失效殘留）與例外關閉後遺留的隨機臨時目錄垃圾，直到 OS 衛生機制將其回收；工作區授權採用急切的全樹傳播（`SetNamedSecurityInfoW` 立即遍歷每個後代——大型工作區上耗時數十秒），每臺機器每個工作區只付一次；CIM 在兩種受限模式下均不可用（Authenticated Users 不存在，從而關閉 C:\-root 建樹逃逸）；FAT 類無 ACL 目標仍可寫；NULL-DACL 目錄在 grant/revoke 往返下不保持身份；`whoami` 與權杖檢查 cmdlet 在受限權杖下失敗；read-only pwsh 會進入 ConstrainedLanguage，而在沒有主機策略時 workspace-write 保持 FullLanguage；named pipe 打開仍被拒絕，因此 libuv 管道 stdio 的孫行程以 EPERM 失敗，而繼承/忽略的 stdio 與匿名管道可用。包 README 負責記錄這些執行限制。

## 測試

產品可見的 Windows 陣容切換僅存在於 win32，而必須在 macOS/Linux 上可重放的 keyless 快照無法覆蓋它；替代證據是 bundle 組合 spec 加上 win32 真實 runner 套件，組裝態訊號由 CI 的 Windows lane 負責。`sandbox-local/tests/acl-grants.spec.ts` 在 mock Win32 的情況下釘住隨機臨時目錄分配、按工作階段/工作區複用、fork/工作區分離、崩潰後復原不衝突、成對 argv SID、失敗清理，以及常駐/可回收生命週期。在 Windows 上，`workspace-sid.spec.ts` 釘住工作區/臨時目錄派生與域分離；`acl.spec.ts` 釘住真實 DACL 生命週期；`runner.spec.ts` 釘住成對 SID 驗證、共享工作區 SID 時對同級工作階段臨時目錄的拒絕、無 agent 呼叫的逐呼叫臨時目錄建立/移除、TMP/TEMP 重寫、模式降級、Public 拒絕、Everyone/硬連結部分邊界、按模式區分的 PowerShell 語言行為與孫行程 stdio。ARM64 與模擬 x64 原生執行負責提供架構特定的驗收證據。

## Related

[pwsh 執行器決策](2026-08-01-pwsh-tool-and-executor.md)擁有本檔所消費的 pwsh-sandbox/tool-pwsh 方言劃分。
