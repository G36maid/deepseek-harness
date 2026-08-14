# @deepseek-ai/dsh-e2b

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

一個 E2B 沙盒的共享生命週期所有者。檔案系統與行程管理配接器注入 `ctx.e2b`，等待其唯一的 SDK 控制代碼，因此處於同一個遠端 Linux 工作樹與行程環境中。本包固定使用 `e2b@2.29.1`；選填組合見[包族索引](../README.md)。

## 設定

```yaml
- id: e2b
  name: '@deepseek-ai/dsh-e2b'
  config:
    cwd: /home/user/workspace
    timeoutMs: 300000

- id: subprocess-e2b
  name: '@deepseek-ai/dsh-subprocess-e2b'

- id: fs-e2b
  name: '@deepseek-ai/dsh-fs-e2b'
```

`apiKey` 可省略；省略時讀取 `E2B_API_KEY`。該金鑰只設定宿主 SDK 連線，絕不會安裝進沙盒。`cwd` 預設為 `/home/user/workspace`，並且必須是絕對 POSIX 路徑。`timeoutMs` 預設為 5 分鐘並控制沙盒生命週期；逾時會刪除沙盒。

## 生命週期與所有權

構造階段會啟動一次沙盒建立。服務在 `getSandbox()` 成功返回前，會建立 `cwd` 和私有的 `cwd/.dsh-e2b` 配接器狀態目錄，驗證該預留路徑是真實目錄而非符號連結或其他文件類型，再把該目錄的 mode 設為 `0700`。每個配接器內部的 E2B 命令 shell 都會獲得一個位於根目錄下、全新隨機生成的 `HOME`，因此 SDK 固定使用的登入 shell 不會在控制命令之前解析可變使用者主目錄中的設定檔。

資源釋放會先阻止繼續取得新控制代碼，再等待初始化完成，然後刪除沙盒。`SandboxNotFoundError` 表示沙盒已因逾時或被另一個所有者刪除，因此可視為完全靜止。初始目錄設定失敗時會嘗試刪除一次；若該嘗試也失敗，則由已設定的 E2B 逾時約束沙盒的存活時間。提供方外掛程式必須在該所有者之後載入，並在其之前 dispose（資源釋放）。

## 模型體驗

無。本共享執行時期所有者不註冊模型可見上下文；提供方配接器及其消費端擁有所有算繪效果。

#### KV Cache 影響

不會直接失效；本包不會貢獻請求 token。

## 已知限制與延後工作

- **這不是完整的 harness 執行時期**：Cordis 服務、agent（代理）／工作階段狀態、工作階段日誌、LLM（大型語言模型）請求、skill（技能）和 SDK 側緩衝仍留在宿主行程中。
- **沙盒狀態是短暫的**：資源釋放和逾時都會刪除沙盒；重新連線、pause/leave 保留、樣板、卷和快照均不在本 POC 範圍內。
- **沒有設定部署平臺**：網路策略、宿主工作區同步和沙盒發現均不在本 POC 範圍內。
- **`cwd` 是解析約定，而不是包含邊界**：配接器和命令可以訪問沙盒中的其他路徑；E2B 網路訪問也繼續採用基礎映像檔的策略。
