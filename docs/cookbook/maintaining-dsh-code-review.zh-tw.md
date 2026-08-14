# 維護 dsh-code-review skill

[English](maintaining-dsh-code-review.md) | [简体中文](maintaining-dsh-code-review.zh.md) | 繁體中文

[`dsh-code-review`](../../.agents/skills/dsh-code-review/SKILL.md) skill（技能）由一名指定操作員透過私有的週期維護工具持續更新。本實作手冊既是該操作員和接任者的入口，也幫助倉庫貢獻者理解為何 skill 更新會以小型週期 PR（Pull Request）的形式出現，而不是一次性審計。工作流程本身由[人工評審 skill 維護 Agent Note](../../.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.md)規定。

## 維護者會收到什麼

操作員每天手動呼叫包裝指令碼，並使用 2 個 UTC 日的重疊視窗；每週手動復原執行使用 7 日視窗。工作流程會：

1. 選擇指定視窗內合併、且合併 commit 可從 `origin/master` 到達的 PR（每天執行預設選擇 2 個 UTC 日，每週執行選擇 7 日）。合併 commit 無法到達的 PR（例如父分支被 squash 的堆疊分支），或超出 250 個 commit 取得上限的 PR，會記錄到 `skipped-pulls.json` 並跳過，不會中止本次執行。
2. 收集合併前帶 commit 錨點的人工評審回饋（行內評論和評審提交），然後比較回饋時與最終落地的 PR patch。它不獲取 PR 工作階段評論，因為 GitHub 當前狀態無法為這些評論提供可抵抗 force-push 的回饋時基線；它也不會把只存在於目標分支的變更作為採納證據。
3. 兩個獨立設定的評審配接器先對每個條目的作者以及更改是否採納了它進行分類，再根據當前 skill 對雙方一致認定已採納的條目分類。
4. 主配接器起草完整修訂版 `SKILL.md`；兩個配接器評審同一份 diff；只要仍有阻塞性問題，迴圈就會繼續，直到雙方批准。
5. 工具聲明成功前，會針對候選版本執行 `pnpm run doc-sync` 和 `pnpm run lint`。

每次執行都把產物保存在操作員的機器上。保存的 diff、候選 `SKILL.md` 和提升 manifest（中繼資料清單）按時間戳命名，存放在 `~/dsh-code-review-outputs/` 下。manifest 記錄源 master commit 與 skill blob、源回饋 ID 和 URL、已落地證據範圍、配接器裁決和閘門結果；每個配接器的原始 I/O 留在私有臨時目錄中，該目錄路徑會寫入通知和 `~/Library/Logs/dsh-code-review-maintainer/` 下的每日日誌。維護 worktree 在每次執行後都會復原為乾淨狀態，避免操作員直接在維護副本中編輯。

## 操作員如何處理候選 diff

某次執行產出候選版本時，macOS 會發出一條帶 `dsh-code-review-promote <timestamp>` 提示的通知。

1. **根據 diff 本身作出判斷。** 不要因為「評審者已經批准」就直接接受；維護者約定規定由操作員作出最終決定。檢查清單是否膨脹、是否有歷史敘述、是否根據單次事件作出無依據的外推，以及是否與現有 skill 或權威文件重複。

   ```sh
   ls ~/dsh-code-review-outputs/                         # every candidate ever produced
   less ~/dsh-code-review-outputs/2026-07-16T02-00-00Z.diff
   less ~/dsh-code-review-outputs/2026-07-16T02-00-00Z.SKILL.md
   less ~/dsh-code-review-outputs/2026-07-16T02-00-00Z.manifest.json
   ```

2. **與執行產物交叉核驗。** 提升 manifest 會把每條擬議規則對映到源回饋和已落地證據；每個配接器的詳細 I/O、共識和採納證據位於本次執行的私有臨時目錄中（路徑見日誌）。至少抽查一個候選項：連結的人工評論是否確實支援新增規則？連結的 PR 是否確實採納了它？

3. **從三種處理方式中選擇一種：**
   - **丟棄。** 刪除保存的候選版本。下一次執行會依據屆時的當前 skill，重新考慮同一份回饋。

     ```sh
     rm ~/dsh-code-review-outputs/2026-07-16T02-00-00Z.{diff,SKILL.md,manifest.json}
     ```
   - **留待成批次處理。** 如果更新很小，可以把候選版本留待與後續版本合併。源 skill 檢查仍然適用；如果 `master` 先發生變化，請重新執行分析，或手動 rebase 並重新評審 diff。
   - **提升。** 在倉庫的乾淨 `master` checkout 中執行提升輔助工具。它會刷新 `master`、驗證當前 skill 與記錄的源 blob 一致、應用保存的 diff，並建立一份 draft PR，其正文列出原始回饋的 URL 或 ID、已落地的 commit 範圍、發起這次更改的執行、檢查以及操作員編輯。如果 skill 已發生漂移，它會停止而不是覆蓋更新後的指導；操作員仍需在 GitHub 上評審 PR，並選擇合併或關閉。

     ```sh
     cd ~/path/to/deepseek-harness   # clean master
     dsh-code-review-promote 2026-07-16T02-00-00Z
     ```

4. **不要逐字提交配接器輸出。** 提升過程中可以進行小幅編輯，例如收緊措辭、移除只有結合源 PR 上下文才有意義的示例、把規則並入現有規則。這些編輯是預期行為，也保留了工作流程所相依性的「評審者判斷」。合併前應在該分支上修訂這些改動。

## 執行未產出候選版本時

只要每個非空分類階段都至少產生一個有效的配接器結果，這就是常見情況。工具會在每日日誌中記錄「無候選版本」，不傳送通知（避擴音醒疲勞），然後繼續。某天沒有 skill 更新，說明工作流程執行正常，而不是停滯。

## 中斷與交接

該機制執行在一臺機器上。操作員應隨時處理以下中斷：

- **錯過每日執行。** 2 日重疊視窗會自動覆蓋一次漏跑；更長的間隔可透過設定 `DSH_CODE_REVIEW_SINCE=<Nd>` 手動執行包裝指令碼來復原。重疊視窗具有冪等性：當前 skill 已包含的指導會被歸類為 `covered`，不會再次成為候選項。
- **配接器提供方中斷。** 當兩個評審命令解析為逐位元組相同的可執行文件時，工具會拒絕執行。某個批次的配接器回應未透過 schema 或 ID 校驗時，該批次會整體 fail-closed（其中每個條目都標記為不明確），執行則繼續；原始輸出會保留以便除錯。如果任一配接器在某項操作的所有非空批次中都未產生有效結果，本次執行就會失敗、寫入失敗記錄並通知操作員；它絕不會把提供方完全中斷摺疊成「無候選版本」。
- **交接給另一名維護者。** 新建一篇取代當前記錄的後續 Agent Note：要麼把機制移入倉庫，要麼記錄新操作員的私有設定。不要暗中轉交工具；Agent Note 的風險章節已把「單維護者關鍵人風險」列為交接必須記錄決策的原因。

## 操作員的私有設定位於何處

工具原始碼、評審配接器、提供方憑據和調度器屬於操作員的私有基礎設施，按設計位於本倉庫之外（參見 Agent Note 的「機制位於何處」章節）。本實作手冊和 Agent Note 描述的是**工作流程保證什麼**；這些保證**如何**實作則屬於私有基礎設施問題。如果你是新操作員，應以 Agent Note 的 `## Proposal` 各節作為實作依據。
