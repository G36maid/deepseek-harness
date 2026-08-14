# Agent Note: 以產物為先的 NPM 基線發布

Status: proposed

[English](2026-08-04-artifact-first-npm-baseline-publication.md) | [简体中文](2026-08-04-artifact-first-npm-baseline-publication.zh.md) | 繁體中文

## 問題

monorepo 中可執行的原始碼並不能證明發布後的包可執行。workspace link、TypeScript paths、tsx 原始碼載入和工作樹裡殘留的 `lib/` 都可能補上發布 tarball 中缺失的文件或相依性。即使現有建置產物測試使用普通 Node，它仍直接讀取工作樹中的 `lib/`，沒有驗證 `package.json#files` 最終選中了什麼，也沒有驗證套件管理員安裝後的文件版面配置。一次開發模式正常的執行因此可能發布為缺少 bundle chunk、聲明文件、設定或資源的包。

發布多個互相相依性的 `@deepseek-ai` 包還會產生集合一致性問題。如果指令碼每 pack 一個包就立即 publish，那麼後續 pack 或驗證失敗時，登錄檔中已經存在無法作為完整基線使用的前半組版本。npm 登錄檔沒有跨包交易，因此這裡的「一次性發布」不能承諾原子提交，只能承諾在任何遠端寫入前完整生成並驗證發布集合，再由一個可復原的編排命令發布這個不可變集合。

當前基線還需要人工在本機完成版本派生、認證、pack、發布和重試。後續 GitHub Actions 工作流程必須複用同一套發布包與驗證邏輯，不能在批准發布後重新建置另一組未經消費端測試的 tarball。

## 提案

發布流程以一個不可變的 release bundle（發布包集合）為邊界。pack 階段從一個確定的 Git commit 建置全部目標包、生成全部 tarball、檢查 tarball 內容，並透過安裝後整合測試；publish 階段只讀取這組 tarball 及其 manifest（中繼資料清單），禁止重建或重新 pack。

目標集合只包含 `packages/*/*/package.json` 與 `apps/*/package.json` 中命名為 `@deepseek-ai/*` 的 workspace 包。根項目、`website/`、vendor、Python 與 native workspace 不屬於該 NPM 基線。發現機制必須拒絕重複包名、不同基礎版本、意外的 `private` 發布狀態以及集合中的未知包，而不是維護另一份手工包名清單。

預發布版本由包的穩定基礎版本、命令啟動時精確到秒的 UTC 時間戳和目標 commit 的 10 位短 SHA 組成：`<base>-<YYYYMMDDHHmmss>-<short-commit>`。dist-tag 由基礎版本派生為 `dev-<base>`。例如，基礎版本 `0.0.1`、時間 `2026-08-04T00:32:00Z` 和 commit `909292dd7b` 生成版本 `0.0.1-20260804003200-909292dd7b` 與 tag `dev-0.0.1`。同一 release bundle 的重試必須沿用原版本和 manifest；重新 pack 會按新的命令啟動時間生成新版本。

pack 階段按以下順序執行：

1. 將 ref 解析成不可變 commit，採集 UTC 時間戳，從該 commit 的根 manifest 派生版本，並顯示 commit、時間戳、版本、tag、登錄檔和輸出路徑。`pack` 與 `release` 此時都會在昂貴操作開始前等待 Enter；自動化可用 `--yes` 跳過該確認。
2. 在隔離的 detached worktree 中安裝 frozen lockfile，並在暫存前執行原始碼 manifest 發布約束；呼叫方工作樹中的未提交文件和舊建置輸出不得參與發布。
3. 將所有目標 manifest 暫存為派生版本，移除發布時的 `private` 標記，並把 `dependencies`、`devDependencies`、`optionalDependencies` 與 `peerDependencies` 中的內部 workspace 相依性全部改寫為同一精確版本。
4. 完整建置目標 commit，再執行 publint 和已建置包不變式。
5. 為目標集合中的每個包執行 pack，但不執行任何登錄檔寫入。
6. 檢查 tarball 內的 package manifest、文件清單、內部相依性版本、包名和版本，並拒絕缺失、重複或額外的 tarball。
7. 生成包含 commit、版本、tag、登錄檔、每個包的 tarball 路徑、SHA-256 與 npm integrity 的 release manifest 和校驗和文件。
8. 從本機 tarball 安裝一個隔離消費端，執行當前實作已有的安裝態產物探測，並將這些探測擴充為下文定義的完整產物平面整合測試矩陣。
9. 僅當整個集合透過時輸出一個可直接執行的 publish 命令；pack 命令本身始終保持無遠端寫入。

