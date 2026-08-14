# 第三方記憶 MCP 示例

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

這三份**預設關閉的參考設定**透過 [`@deepseek-ai/dsh-mcp-client`](../../packages/mcp/mcp-client/README.md) 將一個記憶系統連線到 DSH。請選擇其中一份，或複製相同的通用 MCP 設定項來連線其他伺服器。

這些第三方設定僅作為互操作參考；收錄不代表 DeepSeek 的認可、推薦、合作關係或持續支援承諾。

## DSH 負責什麼

DSH 解析選中的 Cordis overlay，啟動已設定的 stdio 命令或連線已設定的 Streamable HTTP URL，發現 MCP 工具，並以 `mcp__<serverName>__<tool>` 的形式公開這些工具。DSH **不負責** 下載伺服器、初始化其資料庫、選擇模型或 embedding 提供方、建立雲端帳戶、遷移提供方資料，也不監管獨立的 HTTP 服務。對於 stdio，通用用戶端會隨 DSH 外掛程式生命週期啟動和停止子行程；對於 HTTP，上游服務必須已經執行。

stdio 橋接器在啟動子行程前會主動移除環境中名稱通常表示憑據的變數和所有 `DSH_*` 變數；其餘環境變數仍會繼承。每份示例僅新增其基線所需的覆蓋項。如果某個選填的上游功能還需要其他金鑰，請將該變數新增到設定項的 `config.env`，不要把金鑰直接寫進 YAML。

## 選擇一個

| 系統 | 已測試版本 | 傳輸方式 | 上游前置條件 |
|---|---:|---|---|
| [Memorix](https://github.com/AVIDS2/memorix) | `memorix@1.3.0`（`500792cad3144142293bfbb20acb4841c9f7fcfa`） | stdio | Node 22.18+，並執行 `npm install --global memorix@1.3.0` |
| [MCP Reference Memory](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) | `@modelcontextprotocol/server-memory@2026.7.4`（`6dd0a683e198783e30feabf7abaf42f925bd18b1`） | stdio | `npm install --global @modelcontextprotocol/server-memory@2026.7.4` |
| [Engram](https://github.com/Gentleman-Programming/engram) | `v1.20.0`（`ba9e46ced152c37a7cb9e576153c41995873e2fc`） | stdio | Go 1.25.10+，並執行 `go install github.com/Gentleman-Programming/engram/cmd/engram@v1.20.0`，或安裝匹配的發布版二進位檔案 |

## 啟用一個

將一份 overlay 傳給 DSH：

```sh
dsh web --patch "$PWD/examples/mcp-memory/memorix.cordis.yml"
```

請將檔名替換為 `mcp-reference-memory.cordis.yml` 或 `engram.cordis.yml`。該路徑可以指向磁碟任意位置的一份複製文件。交付組合不包含任何記憶伺服器，因此不傳 `--patch` 就會讓這三項全部保持關閉。

如果要跨次執行保留所選設定，請將對應文件中的單個 `insert` patch 合併到使用者 patch 層：只對一個 profile 生效則寫入 `$DSH_HOME/profiles/<name>/cordis.patch.yml`，對本機所有 profile 生效則寫入 `$DSH_HOME/cordis.patch.yml`。不要覆蓋已有文件，其中可能已經包含無關的使用者 patch。

## 提供方設定

### Memorix

```sh
npm install --global memorix@1.3.0
dsh web --patch "$PWD/examples/mcp-memory/memorix.cordis.yml"
```

Memorix 無需 LLM（大型語言模型）或 embedding 服務，即可在本機啟發式模式下執行。請在 Memorix 自己的 `~/.memorix/config.toml` 或項目 `memorix.toml` 中設定選填提供方。該示例沿用 DSH 工作目錄中的 Git 項目標識，並使用 Memorix 自身的預設目錄 `~/.memorix/data`。若要覆蓋該目錄，請在啟動 DSH 前設定 `MEMORIX_DATA_DIR`。

### MCP Reference Memory

```sh
npm install --global @modelcontextprotocol/server-memory@2026.7.4
dsh web --patch "$PWD/examples/mcp-memory/mcp-reference-memory.cordis.yml"
```

該參考伺服器儲存本機知識圖譜，並公開實體、關係、觀察、讀取、搜尋和打開工具。它不需要模型或 embedding 服務。該示例將 JSONL 儲存在 `$HOME/.dsh-mcp-reference-memory.jsonl`，而不是已安裝的 npm 包目錄中。若要覆蓋該路徑，請在啟動 DSH 前設定 `MEMORY_FILE_PATH`。

搜尋只對實體名稱、類型和觀察進行不區分大小寫的子字串匹配，不是語義檢索。該伺服器不提供 embedding、自動摘要、衝突消解或遺忘策略。

### Engram

```sh
go install github.com/Gentleman-Programming/engram/cmd/engram@v1.20.0
dsh web --patch "$PWD/examples/mcp-memory/engram.cordis.yml"
```

Engram 負責儲存和項目選擇：它預設使用 `~/.engram`，從 DSH 工作目錄偵測 Git 項目，並接受 `ENGRAM_DATA_DIR` 或 `ENGRAM_PROJECT` 作為環境覆蓋項。

## 選填的共用模型指令

如果伺服器的工具描述無法可靠觸發記憶使用，請將以下簡短、與提供方無關的指令新增到你現有的模型指令中：

> 使用者要求記住某事時呼叫記憶寫入工具；歷史資訊可能相關時，檢索記憶並使用相關結果。

這只是附加指導。示例不會替換 DSH 系統提示詞中的 persona。

## 驗證寫入、新工作階段召回和使用

請在整個程序中使用一個唯一值，並保持提供方的儲存範圍不變：

1. 在 DSH 工作階段 A 中提出：`Remember that my validation drink is lapsang-<unique suffix>.`。確認模型呼叫了提供方的寫入工具，並且工具返回成功。
2. 在同一個仍在執行的 Host 中建立 DSH 工作階段 B。不要複製工作階段 A 的對話。提出：`What is my validation drink? Check memory.`。確認模型呼叫了提供方的搜尋或召回工具，並返回該值。
3. 繼續在工作階段 B 中提出：`Use that preference to suggest one drink for the meeting.`。確認回答使用了召回的值。

必須新建 DSH 工作階段，但不需要重新啟動 Host。只有 MCP 子行程崩潰後才需要重新啟動或執行 HMR（熱模組替換），因為當前的通用用戶端不會自動重連；其工具註冊會一直保留，直到外掛程式 dispose（資源釋放）或成功重新同步，針對已關閉傳輸的呼叫可能失敗。初始發現程序是非同步的，因此傳送第一條驗證提示詞前，請等待提供方的 `mcp__...` 工具出現。

## 接入其他 MCP 伺服器

複製相同的條目欄位，並使用唯一的 `id` 和 `serverName`：

```yaml
- insert:
    - id: memory-my-server
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: my-memory
        transport: stdio
        command: my-memory-mcp
        args: []
        env: {}
        cwd: !!js process.cwd()
```

對於遠端伺服器，請改用 `transport: streamable-http`、`url` 和 `headers`。提供方專屬的安裝、身份、驗證、模型、embedding、持久化和許可仍由提供方負責。
