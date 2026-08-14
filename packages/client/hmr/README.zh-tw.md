# @deepseek-ai/dsh-client-hmr

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

為透過指令碼載入的用戶端外掛程式提供熱重新載入。web 組合包無條件掛載該行；沒有重建 watcher（`pnpm run dev:web`）改寫用戶端 bundle 時，輪詢觀察不到變化，鏈路保持空閒。

瀏覽器側訂閱系統 SSE（Server-Sent Events）通道（`GET /plugins/events`），每個 `rebuilt` 幀重載一個外掛程式，並透過佇列序列執行。每幀的順序是：`invalidate`、`prefetch`（舊 fiber 仍在服務時載入並註冊新組合包）、`registry.delete`（在 fiber dispose（資源釋放）之前執行：僅 dispose fiber 會觸發 vendored Loader 的 self-dispose 分支，把設定項標為停用）、排空舊 fiber、刪除 `entry.fiber`、移除自身擁有的 `<style data-plugin>` 標籤、透過 `entry.refresh()` 重新匯入並掛載、透過 `fiber.await()` 直接重新拋出啟動失敗。相依性方由 Cordis 自身重載：fiber 的啟用 epoch 會串聯其服務提供方的 uid，因此替換提供方 fiber 會級聯所有相依性方，無需用戶端圖分析。node 側使用一個 interval 偵測重建：從同步基線開始 stat-poll 每個圖組合包；新增一行後立即重新計算 hash；缺失行保持 dirty；只廣播真實 rev 變更。因此，任何生成組合包的 tsdown watch 行程都能觸發 HMR（熱模組替換），無需 builder→host 通道。

## 模型體驗

無。重載驅動程式器屬於瀏覽器側機制；這裡沒有任何內容進入模型請求。

#### KV Cache 影響

無；該包（package）既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **重載有意保持粗粒度**：會建立全新的 fiber 和元件；重載外掛程式中的 React 狀態會丟失，資料層（連線 fiber、執行時期 fiber 和 Session 對象）不受影響。react-refresh 級狀態保留與「重新執行組合包會重新執行 factory」衝突，因此有意排除。
- **失敗時不回滾**：失敗的重載會使設定項處於 FAILED 狀態，並在 loader 狀態投影中顯示；系統不會自動復原先前組合包。
- **重建幀不會刷新圖 rev**：過時 rev 無害，因為組合包端點以 no-cache 提供內容；只有重新連線時才會刷新。
