# Agent Note: 工作階段列為每個檢視表預留同一條捲軸槽

Status: implemented

[English](2026-08-04-composer-tab-gutter-reservation.md) | [简体中文](2026-08-04-composer-tab-gutter-reservation.zh.md) | 繁體中文

## 問題

composer 座位在元件樹中只有一個節點、一個位置，但它究竟對齊到哪條邊，取決於當前展示的是哪個檢視表分頁標籤。

在 Chat 中它是工作階段列滾動容器（`[data-conversation-scroll]`）的 sticky **子元素**，因而依附於該容器的 content box——而佔版面配置寬度的捲軸會把這個盒子收窄一條捲軸的寬度。聲明瞭 `data-conversation-composer-overlay` 的檢視表（Trajectory 即是其一）會把工作階段列的滾動搬進檢視表自身：以該屬性為條件的那條分支把滾動容器留作 `overflow: hidden`，並把座位改為絕對定位——對齊的是 padding box，而捲軸從不收窄這個盒子。

於是隻要 transcript（文字記錄）超出一屏——任何帶歷史的工作階段的常態——兩個分頁標籤就恰好相差一條捲軸的寬度。輸入卡片是置中的，因此在 8px 的捲軸下切換分頁標籤會讓它橫向移動 4px，而右側留白整整變化 8px。同一位移也出現在 Chat 內部：transcript 成長到開始滾動的那一刻，以及從 hero 態進入第一個可滾動輪次時。

## 決策

`.scrollBody` 為 Chat 狀態聲明 `scrollbar-gutter: stable`，覆蓋分支則將其覆蓋為 `scrollbar-gutter: auto`，同時保持為雙軸滾動容器——`overflow-x: hidden; overflow-y: auto`。這條預留只屬於 Chat：它讓座位的內容盒在 transcript 是否溢位時都保持同一寬度，因此卡片不會在 transcript 成長到開始滾動的那一刻跳動，也不會在 hero 態與第一個可滾動輪次之間跳動。覆蓋分支不預留任何槽位——檢視表自己滾動，槽位只會白白收窄檢視表內容——它的座位改為補償捲軸寬度（[座位寬度補償](2026-08-12-composer-overlay-seat-width-compensation.md)）。

選 `stable` 而非 `auto`，是因為 `auto` 只在盒子確實溢位時才預留，而「溢位與否」恰恰就是 Chat 兩種相位之間的那點差別——`auto` 的寫法只是把缺陷重述一遍，並不能修掉它。

這條預留位於 `overflow-y: auto` 的盒子上，而這個形式是承重的：WebKit 對 `overflow-y: auto` 的盒子應用 `scrollbar-gutter`，對 hidden 的盒子則忽略它——這是在本應用 composer 自身的圖層上實測所得，並記錄於 [composer 滾動視口記錄](2026-07-31-composer-text-layers-share-one-scrollport.md)——所以把預留放在 hidden 盒子上，會在 Chromium 上成立，在 Safari 上悄無聲息地不成立。覆蓋分支同樣保留 `overflow-y: auto` 的形式，作為沒有任何內容會滾出去的裁剪盒：單軸滾動的盒子會把另一軸的 `visible` 計算為 `auto`，因此橫向軸顯式聲明為 `hidden` 而不是交給推導，否則某個檢視表的內容第一次伸出列外時，它就會長出自己的橫向捲軸。

這條預留之所以值回它的代價，前提是捲軸在這裡確實佔版面配置空間——這並非瀏覽器的默認行為，而是本用戶端的選擇：ui-theme 的樣式表給 `::-webkit-scrollbar` 聲明瞭寬度（[捲軸主題化](2026-07-28-themed-scrollbars-and-reserved-gutter.md)），側邊欄的工作階段清單也正是出於同一原因預留了自己的捲軸槽。

## 曾考慮的替代方案

**把 overlay 座位按捲軸寬度內縮。** 這是對該缺陷最窄的一種解讀——兩種狀態差 8px，那就從一側減去 8px。之所以否決，是因為這個數字屬於引擎而不屬於我們：WebKit 路徑繪製樣式表裡的 8px 捲軸，Firefox 路徑繪製 `scrollbar-width: thin` 解析出的寬度，硬編碼的內縮會讓兩種狀態在 Chromium 上對齊、在別處繼續漂移。捲軸槽是請引擎按它自己那條捲軸的寬度去預留，無論那是多少。

