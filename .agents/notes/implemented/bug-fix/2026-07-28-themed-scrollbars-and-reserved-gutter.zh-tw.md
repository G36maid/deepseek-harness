# Agent Note: 捲軸 token 有了消費端，工作區清單預留出捲軸空位

Status: implemented

[English](2026-07-28-themed-scrollbars-and-reserved-gutter.md) | [简体中文](2026-07-28-themed-scrollbars-and-reserved-gutter.zh.md) | 繁體中文

## 問題

`design-platform.css` 在亮色與暗色兩套調色板中都聲明瞭四個 `--dsw-alias-scrollbar-*` token（`bg-l1`、`bg-l2`、`hover-l1`、`hover-l2`），而用戶端裡沒有任何一條規則讀取它們。定義了卻無人消費的 token 構不成主題：所有滾動區域渲染的都是瀏覽器自帶的捲軸，它對調色板一無所知，因此暗色主題下暗色表面上出現的是一條亮色的原生捲軸。

暴露這一缺口的可見症狀出在別處。工作區瀏覽器的工作階段清單（`WorkspaceBrowser.module.css` 中的 `.list`）是側邊欄裡唯一的滾動區域，而每一行的尾部內容都緊貼該行 8px 的右內邊距——`rows/Rows.module.css` 中的 `.time` 取 `flex: none`，hover 時取代它的操作按鈕也是如此。於是覆蓋式捲軸會畫在相對時間戳之上。只在這一個清單裡預留空間，捲軸本身仍然沒有主題，因此兩部分合為一次變更。

## 決策

`packages/client/ui-theme/src/styles/scrollbar.css` 是這四個 token 的唯一消費端，也是殼的匯入鏈（`packages/client/web/src/base.css`）中第五張 ui-theme 樣式表。它排在 `design-platform.css` 之後，因為它讀取那張樣式表的 token。

規則掛在 `body` 上，而非 `html`。`design-platform.css` 在 `body` 上聲明 `--dsw-alias-*` token，暗色覆蓋掛在 `body[data-ds-dark-theme]` 上，而自訂屬性只向下繼承；掛在 `html` 上的規則會把它們解析為 guaranteed-invalid 值，此時 `scrollbar-color` 計算為 `auto`，主題完全不起作用。

`scrollbar-width` 與 `scrollbar-color` 聲明在 `body, body *` 上，而不是隻在頂層聲明一次。繼承傳下去的是已經在 `body` 處代入完成的顏色值，因此後代元素重新綁定這層間接變數也無法改變自己的捲軸；逐元素重新聲明使每個元素按它自己看到的取值代入變數。`scrollbar-width` 本身就不是可繼承屬性，無論如何都需要逐元素聲明。`::-webkit-scrollbar*` 偽元素同樣不繼承，因此以不加限定的選擇器匹配。

兩種渲染互斥，而這種互斥是被強制的，不是假定的。`scrollbar-width` 或 `scrollbar-color` 只要取非 `auto` 值，Chromium 與 Safari 就會丟棄該元素上的全部 `::-webkit-scrollbar*` 規則，`::-webkit-scrollbar-thumb:hover` 也在其中。因此無條件地同時聲明會讓 hover token 在任何地方都得不到渲染：實作了 hover 偽元素的引擎，恰恰就是被標準屬性靜音的那些，而 Firefox 沒有 hover 偽元素可作退路。於是標準屬性寫在 `@supports not selector(::-webkit-scrollbar)` 之內，該條件只在偽元素未被實作處為真，因此 Firefox 走標準屬性路徑，WebKit 系引擎走偽元素路徑。WebKit 規則不再反向加閘門：不實作這些偽元素的引擎會把它們當作未知選擇器丟棄，因此加閘門只是重述選擇器匹配本身已經做的事。對於舊到不支持 `selector()` 函式的引擎，該條件無效，從而求值為假並選中偽元素路徑——對於這條判斷下現實存在的 16.4 之前的 Safari，這正是正確的一側。

