# Agent Note: 接納 basename 相同的 Workspace

Status: implemented

[English](2026-07-31-same-basename-workspace-adoption.md) | [简体中文](2026-07-31-same-basename-workspace-adoption.zh.md) | 繁體中文

## 問題

Workspace 的身份由其穩定 id 和規範目錄路徑確定，標題則是可變的顯示元資料。然而，只要新規範路徑按 basename 派生出的標題與另一個 Workspace 相同，登錄檔就會拒絕該路徑。因此，`/a/xx` 和 `/b/xx` 等常見目錄版面配置無法同時出現在 Web UI 中，儘管[領域設計](../../proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md)早已允許標題重複，而且每項用戶端操作都透過 id 定位 Workspace。

## 決策

`ctx.workspaceRegistry.create(path, title?)` 僅以規範路徑作為唯一性鍵。重複傳入同一路徑仍保持冪等，並保留已註冊的標題。不同的規範路徑會建立不同的 Workspace 記錄，且可以共用標題；未提供標題時，每條記錄仍從 `basename(path)` 派生標題，不新增後綴，也不改寫標題。

Host 的 `workspace.create({ path })` 接納入口沿用該規則。Workspace 管理器、選擇器、分組樹、選擇、重新命名、刪除和 Session 建立仍使用 `WorkspaceId`，因此相同標籤既不會合並記錄，也不會把操作指向其他記錄。需要區分相同標籤時，側邊欄懸停詳情卡會顯示各自的規範路徑。

顯式命名仍採用更嚴格的規則。`workspace.rename` 仍會拒絕已註冊的標題，具體見[手動 Workspace 命名](../feature/2026-07-25-session-list-browsing-and-manual-order.md)。這既防止使用者主動引入另一個難以區分的標籤，又允許既有目錄名稱造成的重名。路徑接納規則僅取代 [Workspace 產品流](../feature/2026-07-25-workspace-ui-product-flow.md)和[原生目錄選擇器](../feature/2026-07-27-native-workspace-directory-picker.md)中的標題衝突條款。

持久化 schema 未變：Workspace 記錄本就分別儲存 id、path 和 title，引導初始化可以派生出相同的 basename，啟動校驗檢查的是重複路徑而非重複標題。

## 驗證

Workspace 登錄檔與 Host API 測試會在不同父目錄下建立兩個末級名稱相同的真實目錄，並斷言其 id 和路徑互不相同，且持久化順序正確。選擇器元件將相同標籤渲染為按 id 區分的獨立條目。無金鑰 Web 瀏覽器場景透過組合而成的目錄流程接納這兩個目錄，並觀察到兩個 Workspace 均已註冊且完成渲染。

## 考慮過的替代方案

**保持標題唯一，並拒絕第二個目錄。** 顯示標籤仍會意外充當身份鍵，普通的多根目錄版面配置仍無法註冊。

**自動為衝突標題新增後綴。** 像 `xx (2)` 這樣的生成標籤將不再是從目錄派生的標題；系統還需要制定跨刪除與重載保持穩定的分配規則，並且只為掩蓋身份判定錯誤而增加狀態。

**將完整路徑用作每個 Workspace 的標題。** 這會消除衝突，卻使主導覽標籤不必要地過長。完整路徑仍可在懸停詳情中查看，而簡潔的 basename 仍有價值。

**也允許顯式重新命名操作產生重名。** 登錄檔支持這種狀態，但該操作本就是明確要求使用者選擇顯示名稱。保留衝突回應可維持現有命名防護，同時不阻止從檔案系統選取的路徑。

## 後果

兩個 Workspace 行可能顯示相同的可見標題。id 負責身份，因此兩行仍可獨立選擇和操作；使用者可以查看路徑或重新命名任一行以作區分。顯式重新命名不能採用另一個行當前使用的標題，即使該標題源自 basename 相同的目錄接納。無需儲存遷移或相容路徑。
