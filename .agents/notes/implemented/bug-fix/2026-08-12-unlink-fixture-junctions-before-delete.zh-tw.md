# Agent Note: 遞迴刪除前先解鏈 fixture junction

Status: implemented

[English](2026-08-12-unlink-fixture-junctions-before-delete.md) | 繁體中文

## 問題

install-lefthook 與 translation-pairing 的 fixture 把倉庫真實的 `scripts/`、`node_modules` 和 tsx 包目錄用 junction 鏈進 fixture 樹，讓 installer 探測能穿透解析。Windows 的遞迴刪除可能把 junction（MOUNT_POINT 重解析點）當作目錄並跟隨進其目標；Git 的 `worktree remove` 正是這樣刪掉了倉庫被跟蹤的 `scripts/` 和 tsx 包（事故的插樁把刪除定位到這一步）。因此，信任刪除器的 fixture 清理刪掉的是倉庫自己的原始碼，而不是 fixture。

## 決策

`scripts/test-fixture-cleanup.ts` 擁有 junction 安全的 fixture 拆除：`unlinkFixtureLinks` 先遍歷並解鏈所有重解析點，`removeFixtureSafely` 再刪除已無連結的樹（帶 Windows 非同步控制代碼重試）。所有受影響的 `afterEach` 和 `worktree remove` 前的掛鉤都呼叫它。通用規則記錄在 `docs/defensive-patterns.md`：連結形態的路徑用 unlink 刪除，遞迴 `rmSync` 只留給確知為真實目錄的路徑。

## 考慮過的替代方案

**只信任遞迴刪除。** 否決：特定刪除器是否跟隨 junction 隨工具和版本而異，而 `git worktree remove` 這一條路徑已經摧毀過被跟蹤文件；任何清理都不該拿倉庫去賭這個行為。

**複製而不是 junction 真實目錄。** 否決：fixture 的意義就是用真實內容探測真實 installer 路徑，複製品會失去被測邊界。

## 後果

fixture 拆除不再能穿過 junction 觸及倉庫原始碼。額外開銷只是對小型 fixture 樹的一趟 lstat/unlink。這個摧毀資料的缺陷現在在 defensive-patterns 規則旁有了持久化的原因，helper 也是未來所有 junction fixture 共享的拆除路徑。
