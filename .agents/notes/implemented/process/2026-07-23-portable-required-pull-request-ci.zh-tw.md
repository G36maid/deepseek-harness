# Agent Note: Pull Request CI 的可移植復原邊界

Status: implemented

[English](2026-07-23-portable-required-pull-request-ci.md) | 繁體中文

## 問題

分配到組織自有執行器標籤的Pull Request必需作業，在 GitHub 無法為這些池分配執行器時會持續排隊。工作流程本身有效，GitHub 標準託管作業仍能透過，但 `all checks passed` 始終無法啟動，原本健康的Pull Request因此無法滿足分支保護要求。

帳單狀態正常、執行器定義處於 `Ready` 狀態以及較高的自動擴縮容上限，都不能證明指定的執行器池可以接收作業。必需的正確性檢查需要預先明確一條可移植復原路徑，即使日常低延遲路徑相依性倉庫外部的執行器預配也不例外。

## 決策

[CI](../../../../.github/workflows/ci.yml) 在僅限本倉庫使用的企業級 32 核執行器池上執行必需的主 Node 24 作業，以及穩定的 `all checks passed` 聚合流程。該聚合流程不執行程式碼檢出或倉庫閘門；但讓它與所相依性的實質性作業共用企業級執行器池，可以避免這些作業已經成功後，必需判定結果又引入一項單獨的標準託管計費相依性。必需的 Windows 作業在標準 `ubuntu-latest` 上透過 Wine 執行 Windows Node，覆蓋阻斷性檢查範圍；一個獨立的原生 `windows-2025` 作業會自動啟動，但不參與聚合流程（[雙 Windows 決策](2026-08-08-native-windows-pull-request-ci.md)）。標準 `ubuntu-latest` 作業保留 Node 22.19、Node 26、Python SDK 單元測試套件與[發布形態的 Linux x64 Python 執行時期驗證](../testing/2026-08-12-required-python-runtime-pull-request-ci.md)，序列參考流程仍是完整且未區塊的跨平臺定義。這些標準託管作業讓可移植執行邊界保持可觀測，而不必在每個Pull Request中重複主清單。

三項 Linux 主作業、Node 相容性、Python SDK 單元測試套件、Python 執行時期驗證和 `windows node 24 / wine blocking` 繼續作為 `all checks passed` 的相依套件；`windows node 24 / native complete` 被刻意排除。分支保護繼續要求 `e2e` 和 `all checks passed`。剩餘的企業級 Linux 執行器標籤無法分配執行器時沒有自動後備機制：標準作業會繼續報告各自的約定，但無法產出缺失的必需結果。

當前主拓撲及其測量結果以[大型執行器決策](2026-07-22-evidence-based-larger-hosted-runners.md)為準。[跨平臺序列參考流程](2026-07-21-serial-cross-platform-ci-reference.md)繼續作為獨立的標準託管完整性檢查，手動大型執行器套件則保留規格比較，同時不擴大普通必需矩陣。

## 曾考慮的替代方案

**將 Linux 主作業和聚合流程保留在標準容量上。** 此方案消除了剩餘的企業級執行器分配相依性，但標準執行器上的完整作業回饋明顯更慢，仍會遇到共享容量排隊。當前拆分既保留可移植相容性和序列證據，又將企業級執行器容量用於 Linux 主關鍵路徑。

**根據標稱核心數選擇企業規格。** 基準測試表明擴充效果不呈單調變化，設定耗時也存在波動，因此必需執行器池改由完整作業的精確測量結果選定。

**在容量不可用時跳過檢查或降低其等級。** 這種方式透過丟棄證據而非執行倉庫的必需約定來使狀態變綠。

**在每臺主機上使用同一工作執行緒策略。** 外層閘門並行與內層工具工作執行緒在 Linux、Windows 和標準執行器上的爭用方式不同；按主機實測的上限可以避免新增核心反而拖慢執行。

## 後果

普通Pull Request會將企業級執行器容量用於 Linux 關鍵路徑，而 Wine 作業讓必需的 Windows 判定繼續使用標準 Linux 執行器容量。獨立原生作業使用標準 Windows 執行器容量，不會延遲或改變聚合流程。一次針對確切分支頭的實際執行會區分分支保護採用的命令與單獨的診斷約定；排隊延遲與每個作業從 `startedAt` 到 `completedAt` 的執行區間分開報告。

企業級執行器分配能力下降時，標準相容性作業、必需的 Wine 作業與診斷性原生 Windows 作業仍能提供有用證據，但無法讓受阻的必需 Linux 作業或聚合流程變綠。復原 Linux 可用性時，可能需要復原完整的標準託管拓撲；僅改變執行器池定義的狀態，不足以證明它可以接收作業。
