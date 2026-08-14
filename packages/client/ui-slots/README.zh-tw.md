# @deepseek-ai/dsh-client-ui-slots

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

Slot 登錄檔純核心、slot 終端機設計：SlotMap 聲明合併、SlotCore 上唯一的 `register` 組合 API、四 share 元件 props 類型家族、store seat 類型家族，以及 renderer 安裝約定。只使用 React 類型；該包不相依性 React，也不相依性 Cordis。

一次 `register({ name, children?, store?, inject?, ...kind }, Component)` 呼叫會向已聲明 slot 貢獻一個元件，同時聲明子 slot（聲明 = 算繪授權 = 執行時期規範，三者共用一張表）、store seat 以及註冊方的業務表層。元件會在呼叫點依據 `ComposedProps` 接受型別檢查；該類型是四個 share 的交集，每個 share 都從各自的唯一真源派生：

| share | 類型 | 來源 |
|---|---|---|
| 執行時期 | `PropsRuntime<K>` | SlotMap 條目：`owner`（父級 renderSlot 呼叫點）+ 工作階段標準工具包 + 全域性 seat |
| child render | `PropsRenderSlots<S>` | register 呼叫的 `children` key 集合（靜態縮窄的 `renderSlot`） |
| store | `PropsStore<H>` | 已聲明 handle：`useStore` selector 掛鉤 + 移除 draft 的 `actions` |
| business | `I` | 從 `inject` factory 回傳值推斷 |

chain-kind slot 會反轉鍵控路由：條目自行提名，而不是由分發點選擇 `entryKey`。每次註冊都攜帶一個純 `ChainSelect` selector（另有選填的升序 `priority`，相同值按註冊順序處理）；第一個非 null 回傳值選中其條目，並成為元件的 `matched` prop；全部返回 null 時則使用 owner 的 `renderSlotChain` fallback（`ChainRenderOpts`）。

標準工具包介面（`SessionStandardProps`、`GlobalStandardProps`）在這裡聲明為空，由執行時期包合併（與 SlotMap key 相同的 declare-merge 模式）。renderer 會把執行時期工作階段和 Workspace observable source 綁定為 selector 掛鉤。Inject factory 參數從聲明派生（`InjectParams`）：工作階段 slot 獲得 `sessionId`；聲明 store 時追加 baked `actions`；沒有其他參數，資料訪問位於 apply 閉包的 ctx 中。

store 家族（輸入 `defineStore` 規範／輸出 `StoreHandle<T, A>`）為 store seat 建模：`init` 推斷狀態 schema；`actions` 是完整的 draft-transform 寫入集合；`BakedActions` 移除 draft 參數，成為元件和 inject factory 收到的回呼。`defineStore` 值實作位於執行時期包（引擎所屬位置），並滿足這裡匯出的 `DefineStore` 約定。引擎產物與 renderer host 約定攜帶裸快照 source（`getSnapshot`／`subscribe`），絕不攜帶 React 掛鉤；掛鉤綁定屬於算繪機制，只有 props 約定掛鉤類型（`SnapshotSelectorHook`）位於這裡。

`SlotCore` 在構造時預置 `'root'` slot，並強制執行載入時驗證（註冊未聲明 slot、重複聲明子項、在兩個 scope 下使用同一個共享 handle、chain 註冊缺少 `select`，這些情況都在 register 時拋出）。條目的 disposer 會遞迴移除其聲明的子 slot：帳本行、貢獻和 store 掛載都會隨同一生命週期結束而移除。每個 key 還攜帶一個 declaration epoch（聲明代次），它只在聲明與移除時遞增；執行時期將其用於 [`ctx.slots.inject`](../runtime/README.md#slot-declaration-injection)，且與普通條目版本相互獨立。`renderer.ts` 攜帶安裝約定（`SlotRenderer`、`SlotRendererHost`）以及 `StaleAuthorizationError`／`SlotOwnershipError`；實作在 web-react 中，安裝則在外殼啟動中完成。

## 模型體驗

無。slot 登錄檔屬於瀏覽器側 UI 接線；這裡沒有任何內容進入模型請求。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與暫緩事項

- **`isLive` 會線性掃描所有記錄**：在 UI 外掛程式的註冊規模（數十項）下沒有問題；如果帳本變得頻繁訪問，再使用條目→記錄反向引用改進。
- **`__renders` 幻象錨點在 `PropsRenderSlots` 上可見**：這是與類型鏈設計的 `__accepts` 相同且已接受的噪音；泛型方法簽名在 key 聯合之間比較寬鬆，因此必須依靠逆變標記強制執行「元件 key 集合 ⊆ children 聲明」。
