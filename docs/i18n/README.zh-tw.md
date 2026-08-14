# 三語文件

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

本倉庫的文件會被公司內外的人和 agent（代理）閱讀，因此範圍內的每篇文件都以英文、簡體中文與繁體中文維護。本頁定義配對約定、檢查、範圍與排除規則；[translation-rules.md](translation-rules.md) 定義如何翻譯；[terminology.md](terminology.md) 是 EN↔zh 術語真源，[terminology-zh-tw.md](terminology-zh-tw.md) 是 zh→zh-TW 轉換術語表。agent 的日常工作遵循 [docs/AGENTS.md](../AGENTS.md) 中的輕量路徑；擴充版 [.agents/skills/dsh-translate-docs](../../.agents/skills/dsh-translate-docs/SKILL.md) 工作流程僅在使用者顯式呼叫時可用。

## 配對約定

- **兩種語言同權。** 一篇文件可以先用任一語言撰寫和評審（先寫中文的 Agent Note 與先寫英文的一樣正當），另一側由它翻譯而來。兩個文件誰也不高於誰；約束它們的是二者必須說同樣的話。
- **一對文件是三個同目錄文件。** 英文 `foo.md`、中文 `foo.zh.md`，加一份一致性記錄 `foo.i18n.yaml`，都在同一目錄。不用語言目錄，不用獨立翻譯倉庫，不用中英混排的單文件。配對必須整體合併：PR（Pull Request）永遠不會只帶一種語言而缺其餘兩個文件。
- **一致性記錄。**`foo.i18n.yaml` 保存兩側文件在上一次被確認「說同樣的話」時各自的完整 Git blob hash：

  ```yaml
  foo.md: 3f786850e387550fdab836ed7e6dc881de23001b
  foo.zh.md: 89e6c98d92887913cadf06b2adb97f26cde4849b
  foo.zh-tw.md: 5a1bcde28dff65a77c19f2e03d4a812b3456ef09
  ```

  用 blob hash 而不是 commit hash，這樣同一個 PR 裡改動的文件也能算出記錄（`git hash-object foo.md`），一致性是純內容比較。`--write` 會先把這些快照存入本機 Git 對象庫再寫下記錄，未提交的 worktree 內容也不例外；它還會在內容尋址的 `refs/dsh/translation-pairing/snapshots/` ref 下固定每個不同的已存 blob，使記憶體回收無法讓已記錄的復原指針失效。因此記錄的 hash 能還原任一側上次確認時的確切文字，所以失去同步的配對是「按被改一側的 diff 最小化地修補另一側」，從不整篇重譯。日常工作會直接完成這份修補；使用者顯式呼叫擴充工作流程時，可改由 `pnpm run gen-translation-brief <pair>` 以能安全對齊的最窄粒度匯集這次更新，並由 `--apply` 在結構校驗後拼接僅涉及圍欄程式碼區塊的改動（[briefed-updates Agent Note](../../.agents/notes/implemented/process/2026-07-26-briefed-minimal-translation-updates.md)）。兩側對齊後，`pnpm run verify-translation-pairing --write <pair>` 重新記錄兩個 hash；那份 YAML diff 就是「確認一致」這個動作本身，可以被評審，也正因如此，`--write` 要求點名你確認過的配對（`--write --all` 是顯式的全語料形式）。

  當兩個分支都包含同一配對的有效確認時，已安裝的 `dsh-translation-pairing` Git 合併驅動只會在 Git 預設文字合併能分別乾淨合併記錄所指向的英文三方 blob 與中文三方 blob，且合併後的配對仍保留必需的語言切換列和結構簽章時，組合出一份新記錄。中文文件必須保留指向英文的反向連結；普通撰寫的英文源必須保留指向中文的連結，而清單內的生成英文源不作此要求。任何合併驅動無法驗證的結構都保留為普通衝突；`pnpm run resolve-translation-pairing-conflicts` 會對已經停止的合併執行同一套遇錯即保留衝突的操作，暫存每份可安全生成的配對記錄，並在還有其他配對衝突時以非零狀態結束。[自動配對合併 Agent Note](../../.agents/notes/implemented/process/2026-08-08-automatic-translation-pairing-merges.md) 負責記錄該機制與備選方案。
