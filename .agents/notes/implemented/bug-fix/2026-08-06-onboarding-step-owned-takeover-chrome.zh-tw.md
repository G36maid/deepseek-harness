# Agent Note：首次使用引導的接管介面框架移入步驟自身

狀態：已實作

[English](2026-08-06-onboarding-step-owned-takeover-chrome.md) | [简体中文](2026-08-06-onboarding-step-owned-takeover-chrome.zh.md) | 繁體中文

## 問題

設定外殼在 `settings.onboarding` 有已註冊且本機未完成的步驟時，就立即掛出首次使用引導的接管介面框架——portal 到 body 的浮層，帶不透明的 `--dsw-alias-bg-layer-1` 展示層、模糊遮罩，並把 `#root` 置為 `inert`。而每個步驟都要先載入私有事實才能判定自己是否需要出場（WelcomeNotice：經其設定 join 讀取確認位；DeepSeekOnboardingDialog：經 Models join 讀取憑據就緒狀態），判定期間渲染 `null`。渲染 `null` 無法抑制介面框架，因為不透明展示層是外殼畫在 slot outlet 外面的，不屬於步驟。

於是每次在 hero（空白或無工作階段）狀態下重新整理頁面，工作階段清單一變 `ready` 就彈出整屏不透明層——亮色主題下是白色——並阻斷全部互動，時長恰好等於一次憑據/設定 RPC 往返；之後已設定好的步驟自我完成，圖層消失。使用者看到的就是每次刷新在 workspace/工作階段清單落地的瞬間閃一下白屏。

## 決定

接管介面框架屬於步驟，不屬於外殼。新增零 cordis 原語 `OnboardingSurface`（ui-primitives）：渲染 portal 到 body 的浮層／遮罩／展示層——CSS 類名與幾何從 `SettingsRoot.module.css` 逐字遷移——並在自身掛載生命週期內保持 `#root` 為 `inert`。兩個步驟元件只把各自的**可見**分支包進該原語；既有的 `null` 分支由此在構造上不繪製、不阻塞任何內容，因為介面框架已是同一次渲染決策的一部分。

`SettingsRoot` 的協調器原樣保留（有序帳本投影、每次掛載一個步驟、本機完成集合、`stepId`／`complete`／`openSection` currency），但對當選步驟裸渲染——不再有 portal、展示層和 inert 效果。`settings.onboarding` 的 slot 約定現在寫明：註冊方持有外層包裹，且在私有事實未決時必須渲染 `null`。

## 曾考慮的替代方案

**條件註冊（帳本即有內容訊號）。** 私有 join 解析出「需要介入」後才註冊條目。架構上乾淨（在 commit point 發布），但改動更大：join 的載入必須從對話框上移到各外掛程式的 apply，註冊／銷毀在兩個包裡都變成響應式接線。對本缺陷而言過重，否決。

**把 `settings.onboarding` 改成 chain 並把完成集合外接為 store。** composer takeover 的版型；做過原型後回退。selector 只能判定 owner props，私有就緒事實仍然只能在元件內部解析——chain 買來的是當前兩個步驟並不需要的路由通用性，代價卻是跨三個包的約定變更。

**在渲染點探測 slot 輸出為空。** `renderSlot` 無條件返回 outlet 元素，owner 無法根據步驟的 `null` 進行分支判斷；探測已渲染 DOM 是否為空需要先提交再撤回的手法，其動態翻轉會失去 paint 前的保證。

## 後果

步驟已掛載但尚未判定期間，應用保持可見且可互動：判定視窗內 `#root` 不再是 `inert`（此前在不透明圖層背後處於 inert 狀態）。對真正未設定的使用者，接管層比從前晚一個 join 往返出現——但一齣現就帶著內容，而不是先露出空白展示層再填充。

未來若有步驟註冊後不把可見內容包進 `OnboardingSurface`，會無遮罩地裸渲染在應用之上；slot 約定的 JSDoc 已把包裹寫為註冊方的義務。

## 測試

`packages/client/ui-primitives/tests/onboarding-surface.client.spec.tsx` 釘住原語行為：包裹內容的 body portal、遮罩／展示層類名存在、`#root` 的 `inert` 恰好持續掛載生命週期，以及無 `#root` 的組合。`packages/client/ui-settings-general/tests/settings-root.client.spec.tsx` 釘住反轉後的外殼約定：已掛載步驟什麼都不渲染時，無接管介面框架、無 inert。`apps/web/tests/onboarding-deepseek-config.e2e.ts` 新增本缺陷的整裝回歸釘：已設定世界重新整理頁面，同時在瀏覽器網路邊界扣住所有 `settings.describe` 回應——把步驟的判定視窗從 loopback 下不可見拉寬到數百毫秒，這正是斷言保持非空洞的關鍵——頁內 8ms 取樣器證明接管介面框架從未掛載、`#root` 從未變為 inert。該文件的既有場景與步驟 spec（`ui-settings-general`、`ui-settings-models`）原樣透過——樣式表逐字遷移，遮罩選擇器與幾何釘子得以倖存。
