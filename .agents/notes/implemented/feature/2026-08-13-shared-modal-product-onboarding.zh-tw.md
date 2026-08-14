# Agent Note: 共用彈出視窗的產品引導

Status: implemented

[English](2026-08-13-shared-modal-product-onboarding.md) | [简体中文](2026-08-13-shared-modal-product-onboarding.zh.md) | 繁體中文

## 問題

首次使用引導混用了兩種互動：產品背景說明佔滿整個視口，憑據提示則先把使用者帶進「設定」，之後才能輸入金鑰。一個很短的有序流程因此像兩個互不相關的介面，引導 UI 的歸屬也分散在多個包中。產品仍需要在提供方設定之前顯示版本化的測試階段聲明，但復原它不能增加第二個獨立浮層，也不能改變 Host 的設定與憑據邊界。

## 決策

**由同一個既有 client Cordis 外掛程式持有兩個已發布步驟。** `ui-settings-models` 在 `settings.onboarding` 中以順序 `-100` 註冊 `welcome-notice`，以順序 `0` 註冊 `deepseek-official`。外殼仍然只掛載第一個未完成條目，因此兩個彈出視窗不會堆疊。不新增 client 包或外掛程式設定行。

**兩個步驟共用同一個彈出視窗元件。** `OnboardingModal` 包裝既有 ui-primitives `Modal`，提供統一的標題和內容版面配置，並只在可見期間持有 `#root` 的 inert 狀態。Escape 和遮罩點擊不會靜默完成強制引導；每個步驟只暴露自己的明確操作。步驟仍在載入私有事實時返回 `null`，因此不會繪製或阻塞介面。

**歡迎聲明複用既有持久化欄位。** 完整文案與版本由 `onboarding-copy.ts` 持有。回環用戶端透過既有 settings API 比較和寫入 `ui-onboarding.welcomeNoticeVersion`，且只有點擊「繼續」才確認當前版本。遠端用戶端繼續使用既有的行程內回退，因為該 settings namespace 僅限回環訪問。不改變 Host schema、API Proxy 允許清單或持久化實作。

**憑據彈出視窗複用既有編輯器與寫入邊界。** Models 聯接仍負責判斷是否已有任意可用提供方。當 DeepSeek 官方引用可寫但缺失時，`ProviderEditor` 以僅憑據模式渲染在共用彈出視窗中。它校驗金鑰並呼叫既有 `credentials.set`，不會修改提供方設定。「保存並繼續」會等待寫入與就緒狀態刷新；「稍後設定」只完成協調器當前這一輪。

## 曾考慮的替代方案

**讓聲明與憑據步驟分別成為 client 外掛程式。** 不採用：產品要求只使用一個 client Cordis 外掛程式，且兩個介面共享文案、順序、彈出視窗框架與失效刷新歸屬。

**把確認或憑據邏輯移入新的 Host API。** 不採用：兩個既有後端契約已經能表達所需狀態與寫入；新增 endpoint 只會擴大範圍，不會增加使用者能力。

**繼續從憑據步驟跳轉到 Models。** 不採用：首次使用唯一必填的是金鑰，既有編輯器可以安全暴露這項寫入，無需再把使用者送進第二個對話框。

**保留此前佔滿視口的展示層。** 不採用：本次需要的是疊加在當前應用上的兩個彈出視窗，既有 ui-primitives modal 已提供合適的 portal、遮罩與無障礙契約。

## 後果

新的回環 profile 會先看到指定的內測聲明；僅當沒有任何可用提供方時，之後才會出現行內 DeepSeek 金鑰彈出視窗。確認仍按版本寫入 `settings.yaml`，secret 仍以只寫方式存入 `.credentials.yaml`，已就緒或無法修復的部署在載入判定期間不會渲染任何引導框架。Models 包現在同時持有產品引導展示與提供方設定；README 和瀏覽器覆蓋明確記錄了這項擴充後的職責。本決策在歷史上的[全屏內測聲明移除](../simplification/2026-08-13-remove-first-run-beta-notice.md)之後復原簡潔的測試階段聲明，但不會復原那份聲明中的遙測文案或接管式版面配置。
