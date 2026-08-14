# Agent Note: 必需的 Python 執行時期Pull Request驗證

Status: implemented

[English](2026-08-12-required-python-runtime-pull-request-ci.md) | [简体中文](2026-08-12-required-python-runtime-pull-request-ci.zh.md) | 繁體中文

## 問題

普通Pull Request CI 會針對 fake 執行時期對端執行完整的 Python SDK pytest 套件，而 Node 快照使用不同的用戶端與預期輸出。真實 Python 用戶端、打包後的 JSON-RPC 可執行文件、exe 專用快照、發布形態 wheel 套件與乾淨安裝只在選填的單文件可執行程序工作流程或 Python 發布工作流程中匯合。因此，執行時期事件或閉包發生變化後，過時的 Python 投影或損壞的 wheel 套件路徑仍可能合併，直到後續有人建置 Python 發布候選版本時才失敗。

## 決策

每個Pull Request都在 [CI](../../../../.github/workflows/ci.yml) 中執行必需的 `python-runtime` 作業。該作業不使用路徑過濾，呼叫共享的[單文件可執行程序建置器](../../../../.github/workflows/build-exe-for-python-sdk.yml)建置 `node24-linux-x64`，並參與 `all checks passed`。被呼叫的工作流程會建置真實可執行文件，執行全部無金鑰 Python 完整輪次和直接二進位場景（包括檢入的 exe 快照），建置 SDK 與執行時期 wheel 套件，將二者安裝進乾淨的虛擬環境，檢查可執行文件與原生 addon 的 GLIBC 相依性，並在 manylinux 2.28 容器中執行已安裝的 wheel 套件。

必需作業與 [Python 發布工作流程](../process/2026-08-11-python-publication-workflow.md)共用同一建置器。其並行鍵包含呼叫方工作流程，因此同一 ref 上的必需 CI 與顯式完整發布驗證不會互相取消。完整的 linux-x64、linux-arm64 和 macos-arm64 矩陣仍屬於發布驗證：平臺無關的執行時期、SDK 與快照行為只需要一個阻斷合併的原生載體，而架構相關的可執行文件、addon、wheel 套件標籤與部署目標行為在發布前仍需要全部發布目標驗證。

exe 快照會在比較前規範化不透明的工作階段、訊息、subagent 和工作流程執行識別符號。因此，新增的持久化工作流程事件會改變經過審閱的預期輸出，但不會把隨機執行識別符號寫入其中。

## 曾考慮的替代方案

**每個Pull Request都執行完整原生矩陣。** 這會在三個作業中重複平臺無關的完整輪次與快照行為，並讓每項改動都消耗 ARM64 Linux 和 macOS 容量。Python 發布工作流程在需要全部三個產物的環節保留這部分證據。

**針對開發用 Node 載體執行快照。** 這可以捕獲協議與事件投影漂移，但不能證明 pkg 組裝、部署後的執行時期閉包、原生 addon 暫存、wheel 套件建置、精確相依性版本與乾淨安裝。必需的 Linux exe 路徑直接覆蓋發布路徑。

**透過路徑過濾或標籤選擇該作業。** Python 行為相依性 `python/` 之外共享的 agent、工作階段、工作流程、subagent、外掛程式載入與打包程式碼。不完整的相依性過濾會再次造成延遲發現，標籤則會讓證據保持選填。

## 後果

每個Pull Request都會承擔一次標準託管 Linux exe 與 wheel 套件建置，`all checks passed` 也會等待該作業。這使第一方 Python 分發成為合併時約定，並複用發布實作，而不維護一條更小的替代管線。

單一必需架構無法偵測 macOS 或 Linux ARM64 打包回歸。發布前仍必須執行顯式完整發布驗證，並由該驗證負責這些平臺特定結果。
