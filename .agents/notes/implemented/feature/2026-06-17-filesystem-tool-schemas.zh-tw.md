# Agent Note: 檔案系統工具 schema——面向模型的讀/寫/編輯介面形狀

Status: implemented

[English](2026-06-17-filesystem-tool-schemas.md) | [简体中文](2026-06-17-filesystem-tool-schemas.zh.md) | 繁體中文

## 問題

[檔案系統能力 seam Agent Note](../architecture/2026-06-17-filesystem-capability-seam.md) 定義了檔案系統能力 seam（`ctx.fs`）、包拆分（`dsh-fs`、`dsh-fs-local`、`dsh-tool-fs`，加上 `dsh-fs-observation-policy` 策略外掛程式），以及針對 read-before-write/edit 檢查的已觀測文件／過時版本策略——[拆分檔案系統 seam](../simplification/2026-06-26-fsspec-style-fs-seam.md)和[事件門](../architecture/2026-06-26-file-context-as-event-gate.md) Agent Note 後來將其從 `ctx.fs` 移至 `dsh-fs-observation-policy` 外掛程式的 `fs/*` 事件門上。首次檔案系統工具交付剩餘的決策是面向模型的 schema：模型在 `read`、`write` 和 `edit` 中看到哪些參數。

該 schema 必須足夠小，但又要足夠穩定，使本機、遠端、沙盒檔案系統後端不需要改動面向模型的介面，並且必須避免從參考系統中照搬所有選項。Claude Code 和 OpenCode 暴露了類似的核心文件工具，但在命名風格和額外 flag 上有所不同；本決策選擇最小的共有介面。

## 決策

`@deepseek-ai/dsh-tool-fs` 在首個檔案系統工具套件中暴露以下三個面向模型的工具：

| 工具 | 我們的 schema | Claude Code | OpenCode | 說明 |
|---|---|---|---|---|
| `read` | `read(file_path, offset?, limit?)` | `Read(file_path, offset?, limit?, pages?)` | `read(filePath, offset?, limit?)` | 僅支持文件；`offset` 從 1 開始；首版不支持圖片、PDF 或多模態內容。 |
| `write` | `write(file_path, content)` | `Write(file_path, content)` | `write(content, filePath)` | 建立或覆蓋 UTF-8 文字。在默認 fs-observation-policy 下，更新現有文件前必須先觀測；建立新文件則不需要。 |
| `edit` | `edit(file_path, old_string, new_string, replace_all?)` | `Edit(file_path, old_string, new_string, replace_all?)` | `edit(filePath, oldString, newString, replaceAll?)` | 字面字串替換；默認要求唯一匹配；在默認 fs-observation-policy 下必須先觀測（任意視窗讀取均算作觀測）。 |

schema 使用 snake_case 欄位名（`file_path`、`old_string`、`new_string`、`replace_all`），與 Claude Code 及現有 DeepSeek Harness 工具 schema 示例保持一致。消費端包將這些面向模型的名稱轉換為 `ctx.fs` 呼叫和 `fs/*` 事件分發。

## 工具 schema

### `read`

`read` 檢視一個 UTF-8 文字文件並返回帶行號的內容。

參數：

- `file_path: string`——必填。要讀取的路徑，由 `ctx.fs` 解析。
- `offset?: number`——選填。返回的第一行，從 1 開始。預設為第一行。
- `limit?: number`——選填。返回的最大行數。預設值與上限是 `dsh-tool-fs` / `ctx.fs` 的實作細節。

首次實作不涉及的內容：

- 無 PDF `pages` 參數。
- 無圖片或多模態文件讀取。
- 不透過 `read` 列出目錄；如有需要，目錄清單將作為單獨的後續工具。

### `write`

`write` 建立或完整替換一個 UTF-8 文字文件。

參數：

- `file_path: string`——必填。要寫入的路徑，由 `ctx.fs` 解析。
- `content: string`——必填。要寫入的完整 UTF-8 文字內容。

在默認 fs-observation-policy 下，使用 `write` 更新已有文件需要同一執行上下文先前對該文件有過一次觀測（read/write/edit）；`dsh-fs-observation-policy` 外掛程式將觀測到的版本作為 `fs/write-intent` 上的過時版本防護提供。建立新文件不需要先前觀測。如果策略外掛程式不存在，`write` 是由裸提供方無條件執行的建立或覆蓋操作。

schema 不將 `expected_hash`、`expected_version` 或 `create_only` 作為面向模型的參數暴露。過時版本檢查由後端產生的版本和策略外掛程式的觀測狀態驅動，而非要求模型透過 schema 複製版本權杖。

### `edit`

`edit` 透過替換字面文字來更新已有的 UTF-8 文字文件。

參數：

