# @deepseek-ai/dsh-tool-str-replace-editor

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

基於 `ctx.fs`、面向模型的獨立 `str_replace_editor`。它可與持久 Bash、一次性 Bash、沙盒 Bash 或其他終端機介面組合。

## 設定

| 鍵 | 預設值 | 含義 |
|---|---:|---|
| `maxOutputChars` | `16000` | 文件和目錄查看結果保留的前綴字元數。 |
| `description` | 編輯器命令指南 | 面向模型的工具描述。 |

## 工具

schema 提供針對絕對路徑的 `view`、`create`、`str_replace` 與 `insert`。文件查看使用從 1 開始的行號，並保留內容中的製表符，因此顯示的文字仍可作為有效的字面量替換輸入；目錄查看忽略隱藏、相依性與 Python 快取條目並下探兩層。`view`、`str_replace` 或 `insert` 發生中繼資料未命中時，工具會在返回 `FS_NOT_FOUND` 前記錄確認缺失，因此後續 `create` 可以透過已掛載策略的防護建立流程復原外部刪除的路徑；缺失狀態絕不會授權 `str_replace` 或 `insert`。替換要求字面量唯一匹配，錯誤只使用公開的 `old_str` 詞彙。插入遵循所選的零基插入邊界，不會隱式補尾換行。修改操作會保留請求編輯範圍之外的製表符。

## 模型體驗

### 工具 schema

#### 模型看到的內容

生成的 [`str_replace_editor` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-str-replace-editor)，其中包含設定的 `description`。本外掛程式不貢獻獨立系統提示詞段。

#### Token 影響

`str_replace_editor` 可見時產生固定的 schema 成本。

#### KV Cache 影響

設定的描述與 schema 不變時前綴穩定。

### 工具結果

#### 模型看到的內容

查看操作返回帶行號文字或淺層目錄清單。呼叫會提供文件位置，建立/替換呼叫還會向展示層提供 diff 卡片。修改操作返回簡潔確認。長查看結果保留前綴並追加截斷提示。

#### Token 影響

隨資料變化，並受 `maxOutputChars` 與固定截斷提示約束。

#### KV Cache 影響

工具結果以追加方式位於可複用請求前綴之後。

## 已知限制與暫緩事項

- 操作面向 UTF-8 文字，不支援二進位檔案。
- `str_replace` 刻意拒絕零匹配或多匹配，且沒有 `replace_all` 參數。
- 每個修改操作都會經過 `fs/write-intent` 或 `fs/edit-intent`，解析當前工作階段的沙盒策略，並交由掛載的檔案系統與策略外掛程式實施約束。
