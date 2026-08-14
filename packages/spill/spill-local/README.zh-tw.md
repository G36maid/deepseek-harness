# @deepseek-ai/dsh-spill-local

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

[`@deepseek-ai/dsh-spill`](../spill) 儲存 seam 的**本機檔案系統**實作。它註冊為 `ctx.spillStore`，將工具產生的過大文字持久化到私有的工作階段級文件；定位資訊是檔案路徑，取回指引會告訴模型對該路徑使用 `read` 或 `grep`。

## 儲存版面配置

文件存放在 `<root>/session-<hash>/​<random>-<safeName>`：

- **`root`**：使用設定中的 `root`（解析為絕對路徑）；如果省略，則在作業系統臨時目錄下延遲建立每行程私有（0700）目錄。可預測且任何使用者均可讀取的根目錄會讓其他本機使用者讀取 spill 工具輸出，或在其中預置符號連結。
- **`session-<hash>`**：截短的 `sha256(sessionId)` 前綴，用於將同一工作階段的 spill 文件歸在一起，以便未來的清理操作可按工作階段刪除。
- **`<random>-<safeName>`**：不可預測的十六進位前綴（防止在共享根目錄中預置符號連結），加上經過清理的呼叫方 `suggestedName`，使其成為單個安全路徑段（防路徑遍歷；與 JSONL 持久化後端的 `encodeSegment` 一致）。寫入操作採用排他方式，且權限僅限所有者（`open(path, 'wx', 0o600)`）：如果路徑已經存在，無論是否為符號連結，操作都會失敗，因此預置的目標無法重定向寫入。

## 設定

| 鍵 | 預設值 | 含義 |
|---|---|---|
| `root` | 私有 0700 臨時目錄 | spill 文件的根目錄。設定後可將這些文件保存在已知位置。 |

`saveText` 在發生真實儲存故障（權限、ENOSPC）時返回拒絕；spill 策略會按盡力而為原則處理該拒絕，並保留內聯結果。詞彙見 seam README，設計見[工具輸出 spill Agent Note](../../../.agents/notes/implemented/architecture/2026-07-08-tool-output-spill-files.md)。

## 模型體驗

透過渲染本機路徑以及 `read`/`grep` 取回指引的 spill 消費端間接影響模型。

#### KV Cache 影響

不會直接導致 KV Cache 失效；請求前綴變更由上述消費端負責。

## 已知限制與暫緩事項

- **本機 spill 文件會持續存在，直到外部清理為止**：該後端不提供工作階段生命週期刪除或按時間保留的策略，因為已持久化、已復原和 fork 後的工作階段可能仍在引用某個路徑。
- **定位資訊需要與其位於同一檔案系統的消費端**：遠端或虛擬部署需要另一個 `SpillStore` 後端，其定位資訊和取回指引在該環境中有明確含義。
