# @deepseek-ai/dsh-client-web-react

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

slot 終端機設計的外殼側 React 膠水：createSlotRenderer（外殼安裝到執行時期 SlotRegistry 的 SlotRenderer 實作）、SessionProvider（由框架接入的 render prop，也作為標準 seat 注入到聲明工作階段 scope 子 slot 的設定項）、bindSnapshotSelector（唯一的掛鉤構造器：主機與引擎只傳遞裸 observable source；每個掛鉤在此綁定，並按 source 快取）、useInvoke。鏈式 slot outlet 在渲染時按鏈順序執行已註冊 selector，只掛載被選中的設定項，其 select 回傳值以 `matched` 加入 props；`renderSlotChain` 綁定與 `renderSlot` 一樣按設定項快取。快照 store 引擎與 defineStore 位於執行時期；業務外掛程式只相依性 ui-slots 類型，絕不相依性該包。

## 模型體驗

無。ctx↔React 機制完全在瀏覽器中執行；這裡沒有任何內容進入模型請求。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **persist 中介軟體會損壞原始值狀態 store**：保存時它會對狀態執行對象展開，因此 `SnapshotStore<string>` 往返後會變成字元對映；引擎改為自行實作持久化（見 `attachPersistence`）。
- **`UseSession` 有意保持寬泛（`object` 快照）**：相依性方向（runtime → web-react，絕不反向）使真實 `ConversationSnapshot` 類型不可訪問；工作階段 slot 消費端在其邊界處縮窄一次。
- **`renderSlot` 是唯一的渲染形式**：沒有 Suspense 整合或逐設定項惰性載入。
