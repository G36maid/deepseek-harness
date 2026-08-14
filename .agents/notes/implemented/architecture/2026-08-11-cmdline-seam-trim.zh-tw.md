# Agent Note: 把命令列接縫收窄到既有介面

Status: implemented

[English](2026-08-11-cmdline-seam-trim.md) | [简体中文](2026-08-11-cmdline-seam-trim.zh.md) | 繁體中文

## 問題

應用自有命令列（[筆記](2026-08-06-app-owned-command-line.md)）交付時帶著三條比其消費者所需更寬的接縫：一臺 vendored 的記憶體行啟用狀態機（`Entry.enableRuntime`，外加從 `dsh-cmdline` 匯出的 `enableRow` —— 一個命令列包擁有了 Loader 概念），其唯一用途是 `--dev` 條件重載行、一個只有 Include 一個實作者的 vendored `EntryConfigResolver` 協議符號，以及仍然識別 `headless-runner` 行的啟動器 —— 用它選擇 SIGTERM 退出碼、門控使用者 patch 監視，並提供與 `ctx.appExit` 重複的 `headlessIo` 接縫。

## 決策

三者全部改用已經存在的介面表達：

- **不再有條件 dev 行。** 重載鏈不再是條件性的：`dsh-web-app` 無條件掛載 `client-hmr` 行，`--dev` 連同 web runtime 的 `mode` 設定、按模式分叉的提示詞約定和 `DSH_WEB_MODE` bash 變數一並刪除。沒有重建 watcher（`pnpm run dev:web`）改寫用戶端 bundle 時，鏈路輪詢到的文件從不變化、保持空閒，因此常開的行只花費一個 stat 輪詢間隔和一條 SSE 路由。`Entry.enableRuntime`、它的兩個狀態欄位和 `enableRow` 刪除後無任何替代物。
- **樹載體設定。** Include 改為聲明已有的 `EntryGroup.key` 標記，不再實作 `EntryConfigResolver`；Loader 掛鉤讓每個樹載體的設定保持字面值。Include 自己的 `path` 失去 `!!js` 支持 —— 從未有設定用過它，固定該行為的測試改為斷言字面值樹載體約定。
- **啟動器的應用知識。** 啟動器不再識別任何應用行。SIGTERM 是監督行程的普通停止請求，在所有 surface 上以 0 退出（SIGINT 仍為 130）；啟動器無從知道應用是否認為工作已完成，而之前的 143 相依性於點名 headless 行。每次啟動都監視使用者 patch 層 —— 一次性 surface 經由有界關閉退出，關閉會先 dispose 監視器再排空事件迴圈。headless runner 像任何應用一樣經 `ctx.appExit` 退出；其輸出流是包內 `internals` 測試接縫，`ctx.headlessIo` 刪除。

## 考慮過的替代方案

- **保留 `enableRuntime` 但把 `enableRow` 移出 `dsh-cmdline`**：搬遷修正了包邊界，卻保留了 vendored 狀態機，其語義（在重新應用後仍生效、失敗時回滾）在每次上游同步時都要重新推導。
- **`entry.update({ disabled: null })`**：改寫條目的序列化選項，下一次 include 重新應用會復原 `disabled: true` 並在工作階段中途解除安裝該行。
- **透過應用註冊的訊號處理器為一次性 surface 保留 SIGTERM 143**：啟動器自己的處理器會與它競爭退出碼；要贏得競爭需要新的啟動器介面，而這正是本次變更要移除的成本。
- **保留 `--dev`、改為執行時期建立該行**：本次變更的中間形態；它仍需要提示詞約定裡的模式分叉、`DSH_WEB_MODE` 變數，以及建立與使用者自有行之間的仲裁，而這一切只為省下一個成本可忽略的空閒輪詢。

## 後果

- 用 SIGTERM 監督 `dsh --profile headless` 的部署現在觀察到退出碼 0 而非 143；訊號是呼叫方自己發的，且 stdout 上沒有答案。
- 重載鏈在每個 `dsh web` 行程中執行；不得暴露 `/plugins/events` 的部署應在其 patch 層停用 `client-hmr` 行。
- 一次性執行會掛載之前跳過的設定監視行，啟動多花幾毫秒。
- vendored Loader/Include 偏差減少一個協議符號和一臺狀態機，`rescope-vendor:check` 重新透過（修改日誌的 rescope 條目回到其精確編輯錨點要求的位置）。