- **語言切換列。** 中文文件一律在 H1 標題後立即以 `[English](foo.md) | 简体中文` 鏈回英文，繁體中文側以 `[English](foo.md) | [简体中文](foo.zh.md) | 繁體中文` 互鏈。普通撰寫的英文文件在同一位置以 `English | [简体中文](foo.zh.md) | [繁體中文](foo.zh-tw.md)` 互鏈；清單內的生成英文源省略此行，以便與生成器輸出逐位元組一致。發布到 GitHub 以外位置的 README（例如 PyPI 項目中繼資料）可以改用指向同一對側檔案的規範 `https://github.com/deepseek-ai/deepseek-harness/blob/master/<repository-path>` URL，使切換行在該位置仍可訪問。
- **結構與另一側一一對應。** 標題深度與順序、清單類型、有序清單起始編號、清單項數量、表格行列數、連結目標與逐位元組一致的程式碼塊在配對兩側一一對應；完整保持規則見 [translation-rules.md](translation-rules.md)。既有 Markdown 閘門對 `.zh.md` 文件原樣生效（`verify-md-wrap`、`verify-md-links`）。

## 閘門：verify-translation-pairing

`pnpm run verify-translation-pairing`（`doc-sync`（文件同步閘門）的一環，貢獻者會針對文件變更在本機執行，CI 則會完整執行）機械地強制執行這份約定：

1. 範圍內的每篇文件都有完整配對。發現 README 時，basename 不區分大小寫，因此 `missions/readme.md` 與其他文件根一樣屬於範圍。
2. 任何已存在的配對產物都完整且一致：三個文件齊全、每一側的當前 blob hash 等於記錄值（改了任一側而沒重新確認配對就變紅）、中文側和所有普通撰寫的英文源都帶語言切換列（清單內的生成英文源除外）、結構簽章按序一致：標題深度、逐位元組一致的程式碼塊（資訊字串與內容）、表格行列數、清單類型、有序清單起始編號、清單項數量，以及除切換行之外的每個連結目標。
3. 列為 `excluded` 的文件完全沒有 `.zh.md`，也沒有 `.i18n.yaml`。`.agents/notes/archived/` 下凍結的 Agent Note 不受這個持續演進的閘門約束；專用校驗器會要求其現有的三個配對文件完整，並將其封存。

面向原始碼的程式碼閘門會把精確的 `.zh.md` 圍欄序列視為其無後綴兄弟文件的派生內容，而不會再次編譯相同程式碼或在 manifest（中繼資料清單）中重複登記。該序列必須在長度、順序、圍欄類型和按位元組精確的正文上一致；否則兩份副本仍會獨立受檢，配對閘門也會報告結構不匹配。

`pnpm run verify-translation-pairing --list` 列印範圍內每篇文件的當前配對狀態（missing、out-of-sync 或 ok）。它從不失敗；其中 missing 與 out-of-sync 行指出普通檢查會拒絕的違規。

`pnpm run verify-translation-pairing <pair...>` 只檢查被點名的配對——配對的三個文件中的任意一個（或其裸詞幹）都能點名它——因此更新迴圈幾秒內就能驗證自己的配對，而不必重新掃描全語料。`doc-sync` 與 CI 執行的是無參數的全語料形式；限定範圍的綠燈在 PR 層面永遠不能替代它。

這個閘門帶來的實際規則是：**當一個 PR 修改了已配對文件的任一側時，同一個 PR 在術語指導下直接一次完成對側檔案的更新，並用 `--write <pair>` 重新記錄配對**，與本倉庫既有的程式碼與 README 的 doc-sync 規則完全一致。留下失去同步的配對的 PR 會在 CI 變紅。

閘門的限制很明確：**閘門透過意味著這組文件在當前內容上的一致性得到了確認，不代表確認本身正確可靠。** 它檢查記錄的 hash 與 Markdown 結構；它無法判斷兩側是否真的在說同樣的話，也無法判斷措辭是否準確、術語是否得當、行文是否自然；這部分約定由評審者把關，見 [translation-rules.md](translation-rules.md)。重新記錄了 hash 但另一側翻得潦草的配對能透過閘門；它不得透過評審。

