# dsh-home-paths

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

DeepSeek Harness 使用者資料的共享檔案系統路徑輔助工具。

## DSH 主目錄

`resolveDshHome()` 解析 DeepSeek Harness 的單根主目錄。優先級從高到低為：顯式設定的路徑、`$DSH_HOME`、`~/.dsh`。harness 將所有使用者資料保存在同一根目錄下。

`dshHomePath(...segments)` 使用 Node 的平臺路徑規則，將子路徑段拼接到解析後的主目錄下。不傳入任何路徑段時，返回主目錄本身。

`dshHomeDisplay()` 以符號方式表示當前根目錄，用於面向使用者的路徑：默認主目錄表示為 `~/.dsh`，任何已設定的主目錄表示為 `$DSH_HOME`。它絕不會洩露機器的絕對路徑。

`DSH_HOME_DIR_NAME` 定義默認使用者資料目錄名：`.dsh`。

`defaultDshHome()` 使用 Node 的平臺路徑規則，將作業系統主目錄與 `.dsh` 拼接，並返回默認 DeepSeek Harness 主目錄。

`expandHomePath()` 使用作業系統主目錄展開 `~`、`~/...` 和 Windows 風格的 `~\...` 前綴。它會保留非波浪號路徑和 `~user/...` 原樣不變。

## 監聽路徑

`canonicalizeWatchPath()` 為原生檔案系統 watcher 提供一種穩定的目標路徑表示。它透過 `fs.realpath()` 解析層級最深的現有祖先路徑，再拼回缺失的後綴，因此即使文件或目錄尚未建立也仍可監聽。尤其是，Windows 8.3 別名不能與原生 watcher 後端寄出的長路徑混用。

該包刻意保持規模小且不相依性 harness，以便產品包共享使用者資料路徑約定，而不必彼此相依性。

## 已知限制與暫緩事項

- **展開範圍刻意保持狹窄**：只有單獨的 `~`、`~/...` 和 `~\...` 使用當前作業系統主目錄；`~alice/...` 等指定使用者的形式、環境變數和 shell 表達式保持不變。
- **規範化會讀取，但絕不修改**：`canonicalizeWatchPath()` 會執行 `realpath` 探測，並傳播除路徑不存在以外的錯誤；呼叫方仍負責目錄建立、權限，以及對結果路徑應用信任策略。
