# Agent Note: Markdown 交叉連結有效性檢查

Status: implemented

[English](2026-06-18-markdown-cross-link-lint.md) | [简体中文](2026-06-18-markdown-cross-link-lint.zh.md) | 繁體中文

## 問題

本倉庫的文件透過相對路徑互相連結：`[topic](../implemented/2026-…-….md)`、`[the cookbook](adding-a-tool.md)`、`[architecture.md](../../architecture.md)`。此前沒有任何機制驗證這些目標是否存在。重新命名或移動文件會靜默破壞所有指向它的連結，且在學者點擊之前不可見。[doc-sync（文件同步閘門）強制執行](../../archived/process/2026-06-11-doc-sync-enforcement.md)已經將兩類文件漂移的檢查自動化（無法編譯的程式碼塊、過時的事件分類體系表），[verify-md-wrap](../../archived/process/2026-06-11-doc-sync-enforcement.md) 覆蓋了第三類（硬換行的段落），但死鏈是第四類同樣可機械檢查、卻仍靠肉眼驗證的問題。

引入這道閘門的直接動因是 Agent Note 目錄樹重組：將 `docs/adr/` 與 `.agents/notes/` 統一到同一個 `.agents/notes/` 下，並設定 `proposed/`、`implemented/`、`rejected/` 子目錄，需要手工重新命名約 40 條文件間連結。只要有一處路徑輸入錯誤，就會在沒有任何檢查攔截的情況下交付斷鏈。

## 決策

新增第四道 `doc-sync` 閘門 `verify-md-links`（`scripts/verify-md-links.ts`），風格與 `verify-md-wrap` 一致（tsx ESM、基於 AST、只驗證不生成）：

- 使用 `mdast-util-from-markdown` + GFM 解析每個範圍內的 Markdown 文件，遍歷所有 `link`、`image`、`definition` 節點。
- 僅當目標是**相對路徑**時才檢查。跳過帶協議的 URL（`https:`、`mailto:` 等）、協議相對路徑（`//host`）、根絕對路徑（`/path`，在檢出目錄中沒有穩定基準）以及純頁內錨點（`#section`）。剝除 `#fragment`/`?query`，相對於連結所在文件的目錄解析路徑，並斷言目標在磁碟上存在。
- 只報告、不改寫；發現第一條死鏈即以非零狀態退出。

檢查範圍與其他閘門一致，並額外包含 AGENTS.md 文件對以及 `.agents/skills/` 下倉庫自有的 agent skill（代理技能） Markdown（這些 skill 文件會交叉連結到 docs 目錄樹，因此本次重組也改寫了其中的連結）：`README.md`、`docs/**/*.md`、`packages/*/README.md`、`AGENTS.md`、`packages/AGENTS.md`、`.agents/skills/**/*.md`。系統按真實路徑去重（`CLAUDE.md` symlink 會解析到 AGENTS.md 文件）。該檢查接入 `doc-sync`，因此相關文件變更與 CI 執行同一套斷鏈檢查。

本閘門現在也檢查 Markdown 目標上的 `#fragment` 錨點——包括同文件錨點——對照標題 slug 與顯式 `<a id>`；該機制與 slug 規則由 [fragment 錨點決定](2026-08-09-md-fragment-anchor-gate.md)規定。

## 曾考慮的替代方案

**錨點級有效性檢查**：當時以更重且價值更低為由推遲（實際發生過的問題是文件級死鏈），把 `#fragment` 驗證留給作者人工完成。該人工規則沒有守住；[fragment 錨點決定](2026-08-09-md-fragment-anchor-gate.md)後來補上了這項檢查。

## 後果

- 造成交叉連結失效的重新命名與移動會直接使 `doc-sync` 和 CI 失敗，而不是等讀者點擊死鏈才暴露。由此，引入該閘門的 Agent Note 重組具備自校驗能力：該檢查證明其自身改寫的連結均未懸空。
- `doc-sync` 鏈中多了一個快速 tsx 指令碼；無新增相依性（mdast/GFM 技術棧已作為 `verify-md-wrap` 的 devDependencies 存在）。
- 該閘門強制執行的約定是：文件交叉引用必須使用可機械檢查的相對連結，絕不能只寫純文字或編號。[docs/AGENTS.md](../../../../docs/AGENTS.md)記錄了這項約定，使作者瞭解該閘門及其理由。
