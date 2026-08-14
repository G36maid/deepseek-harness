# @deepseek-ai/dsh-sdk-jsonrpc-demo

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

只包含 bin 的應用，啟動外部 `cordis.yml`；其 [`jsonrpc`](../../sdk/server/README.md) 入口透過按換行分隔的 stdio 為 SDK 用戶端提供服務。設定負責組合主幹、後端和服務外掛程式。發布的 `dsh-jsonrpc-agent` bin 從設定項目解析裸外掛程式。Python SDK 的 `dsh-jsonrpc-agent-pkg` [單文件可執行執行時期](../../../.agents/notes/implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md)改用 `lib/packaged-bin.js`：已打包的裸外掛程式從封閉執行時期包樹解析，相對外掛程式仍以設定目錄為基準。

## 設定發現

第一個非空通道生效：先 `$DSH_CORDIS_CONFIG`，再位置參數 `argv[2]`。如果二者都沒有指向現有文件，bin 會向 stderr 列印單行用法並以 1 退出；沒有工作目錄回退或內建回退。[`dsh-app-boot`](../../boot/app-boot/README.md) 會使外掛程式載入失敗成為致命錯誤。此協議不使用 `DSH_SNAPSHOT`。

不含 `dsh-sdk-jsonrpc-server` 的設定仍然有效，只是不提供任何服務；bin 不會指定伺服器外掛程式。

## 退出生命週期

stdin EOF 和 `SIGTERM` 會 dispose（釋放資源）根上下文，等待完全靜止後以 0 退出；`SIGINT` 完成同樣的 dispose 後以 130 退出。EOF 可能按[分發 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md) 所述截斷正在處理的輪次。`jsonrpc` 外掛程式擁有先回應再退出的協議關閉流程；兩條路徑均冪等，即使發生競態也安全。

## stdout 是協議

stdout 只承載 JSON-RPC 幀。bin 和啟動守衛在 stderr 上輸出診斷，設定必須省略 stdout logger。

## 模型體驗

模型體驗由外部 `cordis.yml` 載入的外掛程式間接提供；這些外掛程式負責所有面向模型的提示詞、schema、訊息和結果，此 bin 不新增任何內容。

#### KV Cache 影響

不會直接失效；由上述消費端負責請求前綴的任何變更。

## 已知限制與暫緩事項

- **bin 無法證明設定提供 JSON-RPC 服務**：不含 `dsh-sdk-jsonrpc-server` 條目的有效設定也能成功啟動，但不會提供任何服務。
- **不存在內建或預設配置**：每次啟動都必須提供 `DSH_CORDIS_CONFIG` 或位置路徑；部署方負責完整的外掛程式樹和 stdout 紀律。
- **stdin EOF 會截斷正在處理的工作**：用戶端消失時立即釋放根上下文；需要有序完成的呼叫方應使用協議級 `shutdown` 請求。