本機 `release` 命令組合 pack 與 publish。它先透過上述 pack 確認確定預期時間戳和版本，再在 pack 成功後等待第二次 Enter，隨後發布同一 manifest；`release --yes` 跳過兩次確認。獨立的 `pack` 與 `publish --manifest` 仍是 CI 分 job 和斷點復原使用的基礎操作。

## 當前實作邊界

已提交的 pack 命令實作了固定 commit 暫存、內部相依性精確固化、靜態與 tarball payload 檢查、不可變 manifest，以及把每個發布 tarball 都作為本機頂層相依性的隔離 npm 安裝。它在輸出 publish 命令前，用普通 Node 執行安裝後的 `dsh --version` 與 `dsh --dump-default-config` 入口，再在 POSIX PTY 中啟動安裝後的默認 TUI，等待其 `main-session-` 就緒訊號，並透過 `/exit` 退出。Publish 支持按 integrity 復原，將只讀登錄檔驗證與認證身份檢查分離，並以完整的遠端 integrity 和 dist-tag 驗證結束。

PR（Pull Request） CI 不會呼叫 pack 命令；安裝態入口探測屬於本機發布檢查，而不是合併閘門。免憑據 CI 執行、其他每個 bin 與公開執行時期入口的包自有探測、workflow artifact 傳遞及受保護 publish job 仍屬於提案範圍。

## 發布 payload 約定

發布包只攜帶消費端需要的建置產物。`package.json#files` 禁止包含 `src` 和 `lib/types/**/*.d.ts.map`；tarball 內容閘門還要獨立確認不存在任何 `package/src/**` 與 `package/**/*.d.ts.map`，避免 manifest pattern 或 pack 行為繞過靜態約束。執行時期 JS、聲明文件 `.d.ts`、設定、資源、worker 文件和 bundle 動態 chunk 必須按實際入口閉包收齊。

原始碼 manifest 可以保留 `exports["./src/*"]`，供本倉庫的原始碼平面解析使用；該 export 不代表原始碼會進入發布 payload，也不屬於已發布包的消費端約定。靜態閘門必須分別檢查原始碼平面與發布 payload，不能透過刪除 source export 來掩蓋錯誤的 workspace 解析，也不能透過發布 `src` 來修補缺失的建置產物。

每個 tarball 必須不含 `workspace:` specifier，並且所有指向本次發布集合的內部相依性與對等相依性（peer dependency）都必須精確等於本次派生版本，禁止使用 `^`、`~` 或其他 semver 範圍跨越 commit 基線。除了明確僅供原始碼平面使用的 `exports["./src/*"]`，package manifest 中聲明的每個消費端入口都必須指向 tarball 記憶體在的文件；動態 import、執行時期拼接路徑和非 export 資源不能只靠 manifest 檢查，必須由安裝後執行覆蓋。

## 產物平面整合測試

整合測試在全部 tarball 生成後、任何 publish 之前執行。它在 monorepo 外建立一個全新臨時項目，透過本次 release manifest 中的本機 `.tgz` 文件安裝聲明相依性閉包，並從安裝目錄執行。測試必須使用普通 Node 與套件管理員生成的 `node_modules`；禁止 tsx、tsconfig paths、workspace link、倉庫原始碼路徑、工作樹 `lib/` 和已發布登錄檔中的同版本包參與解析。測試還要斷言關鍵模組與 bin 的真實路徑位於臨時消費端內。

安裝使用本次發布選擇的用戶端行為。登錄檔上傳必須使用 `npm` CLI（命令列介面），以滿足私有登錄檔只接受 npm 用戶端的策略；建置編排仍可使用 pnpm。tarball 測試不得先把這些包發布到真實登錄檔，也不得在測試後重新 pack。