## 範圍與排除

**範圍**：根目錄 CONTRIBUTING 文件、除 vendor 原始碼外的全部 README，以及 `docs/**` 與 `python/**` 下的全部活躍文件。匹配 README 時只看檔名且不區分大小寫，因此今後新增的目錄無需再修改 manifest。相依性目錄與被忽略的建置產物目錄只在發現階段排除，不屬於持續演進的翻譯源文件。

有經評審的中文對側的生成英文參考文件和圖文件遵循配對規則。生成器仍是英文真源，新鮮度閘門與配對閘門各自獨立強制其約束；重新生成導致英文變化後，配對會保持失去同步狀態，直至經評審的中文對側完成更新並重新記錄。生成的英文原始檔不含普通撰寫文件所帶的語言切換列，因為新增該行會使生成器新鮮度檢查失敗；中文對側仍連結回英文源。生成頁的中文對側只能改寫若直譯便不再符合經評審譯文事實的自指生成與維護說明；所有技術內容仍受普通忠實性規則約束。

**排除**（永不配對，閘門拒絕為它們建 `.zh.md` 或 `.i18n.yaml`）：

- [cordis-api/inherited.md](../cordis-api/inherited.md)：該生成文件沒有經評審的中文對側，因此網站的兩個 locale 都投影英文原始檔。
- `docs/AGENTS.md` 及指向它的 `CLAUDE.md` 指令符號連結：agent 指令，與根 `AGENTS.md` 一樣只以英文維護。
- `.agents/**`：agent 側目錄樹（工作流程、技能與 Agent Note）只以英文維護，閘門拒絕其下任何翻譯側檔案或 `.i18n.yaml`。下方凍結的 `.agents/notes/archived/` 三檔案配對早於此規則，仍由專用校驗器封存。
- `docs/i18n/terminology.md` 與 [style-samples.md](style-samples.md)：二者本身即為中英對照文件。
- [terminology-zh-tw.md](terminology-zh-tw.md)：繁體轉換術語表本身即為簡繁對照文件（zh-CN → zh-TW），與 `terminology.md` 一樣排除在配對之外；它是 EN↔zh-CN 真源術語表的轉換側對應物。
- [translation-prompt.md](translation-prompt.md)：自動翻譯管線的提示詞樣板；正文逐字進入模型請求，配對翻譯會改變管線行為。
- `.agents/notes/archived/`：凍結的歷史三文件配對。[`verify-archived-agent-notes`](../../scripts/verify-archived-agent-notes.ts) 校驗其完整性和內容封存記錄；翻譯維護絕不能重寫這些文件。

**統一要求**：當前及今後納入範圍的每篇文件，合併時都必須構成完整的雙語配對。[scripts/translation-pairing.manifest.json](../../scripts/translation-pairing.manifest.json) 只包含顯式排除項；不存在逐文件推進清單、日期分界或 README 專用政策類別。

## 分工

日常更新對側檔案時，負責處理的 agent 會先載入 [terminology.md](terminology.md)，再載入 [terminology-zh-tw.md](terminology-zh-tw.md)，然後直接一次性更新且只處理一遍；它不會呼叫翻譯 skill（技能）、生成簡報、執行單獨的翻譯評審輪次，也不會委派給 subagent。擴充版 [dsh-translate-docs](../../.agents/skills/dsh-translate-docs/SKILL.md) 工作流程保留這些較重的機制，僅供使用者顯式呼叫。閘門負責檢查配對是否完整、記錄的 hash、中文反向連結和普通撰寫源的切換行（生成源按本文規則例外），以及本文列出的結構簽章；翻譯質量、術語和簽名未涵蓋的結構要求仍由評審把關。提示詞約定也有可執行實作：[scripts/translation-prompt.ts](../../scripts/translation-prompt.ts) 會把倉庫內建的樣板（注入術語表；樣板自帶經人工校準的規則）算繪為英譯中或中譯英兩個方向的提示詞，並解析三段式回應；`doc-sync` 中的 `verify-translation-prompt` 會檢查兩個算繪方向與倉庫內示例。
