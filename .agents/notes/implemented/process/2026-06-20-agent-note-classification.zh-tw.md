# Agent Note: 透過路徑編碼的子目錄對 Agent Note 進行分類

Status: implemented

[English](2026-06-20-agent-note-classification.md) | [简体中文](2026-06-20-agent-note-classification.zh.md) | 繁體中文

## 問題

僅按生命週期組織的 Agent Note 目錄樹（`proposed/` / `implemented/` / `rejected/`）無法記錄每個文件包含哪一*類*決策。讀者瀏覽某個生命週期時，如果不逐一開啟檔案，就無法區分新功能、移除項或工具策略變更。

本倉庫一貫的傾向是[機械品質閘門優於行文規範](2026-06-11-quality-gates.md)：不被機器檢查的約定終將腐爛。因此這裡的分類方案必須可強制執行，而非靠自覺的文件頭。

## 決策

增加第二個維度，即 Agent Note 的**類別**，並將其編碼在路徑中：`{lifecycle}/{class}/yyyy-mm-dd-topic.md`。資料夾*就是*標籤。文件位置聲明其類別；封閉集合限定為「這些資料夾且僅限這些」；既有的 [verify-md-links](2026-06-18-markdown-cross-link-lint.md) 閘門已經保護移動文件所需的路徑改寫。

### 六個類別的封閉集合

| 類別 | 涵蓋範圍 |
|---|---|
| `feature` | 面向使用者或模型的新功能。 |
| `bug-fix` | 修正缺陷或填補事後檢討（postmortem）暴露的空白。 |
| `simplification` | 移除程式碼、行為或對外介面範圍，不引入新功能。 |
| `architecture` | 關於**交付原始碼**的結構性決策——包之間的關係、執行時期詞彙。 |
| `process` | **圍繞**程式碼的工具、策略或工作流程，而非執行時期行為。 |
| `testing` | 測試基礎設施與策略。 |

`architecture` 與 `process` 的分界是：**architecture** 關乎我們交付的原始碼；**process** 關乎原始碼周邊的工具與工作流程。本 Agent Note 本身屬於 `process` 決策：它改變倉庫的組織方式與閘門，而不是 harness 的執行時期行為，因此位於 `implemented/process/` 下。

### 兩道閘門

兩者都是 `doc-sync`（文件同步閘門）的成員，風格與 `verify-md-wrap` 一致（tsx ESM，只校驗不生成，首個違規即以非零退出碼退出）：

- **`scripts/verify-agent-note-classification.ts`**：定義封閉的生命週期與類別集合。它斷言生命週期資料夾下的每個文件都位於規範集合中的類別資料夾內（生命週期根目錄下散落的 `.md` 或未知類別資料夾都會失敗），並拒絕集中式 `INDEX.md`。規範集合位於 `scripts/agent-note-tree.ts` 中，[README](../../README.md) 則以行文記錄每個類別。
- **`scripts/verify-doc-refs.ts`**：檢查引用文件的原始碼註釋。Agent Note 路徑不僅出現在 Markdown 中，也出現在 TypeScript 文件註釋中（例如以倉庫根為起點的 `.agents/notes/implemented/testing/2026-06-19-acp-snapshot-tests.md`）。`verify-md-links` 看不到這些引用，因此目錄重組可能靜默留下失效引用。該閘門掃描 `packages/**` 與 `examples/**` 下倉庫自有的 `.ts` 文件（排除已建置的 `lib/` 與 `vendor/`），尋找 `docs/….md` 和 `.agents/notes/….md` token，解析每個以倉庫根為起點的路徑並斷言其存在。它要求使用 `.md` 擴充名，因此會忽略行文中不帶擴充名的引用。

## 曾考慮的替代方案

- **在每個文件中新增 `Classification:` 文字行**（緊鄰 `Status:`），由閘門解析。可行，但它將路徑已能承載的事實重複到文件中，且行內容可能與所在資料夾不一致。路徑編碼使標籤與其儲存合二為一，沒有需要保持同步的東西。
- **設立 `refactor` 類別。** 與 `simplification` 幾乎完全重疊；唯一有人試圖用來區分的標準是「可觀察行為是否改變？」，而 `simplification` 已經編碼了這一點（它不改變）。一個類別即可，無需兩個。
- **生成或手工維護的文件集索引。** 不予採納：生命週期/類別目錄樹纔是權威結構；集中式清單會製造合併熱點，卻沒有提供目錄樹導覽或倉庫搜尋無法實作的發現能力。

## 後果

- 每份 Agent Note 都位於一個類別資料夾下。讀者瀏覽單個資料夾，即可查看某個生命週期內的全部簡化或測試決策。
- `doc-sync` 鏈中多了兩個快速 tsx 指令碼；無新相依性（mdast/GFM 棧已因 `verify-md-wrap`/`verify-md-links` 而存在）。
- 新增類別必須是顯式決策：修改 `scripts/agent-note-tree.ts` 中的 `const` 與 [Classification 章節](../../README.md#classification)，而不是隻用 `mkdir` 建立資料夾。閘門會拒絕未知資料夾，因此臨時類別無法悄然混入。
- 原始碼註釋中的文件引用同樣受閘門約束：被 `.ts` 註釋引用的文件一旦移動或重新命名，`doc-sync` 與 CI 中的 `verify-doc-refs` 就會失敗，從而堵住 `verify-md-links` 在結構上無法發現的一類漂移。