兩條路徑都讀取同一組間接變數 `--dsh-scrollbar-thumb` 與 `--dsh-scrollbar-thumb-hover`，它們在 `body` 上綁定到 l1（基礎表面）token。**這就是重新綁定約定，也是單看 CSS 無法得知的部分**：抬升表面在自己的容器上設定 `--dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2)` 與 `--dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2)`，這一次重新綁定同時作用於標準屬性和 WebKit 偽元素。這組變數必須成對重新綁定；只改靜止態滑桿會讓 hover 狀態仍留在基礎表面的 token 上。這組變數另一個合法的目標是 `transparent`，它隨側邊欄捲軸[改為跟隨指針](../feature/2026-08-04-pointer-revealed-sidebar-scrollbars.md)一並引入；下文的閘門只接受這兩種目標。可由機械檢查發現的子集歸 `packages/client/ui-theme/tests/scrollbar-styles.client.spec.ts` 所有：任何既滾動又繪製抬升表面的樣式表都必須重新綁定，因此本 note 不再維護完整的表面清單。多數把這組變數聲明在抬升卡片上而非滾動的後代元素上，因為抬升層級屬於這個表面，而自訂屬性會繼承到真正滾動的那個子元素。

`Menu`、`InputBar`、`QuestionComposer` 與 `TodoPanel` 這四個表面最初被漏掉，因此逐樣式表的重新綁定約定由機械檢查而非人工審閱把關。

抬升表面集合是從調色板自身的暗色抬升階梯解析出來的——暗色取值落在 `bg-layer-2` 或 `bg-layer-3` 上的那些表面 token，而這一檔正是 l1/l2 之分所編碼的層級差。最初的做法是從已經做了重新綁定的樣式表反向推導，那是不成立的：這樣得到的集合只能確認別人已經記得的部分，而尚無人重新綁定的表面——恰恰就是這項檢查存在的理由——會把自己定義成「非抬升」。`--dsw-specific-tip` 證明瞭這一點：它解析到與選單表面相同的那一檔，待辦面板在它上面滾動卻沒有重新綁定，而推導式的檢查依然是綠的。

判定範圍依據 token 家族而非幾何形狀：只有 `--dsw-alias-bg-*` 與 `--dsw-specific-*` 表述的是表面。`--dsw-alias-button-*`、`--dsw-alias-interactive-*` 與 `--dsw-alias-markdown-*` 會落到相同檔位，但它們表述的是控制元件或行內片段，沒有任何滾動容器會把捲軸畫在它們之上。形狀無法做這個判斷，因為懸浮按鈕本來就會帶圓角、陰影和固定尺寸。這項檢查以樣式表為粒度而非以規則為粒度，因為卡片與真正滾動的後代元素是兩條不同的規則。這種近似檢查無法偵測嵌在由另一個包的樣式表繪製的抬升卡片中的滾動元件，`Modal` 內的 `DirectoryBrowser` 就證明瞭這一點；跨樣式表的組合仍需在評審和組裝後 UI 層面把關。

軌道與兩條捲軸相交的角落保持透明，因此滑桿是以其下滾動的任何表面為背景被看到；只有滑桿及其 hover 狀態帶 token 顏色。

`.list` 聲明 `scrollbar-gutter: stable`，使捲軸位於行的旁邊而非行的上方。取 `stable` 而非 `auto`，因為 `auto` 只在清單確實溢位時才預留空位：那樣展開一個工作區分組時，所有行會在清單開始滾動的那一刻發生水準位移。`stable` 的預留是無條件的，行不會移動。

面對覆蓋式捲軸——也就是這個症狀唯一存在的那種形態——空位聲明與樣式表裡的 `::-webkit-scrollbar` 寬度是共同必要的。在執行中的應用上實測：保留其中一條、從活的層疊中刪掉另一條，任意一次單獨刪除都會讓清單的條帶從 8 降到 0。空位聲明表述的是「要預留空間」，而偽元素寬度纔是讓 chromium 把捲軸視為佔據版面配置空間、而不是浮在內容之上的原因。因此對這個 bug 而言，本次變更的兩半都不是選填項，這也是兩半必須一起交付的第二個理由。

