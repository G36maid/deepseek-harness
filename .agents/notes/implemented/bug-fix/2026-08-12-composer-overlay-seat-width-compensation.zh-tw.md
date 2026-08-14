# Agent Note: 覆蓋檢視表的 composer 座位改為補償捲軸寬度，不再預留捲軸槽

Status: implemented

[English](2026-08-12-composer-overlay-seat-width-compensation.md) | [简体中文](2026-08-12-composer-overlay-seat-width-compensation.zh.md) | 繁體中文

## 問題

[composer 分頁標籤捲軸槽預留](2026-08-04-composer-tab-gutter-reservation.md) 讓工作階段列滾動容器無條件預留一條捲軸槽，使 composer 座位在 Chat 與帶 composer 覆蓋的檢視表中測得相同寬度。代價由每個覆蓋檢視表承擔：檢視表內容列比列右邊緣窄 8px，因為滾動容器為一條它從不繪製的捲軸預留了槽——trajectory 臺帳由檢視表內部自己的滾動容器滾動，外層盒子從不滾動。

trajectory 表格讓這個代價顯形：整行分隔線在面板右邊緣前 8px 處停止，每條線右側以及整個內容列右側都留下一條空白帶。

## 決策

預留現在只屬於 Chat。覆蓋分支聲明 `scrollbar-gutter: auto`，檢視表內容佔滿整列；覆蓋分支的 composer 座位（相對 padding box 絕對定位）用 `right: var(--dsh-scrollbar-width)` 讓出捲軸寬度，使輸入卡仍與 Chat 座位測得相同寬度，切換分頁標籤時不移動。

補償值不是字面量：ui-theme 的 scrollbar.css 在它映像檔的 `::-webkit-scrollbar` 規則旁定義 `--dsh-scrollbar-width`（WebKit 路徑 8px），座位讀取該變數。scrollbar-styles 規格把該變數與其映像檔規則、以及補償消費者配對檢查，因此樣式表捲軸寬度一變卻不同步變數——或變數一變卻不同步消費者——都會讓閘門失敗，而不只是評審時發現。

## 備選方案

**保留無條件預留，壓縮每個覆蓋檢視表。** 修復前行為。兩個分頁標籤一條聲明，但每個覆蓋檢視表都要付出 8px 內容列，trajectory 臺帳將其顯現為可見空白。已拒絕：覆蓋檢視表自己滾動，不應為 Chat 的捲軸買單。

**覆蓋分支也預留，並讓檢視表滲入捲軸槽。** 同樣結果下更多活動部件：從不滾動的盒子上仍存在捲軸槽，檢視表還得突破內容盒才能取回寬度。

**接受 4px 卡片位移。** 去掉預留卻不補償座位，會在每次切換分頁標籤時移動輸入卡——正是前一份 note 修復的症狀。已拒絕：卡片位置是刻意保持的跨分頁標籤不變數。

**把 overlay 座位按捲軸寬度內縮。** [捲軸槽預留 note](2026-08-04-composer-tab-gutter-reservation.md) 當初否決的正是這個方案，本 note 採納了它；變的是否決的前提。這個數字屬於引擎而不屬於我們——WebKit 路徑繪製樣式表裡的 8px 捲軸，Firefox 路徑繪製 `scrollbar-width: thin` 解析出的寬度——因此硬編碼的內縮會讓兩種狀態在 Chromium 上對齊、在別處繼續漂移。當初 overlay 分支自己預留的是引擎解析出的槽寬，內縮必須精確匹配那個寬度。如今 overlay 分支不預留任何槽位，補償成為覆蓋側唯一的機制；否決的字面量那一半，透過把 8px 變成與 `::-webkit-scrollbar` 規則同處一個 diff 的變數來回應。Firefox 那一半仍然存在：Chat 預留引擎解析寬度，補償保持固定 8px，兩者不等之處的殘餘漂移作為接受的代價記錄在後果中。

## 後果

- Chat 保留捲軸槽與穩定的卡片位置；該分頁標籤無任何變化。
- 覆蓋檢視表（trajectory）佔滿整列；trajectory 臺帳的分隔線到達面板右邊緣。
- 輸入卡在 Chat 與 Trajectory 分頁標籤間仍保持同一水準位置，現在由兩種機制而非一種達成：Chat 預留，覆蓋座位補償。
- Chat 預留引擎解析寬度，覆蓋座位補償固定的 8px。兩者不等之處——Firefox 路徑按平臺解析 `scrollbar-width: thin`，而 e2e 只在 Chromium 上執行——卡片在切換分頁標籤時會漂移半個差值。這是接受的殘餘代價，如實記錄於此而不斷言消除：本次改動並未提供目標平臺 Firefox thin 寬度的實測。
- `--dsh-scrollbar-width` 成為 ui-theme 對外、且被 ui-theme 之外讀取的變數；scrollbar-styles 規格把它與映像檔的 `::-webkit-scrollbar` 寬度規則、以及補償消費者配對檢查，補上了該變數本會留下的間接層閘門缺口。

## 測試

`apps/web/tests/composer-tab-geometry.e2e.ts` 仍斷言輸入卡在分頁標籤間保持位置，並新增斷言拆分：Chat 滾動容器保持 `scrollbar-gutter: stable` 與非零槽寬，覆蓋分支解析為 `auto` 且槽寬為零。控制級聯隨機制改變：現在移除座位的 `right` 補償（而非移除該分支上 Chat 從未有過的槽），測得同樣的 4px 位移，證明相等的矩形並非從未到達版面配置的分頁標籤切換。提交的 golden 記錄兩種狀態。
