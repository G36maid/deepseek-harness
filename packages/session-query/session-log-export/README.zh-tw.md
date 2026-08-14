# @deepseek-ai/dsh-session-log-export

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

Web Session 日誌下載控制，使用 `dsh-host-apiproxy` 擁有的 Host 流式 ZIP 端點。Host 半包註冊 `/export`；瀏覽器半包在 Session Header 中提供 111×32 的 `Session log` 操作，以及一個供該按鈕與斜槓命令共用的下載控制器和彈出視窗。ZIP 生成、原始 JSONL/zstd 讀取、子 Session、附件、背壓和 HTTP 錯誤語義仍由 [ApiProxy 下載實作](../../host/apiproxy/README.md)負責。

## 命令約定

| 輸入 | 結果 |
|---|---|
| `/export` | 記錄一組使用者命令生命週期；提交命令的瀏覽器收到本機執行確認後，下載 `GET /api/session.export?sessionId=<id>&includeDescendants=true`。 |
| `/export <path>` | 返回錯誤。瀏覽器下載透過瀏覽器的普通下載行為選擇目標位置。 |

該命令只由 Web bundle 掛載。只有 `/export` 返回成功時，本機 `command/executed` 確認才會在提交命令的瀏覽器中觸發斜槓下載；其他分頁標籤仍會算繪持久命令列，但不會重複執行瀏覽器副作用。Header 按鈕直接呼叫同一個控制器。兩種入口都會先發出 `HEAD` 預檢，再把 GET URL 交給瀏覽器下載管理器，JavaScript 不會緩衝 ZIP；它們共用並行摺疊、外掛程式釋放時取消預檢、準備階段錯誤處理、瀏覽器保存行為和同一個 Modal。

Host 下載端點會在 `readRaw` 前 flush 活動的根 Session，因此斜槓命令觸發的 ZIP 會包含啟動下載的 `command/run` 與 `command/done` 事件對。冷持久化 Session 不需要 flush。

彈出視窗報告準備中、開始下載或失敗。關閉彈出視窗不會取消正在進行的下載；該操作隨後完成時也不會重新打開彈出視窗。每個 Session 同時只允許一項下載，重複操作會共用該任務。

## 組合

```yaml
- id: session-log-download
  name: '@deepseek-ai/dsh-session-log-export'
```

Web bundle 將本包與 `dsh-host-apiproxy`、`dsh-commands`、`dsh-client-ui-commands` 和 `dsh-client-ui-conversation` 一起掛載。本包把按鈕和彈出視窗貢獻到最右側的 `conversation.session.header.utilities` 清單，與標題旁 `conversation.session.header.actions` 中的模式、Subagent 和 Task 設定項相互獨立；Trajectory 不包含匯出入口。

## 模型體驗

### 使用者 `/export` 控制

#### 模型看到什麼

無。`/export` 留在使用者命令平面，ZIP 下載不會進入模型歷史。

#### Token 影響

為零。該命令不建立模型輪次。

#### KV Cache 影響

無。僅日誌命令生命週期和瀏覽器下載不會改變派生請求前綴。

## 已知限制與暫緩事項

- 下載端點要求持久化後端具有逐 Session 原始工件。隨附 JSONL 後端支援明文和 zstd 工件；本次改動不包含 SQLite 匯出。
- 這是瀏覽器下載，不是 Host 路徑寫入。目標位置由瀏覽器選擇，不會返回 Host 路徑或原生資料夾操作。
- 預檢只報告 ZIP 開始流式傳輸前發現的失敗。瀏覽器接受 GET 後發生的子 Session 或附件讀取失敗由瀏覽器下載管理器報告，不透過彈出視窗報告。