## 曾考慮的替代方案

**在每個滾動元件的樣式表裡各寫一份 `::-webkit-scrollbar` 規則。** 之所以否決：用戶端共有分佈在九個包中的十三個滾動容器，每一個都要帶上同一段規則，而第十四個會在沒有任何閘門報錯的情況下漏掉主題。由設計 token 驅動程式的皮膚應當歸屬於擁有這些 token 的包。

**提供一個工具類，由各滾動容器自行加上。** 重複同樣被消除，但失敗方式依舊存在：新的滾動容器只有在作者記得加類名時纔有主題，而遺漏在評審中看不出來。`body, body *` 這種寫法沒有需要記住的啟用步驟；確實想要不同捲軸的容器可以覆蓋間接變數，這與抬升表面使用的機制相同。

**把這兩個屬性綁定在 `html` 上。** 這是文件級皮膚最自然的落點，而它的失敗是可測量的：規則掛在 `html` 上時，chromium 中滾動容器計算出的 `scrollbar-color` 為 `auto`，因為別名 token 在那個作用域內不存在。

**只聲明一次，靠繼承下傳。** 匹配的元素更少，但它破壞重新綁定約定——繼承攜帶的是代入後的顏色，而不是變數引用，因此抬升表面無法給自己的捲軸換色。它本身也不完整，因為 `scrollbar-width` 不繼承。

**不加 `@supports` 閘門，無條件同時聲明標準屬性與偽元素。** 在 chromium 中於帶 `scrollbar-gutter: stable`（使條帶可觀測）的探針元素上實測：單獨一條 8px 的 `::-webkit-scrollbar` 預留出 30px 條帶（樣式表指定的寬度加上瀏覽器自帶的按鈕），而給同一元素加上 `scrollbar-width: thin` 後降到 `thin` 所預留的 10px——說明偽元素規則是被丟棄，而不是被合併。全部 `::-webkit-scrollbar-thumb:hover` 規則隨之失效，因此兩個 hover token 與四處抬升表面的 hover 重新綁定，在多數使用者實際使用的引擎上都是死程式碼。

**給 WebKit 規則也加閘門，寫成 `@supports selector(::-webkit-scrollbar)`。** 讀起來對稱，但在一個方向上是錯的：它會對「實作了偽元素但不支持 `selector()`」的引擎隱藏這些規則，而那正是不加閘門時能被正確服務的 16.4 之前的 Safari。未知選擇器本就會被丟棄，因此這道閘門不提供任何能抵償該代價的保護。

**改用內邊距而不是預留空位（給 `.list` 加右內邊距，或把 `.time` 向內移）。** 之所以否決：內邊距無論捲軸是否存在都生效，因此在常見的短清單情形下白白佔用橫向空間；而且它只修好一個容器，其餘每個滾動區域的內容仍然壓在捲軸之下。

**給 `.list` 用 `scrollbar-gutter: auto`。** 空位在清單溢位時出現，也就是捲軸存在的時候。之所以否決：側邊欄的清單會隨分組展開與收起而伸縮，因此空位會在使用者遊標之下出現又消失，並帶動行一起位移。

## 後果

