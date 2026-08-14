# @deepseek-ai/dsh-storage

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

非工作階段資料的儲存中心（`ctx.storage`）：具名後端登錄檔加已掛載的資料形式設施。中心自身不執行 IO：後端擁有介質，資料形式擁有語義。[儲存家族概述](../README.md)列出了這些包；[領域 KV 儲存 Agent Note](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md)記錄了設計理由。

## 結構

- `ctx.storage.backend`：名稱 → 後端表。多個後端並排保持掛載（`json`、`sqlite`）；為消費端提供服務的後端由該消費端自身的設定決定（領域層的路由表），絕非中心的全域性選擇。`register()` 返回資源釋放函式；註冊重複名稱或尋找未知名稱時都會明確報錯。
- `ctx.storage.mount(form, facility)`／`ctx.storage.form(form)`：資料形式掛載。`StorageForms` 可透過合併擴充；領域層合併 `domain`，並透過 `ctx.storage.domain` 訪問。
- 後端擁有一種介質，並公開其支援的資料形狀**分面**。當前分面為 `kv`；`src/backend.ts` 負責定義其確切約定。

## 模型體驗

### 後端與形式註冊

#### 模型看到的內容

無。`ctx.storage` 是主機側登錄檔；中心不註冊工具、不注入提示詞，也不寫入工作階段事件。

#### Token 影響

每次請求都不會直接增加 token。

#### KV Cache 影響

與即時請求相互獨立：中心絕不觸碰請求前綴，因此無法使提供方快取複用失效。

## 已知限制與暫緩事項

- **`kv` 是唯一的資料形狀**：後端目前只有一個分面需要實作。
- **資料形式按需解析**：在領域外掛程式掛載前讀取 `ctx.storage.domain` 會拋出 `form-not-mounted`；組裝會按相應順序排列外掛程式（錯誤設定會明確報錯，而不是靜默推遲處理）。
