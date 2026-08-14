# @deepseek-ai/dsh-client-test-runtime

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

面向用戶端功能測試的 jsdom slot 測試執行時期：真實 Cordis `Context`、生產 `SlotRegistry` 與 web-react 算繪器，圍繞帶類型的 session/workspace 測試替身組裝。功能套件無需逐套件手搭機器即可測遍聲明、註冊、scope、store、inject、算繪、更新與銷毀——且不存在任何生產邏輯的第二份實作。

替身實作的正是功能透過 ctx 獲得的對外介面（`TestSessions implements ISessions`、`TestWorkspaces implements IWorkspaces`；每個 fixture session 是 `FixtureSession implements SessionFace`；`stubSettingsScope` 是發布由測試驅動、帶寫入 spy 的 `SettingsScope`），生產面一旦改形，測試臺在編譯期即斷，而非靜默漂移。provide bundle 材料化直接執行生產 `SessionProvideChannel`——與 `SessionRuntime` 共用同一份實作。fixture 灌入的是普通資料：清單行、工作階段快照（經 `updateSnapshot` 以 immer 修補程式改寫）、projection 值，以及按 `ISession` 取型的行為樁——spec 呼叫未打樁的動詞時報錯自明。帶類型的 `provide()` 將已聲明服務名的 fake 約束為該服務對外面的 `Partial` 子集。

區域性 DOM 快照：`declare(children)` 註冊自動 frame，逐 key 的 `<div data-slot>` 包裹層即快照根；`renderSlot(key, owner)` 返回該 slot 的區域性檢視表（container、限定範圍的 Testing Library 查詢、原位 `update(owner)`）；註冊的快照序列化器把 CSS-module 雜湊類名折回語義名（`_frame_a1b2c3` → `frame`）保持 `.snap` 只含結構，並把 `<svg>` 內部摺疊為 `data-content` 指紋。需要自訂頁面 frame 的套件改用 `root.declare(children, Frame)`；`mount(plugin)` 在真實 fiber 上執行並對缺失服務先行報錯；`dispose()` 沿單一軸拆除檢視表、feature fiber、已鑄 scope 與持久化 store 狀態。

不屬於產品外掛程式圖（無 `dsh.client`）；feature 包僅以 `devDependencies` 相依性之。

## 模型體驗

無；本包是瀏覽器側測試基礎設施，無一物到達模型請求。

#### KV Cache effect

無；本包既不組裝也不傳送提供方請求。

## 已知限制與延期工作

- **僅可經倉內原始碼別名消費。** spec 透過 tsconfig `paths` 解析到 `src`；建置產物 `lib/` 再匯出 `@deepseek-ai/dsh-client-runtime/client`，而該 bundle 是無 Node ESM 匯出的瀏覽器 loader 指令碼，故 `lib/index.js` 在純 Node 下不可匯入。所有消費端都是倉內 Vitest 套件；不存在 Node 相容的執行時期入口。
- **工作階段快照是 fixture 資料，不是重放歷史。** `updateSnapshot` 直寫快照 store；wire 到快照的運算仍由 runtime 包自身測試與 replay e2e 把守。因此 fixture 可以表達生產投影永不產出的狀態。
