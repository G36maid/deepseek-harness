# Agent Note: 新工作階段的權限 Settings 預設值

Status: implemented

[English](2026-07-31-permission-default-for-new-sessions.md) | 繁體中文

## 問題

Web「通用」設定頁將「權限」顯示為停用的骨架控制元件，儘管 `dsh-permission-presets` 已經擁有 preset 表和當前工作階段的切換路徑。Settings seam 可以持久化由外掛程式擁有的值，但 Web Settings API 只暴露可設定 LLM（大型語言模型）提供方的 namespace。更重要的是，如果把使用者偏好當成即時生效的全域性權限，現有工作階段的執行策略就會在其持久日誌之外發生變化。

## 決策

`dsh-permission-presets` 擁有一個 `permission` Settings namespace，其中只有 `defaultPreset` 欄位。它的基礎值是 `Config.defaultPreset`；省略該設定時，則使用與組合後的沙盒和審批預設值匹配的 preset。schema 的 enum 從已設定的 preset 表派生，因此 Settings 既能校驗已儲存的值，Web 用戶端也能發現部署中的實際選項，而無需重複定義。

服務會在 `session/created` 時同步讀取當前 Settings 值。真正的新工作階段會收到三個顯式事件：`permission/preset`、`sandbox/mode` 和 `approval/policy`。這些事實將建立時選中的權限固定下來，因此後續 Settings 變更隻影響之後的工作階段。帶 seed 或只完成部分初始化的工作階段會保留其有效調節項，只補齊缺失的事實；復原時絕不會採用最新的使用者預設值。`Session` 甚至會用 `session/end-seed` 標記顯式為空的構造器 seed，因此不能把空的持久化日誌誤認為新工作階段。

現有 `/permission` 命令和 `permissions` 投影仍是當前工作階段的操作路徑。瀏覽器外掛程式現在向 `settings.general.item` 貢獻「權限」行，從脫敏後的 Settings 描述符讀取動態 enum，並只透過經過 revision 校驗的 `settings.mutate` 寫入 `defaultPreset`。該行透過 slot 的 `hooks` 格注入 observable，而不是綁定渲染器專用掛鉤；權限服務掛載時會遍歷並固定所有已存活工作階段，因此 HMR（熱模組替換）不會殘留未固定的工作階段。無歸屬的「通用」設定包不貢獻任何佔位行。

ApiProxy 在可設定提供方 namespace 之外，將 `permission` 顯式加入 Web Settings allowlist。這是區域性的邊界決策，而不是通用註冊標志或 `local-client` 訪問模型：註冊其他 Settings namespace 仍不會將其暴露。權限變更透過轉發的 `settings/document-updated` 到達用戶端（[轉發的 Remote 事件](../architecture/2026-08-10-remote-event-delivery.md)），不會宣告模型拓撲。

## 後果

在 Settings 中更改「權限」會立即更新 `settings.yaml` 和選擇器，但不會改變已打開的工作階段。之後的每個工作階段都可以從三個已固定的權限事實中重建，即使使用者再次更改預設值或行程重新啟動也不受影響。如果部署中組合後的沙盒和審批預設值與任何 preset 都不匹配，則必須顯式設定 `defaultPreset`。

組裝後的 Web 快照包含功能完整的「權限」選擇器。其無金鑰瀏覽器場景會寫入 `read-only`，驗證現有的 `workspace-write` 工作階段保持不變，並驗證隨後建立的工作階段以 read-only 事件三元組啟動。

## 曾考慮的替代方案

**將 Settings 值即時應用於每個工作階段。** 不予採納，因為執行策略會在沒有工作階段事件的情況下改變，重播也無法重建先前工具呼叫採用了哪種權限。

**建立時只記錄 `permission/preset`。** 不予採納，因為沙盒和審批是由不同組件獨立擁有的全量值調節項；固定全部三個事實，可以讓其消費端不相依性未來的組合預設值變化。

**暴露所有 Settings 註冊，或增加通用的 `local-client` 聲明。** 本次變更不予採納，因為這會擴大安全邊界，並使 Settings 約定超出所請求的單項偏好。顯式加入 `permission` allowlist 已足夠，未來的 namespace 可以各自決定是否暴露。

**復原帶 seed 的工作階段時應用最新預設值。** 不予採納，因為復原操作必須保留工作階段先前的有效執行策略；缺失的舊版事實應從該策略中補齊。