測試至少覆蓋以下執行面：

- `@deepseek-ai/dsh` 安裝後的 `dsh --version` 與 `dsh --dump-default-config` 在普通 Node 下成功，分別覆蓋靜態 CLI 入口和一個動態模式入口。
- 安裝後的默認 `dsh` 在 PTY 中完成一次無金鑰 TUI 啟動，到達既定 ready 訊號後由測試受控退出。這條路徑必須載入真實 TUI 動態 chunk，因此缺少類似 `lib/tui-*.js` 的發布文件會使閘門失敗。
- 每個其他已發布 `bin` 都定義一個不會訪問真實服務或修改使用者狀態的包級冒煙命令。不同 CLI 不強制共用 `--help`；測試必須執行其真實安裝入口並檢查約定的退出或 ready 訊號。
- Node 相容的公開執行時期入口從安裝目錄載入；瀏覽器、worker 或必須由宿主協議驅動的入口使用對應的隔離 fixture（測試前置資料），但輸入仍只能是本次 tarball。

這些測試驗證可執行性，不替代單元測試、快照、真實 API e2e 或 publint。測試 fixture 應複用現有 built-bin 和 PTY 場景的行為斷言，但必須把入口改為 tarball 安裝結果；直接執行工作樹 `lib/bin.js` 的測試不能算作本閘門。

## 發布與復原

publish 命令先驗證 release manifest、所有本機校驗和、目標登錄檔、`npm ping` 和 `npm whoami`，再按確定順序上傳 tarball。命令只接受 pack 階段生成的 manifest，不接受 workspace 目錄作為發布輸入。默認登錄檔為 `https://registry.npm.harnessment.com/`，每次 publish 都顯式傳入登錄檔和派生 tag，避免使用者級 `.npmrc` 改變目標。

npm 不提供多包原子交易，上傳仍會逐包發生。編排器透過冪等復原縮小失敗面：若遠端不存在 `<name>@<version>` 就上傳；若已存在且 integrity 與 release manifest 相同就跳過；若已存在但內容不同就立即失敗。dist-tag 檢查只讀取 tag 對映，不解析默認 tag 指向的版本，因此即使無關 tag 指向的版本已不存在，也不會阻斷復原。完成後必須逐包確認版本 integrity 和 dist-tag 都指向本次版本，只有整個集合透過最終驗證，工作流程才報告發布成功。

如果 pack、tarball 檢查或安裝後整合測試失敗，登錄檔必須保持零寫入。如果 publish 在部分上傳後失敗，操作者使用同一 release manifest 重跑 publish 命令來復原，不得重新 pack 並生成另一個時間戳版本來代替復原。修復程式碼或改變建置輸入後需要不同 tarball 時，才重新執行完整 pack 與測試。

## GitHub Actions 整合

GitHub Actions 分為無憑據的 pack-and-test job 與受保護的 publish job。前者檢出精確 commit，呼叫與本機相同的 pack 入口，執行 tarball 消費端測試，並上傳完整 release bundle 作為工作流程產物。後者相依性前者成功，從工作流程產物下載 bundle、重新校驗 manifest 和校驗和，再呼叫同一個 publish 入口；它不能檢出後重新建置。

PR 與普通 push 可以執行無憑據的 pack-and-test 訊號，從而在合併前發現 payload 回歸。實際私有登錄檔發布先透過 `workflow_dispatch` 提供，輸入只包括目標 ref；UTC 時間戳由 pack job 生成，基礎版本、短 SHA、tag、登錄檔和包清單都由倉庫狀態或受版本控制的設定派生。穩定發布觸發方式不在本基線提案範圍內。

登錄檔 token 只注入 publish job，並由受保護 GitHub Environment 控制人工批准、允許的分支或 tag 以及並行。pack-and-test job 不得讀取發布憑據。工作流程產物的保留期可以較短，但 publish job 必須使用同一 workflow run 生成的 bundle，不能按版本號從不受信任的位置尋找 tarball。

## 考慮過的替代方案