**保留 `overflow: hidden`，只加 `scrollbar-gutter: stable`。** 單行版本。它能在瀏覽器車道所用的引擎上修掉可見症狀，卻把症狀原封不動留在 Safari 上，而且任何測試都不會失敗——這正是改動的後一半所要防的失效模式。

**讓 Chat 的 composer 座位也移出滾動容器，使 overlay 的幾何成為唯一的幾何。** 這是從根上刪掉差異，而不是調和它，代價是放棄一項刻意的性質：sticky 座位位於滾動流之內，因此在 composer 上滾輪會帶動對話記錄（[sticky composer](2026-07-29-sticky-composer-conversation-scroll.md)），其上方的漸隱遮罩也由座位自身的背景繪製。兩者都是已有明確歸屬且各有測試覆蓋的行為；為了消除 8px 的不對稱而重建它們，是更大的改動而非更小的。

**給工作階段列加上一條捲軸寬度的內邊距，而不是預留捲軸槽。** 內邊距無論是否存在捲軸都會生效，因此在每種狀態下都無條件付出這份寬度，而且它把一個由引擎在版面配置期決定的值釘死在樣式表裡。否決理由與側邊欄清單當初否決它時相同。

## 後果

- Chat 的內容列永久變窄 8px——hero 態與 transcript 尚短、根本不繪製捲軸時同樣如此。這就是這筆交易：以最寬的列換取卡片在任何內容高度下都只有一個位置。
- 卡片在三種切換下保持同一位置，由兩種機制達成：預留讓 Chat 的座位在自身各相位間保持同一寬度（transcript 較短 ↔ 可滾動、hero ↔ 第一個可滾動輪次），Chat ↔ Trajectory 的切換則由覆蓋座位的補償來對齊（[座位寬度補償](2026-08-12-composer-overlay-seat-width-compensation.md)）。
- overlay 狀態現在是一個滾動容器。今天其中沒有任何內容會溢位；將來若有檢視表允許自身內容超出工作階段列，這個盒子會滾動而不是裁剪，那個檢視表就需要像 Trajectory 檢視表那樣自帶裁剪。
- 提交的 golden 記錄了預留條帶，因此樣式表中 `::-webkit-scrollbar` 寬度的變化——決定這條預留有多寬的那個值——會在本場景中與在側邊欄場景中一樣，以可評審的 diff 形式出現。

## 測試

`apps/web/tests/composer-tab-geometry.e2e.ts` 在兩個分頁標籤下測量輸入卡片的矩形，分別取卡片處於寬度上限的視口與卡片隨列收縮的視口，並斷言這兩個矩形是同一個矩形。只有真實引擎能報告這件事：jsdom 給每個元素的盒子尺寸都是零，也沒有捲軸，因此單元測試只能斷言那些聲明存在，無法斷言兩種狀態落在同一位置。出於同一原因，本次沒有附帶讀取 CSS 文字的單元測試——它只會把聲明複述一遍，並不會補上瀏覽器車道尚未確立的事實。

該場景啟動 chromium 時去掉了 Playwright 默認的 `--hide-scrollbars`，這一點是承重的：帶上該參數時捲軸不佔任何版面配置寬度，因此兩個分頁標籤在有補償與無補償時同樣一致，文件中的每一處比較都會空洞地透過。實測：帶上該參數時兩條預留帶的寬度都是 0；去掉它則分別是 8 與 0。

隨後，未補償的級聯會被注入頁面——透過 `!important` 把覆蓋座位的 `right` 補償降為 0，Chat 的預留保持不變——並在其下測量同樣的兩個分頁標籤，這正是把「卡片確實沒動」與「分頁標籤切換根本沒到達版面配置」區分開的那一步。它把上報的症狀復現為一個數字：每條邊 4px，恰是 8px 頻寬的一半。golden 把這份對照與修復後的狀態並排記錄，因此 fixture（測試前置資料）承載的是這次改動所消除的那個差值，而不僅僅是它的缺席。
