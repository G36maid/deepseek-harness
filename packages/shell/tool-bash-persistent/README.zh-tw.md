# @deepseek-ai/dsh-tool-bash-persistent

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

模型可見的 `bash(command)`，底層複用一個按所有者隔離的 `ctx.terminals` shell。該包擁有工具約定和 shell 複用；PTY 後端與沙盒策略由部署選擇。

## 設定

| 鍵 | 預設值 | 含義 |
|---|---:|---|
| `backendType` | `shell` | 每個 Agent shell 使用的已註冊 PTY 後端。 |
| `timeoutMs` | `300000` | 單條命令的牆鐘時間上限；逾時會關閉 shell。 |
| `maxOutputChars` | `16000` | 命令輸出最多保留的字元數；固定診斷會在此後追加。 |
| `description` | 持久 shell 描述 | 面向模型的環境約定。 |

## 模型體驗

### 工具 schema

#### 模型所見

生成的 [`bash` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-bash-persistent)，其中包含設定的 `description`。本外掛程式不貢獻獨立系統提示詞段；persona 與環境指導由部署負責。

#### Token 影響

`bash` 可見時產生固定的 schema 成本。

#### KV Cache 影響

設定的描述與 schema 不變時前綴穩定。

### 工具結果

#### 模型所見

每個 Agent 的命令共享一個 shell，因此 cwd、匯出的環境變數、已啟用環境、函式和背景工作會跨呼叫保留。結果不包含私有完成標記和 shell 提示符。經封裝的命令以非零狀態結束時，結果會追加 `[exit code: N]`；若 shell 在報告該狀態前結束，則改為追加 `[shell exited: code N]`、`[shell killed by signal: SIG]`，或在後端既未提供結束碼也未提供訊號時追加 `[shell exited]`；隨後重設 shell，並告知模型下次呼叫從新 shell 開始。長輸出保留仍可讀取的最早前綴並追加截斷提示；若 PTY 已丟棄真正的開頭，結果會明確說明，而不是把尾部偽裝成完整輸出。逾時返回有界的部分輸出、關閉狀態不確定的 shell，並報告該重設。

#### Token 影響

隨資料變化。`maxOutputChars` 限制保留的命令輸出；固定的截斷、前綴丟失、狀態、逾時與重設診斷可能使結果更長。

#### KV Cache 影響

工具結果以追加方式位於可複用請求前綴之後。

## 已知限制與延後工作

- 工具需要擁有它的 Agent 和真實 PTY 後端。
- 顯式 `exit` 與逾時會丟棄 shell 狀態。取消同樣會重設 shell 並丟棄結果，即使已經能觀察到完整狀態標記也是如此；下次呼叫建立新 shell。
- 網路訪問、套件映像檔等環境事實應寫入設定的 `description`，而非包預設描述。
