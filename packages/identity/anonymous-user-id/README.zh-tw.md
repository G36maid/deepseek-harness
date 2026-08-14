# @deepseek-ai/dsh-anonymous-user-id

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

工作階段遙測、直接回饋確認與 DeepSeek 提供方請求共用的匿名身份。`getOrCreateAnonymousUserId()` 返回一個限定於單個 harness home 的隨機 UUID v4，並以裸行形式持久化到 `$DSH_HOME/.anonymous-user-id`（未設定 `DSH_HOME` 時為 `~/.dsh/.anonymous-user-id`）。OpenTelemetry 後端將其作為 Resource 的 `user.id` 上報；`/feedback` 在確認文字中包含同一個值；`dsh-llm-deepseek` 則透過 `x-deepseek-harness-user-id` 傳送該值，使接收系統無需獨立生成身份即可關聯記錄。

該身份絕不從 hostname、網路地址、git remote 或其他可用於識別身份的來源派生。刪除 `.anonymous-user-id` 後，下次啟動行程時會重設身份。不同 harness home 擁有不同身份。

## 儲存約定

讀寫採用同步方式，因為啟動時構造遙測和直接執行命令都需要使用同一個 API。結果在行程生命週期內按解析後的檔案路徑快取。首個寫入方採用獨佔建立；並行競爭中失敗的一方會採用已持久化的勝出值。損壞的文件會被替換。持久化採用 best-effort，因此即使 home 不可寫，系統仍會返回行程本機 UUID，而不會阻塞遙測或回饋。

## 組合

本包是共享庫，並非 Cordis 外掛程式。消費端直接匯入 `getOrCreateAnonymousUserId()`。其不變式伴生外掛程式刻意留空，因為本包既不擁有事件串流，也不擁有任何可以在不觸發建立身份這一副作用的情況下檢查的公開可變關係。`DSH_TELEMETRY_DISABLED` 只會停止遙測匯出，不會禁止直接回饋確認或 DeepSeek 提供方標頭。

## 模型體驗

無，因為該識別符號只會作為模型不可見的 HTTP 傳輸中繼資料傳送給 DeepSeek，絕不會進入請求正文、提示詞或模型可見內容。

#### KV Cache 影響

無；該傳輸標頭既不會改變 token，也不會改變模型可見前綴。

## 已知限制與暫緩工作

- **刪除後無法復原**：身份丟失後會按設計生成新的匿名身份；若要復原身份，就需要穩定的派生材料，這會削弱匿名性。
- **Best-effort 並行**：如果讀取方恰好落在並行行程完成獨佔建立但尚未寫完的狹窄時間窗內，本次執行可能使用不同的記憶體 UUID；後續啟動會收斂到已持久化的值。
- **沒有跨 home 身份**：不同 `$DSH_HOME` 值之間無法關聯。
- **已設定的 DeepSeek gateway 會收到該 id**：`dsh-llm-deepseek` 會把穩定標頭髮送至解析後的 `baseURL`（包括部署覆蓋），且不受遙測共享模式影響。
