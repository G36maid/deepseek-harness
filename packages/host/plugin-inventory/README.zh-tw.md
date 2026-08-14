# @deepseek-ai/dsh-host-plugin-inventory

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

當前 Cordis Loader 樹的只讀 Host 投影。`PluginInventoryGateway` 註冊 `pluginInventory` 服務，並行布一個由 Typert 生成的直接 Remote：`pluginInventory/list`。每次呼叫都直接讀取 `ctx.loader.entries()`，跳過結構性的 group 行，再按 Loader 順序返回其餘條目，並且只包含 Loader 條目 id、模組標識、有效啟用狀態與當前根 Fiber 階段。

階段為 `pending`、`loading`、`active`、`failed` 或 `unloading`；條目沒有存活的根 Fiber 時則為 `null`。該快照刻意只表示呼叫當下：Loader 仍是唯一的生命週期權威，本包不擁有快取、歷史、來源模型、事件串流或修改路徑。公開 payload 類型位於 `./types`，Typert 生成由 `./typert` 與 `./remote` 匯出的 Host 和 Client Remote 產物。

該服務僅供 Remote 使用，刻意不聲明同進程 Cordis `Context` merge。Client 包透過顯式的 [`api-remotes`](../../api/remotes/README.md) 組合消費它，而不匯入 Host 實作。

## 模型體驗

無，因為這個僅限 Host 的清單投影不註冊提示詞、工具、訊息或提供方請求。

#### KV Cache 影響

無；本包從不組裝模型輸入。

## 已知限制與暫緩事項

- **僅表示呼叫當下** —— 結果不包含持久的失敗歷史或訂閱；只要不存在存活的根 Fiber，就會報告 `null`，而不區分其原因。
- **無來源與修改能力** —— 服務不識別條目由哪個 bundle、profile 或 override 引入，也不能啟用、停用、新增或移除外掛程式。
