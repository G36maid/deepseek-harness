# Agent Notes

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

這裡存放一類設計文件。**Agent Note** 記錄影響本程式碼庫的決策或提案：程式碼和文件無法承載的*為什麼*以及*放棄了什麼*。本文件規定 Agent Note 存放在哪裡、何時需要寫一份，以及[文件內格式](#the-file-format)。

## 版面配置與命名

每份 Agent Note 有兩個維度，都編碼在其**路徑**中：`{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`。

- **生命週期**（頂層資料夾）是 Agent Note 的狀態，Agent Note 隨狀態變化在資料夾之間移動：
  - **`proposed/`**：實施前評審的提案；尚未建置（或僅部分建置）。
  - **`implemented/`**：決策已交付。文件記錄做了什麼決定、否決了什麼，並**與實際交付的內容保持同步**：當代碼後續移動文件、重新命名包或更改鍵名/預設值時，Agent Note 在同一個變更中同步更新（僅限事實——路徑、名稱、結構——而非決策本身）。見 [implemented/AGENTS.md](implemented/AGENTS.md)。
  - **`rejected/`**：提案經過討論後被否決。僅當其決策依據仍能避免一種誘人且影響重大的錯誤時保留；否則刪除完整的英文、中文和伴隨記錄三文件組。
- **類別**（巢狀資料夾）是決策的*種類*——見下方[分類](#classification)。

檔名中的日期是該主題**首次提出**的時間（以 git 歷史為準）。Agent Note 之間的交叉引用使用相對 Markdown 連結（`[topic](../../implemented/architecture/2026-…-….md)`），從不使用純文字或編號，這樣既可機械檢查，也能在資料夾間移動時保持有效。

活躍生命週期目錄樹就是工作清單：瀏覽其生命週期/類別資料夾，或搜尋倉庫即可。請勿新增集中式 `INDEX.md`；設計理由見[不設索引的 Agent Note](implemented/process/2026-07-19-remove-generated-agent-note-index.md)。未來指導價值較低的已實施記錄會移至下文所述、單獨凍結的 [`archived/`](archived/AGENTS.md) 目錄樹。

<a id="classification"></a>

## 分類

每份 Agent Note 屬於 `scripts/agent-note-tree.ts` 中封閉集合裡的一個路徑編碼類別；分類閘門拒絕其他資料夾。新增類別需要同時更新規範集合與本節。見[分類 Agent Note](implemented/process/2026-06-20-agent-note-classification.md)。

| 類別 | 覆蓋範圍 |
|---|---|
| `feature` | 面向使用者或模型的新能力。 |
| `bug-fix` | 修正缺陷或彌補事後檢討（postmortem）發現的缺口。 |
| `simplification` | 在不增加能力的前提下移除程式碼、行為或對外範圍。 |
| `architecture` | 關於**交付原始碼**的結構性決策：包之間的關係、執行時期詞彙。 |
| `process` | 程式碼**周邊**的工具、策略或工作流程——閘門、套件管理員、vendor 化——不涉及執行時期行為。 |
| `testing` | 測試基礎設施與策略。 |

`architecture` 與 `process` 的界線：**architecture** 關乎我們交付的原始碼；**process** 關乎圍繞原始碼的工具與工作流程。（`refactor` 被有意排除：它與 `simplification` 重疊，而後者的判別標準「可觀察行為是否改變」已經覆蓋了它。）

## 歸檔與刪除

當一份 implemented Agent Note 記錄的交付決策已經完整落地，且其決策依據不太可能再指導未來工作時，將其歸檔。如果其中的備選方案、歸屬邊界、否定性保證、持久化語義或協議語義、安全規則，或者重新引入條件仍有價值，則繼續作為活躍記錄保留。絕不歸檔 proposed Agent Note：過時的提案應轉為 rejected。僅當 rejected Agent Note 仍能避免一種可能發生的錯誤時保留；否則一並刪除其英文、中文和伴隨記錄文件。請使用經過校準的 [`dsh-archive-agent-notes`](../skills/dsh-archive-agent-notes/SKILL.md) 工作流程，不要根據字數、存續時間或目標配額來判斷。

歸檔路徑編碼為 `archived/{class}/yyyy-mm-dd-topic-title.md`；其中有意省略 `implemented`，因為只有 implemented Agent Note 可以進入歸檔。歸檔變更會移動完整的英文、中文和伴隨記錄三個文件，保留 `Status: implemented`，在兩種語言的文件中緊接該狀態行插入相同的 `Archived: YYYY-MM-DD` 行，重新記錄伴隨記錄，並修復或刪除入站連結。歸檔時只允許對內容做這些更改。

封存後，每組歸檔文件都永久凍結。禁止編輯、翻譯、重新格式化、更新、移動或刪除，也不得將其視為當前行為的權威依據。文件閘門會跳過歸檔原始檔，包括其中的出站連結；當活躍文件有意引用歷史時，仍可連結到歸檔 Agent Note。[`verify-archived-agent-notes`](../../scripts/verify-archived-agent-notes.ts) 強制執行封閉的類別目錄樹、完整的三文件配對、歸檔元資料、伴隨記錄 hash，以及僅附加的凍結內容 manifest（中繼資料清單）。[歸檔政策 Agent Note](implemented/process/2026-07-26-frozen-agent-note-archive.md) 記錄了設計依據。

## 何時需要寫一份

每個非平凡變更都必須在同一 PR（Pull Request）中新增或更新至少一份 Agent Note。如果變更修改了行為、架構、跨文件或跨包約定、流程或工具、測試策略、磁碟儲存格式、協定格式（wire format）或設定格式，或者維護者可能合理重新審視的其他決策，就屬於非平凡變更。對未來重大工作的提案從 `proposed/` 開始；已經做出的決策從 `implemented/` 開始。選擇與決策匹配的類別資料夾（見[分類](#classification)）。

更新已經擁有該決策的 Agent Note 即可滿足規則；不要建立重複記錄。只有不涉及行為、約定、結構、流程或理由變化的純機械性或區域性編輯纔可豁免。Agent Note 永遠不會被編輯為一個*不同的決策*：用新 Agent Note 取代舊記錄，並讓兩個記錄保持互相連結，除非後續依據下方規則完全合併舊記錄。編輯 `implemented/` Agent Note 以跟蹤其現有決策的所在位置是必需的，而非禁止的；見 [implemented/AGENTS.md](implemented/AGENTS.md)。

被完全取代的 implemented Agent Note 可以合併到當前持有該決策的記錄中，並刪除原文件。刪除前，當前記錄必須保存所有獨有的決策依據、備選方案、影響、必需的驗證和明確指出的覆蓋缺口；修復所有入站連結；並在同一變更中刪除中文對側檔案和一致性記錄。僅部分被取代的記錄不符合此條件：保留兩個記錄並讓它們互相連結，同時更新所有仍然適用的事實。合併不得將舊文件改寫成與其相反的決策，也不得讓 git 歷史成為決策依據的唯一副本。

只有當一項功能已從生產程式碼、設定、schema、持久化格式或協定格式、遷移和相容行為中完全消失，當前文件不再將其描述為可用，且沒有測試把它作為受支持行為來執行時，新增該功能的 Agent Note 纔可合併進後續的移除記錄。移除決策的依據和驗證該功能已不存在的測試可以保留。移除決策的持有記錄必須保留最初動機、為什麼該動機已不足以證明保留該功能的合理性、完全移除之外的備選方案、放棄的能力、重新引入的條件，以及證明已徹底移除的驗證。過時的實作清單和只驗證已刪除行為的測試不屬於當前驗證證據。僅移除一種傳輸、預設值、實作或展示屬於部分取代；仍有任何持久資料或相容處理也同樣如此。

<a id="the-file-format"></a>

## 檔案格式

每份活躍 Agent Note 遵循統一的文件內格式，由 `pnpm run verify-agent-note-format`（[scripts/verify-agent-note-format.ts](../../scripts/verify-agent-note-format.ts)，`doc-sync`（文件同步閘門）的一環）強制執行；該格式的設計動機及其否決的替代方案見[統一格式 Agent Note](implemented/process/2026-07-05-uniform-agent-note-format.md)。歸檔記錄保留封存時的格式，並增加上述歸檔日期行。

### 頭部塊

每份 Agent Note 的前三行嚴格為：

```markdown
# Agent Note: <title>

Status: <status>
```

後跟一個空行。`Status:` 的值有三種形式，且必須與文件所在的生命週期資料夾一致——閘門會交叉檢查：

- `Status: proposed`
- `Status: implemented`
- `Status: rejected — <why, in one line>`

狀態行不帶日期、不帶括號補充說明：檔名記錄首次提出日期，git 記錄其餘一切；「以修訂形式接受」之類的說明屬於正文內容（在陳述決策的地方說明修訂）。拒絕原因是唯一帶內容的狀態，因為讀者查閱被否決的 Agent Note 時，結論正是他們要找的。

### 正文骨架

每份 Agent Note 的正文以 `## Problem` 開頭：動機，寫法上不相依性解決方案即可獨立成文。後續內容取決於生命週期；固定章節使用以下規範名稱且僅限這些名稱，而真正獨特的技術章節（包拓撲、協議約定、schema 等）在必需章節之間可自由組織。

#### `proposed/`

```markdown
## Problem
## Proposal
…bespoke sections…
## Alternatives considered
## Acceptance criteria
## Risks
```

`## Proposal` 描述擬議的變更，可以合理地使用將來時態——計畫、遷移步驟和待解決問題在工作尚未完成時屬於此處。`## Acceptance criteria` 說明什麼可觀察狀態意味著完成。`## Risks` 涵蓋可能出錯的事項以及該變更有意放棄的東西。

#### `implemented/`

```markdown
## Problem
## Decision
…bespoke sections…
## Alternatives considered
## Consequences
```

`## Decision` 以現在時態描述已交付的現實，整個文件按 [implemented/AGENTS.md](implemented/AGENTS.md) 的要求與之保持同步。`## Consequences` 記錄權衡的代價**與**收益。提案階段的標題在此屬於規格用語，閘門會拒絕它們：`## Proposal`、`## Plan`、`## Migration plan` 和 `## Acceptance criteria` 不得出現在 implemented Agent Note 中（原因見 [slop 檢查清單](../../docs/AGENTS.md)）。`## Testing`、`## Deferred` 或 `## Related` 章節在陳述現在時態的事實時是允許的。

#### `rejected/`

被否決的 Agent Note 是凍結的提案：保留提案時的所有章節（包括 `## Acceptance criteria` 或 `## Plan`），結論寫在 `Status:` 行上。僅頭部塊、`## Problem` 開頭、`## Proposal` 章節以及下方的「曾考慮的替代方案」強制要求適用。

### 曾考慮的替代方案——必需

每份 Agent Note 都必須包含 `## Alternatives considered` 章節：每個真實的替代方案及其落選原因，每個替代方案用一個加粗引導的段落，或對爭議較大的替代方案用 `### Why not <X>?` 子節。記錄決策時不記錄它擊敗了什麼，就是在邀請反覆爭論——這正是 Agent Note 旨在防止的問題。

替代方案是記錄下來的，不是憑空編造的。日期早於 2026-07-05 且替代方案無法從記錄中重建的 Agent Note，用以下精確註釋代替該章節，閘門僅對格式規範之前的文件接受此註釋：

```markdown
<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
```

### 在生命週期之間移動

將文件在生命週期資料夾之間移動意味著在同一個變更中更新 `Status:` 行並滿足目標資料夾的骨架要求——否則閘門會失敗。具體而言，`proposed/` → `implemented/` 將 `## Proposal` 改寫為現在時態的 `## Decision`，將 `## Acceptance criteria` 和 `## Risks` 折入 `## Consequences`（或折入一個現在時態的 `## Testing`/`## Verification` 章節，用於描述現在鎖定該行為的內容），並用實際交付的內容替換計畫——也就是將 [implemented/AGENTS.md](implemented/AGENTS.md) 所要求的改寫變成可機械檢查的規則。`proposed/` → `rejected/` 僅在 `Status:` 行新增原因並凍結文件。

### 中文對側檔案

`.zh.md` 對側檔案按 [i18n 約定](../../docs/i18n/README.md)逐章節與其英文對側檔案保持相同結構；機器檢查的頭部標記（`# Agent Note: ` 和 `Status:` 行）保持英文原樣不翻譯。格式閘門跳過 `.zh.md` 文件；配對閘門檢查它們的一致性。
