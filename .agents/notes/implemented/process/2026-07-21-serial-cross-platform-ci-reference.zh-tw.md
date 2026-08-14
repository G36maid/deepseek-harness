# Agent Note: 跨平臺序列 CI 參考流程

Status: implemented

[English](2026-07-21-serial-cross-platform-ci-reference.md) | [简体中文](2026-07-21-serial-cross-platform-ci-reference.zh.md) | 繁體中文

## 問題

Pull Request工作流程將必需檢查合併到專用的 Linux 和 Windows 作業中。這些作業仍不應成為唯一的完整性判定基準：如果其閘門清單或相依性圖存在缺陷，即使必需聚合結果保持綠燈，也可能漏掉部分工作。

將非 Windows 作業的 1 分鐘目標和 Windows 作業的 3 分鐘目標寫成作業逾時，會引入另一種失敗模式。託管執行器的啟動時間和效能會波動，因此即使閘門本身正確，也可能在到達目標時間邊界時被取消，來不及輸出有用的診斷資訊。效能目標需要根據 GitHub 時間戳衡量，而正確性驗證需要給閘門留足完成時間。

評審人還需要直接回答一個更簡單的問題：在每個選定的託管作業系統上，如果倉庫完整的主 Node CI 聚合流程不使用矩陣選擇、區塊變數或並行閘門，執行結果會怎樣？

真實核心沙盒驗證需要特定的託管作業系統和架構，但不會產生Pull Request的合併裁決。在每個Pull Request上重複執行這個包含四個作業的矩陣會消耗 Linux、arm64 Linux 和 macOS 容量，卻既不能滿足分支保護，也無法參與另一工作流程中的必需聚合結果。

## 決策

[CI](../../../../.github/workflows/ci.yml) 為Pull Request事件與 master 推送事件賦予互補的職責。Pull Request在 GitHub 標準託管容量上執行合併後的 Linux 和由 Wine 承載的 Windows 作業，以及 Node 相容性與 Python 約定；一個獨立的原生 Windows 作業會報告完整的 Windows 清單，但不參與必需聚合流程。向 `master` 推送時，當前啟用的參考作業是公司自有 `vm-backup` 池上的 `serial / linux (self-hosted standby)` 和 `dsh-win-ci` 池上的 `serial / windows (self-hosted standby)`——這些熱備演練持續驗證[故障切換手冊](2026-07-26-ci-failover-runbook.md)所描述的切換目標。標準託管的 `serial / linux`、`serial / macos` 和 `serial / windows` 定義仍處於停用狀態，並由 `TODO(hosted-serial-ci)` 標記，直到其可移植容量復原。各自獨立的作業定義有意顯式保留簡短的程式碼檢出、執行時期設定和相依性鎖定的安裝步驟，而不是用矩陣或可複用工作流程隱藏作業系統差異。`workflow_dispatch` 僅用於執行器基準測試。

每個參考作業均在不設定任何區塊選擇器的情況下執行 `pnpm run check:ci`。`DSH_GATE_CONCURRENCY=1` 使頂層聚合每次只執行一個已經就緒的閘門；覆蓋率、快照重播、built-bin 冒煙測試和發布驗證的 worker 數量也設為 1。各參考作業可以彼此平行，但每臺主機上的倉庫閘門都序列執行且完整執行。Linux 在重播快照前安裝 bubblewrap，Windows 則在安裝採用符號連結的工作區前啟用開發人員模式。

該完整聚合流程仍明確劃分平臺歸屬。`terminal-bash` 支持 Linux 與 macOS，因此其單元測試和逐文件覆蓋率約定由 POSIX 平臺負責，而不會在 Windows 上載入一個明確拒絕 `win32` 的後端；Windows 仍會執行所有可移植包。可移植 fixture（測試前置資料）透過 `node:path` 派生原生路徑，使用與生產程式碼相同的原生 realpath 實作比較規範化後的路徑標識，並採用所有宿主機均允許的檔名。ACP（Agent Client Protocol）快照執行還會把生成的 cwd 分別透過 realpath 的 JavaScript 實作與原生實作得到的兩種表示一並傳給規範化器；規範化器按長度從長到短替換這些別名，避免 Windows 的短路徑與長路徑表示差異導致共享 fixture 反覆變化。

macOS 參考流程使用 fork 行程執行常規 Vitest 項目。macOS arm64 上的 Node 24 曾在工作執行緒中執行 CJS 詞法分析器時例外終止；行程邊界能夠隔離這一外部執行時期故障，且無需從聚合流程中刪除任何測試，而 Linux 與 Windows 仍使用開銷更低的執行緒池。倉庫自身引入的競態均在相應的觀測邊界修復：開發建置產物的輪詢邏輯每次發布重新掃描結果前，都會先暫存候選表、候選圖和候選監視基線對映；建置產物缺失後會一直保持髒狀態，直到成功計算內容雜湊。PTY 就緒偵測會在輪詢檢查前臺行程組歸屬期間保留提示符候選項；常規靜默時限也涵蓋從互動式子行程繼承而來的標記。真實 PTY fixture 會在執行時期拼接同步標記，使就緒等待邏輯不會把互動式 shell 的輸入回顯誤判為子行程已就緒。即時連結場景下的套件管理員 e2e 會保留由工作流程預先準備的 Corepack 主目錄、pnpm 元資料快取和 store 快取，同時隔離其他套件管理員的可變快取，因此不會在安裝前丟棄可複用的套件管理員狀態。

