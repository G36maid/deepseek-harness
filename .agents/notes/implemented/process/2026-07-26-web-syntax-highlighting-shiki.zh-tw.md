# Agent Note: web client 的文法高亮——同步細粒度的 shiki

Status: implemented

[English](2026-07-26-web-syntax-highlighting-shiki.md) | [简体中文](2026-07-26-web-syntax-highlighting-shiki.zh.md) | 繁體中文

> 範圍：web client 唯一的一套文法高亮體系——相依性裁決、單例形態、token 表約定與各消費表面。本篇是 Code Mode UI 堆疊 PR（Pull Request）鏈的第五個 PR；[chat 子呼叫行 Agent Note](../feature/2026-07-26-code-mode-chat-subcall-rows.md)交付了 `run_code` 程序正文，而本體系存在的意義正是讓它可讀。樣式的基本規則由 [Web 樣式體系裁決](2026-07-19-web-styling-system.md)規定。

## 問題

client 過去把每一處程式碼表面——assistant 正文裡的 markdown 圍欄程式碼區塊、`run_code` 程序正文、details 面板的參數——一律渲染成不帶高亮的等寬純文字。本堆疊 PR 鏈的主要載荷是模型撰寫的 TypeScript；未經高亮的程序掃讀起來明顯更喫力，而倉庫已經在自家 VitePress 站點上交付經 shiki 高亮的程式碼，於是 web 應用成了唯一不帶文法高亮的程式碼渲染表面。

## 決策

**採用同步細粒度形態的 shiki，作為 `ui-primitives` 裡的一個單例，主題化完全經由 CSS 自訂屬性完成。**

- **相依性**：`shiki/core` + `@shikijs/langs`，經 `createHighlighterCoreSync` 搭配 `createJavaScriptRegexEngine({ forgiving: true })` 組裝——不帶 oniguruma WASM、沒有非同步初始化、對 bundle 友好。文法（grammar）白名單：`typescript`（內嵌 JS）、`shellscript`、`json`——即 harness 實際會渲染的那幾種語言；其餘一律回退到幾何完全一致的純文字塊，絕不報錯。先例：VitePress 站點已經透過 shiki 渲染全部文件程式碼；而在 TypeScript（正是此處要緊的載荷）上，TextMate 文法實質性優於正則高亮器。
- **單例**：`ui-primitives/src/markdown/highlight.ts` 為每個 document 建立一個 `HighlighterCore`，並公開 `highlightToHtml(code, lang)`（undefined 即渲染為純文字）。引擎加文法的建置是一次約 120-175ms 的長任務，因此模組在外掛程式啟動時用延遲任務預熱單例（惰性路徑保留為正確性兜底），把這筆開銷挪出渲染路徑——否則流式 finalize 交換的那一刻會卡頓。別名錶用 `Map` 而非對象：fence 資訊字串由 assistant 撰寫，諸如 `constructor` 這樣的標籤必須落空，而不是解析到繼承屬性並讓 shiki 崩潰。共享的 `CodeBlock` 元件同時擁有兩條分支；其 shiki 分支經 `dangerouslySetInnerHTML` 注入生成的 span 樹——此用法獲準，因為 shiki 輸出的是從程式碼文字計算出的靜態 span 樹（不流經任何使用者 HTML，沒有指令碼或事件處理器），這正是 shiki 自身文件載明的消費路徑。
- **主題化**：shiki 的 `createCssVariablesTheme` 讓每一種 token 顏色都經由 `--shiki-*` 自訂屬性路由；取值本身住在新增的 `ui-theme/styles/shiki.css` token 表裡（亮色在 `:root`、暗色在 `body[data-ds-dark-theme]`——層疊方式與其餘每張樣式表相同），由殼的 `base.css` 匯入鏈引入。元件 CSS 保持只用 token；任何顏色字面量都不進入 JS 或元件樣式表。背景/前景以別名指向既有的 markdown 程式碼塊 token，使高亮塊與純文字塊彼此一致。
- **表面**：markdown 圍欄程式碼區塊（`MarkdownText` 的 `pre` 元件把單字串圍欄路由到 `CodeBlock`）、`run_code` 展開後的程序正文（ToolRow 的 code 變體，`lang="typescript"`），以及 details 面板的 Input 參數（`lang="json"`）。工具輸出從不做文法高亮——它是任意文字，硬猜一種文法，帶來的誤高亮會多於幫助；bash 卡片的輸出只承載其自身 ANSI 序列聲明的顏色，經由[終端機卡片](../feature/2026-07-28-web-terminal-card.md)渲染。

## 曾考慮的替代方案

**`rehype-highlight`/lowlight。** 屈居次選：天然同步，bundle 體積約為三分之一，但基於正則的文法在 TypeScript 上的保真度肉眼可見地更差，而且倉庫將從此同時執行兩套高亮體系（站點用 shiki、應用用 highlight.js）、維護兩套主題化詞彙。

**完整的 `shiki` bundle，或 oniguruma WASM 引擎。** 否決：完整 bundle 會帶上每一種文法和主題；WASM 需要非同步載入，而這正是同步的 client 啟動刻意規避的。細粒度 core 加三種文法，讓成本與實際用量成正比。

**在 worker 中高亮/非同步高亮。** 否決：載荷都很小（程序、圍欄程式碼區塊、參數）；同步 JS 引擎微秒級就能把它們 token 化，而非同步會引入一段未高亮程式碼的閃現，外加渲染機制的擾動，卻沒有任何實測得出的需要。

## 後果

所有消費端共用同一個程式碼表面——未來的新表面匯入 `CodeBlock` 即繼承高亮、主題化與純文字回退。bundle 的增量是 shiki core 加三種文法（在 `ui-primitives` 中一次性付款）。token 顏色是第一張 `--shiki-*` 表；註冊別名覆寫的主題包擴充它們的方式與擴充任何其他 token 無異。jsdom spec 鎖定 token span 結構、別名解析、兩條回退分支與圍欄路由；既有的已建置 bundle 快照和瀏覽器 e2e 覆蓋組裝後的路徑。
