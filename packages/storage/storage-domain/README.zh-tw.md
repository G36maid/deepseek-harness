# @deepseek-ai/dsh-storage-domain

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

DeepSeek Harness 儲存中心的領域資料形式：在所有已設定的後端註冊後，公開可注入的 `ctx.storageDomain` 服務及對應的 `ctx.storage.domain` 投影。一個領域透過 `defineDomain`（zod 記錄 schema、從 `z.infer` 派生的類型）聲明一次，透過 `DomainFacility.open` 打開，並由具有最終決定權的記憶體狀態提供服務：讀取同步執行；寫入在每個領域各自的一條鏈上序列化，先在已路由後端達到持久狀態，再更新記憶體並行出 `domain/changed`。打開領域的消費端負責管理控制代碼的生命週期，並透過 `Domain.close()` 釋放它（冪等；通常作為其自身的 `ctx.effect` 資源釋放函式）；外掛程式解除安裝時，該設施會關閉仍處於打開狀態的領域。

設計原理、打開語義和儲存／領域分層見 [Agent Note](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md)。

## 設定

| key | 含義 |
| --- | --- |
| `backend` | 每個領域的預設後端名稱（必填；不存在普遍適用的儲存介質）。 |
| `routes` | 逐領域覆蓋：領域名稱 → 後端名稱。 |

## 模型體驗

### 持久領域狀態

#### 模型看到的內容

無。該包不註冊工具、不注入提示詞，也不追加工作階段事件；它在 `ctx.storageDomain` 後面儲存非工作階段資料（工作區記錄、未來的工作階段伴隨資料），只發出行程內 `domain/changed` 事件。只有 Consumer 包透過自身有文件說明的介面呈現該事件時，它才會到達模型。

#### Token 影響

為零。該包的文字不會進入任何模型請求。

#### KV Cache 影響

相互獨立：領域讀寫絕不觸碰請求前綴，因此這裡沒有任何內容能使提供方快取複用失效。

## 已知限制與暫緩事項

- **變更只在單行程內可見**：`domain/changed` 是行程內事件；在 Agent Note 暫緩的跨行程修訂模式落地前，第二個主機行程或重新連線的 GUI 無法觀察變更。
- **沒有跨表交易、二級索引或多段鍵**：每次寫入只觸碰一條記錄；這些擴充的觸發點和返工點列在 Agent Note 的暫緩工作清單中。
