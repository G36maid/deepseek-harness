# Agent Note: 文件站導覽與倉庫 chrome

Status: implemented

[English](2026-08-12-documentation-site-navigation-and-chrome.md) | [简体中文](2026-08-12-documentation-site-navigation-and-chrome.zh.md) | 繁體中文

## 問題

參考側邊欄把 43 個子系統頁排在了所有其他分組之前：VitePress 設定中的 `sectionOrder` 既沒有為子系統分組、也沒有為承載 Python SDK 頁的分組聲明位置，`indexOf` 返回 `-1`，於是它們排到了所有已排序分區的前面。點擊 `参考` 導覽項落在架構頁，而該頁自己的側邊欄條目是 62 條中的第 44 條，位於 2478px 側邊欄的 1549px 處——在視口之外。四個子系統頁所用的 `order` 值已被同一分區內的其他頁佔用，只靠 `Array.prototype.sort` 的穩定性和 manifest 陣列恰好的拼接順序才沒有錯亂。

頂欄把 `入门` 指向 `/guide/`，而 manifest 已把入門首頁發布在 `guide/quickstart.md`，該導覽項因此返回 404：寫死的導覽目標會與 manifest 實際發布的路由脫節。

另外，每個規範頁面都帶有寫給 GitHub 讀者的行——標題下的語言切換列，部分頁面還有倉庫徽章——站點原樣投影了它們，儘管其導覽列已經提供了這兩者。

## 決定

[website/docs.ts](../../../../website/docs.ts) 擁有分區位置。`sections` 按 locale 聲明各分組，`sectionSpec(locale, label)` 返回分組的位置與摺疊行為，當某 locale 未為該 label 聲明位置時拋錯。未出現在聲明中的分組現在會讓建置失敗，而不是靜默排到最前。位置按 locale 聲明，是因為兩側側邊欄各自命名分組，而兩側共用的標籤 `SDK` 無法同時相對 `入门` 和相對 `Guide` 取同一位次。

子系統頁按關注點分組——總覽、核心與作用域、工作階段與持久化、模型與上下文、執行與工具、策略與互動、平臺與接入——其中六個主題組保持摺疊，直到某一組包含正在閱讀的頁面。這些分組排在參考側邊欄的最後：展開時它們的數量超過其餘所有分組之和，因此排在它們之後的任何內容都只能靠滾過整個清單才能到達。頁面 `order` 由陣列位置推導，不再手寫數字。

`landingLink(locale, collection)` 依據 `orderedPages`——即側邊欄所用的同一套排序——推導每個導覽項的目標，因此導覽項始終打開該分區已發布的首個頁面。

[scripts/project-doc-site.ts](../../../../scripts/project-doc-site.ts) 中的 `projectedPageContent` 會丟棄語言切換列和倉庫徽章。切換行的匹配被限制在前八行內，因此展示該約定的教程仍能渲染出它的示例。

導覽列標題是內聯進 `siteTitle` 的 DeepSeek 字標，VitePress 會將其按 HTML 渲染。內聯正是讓字標的 `currentColor` 填充跟隨當前主題的原因；`themeConfig.logo` 渲染為 `<img>`，會把字標固定為文件聲明的顏色，並且需要為每套主題各準備一份資源。側邊欄捲軸平時不可見，滾動時出現，透過 `data-` 屬性而非 class 標記，因為 Vue 在 patch 該元素時會整體重寫 `class`。

## 考慮過的替代方案

**為中文查詢訂製搜尋分詞器。** 已實作並撤回。其前提——MiniSearch 會把中文散文留作無法切分的整句——是用一個語料中根本不存在的詞（`子代理`）驗證的；中文頁面寫的是 `Subagent` 和 `子 agent`。在未改動的索引上實測，`插件配置` 返回 120 條命中、`会话持久化` 85 條、`工作流` 28 條、`沙箱` 12 條，且各自的頁面均排在首位：`prefix: true` 已經能透過標點切出的短 token 命中中文詞。相鄰字元二元組把中文索引從 1.23MB 增至 2.12MB，卻沒有帶來收益。該嘗試還暴露出一個值得保留的陷阱：VitePress 透過 `Function.prototype.toString` 把搜尋選項中的函式送到瀏覽器，再用 `new Function` 重建，因此任何閉包引用了模組級常數的此類函式都會在空作用域中拋錯，並靜默地返回零結果。

**把子系統分組直接放在 `概念` 之後。** 已否決：這樣能讓架構頁回到頂部，但生成參考、Cordis API 和開發手冊仍處在 43 行之下。

**在投影時重寫檔名連結文字。** 子系統索引表寫的是 `[core.md](core.md)`，在站點上讀起來像倉庫文件索引。`scripts/project-doc-site.spec.ts` 斷言了該行的確切格式，因此這些檔名是刻意的約定而非疏漏；要改變站點顯示的內容，就要連同該約定及其閘門一起改，而不是在投影器裡繞開它們。

## 影響

在所有子系統分組摺疊時，參考側邊欄高度為 1452px，此前為 2478px，且架構頁是它的第一個條目。分區位置與摺疊行為聲明在同一份 manifest 中，不再分散於 manifest 與設定之間；`scripts/project-doc-site.spec.ts` 固定了三條不變式：每個擁有側邊欄的頁面都能解析到位置、未聲明的分區會被拒絕、同一分區內沒有兩個頁面共用 `order`。

剝離 chrome 不改動規範 Markdown——切換行與徽章仍服務於 GitHub 讀者。代價是投影器現在知曉源語料的兩項呈現約定，而採用不同切換行措辭的頁面將不會被匹配到。

字標是同一圖形的第二份副本，另兩份位於 `apps/web/public/favicon.svg` 和 `packages/client/ui-primitives/src/FishLogo.tsx`，各自承載自己的呈現方式。DeepSeek 字標的變更只有透過更新這份副本才能到達文件站。
