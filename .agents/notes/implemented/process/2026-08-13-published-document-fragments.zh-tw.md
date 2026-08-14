# Agent Note: 校驗已發布文件的 fragment

Status: implemented

[English](2026-08-13-published-document-fragments.md) | 繁體中文

## Problem

`verify-md-links` 使用 GitHub 的 Markdown 標題 id 校驗 fragment，而文件網站使用 VitePress 渲染標題。包含較多標點的標題與翻譯後的標題可能透過原始碼校驗，卻在已發布 HTML 中沒有對應 id。VitePress 建置成功只會校驗目標頁面，不會校驗 fragment id。

## Decision

`docs:build` 及其 MPA 變體會在 VitePress 生成 `website/.dist` 後執行 `verify-doc-site-fragments`。該校驗器解析每個生成的 HTML 頁面，按照 VitePress clean URL 解析每個內部 fragment 連結，並在建置產物不存在、路由有歧義、href 格式錯誤、目標頁面不存在或請求的 id 缺失時失敗。單元測試覆蓋這些失敗，以及 clean URL、`.html` 別名、同頁連結、編碼和字面 id 與外部連結排除。

任何 GitHub id 與 VitePress id 不同的 fragment 目標標題都會帶有與 GitHub 相容的顯式別名。英文手寫頁面和翻譯頁面會在標題前新增別名；翻譯頁面使用雙語對側檔案共享的英文 id。生成的設定、工具和持久化目錄由所屬生成器輸出別名。原始碼 Markdown 校驗保持獨立，仍會拒絕在倉庫渲染規則下無法解析的連結。

## Alternatives considered

**使用各語言專屬的 fragment。** 雙語對側檔案會刻意保留相同的連結目標。語言專屬 fragment 會使兩側原始碼不一致，還會要求每個連結生成方都瞭解目標語言翻譯後的標題。

**相依性 VitePress 標題 id。** 這些 id 取決於渲染後的標點與本機化標題文字，無法保留倉庫連結和生成引用已經使用的 GitHub id。

**只檢查 Markdown 原始碼。** 這種做法不會校驗發布產物，也無法發現 GitHub 與 VitePress slug 演算法之間的差異。

## Consequences

每次生產文件建置都會讀取一次生成的 HTML，在現有網站建置後增加一個有界檢查。跨頁面 fragment 連結必須指向發布後仍存在的 id。顯式別名成為已發布參考的一部分，使標題更換語言或標點後仍能保留既有 fragment。
