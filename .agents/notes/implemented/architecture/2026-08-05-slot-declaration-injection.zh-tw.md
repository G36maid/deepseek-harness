# Agent Note: slot 聲明注入與重載生命週期

Status: implemented

[English](2026-08-05-slot-declaration-injection.md) | [简体中文](2026-08-05-slot-declaration-injection.zh.md) | 繁體中文

## 問題

用戶端外掛程式可能在聲明某個 slot 的外掛程式之前或之後向該 slot 貢獻內容。Cordis 服務注入無法表達這種相依性：服務只能作為間接的順序訊號；用戶端 manifest（中繼資料清單）的相依套件不會規定啟用順序；即使所有相關服務始終掛載，slot 仍可能消失後重新出現。因此，立即註冊會與尚未聲明的 slot 形成競態，而等待無關服務則會耦合本可獨立重載的功能。

slot 級熱替換還要求兩個相互獨立的所有者。移除聲明方外掛程式必須移除其子 slot 下的所有貢獻；移除貢獻方外掛程式只能移除該外掛程式自己的條目。即使消失與重新出現合併在同一次通知中，同一個 key 的替換聲明也屬於新的生命週期。

## 決策

`SlotRegistry.inject(name, callback)` 以已聲明的 slot 本身作為相依性。完整的 `SlotMap` key 會經過靜態檢查；系統不引入命名空間建置器、合成的 Cordis 服務或 slot 專屬 `Context`。聲明存在時回呼同步執行，否則等待；回呼返回一個同步 disposer，或由多個 disposer 構成的同步 iterable。iterable effect 的安裝具有交易性：後續 setup 失敗時，系統會按逆序 dispose（資源釋放）之前 yield 的所有 effect。

該帳本記錄獨立於 slot 普通條目版本的 declaration epoch（聲明代次）。每當子聲明建立或摺疊時，epoch 都會變化。注入會記住活躍 epoch；該 epoch 結束時，注入會 dispose 其回呼 effect；即使最終觀測到的狀態始終為已聲明，也會為替換聲明重新執行回呼。普通貢獻變更不會重新啟動注入。

聲明方與貢獻方各自保留其自然所有權。注入控制器和每項貢獻都執行在貢獻方外掛程式呼叫時的 `Context` 上，因此 dispose 該外掛程式會同時移除其等待與活躍條目。slot 帳本現有的子項摺疊級聯會在聲明方消失時移除條目；隨後，注入會執行其 disposer 以釋放服務層資源，並繼續等待後續聲明。系統既不會將聲明方外掛程式的 `Context` 保留為 capability 來源，也不會向貢獻方公開它。

動態重載程式碼使用普通 Cordis 外掛程式 fiber 作為替換單元：透過 `ctx.plugin()` 啟用新模組；掛載替換模組之前，先 dispose 並等待舊 fiber；該 fiber 的 `slots.inject` 與 `slots.register` effect 會隨之退出。renderer 訂閱會觀察到帳本移除並解除安裝元件；無需建立 slot 自有的 fiber 樹。

## 失敗與生命週期約定

如果注入建立時聲明已經存在，回呼 setup 失敗會同步上報。延遲聲明出現後發生的回呼失敗，會先取消訂閱並回滾已收集的 effect，再在 slot 通知刷新之外上報，避免一個註冊方使其他 listener 得不到執行機會。直接呼叫 `slots.register()` 向未聲明 slot 註冊仍會拋出例外：注入是顯式機制，不會削弱載入時驗證。

對注入執行 dispose 具有冪等性。它會先取消訂閱，再釋放活躍的回呼 effect，避免拆卸觸發的帳本通知復活該項貢獻。聲明綁定的 teardown 與帳本邊界同步，因此會在同一 tick 的任何後續註冊之前釋放服務層資源。隨外掛程式一同 dispose 的待命注入無法在之後啟用。

## 備選方案

**將 `ConversationController` 或其他服務用作順序屏障。** 服務存在並不能標識相應聲明，也不會跟隨聲明的重載生命週期；只負責呈現的貢獻方還會因此產生虛假的包相依性。

**將每項聲明橋接為 `slot:<name>` Cordis 服務。** 這會汙染服務命名空間，使拼錯的動態 key 變成靜默的服務等待，並把帳本狀態偽裝成業務能力。原生 slot 注入無需改變 Cordis 拓撲，即可提供同樣的等待能力。

**為每個 slot 建立 Cordis 上下文或 fiber。** 貢獻方需要的是自身外掛程式生命週期與聲明生命週期的交集，而不是聲明方的能力。slot 所有的上下文會引入 capability 繼承和雙父級拆卸問題，卻無法改善帳本所有權。

**讓 `register()` 隱式等待。** 對未聲明目標立即失敗是一項有價值的設定檢查。顯式注入能夠區分有意獨立排序的貢獻與錯誤組合。

**只根據 `spec(name) !== undefined` 判斷替換。** 摺疊與重新聲明可以合併成一個最終狀態始終存在的通知，而舊貢獻此時已經被移除。declaration epoch 保留了這條生命週期邊界。

## 影響

slot 相依性可以在註冊點審計，並且無需特定於包的順序約定即可跟隨聲明替換。動態外掛程式 dispose 會透過既有 Cordis effect 移除已渲染條目，而聲明替換則為後續 slot 級 HMR（熱模組替換）提供穩定掛鉤。

執行時期為每個被訪問的 slot 多維護一個單調 epoch，且注入回呼必須返回清理操作。多註冊回呼使用 iterable effect，使 setup 與 teardown 保持原子性。扁平的點分 key 帳本和唯一的 `register()` 組合權威保持不變。
