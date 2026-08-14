# Agent Note: DeepSeek 官方首次使用憑據設定

Status: implemented

[English](2026-07-30-deepseek-onboarding-credential-setup.md) | [简体中文](2026-07-30-deepseek-onboarding-credential-setup.zh.md) | 繁體中文

## 問題

[web 設定平面](../architecture/2026-07-30-web-config-plane.md)讓提供方設定與憑據可以即時編輯，但首次使用的使用者仍會進入空白對話 Hero；當隨產品提供的 `deepseek-official` 路由缺少憑據時，介面沒有給出可採取操作的說明。Models 頁能修復該狀態，但要求使用者自行發現這個入口會削弱首次使用引導。介面不得混淆憑據缺失與配接器缺失：瀏覽器可以為現有憑據引用存入值，但無法動態掛載 `llm-deepseek` Cordis 外掛程式。

## 決策

**Models 與首次使用引導共享同一個就緒狀態投影。**`ui-settings-models` 維護一個 store，把 `llm.providers({})`、脫敏後的 `settings.describe({})` 和批次呼叫的 `credentials.describe({refs})` 聯接為同一份狀態。首次使用投影選取由 `llm-deepseek` namespace 與空 settings path 持有的 `deepseek-official` 可設定提供方條目，讀取生效的 `apiKeyEnv`，並檢查對應的憑據描述符。同 provider id 但沒有匹配可設定提供方聲明的存活路由，在首次使用引導中視為配接器缺失。透過行程環境提供的憑據若已設定，則判定為就緒並保持只讀。

**設定外殼只貢獻排序，不持有提供方策略。** `ui-settings` 聲明一個根作用域的 `settings.onboarding` list slot，並在當前介面為空白 Hero 時，每次只掛載一個有序步驟。當前註冊方會收到 `complete()` 和私有 `openSection(id)` 回呼；完成當前步驟後，所有權轉交給下一項。`ui-settings-models` 透過 `slots.inject()` 註冊 DeepSeek 步驟、排在它之前的歡迎聲明及 Models 分區，因此所有貢獻都跟隨同一個 client Cordis 外掛程式的生命週期，兩個彈出視窗也無法堆疊。它們的共用展示由[共用彈出視窗引導決策](2026-08-13-shared-modal-product-onboarding.md)持有。

**首次使用彈出視窗行內渲染既有憑據編輯器。** 配接器已掛載且處於活躍狀態，其引用可解析、可寫但尚未設定時，`ProviderEditor` 會以僅憑據模式渲染在共用引導彈出視窗中。同一個元件全權負責密碼輸入框、校驗、`credentials.set({ref, value})`、寫入失敗處理和寫入後刷新；僅憑據模式不會發出提供方 settings 變更。「稍後設定」只完成協調器當前這一輪。配接器缺失時仍跳過，因為瀏覽器不能掛載缺失的 Cordis 外掛程式。

**不可用狀態不會佔住產品。** 可設定提供方條目缺失、路由不活躍、初始聯接失敗、部署只讀或設定／憑據能力無法解析時，都會直接完成而不渲染該步驟，因為首次使用引導無法修復這些狀態。Models 頁仍是部署診斷與重試介面。「稍後設定」只會完成協調器當前這一次缺少憑據的步驟，不寫入任何完成狀態。設定、憑據、提供方拓撲和連線失效事件都會刷新共享聯接，因此外部憑據更新無需重新載入頁面即可完成已打開的步驟。

## 曾考慮的替代方案

**為首次使用引導單設 store 與就緒狀態 RPC 呼叫序列**：不予採用，因為這會在 Models 頁之外，再建立一套用戶端解釋，用於判定提供方身份、設定路徑、secret 槽位的伴隨資訊、憑據引用及失效事件順序。

**在首次使用引導中單獨實作 API key 表單**：不予採用，因為這會複製 Models 編輯器的 secret 草稿、校驗、錯誤和已設定狀態收斂。彈出視窗改為以受限模式渲染既有 `ProviderEditor`。

**把 API key 寫入提供方設定**：不予採用，因為字面量 secret 會進入設定變更路徑，而整個分節替換無法安全重建脫敏值。憑據儲存已經是產品 seam，並能立即寄出失效事件。

**`llm-deepseek` 缺失時仍顯示浮層**：不予採用，因為瀏覽器導覽沒有任何受支持的操作可以掛載缺失的 Cordis 外掛程式。

## 後果

有序流程從產品聲明頁開始，無需重新啟動即可進入行內金鑰表單：無金鑰瀏覽器測試在隔離的 harness 家目錄下啟動真實 Web 組合，確認聲明後從共用彈出視窗把生成的金鑰存入該目錄的 `.credentials.yaml`，驗證金鑰未進入 DOM、ARIA 或瀏覽器主控臺輸出，並確認普通 Models 頁面報告已設定。完整的無金鑰 Web 重播也固定了同 id 的不可設定重播路由不會阻塞無關流程。純就緒狀態測試與 React 測試固化了受管文件憑據與行程環境憑據、提供方與能力缺失、取消、外部失效和協調器移交。該流程直接繼承設定平面已記錄的基礎限制，不會另加區域性的機密儲存、脫敏或設定替換變通方案。
