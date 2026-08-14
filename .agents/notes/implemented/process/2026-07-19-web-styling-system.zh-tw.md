# Agent Note: Web 樣式體系——token 框架與工程約束

Status: implemented

> token 體系更新（2026-07-22）：本文框架裁決（CSS Modules + clsx、無元件庫、無 tailwind、顏色只用 token）仍然生效，但兩層 `--bg-*`/`--text-*` token 表及其宿主 `web-ui/src/style/global.css` 已被 `packages/client/ui-theme/src/styles/` 的 `--dsw-*` static+alias 雙層表取代（暗色=`body[data-ds-dark-theme]` 覆寫）——樣式表本身即 token 權威。

[English](2026-07-19-web-styling-system.md) | 繁體中文

> 分工：本 RFC 定框架與約束（少變）；[docs/web-styling.md](../../../../docs/web-styling.md) 是活規範（token 權威值、編碼規範打勾清單、偏離記錄，隨實作演進）。改 token/加規則去那邊；動框架本身才回這裡（推翻須新 RFC）。

## Problem

GUI 無設計師供給，樣式由 agent 編寫並 review；沒有一套機器可檢查的 token 體系與編碼規範，顏色/圓角/動效會在元件間字面量漂移，暗色主題會長成元件內散落的條件分支。

## Decision（框架五條）

| # | 決策 | 內容 |
|---|---|---|
| 1 | **視覺基線 = Chat 對齊** | 取值全部來自對 Chat 前端的調研（品牌藍 `--accent: #3964fe`、灰階、氣泡/側邊欄幾何、陰影分級……）；允許偏離但須在 web-styling.md 偏離表記錄 |
| 2 | **token 兩層不三層** | 基線倉是 static→alias→specific 三層；我們體量下壓成「語義層直接持實值（註釋標 base 色板出處）+ 極少數元件專屬槽位（`--bg-sidebar`/`--bubble-bg`）」兩層，全部住 `web-ui/src/style/global.css` |
| 3 | **字級/間距不 token 化** | 基線倉同款決策：字級在元件裡寫 px 且**成對寫行高**（16/24、14/22、12/18），間距用 4 的倍數；token 化只覆蓋顏色/圓角/動效/字體棧/陰影 |
| 4 | **邊框與互動態用透明度制** | 邊框 `rgba(0,0,0,.04/.1)`、hover/active `rgba(38,49,72,.06/.1)`——疊加在任意層級的背景色上都成立，不新造實色灰 |
| 5 | **暗色只在 token 表做** | `:root` 亮色實值 + `[data-theme='dark']` 覆蓋同名變數；**元件 CSS 零主題選擇器**；確需按主題換非 token 值時用「CSS 變數橋」（元件定義區域性變數、主題塊只覆寫變數） |

## 工程約束

- **CSS Modules + clsx，無元件庫、無 tailwind**：每元件同目錄同名 `.module.css`；類名 camelCase、狀態類單形容詞由 clsx 掛載；元件透傳 `className`。
- **禁 `composes`**；`:global` 僅穿透第三方/跨包類名，不定義新全域性類；全域性工具類只住 global.css 且個位數（現狀 `.scrollable`）。
- **PostCSS 外掛程式現狀為零**（vite 無 postcss 設定，平鋪 CSS 即夠用；引入 nested/custom-media 前需先記入 web-styling.md）；CSS Modules 類型聲明用 `css-modules.d.ts` 通配 declare（元件數超 20 再評估 typed-css-modules 逐文件生成）。
- **動態樣式走 CSS 變數橋**：JS 只寫變數（`style={{'--x': v}}`），規則留在 CSS；禁止 TSX 內拼樣式對象做主題/狀態分支。
- 過渡一律 `var(--dur*) var(--ease)` 且只過渡 opacity/transform/背景色/陰影；滾動容器統一 `.scrollable`（元件內禁寫 `::-webkit-scrollbar`）。

## 給 agent 的執行形態

規範以 **review 對照打勾清單**形態維護（web-styling.md §3，12 條）：每條是可判定的「見 X 即打回」，不是風格建議——寫樣式與 review 樣式共用同一張表。

常見事項的入口（操作清單）：

- **寫新元件樣式**：同目錄同名 `.module.css`，對照 web-styling.md §3 逐條自查；顏色/圓角/動效只引 §1 token。
- **加一個 token**：先進 web-styling.md §1 表補一行（亮色值+暗色列+base 色板出處註釋）→ global.css `:root` 與 `[data-theme='dark']` 兩塊同步 → 再在元件裡引用。
- **偏離視覺基線常數**（web-styling.md §2 的幾何/陰影值）：先在 §5 偏離表記一行（日期/項/理由）再落碼。
- **需要按主題變化的非 token 值**（漸變端點等）：元件定義區域性 CSS 變數、主題塊只覆寫變數（變數橋），元件 CSS 保持零 `[data-theme]` 選擇器。

## 與 web-styling.md 的分工

| 內容 | 歸屬 |
|---|---|
| 框架五條、工程約束、為何兩層/為何不 token 化字級 | 本 RFC（修改框架須由新 RFC 取代本文） |
| token 逐項權威值（含暗色）、視覺基線常數（側邊欄/氣泡/工作階段行/輸入卡片幾何）、RPC 四象限方向符視覺詞彙、編碼規範 12 條、偏離記錄 | web-styling.md（活文件，隨實作演進） |
| 取值證據（deepseekchat file:line） | 調研歸檔已完成使命，git 歷史留檔 |

## Consequences

樣式收斂到機器可檢查：顏色/圓角/動效/陰影只引 web-styling.md §1 token，暗色是單一屬性選擇器覆蓋表，review 與自查共用同一張 12 條清單。接受的代價：字級/間距靠成對行高與 4 倍數紀律而非 token；動框架本身須由新 RFC 取代本文。

## Alternatives considered

| 放棄項 | 一句話理由 |
|---|---|
| 字級/間距 token 化 | 基線倉實證不 token 化也能收斂（成對寫行高紀律替代）；token 表膨脹降低顏色 token 的權威性 |
| 暗色用 `prefers-color-scheme` 或元件內分支 | 屬性選擇器整表覆蓋讓元件零感知；系統偏好可後續在 toggle 層適配，不動 token 機制 |
