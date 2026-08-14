# @deepseek-ai/dsh-storage-sqlite

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

[儲存中心](../storage/README.md)的 SQLite 後端：註冊為後端 `sqlite`，透過一個數據函式庫提供 `kv` facet；該資料庫由 `node:sqlite` 操作，可以是單個文件，也可以是 `:memory:`。設計與取捨見[領域 KV 儲存 Agent Note](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md)。

## 儲存模型

每行一個文件：每個單元表都會成為一個物理 STRICT 表 `"u_<unit>_<table>" (key TEXT PRIMARY KEY, value TEXT)`，其中 `value` 是記錄的 JSON 文字，因此一個 key 只更新一行（高頻變更領域路由到這裡而非 JSON 後端的原因）。單元標識位於兩個中繼資料表中：`units` 在單元首次打開時標記其格式版本，描述符不同時以 `version-mismatch` 拒絕；`unit_globals` 保存每個單元的全域性單例行。物理版面配置版本位於 `PRAGMA user_version`；其他任何標記值都會被拒絕（未發布格式，不遷移）。單元名和表名在進入 DDL 之前依據中心的 `UNIT_NAME_RE` 進行驗證，因此不會把外部輸入插值到 SQL 識別符號中。

每個寫入原語都是一條預處理語句：SQLite 的逐語句原子性無需顯式交易即可滿足 KV 約定，寫入順序仍由呼叫方負責（領域層寫入鏈）。缺失目錄和資料庫文件會以僅所有者可訪問的權限建立（`0o700`／`0o600`），與工作階段持久化 SQLite 後端一致。

## 設定（schemastery）

```ts
interface Config {
  path: string   // SQLite database file path, or ':memory:' for an in-process DB
  journalMode?: 'wal' | 'delete' | 'truncate' | 'persist'   // journal_mode pragma; default 'wal'
}
```

## 模型體驗

### 已存領域記錄

#### 模型看到的內容

無。該後端不貢獻提示詞、工具或 schema；它在 `ctx.storage` 後面持久化非工作階段領域資料（工作區記錄、未來的工作階段伴隨中繼資料），只供主機側消費端使用。

#### Token 影響

即時請求 token 為零。

#### KV Cache 影響

無：該後端從不觸碰即時請求前綴。

## 已知限制與暫緩事項

- **`DatabaseSync` 是同步的**：每次寫入都會在單條語句執行期間阻塞事件迴圈；在領域資料規模下可以接受。
- **沒有忙等待或重試策略**：另一個連線持有寫交易時，該操作會立即被拒絕；沒有多行程寫入保護。
- **只打開當前的 `STORAGE_SQLITE_SCHEMA_VERSION`**：其他任何已標記版本都會被拒絕而不是遷移（預發布立場）。
- **`openDatabase` 重複了工作階段持久化 SQLite 的打開順序**：提取到共享介質層的工作暫緩至計畫的工作階段後端遷移（見 Agent Note 的複用審計）。
