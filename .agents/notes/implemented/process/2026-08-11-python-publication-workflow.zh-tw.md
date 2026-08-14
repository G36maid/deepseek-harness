# Agent Note: Python 公開發布工作流程

Status: implemented

[English](2026-08-11-python-publication-workflow.md) | [简体中文](2026-08-11-python-publication-workflow.zh.md) | 繁體中文

## 問題

Python SDK 由一個平臺無關的用戶端 wheel 套件和三個原生執行時期 wheel 套件組成，它們必須使用同一版本，並作為一組可安裝。public PyPI 上傳會立即公開包元資料和文件，無法替換已上傳的同名文件；如果精確版本的執行時期相依性尚未到達，還會產生暫時不可用的 SDK。私有倉庫需要在不向外發布任何產物的情況下，執行完整的原生建置與驗證流程。

## 決策

GitHub 的 `Release (Python)` 工作流程為帶有 `python-release-dry-run` 標籤的Pull Request和設定 `publish=false` 的手動執行提供無憑據驗證。兩條路徑都會為全部三個平臺呼叫原生 wheel 套件建置器，在 Python 3.10 和 3.14 上安裝 Linux 發行集合，下載所得四份產物，驗證其精確檔名和包元資料，執行 PyPI 默認單檔案大小限制，記錄 SHA-256 雜湊，並保留一份彙總候選發行版。這些作業只有倉庫讀取權限，沒有登錄檔憑據或 OIDC 權限，Pull Request事件無法進入任何發布作業。

設定 `publish=true` 時，執行必須在私有自動化倉庫使用 `python-v<repository-version>` 標籤，將該倉庫的 `github.repository` 與其倉庫級 `PYPI_PUBLISHER_REPOSITORY` 變數匹配，找到 `PUBLIC_PYPI_RELEASE_ENABLED=true`，並分別獲得 GitHub `pypi-runtime` 和 `pypi` 環境對執行時期與 SDK 發布的批准。只讀公開映像檔提供包元資料 URL，但不執行發布 Actions。只有兩個發布作業獲得 `id-token: write`；PyPI Trusted Publishing 會把私有倉庫身份換成短期項目憑據，因此倉庫不保存 PyPI token。

發布過程使用同一次工作流程執行中生成並檢查過的彙總產物。每個發布作業都會在選擇上傳檔案前驗證保留的 `SHA256SUMS`。一個執行時期作業先上傳全部三個平臺 wheel 套件，再由相依性它的作業上傳 SDK wheel 套件，因為 PyPI 上傳不是原子操作，而 SDK 會把執行時期分發包固定到完全相同的版本。兩個作業都不會檢出原始碼，也不會重新建置 wheel 套件。將它們拆開後，GitHub 的失敗作業重試可以在 SDK 上傳失敗時繼續執行，而不會嘗試替換不可變的執行時期文件。

兩個發布 action 都會停用公開 attestation。action 仍使用 Trusted Publishing 進行身份認證，同時不上傳會披露私有發布倉庫而非公開原始碼映像檔的 provenance。

倉庫版本可以是穩定版，也可以使用受支持的預發布寫法。標籤保留倉庫寫法，wheel 套件檔名、元資料、相依性版本固定和產物尋找則使用規範化的 PEP 440 寫法。

執行時期包的 `platforms.json` 是原生 wheel 套件標籤和可執行檔名的事實來源。倉庫發行建置器與隔離 Hatch 建置掛鉤會分別校驗並載入該文件。GitHub Actions 與 GitLab CI 對執行時期可執行文件及其必需的 spawn helper 呼叫同一個倉庫自有的 macOS 部署目標檢查，因此 wheel 套件中的每個 Mach-O 文件都必須符合聲明的平臺標籤。

兩個 Python 建置系統相依性都固定使用 Hatchling 1.30.1。下一個可用的 Hatchling 版本會生成 Core Metadata 2.5，而固定使用的 Twine 6.2.0 校驗器會拒絕該版本；精確固定建置器後，本機、GitHub 與 GitLab 的輸出會保持一致，直到校驗工具鏈支持該元資料版本。

## 考慮過的替代方案

**使用 TestPyPI 演練。** TestPyPI 是公開索引，上傳會在倉庫開放前暴露包名、元資料和 wheel 套件內容。無憑據的彙總產物與既有私有 GitLab 包登錄檔可以覆蓋驗證和上傳協議演練，而不會造成這種披露。

**使用長期 PyPI API token。** 保存的 token 會讓無關工作流程步驟接觸可複用的金鑰，並需要人工輪換。Trusted Publishing 把憑據限制到已登記的倉庫、工作流程和環境，並且只為每個受保護的發布作業生成憑據。

**在發布作業中重新建置。** 第二次建置可能與透過原生冒煙測試的候選產物不同。發布過程下載並使用同一批已保留文件，且不檢出任何原始碼。

**先上傳 SDK，再上傳執行時期載體。** 如果後續上傳失敗，SDK 會先公開，而其精確相依性仍不可用。執行時期優先的順序使部分失敗不會產生指向缺失文件的可安裝用戶端。

**從公開映像檔發布。** 公開映像檔是隻讀原始碼投影，不執行發布 Actions。將 PyPI Publisher 綁定到該映像檔後，沒有工作負載能夠提供已登記的 OIDC 身份。

**發布公開 attestation。** action 默認行為會讓 Trusted Publisher 倉庫身份可公開驗證。該 provenance 標識私有自動化倉庫而非包的公開原始碼映像檔，因此發布作業將其停用。

## 後果

完整候選發行版與公開發布都從私有自動化倉庫執行。選擇 `publish=true` 後，只有發布倉庫變數、發布開關和標籤都能標識一次有意的公開發布，工作流程才會進入受保護的發布作業，否則會提前失敗。映像檔程式碼不會複製這些私有倉庫設定，因此只讀公開映像檔無法滿足授權檢查。

私有自動化倉庫 owner 和倉庫名、工作流程檔名以及每個作業的環境（執行時期使用 `pypi-runtime`，SDK 使用 `pypi`）都是 Trusted Publisher 身份的一部分。原始碼倉庫轉移、工作流程改名或環境改名後，必須更新受影響的 PyPI Publisher；倉庫身份變化時還必須更新發布倉庫變數。只讀公開映像檔發生變化時，需要修改的是包元資料 URL，而不是發布身份。

兩個分發項目之間的 PyPI 發布仍然不是原子操作。執行時期優先的順序會縮小可見的失敗狀態；獨立的發布作業和校驗和驗證則讓失敗的 SDK 上傳能夠從經過檢查的精確文件繼續執行，並且絕不替換已上傳的同名文件。

停用公開 attestation 會放棄上傳身份的公開密碼學 provenance。Trusted Publishing 仍會認證每次上傳，而保留的彙總產物會在私有發布工作流程內部保存經過檢查的 wheel 套件雜湊。

升級 Hatchling 時，必須先使用發布管線固定的 Twine 版本驗證其生成的 Core Metadata 版本，再同時修改兩個包的建置相依性。
