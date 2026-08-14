# Agent Note: verify-md-links 校驗 fragment 錨點，消除最後一類死鏈

Status: implemented

[English](2026-08-09-md-fragment-anchor-gate.md) | [简体中文](2026-08-09-md-fragment-anchor-gate.zh.md) | 繁體中文

## 問題

`verify-md-links` 只證明相對連結的目標文件存在，從不檢查 `#fragment`，文件標準以一條人工規則補償：重新命名標題前自己 grep 錨點。一次語料掃描發現 15 條連結的 fragment 在目標中沒有對應錨點——三種衰變模式：連結寫下後標題被改寫（`#security-and-authority-are-explicit-non-goals` 對 note 現在的 `Security and authority are non-goals`）、約定搬遷到另一份屬主文件（`tool-fs` 鏈到 seam README，而無逾時規則現居 group README）、zh 側鏈接其中文標題永遠不會生成的英文 slug（`#deferred-work` 對 `## 推迟工作`）。這些都不觸發任何 gate，且每條都把讀者悄悄丟在目標頁頂部。

## 決策

`verify-md-links` 現在也解析 fragment（取代[跨連結決策](2026-06-18-markdown-cross-link-lint.md)中暫緩納入該檢查範圍的決定）。對每條目標為 Markdown 文件的相對連結——包括舊檢查器完全跳過的同文件 `#anchor` 連結——fragment 必須命名目標中的真實錨點：標題的 GitHub slug，或真實 HTML 流中的顯式 `<a id>`（程式碼示例與註釋掉的錨點不註冊任何東西）。slug 由倉庫自有的 `markdownHeadingLines` 從**渲染後**的標題文字計算，因此，標題內的連結、行內程式碼與強調都會按 GitHub 的渲染結果參與 slug 計算；底線保留（`#showcase-web_fetch`）；重複 slug 獲得 GitHub 的佔用集 `-1`、`-2`……後綴；匹配區分大小寫，因為元素 id 本就區分大小寫。指向非 Markdown 目標的 fragment（`file.ts#L10`）語義歸渲染器所有，不在範圍內；外部與根絕對 URL 同樣不檢查。錨點集合對任意存在的目標惰性收集（`anchorCache`），因此鏈入歸檔 note 與 vendor 文件的連結照常校驗，而這些文件不會因此成為掃描源。

slug 函式與 `gen-cordis-catalog` 的區塊錨點 slugger 不同（後者丟棄底線）：生成器的標題總能透過其顯式 `<a id>` 錨點到達，兩者無需共享一條規則。中文側沿用既有語料慣例（`docs/glossary.zh.md`、`docs/cordis-primer.zh.md`）：連結保留英文 fragment，在中文標題前放置顯式 `<a id>`，使兩個語言側暴露相同的錨點。

15 條壞 fragment 在同一變更中修復：過時 slug 重定向到當前標題，搬遷的無逾時約定改鏈其屬主 group README，四份中文文件補上顯式錨點。`docs/AGENTS.md` 與 `dsh-doc-standards` skill 不再要求為 Markdown 連結手工 grep 錨點；人工 grep 只對輸出從不進入受檢 Markdown 的 TypeScript 字串錨點保留（當下三處全部渲染進受檢頁面，gate 經由提交的產物覆蓋它們）。

## 驗證

`scripts/verify-md-links.spec.ts` 證明各驗收路徑：渲染文字 slug 化（反引號、標點、含連結標題、保留底線）、佔用集重複後綴、圍欄/行內程式碼/註釋中的 `<a id>` 不註冊、全部可解析的混合連結文件、死的同文件與跨文件 fragment、大小寫變體 fragment、以及缺失目標仍報 `target` 而非 `anchor`。gate 在 doc-sync 中跑完整語料（`verify-md-links`），且只有在 15 條修復之後才透過——語料本身就是每種衰變模式由紅轉綠的證據。

## 曾考慮的替代方案

- **保留人工 grep 規則。** 它被證明守不住：15 條 fragment 在 gate 驅動程式的維護文化下仍然衰變，因為改寫標題的 PR 從不會去看入鏈。可機械檢查的不變式應進入被執行的 gate。
- **讓中文連結指向中文 slug 錨點。** GitHub 對 CJK 標題的 slug 沒問題，但語料慣例已是顯式 `<a id>` + 英文 fragment（glossary、primer），且它在剝離非 ASCII 的渲染器下也存活；引入第二種慣例會割裂語料。
- **與 typert 生成器共享 `githubSlug`。** 為一個函式引入包建置耦合不值得，且兩條規則確實不同（生成器剝離底線；其錨點是 gate 直接讀取的顯式 `<a id>`），分歧是設計使然而非漂移。
- **同時校驗 VitePress slug。** 發布站點的死鏈檢查已在 `website:build` 中執行；生成區塊正是為兩種渲染器一致而攜帶顯式錨點，手寫標題若有分歧會在那裡失敗。

## 後果

重新命名標題現在會在任何 Markdown 連結引用其錨點處使建置失敗，而非把讀者丟在頁頂；作者須在同一變更中修復入鏈，與文件重新命名的既有義務完全一致。同文件錨點不再是盲區，中文頁面使用英文 fragment 時必須補錨點。人工的重新命名前 grep 只對輸出從不進入受檢 Markdown 的 TypeScript 字串錨點保留。
