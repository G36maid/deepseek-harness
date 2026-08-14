# @deepseek-ai/dsh-client-schema-form

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

面向 settings 編輯器的 schema／草稿模型層。wire 側的 `settings.describe` 攜帶每個 namespace 的序列化 schemastery schema（`schema.toJSON()` 的 ref 封裝）；`rehydrateSchema` 用 `new Schema(json)` 將其還原（rehydrate）為活的校驗器——在宿主上校驗分節的那份 schema 對象，就是在瀏覽器裡校驗草稿的那份對象，因此用戶端校驗絕不會偏離 Service Definition 的校驗。編輯器各自渲染自己的控制元件（Models 頁圍繞它在此探測到的欄位手寫自己的卡片）；該包不含任何 React，也不做任何渲染。

## 約定

編輯的單元是**使用者分節草稿**：一個以不可變方式編輯的普通對象（`setPath` 會物化中間對象，`deletePath` 即逐欄位重設——去掉該鍵，解析值便回退到組合 base 與 schema 預設值）。欄位只要出現在草稿中就被標記為**已覆蓋**（`hasPath`）——判定採用存在性語義而非值比較，與 settings seam 的分層方式嚴格對應。`nodeAtPath` 解析可設定提供方目錄 `settingsPath` 所尋址的 schema 節點（object 屬性按名稱解析，dict 條目經由 `inner`），編輯器因此可以在決定渲染什麼之前，先探測某提供方的 profile 攜帶哪些欄位（及其 `meta.role`）；無法解析的路徑返回 `undefined`，呼叫方因此會明確進入降級路徑，而不是渲染出錯誤的子樹。`validateDraft(schema, draft)` 執行還原出的校驗器並返回其失敗訊息，頁面因此可以在寫入前拒絕無效草稿。

## 模型體驗

無。該包支撐的是瀏覽器設定編輯器；這裡沒有任何內容進入模型請求。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **重建 schema 會執行所收到的封裝**——`rehydrateSchema` 會重建一個活的 schemastery 校驗器，而 schemastery 透過 `new Function` 復活序列化過的回呼函式，因此 schema 信封是可執行內容，而不是不可執行資料。只有該封裝來自取供該頁面的同一受信任宿主時才安全；該協議沒有跨信任邊界使用的不可執行表示。
- **校驗是草稿級的，而非逐欄位**——`validateDraft` 報告 schemastery 的第一條失敗訊息及其 `$.path`；它不會把錯誤對映到各個控制元件。
- **沒有通用渲染器**——消費端在這些輔助函式上建置功能專用表單。[Web 設定面 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-30-web-config-plane.md) 記錄該權衡。
