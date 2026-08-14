# @deepseek-ai/dsh-client-ui-commands

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

用戶端命令 API（`ctx.commandUi`）：以工作階段為 key 的命令目錄快取、帶 `matchSpace`／`matchEnter` 決策掛鉤的 `/` 命令 source、三類派發（`execute`／`popupSelect`／`leadingInput`），以及面向業務包的 popupSelect 註冊。[Web 命令 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-25-web-command-surfaces-and-assembly.zh.md) 記錄了這項決策。

`src/client/contract.ts` 是固定的業務 API 約定：`CommandUiContract.register(name, spec)` 與 `decorate(name, spec)` 是業務包消費的全部內容；`CommandUiSpec{options, onSelect}` 自己提供 popup 資料——外層元件歸本包所有，業務包永遠見不到它。貢獻項是用戶端自有命令（與 host 命令同名時會明確報錯）；裝飾項則為**已存在的** host 命令新增裸呼叫 popup。host 保留目錄行、帶參 claim（空格／帶參數的 Enter）與生命週期記帳，被裝飾的名字若在工作階段目錄中無 host 行，則永不觸發。命令類型按每次派發派生，絕不在註冊時定型：帶 `input` 的 host descriptor 是 `leadingInput`，註冊了 `CommandUiSpec` 的是 `popupSelect`，其餘全部是 `execute`。

`CommandDirectory`（`src/client/directory.ts`）是唯一的 wire 派生快取，以工作階段為 key。普通工作階段透過 `command.list({sessionId})` 拉取，source 的 scope 出生 `warm` 掛鉤會預熱該工作階段的快取項。由目錄尋址的可繼續子代理會在用戶端解析為空命令目錄：`command.list` 綁定 Agent，若預熱它，就會僅因查看持久化歷史而啟用子代理。快取項由轉發的 owner 事件 `commands/change` 軟失效（重拉運送中期間舊快照繼續服務），也由轉發的 `agent-preset/selected` 對該工作階段單獨軟失效（重組 agent 不產生任何註冊，登錄檔級訊號不會為它觸發），由 `connection/reset` 硬失效，並以 epoch 把關，被取代的舊拉取永遠無法覆蓋更新的結果。`matchSpace` 只憑該快取同步應答；`matchEnter` 在 SubmitAttempt 訊號上強等快取，預熱失敗即拒絕——`/` 開頭的一行絕不會被靜默降級為普通提示詞。

`command.execute` 返回已匹配的命令結果後，當前瀏覽器會發布本機 `command/executed(sessionId, name, result)`。其他用戶端只會透過 Host 事件串流收到持久命令節點，不會收到這條確認，因此瀏覽器專屬副作用可以篩選由實際提交命令的用戶端收到的成功結果，而不會把 Session 重播當成操作請求。監聽器失敗會逐項記錄並隔離，不會改變已經准入的命令結果，也不會阻止後續監聽器執行。

選單查詢會按順序且不區分大小寫地模糊匹配命令名的子序列。前綴排名最高；其餘匹配項按分隔符邊界優先、相鄰字元優先、間隔越短越優先的規則排序，若仍同分，則以目錄順序和貢獻項順序打破平局。此行為隻影響命令發現：space 和 Enter 仍要求命令名精確匹配。原理：[Web 斜槓命令模糊發現](../../../.agents/notes/implemented/feature/2026-08-04-web-slash-command-fuzzy-discovery.md)。

`PopupSelectController`（`src/client/popup.ts`）是不含介面的外殼狀態：`PopupSelectView` 自行註冊進 `conversation.input.overlay`（SlotMap key 歸 ui-conversation 所有；本包只以 type-only 匯入引入該聲明——沒有執行時期相依性邊）。殼是打開期間持有焦點的瞬態層；onSelect 之後的 token 片段消費在兩條分支上都經 `consumeTokenSegment` 執行（選單路徑做 span CAS，回車路徑做裸 token 相等比較），作用於接線層經 `bindDraft` 綁定的草稿表層。

`/client` 入口匯出外掛程式主體（`apply`／`inject`）、`CommandUiRuntime`、目錄類和 popup 類及其狀態類型，以及固定的約定類型；外層元件本身是 overlay 註冊的內部實作。

## 模型體驗

間接影響，途徑是本包的派發與 `claim.submit` 路徑觸發的 host `command.execute` RPC：匹配命中的命令，其 handler 會修改 host 領域狀態，其他包再把該狀態投影進下一個請求（`/plan` 的 handler 翻轉 plan 模式，其歸屬包注入 `plan:policy` 系統提示詞 section），而命令列本身、detached result 與所有選單／notice 渲染都留在用戶端，永不進入工作階段日誌。

#### KV Cache 影響

無直接影響；該包既不組裝也不傳送提供方請求。它觸發的命令 handler 可能改變歸屬 host 包對下一個請求系統提示詞的貢獻（某個 section 的出現或消失會替換較早的請求 token，並使提供方前綴從該點起失效），但這一影響由各命令的 host 包擁有並記錄。

## 已知限制與暫緩事項

- **脫離工作階段後，detached result 的 notice 回退到 console**：fire-and-forget 路徑經 `SessionInput.notify` 把結果送到觸發工作階段的 composer；工作階段銷毀後，console 輸出行是僅剩的呈現面。