- 用戶端的每個滾動容器都繪製帶主題的滑桿：亮色基礎表面為 `rgb(229, 229, 229)`，暗色基礎表面為 `rgb(60, 60, 61)`，重新綁定到 l2 的暗色抬升表面為 `rgb(84, 85, 87)`。側邊欄內的滾動區域經由同一組間接變數，只在指針到達時才繪製滑桿。
- 兩種渲染分別指定，因此改動滑桿的幾何或 hover 行為需要改兩處：一處在 `scrollbar-width`／`scrollbar-color`，一處在偽元素。讓兩者都經由這組間接變數，把這份重複限制在 Firefox 與 WebKit 不共用的那些屬性上。
- hover token（`--dsw-alias-scrollbar-hover-l1`／`-l2`）只在偽元素路徑上渲染。Firefox 透過 `scrollbar-color` 只表述一個滑桿顏色，其 hover 表現由引擎自行推導，因此對 hover 顏色的設計改動在 Chromium 與 Safari 上可見，在 Firefox 上不可見。這是 `scrollbar-color` 本身的限制，不是這張樣式表的限制。
- `body *` 匹配所有元素，涉及的兩個屬性其效果本就被瀏覽器限制在實際會滾動的元素上。代價是一個覆蓋面很寬的選擇器；另一種選擇是一個不生效的重新綁定約定。
- 工作區清單在任何清單長度下都永久少了預留空位那一條寬度。這正是該修復換來的代價：以穩定的行幾何，換掉只在清單較短時纔可讀的時間戳。
- 調色板中沒有軌道 token，因此日後若設計需要不透明軌道，要新增一個別名 token，而不是在這張樣式表裡寫字面顏色。

## 測試

三份單元測試讀取磁碟上的 CSS 文字。`ui-theme/tests/scrollbar-styles.spec.ts` 從 `design-platform.css` 中掃描出捲軸 token 集合，而不是把它寫死，因此新增、重新命名或刪除 token 時斷言會隨之變化；它檢查每個 token 都有消費端，且每處抬升表面重新綁定的都是完整的一對。它還以原始碼偏移量鎖定兩條路徑的劃分：標準屬性在閘門塊之內，`::-webkit-scrollbar*` 規則與每一處對 hover 間接變數的讀取都在閘門塊之外。這個劃分必須用偏移量斷言，因為該測試文件的規則解析器會把 at-rule 拉平，所以刪掉閘門或把某條聲明移到閘門另一側，文件裡其餘全部斷言仍然是綠的。

`apps/web/tests/sidebar-scrollbar.e2e.ts` 覆蓋只有真實渲染引擎才能報告的事實：預留條帶的寬度，以及引擎實際走的是哪條渲染路徑。它不需要任何模型呼叫——清單只要溢位即可——因此以只讀方式複用一份既有的已提交 fixture（測試前置資料）來鋪入冷工作階段。

這個場景還提交了一份 golden（期望產物）`snapshots/sidebar-scrollbar/geometry.expected.md`，記錄兩套調色板下解析後的捲軸樣式與幾何。其餘 web 場景提交的 aria golden 承載不了純 CSS 的改動：它不改變任何 DOM、也不改變任何無障礙名稱，因此有無這次改動，它們規範化後的樹都是逐位元組相同的。改為記錄解析後的取值，就讓滑桿顏色、條頻寬度或渲染路徑的意外變化成為可評審的 diff，而不是一條需要人去推敲的閾值斷言。絕對坐標被特意排除——`timeRight` 與兩條邊緣取決於側邊欄排版後的寬度和字體度量，把它們提交進去會得到一份需要按平臺重新錄制的 fixture，那記錄的是平臺而不是這次改動。真正記錄下來的是條帶、重疊量與兩個先後關係，每一項都是差值或比較，因此只要預留仍然成立，任何排版下都不變。

在建置產物用戶端上於 headless chromium 中讀取計算值確認，這正是區分「token 鏈真正生效」與「文法合法」的手段：滾動容器在兩套調色板下分別計算出 l1 的滑桿顏色，而重新綁定間接變數的容器計算出 l2 的顏色，證明重新綁定作用到了計算值，而不只是作用到自訂屬性上。Firefox 的標準屬性路徑以同樣方式做了驗證，包含 `scrollbar-color` 上從 l1 到 l2 的重新綁定；headless Firefox 對任何元素（無論是否被樣式命中）都報告 `scrollbar-width: none`，這是 headless 的產物，不是這張樣式表造成的。

