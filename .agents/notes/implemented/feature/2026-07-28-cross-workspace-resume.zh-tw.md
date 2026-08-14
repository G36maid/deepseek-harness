# Agent Note: 跨 workspace 工作階段復原

Status: implemented

[English](2026-07-28-cross-workspace-resume.md) | [简体中文](2026-07-28-cross-workspace-resume.zh.md) | 繁體中文

## Problem

`/resume` 只能觸達在啟動目錄中建立的工作階段，因此要回到昨天在另一個項目裡的工作，就得記住它的路徑、退出 TUI、再到那裡重新啟動。造成這一限制的原因有兩個，彼此獨立，只修其中一個都不會有任何變化。

儲存是那個決定性的原因。已交付的 TUI 組合把持久化根默認成相對路徑 `./.sessions`，於是每個啟動目錄都獨佔一份互不相交的 JSONL 根目錄，以及一份互不相交的派生 `session-query.db`。來自另一個項目的工作階段並不是在清單中被過濾掉的——它們根本不存在於清單讀取的儲存中。JSONL 後端本來就會在*同一個*根目錄*內部*按 cwd 分區，所以分區被疊加了兩層：一層按根目錄，一層在根目錄內部。

接著選擇器又過濾了一次。它在展示前丟棄 `cwd` 與當前工作階段不同的記錄，而 `summarizeResumeCandidate` 又獨立地把不同的 `cwd` 標記為 `disabledReason: 'different workspace'`，於是一個確實進入了儲存的外部工作階段既被隱藏，也會被拒絕。

最後，復原流程從不切換目錄。宿主透過 `process.execve` 重新執行 `dsh --resume=<id>`，而它會繼承 cwd。工作階段*頭部*的 cwd 會從日誌中還原，但 `dsh-fs-local`、bash 執行器以及 glob／grep 解析路徑時依據的是行程 cwd，所以復原一個外部工作階段會在重播它的 transcript（文字記錄）的同時，作用到錯誤的項目上。

## Decision

共享 CLI（命令列介面）設定提供 Harness home 下的同一個工作階段根目錄，選擇器獲得 workspace 範圍，交接過程攜帶目標目錄。

**儲存。** 共享 base 在 `apps/cli/config/base.cordis.yml` 中擁有預設值：其 `session-persistence-jsonl` 設定項呼叫由 app-boot 提供的 `dshHomePath('sessions')`，該函式使用規範的 `DSH_HOME` 解析器及其標準的 `~/.dsh` 回退值。因此 TUI、Web 與 headless 使用同一個預設值，無需針對工作階段的啟動器修補程式或 slot。若 overlay 或個人 patch 顯式聲明根目錄，它會整體替換該設定項的 `config`，並繼續作為部署的權威選擇。

**是範圍，不是排除。** 當前 workspace 之外的 workspace 是一種展示範圍，而不是停用理由。`showResume()` 彙總每一條記錄，`ResumePicker` 持有一個 `'workspace' | 'all'` 的 `scope`，預設為當前 workspace，因此常見場景毫無變化。Tab 切換範圍；範圍行會說明當前生效的範圍，以及另一個範圍下的數量；在全 workspace 範圍中每一行都報告自己的 workspace，而該標籤只在展示它的範圍裡才加入可搜尋文字。切換範圍會清空查詢和選中項，使高亮行始終屬於可見清單；而逐行的 workspace 行會讓該範圍下的每一行在終端機裡多佔一行，可見條數預算已經把這一點計入。

因此 `summarizeResumeCandidate` 去掉了 `'different workspace'`，並新增 `'session has no recorded workspace'`。這是一條真正新增的拒絕理由，而不是改名：沒有 `cwd` 的頭部沒有指明任何目錄供宿主進入，所以即便它的日誌完好也無法完成交接。

**交接。** `TuiResumeHost.handoff` 在 `SessionId` 之外還接收目標 `cwd`。`preflightResume` 把兩者一起解析並一起返回，因此呼叫方無法從它展示過的那一行裡重新推匯出一個過時目錄——在清單展示與預檢之間 `cwd` 發生了變化的記錄，會在*重新讀取到的*目錄中復原，這也是原先「拒絕發生變化的 cwd」的行為如今變成攜帶新路徑完成交接的原因。已交付的宿主在 dispose（資源釋放）應用之前切換目錄：不可達的目錄必須在呼叫方還能復原終端機時就拒絕，因為拆卸之後已經沒有任何所有者可供彙報。復原始終使用默認的 `dsh --resume` 介面，因為 `meta` 會拒絕父級選項；交接過程已經進入持久化保存的目標目錄。

## Alternatives considered

**從 `dsh` 啟動器給 `persistenceRoot` 打修補程式，而不是改動組合包預設值。** 在發現 loader 修補程式會整體賦值 `config` 之後否決。個人的 `~/.dsh/config.yaml` 覆蓋層已經用一份區域性設定給 `tui-agent` 那一項打了修補程式，這恰恰就是 `persistenceRoot` 一開始會退回到組合包預設值的原因；啟動器修補程式要麼會被該覆蓋層擦除，要麼必須壓過它，從而讓覆蓋層再也無法設定這個欄位。把預設值放在組合包裡能經受任何區域性修補程式，並讓這項事實只有一個歸屬。

**保留 `./.sessions`，並額外掃描 Harness home 根目錄。** 否決：兩個根目錄意味著兩份 SQLite 索引，以及一份合併清單——其中各行的活躍狀態與版本權威來源並不相同，而這一切只是為了保住不做遷移的決策本就已經放棄的那部分日誌可見性。

**把現有的項目本機日誌遷移到共享根目錄。** 被需求方否決。項目 `./.sessions` 下的工作階段仍留在磁碟上，從該目錄顯式執行 `dsh --resume <id>` 仍可復原，只是不再出現在 `/resume` 中。

**把所有 workspace 鋪成一個扁平清單。** 否決：這會丟掉絕大多數場景想要的「本項目」預設值，而在一個繁忙的 home 目錄裡，當前項目的工作階段會和無關工作階段爭奪注意力。

**讓宿主從還原後的工作階段頭部推斷目錄。** 否決：工作階段頭部是面向模型與提示詞的狀態，在啟動*之後*才還原，而目錄必須在 `execve` *之前*進入。顯式傳遞它能讓這個順序在 seam 處保持可見。

## Consequences

- 已經存放在項目本機 `./.sessions` 下的工作階段會從 `/resume` 中消失。這是不做遷移所接受的代價。
- 復原一個工作階段可以改變行程的工作目錄，因此復原外部工作階段不是單純的 transcript 還原——每個解析路徑的工具都會隨之移動。
- Harness home 現在保存著這臺機器上每個項目的工作階段日誌。它的成長不再受單個 checkout 約束，而本記錄也沒有引入任何保留策略。

## Testing

TUI 測試覆蓋默認範圍隱藏其他 workspace 但報告其數量、Tab 顯示它們並帶上逐行 workspace 標籤、再按 Tab 返回時清空查詢與選中項、按 workspace 標籤搜尋、無 cwd 的記錄仍可見但不選填，以及交接同時收到 id 和在預檢時重新讀取到的 workspace。原先「拒絕發生變化的 cwd」的用例現在斷言交接攜帶新目錄。建置後的 CLI PTY 測試會檢驗共享設定預設值與每行程派生的查詢索引。無金鑰 TUI 快照固定選擇器的兩個範圍，包括範圍行、逐行 workspace 行，以及頁腳中的 Tab 提示。手動執行的一次跨 workspace 復原在行程層面驗證了替換後進程的工作目錄變為目標 workspace。
