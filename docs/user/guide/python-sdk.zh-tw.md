# Python SDK 快速上手

[English](python-sdk.md) | [简体中文](python-sdk.zh.md) | 繁體中文

本教程介紹 Web UI 之外的程序化使用方式：安裝已發布的 Python SDK、執行倉庫內建的 agent（代理）組合，並在自己的程序中呼叫同一套 API。

## 前置要求

- Python 3.10 或更高版本
- Git
- Linux x64、Linux arm64 或 macOS 14 或更高版本的 arm64
- DeepSeek 相容的 API 端點與憑據
- agent 可以修改的隔離 workspace

## 安裝 SDK

克隆倉庫以使用其中的可執行示例，建立虛擬環境，並安裝 SDK 及其同版本內建執行時期：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
python -m venv .venv
. .venv/bin/activate
python -m pip install deepseek-harness-sdk
```

安裝後的執行時期不需要系統提供 Node.js。需要從原始碼建置執行時期或 wheel 套件的倉庫貢獻者應使用 [Python 貢獻者工作流程](../../../python/development.md)。

## 執行倉庫內建示例

請在環境中設定憑據。如果模型不是由默認 DeepSeek 端點提供，而是透過 OpenAI 相容代理提供，還需要設定 `DEEPSEEK_BASE_URL`。

```sh
export DEEPSEEK_API_KEY=sk-your-key-here
# export DEEPSEEK_BASE_URL=http://127.0.0.1:8000/v1
# export DSH_MODEL=deepseek-v4-flash
# export DSH_SYSTEM_PROMPT='You are a helpful software engineer assistant.'
```

針對隔離的 workspace 和工作階段目錄執行一個任務：

```sh
python examples/jsonrpc-agent/minimal.py \
  --workspace /absolute/path/to/workspace \
  --session-root /absolute/path/to/sessions \
  --session-id example-001 \
  "Inspect the repository and fix the failing tests."
```

指令碼會列印 assistant 的最終回覆。工作階段目錄會收到 JSONL 日誌，其中包含組裝後的模型請求與工具呼叫。

## 在自己的程序中使用 SDK

倉庫內建示例是以下 SDK 呼叫的輕量包裝：

```python
from pathlib import Path

from deepseek_harness import DeepSeekHarness

config = Path("examples/jsonrpc-agent/minimal.cordis.yml").resolve()
workspace = Path("/absolute/path/to/workspace").resolve()
sessions = Path("/absolute/path/to/sessions").resolve()

with DeepSeekHarness(
    provider="deepseek-official",
    model="deepseek-v4-flash",
    max_tokens=49_152,
    cwd=str(workspace),
    session_root=str(sessions),
    cordis=str(config),
) as harness:
    result = harness.run(
        "Inspect the repository and fix the failing tests.",
        session_id="example-001",
    )

print(result.final_response)
```

`DeepSeekHarness` 會延遲啟動內建執行時期，並持續複用，直至退出上下文管理器。複用同一個 harness 與 session id 會保留該工作階段擁有的 Bash 行程，包括其工作目錄、已匯出的變數與 shell 函式。獨立任務應使用新的 session id；只有下一次呼叫需要延續同一段持久化對話時，才複用原有 id。

## 瞭解示例組合

| 屬性 | 值 |
|---|---|
| 系統提示詞 | `DSH_SYSTEM_PROMPT`；未設定時使用 `You are a helpful software engineer assistant.` |
| `minimal.py` 使用的模型 | `--model`，其次為 `DSH_MODEL`，最後為 `deepseek-v4-flash` |
| 面向模型的工具 | 僅持久 `bash` 與 `str_replace_editor` |
| Bash 逾時 | 300 秒 |
| 編輯器輸出上限 | 16,000 個字元 |
| 上下文壓縮 | 已關閉 |
| 檔案系統 | 裸本機後端；編輯器使用絕對路徑，可以訪問執行時期行程可見的任何路徑 |
| 工作階段持久化 | `DSH_SESSION_ROOT` 下未壓縮的 JSONL |

該組合省略了 harness 身份、workspace 提示詞文字、skill（技能）、一次性 Bash、任務工具、上下文壓縮和其他所有面向模型的外掛程式。沙盒策略事實記錄為執行時期使用者上下文，而不會追加到系統提示詞中。

## 選擇 workspace 與 session id

`cwd` 用於選擇 agent 可訪問的 workspace，`session_root` 用於保存工作階段日誌和狀態。獨立任務應使用新的 session id；只有下一次呼叫需要延續同一段對話和持久 shell 狀態時，才複用原有 id。

該組合使用 `danger-full-access`。只能在可丟棄的 checkout 或容器內執行：Bash 與編輯器可以修改執行時期行程有權訪問的任何路徑。持久 PTY 後端需要 POSIX 終端機環境，因此該組合不支持 Windows agent。

準確的組合內容歸 [`jsonrpc-agent` 示例參考](../../../examples/jsonrpc-agent/README.md)所有。[Python SDK 參考](../../../python/sdk/README.md)介紹生命週期、結果、通知、執行時期選擇和設定；[Cordis primer](../../cordis-primer.md)介紹組合文法。
