# Agent Note: 已交付介面的 workspace-write 預設值

Status: implemented

[English](2026-07-31-workspace-write-surface-default.md) | [简体中文](2026-07-31-workspace-write-surface-default.zh.md) | 繁體中文

## 問題

已交付的終端機和瀏覽器介面在兩套不同的無約束組合下暴露相同的編碼工具。Web 掛載了沙盒與權限服務，卻選擇 `danger-full-access`；TUI 則直接掛載不受限的本機 bash 與檔案系統提供方。因此，在使用者主動選擇這類權限之前，全新的編碼工作階段就能修改其同 UID 行程可達的任意路徑。

## 決策

[`base.cordis.yml`](../../../../packages/bundle/base/cordis.patch.yml) 為所有已交付的 TUI、Web 以及由瀏覽器支撐的無頭工作階段統一持有一套沙盒與權限棧：`dsh-sandbox-local`、`dsh-sandbox-policy`、`dsh-bash-sandbox`、`dsh-fs-sandbox`、`dsh-user-approval` 和 `dsh-permission-presets`。組合回退值為 `workspace-write` preset，其中包含 `workspace-write` 文件效果模式與 `ask` 審批策略。`DSH_PERMISSION_MODE` 仍是顯式的行程級覆蓋；已儲存的 `permission.defaultPreset` 仍是面向後續工作階段的使用者偏好，並透過 Settings seam 優先於該回退值。

真正的新工作階段會在執行前固定 `permission/preset: workspace-write`、`sandbox/mode: workspace-write` 和 `approval/policy: ask`。現有工作階段和復原的工作階段保留日誌中記錄的權限，更改「通用」設定中的預設值隻影響之後建立的工作階段。瀏覽器保留 Access 選擇器、可應答的審批卡片，以及選擇 Full access 時的風險確認。共享 Permission 服務在 TUI 中啟用其命令子件，因此 TUI 會獲得現有的 `/permission` 命令。

該模式只管轄文件效果。受沙盒約束的 bash 與檔案系統修改只允許寫入工作階段工作區和平臺臨時根目錄；讀取、網路訪問與行程可見性仍不受該策略約束。若沒有平臺 runner 能強制執行受限的 bash 呼叫，執行會以拒絕告終，不會退回不受限命令。

## 測試

已交付 TUI 的無金鑰偽終端機冒煙測試會啟動真實 Loader 樹，讀取已持久化的首個請求，並斷言 bash schema 中的 `sandbox_permissions`／`justification`，以及初始的 workspace-write 事件三元組。已交付 Web 組合的冒煙測試斷言相同的策略、審批與 Permission 預設值。組裝後的瀏覽器 Settings 快照打開時選中 Workspace Write，在更改後續工作階段預設值時保持現有 `workspace-write` 工作階段不變，並仍然驗證經確認後選擇 Full access 的路徑。

## 曾考慮的替代方案

**將沙盒棧留在 `web.cordis.yml`，並在 `tui.cordis.yml` 中複製一份。** 不予採納，因為外掛程式標識、preset、回退值與執行器替換完全相同。兩份副本會讓安全預設值相依性兩個介面覆蓋層持續同步；共享 base 纔是它們的唯一歸屬。

**保留不受限的 TUI，只更改瀏覽器回退值。** 不予採納，因為這會保留無法解釋的介面差異，並讓全新的終端機工作階段繼續擁有本決策要移除的權限。

**在同一次變更中新增終端機審批對話框。** 不予採納，因為這是另一個互動與生命週期決策。TUI 沒有 `approval/request` 應答者，因此一次性自動升權當前會落定為不可用並以拒絕告終；需要更寬權限的使用者可以透過 `/permission` 主動選擇其他 preset。

## 後果

全新的工作階段無需額外提示即可修改當前工作區與臨時根目錄，嘗試修改其他位置則會在觸及目標前被拒絕。Full access 仍可透過顯式選擇獲得，瀏覽器選擇時也仍會顯示確認對話框。系統不會重寫已儲存的使用者預設值和工作階段日誌中記錄的權限。

由瀏覽器支撐的無頭入口繼承 Web 組合，因此預設值相同。TUI 缺少審批應答者是本次變更的明確限制：自動請求更寬權限的重試會在那裡以拒絕告終，而不會顯示權限詢問。
