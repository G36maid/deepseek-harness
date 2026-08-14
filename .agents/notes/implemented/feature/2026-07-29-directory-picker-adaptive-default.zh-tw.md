# Agent Note: 目錄選擇互動的自適應預設值

Status: implemented

[English](2026-07-29-directory-picker-adaptive-default.md) | [简体中文](2026-07-29-directory-picker-adaptive-default.zh.md) | 繁體中文

## 問題

[目錄選擇 seam](../architecture/2026-07-28-directory-picker-capability-seam.md) 把互動形態做成了 `cordis.yml` 的切換點，但隨附的組合仍必須固定一個後端：處處用 `-browse` 意味著本機操作者永遠得不到 OS 選擇器，處處用 `-native` 則弄壞所有遠端部署。正確的預設值取決於只有執行中的宿主才知道的事實——伺服器綁定在哪裡、行程是否經 SSH 啟動、是否存在顯示工作階段——因此沒有哪一靜態行對所有部署都正確。

## 決策

第三個同級包 **`dsh-host-directory-picker-auto`**：一個只有 node 半側的*選擇器*，不持有任何選取程式碼，也沒有 UI。它的 `apply` 在啟動時恰好取樣一次宿主事實——從注入的 `httpServer` 讀綁定宿主（新增的 `host` getter 與既有的 `port` 對稱）、`SSH_CONNECTION`／`SSH_TTY`、平臺、`DISPLAY`／`WAYLAND_DISPLAY`、以及對 Linux 選擇器二進位（zenity／kdialog）的一次 `PATH` 探查——經由一個匯出的純函式判定，再用 `ctx.loader.create({name})` 把選中的雙面後端掛進 Loader 的**記憶體根樹**；該 effect 的 disposer 會移除該條目並匯入後端 fiber 的拆卸（單靠 `remove()` 只是啟動拆卸），因此，只有後端完全靜止後，選擇器的解除安裝才會完成。`native` 要求全部“有人值守且可服務”訊號：回環綁定 ∧ 無 SSH 標記 ∧ native 後端能驅動程式的顯示工作階段——darwin／win32 上視為存在，linux 上要求 `DISPLAY`／`WAYLAND_DISPLAY` 外加一個選擇器二進位，其餘平臺一律不成立（native 後端恰好支持 darwin／win32／linux）。任何含糊情形都判定為處處可用的 `browse`。`apps/cli` 現在把 `-auto` 掛為它的 `directory-picker` 行；直接組合 `-native` 或 `-browse` 仍是固定互動的方式。

條目級掛載之所以是承重機制：client 模組表（`dsh-client-modules`）基於 `internal/plugin` 對 **Loader 條目**做響應式協調，因此以真實條目掛載的後端，其 browser half 被發現的方式與設定行完全相同——seam 的“一行同時換兩面”不變式在自適應下依然成立，且沒有一行重複的 client 程式碼。開發環境的 HMR 行（`AppCLIEntry`）是該機制的先例。瞄準根樹很關鍵：根樹的 `write()` 是 no-op，因此判定出的行絕不會被持久化回 `cordis.yml`（Include 子樹*會*寫回）。

## 曾考慮的替代方案

- **在 `AppCLIEntry` 裡做啟動膠水判定**（隨附兩行並帶靜態 `disabled`，由 `--directory-picker=auto|native|browse` 標志修補 `disabled`）。可行——`PatchOptions` 能修補元資料，模組掃描也會跳過停用行——但把決策留成應用私有，此後每個組合都要重新實作；選擇器外掛程式讓任何 `cordis.yml` 都獲得同樣的一行自適應。只有當某個部署需要不改自己的 yml 就*強制*指定後端時，才重新引入該標志。
- **合併成一個按呼叫分支的外掛程式**（client 先試 `pick`，收到 `directory-picker-unavailable` 再回退到瀏覽對話框）。否決：client 得把兩套流程裝進同一個 bundle——bundle 純淨閘門禁止跨外掛程式的值匯入，jscpd 禁止複製對話框——而且按呼叫探測讓 browse 宿主每次打開都付出一次註定失敗的 RPC。
- **復活 wire 廣播**，讓兩套 client 流程都掛載並按宿主的 kind 分支。否決：推翻 seam Agent Note 的那次刪除，卻服務不了任何選擇器尚未服務的消費端，還與 `single` 目錄流洞相衝突。
- **按連線自適應**（同一臺伺服器，回環瀏覽器用 native、遠端瀏覽器用 browse）。延期：需要按用戶端的能力對象、上述廣播，以及同時掛載兩套流程；今天沒有部署同時服務兩種操作者形態。

## 後果

- 隨附的 web GUI 開箱即自適應：有人值守的本機宿主 → OS 選擇器；SSH 啟動、全網路卡綁定、無頭宿主、不支持的平臺，或沒有選擇器二進位的 Linux → 應用內瀏覽器。探測是從啟動上下文推斷操作者位置，而任何啟動側訊號都無法證明這一點：脫離的 tmux 工作階段會丟失 `SSH_*`；非 Aqua 的 darwin 行程仍被算作有顯示；而 `ssh -L` 形態（在工作站本機啟動、之後經轉發埠訪問，從 `127.0.0.1` 到達）會判定 `native`，把選擇器彈在無人值守的工作站上——即便按連線自適應也修不了最後這一情形。錯誤的 `native` 選擇會退化為後端既有的可重試失敗對話框；處於這些形態的部署直接組合 `-browse`。
- 選擇器按執行時期字串（已匯出的 `BACKEND_PACKAGES`）掛載後端，yml 行掃描看不到這一點；因此 `verify-cordis-config` 要求每個掛載 `-auto` 的組合把兩個後端都聲明為相依性，使無金鑰的 Linux CI（它永遠只會判定出 `browse`）無法掩蓋被丟掉的 `-native` 相依性。隨附樹的 web e2e／快照通道（`apps/web/tests/scaffold.ts`）以 disable+insert 修補程式固定 `-browse`——其預期輸出取決於具體互動，絕不能相依性執行該套件的宿主。
- 每次啟動只判定一次，維持 seam 的能力穩定性約定；按連線的形態在有部署提出需求前仍不在範圍內。
- 同時掛載選擇器**和**某個後端行會明確報錯（重複的 `directoryPicker` 服務；`single` 洞中的重複流程）。
- host 型別檢查聚合現在引用兩個後端項目（僅聲明，node 入口不攜帶 client 合併），使選擇器的 REAL-composition 測試能掛載它們——與 client 聚合對 `webserver` 的引用互為映像檔。
