# @deepseek-ai/dsh-storage-json

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

[儲存中心](../storage/README.md)的 JSON 後端：設定根目錄下每個單元使用一個人類可讀的 `<unit>.json` 文件，註冊為後端 `json`。設計見[領域 KV 儲存 Agent Note](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.zh.md)。

## 模型

- 記憶體中的單元狀態具有最終決定權；每個寫入原語都會透過暫存檔寫入 + fsync + 原子 `rename()` 替換重新發布整個文件。單元文件始終是完整的當前狀態：可讀性是該後端存在的理由，規模問題則屬於 SQLite 後端。
- 缺失文件會作為空單元打開，並在第一次寫入時物化。外來或無法解析的文件以 `malformed-medium` 拒絕；已存版本與描述符不同時以 `version-mismatch` 拒絕（預發布立場，不遷移）。
- 跨呼叫的寫入順序屬於呼叫方（領域層的寫入鏈）；每次呼叫都具備原子性，並在完成時已達到持久狀態。

## 設定

| Key | 類型 | 預設值 | 含義 |
| --- | --- | --- | --- |
| `root` | string | 必填，無預設值（cwd 回退會讓文件散落各處） | 保存單元文件的目錄；按需以 `0o700` 建立 |

## 模型體驗

### 已存領域記錄

#### 模型看到的內容

無。該後端不貢獻提示詞、工具或 schema；它在 `ctx.storage` 後面持久化非工作階段領域資料，只供宿主側消費端使用。

#### Token 影響

即時請求 token 為零。

#### KV Cache 影響

無：該後端從不觸碰即時請求前綴。

## 已知限制與暫緩事項

- Windows 持久性相依性 libuv 的 `rename()`（呼叫 `MoveFileExW` 並啟用替換），沒有顯式 write-through 標志；追加日誌分面落地時，計畫把工作階段日誌後端更嚴格的 Win32 write-through 發布輔助函式下移到此處（見 Agent Note 的遷移章節）。
- 沒有跨行程寫鎖：兩個行程寫入同一根目錄時，可能交錯執行整文件替換（最後寫入者勝出）。當前消費端採用單一宿主行程部署；多行程方案按 Agent Note 的範圍外事項表暫緩。