獨立的 [Sandbox](../../../../.github/workflows/sandbox.yml) 工作流程屬於同一職責劃分中的參考側。其 bwrap、Landlock x64/arm64 與 Seatbelt 真實核心矩陣只在向 `master` 推送後執行。這四個作業僅用於診斷：它們既不是分支保護的必需項，也不會跨工作流程計入 `all checks passed`。Pull Request CI 仍透過常規的單元測試與覆蓋率清單檢查沙盒原始碼；宿主核心與 packed-install 驗證在合併後報告結果。

master 分支的參考作業僅用於診斷，不參與Pull Request所要求的 `all checks passed` 結果。CI 與 Sandbox 工作流程把跨平臺參考流程保留在 master 推送上。系統根據已完成託管作業的時間戳評估效能，並將其報告為測量結果，而不是寫成 `timeout-minutes` 值。

可移植的參考流程使用 GitHub 標準的 `ubuntu-latest`、`macos-latest` 和 `windows-2025` 標籤。Pull Request必需的 Windows 作業在 `ubuntu-latest` 上透過 Wine 執行，而獨立的Pull Request原生作業在正常執行下使用託管的 `dsh-windows-2025-16core` 執行器，故障切換時使用自託管 `[self-hosted, dsh-win-ci, windows]` 池（參見[故障切換手冊](2026-07-26-ci-failover-runbook.md)），依據[雙 Windows 決策](2026-08-08-native-windows-pull-request-ci.md)不參與必需聚合流程；`serial / windows` 啟用時，仍作為第二個完整且未區塊的原生核心標尺。依據[必需 CI 決策](2026-07-23-portable-required-pull-request-ci.md)，Pull Request必需作業使用可移植的標準容量。更高核心數的託管執行器仍僅用於手動基準測試，因為正確性路徑必須無需倉庫外部的執行器設定即可執行。

## 曾考慮的替代方案

- **將每個逾時值設為相應延遲目標**：不予採納，因為調度波動會中止原本正確的執行，並使診斷回歸所需的證據無法產生。
- **僅信任並行執行的主閘門清單**：不予採納，因為調度邏輯與校驗邏輯共享實作假設；序列聚合流程是一項獨立的完整性檢查。
- **在每個Pull Request上執行序列參考作業**：不予採納，因為這些作業會重複完整的跨平臺聚合流程，並為每項改動增加 macOS 工作；必需作業已經執行阻塞性的 Linux 和由 Wine 承載的 Windows 約定，而獨立原生作業提供完整的 Windows 結果。
- **在每個Pull Request上執行真實核心 Sandbox 矩陣**：不予採納，因為它的四個狀態不參與分支保護，而重複安裝、Landlock 建置以及為保持平臺一致而執行的 macOS 單元測試會消耗執行器容量，卻不會改變合併裁決。master 上的執行保留平臺與已安裝 launcher 的訊號。
- **使用一個作業系統矩陣**：不予採納，因為三個具名作業無需另一套選擇機制，就能讓參考流程的構成清晰可見。
- **在大型執行器上執行序列參考流程**：不予採納，因為當組織自有執行器池無法分配作業時，必需 CI 及其獨立參考流程都必須仍可執行。

## 後果

工作流程包含重複的設定步驟，master 參考執行也可能比最佳化後的Pull Request路徑耗時長得多。這些重複是有意保留的：評審人無需解析矩陣或並行調度器，就能直接檢查每種作業系統執行的完整命令。

參考流程可能暴露某些平臺上的故障，而最佳化後的阻塞閘門集合尚未聲明支持這些平臺，Windows 尤其如此。這類失敗反映了當前的跨平臺行為，不應成為削弱或靜默跳過該聚合流程的理由。

僅在真實宿主核心或打包後的 Landlock 安裝中可見的沙盒回歸，可能在 master 上的執行報告前已經合併。我們接受這個合併後偵測視窗，以換取從每個Pull Request中移除四個非阻塞作業；默認分支仍保留完整訊號。

明確的 `terminal-bash` 歸屬邊界意味著 Windows 不會聲稱覆蓋一個無法載入的後端，而 macOS 採用 fork 的單元測試工作行程會增加行程啟動開銷。這些代價換來的是：支持範圍內的每個方面都有能夠如實反映對應平臺行為的判據，原生執行時期例外終止不會抹掉其餘單元測試結果，各項對時序敏感的觀測邏輯也都會以呼叫方有機會修改狀態前已建立的狀態作為起點。

移除嚴格的時長逾時後，系統會觀測到延遲回歸，而不是在發生回歸時自動取消執行。因此，效能改動必須附帶託管環境測量結果，已完成的日誌則保留最佳化最慢通道所需的資訊。