- `file_path: string`——必填。要編輯的路徑，由 `ctx.fs` 解析。
- `old_string: string`——必填。要替換的字面文字。首次實作中空字串無效。
- `new_string: string`——必填。字面替換文字；空字串表示刪除匹配內容。
- `replace_all?: boolean`——選填。預設為 false。為 false 時，`old_string` 必須恰好匹配一處。

`edit` 要求同一執行上下文先前觀測過該文件（任何視窗化的 read 都算——授權取決於觀測到的版本是否仍為最新，而不要求查看全文），或該上下文先前對該文件執行過 write/edit。`dsh-fs-observation-policy` 策略外掛程式推導所有者，並將記錄的版本作為過時版本防護提供；提供方的變更鎖會強制執行該防護。

首次實作拒絕 Codex 風格的 patch 文法和多模式 edit API。它使用一種嚴格的字面替換模式，使面向模型的約定保持簡單，並讓後端掌控精確匹配、重複匹配、行尾和過時版本的語義。

## 結果形狀

首次實作曾將 `ContentBlock[]` 格式化邏輯放在 `execute` 中。[規範工具輸出約定](../architecture/2026-07-20-canonical-tool-output-contract.md)如今將 `ctx.fs` 的結果事實保留為工具經校驗的值，並透過 `output.render` 派生相同的模型文字；文件狀態的記錄/刷新仍歸 `ctx.fs` 所有。

默認原生投影：

| 工具 | `tool-fs` 使用的結構化 `ctx.fs` 結果 | 默認模型投影 |
|---|---|---|
| `read` | 返回的行、返回行數、總行數、目標顯示路徑、文件版本、部分檢視表標記 | 帶行號的文字及分頁頁腳 |
| `write` | 建立/更新操作、目標顯示路徑、新文件版本 | 簡潔的建立/更新成功文字 |
| `edit` | 替換次數、全量替換標記、目標顯示路徑、新文件版本 | 簡潔的編輯成功文字 |

結構化結果不會重複模型參數（如 `file_path`、`old_string` 或 `content`），除非後端已將其解析為新資訊（如 `displayPath`、`targetKey` 或新版本）。以節省 token 為目的的截斷屬於模型投影的職責，而非後端規範結果的一部分。

## 延後事項

以下內容被明確排除在首次檔案系統 schema 實作之外：

- 面向模型的 `expected_hash`、`expected_version` 或 `create_only` 參數。
- 目錄清單、glob、grep 和搜尋工具。
- 二進位安全的讀/寫操作。
- PDF/圖片/多模態 `read`。
- 檔案系統工具的 Code Mode 投影值。
- 規範的 edit diff 格式。

## 測試

schema 測試固定每個工具的必填/選填參數集、空 `old_string` 拒絕、`replace_all` 預設值、snake_case 欄位名、描述文字中對觀測策略的說明，以及根外掛程式套件註冊；整合測試透過 `ctx.tools.execute()` 對真實的 `dsh-fs-local` 提供方執行全部三個工具，並驗證模型參數被正確轉換為預期的 `ctx.fs` 呼叫和 `fs/*` 分發。

## 曾考慮的替代方案

- **Codex 風格的 patch 文法或多模式 edit API**：否決。一種嚴格的字面替換模式使面向模型的約定保持簡單，並讓後端掌控精確匹配、重複匹配、行尾和過時版本的語義。
- **camelCase 參數名（OpenCode 風格）**：snake_case 與 Claude Code 及現有 harness 工具 schema 示例一致，且命名一旦發布即成為公開 API。
- **面向模型的 `expected_hash` / `expected_version` / `create_only` 參數**：否決。過時檢查由後端產生的版本和策略外掛程式的觀測狀態驅動，從不相依性模型複製的脆弱權杖。

## 後果

**首版 schema 有意小於 Claude Code 的。** 去掉 PDF pages、多模態 read、豐富的 grep/list flag 和 expected hash 欄位使實作保持聚焦，但使用者可能很快就會提出這些需求。這些功能將透過獨立 Agent Note 或聚焦的後續工作引入，而不是讓初始 schema 承載過多內容。

**v1 中沒有顯式的面向模型的過時版本防護。** schema 不要求模型提供 expected hash/version。這是有意為之：過時檢查來自後端產生的版本和 `dsh-fs-observation-policy` 外掛程式的觀測狀態，而非模型複製的脆弱權杖。檔案系統安全失敗透過 `dsh-fs` 擁有的結構化 `FsError` 程式碼暴露，而非模型提供的版本欄位。

**命名成為公開 API。** 一旦發布，將 `file_path` 改為 `filePath` 或 `old_string` 改為 `oldString` 會導致提示詞、示例和下遊客戶端隨之改動。本 Agent Note 預先選擇 snake_case，並將其視為穩定的面向模型的約定。
