# Agent Note: 一份共享 base 設定加各 surface 的 overlay

Status: implemented

[English](2026-07-29-shared-base-config-overlays.md) | [简体中文](2026-07-29-shared-base-config-overlays.zh.md) | 繁體中文

## 問題

`dsh` 交付了兩棵完整的設定樹，其中有 43 個共享設定項。`apps/cli/cordis.yml` 以 74 個平鋪設定項組合 web surface，而 TUI 啟動的是 `examples/tui-agent/cordis.yml`——其中單獨一行 `@deepseek-ai/dsh-tui-demo` 掛載了十二個外掛程式，並把它們的設定重新聲明為自己那份二十個鍵、僅作透傳的 `Config`。

這兩份文件都名不副實。`examples/tui-agent` 並不是示例：`apps/cli/src/tui.ts` 把它硬編碼為產品的預設配置；它還擁有 TUI 的 PTY 冒煙測試、八個終端機快照場景，以及被 `cordis-agent` 葉節點 import 的 PTY harness。`dsh-tui-demo` 也不是 demo——它就是應用本身，由交付的二進位從 `packages/examples/` 中掛載。

真正決定性的問題是重複。43 個共享設定項中，38 個逐位元組相同，5 個因各 surface 的正當理由而不同；因此每次能力改動都必須改兩處，而且可能無聲漂移。該組合包還反轉了一個預設值：`composeTuiApp` 讀取 `config.goals ?? {}`，於是交付的 TUI 掛載了 goals、`tool-goal`、`goal-round-driver` 和 `/goal`——儘管沒有任何設定鍵要求它們。

## 決策

一份共享 base，每個 surface 一份 overlay，以平級 patch 清單的形式組合。

`apps/cli/config/base.cordis.yml` 持有兩個 surface 都會掛載的 43 個設定項。`apps/cli/config/tui.cordis.yml` 與 `apps/cli/config/web.cordis.yml` 是 **patch 清單**，不是設定樹：各自聲明少數取值因 surface 而異的設定項，並 insert 自己的設定項。啟動器只 include base 一次，並把每個 overlay 作為**同一** include 層級上的平級 patch 清單應用——因為 include patch 不會跨越 include 邊界，把 overlay 堆疊成巢狀 include 會使其靜默地無法觸達 base 設定項。

優先級即清單順序，逐設定項後寫者勝：base，然後是 surface overlay，接著是 `--config` overlay 或個人 `~/.dsh/config.yaml`，最後是啟動器自身的 flag 與 profile patch。

`--config <path>` 現在應用一個 overlay 來**取代**個人 overlay，因此 demo 或測試用的樹絕不會繼承使用者的提供方與 model。`--config-replace <path>` 則把某個文件作為整棵樹啟動，同時繞過 base、surface overlay 與個人 overlay；這正是舊 `--config` 的行為，所以像 `examples/web-cordis` 這樣的樹改用了新 flag。兩個 flag 都會在 `/resume` 的 execve 交接中保留，否則復原時會靜默更換 agent（代理）。

patch 會整體替換目標設定項的 `config` 而不合併。因此，取值因 surface 而異的設定項住在 overlay 中，絕不住在 base 裡，從而沒有任何設定項會被三層同時 patch。工作階段身份根本不能經由設定鍵傳遞——它遷移到了 `dsh-agent-loop` 的 `CONFIGURED_AGENT_IDENTITIES_KEY`，正如啟動器持有身份的記錄所述。

`examples/tui-agent`、`examples/cordis-agent`、`examples/code-mode` 與 `packages/examples/tui-demo` 均被刪除。TUI 測試遷往 `apps/cli/tests/`，cordis 工具集的 e2e 遷入 `packages/extensions/tool-cordis/tests/`，受支持的 Code Mode demo 則保留為 `examples/acp-agent/code-mode.cordis.yml` 中的 ACP（Agent Client Protocol）overlay。

## 備選方案

**保留兩棵平鋪且重複的樹。** 拒絕：43 個設定項維護兩份正是缺陷本身，而用一個閘門斷言二者保持一致只會固化重複，而非消除它。

**把 overlay 巢狀成 include（`code-mode` → `tui` → `base`）。** 在對 Loader 實測後拒絕：patch 不會跨越 include 邊界，因此外層文件的 patch 只會伴隨一條告警被丟棄。三層鏈條使 `tools` 無法被 patch，而位於一層 include 之後的 base，會讓每個個人 patch 都變成靜默的空操作。

**把所有設定項的並集放進 base，由各 overlay 停用自己不需要的部分。** 拒絕：base 將不再意味著「共享」，而每個 surface 都要攜帶僅為將其關閉而存在的設定項。

**把因 surface 而異的設定項留在 base 中，由 overlay 去 patch。** 僅對必須同時存在於兩棵樹中的那五個設定項採用，因為 patch 無法建立設定項。它們在 base 中的條目攜帶外掛程式名與兩個 surface 共享的設定，其餘部分由各 overlay 聲明。

## 影響

指名 `@deepseek-ai/dsh-tui-demo` 或 patch `tui-agent` 設定項的 overlay 或 `--config` 樹將不再可解析。overlay 現在要 patch 擁有對應鍵的那一行：模型路由在 `agent-loop`，人設在 `system-prompt`，呈現設定在 `tui`。

若某個 patch 的 `id` 不匹配任何設定項，它仍為空操作而不報錯。這是有意為之：同一份個人 overlay 會跨 surface 共用，而 `insert` 設定項按設計本就不匹配任何目標，因此僅在 `web` 下存在的設定項不能讓 TUI 啟動失敗。

`dsh web` 新增 `--config`，作為一份額外 overlay 傳入 `AppCLIEntry`。Web 保留沙盒化 Bash 與檔案系統提供方，以及審批、權限預設、目錄選擇和瀏覽器權限介面；覆蓋層會停用共享的本機提供方，因為修補程式可以停用條目但不能刪除條目。TUI 查詢索引使用每個行程獨有的臨時資料庫，因為 SQLite 後端要求單寫入者所有權。該索引是每個行程重新建置的可丟棄派生資料；`/resume` 直接列出底層語料，不相依性索引複用。`AppCLIEntry` 在為自身 patch 合併復原設定項預設值時會同時讀取 base 與其 surface overlay，因為 flag 覆蓋必須保留同一設定項上 overlay 的其他欄位。

## 驗證

組合的正確性透過用真實 Loader 啟動每棵樹並檢查已就緒的條目來核對，而不是靠閱讀 YAML：兩個介面都能完全就緒，且沒有未載入項；Web 會以沙盒化 Bash 與檔案系統提供方啟動 `httpServer`。Code Mode 繼續由 ACP overlay 與程序化 TUI 快照覆蓋，而不再維護獨立交付的 TUI 應用。

全部八個終端機快照場景在遷移後逐位元組重放一致，14 個用例的 PTY 冒煙測試全部透過，其中兩個用例斷言個人 overlay 能觸達一個 **insert 進來的**設定項——這正是 vendored `plugin-include` 修復所啟用的行為（[`vendor/README.md`](../../../../vendor/README.md) 本機修改第 8 條，由 `packages/boot/app-boot/tests/config-reload.spec.ts` 覆蓋）。

平鋪過程暴露出三處潛伏缺陷，均在此一並修復：TUI 曾在構造時一次性捕獲選填的 `sessionQuery` 服務，因此在掛載競爭中勝出時會永久停用 `/resume`；交付的工作階段儲存根目錄曾靜默退回項目本機的 `./.sessions`；`--config-replace` 曾在復原交接中被丟棄。
