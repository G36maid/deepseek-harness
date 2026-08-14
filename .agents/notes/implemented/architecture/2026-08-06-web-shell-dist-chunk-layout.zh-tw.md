# Agent Note: Web 殼產物的區塊拆分與目錄版面配置

Status: implemented

[English](2026-08-06-web-shell-dist-chunk-layout.md) | [简体中文](2026-08-06-web-shell-dist-chunk-layout.zh.md) | 繁體中文

## Problem

apps/web 的殼此前打成單一約 1.2 MB（minified）的 index 區塊，其中約八成是 vendor 位元組——KaTeX、boot 文法與 shiki 引擎、react-dom、markdown 管線——與全部 workspace 殼程式碼（約五分之一）熔在一起。任何一行殼程式碼改動都讓整個 chunk 換雜湊，再次訪問的用戶端全量重新下載；`dist/assets/` 是 100 多個文件的單層平鋪（主區塊、23 個延遲載入文法 chunk、59 個 KaTeX 字體面、sourcemap 混居），無從導覽。

## Decision

`apps/web/vite.config.ts` 以 `manualChunks` 把殼切成兩個初始區塊，並以輸出命名函式歸類目錄；整套設定零正則——精確包名 Set、檔名清單、擴充名清單。

**成員歸屬**（`VENDOR_PACKAGES`，按精確 npm 包名）：

- `vendor` = 三個重渲染家族：math（katex）、highlight（shiki）、markdown（micromark/mdast 解析管線——其上的增量 React 渲染器是 workspace 程式碼，不在此列）。成員以 `VENDOR_PACKAGES` 為活口徑，清單 = workspace 程式碼**直接 import** 的包：其餘私有傳遞相依性（oniguruma 系、@shikijs/core、字元表等數十個）只被清單成員引用，rollup 的區塊著色自動將其並入 vendor；與 index 側共享的相依性回落 index，只稀釋幾 KB，不構成正確性問題。
- **vendor 全員必須 react-free（邊界不變數）**：rollup 會把入口與 manual chunk 共享的模組並入 manual chunk——清單裡出現任何 import react/jsx-runtime 的包，唯一一份 react 副本就會被拽進 vendor、脫離 index。markdown/math 的 React 渲染側是 workspace 程式碼，天然住 index，react 族因此全部釘在 index。
- `index`（默認區塊）= react 族（react、react-dom、scheduler、use-sync-external-store）、vendored cordis、全部 workspace 程式碼及未列入的小件（anser、clsx）。
- `@shikijs/langs` 特判：boot 文法（`BOOT_GRAMMAR_FILES`：typescript、shellscript、json——highlight.ts 靜態 import 的三件，均為零內部 import 的自含資料模組）進 vendor；其餘 23 個延遲載入文法不做指派，各自保持按需 chunk。
- `index.html` 由 vite 自動接線：index 走 `<script>`、vendor 走 `<link rel="modulepreload">`，兩個區塊平行拉取，無序列載入瀑布。

**目錄版面配置**（`chunkFileNames` + `assetFileNames`）：

- `assets/` 根只留 index 與 vendor 的 js（含隨行 sourcemap）與 css。
- 文法 chunk 歸 `assets/langs/`。判據是 chunk 的 `moduleIds` 含 `@shikijs/langs` 成員，而非 facade：內嵌文法共享 chunk（php/ruby/mdx 內嵌 html+javascript，被 rollup 拆出共享）**沒有 facade**，facade 判據會漏；index/vendor 按名排除，因 vendor 合法攜帶 boot 三文法。
- 字體歸 `assets/fonts/`（`FONT_EXTENSIONS`：woff2/woff/ttf；今日全部為 vendor.css 引用的 KaTeX 字體面——katex.min.css 雖由 index 側元件 import，css 模組同樣經 manualChunks 歸屬、隨 `katex` 落入 vendor.css；瀏覽器按需只拉 woff2，且僅在公式渲染時）。
- sourcemap 無需安排：rollup 把 `.map` 寫在各自 js 旁並以裸相對檔名引用，區塊挪目錄時 map 自動跟隨。

跨目錄引用（index 的動態 import 指向 `langs/`、文法 chunk 間同目錄相對引用、vendor.css 相對引用 `fonts/`）均由建置器生成，執行時期零配套改動；host 側 webserver 按靜態前綴原樣服務巢狀路徑。

## Alternatives considered

- **react 等 vendor 走 CDN**：dsh web 面向本機/內網主機（常無外網），CDN 直接不可用；react 是全部外掛程式 bundle 的 platform seed external（殼是唯一供給方），改 CDN 全域性變數形態需牽動 platform 清單/seed/模組表三處；快取收益由 vendor 切分即可取得。
- **反向兜底規則（node_modules 除 react 族全歸 vendor）**：成員從設定上讀不出來，且把 anser/clsx 類小件錯歸 vendor；被正向精確包名清單取代。
- **正則家族匹配**：可讀性差；精確包名 + rollup 對傳遞相依性的自動著色使模式匹配沒有必要。
- **以 facadeModuleId 識別文法 chunk**：無 facade 的內嵌文法共享 chunk 會漏檢落回根目錄；`moduleIds` 成員判據覆蓋兩種形態。
- **在 vendor 裡收留帶 react 邊的渲染門面**（歷史上的 react-markdown 屬此類）：會經 rollup 的共享模組歸並把唯一 react 副本拽進 vendor，破壞「react 歸 index」的邊界；該約束已成文為清單的邊界不變數。
- **KaTeX 整體延遲載入、boot TypeScript 文法轉懶**：會改變首幀渲染行為（公式/首個程式碼塊的回退），是獨立於產物版面配置的取捨，另行決策。

## Verification

審計工具隨庫：`node scripts/attribute-chunk-bytes.mjs <chunk.js>`（零相依性 sourcemap VLQ 位元組歸屬，按 npm 包/workspace 目錄聚合）。以其複核：vendor 不含任何 workspace 位元組、react 族（含 react/jsx-runtime）全量位於 index、index 的 npm 側僅剩 react 族與 anser/clsx；懶文法 chunk 數量與 `LAZY_GRAMMARS` 表一一對應；瀏覽器 keyless replay 用例與改動前基線逐字一致（特定於本機環境的報紅除外），雙區塊殼裝載渲染無回歸。

## Consequences

- 殼程式碼改動只重雜湊 index（約為產物三分之一）；vendor（約三分之二）跨殼版本快取穩定，僅相依性升級時失效。
- `dist/assets/` 可導覽：根兩對 js/css，`langs/` 按需文法，`fonts/` 字體。
- 維護成本：workspace 程式碼新增對某渲染家族門麪包的直接 import 時需同步 `VENDOR_PACKAGES`（漏列僅稀釋 index，不致壞）；在 highlight.ts 擴 boot 文法集而未同步 `BOOT_GRAMMAR_FILES` 時，該文法靜默落入 index，僅產物審計可見。
- webserver 靜態面尚無壓縮，gzip 體積收益仍有待實作；傳輸層壓縮是另一項獨立決策。
