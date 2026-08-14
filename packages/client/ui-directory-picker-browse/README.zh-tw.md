# @deepseek-ai/dsh-client-ui-directory-picker-browse

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

應用內目錄瀏覽介面：瀏覽式選取互動的瀏覽器半邊。它透過 ui-workspace 的兩個 directory-flow 洞（`conversation.hero.workspace.directoryFlow` 與 `sidebar.workspaces.directoryFlow`）裝入「選擇工作區目錄」對話框，經 `ctx.workspaces` 驅動程式本機 Host 的 `host.listDirectory` 與 `host.createDirectory` 原語。它的 node 對側是 [`dsh-host-directory-picker-browse`](../../host/directory-picker-browse/README.md)；掛載本包即用一行 cordis.yml 把介面與該後端組合起來，因此沒有任何用戶端程式碼按能力種類分支。與 [`-native`](../ui-directory-picker-native/README.md) 介面不同，本對話框不需要本機作業系統選擇框，因此也服務於行程內與遠端瀏覽器部署。

對話框是 680×500 的 Miller 分欄檢視表（在較矮或較窄的視口中限制尺寸）：頭部承載標題、選中路徑麵包屑導覽和可點擊編輯的路徑區；下方在未選中行時是一整欄層級，選中後該行均分為「層級 | 選中資料夾的子項」兩欄。導覽落地是選擇錨定且安靜的——麵包屑導覽跳轉或提交路徑被掃描期間仍渲染舊檢視表，目標目錄與父目錄兩段導覽在同一幀完成——因此回退時，只要尚未到達顯示根目錄，就會始終保持兩欄，且不會閃過中間幀。**新建資料夾**打開一個巢狀建立對話框，目標為選中的資料夾，並選中它建立出來的那個；**打開**採納選中的資料夾，沒有選中時回落到當前層級。Host 標記的隱藏條目默認不顯示，直到頁腳開關將其揭開——那只是用戶端過濾。

確認一個目錄即為選中的路徑，關閉對話框即為取消。瀏覽類失敗——不可讀的目標、建立衝突——都留在對話框自己的提示區內，因此本佔位者從不驅動程式 owner 的 `onError` 分支；工作區建立的錯誤介面仍由 owner 持有。兩處註冊透過巢狀的 `slots.inject()` 安裝，因為任一聲明方條目都可能稍後啟用或替換其聲明；對話框文案註冊在本包自己的 locale 命名空間下，兩份字典作為一個單元落地，因此啟用失敗不會佔住該命名空間的其中一種語言。

node 半邊是一個空 `apply`：它的存在只為讓外掛程式出現在 host 的 cordis.yml 與 Loader 中，瀏覽器半邊經 `exports["./client"]` 出貨，並透過 `dsh.client` 清單聲明被發現。

## 模型體驗

無，因為目錄瀏覽器屬於瀏覽器介面；本包中的任何內容都不會進入模型請求。

#### KV Cache 影響

無；本包既不組裝也不傳送 provider 請求。

## 已知限制與暫緩事項

- **無搜尋、無多選、無重新命名或刪除** —— 對話框只負責列出與建立目錄；到達目標靠導覽、編輯路徑，或用前綴過濾最後一欄。
- **隱藏條目的過濾在用戶端** —— Host 始終列出隱藏條目並加標記，因此開關只改變對話框渲染什麼。
