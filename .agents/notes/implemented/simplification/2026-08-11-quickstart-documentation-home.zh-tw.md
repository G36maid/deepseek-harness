# Agent Note: 將文件根路由指向快速開始

Status: implemented

[English](2026-08-11-quickstart-documentation-home.md) | 繁體中文

## 問題

單獨的文件首頁會重複產品首頁所維護的產品定位和功能摘要。這些重複聲明需要同步與評審，卻不能幫助讀者查閱技術操作說明。

## 決策

每個 locale 根路由都是重定向頁面。`/` 將讀者導向 `./guide/quickstart`，`/en/` 則把同一相對目標解析為 `/en/guide/quickstart`。當網站託管在源站的子路徑下時，相對目標仍會保留設定的 `DOCS_BASE`。

重定向由 `docs/user/index.md` 與 `docs/user/index.zh.md` 的 VitePress frontmatter 維護。對於 locale 首頁，[文件網站投影器](../process/2026-07-13-documentation-site-projection.md)只發布這段 frontmatter，因此權威 Markdown 保留中英文語言切換列，且不會渲染第二個首頁。投影器測試驗證兩個 locale 根路由都使用相對於各自 locale 的同一快速開始目標。

文件網站不承載產品定位和功能摘要。快速開始頁面仍提供指南、開發、參考、搜尋和 locale 導覽。

## 考慮過的替代方案

**保留文件 hero 並同步其文案。** 這樣會保留一個推廣入口頁，但也會產生第二套產品敘事，其中的聲明和術語可能與產品首頁逐漸偏離。

**在根路由渲染文件索引。** 索引會重複網站已有的導覽，並在讀者開始首篇操作指南之前插入一次額外選擇。

**把快速開始內容複製到每個 locale 根路由。** 這樣會讓兩個公開路由同時維護同一篇教程，並需要另一套同步機制。

**使用源站絕對路徑作為重定向目標。** `/guide/quickstart` 等路徑會忽略 `DOCS_BASE`，當文件網站託管在源站的子路徑下時將失效。

## 結果

進入任一 locale 根路由的讀者都會立即到達該 locale 的快速開始教程。文件網站放棄推廣型首頁，產品首頁則繼續作為產品定位和功能摘要的唯一歸屬。穩定的根路由仍是有效入口，快速開始內容仍由單一權威來源維護。
