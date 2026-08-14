# Agent Note: 讓 Lefthook 安裝限定於各 worktree

Status: implemented

[English](2026-07-27-worktree-local-lefthook.md) | [简体中文](2026-07-27-worktree-local-lefthook.zh.md) | 繁體中文

## 問題

每次執行 `pnpm install` 都會執行根目錄的 [`postinstall`](../../../../package.json)，其中的 [`install-lefthook.mjs`](../../../../scripts/install-lefthook.mjs) 會呼叫 `lefthook install --force`。若無額外設定，關聯的 Git worktree 共用同一倉庫的默認掛鉤目錄，因此在任一 worktree 中安裝都可能改寫其他所有 worktree 使用的掛鉤。

Lefthook 生成的掛鉤會優先使用安裝時從對應 worktree 記錄的絕對二進位檔案路徑，之後才嘗試當前 worktree 的回退路徑。因此，共享掛鉤會一直執行另一個 worktree 固定版本的二進位檔案，直到該 worktree 消失；並行安裝還會寫入同一組文件。

## 決策

掛鉤安裝以 worktree 為作用域。當 `CI=true` 或 `GITHUB_ACTIONS=true` 時，安裝程序會在探測 Git 或做出任何變更之前返回，因為自動化任務不會使用貢獻者掛鉤。否則，安裝程序要求 Git 2.26 或更高版本，使 `git config --show-scope` 可以報告由哪個作用域提供設定值；它會將格式版本為 0 的倉庫升級到格式版本 1，啟用 `extensions.worktreeConfig`，並將當前 worktree 的 `core.hooksPath` 設為指向 `$GIT_DIR/dsh-hooks` 的絕對路徑。

升級格式 0 之前，安裝程序會拒絕共用設定中直接設定的 `extensions.*`；它還會拒絕直接設定的 `core.worktree` 或 `core.bare=true`，以及啟用擴充後將被啟用的非空休眠 worktree 設定。遷移會移除直接設定的 `core.bare=false`，因為 false 是 Git 的預設值。共用倉庫設定和每個已有的 `config.worktree` 都必須是常規文件。這些檢查會停用 include 展開，因為 Git 的倉庫格式解析器也會忽略 include 目標。倉庫級鎖會序列化遷移和掛鉤寫入；釋放時，鎖的行程 ID、隨機權杖、文件身份和完整內容必須仍然匹配。所屬行程已結束或內容無效的鎖必須人工介入復原，而不能自動強制解除。

每個掛鉤目錄都有一個 JSON 所有權標記，其中包含上次寫入 worktree 設定的絕對路徑。檢出目錄移動後，該標記只允許替換確切的過時自有值。Git 會以主 worktree 的設定為新連結 worktree 初始化 `config.worktree`；當該初始設定包含某個已註冊 worktree 中由所有權標記佐證的保留掛鉤路徑時，安裝程序只會在新 worktree 的設定中將其替換為新 worktree 自有的路徑。Lefthook 執行前，所有權標記和每個已有的生成掛鉤都必須是不帶別名的常規文件。安裝程序會解析 `core.hooksPath` 的生效作用域、來源和值，包括透過當前生效的 `config.worktree` include 載入的值；它會拒絕命令作用域路徑、非自有的 worktree 作用域路徑以及非自有的保留目錄。繼承自系統、全域性或共用倉庫設定的路徑必須設定 `DSH_LEFTHOOK_ALLOW_HOOKS_PATH_OVERRIDE=1`，從而只讓當前 worktree 顯式啟用 Lefthook。未生效的 `includeIf` 目標不會被遞迴檢查，因為它們不影響當前設定。完成驗證後，Lefthook 子行程的環境會移除命令作用域的 Git 設定。

若 Lefthook 在更改 `core.hooksPath` 後失敗，安裝程序會復原先前的 worktree 值；若回滾失敗，會與安裝失敗一並報告。`$GIT_COMMON_DIR/hooks` 中的現有文件絕不會被移除或改寫。有針對性的安裝程序測試鎖定了以下行為：隔離、對複製而來的新 worktree 設定的處理、遷移拒絕、所有權與檢出目錄移動、並行安裝、自訂路徑及回滾。

## 考慮過的替代方案

**保留共享的生成掛鉤，並相依性其當前 worktree 回退路徑。** 只要對應 worktree 仍存在，記錄的絕對路徑就會優先生效，因此回退路徑無法提供版本或生命週期隔離。

**讓每個 worktree 都指向同一個納入版本控制的 `.githooks` 目錄。** 使用受版本控制的相對目錄可以消除生成的絕對路徑，但更改共享的 `core.hooksPath` 可能會停用舊 worktree 中的掛鉤，因為其分支並不包含該目錄；同時，每個 worktree 仍然耦合於同一個共享設定值。

**建置通用的掛鉤管理器串聯層。** 執行順序、參數轉發、失敗語義和升級都會成為倉庫自行負責的行為，卻與 Lefthook 隔離無關。因此，安裝程序會拒絕 worktree 專屬的自訂路徑，只將範圍更窄的繼承路徑覆蓋設為顯式操作。

**將特定 CI 提供商的憑據 include 路徑加入白名單。**CI 不使用貢獻者掛鉤，因此路徑豁免會使安裝程序的安全性耦合於 CI 提供商檢出流程的內部實作，並削弱貢獻者安裝時的嚴格驗證。在 CI 中直接跳過操作，無需任何豁免即可避免修改倉庫。

**停止自動安裝掛鉤。** 手動設定可以避免共享寫入，卻會使倉庫中低成本的提交與推送檢查意外變成選填項，短期存在、由 agent（代理）使用的 worktree 尤其容易受到影響。

## 後果

安裝或移除任一 worktree 不再改變其他 worktree 的生效掛鉤、二進位檔案路徑或生成的掛鉤位元組。並行安裝會序列執行，重複安裝保持冪等；[快速本機 Git 掛鉤](2026-07-22-fast-local-git-hooks.md)所規定的任務與延遲邊界保持不變。

首次安裝後，倉庫會採用 Git 格式版本 1。安裝程序需要 Git 2.26 來使用 `--show-scope`；worktree 設定擴充本身的出現早於該命令。自訂 worktree 掛鉤管理器需要明確選擇整合方式；繼承掛鉤路徑可繼續供其他 worktree 使用，但當前 worktree 顯式啟用 Lefthook 後，其中不會執行這些繼承掛鉤，除非貢獻者透過 `lefthook.yml` 將其串聯起來。

舊的共用掛鉤會為尚未升級的 worktree 保留在磁碟上。它們可能逐漸過時，但自動刪除這些掛鉤會破壞已註冊但所在分支尚未採用本安裝程序的 worktree。
