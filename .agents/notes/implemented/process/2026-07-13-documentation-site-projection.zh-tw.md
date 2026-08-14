# Agent Note: 將權威文件投影到網站

Status: implemented

[English](2026-07-13-documentation-site-projection.md) | [简体中文](2026-07-13-documentation-site-projection.zh.md) | 繁體中文

## 問題

倉庫需要一個可導覽的文件網站，但不能讓網站目錄成為第二個文件源。把包指南、架構頁面或生成目錄複製到網站專用目錄樹，會使兩份副本發生漂移；讓 VitePress 直接指向倉庫根目錄，又會把公開 URL 和導覽與內部文件版面配置耦合。倉庫相對連結在網站上也需要指向不同位置：已發布頁面應留在站內，原始檔和未發布的貢獻者文件則應指向 GitHub。

## 決策

權威 Markdown 保留在其所屬的倉庫層級中。面向產品的指南位於 `docs/user/`，生成的參考資料保留在現有生成目錄中，架構頁面和實作手冊（cookbook）頁面也保留在現有的 `docs/` 路徑。

`website/docs.ts` 是一份顯式的發布 manifest（中繼資料清單）。每個條目將一個權威原始檔對映到穩定的公開路由、側邊欄、分區和順序。因此，新增或移除已發布頁面是一項可評審的 manifest 變更，而不是隱式目錄掃描的結果。

在 VitePress 啟動或建置之前，`scripts/project-doc-site.ts` 會把 manifest 投影到被忽略的 `website/.generated/` 目錄。生成目錄樹遵循公開路由，使 VitePress 導覽、locale 偵測和本機搜尋使用同一套路由命名。每個頁面都會獲得一個指向其權威倉庫文件的 `editSource` frontmatter 欄位；編輯連結回呼只讀取該頁面的資料，因此公開 URL 與原始檔版面配置彼此獨立。

各 locale 的首頁投影只保留權威 YAML frontmatter。面向倉庫的正文保留其 H1 和雙語原始檔連結；frontmatter 實作[保持 locale 不變的快速開始重定向](../simplification/2026-08-11-quickstart-documentation-home.md)，網站導覽負責切換 locale。

投影器解析 Markdown 連結，但不會重新序列化文件。指向另一個已發布原始檔的連結會變成站內相對路由；指向未發布倉庫文件的連結會變成 `deepseek-ai/deepseek-harness` 倉庫主頁下的原始檔連結；倉庫圖片會被拷貝進生成樹並從那裡引用（[原因](2026-08-06-doc-site-carries-its-images.md)）。相對目標不存在時，投影會失敗。單元測試會鎖定這些轉換行為，`docs:check` 則執行投影器測試和 VitePress 生產建置，並將二者納入 `doc-sync` 和平行文件閘門。

`verify-public-repository-links` 會拒絕已跟蹤文件中指向不可用舊倉庫的引用。原始檔連結和編輯連結使用當前倉庫主頁。

`website/AGENTS.md` 是網站子樹中唯一維護的 Markdown 文件。投影器測試會枚舉所有已跟蹤文件和未被忽略的未跟蹤文件，並拒絕網站中的任何其他 Markdown，因此網站專用的 locale、路由、API 或生成原始檔副本無法繞過發布 manifest。

Mermaid 渲染權威圖表。網站工作區顯式聲明 `vitepress-plugin-mermaid` 要求 Vite 預打包的 5 個包，因為 pnpm 的嚴格相依性隔離會使本機開發伺服器無法使用這些傳遞相依性；Knip 將這種僅執行時期使用記錄為有意的相依性例外。

網站發布與網站建置保持分離。專用 GitHub Actions 工作流程執行現有文件閘門，將 `website/.dist` 作為 Pages 產物上傳，並只在建置成功後部署。`actions/configure-pages` 在建置時向 VitePress 提供目標位置的 base path，因此私有 Pages 源站、未來的公開項目路徑和自訂網域不需要各自的檢入設定。Pages 可見性仍是倉庫託管設定，而不是工作流程權限。

## 考慮過的替代方案

**在 `website/` 下提交複製的 Markdown。** 這種方式讓 VitePress 設定更直接，但每份複製的指南或 API 表格都會多出一個歸屬方，並且需要一套無法識別權威副本的同步約定。

**讓 `website/` 成為每個已發布頁面的權威歸屬。** 這種方式仍只有一份副本，卻只是為了滿足渲染器，就把架構、生成的參考資料和麵向貢獻者的材料移出了各自的倉庫歸屬層級。

**自動發現所有 Markdown 文件。** 這種方式最大限度減少 manifest 維護，卻會意外發布內部文件、把原始檔移動暴露為 URL 變更，並根據偶然的目錄順序生成導覽。

**使用檔案系統符號連結。** 符號連結保留單一來源，卻無法解決公開路由或倉庫相對連結問題，而且在本機開發、包工具和託管 CI 環境中的行為不夠可預測。

**只在部署工作流程中建置。** 部署作業可以在合併後發現渲染故障。把生產建置納入 `doc-sync`，則無論是否存在公開部署，同一個故障都能在本機和常規 CI 中暴露。

**硬編碼公開項目路徑。** 固定的 `/deepseek-harness/` base 適用於公開項目 URL，卻不適用於私有 Pages 站點分配的唯一源站，也不適用於未來的自訂網域。使用 Pages 元資料可讓這些目標位置共享同一份建置約定。

## 後果

文件事實只有一個可編輯歸屬，公開路由在原始檔移動後仍保持穩定，網站也能納入生成的參考資料而無需提交另一份生成副本。本機開發會監視權威輸入並重新生成一次性投影。版面配置閘門會把過時的網站專用 Markdown 目錄樹變成合併失敗，而不是被忽略的建置輸入。影響文件網站的合併會把檢查過的結果部署到 Pages，手動觸發則提供復原和驗證的入口。

發布 manifest 是一份需要維護的 allowlist，連結投影也引入了一層倉庫專用的建置配接器。新增一種 Markdown 連結行為時，需要增加投影器測試。Mermaid 支持也會增大用戶端 bundle，但能保留權威文件中已經使用的圖表。