**從 workspace 直接遞迴 publish。** 不採用，因為命令會把 pack 與登錄檔寫入交錯，無法在第一次寫入前證明整個集合完整，也容易讓 workspace 解析與呼叫方工作樹狀態影響發布結果。

**只測試工作樹中建置後的 `lib/`。** 不採用，因為這驗證的是建置樹，不是 `package.json#files` 選出的 tarball。工作樹中存在而 tarball 中漏掉的動態 chunk 正是本提案必須捕獲的失敗。

**只執行 `dsh --help`。** 不採用，因為 Commander 可以在載入 TUI、Web 或 headless 動態入口之前輸出幫助並退出。它無法證明默認生產啟動路徑完整。

**把 `src` 和聲明對映一起發布以降低漏文件風險。** 不採用，因為原始碼平面不是生產執行時期的後備路徑；擴大 payload 會掩蓋 bundle 閉包錯誤，並把本機除錯產物變成無意的發布約定。

**要求真正的跨包原子發布。** 不採用，因為 npm 登錄檔沒有相應交易。不可變 release bundle、發布前全量驗證、integrity 比對與冪等復原提供可實作的邊界，同時明確保留部分上傳短暫可見的限制。

**在批准後由發布 job 重新建置。** 不採用，因為測試透過的 tarball 與實際上傳的 tarball 將不再具有內容身份。工作流程產物與校驗和必須把測試輸入直接傳給發布步驟。

## 驗收標準

- 一個 pack 入口從確定 commit 發現 `packages/*/*` 和 `apps/*` 的全部目標包，以 UTC 秒級時間戳與短 commit 生成並顯示版本，再等待 Enter；它在任何登錄檔寫入前生成完整 release bundle，並輸出一個可複製的 publish 命令；`release` 在 pack 後再次等待，`--yes` 跳過兩次確認。
- 靜態 manifest 閘門和 tarball 內容閘門都拒絕發布 `src` 與 `.d.ts.map`，同時保留原始碼 manifest 中的 `exports["./src/*"]`。
- release bundle 記錄完整包集合、commit、派生版本、tag、登錄檔和逐 tarball integrity；所有內部相依性都精確固化到該版本，publish 只消費該 bundle，絕不重建。
- 一個隔離整合測試從本機 tarball 安裝消費端，並用普通 Node 啟動安裝後的默認 `dsh` TUI；刪除任一所需動態 chunk 會使該測試穩定失敗。
- 所有已發布 bin 和適用的公開執行時期入口都有 tarball 安裝後的執行覆蓋，且解析路徑證明沒有回退到 monorepo。
- publish 可在部分成功後用同一 manifest 安全重跑；相同 integrity 被跳過，不同 integrity 被拒絕，最終驗證要求所有版本與 tag 一致。
- GitHub Actions 的無憑據 job 生成並測試 bundle，受保護 job 上傳完全相同的 bundle，發布 token 只存在於後者。

## 風險

全量 pack、安裝和啟動會增加 CI 時間與工作流程產物體積。實作應快取外部相依性和 pnpm store，但不得快取或複用目標包的已安裝 workspace 輸出；平行執行安全的消費端 probe 可以降低時延。

把所有 tarball 都安裝為臨時項目的頂層相依性可能掩蓋未聲明的內部相依性。測試生成器應按被測應用的聲明式遞迴閉包安裝，並結合現有相依性閘門；對相依性面接近全集的 `@deepseek-ai/dsh`，仍需依靠 package manifest 與靜態圖檢查發現未聲明邊。

不同平臺的 optional dependency、native addon、PTY 與瀏覽器入口可能需要平臺專屬 probe。第一階段至少在發布所用 Linux runner 和一個本機 macOS 路徑上覆蓋主 `dsh` 啟動，後續矩陣按實際發布平臺擴充；不能用跳過不穩定 probe 的方式把生產路徑移出門禁。

復原機制不能消除 npm 的部分可見性。發布失敗期間，登錄檔可能短暫含有本次版本的一部分包；操作者與自動化必須以最終 bundle 驗證結果而非單個 `npm publish` 的成功作為基線可用訊號。
