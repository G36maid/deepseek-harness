# Agent Note: 用 unlink 刪除過期的 profile 回退連結而非 rmSync

Status: implemented

[English](2026-08-12-unlink-stale-profile-fallback-links.md) | 繁體中文

## 問題

`healProfilesModuleFallback` 在安裝位置遷移時會把 `$DSH_HOME/profiles/node_modules` 中的條目重新指向新目標，而 Windows 主機上這些條目是 junction。`ensureSymlink` 原先用 `rmSync(link)` 刪除過期條目，但 Node 在刪除時把 junction 當作目錄處理：不帶 `recursive` 的 `rmSync` 會拋 `ERR_FS_EISDIR`，於是從遷移後的安裝或第二個 worktree 啟動時，每次都會在應用引導前崩潰。`replaces a wrong symlink` 單元測試在 Windows 上正好在該刪除呼叫處復現了這一崩潰。

## 決策

`ensureSymlink` 改用 `unlinkSync(link)` 刪除過期連結。`unlink` 在所有平臺上都只刪除重解析點或符號連結本身、絕不進入目標目錄，從而保住該函式“真實目錄永遠不會被刪除”的大聲失敗保證。[profile-plugin-bundles 決策](../architecture/2026-08-05-profile-plugin-bundles.md)繼續擁有回退目錄的雙錨點解析；本 note 只擁有“用哪個刪除原語”這一決定。

## 考慮過的替代方案

**`rmSync(link, { recursive: true })`。** Node 24 上它只刪 junction、不跟隨目標，但 `recursive` 會在 `lstat` 守衛與刪除之間連結被替換成真實目錄時靜默刪除該目錄，削弱守衛存在所依據的大聲失敗契約。

**`rmdirSync(link)`。** Windows 上同樣能刪 junction，但它讀起來像“刪目錄”，而 `unlinkSync` 纔是倉庫現有的 junction 清理慣例。

**無條件刪除並重建所有條目。** 正確，但每次啟動都翻動未變化的連結，並擴大並行修復的競態視窗。

## 後果

Windows 啟動現在可以修復遷移後的安裝或第二個 checkout，而不是以 `ERR_FS_EISDIR` 崩潰；POSIX 行為不變，因為 `unlinkSync` 同樣能 unlink 普通符號連結。現有的 `replaces a wrong symlink` 測試在 Windows 上從復現崩潰變為透過。兩個並行 healer 刪除同一過期連結時，第二次刪除仍會以 `ENOENT` 浮現，與原先的 `rmSync` 實作一致。