chromium 上有兩處測量限制決定了 e2e 能斷言什麼。閘門使 chromium 報告的 `scrollbar-width` 與 `scrollbar-color` 都是 `auto`，因此代入後的 `scrollbar-color` 不再是可觀測量——e2e 特意斷言這個 `auto` 讀數，因為此處出現具體值就意味著閘門洩漏、偽元素被靜音。另外，`getComputedStyle(el, '::-webkit-scrollbar-thumb')` 會把 `::-webkit-scrollbar-thumb:hover` 規則一並折算進去，因此它在靜止態就報告 hover 顏色，兩種狀態都鎖不住；這一點由在執行中的頁面裡用 `CSSStyleSheet.deleteRule` 刪掉 hover 規則得證——同一查詢隨之從 hover 顏色翻轉為靜止態顏色。因此 e2e 改為讀取那組間接變數在清單上代入後的靜止態與 hover 顏色（每個變數用一個一次性探針元素，因為 `getComputedStyle` 返回的是活的聲明對象，複用探針只會報告最後一次讀到的值），並把 hover 聲明當作規則文字從層疊中讀出。

閘門本身在它起作用的層面有反向對照：把樣式表中的 `@supports` 包裹去掉、重新 `build:web`、再跑 e2e，`scrollbar-width: auto` 那條斷言會以 `thin` 變紅，而這正是閘門存在所要阻止的那種靜音。

headless chromium 繪製的是覆蓋式捲軸，而這恰好就是被報告症狀存在的那種形態，因此這個 e2e 復現的是這個 bug 本身，而不是它的近似：在乾淨的 master 上，清單條帶為 0，捲軸蓋住相對時間 7px。其中預留空位不會縮小 `clientWidth`，因此把時間元素右邊緣與內容區右邊緣做比較的斷言在有無預留的兩種狀態下都成立，它的透過或失敗取決於平臺的捲軸樣式，而不是取決於被測的那條聲明。真正能區分兩種狀態的兩個量是 `offsetWidth - clientWidth` 條帶，以及以捲軸自身寬度為基準量出的重疊量 `timeCoveredBy`。

兩者都要斷言，因為各自捕捉的是不同的回歸；這一點透過每次只改動一條聲明、並把同一個測試裡的其餘斷言靜音來確定。只刪掉空位聲明時 `timeCoveredBy` 仍為 0——此時捲軸是 8px，而行的右內邊距也是 8px，於是它緊貼時間戳但並未蓋住——失敗的是條帶那條斷言。再把偽元素寬度也刪掉（這纔是 master 的真實狀態）才會產生重疊，此時 `timeCoveredBy` 以 7 變紅。在 xvfb 下的有頭執行無論哪種狀態都看不到這個症狀，因為 chromium 在那裡畫的是經典佔位捲軸，`clientWidth` 本來就已經把它排除了。

驗證瀏覽器可見的外掛程式 CSS 需要一次 `pnpm run build:web` 並不執行的重建。`WorkspaceBrowser.module.css` 從不進入 `apps/web/dist`：ui-workspace 以執行時期外掛程式方式載入，其 CSS 內聯進 `packages/client/ui-workspace/lib/client.js`，由該包自己的 `bundle` 指令碼建置。因此只重跑 `build:web` 的反向對照實際測的是舊產物，去掉聲明後仍會透過，看起來像測試無效，實際是對照無效。正確做法是先 `pnpm --filter @deepseek-ai/dsh-client-ui-workspace run bundle`，用 grep 在 `lib/client.js` 中確認該聲明確實存在或消失，然後再 `build:web`。

`test:web` 原先只執行 `build:web`，因此任何滾動區域或外掛程式 CSS 的改動都會碰到這個陷阱；現在它先執行 `build`，而 `build` 覆蓋 `packages/*/*`，從而會重建各外掛程式產物。`check-all` 本來就把 `build` 排在 `build:web` 之前，所以 CI 從未受影響——受影響的只有本機指令碼，而這恰恰是「產物過期卻透過」最容易被當真的地方。
