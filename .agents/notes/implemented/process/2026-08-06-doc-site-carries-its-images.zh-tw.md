# Agent Note: 文件站點自帶圖片

Status: implemented

[English](2026-08-06-doc-site-carries-its-images.md) | [简体中文](2026-08-06-doc-site-carries-its-images.zh.md) | 繁體中文

## 問題

`scripts/project-doc-site.ts` 會把發布 manifest（中繼資料清單）未收錄的倉庫相對目標一律改寫成 GitHub 地址，對圖片而言就是 `https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>`。站點建置不拷貝任何文件：`srcDir` 是用完即棄的 `.generated` 樹，VitePress 沒有設定 `publicDir`（其預設值 `<srcDir>/public` 恰好位於投影每次執行時期刪除的那棵樹裡），而寫進去的只有 Markdown。

這只對公開倉庫成立。本倉庫是私有的，而 `raw.githubusercontent.com` 對未認證請求一律回 404——github.com 上的登入工作階段也不能認證它，因為 GitHub 自家介面是用另一套單獨簽名的地址提供私有 blob 的。於是站點上的每一張圖片對每一位讀者都是壞的，卻沒有任何閘門能說出來：`verify-md-links` 與投影校驗的是目標文件**在倉庫裡是否存在**，那與站點讀者能否取到它是兩個問題。

## 決策

`rewriteMarkdown` 新增選填的 `placeImage(absPath): string`。當頁面引用了一張 manifest 未作為頁面發布的圖片時，投影把該文件複製進生成樹中該頁面的旁邊，並把引用改寫為 `./<basename>`；隨後 Vite 會像處理其他站點資源一樣打包它。倉庫可見性再也影響不到已發布頁面。

副本落在頁面旁邊，而不是某個共享資源目錄。每個 locale 的路由樹各持一份副本，因此同一個相對 URL 在 `guide/` 與 `en/guide/` 下都正確，無需按 locale 計算前綴；manifest 撤下某頁時，它的資源也隨之消失。一張表登記所有被投影的路徑——頁面與圖片一視同仁——同一路徑出現第二個來源就拋錯，與既有的重複路由檢查同一個立場，而不是讓最後寫入的那個靜默勝出。

只有真實路徑位於倉庫內的普通文件才會被拷貝，其餘一律讓投影失敗並點名頁面與目標。連結改寫只需要知道目標**存在**，但發布是把它的位元組拷上站點，因此一個逃出倉庫的引用——經由 `../..` 或指向樹外的符號連結——會把建置機上的文件放到已發布頁面上。引用自帶的 `?query` 或 `#fragment` 會隨安置後的 URL 一同保留，與 GitHub 分支一貫的做法一致；檔名做百分號編碼，因為目標位於 Markdown 內聯目標的位置。

`docsSourceFiles()` 會連同被安置的圖片一起上報，於是替換截圖時開發伺服器的 watcher 會重新投影，而不是一直服務舊副本直到有人碰一下頁面。

`placeImage` 之所以選填，是因為 `rewriteMarkdown` 也被它自己的 spec 直接呼叫，而那裡並不存在生成樹。不傳它時，GitHub raw 回退會指向公開源主頁；這讓該 seam 對只改寫文字的消費端保持誠實。

正本 Markdown 照舊寫普通的倉庫相對圖片路徑，因此同一份文件在 GitHub 上和站點上都能正常顯示。沒有任何文件為了遷就 VitePress 而寫站內絕對 URL。

## 考慮過的替代方案

**把 `publicDir` 設到 `.generated` 之外，並使用站內絕對 URL。** 投影這邊的活動部件更少，但同一份 Markdown 在倉庫中閱讀時，每一處圖片引用都會是壞的，而正本文件是兩種方式都要讀的。

**把圖片放到 assets 分支，就像演示 GIF 那樣。** 那個分支的存在是為了讓大體積二進位不進主線歷史，而它的 raw 地址有著完全相同的可見性問題。它仍然是錄屏的正確歸宿；但它解決不了這件事。

**等倉庫轉為公開。** 那只是消除症狀，不會讓站點自給自足，而且每一張圖片都會讓站點隱式相依性 GitHub 的可用性與限流。

## 後果

已發布文件中的圖片，現在無論誰在閱讀、無論倉庫是否公開都能顯示，站點建置也不再為圖片相依性 GitHub 的執行時期可達性。生成樹會為每個 locale 各增加一份被引用圖片的副本——模型提供方指南裡的四張截圖，每個 locale 約 270 KB。

**未發布**文件引用的圖片不受影響。純文字投影會相對於公開源主頁解析它們；不在站點上的文件沒有站點建置可以承載其資源。

## 測試

`scripts/project-doc-site.spec.ts` 覆蓋：placer 收到解析後的絕對路徑且其返回的 URL 落進 Markdown、被安置的引用保留其 fragment、存在 placer 時已發布頁面的連結仍解析到自己的路由、以及不傳 placer 時不變的 GitHub raw 回退。`publishableImage` 另有直接覆蓋：倉庫內的普通文件被接受，而目標逃出倉庫的符號連結、倉庫外的路徑與目錄一律拒絕。`pnpm docs:check` 會帶著模型提供方指南的截圖建置站點，並在來源缺失時失敗；被拷貝的文件及其 `./<basename>` 引用已在 `website/.generated` 與執行中的 `docs:dev` 裡核實（兩個 locale 均 `naturalWidth > 0`）。
