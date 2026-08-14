# @deepseek-ai/dsh-client-modules

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

用戶端模組系統：Node 內部 ESM loader 的瀏覽器端對等實作，以惰性 CJS 表實作。web 外殼掛載 vendored cordis Loader 來治理設定項（fiber 生命週期、inject 等待、update/refresh），並透過其 `internal` 約定注入該包的 `ClientModuleLoader`；vendored 一側唯一的消費點是 `EntryTree.import`，因此替換 `internal` 恰好只會替換「外掛程式程式碼如何到達」，不會改變其他內容。

惰性 CJS 模型（web2）：執行外掛程式 bundle 只會註冊其 factory（`window.__ModuleLoader__.load({id, factory})`）；每個模組主體的副作用（包括 CSS 注入）都位於 factory 閉包中，在物化時執行（`factory(require)` → 匯出表層，並在 `loadCache` 中記憶化），不會在指令碼執行時執行。如果 factory 相依性另一個已註冊但尚未物化的模組，系統會遞迴物化它，因此載入順序無需外部編排；require 迴圈會拋出例外（factory 形式的 CJS 無法提供部分匯出）。`<id>/client` 與裸 id 指向同一表層（一個外掛程式 bundle 就是其包的用戶端側）。

解析分支順序（`import(specifier)`）：平臺種子詞 → 外殼實例；記憶化記錄 → 表層；外殼自身的靜態登錄檔（`registerStatic`，app-shell）→ 模組；已註冊 factory → 物化；模組圖記錄（`window.__DSH_BOOT__`）→ 載入外部 classic script + 物化；其他情況一律拋出例外。這是建置時 bundle 純度閘門的執行時期映像檔。交給 factory 的同步 `require` 採用相同順序，但不含非同步載入分支，並把觀察到的邊記錄到模組記錄中。`prefetch` 是第一階段到達掛鉤（只載入指令碼並註冊 factory；並行呼叫共享一個進行中的任務）；`invalidate` 會丟棄 factory 與物化記錄，使下一次 prefetch/import 重新載入指令碼；它是 HMR（熱模組替換）掛鉤。

Node 側會掃描已啟用的 Loader 設定項以發現 web `dsh.client` 包，解析每個 `exports["./client"]`，把建置後的 bundle 雜湊寫入啟動圖，並透過 `/plugins` 提供該文件及其 sourcemap。原始碼啟動會把宿主側匯入對映到 TypeScript 原始碼，但仍消費這一建置後的用戶端匯出；缺失文件共享一條建置說明，隨後以包／路徑清單列出各項，而無關的檔案系統錯誤仍是獨立故障。

## 模型體驗

無。模組 loader 屬於瀏覽器側核心機制；這裡沒有任何內容進入模型請求。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **有意採用扁平模組圖**：每個 bundle 是一個模組節點，其邊只指向表中的葉節點；介面（`loadCache`/`edges`/`invalidate`）已經支持通用模組圖，因此可以改變 externalization 粒度而不更改介面。
- **自身不維護解除安裝記錄**：樣式移除與 fiber 拆卸順序屬於 HMR 驅動程式器（`@deepseek-ai/dsh-client-hmr`）；loader 只在每條記錄中登記其擁有的樣式標籤 id。
