# Agent Note: Agent Note 的統一受閘門約束的文件內格式

Status: implemented

[English](2026-07-05-uniform-agent-note-format.md) | [简体中文](2026-07-05-uniform-agent-note-format.zh.md) | 繁體中文

## 問題

Agent Note 的路徑編碼了生命週期和類別，但文件內容仍混雜著不同標題、狀態格式、ADR 與提案範本，以及已實作記錄中的提案階段章節。作者會複製隨手找到的相鄰文件，而生命週期遷移可能跳過必要的改寫，因為沒有閘門強制執行文件內約定。

## 決策

[README.md § 檔案格式](../../README.md#the-file-format)是文件內約定——頭部塊（`# Agent Note: <title>`，加上無日期且與資料夾一致的 `Status:` 枚舉，其中只有拒絕原因可作為額外內容）、各生命週期的正文骨架（所有文件均以 `Problem` 開篇；`proposed/` 使用 `Proposal`/`Acceptance criteria`/`Risks`；`implemented/` 使用現在時的 `Decision`/`Consequences`，並禁止提案階段標題；`rejected/` 凍結提案結構）、強制的 `Alternatives considered` 章節，以及規範章節詞彙；訂製技術章節可在這些規範章節之間保持自由形式。`pnpm run verify-agent-note-format`（[scripts/verify-agent-note-format.ts](../../../../scripts/verify-agent-note-format.ts)）作為 `doc-sync` 的一部分強制執行每項機械規則，因此跳過改寫的生命週期遷移現在會使 CI 失敗，而不再相依性評審者記憶。

定義該格式的同一變更規範化了整個語料庫——遵循預發布立場：不設過渡期，不容忍雙格式。唯一適用既有內容豁免的是內容，而非格式：替代方案只能記錄、不能杜撰，因此若某份格式制定前的 Agent Note 無法從記錄中還原替代方案，就會帶有內容完全匹配 `agent-note-format: alternatives-not-recorded` 的註釋；閘門只對日期早於本文的文件接受該註釋。

## 曾考慮的替代方案

- **完整的剛性範本**（每個生命週期使用固定章節順序，重構每份 Agent Note 以適配）：否決。大型設計 Agent Note 包含八到十五個訂製技術章節（包拓撲、協議約定、schema），它們是承載設計的內容，而非漂移；剛性順序會迫使我們現在進行破壞性改寫，並永遠與範本較勁。
- **僅規範化頭部**（H1 和 Status，正文不動）：否決。債務標記指出的是*正文*的體裁分裂，讓 `Context`/`Decision` 與 `Problem`/`Proposal` 無限期並存什麼也解決不了。
- **不設 Status 行**（資料夾已經表示狀態；格式制定前最新的三份 Agent Note 及其中一份的中文對應文件省略了該行）：否決，保留文件的自描述性。透過閘門校驗該行與資料夾一致，消除了原本促使我們刪除它的漂移風險。
- **帶日期的 Status**（`Status: implemented (accepted YYYY-MM-DD)`）：否決。接受日期屬於敘述性歷史，寫作規則將其排除在文件之外；檔名承載首次提出日期，git 承載其餘資訊；閘門能檢查日期格式，但永遠無法檢查其真實性。
- **裸 `# <title>` H1**：否決。文件脫離目錄樹單獨閱讀時，`Agent Note: ` 前綴能自描述其體裁，而格式閘門可防止它漂移。
- **以 `## What we give up` 作為已實作記錄的結尾**（README 對 Agent Note 所記錄內容的原有表述）：否決。它只點出成本，而誠實的後果章節也會記錄取捨換來了什麼。
- **只有慣例沒有閘門**（寫下約定，靠評審強制執行）：否決。slop checklist 已經透過慣例禁止在 `implemented/` 中使用 spec 語氣，而十九個文件展示了僅靠慣例在此處能達到什麼效果。
- **獨立的 `FORMAT.md` 約定文件**：否決。由一個入口同時承載版面配置、分類和格式，比維護兩個約定文件更易發現和維護。

## 後果

現在每份 Agent Note 都需要稍多一些結構，而強制的 `Alternatives considered` 章節是有意設定的阻力：記錄決策卻不記錄它勝過什麼，會招致 Agent Note 本應防止的重新爭論。無法還原替代方案的格式制定前 Agent Note 會永久保留既有內容豁免註釋——這是記錄中誠實的缺口，而不是杜撰的理由。`doc-sync` 增加一道閘門；在生命週期資料夾之間移動 Agent Note 時，現在必須當場完成真正的工作（遷移本就應包含的正文改寫），而不是推遲為無人跟蹤的清理任務。三十九個債務標記已經消失，由它們一直等待的範本解決。
