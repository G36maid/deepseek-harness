# Python 貢獻者工作流程

[English](development.md) | [简体中文](development.zh.md) | 繁體中文

根據所需的貢獻者成果選擇工作流程：建置執行時期產物、驗證 SDK、從原始碼執行或建置分發包。包行為分別見 [SDK 參考](sdk/README.md) 和[執行時期載體參考](sdk-runtime/README.md)。

## 建置執行時期產物

各平臺可執行文件是建置產物，不檢入 git。請在倉庫根目錄執行建置：

```sh
pnpm install
pnpm exec tsx scripts/build-exe-for-python-sdk.ts
```

所需 `lib/` 產物已存在時使用 `--skip-build`；如需選擇平臺，請使用 `--targets=node24-linux-x64,node24-linux-arm64,node24-macos-arm64`。產物寫入 `dist-exe/`，指令碼會將所選載體同步到 `python/sdk-runtime/`。macOS 建置還會同步 `node-pty` 所需的配套 spawn 輔助程序。

## 驗證 SDK

請將虛擬環境放在 `python/` 之外，安裝測試組，然後執行 Python 測試套件：

```sh
export UV_PROJECT_ENVIRONMENT="$PWD/tmp/py-sdk-venv"
uv sync --project python/sdk --group test
uv run --project python/sdk pytest
```

`python/sdk/tests/test_bundled_runtime.py` 會執行可用的內建載體；某個載體的產物尚未建置時，會跳過該載體。倉庫級測試政策見 [測試](../docs/testing.md)。

互動式冒煙測試需要環境變數或倉庫根目錄 `.env` 中存在 `DEEPSEEK_API_KEY`：

```python
from deepseek_harness import DeepSeekHarness

with DeepSeekHarness() as harness:
    print(harness.run("say hi").final_response)
```

## 針對 Node 原始碼執行

倉庫貢獻者可以選擇以下任一開發載體：

- 設定 `DSH_RUNTIME_MODE=node`，在系統 Node `>=22.19` 上使用已建置的 Node 載體。建置指令碼會刷新該載體，但分發物絕不會包含或自動選擇它。
- 將倉庫根目錄設為 `cwd`，並設定 `launch_args_override=("./node_modules/.bin/tsx", "packages/examples/jsonrpc-demo/src/bin.ts")`，以執行未建置的 TypeScript 原始碼。預設配置不合適時，請提供 `cordis=...`。

完整的原始碼模式呼叫見 `python/sdk/tests/manual_sdk_agent_smoke.py`。

## 建置分發包

根目錄 `package.json` 的版本是兩個 Python 分發包的權威版本。暫存指令碼會將該版本注入兩個 wheel 套件，並將 SDK 固定到同版本的 `deepseek-harness-runtime-bin`。

純 SDK wheel 套件只需建置一次；每個原生平臺分別建置一個執行時期 wheel 套件：

```sh
version="$(node -p "require('./package.json').version")"
python scripts/build-python-release.py --package sdk --output-dir dist-python
python scripts/build-python-release.py --package runtime --platform macos-arm64 --runtime-exe dist-exe/dsh-jsonrpc-agent-pkg-macos-arm64 --output-dir dist-python
pip install --find-links dist-python deepseek-harness-sdk=="$version"
```

執行時期分發包僅提供 wheel 套件。發布管線會連同純 SDK wheel 套件一起發布三個平臺 wheel 套件：Linux x64、Linux arm64 和 macOS 14 或更高版本的 arm64。只有與倉庫版本匹配時，才接受 `python-v<repository-version>` 標籤；`0.0.1-rc.1` 之類的倉庫預發布版本在 wheel 套件檔名和中繼資料中使用規範化的 PEP 440 寫法，例如 `0.0.1rc1`。

## 驗證候選發行版

為Pull Request新增 `python-release-dry-run` 標籤，或手動執行 GitHub 的 `Release (Python)` 工作流程並設定 `publish=false`，即可建置全部四個 wheel 套件，在 Python 3.10 和 3.14 上安裝 Linux 發行集合，檢查精確檔名和中繼資料，執行 PyPI 預設單檔案大小限制，並保留一份帶 SHA-256 雜湊的彙總產物。兩條路徑都沒有登錄檔憑據，Pull Request執行無法進入任何發布作業。

公開發布從私有自動化倉庫執行；包中繼資料指向獨立的只讀公開原始碼映像檔，該映像檔不執行發布 Actions。私有倉庫把倉庫變數 `PYPI_PUBLISHER_REPOSITORY` 定義為自身的 `owner/name`，並且只在有意發布期間把 `PUBLIC_PYPI_RELEASE_ENABLED` 從 `false` 改為 `true`。

獨立的執行時期與 SDK 作業使 SDK 上傳失敗後可以繼續執行，而無需重新發送不可變的執行時期文件。只有工作流程從設定的發布倉庫、匹配的 `python-v*` 標籤執行，且受保護的 `pypi-runtime` 和 `pypi` 環境分別批准執行時期與 SDK 作業時，才接受 `publish=true`。PyPI Trusted Publishing 仍會提供短期 OIDC 憑據，但公開 attestation 會披露私有發布倉庫身份，因此將其停用。
