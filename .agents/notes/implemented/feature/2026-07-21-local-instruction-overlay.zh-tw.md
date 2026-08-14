# Agent Note: 默認的本機指令覆蓋層

Status: implemented

[English](2026-07-21-local-instruction-overlay.md) | [简体中文](2026-07-21-local-instruction-overlay.zh.md) | 繁體中文

## 問題

被 git 忽略的個人指導文件（`AGENTS.local.md` / `CLAUDE.local.md`）是 Claude Code 的一項約定，用於存放刻意不提交、每位開發者各自的覆蓋內容。[agent-instructions 外掛程式](2026-06-24-workspace-context.md)每個目錄只載入一個候選，因此只有把某個 `.local.` 名字加進 `instructionFileCandidates` 才能讀到它；而由於一個目錄只有一個勝出者，這樣做只會讓它*遮蔽*已提交的基礎文件，而不是補充它。這與這些名字所暗示的「基礎文件加個人覆蓋層」的疊加模型正好相反，而且它默認是關閉的。

## 決策

外掛程式為每個項目目錄額外載入第二個獨立的候選清單。`localInstructionFileCandidates` 預設為 `['AGENTS.local.md', 'CLAUDE.local.md']`，並與 `instructionFileCandidates` 採用相同的同目錄校驗來解析。在從項目根到工作階段 cwd 的每個項目目錄中，外掛程式先載入基礎候選，然後疊加載入本機候選；本機文件排在基礎文件之後，因此在位元組預算之內其內容優先級更高。兩個清單都會在[按目錄內容去重](2026-07-21-instruction-load-all-dedup.md)之下完整載入。將 `localInstructionFileCandidates` 置空即可關閉該覆蓋層。

該預設值定義在外掛程式的 `Config` schema 中，而非某個產品的 `cordis.yml` 裡，因此每個嵌入方（TUI、ACP、headless）讀取 `.local.` 文件的行為一致，部署方也可以在一處覆蓋或關閉該行為。這與外掛程式自身持有的 `instructionFileCandidates` 預設值保持對稱。

固定的使用者全域性文件 `$DSH_HOME/AGENTS.md` 沒有本機覆蓋層，始終只有基礎文件。

## 每個候選各自獨立的 scope

同一目錄下的基礎候選與本機候選，在基線凍結、待定視窗、版本快取和協調過程中都必須彼此獨立，因此對其中一個的改動絕不能抑制另一個。現在每個 `(directory, candidateName)` 對都是各自獨立的 scope 鍵——參見[按候選劃分的 scope 鍵](2026-07-21-instruction-load-all-dedup.md)，它取代了此前基礎/本機的層級哨兵。發現過程在每個項目目錄中先遍歷基礎清單、再遍歷本機清單，`reconcileInstructionContext` 為每個目錄枚舉每個設定的候選，`probeScopeInstruction` 則解碼候選名以精確讀取該文件。面向模型的提示詞從文件的展示路徑推匯出供人閱讀的目錄標籤，因此 scope 鍵永遠不會到達模型。

## 備選方案

**更高優先級的先到先得（載入 `.local.` 而非基礎文件）。** 否決：一個會替換已提交文件的個人覆蓋層，會在覆蓋層存在時丟棄共享的項目指導，這與 Claude Code 的疊加模型正好相反。

**透過 `instructionFileCandidates` 保持按需開啟。** 否決：一個目錄只有一個勝出者，因此加進該清單的 `.local.` 名字會遮蔽基礎文件，而非補充它。packages 指引要求把按需開啟項排除在出廠默認之外，但此處強有力的現有實踐、以及使用者對 `.local.` 文件總會被讀取的預期，壓過了這一考量。

**在產品 `cordis.yml` 層面設默認，而非在外掛程式 schema 中。** 否決：這樣只會為記得開啟該功能的那個產品入口啟用 `.local.`，從而在 TUI/ACP/headless 之間割裂行為，並重複一個本應與既有候選預設值放在一起的取值。

**兩個層級複用原始目錄作為 scope 鍵。** 否決：同一目錄下的基礎文件與本機文件會在每個以 scope 為鍵的對映中衝突，於是對其中一個的改動會抑制或覆蓋另一個。為每個候選設定各自獨立的 scope 鍵讓兩者保持獨立，且無需擴充持久化的元資料結構。

**將覆蓋層擴充到使用者全域性 scope。** 暫緩：`$DSH_HOME` 是單個固定的 `AGENTS.md`，沒有可供補充的已提交基礎文件，因此在出現具體需求前始終只有基礎文件。

## 後果

`.local.` 指導在所有產品中默認被讀取，無需按部署單獨設定，與鄰近工具保持一致。每個項目目錄可以為每個存在的候選貢獻一個持久 scope 而非僅一個，因此動態發現、編輯和移除會分別獨立地協調基礎文件與本機文件。scope 鍵現在[按候選劃分](2026-07-21-instruction-load-all-dedup.md)；`dsh-session` 對舊工作階段不作相容承諾，因此這是一次無成本的改動。使用者全域性 scope 仍然只有基礎文件，這一點作為已知限制記錄在包 README 中。
