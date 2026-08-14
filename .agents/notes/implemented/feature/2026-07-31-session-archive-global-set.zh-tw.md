# Agent Note: 工作階段歸檔（登錄檔級全域性集合）

Status: implemented

[English](2026-07-31-session-archive-global-set.md) | [简体中文](2026-07-31-session-archive-global-set.zh.md) | 繁體中文

## 問題

Sidebar workspace 瀏覽區的工作階段行選單裡，「Delete session」一直是純視覺佔位（無 handler）。產品口徑定為**歸檔**而非刪除：工作階段日誌與 workspace 記帳都不動，只把該工作階段從所有分組檢視表（workspace 分組、Ungrouped、搜尋、平鋪清單）裡隱藏。歸檔記錄需要一個落點：Ungrouped 的工作階段不屬於任何 workspace 實體，per-workspace 欄位放不下它。

## 決策

**歸檔集合是 workspace domain 全域性單例（`workspaceDomainState.archivedSessionIds`）上的一個新欄位，覆蓋在 workspace 記帳之上；顯示過濾全部收斂在 client 的 `tree.ts` 派生層；wire 面走全快照姿態。**

- 儲存：`archivedSessionIds: z.array(sessionId).default([])`，domain version 保持 2——純新增欄位，舊介質經 schema default 解析為空集合，無遷移程式碼。被歸檔的工作階段保留其 `sessionIds` slot（未來取消歸檔復原原位置），因此與「一個工作階段只被一個 workspace 記帳」不變式零糾纏。
- 登錄檔：`ctx.workspaceRegistry.archiveSession(id)` 走 `enqueueOperation` 與 create/delete 序列；未知工作階段（即時與持久化都查不到）拋 `WorkspaceUnknownSessionError`；已歸檔 id 不寫盤不發事件。`archivedSessionIds` getter 暴露只讀集合。
- RPC：`workspace.archiveSession({sessionId}) → {archivedSessionIds}`（應答更新後的完整集合）；`workspace.list` 回應攜帶集合作為重連基線；新 host 幀 `host/archived-sessions-changed` 在每次持久變更後推完整快照（與 `host/workspace-changed` 同姿態，從 `domain/changed` 的 global put 分支比對推幀）。未知工作階段複用錯誤碼 `session-not-found`。
- client 執行時期：`WorkspaceListState.archivedSessionIds`（按 Host 順序的 `readonly SessionId[]`，成員不變不換引用——公有快照狀態保持 store 引擎的純資料詞彙：immer draft 不開 MapSet 外掛程式就不接受 Set；membership 查詢在派生函式內自建臨時 Set，與 expandedProjects 同款）；list 基線、unary 回聲、changed 幀三路都會用完整集合整體替換現有值。投影層在當前 selection 落入歸檔集合時統一清空回 New Session 檢視表（使用者拍板：歸檔當前打開的工作階段會使主檢視表回到 hero）——一條規則同時覆蓋本機 unary 回聲、其他分頁標籤的 changed 幀、以及重連基線發現當前 selection 已在此 client 離線期間被歸檔的情形；幀/回聲落在 in-flight `workspace.list` 期間時還會封鎖舊基線對新集合的回滾。
- UI：選單項 `delete`（visual-only）改為 `archive`（label「Archive session」，非 danger 樣式，無確認對話框——非破壞性操作，誤觸後果只是清單隱藏）；過濾實作為 `tree.ts` 的 `sessionVisible` 判據加一檔，`deriveGroups`/`deriveFlat` 增加 `archived` 集合入參，四個檢視表（分組迴圈、stray 兜底、搜尋、平鋪）同源生效。

## 已考慮的替代方案

**per-workspace archivedSessionIds（最初表述）。** 否決：Ungrouped 工作階段無落點；使用者改口全域性。

**SessionSummary 打 archived 標（session.list 層）。** 否決：要把 workspace domain 事實 join 進 sessions domain 投影，summary 無增量幀還得另發通知，跨域耦合大於收益。

**host 側在 `workspaceView`/`sessionIds` getter 過濾。** 否決：歸檔 ≠ 改記帳，投影過濾會把兩個概念攪渾；未來復原入口也需要 client 拿到全量記帳。

**增量幀（archived/removed 單條）。** 否決：集合極小、變更頻率低，全快照免去 client 側合併邏輯與去重狀態，與 workspace-changed 現有姿態一致。

## 後果

歸檔後 UI 無查看/取消歸檔入口（本期口徑，記錄在 README 的 Known Limitation 中）；資料與 slot 完好，後續加復原面只是 UI + 一個逆向 RPC。`workspace.list` 回應形狀變化是 pre-release 直改（無相容層）。e2e（workspace-management）釘住了「歸檔→行消失→reload 後仍隱藏、日誌仍在」的全鏈路；domain 層測試釘住冪等、未知 id 拒絕、跨重新啟動復原與舊介質默認升級。
