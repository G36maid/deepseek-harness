# jsonrpc-agent

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

面向 Python SDK 內建 JSON-RPC 執行時期的無人值守編碼 agent（代理）組合。它有意不載入終端機 UI、控制台日誌記錄器、批准介面或使用者互動工具，因為 stdout 屬於 SDK 協議，輪次由 SDK 驅動。

面向模型的工具為：

- `bash`，僅前臺
- `read`、`write` 和 `edit`
- `subagent`，使用一個在行程內以前臺方式執行的 spawn 提供方
- `todo_write`

周邊執行時期還載入 JSONL 工作階段持久化和自動上下文壓縮（context compaction）。`maxTokensAsSuccess` 將受 token 上限限制的模型輪次保留為已接受的評估結果，同時保留其 `max-tokens` 原因。

## 執行時期環境

| 變數 | 用途 |
|---|---|
| `DEEPSEEK_API_KEY` | 傳給 OpenAI 相容宿主端點的憑據 |
| `DEEPSEEK_BASE_URL` | `dsh-llm-deepseek` 使用的宿主端點 |
| `DSH_CWD` | bash 和檔案系統工具使用的 agent workspace |
| `DSH_CONTEXT_WINDOW` | 極簡變體中為 `DSH_MODEL` 目錄項記錄的上下文容量 |
| `DSH_MAX_TOKENS_AS_SUCCESS` | `true`（默認）接受受 token 上限限制的結果；`false` 將其報告為錯誤 |
| `DSH_MODEL` | `minimal.py` 使用的默認模型；`--model` 優先 |
| `DSH_SESSION_ROOT` | JSONL 工作階段目錄 |
| `DSH_SYSTEM_PROMPT` | 由部署提供的編碼人格 |

透過 Python SDK 的 `cordis` 選項或 `DSH_CORDIS_CONFIG` 傳入設定路徑。內建可執行文件已攜帶此文件中指定的每個外掛程式；目標機器無需 Node.js。

## 極簡變體

[`minimal.cordis.yml`](minimal.cordis.yml) 是 Web `minimal` preset 的完整獨立版本。`DSH_SYSTEM_PROMPT` 選擇它的系統提示詞，未設定時使用 `You are a helpful software engineer assistant.`。它為新建工作階段抑制每個 system-prompt runtime-context 貢獻，且不掛載上下文壓縮外掛程式。面向模型的工具嚴格只有：

- 所有者作用域內持久化的 `bash`
- 提供 `view`、`create`、`str_replace` 與 `insert` 的 `str_replace_editor`

它組合了內建執行時期所需的本機 PTY、裸 `fs-local` 後端、供持久 Bash 使用的 danger-full-access 策略，以及未壓縮的 JSONL 持久化。Bash 和編輯器絕對路徑可以修改執行時期行程有權訪問的任何路徑，因此只能針對可丟棄的 checkout 或容器執行該變體。持久 PTY 需要 POSIX 終端機環境，因此不適用於 Windows agent 介面。

[`minimal.py`](minimal.py)透過 Python SDK 執行該組合，並把 `DSH_MODEL` 作為默認模型。[Python SDK 教程](../../docs/user/guide/python-sdk.md)介紹安裝、執行、workspace 選擇與 session 標識；[SDK 參考](../../python/sdk/README.md)歸屬執行時期生命週期與結果語義。
