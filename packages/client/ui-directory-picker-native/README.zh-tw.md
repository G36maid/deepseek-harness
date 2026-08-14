# @deepseek-ai/dsh-client-ui-directory-picker-native

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

原生目錄選擇介面：原生選取互動的瀏覽器半邊。它透過 ui-workspace 的兩個 directory-flow 洞（`conversation.hero.workspace.directoryFlow` 與 `sidebar.workspaces.directoryFlow`）裝入一個無渲染佔位者，每次收到 `open` 請求就用 `ctx.workspaces.pickDirectory()` 驅動本機 Host 的作業系統選擇框，然後透過 owner 工作階段回報恰好一個結果——選中的路徑、取消、或失敗。系統對話框本身屬於 [`dsh-host-directory-picker-native`](../../host/directory-picker-native/README.md)；掛載本包即用一行 cordis.yml 把介面與該後端組合起來，因此沒有任何用戶端程式碼按能力種類分支。

兩處註冊透過巢狀的 `slots.inject()` 作為一個事務性 effect 安裝，因為任一聲明方條目都可能稍後啟用或替換其聲明。佔位者在每個 `open` 上升沿只武裝一次，所以重渲染（包括採納期間 `busy` 而 `open` 仍為真）都不會再開第二個選擇框；owner 撤回 `open` 會為下一次請求重新武裝。結果經由 ref 回報，因此答案落到 owner 最新的處理器上，而不是打開選擇框時捕獲的那一套。解除安裝（HMR 替換佔位者）會整體丟棄該結果：wire 上沒有按請求的中止通道，所以 Host 側的選擇框會一直存在到被回答，它的答案無處可落，替換後的實例則在 owner 仍然打開的請求下重新武裝。

node 半邊是一個空 `apply`：它的存在只為讓外掛程式出現在 host 的 cordis.yml 與 Loader 中，瀏覽器半邊經 `exports["./client"]` 出貨，並透過 `dsh.client` 清單聲明被發現。

## 模型體驗

無，因為目錄選擇器屬於瀏覽器介面；本包中的任何內容都不會進入模型請求。

#### KV Cache 影響

無；本包既不組裝也不傳送 provider 請求。

## 已知限制與暫緩事項

- **無法取消已打開的選擇框** —— wire 上沒有按請求的中止通道，因此已經出現在 Host 顯示器上的選擇框無法從瀏覽器關閉；被丟棄的結果只是被忽略。
- **僅限本機 Host 載體** —— 系統對話框開在執行 Host 的機器上，所以行程內與遠端瀏覽器部署需要改用 `-browse` 組合。平臺失敗透過 owner 的可重試資料夾對話框呈現。
